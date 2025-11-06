// Load environment variables from .env file if it exists
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not installed, continue without it (environment variables can be set directly)
    console.log('dotenv not found, using system environment variables');
}

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;
const path = require('path');

// Serve static files
app.use(express.static('public'));

// Serve built Vue app assets from dist if they exist
const fs = require('fs');
if (fs.existsSync(path.join(__dirname, 'dist', 'assets'))) {
    app.use('/assets', express.static(path.join(__dirname, 'dist', 'assets')));
}

// Serve Vue app at /vue route
app.get('/vue', (req, res) => {
    // Try to serve built version first, fallback to source
    const builtPath = path.join(__dirname, 'dist', 'vue-app.html');
    const sourcePath = path.join(__dirname, 'public', 'vue-app.html');
    
    if (require('fs').existsSync(builtPath)) {
        res.sendFile(builtPath);
    } else {
        res.sendFile(sourcePath);
    }
});

// Track rooms and users globally
const rooms = {};

// Periodic cleanup task - runs every 5 minutes
setInterval(() => {
    const now = Date.now();
    const roomIds = Object.keys(rooms);
    let cleanedRooms = 0;
    let activeRooms = 0;
    let totalParticipants = 0;
    
    roomIds.forEach(roomId => {
        const room = rooms[roomId];
        if (!room) return;
        
        // Check if room has participants
        const participantCount = Object.keys(room.participants).length;
        
        if (participantCount === 0) {
            // Room is empty - check if it's stale (older than 30 minutes)
            // Since we clean up empty rooms immediately, this is a safety net
            console.log(`Cleaning up empty room ${roomId} (safety cleanup)`);
            delete rooms[roomId];
            cleanedRooms++;
        } else {
            activeRooms++;
            totalParticipants += participantCount;
        }
    });
    
    // Log cleanup statistics (only if there's activity)
    if (cleanedRooms > 0 || activeRooms > 0) {
        console.log(`🧹 Cleanup: ${cleanedRooms} rooms cleaned, ${activeRooms} active rooms, ${totalParticipants} total participants`);
    }
    
    // Warn if too many rooms (potential memory issue)
    if (activeRooms > 1000) {
        console.warn(`⚠️ Warning: High number of active rooms (${activeRooms}). Consider investigating memory usage.`);
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown handler
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    const roomCount = Object.keys(rooms).length;
    console.log(`Cleaning up ${roomCount} rooms before shutdown...`);
    
    // Clear all rooms
    Object.keys(rooms).forEach(roomId => {
        delete rooms[roomId];
    });
    
    console.log('Server shutdown complete');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    const roomCount = Object.keys(rooms).length;
    console.log(`Cleaning up ${roomCount} rooms before shutdown...`);
    
    // Clear all rooms
    Object.keys(rooms).forEach(roomId => {
        delete rooms[roomId];
    });
    
    console.log('Server shutdown complete');
    process.exit(0);
});

// Main route
app.get('/', (req, res) => {
    // Get protocol from headers if behind a proxy
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    console.log(`Request received with protocol: ${protocol}`);
    
    // Redirect to HTTPS if not secure and not on localhost
    if (protocol !== 'https' && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') {
        console.log(`Redirecting ${req.hostname} to HTTPS`);
        return res.redirect(`https://${req.hostname}${req.url}`);
    }
    
    res.sendFile(__dirname + '/public/index.html');
});

// Server status endpoint
app.get('/status', (req, res) => {
    res.json({ 
        status: 'running',
        https: req.secure || (req.headers['x-forwarded-proto'] === 'https'),
        socketConnections: io.engine.clientsCount,
        uptime: process.uptime(),
        activeRooms: Object.keys(rooms).length,
        totalParticipants: Object.values(rooms).reduce((sum, room) => sum + Object.keys(room.participants).length, 0)
    });
});

// Cache for Cloudflare TURN credentials (with expiration)
let cloudflareCredentialsCache = null;
let cloudflareCredentialsExpiry = null;

// ICE servers endpoint - provides TURN/STUN configuration
// Supports Cloudflare TURN API (generates short-lived credentials) and other TURN servers
app.get('/api/ice-servers', async (req, res) => {
    const iceServers = [];
    
    // Add STUN servers (always include these)
    iceServers.push(
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:stun.ekiga.net' }
    );
    
    // Check for Cloudflare TURN configuration (priority - uses API to generate credentials)
    const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
    const cloudflareTurnTokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;
    
    if (cloudflareApiToken && cloudflareTurnTokenId) {
        try {
            // Check if we have cached credentials that are still valid
            const now = Date.now();
            if (cloudflareCredentialsCache && cloudflareCredentialsExpiry && now < cloudflareCredentialsExpiry) {
                console.log('✅ Using cached Cloudflare TURN credentials');
                iceServers.push(...cloudflareCredentialsCache);
            } else {
                // Generate new credentials from Cloudflare API
                console.log('🔄 Generating new Cloudflare TURN credentials...');
                
                const https = require('https');
                const turnCredentials = await new Promise((resolve, reject) => {
                    const postData = JSON.stringify({ ttl: 86400 }); // 24 hour TTL
                    
                    const options = {
                        hostname: 'rtc.live.cloudflare.com',
                        path: `/v1/turn/keys/${cloudflareTurnTokenId}/credentials/generate-ice-servers`,
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${cloudflareApiToken}`,
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(postData)
                        }
                    };
                    
                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', () => {
                            try {
                                // Cloudflare returns 201 (Created) for successful credential generation
                                if (res.statusCode !== 200 && res.statusCode !== 201) {
                                    reject(new Error(`Cloudflare API returned ${res.statusCode}: ${data}`));
                                    return;
                                }
                                
                                const json = JSON.parse(data);
                                if (json.iceServers && json.iceServers.length > 0) {
                                    resolve(json);
                                } else {
                                    reject(new Error('Invalid response from Cloudflare API'));
                                }
                            } catch (e) {
                                reject(new Error(`Failed to parse Cloudflare response: ${e.message}`));
                            }
                        });
                    });
                    
                    req.on('error', (error) => {
                        reject(new Error(`Cloudflare API request failed: ${error.message}`));
                    });
                    
                    req.write(postData);
                    req.end();
                });
                
                // Extract and format Cloudflare ICE servers
                if (turnCredentials.iceServers && turnCredentials.iceServers.length > 0) {
                    const cloudflareIceServers = turnCredentials.iceServers.map(server => ({
                        urls: server.urls,
                        username: server.username,
                        credential: server.credential
                    }));
                    
                    iceServers.push(...cloudflareIceServers);
                    
                    // Cache credentials (expire 1 hour before actual expiry to be safe)
                    cloudflareCredentialsCache = cloudflareIceServers;
                    cloudflareCredentialsExpiry = now + (23 * 60 * 60 * 1000); // 23 hours cache
                    
                    console.log('✅ Added Cloudflare TURN servers (generated via API)');
                }
            }
        } catch (error) {
            console.warn('⚠️ Failed to fetch Cloudflare TURN credentials:', error.message);
            console.warn('Falling back to alternative TURN servers...');
            // Fall through to alternative TURN servers below
        }
    }
    
    // Check for generic TURN servers from environment variables if Cloudflare failed
    if (iceServers.length <= 7) { // Only STUN servers added
        const turnUrls = process.env.TURN_URLS;
        const turnUsername = process.env.TURN_USERNAME;
        const turnCredential = process.env.TURN_CREDENTIAL;
        
        if (turnUrls) {
            // Parse multiple TURN URLs
            const urls = turnUrls.split(',');
            urls.forEach(url => {
                const urlParts = url.trim().split('|');
                const urlStr = urlParts[0];
                const username = urlParts[1] || turnUsername;
                const credential = urlParts[2] || turnCredential;
                
                if (username && credential) {
                    iceServers.push({
                        urls: urlStr,
                        username: username,
                        credential: credential
                    });
                    console.log(`Added TURN server: ${urlStr.substring(0, 30)}...`);
                } else {
                    // If no credentials, add as STUN-only
                    iceServers.push({ urls: urlStr });
                }
            });
        } else {
            // Fallback to free TURN servers if no custom ones configured
            iceServers.push(
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            );
        }
    }
    
    res.json({ iceServers });
});

// Room status endpoint
app.get('/room/:roomId/status', (req, res) => {
    const room = rooms[req.params.roomId];
    if (room) {
        res.json({
            roomId: req.params.roomId,
            hostId: room.hostId,
            participantCount: Object.keys(room.participants).length,
            participants: Object.values(room.participants).map(p => ({
                id: p.id,
                isHost: p.id === room.hostId,
                joinedAt: p.joinedAt
            }))
        });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// WebRTC signaling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Store user metadata
    let currentRoom = null;
    let isHost = false;
    let userName = `User-${Math.floor(Math.random() * 1000)}`;

    // Join room handler
    socket.on('join', (data) => {
        // Handle both string and object formats for backward compatibility
        const roomId = typeof data === 'string' ? data : data.roomId;
        let joinAsHost = typeof data === 'object' && data.isHost;
        const name = typeof data === 'object' && data.userName ? data.userName : userName;
        
        userName = name;
        
        console.log(`User ${socket.id} (${name}) joining room ${roomId} as ${joinAsHost ? 'host' : 'participant'}`);
        
        // Leave any previous rooms
        if (currentRoom) {
            leaveCurrentRoom();
        }
        
        // Join the new room
        socket.join(roomId);
        currentRoom = roomId;
        
        // Extract access code from join data
        // Support both 'accessCode' and 'providedAccessCode' for compatibility
        const providedAccessCode = typeof data === 'object' ? (data.accessCode || data.providedAccessCode) : null;
        const roomAccessCode = typeof data === 'object' ? data.roomAccessCode : null;
        const roomHostCode = typeof data === 'object' ? data.roomHostCode : null;
        
        // Debug logging
        console.log(`Join request - Room: ${roomId}, AccessCode: ${providedAccessCode ? '***' : 'none'}, RoomHostCode: ${roomHostCode ? '***' : 'none'}, RoomAccessCode: ${roomAccessCode ? '***' : 'none'}, JoinAsHost: ${joinAsHost}`);
        
        // Create or update room data
        if (!rooms[roomId]) {
            // Room doesn't exist - check if user is providing codes to recreate the room
            // Priority: roomHostCode from join data > providedAccessCode if joinAsHost is true
            // If roomHostCode is provided, use it; otherwise, if joinAsHost is true and providedAccessCode exists, use it as hostCode
            const finalHostCode = roomHostCode || (joinAsHost && providedAccessCode ? providedAccessCode : null);
            const finalAccessCode = roomAccessCode || null;
            
            rooms[roomId] = {
                hostId: null, // Will be set after validation
                participants: {},
                accessCode: finalAccessCode,
                hostCode: finalHostCode,
                locked: false
            };
            
            // When creating a room as host, if joinAsHost is true and roomHostCode is provided, 
            // automatically set as host without requiring providedAccessCode validation
            if (joinAsHost && roomHostCode) {
                // User is creating the room as host with a host code - automatically set as host
                rooms[roomId].hostId = socket.id;
            } else if (finalHostCode && providedAccessCode && finalHostCode === providedAccessCode) {
                // Host code matches provided code - validate and set as host
                joinAsHost = true;
                rooms[roomId].hostId = socket.id;
            } else if (finalHostCode && providedAccessCode && finalHostCode !== providedAccessCode) {
                // Host code exists but doesn't match - this is an error
                socket.emit('join-error', {
                    error: 'INVALID_HOST_CODE',
                    message: 'The host code you entered is incorrect. Please enter the correct host code.'
                });
                return;
            } else if (finalHostCode && !providedAccessCode && !joinAsHost) {
                // Host code exists but no code provided and user is not joining as host - require it
                socket.emit('join-error', {
                    error: 'INVALID_HOST_CODE',
                    message: 'This meeting requires a host code. Please enter the host code to join.'
                });
                return;
            }
            // If no hostCode is set, first participant becomes host (unless they're joining as participant)
            if (!finalHostCode && joinAsHost) {
                rooms[roomId].hostId = socket.id;
            }
        } else {
            // Room exists - check access code if required
            if (rooms[roomId].accessCode || rooms[roomId].hostCode) {
                // Room has an access code or host code - validate it
                let codeValid = false;
                
                // First, check if provided code matches host code (if host code exists)
                if (rooms[roomId].hostCode && providedAccessCode && rooms[roomId].hostCode === providedAccessCode) {
                    // Valid host code - user is joining as host
                    joinAsHost = true;
                    rooms[roomId].hostId = socket.id;
                    codeValid = true;
                } else if (rooms[roomId].accessCode && providedAccessCode && rooms[roomId].accessCode === providedAccessCode) {
                    // Valid participant code - join as participant
                    joinAsHost = false;
                    codeValid = true;
                }
                
                // If no valid code was provided, emit error
                if (!codeValid) {
                    // Determine which error to show based on what codes exist
                    if (rooms[roomId].hostCode && !rooms[roomId].accessCode) {
                        // Only host code exists
                        socket.emit('join-error', {
                            error: 'INVALID_HOST_CODE',
                            message: 'This meeting requires a host code. Please enter the host code to join.'
                        });
                    } else if (rooms[roomId].accessCode && !rooms[roomId].hostCode) {
                        // Only participant code exists
                        socket.emit('join-error', {
                            error: 'INVALID_ACCESS_CODE',
                            message: 'This meeting requires an access code. Please enter the access code to join.'
                        });
                    } else {
                        // Both codes exist - generic message
                        socket.emit('join-error', {
                            error: 'INVALID_ACCESS_CODE',
                            message: 'This meeting requires an access code. Please enter your participant code or host code.'
                        });
                    }
                    return;
                }
            }
            
            // If there's no host and this user is joining as host with valid credentials
            if (joinAsHost && !rooms[roomId].hostId) {
                rooms[roomId].hostId = socket.id;
            }
        }
        
        // Update isHost based on joinAsHost (after validation)
        isHost = joinAsHost;
        
        // Add participant data
        rooms[roomId].participants[socket.id] = {
            id: socket.id,
            name: name,
            isHost: isHost,
            joinedAt: new Date()
        };
        
        // Get list of existing users to send to the new participant
        const existingParticipants = Object.values(rooms[roomId].participants);
        
        // Notify the new user about the room and its participants
        socket.emit('room-joined', {
            roomId: roomId,
            participants: existingParticipants,
            hostId: rooms[roomId].hostId,
            you: socket.id
        });
        
        // Notify others in the room about the new user
        socket.to(roomId).emit('user-joined', {
            userId: socket.id,
            name: name,
            isHost: isHost
        });
        
        // Log room status
        console.log(`Room ${roomId}: ${existingParticipants.length} participants, host: ${rooms[roomId].hostId}`);
    });

    // Update user info
    socket.on('update-user', (data) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        
        if (data.name) {
            userName = data.name;
            if (rooms[currentRoom].participants[socket.id]) {
                rooms[currentRoom].participants[socket.id].name = data.name;
            }
        }
        
        // Broadcast the updated user info to everyone in the room
        io.to(currentRoom).emit('user-updated', {
            userId: socket.id,
            name: userName,
            isHost: isHost
        });
    });

    // Signaling handlers
    socket.on('offer', (data) => {
        console.log(`Relaying offer from ${socket.id} to ${data.targetUserId || 'room'} in ${data.roomId}`);
        
        // If targetUserId is specified, send only to that user, otherwise broadcast to the room
        if (data.targetUserId) {
            socket.to(data.targetUserId).emit('offer', {
                ...data,
                senderId: socket.id
            });
        } else {
            socket.to(data.roomId).emit('offer', {
                ...data,
                senderId: socket.id
            });
        }
    });

    socket.on('answer', (data) => {
        console.log(`Relaying answer from ${socket.id} to ${data.targetUserId || 'room'} in ${data.roomId}`);
        
        // If targetUserId is specified, send only to that user
        if (data.targetUserId) {
            socket.to(data.targetUserId).emit('answer', {
                ...data,
                senderId: socket.id
            });
        } else {
            socket.to(data.roomId).emit('answer', {
                ...data,
                senderId: socket.id
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        console.log(`Relaying ICE candidate from ${socket.id} to ${data.targetUserId || 'room'} in ${data.roomId}`);
        
        // If targetUserId is specified, send only to that user
        if (data.targetUserId) {
            socket.to(data.targetUserId).emit('ice-candidate', {
                ...data,
                senderId: socket.id
            });
        } else {
            socket.to(data.roomId).emit('ice-candidate', {
                ...data,
                senderId: socket.id
            });
        }
    });

    // Chat message handler
    socket.on('chat-message', (data) => {
        if (!currentRoom || !rooms[currentRoom]) {
            return;
        }
        
        const senderInfo = rooms[currentRoom].participants[socket.id];
        const senderName = senderInfo ? senderInfo.name : 'Unknown';
        
        console.log(`Chat message from ${senderName} (${socket.id}) in room ${currentRoom}`);
        
        // Broadcast message to everyone in the room except sender
        socket.to(currentRoom).emit('chat-message', {
            senderId: socket.id,
            senderName: senderName,
            message: data.message,
            timestamp: new Date().toISOString()
        });
    });

    // Function to handle leaving the current room
    function leaveCurrentRoom() {
        if (!currentRoom || !rooms[currentRoom]) return;
        
        // Remove user from the room
        socket.leave(currentRoom);
        
        // Check if user was the host
        const wasHost = rooms[currentRoom].hostId === socket.id;
        
        // Remove participant from the room data
        delete rooms[currentRoom].participants[socket.id];
        
        // Notify others in the room
        socket.to(currentRoom).emit('user-left', {
            userId: socket.id,
            wasHost: wasHost
        });
        
        // If this was the host, assign a new host if possible
        if (wasHost) {
            const remainingParticipants = Object.keys(rooms[currentRoom].participants);
            if (remainingParticipants.length > 0) {
                // Assign the first remaining participant as the new host
                const newHostId = remainingParticipants[0];
                rooms[currentRoom].hostId = newHostId;
                rooms[currentRoom].participants[newHostId].isHost = true;
                
                // Notify everyone about the new host
                io.to(currentRoom).emit('host-changed', {
                    newHostId: newHostId,
                    previousHostId: socket.id
                });
                
                console.log(`New host for room ${currentRoom}: ${newHostId}`);
            }
        }
        
        // Clean up empty rooms
        const participantsCount = Object.keys(rooms[currentRoom].participants).length;
        if (participantsCount === 0) {
            console.log(`Room ${currentRoom} is now empty, cleaning up`);
            delete rooms[currentRoom];
        } else {
            console.log(`Room ${currentRoom} now has ${participantsCount} participant(s)`);
        }
        
        // Reset user state
        currentRoom = null;
        isHost = false;
    }

    // Explicit leave room event
    socket.on('leave-room', () => {
        if (currentRoom) {
            console.log(`User ${socket.id} explicitly leaving room ${currentRoom}`);
            leaveCurrentRoom();
        }
    });

    // Disconnection handler
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Handle room cleanup if user was in a room
        if (currentRoom) {
            leaveCurrentRoom();
        }
    });
});

// Start the server
http.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`- Local URL: http://localhost:${PORT}`);
    console.log('- For production use, ensure you are using HTTPS');
    console.log('- WebRTC features require HTTPS except on localhost');
}); 