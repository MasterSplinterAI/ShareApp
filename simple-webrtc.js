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
let peerConnection;
let roomId;
let isHost = false;

// Simple configuration with just one STUN server
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Add event listeners after checking WebRTC support
document.addEventListener('DOMContentLoaded', function() {
  // Check for WebRTC support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Your browser does not support WebRTC. Please use Chrome, Firefox, Safari, or Edge.');
    disableButtons();
    return;
  }

  checkInitialPermissions();
  
  // Set up button event listeners
  hostBtn.addEventListener('click', hostMeeting);
  joinBtn.addEventListener('click', joinMeeting);
  shareScreenBtn.addEventListener('click', shareScreen);
  stopShareBtn.addEventListener('click', stopSharing);
  leaveBtn.addEventListener('click', leaveMeeting);
});

function checkInitialPermissions() {
  // Check if permissions are already granted
  navigator.permissions.query({name: 'camera'})
    .then(permissionStatus => {
      console.log('Camera permission status:', permissionStatus.state);
      if (permissionStatus.state === 'granted') {
        console.log('Camera permission already granted');
      } else {
        console.log('Camera permission not yet granted');
      }
    })
    .catch(error => {
      console.error('Error checking camera permission:', error);
    });
}

// Function to host a meeting
async function hostMeeting() {
  isHost = true;
  roomId = generateRoomId();
  
  try {
    console.log('Requesting user media...');
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    console.log('Got local stream:', localStream);
    
    localVideo.srcObject = localStream;
    
    socket.emit('join', roomId);
    document.getElementById('home').style.display = 'none';
    document.getElementById('meeting').style.display = 'block';
    document.getElementById('shareInfo').style.display = 'block';
    roomCodeEl.textContent = roomId;
    shareLinkEl.textContent = `${window.location.origin}/?room=${roomId}`;
    
    setupPeerConnection();
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access camera or microphone. Please ensure you have allowed permissions and try again.');
  }
}

// Function to join a meeting
async function joinMeeting() {
  roomId = prompt('Enter the room code:');
  if (!roomId) return;
  
  try {
    console.log('Joining room:', roomId);
    console.log('Requesting user media...');
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    console.log('Got local stream:', localStream);
    
    localVideo.srcObject = localStream;
    
    socket.emit('join', roomId);
    document.getElementById('home').style.display = 'none';
    document.getElementById('meeting').style.display = 'block';
    
    setupPeerConnection();
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access camera or microphone. Please ensure you have allowed permissions and try again.');
  }
}

// Function to set up peer connection
function setupPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);
  console.log('Created peer connection with config:', configuration);
  
  // Add event handlers
  peerConnection.onicecandidate = handleICECandidate;
  peerConnection.oniceconnectionstatechange = handleICEConnectionStateChange;
  peerConnection.ontrack = handleTrack;
  
  // Add local tracks to the connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }
  
  // Set up socket event handlers
  socket.on('user-connected', handleUserConnected);
  socket.on('offer', handleOffer);
  socket.on('answer', handleAnswer);
  socket.on('ice-candidate', handleNewICECandidate);
  socket.on('user-disconnected', handleUserDisconnected);
}

// ICE Candidate handler
function handleICECandidate(event) {
  if (event.candidate) {
    console.log('Sending ICE candidate:', event.candidate);
    socket.emit('ice-candidate', {
      roomId: roomId,
      candidate: event.candidate
    });
  }
}

// ICE Connection State Change handler
function handleICEConnectionStateChange() {
  console.log('ICE connection state changed to:', peerConnection.iceConnectionState);
  document.getElementById('connectionStatus').textContent = 
    `Connection Status: ${peerConnection.iceConnectionState}`;
}

// Remote Track handler
function handleTrack(event) {
  console.log('Received remote track:', event.streams[0]);
  remoteVideo.srcObject = event.streams[0];
}

// User Connected handler
function handleUserConnected(userId) {
  console.log('User connected:', userId);
  if (isHost) {
    createAndSendOffer();
  }
}

