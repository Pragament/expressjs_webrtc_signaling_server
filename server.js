const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Class List (optional) ──
// If classlist.json exists, roll numbers can be validated against it.
// Set "validateAgainstList": true to restrict to only listed students.
let classList = null;
try {
    classList = JSON.parse(fs.readFileSync(path.join(__dirname, 'classlist.json'), 'utf8'));
    console.log(`📋 Class list loaded: ${classList.students.length} students`);
    if (classList.validateAgainstList) {
        console.log('🔒 Strict mode: only listed roll numbers are accepted');
    } else {
        console.log('🔓 Open mode: any roll number accepted (names auto-filled from list)');
    }
} catch (e) {
    console.log('📋 No classlist.json found — open registration mode (any roll number accepted)');
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ── allow admin dashboard from any origin (file://, localhost, etc.)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Serve static files from docs folder
app.use(express.static(path.join(__dirname, 'docs')));

const server = app.listen(PORT, () => {
    console.log(`🚀 Signaling server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
    
    // Get local IP for network testing
    const networkInterfaces = os.networkInterfaces();
    console.log('\n🌐 Available on:');
    console.log(`   http://localhost:${PORT}`);
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`   http://${iface.address}:${PORT}`);
            }
        }
    }
    console.log('');
});

const wss = new WebSocket.Server({ server });

// Store active peers
const activePeers = new Map();

// In-memory chat log for teacher dashboard
const chatLog = [];
const MAX_CHAT_LOG = 500; // keep last 500 messages

// Derive a short, human-readable label from an IP address.
// Uses the last two octets of IPv4, or last 4 hex chars for IPv6.
function ipToLabel(ip) {
    if (!ip) return 'Unknown';
    // Strip IPv6-mapped IPv4 prefix ::ffff:
    const clean = ip.replace(/^::ffff:/, '');
    const v4 = clean.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (v4) return `PC-${v4[3]}-${v4[4]}`;
    // IPv6 fallback – last 4 hex chars
    return 'PC-' + clean.replace(/[^0-9a-fA-F]/g, '').slice(-4).toUpperCase();
}

