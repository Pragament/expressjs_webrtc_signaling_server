
    (function() {
        // DOM Elements
        const elements = {
            peerListDiv: document.getElementById('peerList'),
            messagesDiv: document.getElementById('messages'),
            fileInput: document.getElementById('fileInput'),
            attachmentBtn: document.getElementById('attachmentBtn'),
            messageInput: document.getElementById('messageInput'),
            sendBtn: document.getElementById('sendBtn'),
            nameInput: document.getElementById('nameInput'),
            serverUrlInput: document.getElementById('serverUrl'),
            connectBtn: document.getElementById('connectBtn'),
            resetBtn: document.getElementById('resetBtn'),
            connectionStatus: document.getElementById('connectionStatus'),
            peerCountSpan: document.getElementById('peerCount'),
            connectedCountSpan: document.getElementById('connectedCount'),
            debugPanel: document.getElementById('debugPanel'),
            settingsModal: document.getElementById('settingsModal'),
            settingsBtn: document.getElementById('settingsBtn'),
            closeSettingsBtn: document.getElementById('closeSettingsBtn'),
            syncUrl: document.getElementById('syncSupabaseUrl'),
            syncKey: document.getElementById('syncSupabaseKey'),
            syncTable: document.getElementById('syncTableName'),
            btnTestSync: document.getElementById('btnTestSync'),
            btnPushSync: document.getElementById('btnPushSync'),
            btnPullSync: document.getElementById('btnPullSync'),
            headerUserInfo: document.getElementById('headerUserInfo'),
            headerClassCode: document.getElementById('headerClassCode'),
            headerRollNumber: document.getElementById('headerRollNumber'),
            logoutBtn: document.getElementById('logoutBtn')
        };
        
        // ----- Persistent Device Fingerprint -----
        // Generated once, stored in localStorage. Students cannot change this via UI.
        function getOrCreateDeviceId() {
            let id = localStorage.getItem('deviceFingerprint');
            if (!id) {
                // Generate a UUID-style fingerprint
                id = 'dev_' + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
                );
                localStorage.setItem('deviceFingerprint', id);
            }
            return id;
        }
        const DEVICE_ID = getOrCreateDeviceId();
        // ------------------------------------------

        const SUPABASE_CLOUD_URL = 'https://wmlgywjigexyrgpjlztf.supabase.co';
        const SUPABASE_CLOUD_KEY = 'sb_publishable_hk6pKPo2ujDHCYvylvbY0g_P6B1v_PN';
        let supabase = null;

        function initSupabase() {
            const env = localStorage.getItem('supabaseEnv') || 'cloud';
            if (env === 'intranet') {
                const url = localStorage.getItem('intranetSupabaseUrl');
                const key = localStorage.getItem('intranetSupabaseKey');
                if (url && key) {
                    supabase = window.supabase.createClient(url, key);
                    log('Initialized Intranet Supabase');
                    return;
                } else {
                    log('Intranet Supabase config missing, falling back to Cloud', 'warn');
                }
            }
            supabase = window.supabase.createClient(SUPABASE_CLOUD_URL, SUPABASE_CLOUD_KEY);
            log('Initialized Supabase Cloud');
        }
        initSupabase();
        
        // Push Notification Constants
        const VAPID_PUBLIC_KEY = 'BHDhlUW-sgIDXRM0eqkkfu3DaEFWK9eD5531ZYMmTd5iWVh57Yoig6Ba-qb4VP_r1e8CEqQV1HS6aB-Z1ARcPFE';
        
        let ws = null;
        let localPeerId = null;
        // Name & roll number are assigned by the server after registration
        let localPeerName = '…connecting';
        let localRollNumber = sessionStorage.getItem('rollNumber') || '';  // survives page refresh within tab
        let localClassCode = sessionStorage.getItem('classCode') || '';    // survives page refresh
        let localIp = '?'; // filled in by server after register
        let isRegistered = false;  // true once server accepts our roll number

        // Login overlay elements
        const loginOverlay = document.getElementById('loginOverlay');
        const loginClassCodeInput = document.getElementById('loginClassCode');
        const loginRollInput = document.getElementById('loginRollNumber');
        const loginServerInput = document.getElementById('loginServerUrl');
        const loginError = document.getElementById('loginError');
        const loginJoinBtn = document.getElementById('loginJoinBtn');
        
        // Smart Default URL
        let defaultServerUrl = 'wss://expressjs-webrtc-signaling-server.onrender.com';
        if (window.location.protocol !== 'file:') {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            defaultServerUrl = `${wsProtocol}//${window.location.host}`;
        } else {
            defaultServerUrl = 'ws://localhost:3000';
        }
        
        let peers = new Map();
        let connections = new Map();
        let negotiatingPeers = new Set();
        let logs = [];
        let chatHistory = [];
        
        // Initialize - name is shown but fully locked (server-assigned from roll number)
        elements.nameInput.value = 'Not registered';
        elements.nameInput.setAttribute('title', 'Your identity is assigned by the server based on your roll number + IP address.');
        log('🔒 Roll number login required before chatting.');

        elements.serverUrlInput.value = defaultServerUrl;
        loginServerInput.value = defaultServerUrl;

        // Pre-fill roll number and class code if returning within same tab
        if (localRollNumber) loginRollInput.value = localRollNumber;
        if (localClassCode) loginClassCodeInput.value = localClassCode;

        // Header logout button
        elements.logoutBtn.onclick = () => {
            sessionStorage.removeItem('rollNumber');
            sessionStorage.removeItem('classCode');
            localRollNumber = '';
            localClassCode = '';
            isRegistered = false;
            
            // UI Reset
            elements.headerUserInfo.style.display = 'none';
            elements.logoutBtn.style.display = 'none';
            elements.nameInput.value = 'Not registered';
            elements.messageInput.disabled = true;
            elements.sendBtn.disabled = true;
            elements.attachmentBtn.disabled = true;
            
            // Show overlay
            loginOverlay.style.display = 'flex';
            loginOverlay.style.opacity = '1';
            
            // Disconnect WS
            if (ws) {
                try { ws.close(); } catch(e) {}
            }
        };

        // Supabase Env Select
        const supabaseEnvSelect = document.getElementById('supabaseEnv');
        const intranetConfigFields = document.getElementById('intranetConfigFields');
        
        supabaseEnvSelect.value = localStorage.getItem('supabaseEnv') || 'cloud';
        intranetConfigFields.style.display = supabaseEnvSelect.value === 'intranet' ? 'block' : 'none';
        
        supabaseEnvSelect.onchange = (e) => {
            const val = e.target.value;
            localStorage.setItem('supabaseEnv', val);
            intranetConfigFields.style.display = val === 'intranet' ? 'block' : 'none';
            if (val === 'cloud') {
                initSupabase(); // re-init immediately if switching to cloud
            }
        };
        
        document.getElementById('intranetSupabaseUrl').value = localStorage.getItem('intranetSupabaseUrl') || '';
        document.getElementById('intranetSupabaseKey').value = localStorage.getItem('intranetSupabaseKey') || '';
        
        document.getElementById('saveSupabaseConfigBtn').onclick = () => {
            localStorage.setItem('intranetSupabaseUrl', document.getElementById('intranetSupabaseUrl').value);
            localStorage.setItem('intranetSupabaseKey', document.getElementById('intranetSupabaseKey').value);
            initSupabase();
            alert('Intranet Supabase configuration saved!');
        };
        
        function log(msg, type = 'info') {
            const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            const entry = { ts: timestamp, msg, type };
            logs.unshift(entry);
            if (logs.length > 50) logs.pop();
            renderDebugLog();
            console.log(msg);
        }

        function renderDebugLog() {
            const dcLog = document.getElementById('dcLog');
            if (!dcLog) return;
            dcLog.innerHTML = logs.map(e =>
                `<div class="log-line ${e.type}">[${e.ts}] ${escHtml(e.msg)}</div>`
            ).join('');
            dcLog.scrollTop = 0;
        }

        function escHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
        
        function setStatus(text, isConnected = false) {
            elements.connectionStatus.textContent = text;
            if (isConnected) {
                elements.connectionStatus.className = 'connection-status connected';
            } else {
                elements.connectionStatus.className = 'connection-status';
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function addSystemMessage(text) {
            if (elements.messagesDiv.children.length === 1 && 
                elements.messagesDiv.children[0].innerText.includes('Send a message')) {
                elements.messagesDiv.innerHTML = '';
            }
            const sysDiv = document.createElement('div');
            sysDiv.className = 'system-message';
            sysDiv.innerHTML = `<span>${escapeHtml(text)}</span>`;
            elements.messagesDiv.appendChild(sysDiv);
            elements.messagesDiv.scrollTop = elements.messagesDiv.scrollHeight;
        }
        
        function addMessage(sender, text, isSelf, imageUrl = null, skipSave = false, senderIp = null, senderDeviceId = null, senderRollNumber = null) {
            if (!skipSave) {
                chatHistory.push({
                    id: Date.now() + Math.floor(Math.random() * 10000),
                    Sender: sender,
                    roll_number: senderRollNumber || (isSelf ? localRollNumber : null),
                    sender_ip: senderIp || (isSelf ? localIp : null),
                    device_id: senderDeviceId || (isSelf ? DEVICE_ID : null),
                    text: text || '',
                    image: imageUrl || null,
                    created_at: new Date().toISOString()
                });
            }

            if (elements.messagesDiv.children.length === 1 && 
                elements.messagesDiv.children[0].innerText.includes('Send a message')) {
                elements.messagesDiv.innerHTML = '';
            }
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSelf ? 'self' : ''}`;
            
            let contentHtml = '';
            if (imageUrl) {
                contentHtml += `<img src="${imageUrl}" class="message-image" onclick="window.open(this.src)">`;
            }
            if (text) {
                contentHtml += `<div class="message-text">${escapeHtml(text)}</div>`;
            }

            let senderLabel;
            if (isSelf) {
                // Self: show own roll number prominently
                senderLabel = `<span style="font-weight:700;color:#4f46e5;">You</span> <span style="font-size:0.75rem;color:#818cf8;font-weight:700;font-family:monospace;">${escapeHtml(localRollNumber || '?')}</span>`;
                if (localIp && localIp !== '?') senderLabel += ` <span style="font-size:0.6rem;color:#c7d2fe;font-family:monospace;">[${escapeHtml(localIp)}]</span>`;
            } else {
                // Remote: roll number is THE primary identifier
                const roll = senderRollNumber || '';
                const name = sender || '';
                if (roll) {
                    senderLabel = `<span style="font-weight:800;color:#059669;font-family:monospace;font-size:0.85rem;">${escapeHtml(roll)}</span>`;
                    // Show student name if server provided one that differs from roll number
                    if (name && name !== roll && !name.startsWith(roll)) {
                        senderLabel += ` <span style="font-size:0.75rem;color:#6b7280;">(${escapeHtml(name)})</span>`;
                    } else if (name && name.startsWith(roll) && name.length > roll.length) {
                        // Name is like "21CS001 (Rahul Kumar)" — extract the part after roll number
                        const extra = name.slice(roll.length).trim();
                        if (extra) senderLabel += ` <span style="font-size:0.75rem;color:#6b7280;">${escapeHtml(extra)}</span>`;
                    }
                } else {
                    senderLabel = `<span style="font-weight:700;color:#059669;">${escapeHtml(name)}</span>`;
                }
                if (senderIp && senderIp !== '?') {
                    senderLabel += ` <span style="font-size:0.6rem;color:#9ca3af;font-family:monospace;">[${escapeHtml(senderIp)}]</span>`;
                }
            }
            
            msgDiv.innerHTML = `
                <div class="message-bubble">
                    <div class="message-sender">${senderLabel}</div>
                    ${contentHtml}
                </div>
            `;
            elements.messagesDiv.appendChild(msgDiv);
            elements.messagesDiv.scrollTop = elements.messagesDiv.scrollHeight;
        }
        
        function renderPeers() {
            const peersArray = Array.from(peers.entries());
            const connectedCount = Array.from(peers.values()).filter(p => p.status === 'connected').length;
            const isServerConnected = ws && ws.readyState === WebSocket.OPEN;
            const totalOnline = isServerConnected ? peersArray.length + 1 : 0;

            if (elements.peerCountSpan) {
                elements.peerCountSpan.textContent = `${totalOnline} Online`;
            }
            if (elements.connectedCountSpan) {
                elements.connectedCountSpan.textContent = `${connectedCount}/${peersArray.length} connected`;
            }

            if (peersArray.length === 0) {
                elements.peerListDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #9ca3af;">No other peers online</div>';
            } else {
                elements.peerListDiv.innerHTML = peersArray.map(([id, peer]) => `
                    <div class="peer-item ${peer.status}">
                        <div class="peer-name">${escapeHtml(peer.name)}</div>
                        <div class="peer-status ${peer.status}">
                            ${peer.status === 'connected' ? '● Connected' : '○ Connecting...'}
                        </div>
                    </div>
                `).join('');
            }

            // Update debug console
            renderDebugConsole();
        }

        function renderDebugConsole() {
            const peersArray = Array.from(peers.entries());
            const connectedCount = Array.from(peers.values()).filter(p => p.status === 'connected').length;
            const isServerConnected = ws && ws.readyState === WebSocket.OPEN;
            const wifiCount = isServerConnected ? peersArray.length : 0; // peers on same server = same WiFi room
            const readyCount = Array.from(connections.values()).filter(c => c.dc && c.dc.readyState === 'open').length;

            // Stats chips
            const dcWifi = document.getElementById('dcWifiCount');
            const dcReady = document.getElementById('dcReadyCount');
            const dcConn = document.getElementById('dcConnectedCount');
            if (dcWifi) dcWifi.innerHTML = `<span class="dot"></span>${wifiCount} on same WiFi`;
            if (dcReady) dcReady.innerHTML = `<span class="dot"></span>${readyCount} ready`;
            if (dcConn) dcConn.innerHTML = `<span class="dot"></span>${connectedCount} connected`;

            // Offer All button count
            const offerAllBtn = document.getElementById('dcOfferAllBtn');
            const notConnected = peersArray.filter(([id, p]) => !connections.has(id) || (connections.get(id).dc && connections.get(id).dc.readyState !== 'open')).length;
            if (offerAllBtn) offerAllBtn.textContent = `⚡ Offer All (${notConnected})`;

            // Per-peer rows
            const dcPeerRows = document.getElementById('dcPeerRows');
            if (!dcPeerRows) return;

            if (peersArray.length === 0) {
                dcPeerRows.innerHTML = '<div style="color:#565f89;font-size:0.65rem;font-family:monospace;padding:4px;">No peers discovered</div>';
                return;
            }

            dcPeerRows.innerHTML = peersArray.map(([id, peer]) => {
                const conn = connections.get(id);
                const isOpen = conn && conn.dc && conn.dc.readyState === 'open';
                const isNegotiating = negotiatingPeers.has(id);
                const statusLabel = isOpen ? 'connected' : isNegotiating ? 'connecting' : 'disconnected';
                const btnLabel = isNegotiating ? 'Connecting...' : isOpen ? 'Connected ✓' : 'Connect';
                const btnDisabled = (isOpen || isNegotiating) ? 'disabled' : '';
                return `<div class="dc-peer-row">
                    <span class="dc-peer-name" title="${escHtml(id)}">👤 ${escHtml(peer.name)}</span>
                    <span class="dc-peer-badge ${statusLabel}">${statusLabel}</span>
                    <button class="dc-connect-btn" ${btnDisabled}
                        onclick="window._dcConnect('${escHtml(id)}', '${escHtml(peer.name)}')"
                    >${btnLabel}</button>
                </div>`;
            }).join('');
        }
        
        function cleanupPeer(peerId) {
            negotiatingPeers.delete(peerId);
            const conn = connections.get(peerId);
            if (conn) {
                if (conn.pc) {
                    try { conn.pc.close(); } catch(e) {}
                }
                connections.delete(peerId);
            }
            if (peers.has(peerId)) {
                peers.delete(peerId);
                renderPeers();
            }
        }
        
        // WebRTC Functions with fixed negotiation
        async function initiateConnection(peerId, peerName) {
            // Prevent multiple simultaneous negotiations with the same peer
            if (negotiatingPeers.has(peerId)) {
                log(`Already negotiating with ${peerName}`);
                return;
            }
            
            if (connections.has(peerId)) {
                log(`Already connected to ${peerName}`);
                return;
            }
            
            negotiatingPeers.add(peerId);
            log(`🔌 Initiating connection to ${peerName}...`);
            
            try {
                const pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' }
                    ]
                });
                
                // Only the offerer creates a data channel
                const dc = pc.createDataChannel('chat');
                connections.set(peerId, { pc, dc, name: peerName, role: 'initiator' });
                
                dc.onopen = () => {
                    log(`✅ Data channel OPEN with ${peerName}`);
                    if (peers.has(peerId)) {
                        peers.get(peerId).status = 'connected';
                        renderPeers();
                        addSystemMessage(`✅ Connected to ${peerName}`);
                    }
                };
                
                dc.onclose = () => {
                    log(`❌ Data channel CLOSED with ${peerName}`);
                    if (peers.has(peerId)) {
                        peers.get(peerId).status = 'disconnected';
                        renderPeers();
                    }
                };
                
                dc.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg.type === 'chat') {
                            addMessage(msg.sender, msg.text, msg.senderId === localPeerId, msg.image, false, msg.senderIp, msg.senderDeviceId, msg.senderRollNumber);
                        }
                    } catch (err) {}
                };
                
                pc.onicecandidate = (e) => {
                    if (e.candidate && ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'webrtc_ice_candidate',
                            targetId: peerId,
                            candidate: e.candidate
                        }));
                    }
                };
                
                pc.oniceconnectionstatechange = () => {
                    log(`ICE state with ${peerName}: ${pc.iceConnectionState}`);
                    if (pc.iceConnectionState === 'connected') {
                        log(`🎉 ICE CONNECTED to ${peerName}!`);
                        negotiatingPeers.delete(peerId);
                    } else if (pc.iceConnectionState === 'failed') {
                        log(`❌ ICE FAILED with ${peerName}`, 'error');
                        log(`   Tip: Make sure both devices are on the same network`, 'warn');
                        cleanupPeer(peerId);
                    }
                };
                
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'webrtc_offer',
                        targetId: peerId,
                        sdp: pc.localDescription
                    }));
                    log(`📤 Offer sent to ${peerName}`);
                }
                
                // Timeout
                setTimeout(() => {
                    const conn = connections.get(peerId);
                    if (conn && conn.dc && conn.dc.readyState !== 'open') {
                        log(`⏰ Connection timeout for ${peerName}`, 'warn');
                        cleanupPeer(peerId);
                    }
                    negotiatingPeers.delete(peerId);
                }, 20000);
                
            } catch (err) {
                log(`Connection error: ${err.message}`, 'error');
                cleanupPeer(peerId);
            }
        }
        
        async function handleOffer(fromId, fromName, sdp) {
            // If we're already negotiating or connected, ignore
            if (connections.has(fromId)) {
                log(`Already have connection to ${fromName}, ignoring offer`);
                return;
            }
            
            log(`📞 Handling offer from ${fromName}...`);
            
            try {
                const pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                });
                
                let dc = null;
                
                pc.ondatachannel = (e) => {
                    dc = e.channel;
                    log(`📡 Data channel received from ${fromName}`);
                    connections.set(fromId, { pc, dc, name: fromName, role: 'receiver' });
                    
                    dc.onopen = () => {
                        log(`✅ Data channel OPEN with ${fromName}`);
                        if (peers.has(fromId)) {
                            peers.get(fromId).status = 'connected';
                            renderPeers();
                            addSystemMessage(`✅ Connected to ${fromName}`);
                        }
                    };
                    
                    dc.onmessage = (e) => {
                        try {
                            const msg = JSON.parse(e.data);
                            if (msg.type === 'chat') {
                                addMessage(msg.sender, msg.text, false, msg.image, false, msg.senderIp, msg.senderDeviceId, msg.senderRollNumber);
                            }
                        } catch (err) {}
                    };
                };
                
                pc.onicecandidate = (e) => {
                    if (e.candidate && ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'webrtc_ice_candidate',
                            targetId: fromId,
                            candidate: e.candidate
                        }));
                    }
                };
                
                pc.oniceconnectionstatechange = () => {
                    log(`ICE state with ${fromName}: ${pc.iceConnectionState}`);
                    if (pc.iceConnectionState === 'connected') {
                        log(`🎉 ICE CONNECTED to ${fromName}!`);
                    } else if (pc.iceConnectionState === 'failed') {
                        log(`❌ ICE FAILED with ${fromName}`, 'error');
                        cleanupPeer(fromId);
                    }
                };
                
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'webrtc_answer',
                        targetId: fromId,
                        sdp: pc.localDescription
                    }));
                    log(`📤 Answer sent to ${fromName}`);
                }
                
            } catch (err) {
                log(`Offer handling error: ${err.message}`, 'error');
                cleanupPeer(fromId);
            }
        }
        
        async function handleAnswer(fromId, sdp) {
            const conn = connections.get(fromId);
            if (conn && conn.pc && conn.role === 'initiator' && !conn.pc.remoteDescription) {
                try {
                    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    log(`✅ Remote description set for ${conn.name}`);
                    
                    // Add queued candidates
                    if (conn.queuedCandidates) {
                        for (const candidate of conn.queuedCandidates) {
                            try { await conn.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
                        }
                        conn.queuedCandidates = [];
                    }
                } catch (err) {
                    log(`Answer error: ${err.message}`, 'error');
                }
            }
        }
        
        async function handleIceCandidate(fromId, candidate) {
            const conn = connections.get(fromId);
            if (conn && conn.pc) {
                if (conn.pc.remoteDescription) {
                    try {
                        await conn.pc.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (err) {
                        // Ignore candidate errors
                    }
                } else {
                    // Queue candidate until remote description is set
                    conn.queuedCandidates = conn.queuedCandidates || [];
                    conn.queuedCandidates.push(candidate);
                }
            }
        }
        
        // WebSocket functions
        // ═══ Login Flow ═══
        function showLoginError(msg) {
            loginError.style.display = 'block';
            loginError.textContent = '❌ ' + msg;
            loginJoinBtn.disabled = false;
            loginJoinBtn.textContent = 'Join Class  →';
        }

        function hideLoginOverlay() {
            loginOverlay.style.opacity = '0';
            setTimeout(() => { loginOverlay.style.display = 'none'; }, 400);
        }

        loginJoinBtn.onclick = () => {
            const code = loginClassCodeInput.value.trim().toUpperCase();
            const roll = loginRollInput.value.trim().toUpperCase();
            if (!code) {
                showLoginError('Please enter a class code.');
                return;
            }
            if (!roll) {
                showLoginError('Please enter your roll number.');
                return;
            }
            localClassCode = code;
            localRollNumber = roll;
            sessionStorage.setItem('classCode', code);
            sessionStorage.setItem('rollNumber', roll);

            // Update internal elements Server URL to default if not set by settings
            if (!elements.serverUrlInput.value) {
                elements.serverUrlInput.value = defaultServerUrl;
            }

            loginError.style.display = 'none';
            loginJoinBtn.disabled = true;
            loginJoinBtn.textContent = 'Connecting...';
            connect();
        };

        // Allow Enter key on roll number field
        loginRollInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loginJoinBtn.click();
        });

        function connect() {
            let url = (elements.serverUrlInput && elements.serverUrlInput.value.trim()) || defaultServerUrl;
            if (!url) {
                showLoginError('Cannot determine server URL. Please refresh the page.');
                return;
            }

            localStorage.setItem('serverUrl', url);
            log(`Connecting to ${url}`);
            setStatus('Connecting...');

            if (ws) {
                try { ws.close(); } catch(e) {}
            }

            try {
                ws = new WebSocket(url);
                ws.onopen = onOpen;
                ws.onmessage = onMessage;
                ws.onerror = (e) => {
                    log(`WS Error: ${e}`, 'error');
                    if (!isRegistered) showLoginError('Connection failed. Check server URL.');
                };
                ws.onclose = onClose;
            } catch (err) {
                log(`Connection failed: ${err.message}`, 'error');
                setStatus('Failed');
                if (!isRegistered) showLoginError('Connection failed: ' + err.message);
            }
        }
        
        function reset() {
            log('🔄 Resetting all connections...');
            for (const [id, conn] of connections) {
                try { conn.pc.close(); } catch(e) {}
            }
            connections.clear();
            peers.clear();
            negotiatingPeers.clear();
            renderPeers();

            // Re-register with server using same roll number and class code
            if (ws && ws.readyState === WebSocket.OPEN && localRollNumber && localClassCode) {
                ws.send(JSON.stringify({
                    type: 'register',
                    peerId: localPeerId,
                    classCode: localClassCode,
                    rollNumber: localRollNumber,
                    deviceId: DEVICE_ID
                }));
            }
        }
        
        function onOpen() {
            log('WebSocket connected');
            setStatus('Connected', true);

            localPeerId = 'peer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

            if (!localRollNumber) {
                log('⚠️ No roll number set — waiting for login', 'warn');
                return;
            }

            log(`Registering with Class Code: ${localClassCode}, Roll: ${localRollNumber}`);

            ws.send(JSON.stringify({
                type: 'register',
                peerId: localPeerId,
                classCode: localClassCode,
                rollNumber: localRollNumber,
                deviceId: DEVICE_ID
            }));
        }
        
        function onMessage(event) {
            try {
                const data = JSON.parse(event.data);
                
                switch(data.type) {
                    case 'register_error':
                        log(`❌ Registration rejected: ${data.message}`, 'error');
                        showLoginError(data.message);
                        try { ws.close(); } catch(e) {}
                        break;

                    case 'peer_list':
                        log(`Peer list: ${data.peers.length} peers`);

                        // Registration succeeded!
                        isRegistered = true;
                        hideLoginOverlay();

                        // Enable chat UI
                        elements.messageInput.disabled = false;
                        elements.sendBtn.disabled = false;
                        elements.attachmentBtn.disabled = false;

                        if (data.yourIp) {
                            localIp = data.yourIp;
                            log(`📍 Your IP: ${localIp}`);
                        }
                        if (data.yourName) {
                            localPeerName = data.yourName;
                            elements.nameInput.value = `${localPeerName} [${localIp}]`;
                            elements.nameInput.setAttribute('title', `Class: ${localClassCode} | Roll: ${data.yourRollNumber || localRollNumber} | IP: ${localIp} | Device: ${DEVICE_ID}`);
                            
                            // Show User info in header
                            elements.headerClassCode.textContent = localClassCode;
                            elements.headerRollNumber.textContent = localRollNumber;
                            elements.headerUserInfo.style.display = 'inline-block';
                            elements.logoutBtn.style.display = 'inline-block';

                            log(`🏷️ Registered as: ${localPeerName} (IP: ${localIp}) in ${localClassCode}`);
                        }
                        // Only connect to peers with higher ID to avoid double connections
                        data.peers.forEach(peer => {
                            if (!peers.has(peer.peerId)) {
                                addPeer(peer.peerId, peer.peerName, peer.ip, peer.deviceId);
                                // Only the peer with the "higher" ID initiates to avoid race
                                if (localPeerId > peer.peerId) {
                                    setTimeout(() => initiateConnection(peer.peerId, peer.peerName), 1000);
                                } else {
                                    log(`Waiting for ${peer.peerName} to initiate connection`);
                                }
                            }
                        });
                        break;
                        
                    case 'peer_joined':
                        if (data.peerId !== localPeerId && !peers.has(data.peerId)) {
                            log(`New peer joined: ${data.peerName} (IP:${data.ip || '?'})`);
                            addPeer(data.peerId, data.peerName, data.ip, data.deviceId);
                            addSystemMessage(`${data.peerName} joined`);
                            // Only initiate if our ID is higher
                            if (localPeerId > data.peerId) {
                                setTimeout(() => initiateConnection(data.peerId, data.peerName), 1000);
                            } else {
                                log(`Waiting for ${data.peerName} to initiate connection`);
                            }
                        }
                        break;
                        
                    case 'peer_left':
                        if (peers.has(data.peerId)) {
                            const peer = peers.get(data.peerId);
                            log(`Peer left: ${peer.name}`);
                            addSystemMessage(`${peer.name} left`);
                            cleanupPeer(data.peerId);
                        }
                        break;
                        
                    case 'webrtc_offer':
                        handleOffer(data.fromId, data.fromName, data.sdp);
                        break;
                        
                    case 'webrtc_answer':
                        handleAnswer(data.fromId, data.sdp);
                        break;
                        
                    case 'webrtc_ice_candidate':
                        handleIceCandidate(data.fromId, data.candidate);
                        break;
                        
                    case 'server_chat': {
                        const existingConn = connections.get(data.senderId);
                        if (existingConn && existingConn.dc && existingConn.dc.readyState === 'open') {
                            // Already received or will receive via WebRTC
                        } else {
                            addMessage(data.senderName, data.text, false, data.image, false, data.senderIp, data.senderDeviceId, data.senderRollNumber);
                        }
                        break;
                    }
                }
            } catch (err) {
                log(`Message error: ${err.message}`, 'error');
            }
        }
        
        function addPeer(peerId, name, ip = null, deviceId = null) {
            peers.set(peerId, { name, status: 'connecting', ip, deviceId });
            renderPeers();
        }
        
        function onClose() {
            log('WebSocket disconnected', 'warn');
            setStatus('Disconnected');
            elements.messageInput.disabled = true;
            elements.sendBtn.disabled = true;
            elements.attachmentBtn.disabled = true;

            // Clean up all connections
            for (const [id, conn] of connections) {
                try { conn.pc.close(); } catch(e) {}
            }
            connections.clear();
            peers.clear();
            renderPeers();
            negotiatingPeers.clear();

            // Auto reconnect (only if we have a roll number)
            if (localRollNumber && isRegistered) {
                setTimeout(() => {
                    if (!ws || ws.readyState === WebSocket.CLOSED) {
                        log('Auto-reconnecting...');
                        connect();
                    }
                }, 5000);
            }
        }
        
        function sendChatMessage(text, imageUrl = null) {
            if (!text && !imageUrl) return;

            const message = {
                type: 'chat',
                sender: localPeerName,
                senderId: localPeerId,
                senderRollNumber: localRollNumber,
                senderIp: localIp,
                senderDeviceId: DEVICE_ID,
                text: text,
                image: imageUrl
            };

            let sent = 0;
            for (const [id, conn] of connections) {
                if (conn.dc && conn.dc.readyState === 'open') {
                    try {
                        conn.dc.send(JSON.stringify(message));
                        sent++;
                    } catch(e) {
                        log(`Failed to send to ${conn.name}`, 'warn');
                    }
                }
            }

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'broadcast_chat',
                    text: text,
                    image: imageUrl
                }));
                sent++;
            }

            if (sent > 0) {
                addMessage(localPeerName, text, true, imageUrl, false, localIp, DEVICE_ID, localRollNumber);
                log(`📤 Message sent`);
                triggerPushNotification(text, imageUrl);
            } else {
                log(`❌ No connected peers or server`, 'warn');
                addSystemMessage('No connected peers or server');
            }
        }
        
        async function triggerPushNotification(text, imageUrl) {
            try {
                await supabase.functions.invoke('send-push', {
                    body: {
                        senderName: localPeerName,
                        message: text,
                        image: imageUrl
                    }
                });
            } catch (error) {
                console.error('Error triggering push:', error);
            }
        }
        
        function sendMessage() {
            const text = elements.messageInput.value.trim();
            if (text) {
                sendChatMessage(text);
                elements.messageInput.value = '';
            }
        }
        
        function processAndSendImage(file) {
            if (!file || !file.type.startsWith('image/')) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                    sendChatMessage('', dataUrl);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
        
        function updateName() {
            // Name field is now locked — this function is disabled
            log('Name changes are disabled for accountability', 'warn');
        }
        
        // Debug console connect handler (global so inline onclick works)
        window._dcConnect = (peerId, peerName) => {
            log(`🔌 Manual connect to ${peerName}...`);
            initiateConnection(peerId, peerName);
        };

        // Debug console collapse/expand
        document.getElementById('debugConsoleToggle').onclick = () => {
            document.getElementById('debugConsole').classList.toggle('collapsed');
        };

        // Debug console action buttons
        document.getElementById('dcReconnectBtn').onclick = () => {
            log('📡 Reconnecting signaling...', 'system');
            connect();
        };

        document.getElementById('dcRetryBtn').onclick = () => {
            log('🔄 Retrying peer handshakes...', 'system');
            for (const [id, peer] of peers) {
                const conn = connections.get(id);
                const isOpen = conn && conn.dc && conn.dc.readyState === 'open';
                if (!isOpen && !negotiatingPeers.has(id)) {
                    setTimeout(() => initiateConnection(id, peer.name), 300);
                }
            }
        };

        document.getElementById('dcClearLogBtn').onclick = () => {
            logs = [];
            renderDebugLog();
            log('🗑 Log cleared', 'system');
        };

        document.getElementById('dcOfferAllBtn').onclick = () => {
            log('⚡ Offering to all non-connected peers...', 'system');
            for (const [id, peer] of peers) {
                const conn = connections.get(id);
                const isOpen = conn && conn.dc && conn.dc.readyState === 'open';
                if (!isOpen) {
                    // force-cleanup stale connection then initiate fresh
                    cleanupPeer(id);
                    peers.set(id, peer);
                    setTimeout(() => initiateConnection(id, peer.name), 400);
                }
            }
        };

        // Event listeners
        // Connect button in settings panel (for manual reconnect)
        elements.connectBtn.onclick = () => {
            // Sync server URL to login form if overlay is visible
            loginServerInput.value = elements.serverUrlInput.value;
            if (!localRollNumber) {
                // Show login overlay if no roll number
                loginOverlay.style.display = 'flex';
                loginOverlay.style.opacity = '1';
                return;
            }
            connect();
        };
        elements.sendBtn.onclick = sendMessage;
        elements.resetBtn.onclick = reset;
        elements.messageInput.onkeypress = (e) => {
            if (e.key === 'Enter') sendMessage();
        };
        elements.attachmentBtn.onclick = () => elements.fileInput.click();
        elements.fileInput.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                processAndSendImage(e.target.files[0]);
                e.target.value = ''; // Reset input
            }
        };

        // Handle image paste via keyboard controls (Ctrl+V / Cmd+V)
        document.addEventListener('paste', (e) => {
            if (elements.attachmentBtn.disabled) return; // Only allow if connected
            
            const items = (e.clipboardData || window.clipboardData).items;
            for (let index in items) {
                const item = items[index];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    if (blob) {
                        processAndSendImage(blob);
                        e.preventDefault();
                        break;
                    }
                }
            }
        });
        
        // Push Notifications Setup
        document.getElementById('enablePushBtn').onclick = async () => {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                alert('Push notifications are not supported in this browser.');
                return;
            }
            
            try {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    alert('Permission not granted for notifications.');
                    return;
                }
                
                const registration = await navigator.serviceWorker.register('./sw.js');
                log('Service Worker registered');
                
                // Helper to convert base64 url to Uint8Array
                const urlBase64ToUint8Array = (base64String) => {
                    const padding = '='.repeat((4 - base64String.length % 4) % 4);
                    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
                    const rawData = window.atob(base64);
                    const outputArray = new Uint8Array(rawData.length);
                    for (let i = 0; i < rawData.length; ++i) {
                        outputArray[i] = rawData.charCodeAt(i);
                    }
                    return outputArray;
                };
                
                let subscription = await registration.pushManager.getSubscription();
                if (subscription) {
                    await subscription.unsubscribe();
                }
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
                
                log('Push subscribed! Saving to Supabase...');
                
                // Save to Supabase
                const { error } = await supabase.from('push_subscriptions').insert([
                    { peer_name: localPeerName, subscription: subscription }
                ]);
                
                if (error) {
                    log(`DB Error: ${error.message}`, 'error');
                } else {
                    alert('Notifications enabled successfully!');
                    document.getElementById('enablePushBtn').style.display = 'none';
                }
                
            } catch (e) {
                log(`Push setup error: ${e.message}`, 'error');
            }
        };
        
        log('App ready - Fixed WebRTC connection handling');
        log('Enter your Render.com WebSocket URL and click Connect');
        
        // --- Settings Modal & Sync Logic ---
        elements.syncUrl.value = localStorage.getItem('syncSupabaseUrl') || '';
        elements.syncKey.value = localStorage.getItem('syncSupabaseKey') || '';
        elements.syncTable.value = localStorage.getItem('syncTableName') || '';

        const saveSyncConfig = () => {
            localStorage.setItem('syncSupabaseUrl', elements.syncUrl.value.trim());
            localStorage.setItem('syncSupabaseKey', elements.syncKey.value.trim());
            localStorage.setItem('syncTableName', elements.syncTable.value.trim());
        };

        elements.syncUrl.onchange = saveSyncConfig;
        elements.syncKey.onchange = saveSyncConfig;
        elements.syncTable.onchange = saveSyncConfig;

        elements.settingsBtn.onclick = () => {
            document.getElementById('facultyUnlockSection').style.display = 'block';
            document.getElementById('supabaseSyncSection').style.display = 'none';
            elements.settingsModal.style.display = 'flex';
        };

        document.getElementById('unlockFacultyBtn').onclick = () => {
            const pin = prompt('Enter Faculty PIN:');
            if (pin === '1234') {
                document.getElementById('facultyUnlockSection').style.display = 'none';
                document.getElementById('supabaseSyncSection').style.display = 'block';
            } else if (pin !== null) {
                alert('❌ Incorrect PIN. Access Denied.');
            }
        };

        elements.closeSettingsBtn.onclick = () => {
            elements.settingsModal.style.display = 'none';
        };

        const getSyncClient = () => {
            let url = elements.syncUrl.value.trim();
            const key = elements.syncKey.value.trim();
            if (!url || !key) {
                alert('Please enter both Supabase URL and API Key.');
                return null;
            }
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            try {
                return window.supabase.createClient(url, key);
            } catch (err) {
                alert('Invalid URL format.');
                return null;
            }
        };

        elements.btnTestSync.onclick = async () => {
            const client = getSyncClient();
            const table = elements.syncTable.value.trim();
            if (!client || !table) {
                if(!table) alert('Please enter Table name.');
                return;
            }
            
            elements.btnTestSync.textContent = 'Testing...';
            try {
                const { data, error } = await client.from(table).select('*').limit(1);
                if (error) throw error;
                alert('✅ Connection successful! Found table.');
            } catch (err) {
                alert(`❌ Connection failed: ${err.message}`);
            } finally {
                elements.btnTestSync.textContent = '🔌 Test Connection';
            }
        };

        elements.btnPushSync.onclick = async () => {
            if (chatHistory.length === 0) {
                alert('No local messages to push.');
                return;
            }
            const client = getSyncClient();
            const table = elements.syncTable.value.trim();
            if (!client || !table) return;

            elements.btnPushSync.textContent = 'Pushing...';
            try {
                const { error } = await client.from(table).upsert(chatHistory);
                if (error) throw error;
                alert(`✅ Successfully pushed ${chatHistory.length} messages to Supabase!`);
            } catch (err) {
                alert(`❌ Push failed: ${err.message}`);
            } finally {
                elements.btnPushSync.textContent = '↑ Push to Supabase';
            }
        };

        elements.btnPullSync.onclick = async () => {
            const client = getSyncClient();
            const table = elements.syncTable.value.trim();
            if (!client || !table) return;

            elements.btnPullSync.textContent = 'Pulling...';
            try {
                const { data, error } = await client.from(table).select('*').order('created_at', { ascending: true });
                if (error) throw error;
                
                chatHistory = data || [];
                elements.messagesDiv.innerHTML = '';
                if (chatHistory.length === 0) {
                    elements.messagesDiv.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 40px;">✨ Send a message</div>';
                } else {
                    chatHistory.forEach(msg => {
                        const senderName = msg.Sender || msg.sender || 'Unknown';
                        const senderIp   = msg.sender_ip  || null;
                        const senderDev  = msg.device_id  || null;
                        const senderRoll = msg.roll_number || null;
                        // Show all with roll number + IP for teacher history
                        addMessage(senderName, msg.text, false, msg.image, true, senderIp, senderDev, senderRoll);
                    });
                }
                alert(`✅ Successfully pulled ${chatHistory.length} messages from Supabase!`);
            } catch (err) {
                alert(`❌ Pull failed: ${err.message}`);
            } finally {
                elements.btnPullSync.textContent = '↓ Pull from Supabase';
                // scroll to bottom
                elements.messagesDiv.scrollTop = elements.messagesDiv.scrollHeight;
            }
        };

        // Driver.js Walkthrough Setup
        const driver = window.driver.js.driver;
        const driverObj = driver({
            showProgress: true,
            animate: true,
            steps: [
                {
                    element: '#tour-header',
                    popover: {
                        title: 'Welcome to LAN Party Chat! 🎉',
                        description: 'This is a simple, peer-to-peer chat application. Let\'s show you how it works.',
                        side: 'bottom', align: 'start'
                    }
                },
                {
                    element: '#tour-settings',
                    popover: {
                        title: 'Connection Settings ⚙️',
                        description: 'First, set your Name and make sure the Server URL is correct. Click "Connect" to join the chat server.',
                        side: 'top', align: 'center'
                    }
                },
                {
                    element: '#tour-sidebar',
                    popover: {
                        title: 'Peers List 👥',
                        description: 'Once connected, you will see other students (peers) online here. The app automatically establishes a secure WebRTC connection with them.',
                        side: 'right', align: 'start'
                    }
                },
                {
                    element: '#messages',
                    popover: {
                        title: 'Chat History 💬',
                        description: 'All your messages will appear here. Messages are sent securely directly to other peers.',
                        side: 'left', align: 'center'
                    }
                },
                {
                    element: '#tour-input',
                    popover: {
                        title: 'Send Messages ✍️',
                        description: 'Type your message here and click Send. You can also click the paperclip icon (📎) to send images!',
                        side: 'top', align: 'center'
                    }
                }
            ]
        });

        document.getElementById('helpBtn').addEventListener('click', () => {
            elements.settingsModal.style.display = 'none';
            driverObj.drive();
        });

        // Auto-start walkthrough on page load
        setTimeout(() => {
            driverObj.drive();
        }, 1000);
    })();

