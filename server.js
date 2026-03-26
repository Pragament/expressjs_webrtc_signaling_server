const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
    console.log(`🚀 Signaling server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

// Store active peers with unique keys
const activePeers = new Map(); // peerId -> { ws, name, room }

// Prevent duplicate connections from same browser instance
const sessionIds = new Map(); // ip + userAgent -> peerId

wss.on('connection', (ws, req) => {
    let peerId = null;
    let peerName = null;
    let sessionKey = null;
    
    console.log(`🔌 New connection from ${req.socket.remoteAddress}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'register':
                    // Create a session key to prevent duplicates
                    sessionKey = `${req.socket.remoteAddress}_${data.peerName}`;
                    
                    // Remove any existing connection with same session
                    if (sessionIds.has(sessionKey)) {
                        const oldPeerId = sessionIds.get(sessionKey);
                        if (activePeers.has(oldPeerId)) {
                            console.log(`Removing duplicate session for ${data.peerName}`);
                            const oldPeer = activePeers.get(oldPeerId);
                            if (oldPeer.ws.readyState === WebSocket.OPEN) {
                                oldPeer.ws.close();
                            }
                            activePeers.delete(oldPeerId);
                        }
                    }
                    
                    peerId = data.peerId;
                    peerName = data.peerName;
                    
                    // Store peer
                    activePeers.set(peerId, {
                        ws,
                        name: peerName,
                        room: data.room || 'default',
                        connectedAt: Date.now()
                    });
                    sessionIds.set(sessionKey, peerId);
                    
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
                        yourId: peerId
                    }));
                    
                    // Announce new peer to others (only if not reconnecting)
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
                    // Forward to target peer
                    const targetPeer = activePeers.get(data.targetId);
                    if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                        targetPeer.ws.send(JSON.stringify({
                            ...data,
                            fromId: peerId,
                            fromName: peerName
                        }));
                        console.log(`📤 Forwarded ${data.type} from ${peerName} to ${data.targetId}`);
                    } else {
                        console.log(`❌ Target ${data.targetId} not found`);
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
            console.error('Error processing message:', error);
        }
    });
    
    ws.on('close', () => {
        if (peerId) {
            console.log(`🔌 Disconnected: ${peerName || peerId}`);
            activePeers.delete(peerId);
            if (sessionKey) sessionIds.delete(sessionKey);
            
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
        uptime: process.uptime()
    });
});

console.log('✅ Server ready');