wss.on('connection', (ws, req) => {
    let peerId = null;
    let peerName = null;
    let peerRollNumber = null;
    const clientIp = req.socket.remoteAddress;
    
    console.log(`🔌 New connection from ${clientIp}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'register': {
                    peerId = data.peerId;
                    const rollNumber = (data.rollNumber || '').trim().toUpperCase();
                    const deviceId = data.deviceId || 'unknown';

                    // ── Validate roll number ──
                    if (!rollNumber) {
                        ws.send(JSON.stringify({
                            type: 'register_error',
                            message: 'Roll number is required. Please enter your roll number.'
                        }));
                        break;
                    }

                    // ── Check for duplicate roll number ──
                    let duplicateFound = false;
                    for (const [existingId, existingPeer] of activePeers.entries()) {
                        if (existingPeer.rollNumber === rollNumber && existingId !== peerId) {
                            ws.send(JSON.stringify({
                                type: 'register_error',
                                message: `Roll number ${rollNumber} is already in use by another student on this server.`
                            }));
                            duplicateFound = true;
                            break;
                        }
                    }
                    if (duplicateFound) break;

                    // ── Validate against class list if strict mode ──
                    let studentName = null;
                    if (classList && classList.students) {
                        const student = classList.students.find(
                            s => s.rollNo.toUpperCase() === rollNumber
                        );
                        if (classList.validateAgainstList && !student) {
                            ws.send(JSON.stringify({
                                type: 'register_error',
                                message: `Roll number ${rollNumber} is not in the class list. Contact your teacher.`
                            }));
                            break;
                        }
                        if (student) studentName = student.name;
                    }

                    // ── Assign display name from roll number + class list ──
                    peerRollNumber = rollNumber;
                    peerName = studentName
                        ? `${rollNumber} (${studentName})`
                        : rollNumber;

                    activePeers.set(peerId, {
                        ws,
                        name: peerName,
                        rollNumber: rollNumber,
                        ip: clientIp,
                        deviceId,
                        room: data.room || 'default',
                        connectedAt: Date.now()
                    });

                    console.log(`✅ Registered: ${peerName} | Roll: ${rollNumber} | IP: ${clientIp} | Device: ${deviceId} | Total: ${activePeers.size}`);

                    // Send list of other active peers
                    const otherPeers = [];
                    for (const [id, peer] of activePeers.entries()) {
                        if (id !== peerId) {
                            otherPeers.push({
                                peerId: id,
                                peerName: peer.name,
                                rollNumber: peer.rollNumber,
                                ip: peer.ip,
                                deviceId: peer.deviceId,
                                connected: true
                            });
                        }
                    }

                    ws.send(JSON.stringify({
                        type: 'peer_list',
                        peers: otherPeers,
                        yourId: peerId,
                        yourName: peerName,
                        yourRollNumber: rollNumber,
                        yourIp: clientIp
                    }));

                    // Announce new peer to others
                    if (otherPeers.length > 0) {
                        broadcastToOthers(peerId, {
                            type: 'peer_joined',
                            peerId: peerId,
                            peerName: peerName,
                            rollNumber: rollNumber,
                            ip: clientIp,
                            deviceId,
                            timestamp: Date.now()
                        });
                    }
                    break;
                }
                    
                case 'webrtc_offer':
                case 'webrtc_answer':
                case 'webrtc_ice_candidate':
                    const targetPeer = activePeers.get(data.targetId);
                    if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                        targetPeer.ws.send(JSON.stringify({
                            ...data,
                            fromId: peerId,
                            fromName: peerName
                        }));
                        console.log(`📤 ${data.type} from ${peerName} → ${targetPeer.name}`);
                    } else {
                        console.log(`❌ Target not found: ${data.targetId}`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Target peer not available'
                        }));
                    }
                    break;
                    
                case 'broadcast_chat': {
                    const senderPeer = activePeers.get(peerId);
                    const chatEntry = {
                        rollNumber: peerRollNumber,
                        name: peerName,
                        ip: senderPeer ? senderPeer.ip : clientIp,
                        deviceId: senderPeer ? senderPeer.deviceId : 'unknown',
                        text: data.text || null,
                        hasImage: !!data.image,
                        timestamp: Date.now(),
                        time: new Date().toISOString()
                    };
                    chatLog.push(chatEntry);
                    if (chatLog.length > MAX_CHAT_LOG) chatLog.shift();

                    broadcastToOthers(peerId, {
                        type: 'server_chat',
                        senderId: peerId,
                        senderName: peerName,
                        senderRollNumber: peerRollNumber,
                        senderIp: senderPeer ? senderPeer.ip : clientIp,
                        senderDeviceId: senderPeer ? senderPeer.deviceId : 'unknown',
                        text: data.text,
                        image: data.image,
                        timestamp: Date.now()
                    });
                    break;
                }
                    
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    break;
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });
    
    ws.on('close', () => {
        if (peerId) {
            console.log(`🔌 Disconnected: ${peerName || peerId} | Roll: ${peerRollNumber || '?'} | IP: ${clientIp}`);
            activePeers.delete(peerId);

            broadcastToAll({
                type: 'peer_left',
                peerId: peerId,
                peerName: peerName || 'Unknown',
                rollNumber: peerRollNumber,
                timestamp: Date.now()
            });

            console.log(`📊 Active peers: ${activePeers.size}`);
        }
    });
});

function broadcastToAll(message) {
    const messageStr = JSON.stringify(message);
    for (const [id, peer] of activePeers.entries()) {
        if (peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(messageStr);
        }
    }
}

function broadcastToOthers(senderId, message) {
    const messageStr = JSON.stringify(message);
    for (const [id, peer] of activePeers.entries()) {
        if (id !== senderId && peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(messageStr);
        }
    }
}

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activePeers: activePeers.size,
        peers: Array.from(activePeers.entries()).map(([id, p]) => ({
            id: id,
            name: p.name,
            rollNumber: p.rollNumber,
            ip: p.ip,
            deviceId: p.deviceId,
            connectedAt: p.connectedAt
        })),
        uptime: process.uptime()
    });
});

app.get('/stats', (req, res) => {
    res.json({
        totalPeers: activePeers.size,
        peers: Array.from(activePeers.entries()).map(([id, p]) => ({
            id: id,
            name: p.name,
            rollNumber: p.rollNumber,
            ip: p.ip,
            deviceId: p.deviceId
        }))
    });
});

// ────────────────────────────────────────────────────────────────────────────────
// FACULTY ADMIN API  (no auth in dev — add a middleware in production)
// ────────────────────────────────────────────────────────────────────────────────

// GET /admin/students — live list of connected students
app.get('/admin/students', (req, res) => {
    res.json({
        total: activePeers.size,
        students: Array.from(activePeers.values()).map(p => ({
            rollNumber: p.rollNumber,
            name: p.name,
            ip: p.ip,
            deviceId: p.deviceId,
            connectedAt: new Date(p.connectedAt).toISOString()
        }))
    });
});

// GET /admin/chats — all messages logged since server start
app.get('/admin/chats', (req, res) => {
    res.json({
        total: chatLog.length,
        messages: chatLog
    });
});

// GET /admin/classlist — current class list
app.get('/admin/classlist', (req, res) => {
    res.json(classList || { students: [], validateAgainstList: false });
});

// POST /admin/upload-classlist — upload CSV or JSON to update class list live
// CSV format: rollNo,name  (first row can be header)
app.post('/admin/upload-classlist', (req, res) => {
    try {
        const { csv, validateAgainstList } = req.body;
        if (!csv) return res.status(400).json({ error: 'No csv field in body' });

        const HEADER_VARIANTS = [
            'ROLLNO','ROLL NO','ROLL_NO','ROLL NUMBER','ROLLNUMBER',
            'ROLL','S.NO','SR NO','SR.NO','SNO'
        ];

        const lines = csv.trim().split(/\r?\n/);
        // Auto-detect delimiter: tab or comma
        const firstLine = lines[0] || '';
        const delimiter = firstLine.includes('\t') ? '\t' : ',';

        const students = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(delimiter).map(s => s.trim().replace(/^"|"$/g, ''));
            if (!parts[0]) continue;
            const rollNo = parts[0].toUpperCase().trim();
            // Skip header row
            if (HEADER_VARIANTS.includes(rollNo)) continue;
            const name = parts[1] || '';
            students.push({ rollNo, name });
        }

        classList = {
            validateAgainstList: validateAgainstList === true || validateAgainstList === 'true',
            students
        };

        // Persist to classlist.json
        fs.writeFileSync(path.join(__dirname, 'classlist.json'), JSON.stringify(classList, null, 2));
        console.log(`📋 Class list updated: ${students.length} students | strict=${classList.validateAgainstList}`);

        res.json({ success: true, count: students.length, students });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

console.log('✅ Server ready for cross-device testing!');
console.log('💡 Connect from your phone using the local IP address\n');
