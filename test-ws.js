const WebSocket = require('ws');

const ws = new WebSocket('wss://expressjs-webrtc-signaling-server.onrender.com');

ws.on('open', () => {
    console.log('Connected to Render Server');
    ws.send(JSON.stringify({
        type: 'register',
        peerId: 'test_peer',
        peerName: 'Test Peer'
    }));
    
    setTimeout(() => {
        ws.send(JSON.stringify({
            type: 'broadcast_chat',
            text: 'Hello from tester!'
        }));
        console.log('Sent message');
    }, 1000);
});

ws.on('message', (data) => {
    console.log('Received:', data.toString());
});

ws.on('error', (err) => {
    console.error('WS Error:', err);
});
