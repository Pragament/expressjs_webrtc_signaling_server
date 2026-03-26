# expressjs_webrtc_signaling_server

# Check health (no database needed)
curl https://expressjs-webrtc-signaling-server.onrender.com/health

# Response:
{
  "status": "healthy",
  "activePeers": 0,
  "uptime": 120.5,
  "memory": { "rss": 50000000, ... },
  "database": "none (in-memory only)"
}

# Check active peers
curl https://expressjs-webrtc-signaling-server.onrender.com/stats

# Response:
{
  "totalPeers": 0,
  "peers": [],
  "databaseRequired": false
}
