const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (optional - for hosting the client)
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
    console.log(`🚀 Signaling server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`💾 Database: NONE - all data stored in memory only`);
});

const wss = new WebSocket.Server({ server });

// In-memory storage (cleared on server restart)
const activePeers = new Map(); // peerId -> { ws, name, room, connectedAt }

// Optional: Clean up stale connections every 5 minutes
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [peerId, peer] of activePeers.entries()) {
        if (peer.ws.readyState !== WebSocket.OPEN) {
            activePeers.delete(peerId);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} stale connections`);
    }
}, 300000); // 5 minutes

wss.on('connection', (ws, req) => {
    let peerId = null;
    let peerName = null;
    const ip = req.socket.remoteAddress;
    
    console.log(`🔌 New connection from ${ip}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'register':
                    // Store peer in memory (no database!)
                    peerId = data.peerId;
                    peerName = data.peerName;
                    
                    activePeers.set(peerId, {
                        ws,
                        name: peerName,
                        room: data.room || 'default',
                        connectedAt: Date.now(),
                        ip
                    });
                    
                    console.log(`✅ Registered: ${peerName} (${peerId}) - Total active: ${activePeers.size}`);
                    
                    // Send list of other active peers (from memory)
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
                        yourId: peerId
                    }));
                    
                    // Announce new peer to everyone else
                    broadcastToOthers(peerId, {
                        type: 'peer_joined',
                        peerId: peerId,
                        peerName: peerName,
                        timestamp: Date.now()
                    });
                    break;
                    
                case 'webrtc_offer':
                case 'webrtc_answer':
                case 'webrtc_ice_candidate':
                    // Forward signaling data to target peer (in-memory lookup)
                    const targetPeer = activePeers.get(data.targetId);
                    if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                        targetPeer.ws.send(JSON.stringify({
                            ...data,
                            fromId: peerId,
                            fromName: peerName,
                            timestamp: Date.now()
                        }));
                        console.log(`📤 Forwarded ${data.type} from ${peerName} to ${data.targetId}`);
                    } else {
                        console.log(`❌ Target ${data.targetId} not found or disconnected`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Target peer is not available'
                        }));
                    }
                    break;
                    
                case 'ping':
                    // Simple keep-alive
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    break;
                    
                default:
                    console.log(`⚠️ Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        if (peerId) {
            console.log(`🔌 Disconnected: ${peerName || peerId} (${ip})`);
            activePeers.delete(peerId);
            
            // Notify others (from memory)
            broadcastToAll({
                type: 'peer_left',
                peerId: peerId,
                peerName: peerName || 'Unknown',
                timestamp: Date.now()
            });
            
            console.log(`📊 Active peers remaining: ${activePeers.size}`);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Helper: Broadcast to all connected peers
function broadcastToAll(message) {
    const messageStr = JSON.stringify(message);
    let sent = 0;
    for (const [id, peer] of activePeers.entries()) {
        if (peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(messageStr);
            sent++;
        }
    }
    if (sent > 0) {
        console.log(`📢 Broadcasted to ${sent} peers`);
    }
}

// Helper: Broadcast to all except sender
function broadcastToOthers(senderId, message) {
    const messageStr = JSON.stringify(message);
    let sent = 0;
    for (const [id, peer] of activePeers.entries()) {
        if (id !== senderId && peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(messageStr);
            sent++;
        }
    }
    if (sent > 0) {
        console.log(`📢 Broadcasted to ${sent} peers (excluding sender)`);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        activePeers: activePeers.size,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: 'none (in-memory only)'
    });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    const peers = [];
    for (const [id, peer] of activePeers.entries()) {
        peers.push({
            peerId: id,
            peerName: peer.name,
            connectedAt: peer.connectedAt,
            ip: peer.ip
        });
    }
    res.json({
        totalPeers: activePeers.size,
        peers: peers,
        databaseRequired: false
    });
});

console.log('✅ Server ready - No database needed!');
console.log('💡 All peer data is stored in RAM and cleared on restart');
