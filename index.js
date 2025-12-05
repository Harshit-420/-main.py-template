const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const login = require("ws3-fca");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// AppState और Uploads डायरेक्टरी बनाओ
fs.ensureDirSync('./uploads');
fs.ensureDirSync('./appstates');
fs.ensureDirSync('./temp');

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'appstateFile') {
            cb(null, './appstates/');
        } else if (file.fieldname === 'msgFile') {
            cb(null, './uploads/');
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Active sessions store
const activeSessions = new Map();

// Facebook Login Function
async function loginWithAppState(appStateStr) {
    return new Promise((resolve, reject) => {
        try {
            let appState;
            if (typeof appStateStr === 'string') {
                appState = JSON.parse(appStateStr);
            } else {
                appState = appStateStr;
            }
            
            login({ appState: appState }, (err, api) => {
                if (err) {
                    console.error('Login error:', err);
                    return reject(err);
                }
                console.log('Login successful for user:', api.getCurrentUserID());
                resolve(api);
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Send Message Function
async function sendFacebookMessage(api, threadID, message) {
    return new Promise((resolve, reject) => {
        api.sendMessage(message, threadID, (err, info) => {
            if (err) {
                console.error('Send message error:', err);
                return reject(err);
            }
            console.log('Message sent successfully to:', threadID);
            resolve(info);
        });
    });
}

// Delay Function
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Routes
app.post('/upload-appstate', upload.single('appstateFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: 'कोई फाइल अपलोड नहीं हुई' });
        }
        
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const appStates = fileContent.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => {
                try {
                    return JSON.parse(line.trim());
                } catch {
                    return line.trim();
                }
            });
        
        res.json({ 
            success: true, 
            message: `${appStates.length} AppStates अपलोड हुए`,
            count: appStates.length,
            filename: req.file.filename
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.json({ success: false, message: 'फाइल प्रोसेस करने में error' });
    }
});

app.post('/upload-message', upload.single('msgFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: 'कोई फाइल अपलोड नहीं हुई' });
        }
        
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const messages = fileContent.split('\n').filter(line => line.trim() !== '');
        
        res.json({ 
            success: true, 
            message: `${messages.length} मैसेज अपलोड हुए`,
            count: messages.length,
            filename: req.file.filename,
            messages: messages
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.json({ success: false, message: 'फाइल प्रोसेस करने में error' });
    }
});

app.post('/start-sending', async (req, res) => {
    try {
        const { 
            threadId, 
            prefix, 
            delay: delayTime, 
            loop, 
            appStates: manualAppStates,
            appStateFile,
            messages: manualMessages,
            messageFile
        } = req.body;
        
        if (!threadId || threadId.trim() === '') {
            return res.json({ success: false, message: 'Group ID डालो' });
        }
        
        if (!prefix || prefix.trim() === '') {
            return res.json({ success: false, message: 'Message Prefix डालो' });
        }
        
        const delaySeconds = parseInt(delayTime) || 20;
        const loopEnabled = loop === 'true';
        
        let appStates = [];
        let messages = [];
        
        // Load AppStates
        if (appStateFile && appStateFile !== 'undefined') {
            try {
                const filePath = path.join('./appstates', appStateFile);
                if (fs.existsSync(filePath)) {
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    appStates = fileContent.split('\n')
                        .filter(line => line.trim() !== '')
                        .map(line => {
                            try {
                                return JSON.parse(line.trim());
                            } catch {
                                return line.trim();
                            }
                        });
                }
            } catch (error) {
                console.error('Error loading appstate file:', error);
            }
        }
        
        if (manualAppStates && manualAppStates.length > 0) {
            if (typeof manualAppStates === 'string') {
                appStates = manualAppStates.split('\n')
                    .filter(line => line.trim() !== '')
                    .map(line => {
                        try {
                            return JSON.parse(line.trim());
                        } catch {
                            return line.trim();
                        }
                    });
            } else if (Array.isArray(manualAppStates)) {
                appStates = manualAppStates;
            }
        }
        
        // Load Messages
        if (messageFile && messageFile !== 'undefined') {
            try {
                const filePath = path.join('./uploads', messageFile);
                if (fs.existsSync(filePath)) {
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    messages = fileContent.split('\n').filter(line => line.trim() !== '');
                }
            } catch (error) {
                console.error('Error loading message file:', error);
            }
        }
        
        if (manualMessages && manualMessages.length > 0) {
            if (typeof manualMessages === 'string') {
                messages = manualMessages.split('\n').filter(line => line.trim() !== '');
            } else if (Array.isArray(manualMessages)) {
                messages = manualMessages;
            }
        }
        
        if (appStates.length === 0) {
            return res.json({ success: false, message: 'कम से कम एक AppState डालो' });
        }
        
        if (messages.length === 0) {
            return res.json({ success: false, message: 'कम से कम एक मैसेज डालो' });
        }
        
        const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        const session = {
            threadId: threadId.trim(),
            prefix: prefix.trim(),
            delay: delaySeconds,
            loop: loopEnabled,
            appStates: appStates,
            messages: messages,
            status: 'running',
            sentCount: 0,
            failedCount: 0,
            totalMessages: appStates.length * messages.length,
            currentAppStateIndex: 0,
            currentMessageIndex: 0
        };
        
        activeSessions.set(sessionId, session);
        
        // Start sending messages
        sendMessages(sessionId);
        
        res.json({ 
            success: true, 
            sessionId: sessionId,
            message: 'मैसेज भेजना शुरू हुआ',
            stats: {
                appStates: appStates.length,
                messages: messages.length,
                total: session.totalMessages
            }
        });
        
    } catch (error) {
        console.error('Start sending error:', error);
        res.json({ success: false, message: 'Error: ' + error.message });
    }
});

async function sendMessages(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    
    console.log(`Starting session ${sessionId} with ${session.appStates.length} AppStates`);
    
    let continueLoop = true;
    
    while (continueLoop && session.status === 'running') {
        for (let i = 0; i < session.appStates.length && session.status === 'running'; i++) {
            session.currentAppStateIndex = i;
            let api = null;
            
            try {
                console.log(`Logging in with AppState ${i + 1}/${session.appStates.length}`);
                api = await loginWithAppState(session.appStates[i]);
                
                for (let j = 0; j < session.messages.length && session.status === 'running'; j++) {
                    session.currentMessageIndex = j;
                    const fullMessage = `${session.prefix}\n${session.messages[j]}`;
                    
                    try {
                        console.log(`Sending message ${j + 1}/${session.messages.length} to ${session.threadId}`);
                        await sendFacebookMessage(api, session.threadId, fullMessage);
                        session.sentCount++;
                        console.log(`✓ Message sent successfully (${session.sentCount}/${session.totalMessages})`);
                        
                        // Send update via WebSocket
                        sendUpdate(sessionId, {
                            type: 'message_sent',
                            appState: i + 1,
                            message: j + 1,
                            totalSent: session.sentCount,
                            totalFailed: session.failedCount
                        });
                        
                    } catch (msgError) {
                        session.failedCount++;
                        console.error(`✗ Failed to send message:`, msgError.message);
                        
                        sendUpdate(sessionId, {
                            type: 'message_failed',
                            appState: i + 1,
                            message: j + 1,
                            error: msgError.message,
                            totalSent: session.sentCount,
                            totalFailed: session.failedCount
                        });
                    }
                    
                    // Delay between messages
                    if (session.status === 'running') {
                        await delay(session.delay * 1000);
                    }
                }
                
                if (api) {
                    try {
                        api.logout();
                        console.log(`Logged out from AppState ${i + 1}`);
                    } catch (logoutError) {
                        console.error('Logout error:', logoutError);
                    }
                }
                
            } catch (loginError) {
                session.failedCount += session.messages.length;
                console.error(`✗ Login failed for AppState ${i + 1}:`, loginError.message);
                
                sendUpdate(sessionId, {
                    type: 'login_failed',
                    appState: i + 1,
                    error: loginError.message,
                    totalSent: session.sentCount,
                    totalFailed: session.failedCount
                });
            }
        }
        
        // Check if should loop
        if (session.loop && session.status === 'running') {
            console.log('Looping back to start...');
            session.currentAppStateIndex = 0;
            session.currentMessageIndex = 0;
            continueLoop = true;
        } else {
            continueLoop = false;
        }
    }
    
    if (session.status === 'running') {
        session.status = 'completed';
        console.log(`Session ${sessionId} completed`);
        
        sendUpdate(sessionId, {
            type: 'completed',
            totalSent: session.sentCount,
            totalFailed: session.failedCount,
            successRate: ((session.sentCount / session.totalMessages) * 100).toFixed(2) + '%'
        });
    }
}

function sendUpdate(sessionId, data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                sessionId: sessionId,
                ...data
            }));
        }
    });
}

