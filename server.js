const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files if needed (optional)
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = app.listen(PORT, () => {
    console.log(`✅ Signaling server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT} or wss://your-domain.onrender.com`);
});

// WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected peers
const peers = new Map(); // peerId -> { ws, name, room }

wss.on('connection', (ws) => {
    let peerId = null;
    let peerName = null;
    
    console.log('🔌 New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`📨 Received: ${data.type} from ${peerId || 'new'}`);
            
            switch(data.type) {
                case 'register':
                    // Register peer with unique ID and name
                    peerId = data.peerId;
                    peerName = data.peerName;
                    peers.set(peerId, { ws, name: peerName, room: data.room || 'default' });
                    
                    // Send list of all other peers to the new client
                    const peerList = Array.from(peers.entries())
                        .filter(([id]) => id !== peerId)
                        .map(([id, peer]) => ({
                            peerId: id,
                            peerName: peer.name,
                            connected: true
                        }));
                    
                    ws.send(JSON.stringify({
                        type: 'peer_list',
                        peers: peerList
                    }));
                    
                    // Notify all other peers about the new peer
                    broadcastToOthers(peerId, {
                        type: 'peer_joined',
                        peerId: peerId,
                        peerName: peerName
                    });
                    
                    console.log(`✅ Peer registered: ${peerName} (${peerId})`);
                    break;
                    
                case 'webrtc_offer':
                case 'webrtc_answer':
                case 'webrtc_ice_candidate':
                    // Forward WebRTC signaling to target peer
                    const targetPeer = peers.get(data.targetId);
                    if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                        targetPeer.ws.send(JSON.stringify({
                            ...data,
                            fromId: peerId,
                            fromName: peerName
                        }));
                        console.log(`📤 Forwarded ${data.type} from ${peerName} to ${data.targetId}`);
                    } else {
                        console.log(`❌ Target peer ${data.targetId} not found or disconnected`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Target peer not available'
                        }));
                    }
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
            console.log(`🔌 Peer disconnected: ${peerName} (${peerId})`);
            peers.delete(peerId);
            
            // Notify all other peers about disconnection
            broadcastToAll({
                type: 'peer_left',
                peerId: peerId,
                peerName: peerName
            });
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Helper function to broadcast to all connected peers
function broadcastToAll(message) {
    const messageStr = JSON.stringify(message);
    peers.forEach((peer) => {
        if (peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(messageStr);
        }
    });
}

// Helper function to broadcast to all except sender
function broadcastToOthers(senderId, message) {
    const messageStr = JSON.stringify(message);
    peers.forEach((peer, id) => {
        if (id !== senderId && peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(messageStr);
        }
    });
}

console.log('🚀 Signaling server ready!');