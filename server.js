const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Track rooms and users globally
const rooms = {};

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
        const joinAsHost = typeof data === 'object' && data.isHost;
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
        isHost = joinAsHost;
        
        // Create or update room data
        if (!rooms[roomId]) {
            rooms[roomId] = {
                hostId: joinAsHost ? socket.id : null,
                participants: {}
            };
        } else if (joinAsHost && !rooms[roomId].hostId) {
            // If there's no host and this user is joining as host
            rooms[roomId].hostId = socket.id;
        }
        
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