app.get('/session-status/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.json({ success: false, message: 'Session not found' });
    }
    
    res.json({
        success: true,
        status: session.status,
        sentCount: session.sentCount,
        failedCount: session.failedCount,
        totalMessages: session.totalMessages,
        progress: session.totalMessages > 0 ? 
            Math.round((session.sentCount / session.totalMessages) * 100) : 0,
        currentAppState: session.currentAppStateIndex + 1,
        currentMessage: session.currentMessageIndex + 1
    });
});

app.post('/stop-session/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.json({ success: false, message: 'Session not found' });
    }
    
    session.status = 'stopped';
    activeSessions.set(sessionId, session);
    
    res.json({ 
        success: true, 
        message: 'Session stopped',
        sentCount: session.sentCount,
        failedCount: session.failedCount
    });
});

// WebSocket
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (message) => {
        console.log('WebSocket message:', message);
    });
    
    ws.on('close', () => {
        console.log('WebSocket disconnected');
    });
});

// Serve HTML
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Facebook Multi Messenger - 100% Working</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial; }
            body { background: linear-gradient(135deg, #0f2027, #203a43, #2c5364); color: #1e88e5; min-height: 100vh; overflow-x: hidden; position: relative; }
            
            /* Rain Background */
            .rain { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: -1; }
            .rain::before { content: ''; position: absolute; width: 100%; height: 100%; background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="10" cy="10" r="1" fill="%2300b0ff" opacity="0.6"/><circle cx="30" cy="20" r="1" fill="%2300b0ff" opacity="0.6"/><circle cx="50" cy="15" r="1" fill="%2300b0ff" opacity="0.6"/><circle cx="70" cy="25" r="1" fill="%2300b0ff" opacity="0.6"/><circle cx="90" cy="10" r="1" fill="%2300b0ff" opacity="0.6"/></svg>') repeat; animation: rain 1s linear infinite; }
            @keyframes rain { 0% { transform: translateY(-100px); } 100% { transform: translateY(100vh); } }
            
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; position: relative; z-index: 1; }
            
            header { text-align: center; margin-bottom: 30px; padding: 20px; background: rgba(13, 71, 161, 0.2); border-radius: 15px; border: 2px solid rgba(30, 136, 229, 0.5); box-shadow: 0 0 30px rgba(30, 136, 229, 0.3); }
            h1 { font-size: 2.8rem; margin-bottom: 10px; background: linear-gradient(45deg, #ff0000, #ff8000, #ffff00, #00ff00, #00ffff, #0000ff, #8000ff); -webkit-background-clip: text; background-clip: text; color: transparent; text-shadow: 0 0 20px rgba(255, 255, 255, 0.5); animation: glow 2s infinite alternate; }
            @keyframes glow { from { text-shadow: 0 0 10px rgba(255, 255, 255, 0.5); } to { text-shadow: 0 0 20px rgba(255, 255, 255, 0.8), 0 0 30px rgba(0, 255, 255, 0.6); } }
            
            .subtitle { font-size: 1.2rem; color: #00ffff; margin-bottom: 20px; }
            .warning { color: #ff4444; background: rgba(255, 68, 68, 0.1); padding: 10px; border-radius: 5px; margin: 10px 0; border: 1px solid #ff4444; }
            .success { color: #44ff44; background: rgba(68, 255, 68, 0.1); padding: 10px; border-radius: 5px; margin: 10px 0; border: 1px solid #44ff44; }
            
            .card { background: rgba(0, 0, 0, 0.4); border-radius: 10px; padding: 20px; margin-bottom: 20px; border: 1px solid rgba(30, 136, 229, 0.5); backdrop-filter: blur(5px); }
            
            .tabs { display: flex; margin-bottom: 20px; border-bottom: 2px solid #1e88e5; }
            .tab-btn { padding: 12px 25px; background: rgba(30, 136, 229, 0.2); border: none; color: #00ffff; font-size: 16px; cursor: pointer; border-radius: 5px 5px 0 0; margin-right: 5px; transition: all 0.3s; }
            .tab-btn.active { background: #1e88e5; color: white; box-shadow: 0 0 15px #1e88e5; }
            
            .tab-content { display: none; animation: fadeIn 0.5s; }
            .tab-content.active { display: block; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            
            label { display: block; margin: 10px 0 5px; color: #00b0ff; font-weight: bold; }
            
            input, textarea, select { width: 100%; padding: 12px; margin: 5px 0 15px; border: 2px solid #ff0000; border-radius: 5px; background: rgba(0, 0, 0, 0.5); color: white; font-size: 16px; transition: all 0.3s; }
            input:focus, textarea:focus, select:focus { outline: none; border-color: #00ff00; box-shadow: 0 0 15px #00ff00; animation: inputGlow 1.5s infinite alternate; }
            @keyframes inputGlow { from { box-shadow: 0 0 10px #00ff00; } to { box-shadow: 0 0 20px #00ff00, 0 0 30px #00ff00; } }
            
            textarea { min-height: 100px; resize: vertical; }
            
            .file-upload { border: 3px dashed #ff0000; border-radius: 10px; padding: 30px; text-align: center; cursor: pointer; transition: all 0.3s; margin: 10px 0; }
            .file-upload:hover { border-color: #00ff00; background: rgba(0, 255, 0, 0.1); }
            .file-upload i { font-size: 50px; color: #ff0000; margin-bottom: 15px; }
            
            .counter { text-align: right; color: #00ffff; font-size: 14px; margin-top: -10px; }
            
            .status-box { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
            .status-item { background: rgba(0, 0, 0, 0.5); padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #1e88e5; }
            .status-label { color: #00ffff; font-size: 14px; }
            .status-value { color: #00ff00; font-size: 24px; font-weight: bold; text-shadow: 0 0 10px #00ff00; }
            
            .progress-container { background: rgba(0, 0, 0, 0.5); height: 30px; border-radius: 15px; margin: 20px 0; overflow: hidden; border: 2px solid #ff0000; }
            .progress-bar { height: 100%; background: linear-gradient(90deg, #ff0000, #ff8000, #ffff00, #00ff00); width: 0%; transition: width 0.5s; position: relative; }
            .progress-bar::after { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent); animation: shimmer 2s infinite; }
            @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            .progress-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-weight: bold; text-shadow: 0 0 5px black; }
            
            .buttons { display: flex; gap: 15px; margin: 20px 0; }
            .btn { flex: 1; padding: 15px; border: none; border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; transition: all 0.3s; display: flex; align-items: center; justify-content: center; gap: 10px; }
            .btn-start { background: linear-gradient(45deg, #00ff00, #00cc00); color: black; }
            .btn-stop { background: linear-gradient(45deg, #ff0000, #cc0000); color: white; }
            .btn-reset { background: linear-gradient(45deg, #1e88e5, #0d47a1); color: white; }
            .btn:hover { transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5); }
            .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
            
            .logs { background: rgba(0, 0, 0, 0.7); border: 1px solid #1e88e5; border-radius: 8px; padding: 15px; height: 200px; overflow-y: auto; margin-top: 20px; }
            .log-entry { padding: 8px; margin-bottom: 5px; background: rgba(30, 136, 229, 0.1); border-radius: 5px; border-left: 3px solid #1e88e5; font-size: 14px; }
            .log-success { border-left-color: #00ff00; color: #00ff00; }
            .log-error { border-left-color: #ff0000; color: #ff0000; }
            .log-info { border-left-color: #00ffff; color: #00ffff; }
            
            footer { text-align: center; margin-top: 30px; padding: 20px; color: #00ffff; border-top: 1px solid #1e88e5; }
            
            /* Responsive */
            @media (max-width: 768px) {
                .status-box { grid-template-columns: repeat(2, 1fr); }
                .buttons { flex-direction: column; }
                h1 { font-size: 2rem; }
            }
        </style>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body>
        <div class="rain"></div>
        
        <div class="container">
            <header>
                <h1><i class="fas fa-robot"></i> Facebook Multi Messenger</h1>
                <div class="subtitle">100% Working - Real Messages Sent Guaranteed ✅</div>
                <div class="warning"><i class="fas fa-exclamation-triangle"></i> Use at your own risk. Follow Facebook's Terms of Service.</div>
            </header>
            
            <div class="card">
                <h2><i class="fas fa-upload"></i> Upload AppStates</h2>
                <div class="tabs">
                    <button class="tab-btn active" onclick="switchTab('manual')">Manual Input</button>
                    <button class="tab-btn" onclick="switchTab('file')">File Upload</button>
                </div>
                
                <div id="manual-tab" class="tab-content active">
                    <label><i class="fas fa-key"></i> Enter AppStates (one per line):</label>
                    <textarea id="appstateInput" placeholder="Paste your AppStates here, one per line..." rows="6"></textarea>
                    <div class="counter">AppStates: <span id="appstateCount">0</span></div>
                </div>
                
                <div id="file-tab" class="tab-content">
                    <label><i class="fas fa-file-upload"></i> Upload AppState File:</label>
                    <div class="file-upload" onclick="document.getElementById('appstateFile').click()">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <p>Drag & drop or click to upload AppState file (.txt)</p>
                        <input type="file" id="appstateFile" accept=".txt" style="display:none">
                    </div>
                    <div id="appstateFileInfo"></div>
                </div>
            </div>
            
            <div class="card">
                <h2><i class="fas fa-cog"></i> Message Configuration</h2>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <label><i class="fas fa-users"></i> Group ID:</label>
                        <input type="text" id="threadId" placeholder="6389199287489492" value="6389199287489492">
                    </div>
                    <div>
                        <label><i class="fas fa-tag"></i> Message Prefix:</label>
                        <input type="text" id="prefix" placeholder="Devil Here" value="Devil Here">
                    </div>
                </div>
                
                <label><i class="fas fa-envelope"></i> Upload Message File:</label>
                <div class="file-upload" onclick="document.getElementById('messageFile').click()">
                    <i class="fas fa-file-alt"></i>
                    <p>Drag & drop or click to upload message file (.txt)</p>
                    <input type="file" id="messageFile" accept=".txt" style="display:none">
                </div>
                <div id="messageFileInfo"></div>
                <div class="counter">Messages: <span id="messageCount">0</span></div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
                    <div>
                        <label><i class="fas fa-clock"></i> Delay (seconds):</label>
                        <input type="number" id="delay" value="20" min="5" max="300">
                    </div>
                    <div>
                        <label><i class="fas fa-redo"></i> Loop System:</label>
                        <select id="loop">
                            <option value="true">Enabled</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <h2><i class="fas fa-chart-line"></i> Status Dashboard</h2>
                
                <div class="status-box">
                    <div class="status-item">
                        <div class="status-label">AppStates</div>
                        <div class="status-value" id="statusAppstates">0</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">Messages</div>
                        <div class="status-value" id="statusMessages">0</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">Sent</div>
                        <div class="status-value" id="statusSent">0</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">Status</div>
                        <div class="status-value" id="statusOverall" style="font-size:18px;">Ready</div>
                    </div>
                </div>
                
                <div class="progress-container">
                    <div class="progress-bar" id="progressBar"></div>
                    <div class="progress-text" id="progressText">0%</div>
                </div>
                
                <div class="buttons">
                    <button class="btn btn-start" id="startBtn" onclick="startSending()">
                        <i class="fas fa-play"></i> START SENDING
                    </button>
                    <button class="btn btn-stop" id="stopBtn" onclick="stopSending()" disabled>
                        <i class="fas fa-stop"></i> STOP
                    </button>
                    <button class="btn btn-reset" onclick="resetAll()">
                        <i class="fas fa-undo"></i> RESET
                    </button>
                </div>
                
                <h3><i class="fas fa-history"></i> Activity Logs</h3>
                <div class="logs" id="logs">
                    <div class="log-entry log-info">System: Facebook Multi Messenger Started</div>
                    <div class="log-entry log-success">Ready to send real messages!</div>
                </div>
            </div>
            
            <footer>
                <p>© 2024 Facebook Multi Messenger | Powered by WS3-FCA</p>
                <p class="warning">Messages will be sent to Facebook groups in real-time</p>
            </footer>
        </div>
        
        <script>
            let currentSessionId = null;
            let ws = null;
            
            // Tab switching
            function switchTab(tabName) {
                document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                
                event.target.classList.add('active');
                document.getElementById(tabName + '-tab').classList.add('active');
            }
            
            // Count AppStates
            document.getElementById('appstateInput').addEventListener('input', function() {
                const lines = this.value.trim().split('\\n').filter(line => line.trim() !== '');
                document.getElementById('appstateCount').textContent = lines.length;
                document.getElementById('statusAppstates').textContent = lines.length;
            });
            
            // Handle AppState file upload
            document.getElementById('appstateFile').addEventListener('change', function(e) {
                if (this.files[0]) {
                    const file = this.files[0];
                    document.getElementById('appstateFileInfo').innerHTML = 
                        '<div class="success"><i class="fas fa-check"></i> ' + file.name + ' (' + formatFileSize(file.size) + ')</div>';
                    
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        document.getElementById('appstateInput').value = e.target.result;
                        const lines = e.target.result.split('\\n').filter(line => line.trim() !== '');
                        document.getElementById('appstateCount').textContent = lines.length;
                        document.getElementById('statusAppstates').textContent = lines.length;
                        addLog('Loaded ' + lines.length + ' AppStates from file', 'success');
                    };
                    reader.readAsText(file);
                }
            });
            
            // Handle Message file upload
            document.getElementById('messageFile').addEventListener('change', function(e) {
                if (this.files[0]) {
                    const file = this.files[0];
                    document.getElementById('messageFileInfo').innerHTML = 
                        '<div class="success"><i class="fas fa-check"></i> ' + file.name + ' (' + formatFileSize(file.size) + ')</div>';
                    
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        const lines = e.target.result.split('\\n').filter(line => line.trim() !== '');
                        document.getElementById('messageCount').textContent = lines.length;
                        document.getElementById('statusMessages').textContent = lines.length;
                        addLog('Loaded ' + lines.length + ' messages from file', 'success');
                    };
                    reader.readAsText(file);
                }
            });
            
            // WebSocket connection
            function connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                ws = new WebSocket(protocol + '//' + window.location.host);
                
                ws.onopen = function() {
                    addLog('Connected to server', 'success');
                };
                
                ws.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.sessionId === currentSessionId) {
                            if (data.type === 'message_sent') {
                                document.getElementById('statusSent').textContent = data.totalSent;
                                updateProgress(data.totalSent);
                                addLog('✓ Message sent from AppState ' + data.appState, 'success');
                            } else if (data.type === 'message_failed') {
                                addLog('✗ Message failed: ' + data.error, 'error');
                            } else if (data.type === 'login_failed') {
                                addLog('✗ Login failed for AppState ' + data.appState, 'error');
                            } else if (data.type === 'completed') {
                                document.getElementById('statusOverall').textContent = 'Completed';
                                document.getElementById('statusOverall').style.color = '#00ff00';
                                document.getElementById('startBtn').disabled = false;
                                document.getElementById('stopBtn').disabled = true;
                                addLog('✅ All messages sent successfully!', 'success');
                                addLog('Success rate: ' + data.successRate, 'info');
                            }
                        }
                    } catch (e) {
                        console.error('WebSocket error:', e);
                    }
                };
                
                ws.onclose = function() {
                    addLog('Disconnected from server. Reconnecting...', 'error');
                    setTimeout(connectWebSocket, 3000);
                };
            }
            
            // Start sending messages
            async function startSending() {
                const threadId = document.getElementById('threadId').value.trim();
                const prefix = document.getElementById('prefix').value.trim();
                const delay = document.getElementById('delay').value;
                const loop = document.getElementById('loop').value;
                
                // Get AppStates
                const appstateInput = document.getElementById('appstateInput').value.trim();
                const appstateFileInput = document.getElementById('appstateFile').files[0];
                
                if (!threadId) {
                    alert('Please enter Group ID');
                    return;
                }
                
                if (!prefix) {
                    alert('Please enter Message Prefix');
                    return;
                }
                
                if (appstateInput === '' && !appstateFileInput) {
                    alert('Please enter or upload AppStates');
                    return;
                }
                
                if (!document.getElementById('messageFile').files[0]) {
                    alert('Please upload message file');
                    return;
                }
                
                // Disable start button
                document.getElementById('startBtn').disabled = true;
                document.getElementById('stopBtn').disabled = false;
                document.getElementById('statusOverall').textContent = 'Starting...';
                document.getElementById('statusOverall').style.color = '#ffff00';
                
                // Upload message file first
                const messageFormData = new FormData();
                messageFormData.append('msgFile', document.getElementById('messageFile').files[0]);
                
                try {
                    const messageResponse = await fetch('/upload-message', {
                        method: 'POST',
                        body: messageFormData
                    });
                    
                    const messageResult = await messageResponse.json();
                    
                    if (!messageResult.success) {
                        throw new Error('Failed to upload messages');
                    }
                    
                    // Prepare data
                    const formData = new FormData();
                    if (appstateFileInput) {
                        formData.append('appstateFile', appstateFileInput);
                    }
                    
                    const requestData = {
                        threadId: threadId,
                        prefix: prefix,
                        delay: delay,
                        loop: loop,
                        appStates: appstateInput,
                        messages: messageResult.messages,
                        messageFile: messageResult.filename
                    };
                    
                    if (appstateFileInput) {
                        requestData.appStateFile = 'temp';
                    }
                    
                    // Start sending
                    const response = await fetch('/start-sending', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestData)
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        currentSessionId = result.sessionId;
                        document.getElementById('statusOverall').textContent = 'Sending...';
                        document.getElementById('statusOverall').style.color = '#00ff00';
                        addLog('✅ Started sending messages!', 'success');
                        addLog('Target Group: ' + threadId, 'info');
                        addLog('Total Messages: ' + result.stats.total, 'info');
                        
                        // Start checking status
                        checkStatus();
                    } else {
                        throw new Error(result.message);
                    }
                    
                } catch (error) {
                    addLog('Error: ' + error.message, 'error');
                    document.getElementById('startBtn').disabled = false;
                    document.getElementById('stopBtn').disabled = true;
                    document.getElementById('statusOverall').textContent = 'Error';
                    document.getElementById('statusOverall').style.color = '#ff0000';
                }
            }
            
            // Stop sending
            async function stopSending() {
                if (!currentSessionId) return;
                
                try {
                    const response = await fetch('/stop-session/' + currentSessionId, {
                        method: 'POST'
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        document.getElementById('startBtn').disabled = false;
                        document.getElementById('stopBtn').disabled = true;
                        document.getElementById('statusOverall').textContent = 'Stopped';
                        document.getElementById('statusOverall').style.color = '#ff0000';
                        addLog('Stopped sending messages', 'info');
                    }
                } catch (error) {
                    addLog('Error stopping: ' + error.message, 'error');
                }
            }
            
            // Check session status
            async function checkStatus() {
                if (!currentSessionId) return;
                
                try {
                    const response = await fetch('/session-status/' + currentSessionId);
                    const result = await response.json();
                    
                    if (result.success) {
                        document.getElementById('statusSent').textContent = result.sentCount;
                        updateProgress(result.sentCount);
                        
                        if (result.status === 'running') {
                            setTimeout(checkStatus, 2000);
                        } else if (result.status === 'completed' || result.status === 'stopped') {
                            document.getElementById('startBtn').disabled = false;
                            document.getElementById('stopBtn').disabled = true;
                            document.getElementById('statusOverall').textContent = result.status.charAt(0).toUpperCase() + result.status.slice(1);
                        }
                    }
                } catch (error) {
                    console.error('Status check error:', error);
                }
            }
            
            // Update progress
            function updateProgress(sentCount) {
                const totalMessages = parseInt(document.getElementById('statusAppstates').textContent) * 
                                     parseInt(document.getElementById('statusMessages').textContent);
                
                if (totalMessages > 0) {
                    const percent = Math.min(100, Math.round((sentCount / totalMessages) * 100));
                    document.getElementById('progressBar').style.width = percent + '%';
                    document.getElementById('progressText').textContent = percent + '%';
                }
            }
            
            // Reset everything
            function resetAll() {
                document.getElementById('appstateInput').value = '';
                document.getElementById('appstateFile').value = '';
                document.getElementById('messageFile').value = '';
                document.getElementById('threadId').value = '6389199287489492';
                document.getElementById('prefix').value = 'Devil Here';
                document.getElementById('delay').value = '20';
                document.getElementById('loop').value = 'true';
                
                document.getElementById('appstateCount').textContent = '0';
                document.getElementById('messageCount').textContent = '0';
                document.getElementById('appstateFileInfo').innerHTML = '';
                document.getElementById('messageFileInfo').innerHTML = '';
                
                document.getElementById('statusAppstates').textContent = '0';
                document.getElementById('statusMessages').textContent = '0';
                document.getElementById('statusSent').textContent = '0';
                document.getElementById('statusOverall').textContent = 'Ready';
                document.getElementById('statusOverall').style.color = '#00ffff';
                
                document.getElementById('progressBar').style.width = '0%';
                document.getElementById('progressText').textContent = '0%';
                
                document.getElementById('startBtn').disabled = false;
                document.getElementById('stopBtn').disabled = true;
                
                document.getElementById('logs').innerHTML = 
                    '<div class="log-entry log-info">System: Reset completed</div>' +
                    '<div class="log-entry log-success">Ready to send real messages!</div>';
                
                currentSessionId = null;
            }
            
            // Add log
            function addLog(message, type = 'info') {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry log-' + type;
                logEntry.innerHTML = '<i class="fas fa-circle" style="font-size:8px; margin-right:8px;"></i> ' + message;
                
                const logs = document.getElementById('logs');
                logs.appendChild(logEntry);
                logs.scrollTop = logs.scrollHeight;
            }
            
            // Format file size
            function formatFileSize(bytes) {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            }
            
            // Initialize WebSocket
            connectWebSocket();
            
            // Add some sample AppStates instruction
            addLog('Instructions:', 'info');
            addLog('1. Get AppStates from Facebook (use browser developer tools)', 'info');
            addLog('2. Paste each AppState on separate line or upload file', 'info');
            addLog('3. Upload messages file (one message per line)', 'info');
            addLog('4. Enter Group ID and click START', 'info');
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ============================================
    Facebook Multi Messenger - 100% WORKING ✅
    ============================================
    Server running on: http://localhost:${PORT}
    
    IMPORTANT: Install required packages first:
    1. npm install express ws multer fs-extra @xaviabot/fca-unofficial
    2. Make sure you have valid Facebook AppStates
    3. Messages will be sent to groups in REAL TIME
    
    Features:
    ✅ Multiple AppState support
    ✅ Real message sending
    ✅ Beautiful UI with animations
    ✅ File upload support
    ✅ Loop system
    ✅ Progress tracking
    ✅ Activity logs
    
    ============================================
    `);
});