// Create and send offer (if host)
function createAndSendOffer() {
  console.log('Creating offer as host');
  peerConnection.createOffer()
    .then(offer => {
      console.log('Setting local description:', offer);
      return peerConnection.setLocalDescription(offer);
    })
    .then(() => {
      console.log('Sending offer');
      socket.emit('offer', {
        roomId: roomId,
        sdp: peerConnection.localDescription
      });
    })
    .catch(error => console.error('Error creating offer:', error));
}

// Handle incoming offer
function handleOffer(data) {
  if (!isHost) {
    console.log('Received offer:', data.sdp);
    peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(() => {
        console.log('Creating answer');
        return peerConnection.createAnswer();
      })
      .then(answer => {
        console.log('Setting local description:', answer);
        return peerConnection.setLocalDescription(answer);
      })
      .then(() => {
        console.log('Sending answer');
        socket.emit('answer', {
          roomId: roomId,
          sdp: peerConnection.localDescription
        });
      })
      .catch(error => console.error('Error handling offer:', error));
  }
}

// Handle incoming answer
function handleAnswer(data) {
  if (isHost) {
    console.log('Received answer:', data.sdp);
    peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .catch(error => console.error('Error handling answer:', error));
  }
}

// Handle incoming ICE candidate
function handleNewICECandidate(data) {
  console.log('Received ICE candidate:', data.candidate);
  peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
    .catch(error => console.error('Error adding ICE candidate:', error));
}

// Handle user disconnected
function handleUserDisconnected(userId) {
  console.log('User disconnected:', userId);
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }
}

// Function to share screen
async function shareScreen() {
  try {
    console.log('Requesting screen sharing...');
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: true 
    });
    console.log('Got screen sharing stream:', screenStream);
    
    localVideo.srcObject = screenStream;
    
    // Replace track in peer connection
    const videoSenders = peerConnection.getSenders().filter(s => s.track && s.track.kind === 'video');
    if (videoSenders.length > 0) {
      videoSenders[0].replaceTrack(screenStream.getVideoTracks()[0]);
    }
    
    shareScreenBtn.style.display = 'none';
    stopShareBtn.style.display = 'inline-block';
    
    // Handle when user stops sharing
    screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopSharing();
    });
  } catch (error) {
    console.error('Error sharing screen:', error);
    alert('Could not share screen. Please ensure you have allowed permissions and try again.');
  }
}

// Function to stop sharing
function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
      localStream = stream;
      localVideo.srcObject = stream;
      
      // Replace video track
      const videoSenders = peerConnection.getSenders().filter(s => s.track && s.track.kind === 'video');
      if (videoSenders.length > 0) {
        videoSenders[0].replaceTrack(stream.getVideoTracks()[0]);
      }
      
      shareScreenBtn.style.display = 'inline-block';
      stopShareBtn.style.display = 'none';
    })
    .catch(error => {
      console.error('Error getting user media after screen share:', error);
    });
}

// Function to leave meeting
function leaveMeeting() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  if (peerConnection) {
    peerConnection.close();
  }
  
  socket.disconnect();
  
  document.getElementById('home').style.display = 'block';
  document.getElementById('meeting').style.display = 'none';
  document.getElementById('shareInfo').style.display = 'none';
  
  // Reload page for a clean start
  window.location.reload();
}

// Generate random room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 7);
}

// Disable all buttons
function disableButtons() {
  hostBtn.disabled = true;
  joinBtn.disabled = true;
  shareScreenBtn.disabled = true;
  stopShareBtn.disabled = true;
  leaveBtn.disabled = true;
}

// Check URL parameters on load
window.addEventListener('load', () => {
  // Add a connection status element
  const statusDiv = document.createElement('div');
  statusDiv.id = 'connectionStatus';
  statusDiv.textContent = 'Connection Status: Not connected';
  statusDiv.style.padding = '10px';
  statusDiv.style.backgroundColor = '#f8f9fa';
  statusDiv.style.margin = '10px 0';
  statusDiv.style.borderRadius = '5px';
  document.getElementById('controls').appendChild(statusDiv);
  
  // Check for room in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  
  if (roomFromUrl) {
    roomId = roomFromUrl;
    setTimeout(() => joinBtn.click(), 1000); // Delay to ensure DOM is fully loaded
  } else if (window.location.hash) {
    roomId = window.location.hash.substring(1);
    setTimeout(() => joinBtn.click(), 1000);
  }
}); 