const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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

wss.on('connection', (ws, req) => {
    let peerId = null;
    let peerName = null;
    const clientIp = req.socket.remoteAddress;
    
    console.log(`🔌 New connection from ${clientIp}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'register':
                    peerId = data.peerId;
                    peerName = data.peerName;
                    
                    activePeers.set(peerId, {
                        ws,
                        name: peerName,
                        ip: clientIp,
                        room: data.room || 'default',
                        connectedAt: Date.now()
                    });
                    
                    console.log(`✅ Registered: ${peerName} (${peerId}) - Total: ${activePeers.size}`);
                    
                    // Send list of other active peers
                    const otherPeers = [];
                    for (const [id, peer] of activePeers.entries()) {
                        if (id !== peerId) {
                            otherPeers.push({
                                peerId: id,
                                peerName: peer.name,
                                connected: true
                            });
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'peer_list',
                        peers: otherPeers,
                        yourId: peerId,
                        yourName: peerName
                    }));
                    
                    // Announce new peer to others
                    if (otherPeers.length > 0) {
                        broadcastToOthers(peerId, {
                            type: 'peer_joined',
                            peerId: peerId,
                            peerName: peerName,
                            timestamp: Date.now()
                        });
                    }
                    break;
                    
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
            console.log(`🔌 Disconnected: ${peerName || peerId} (${clientIp})`);
            activePeers.delete(peerId);
            
            broadcastToAll({
                type: 'peer_left',
                peerId: peerId,
                peerName: peerName || 'Unknown',
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
            ip: p.ip,
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
            ip: p.ip
        }))
    });
});

console.log('✅ Server ready for cross-device testing!');
console.log('💡 Connect from your phone using the local IP address\n');
