const socket = io();
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const hostBtn = document.getElementById('hostBtn');
const joinBtn = document.getElementById('joinBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const leaveBtn = document.getElementById('leaveBtn');
const roomCodeEl = document.getElementById('roomCode');
const shareLinkEl = document.getElementById('shareLink');

let localStream;
let remoteStream;
let peerConnection;
let roomId;
let isHost = false;

// Add more STUN/TURN servers for better connectivity
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

hostBtn.addEventListener('click', async () => {
  isHost = true;
  roomId = generateRoomId();
  
  try {
    // Get media access first
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    
    // Then join room and setup connection
    socket.emit('join', roomId);
    document.getElementById('home').style.display = 'none';
    document.getElementById('meeting').style.display = 'block';
    document.getElementById('shareInfo').style.display = 'block';
    roomCodeEl.textContent = roomId;
    shareLinkEl.textContent = `${window.location.origin}/?room=${roomId}`;
    
    // Initialize connection after we have media
    startConnection();
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access camera/microphone. Please check permissions and try again.');
  }
});

joinBtn.addEventListener('click', async () => {
  roomId = prompt('Enter the room code:');
  if (roomId) {
    try {
      // Get media access first for the joiner too
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      
      // Then join and setup connection
      socket.emit('join', roomId);
      document.getElementById('home').style.display = 'none';
      document.getElementById('meeting').style.display = 'block';
      
      // Initialize connection after we have media
      startConnection();
    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Could not access camera/microphone. Please check permissions and try again.');
    }
  }
});

shareScreenBtn.addEventListener('click', async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    localVideo.srcObject = localStream;
    
    // Get all video senders to replace tracks
    const videoSenders = peerConnection.getSenders().filter(s => s.track && s.track.kind === 'video');
    for (const sender of videoSenders) {
      sender.replaceTrack(localStream.getVideoTracks()[0]);
    }
    
    shareScreenBtn.style.display = 'none';
    stopShareBtn.style.display = 'inline-block';
    
    // Listen for the "ended" event (user clicks "Stop sharing")
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopSharing();
    });
  } catch (error) {
    console.error('Error sharing screen:', error);
    alert('Could not share screen. Please check permissions and try again.');
  }
});

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  // Reacquire camera/mic after stopping screen share
  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
      localStream = stream;
      localVideo.srcObject = localStream;
      
      // Replace tracks in all senders
      const videoSenders = peerConnection.getSenders().filter(s => s.track && s.track.kind === 'video');
      for (const sender of videoSenders) {
        sender.replaceTrack(localStream.getVideoTracks()[0]);
      }
      
      shareScreenBtn.style.display = 'inline-block';
      stopShareBtn.style.display = 'none';
    })
    .catch(error => {
      console.error('Error getting user media after screen share:', error);
    });
}

stopShareBtn.addEventListener('click', stopSharing);

leaveBtn.addEventListener('click', () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  if (peerConnection) {
    peerConnection.close();
  }
  document.getElementById('home').style.display = 'block';
  document.getElementById('meeting').style.display = 'none';
  document.getElementById('shareInfo').style.display = 'none';
  socket.disconnect();
  window.location.reload(); // Completely refresh the page for a clean start
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 7);
}

function startConnection() {
  if (peerConnection) {
    peerConnection.close();
  }
  
  peerConnection = new RTCPeerConnection(configuration);
  console.log("PeerConnection created with config:", configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Sending ICE candidate:", event.candidate);
      socket.emit('ice-candidate', { roomId, candidate: event.candidate });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", peerConnection.iceConnectionState);
  };

  peerConnection.ontrack = (event) => {
    console.log("Remote track received:", event.streams[0]);
    remoteVideo.srcObject = event.streams[0];
  };

  if (localStream) {
    console.log("Adding local tracks to peer connection");
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  } else {
    console.error("No local stream available when starting connection");
  }

  // New joiner waits for offer from host
  if (!isHost) {
    console.log("Joined as participant, waiting for offer");
  }

  socket.on('user-connected', (userId) => {
    console.log('User connected:', userId);
    
    // If we're the host, send an offer when a new user connects
    if (isHost) {
      console.log("Creating offer as host");
      peerConnection.createOffer()
        .then(offer => {
          console.log("Setting local description:", offer);
          return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
          console.log("Sending offer to room:", roomId);
          socket.emit('offer', { roomId, sdp: peerConnection.localDescription });
        })
        .catch(error => console.error('Error creating offer:', error));
    }
  });

  socket.on('offer', (data) => {
    if (!isHost) {
      console.log("Received offer:", data.sdp);
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(() => {
          console.log("Creating answer");
          return peerConnection.createAnswer();
        })
        .then(answer => {
          console.log("Setting local description:", answer);
          return peerConnection.setLocalDescription(answer);
        })
        .then(() => {
          console.log("Sending answer");
          socket.emit('answer', { roomId, sdp: peerConnection.localDescription });
        })
        .catch(error => console.error('Error handling offer:', error));
    }
  });

  socket.on('answer', (data) => {
    if (isHost) {
      console.log("Received answer:", data.sdp);
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .catch(error => console.error('Error handling answer:', error));
    }
  });

  socket.on('ice-candidate', (data) => {
    console.log("Received ICE candidate:", data.candidate);
    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
      .catch(error => console.error('Error adding ICE candidate:', error));
  });

  socket.on('user-disconnected', (userId) => {
    console.log('User disconnected:', userId);
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject.getTracks().forEach(track => track.stop());
      remoteVideo.srcObject = null;
    }
  });
}

// Check URL for room parameter on load
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  
  if (roomFromUrl) {
    roomId = roomFromUrl;
    joinBtn.click(); // Simulate click on join button
  } else if (window.location.hash) {
    roomId = window.location.hash.substring(1);
    joinBtn.click(); // Simulate click on join button
  }
});

// Debug WebRTC issues to the console
window.onerror = function(message, source, lineno, colno, error) {
  console.error("Global error:", message, "at", source, lineno, colno, error);
}; 