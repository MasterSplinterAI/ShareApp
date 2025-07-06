// WebRTC peer connection module for managing peer-to-peer connections
import { sendOffer, sendAnswer, sendIceCandidate, getSocketId } from '../services/socket.js';
import { showError } from '../ui/notifications.js';

// ICE server configuration with TURN servers for international connectivity
const iceServers = [
  // Google STUN servers
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  
  // Additional STUN servers for better connectivity
  { urls: 'stun:stun.services.mozilla.com' },
  { urls: 'stun:stun.ekiga.net' },
  
  // Free TURN servers for international users (when direct connection fails)
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
];

// Create a new peer connection with a remote peer
export function createPeerConnection(peerId) {
  try {
    console.log(`Creating peer connection for ${peerId}`);
    
    // Create a new RTCPeerConnection with enhanced options for echo cancelation
    const pc = new RTCPeerConnection({ 
      iceServers,
      // Enable built-in echo cancellation and noise suppression
      sdpSemantics: 'unified-plan',
      // Enable all audio processing options
      // These help prevent echo/feedback
      rtcAudioJitterBufferMaxPackets: 50,
      rtcAudioJitterBufferFastAccelerate: true
    });
    
    // Store the connection in the app state
    window.appState.peerConnections[peerId] = pc;
    
    // Add local stream tracks to the connection
    if (window.appState.localStream) {
      const tracks = window.appState.localStream.getTracks();
      if (tracks.length > 0) {
        tracks.forEach(track => {
          console.log(`Adding track to peer connection: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
          
          // Check if the track is in a valid state
          if (track.readyState === 'ended') {
            console.warn(`Track ${track.kind} is in ended state, cannot use it`);
            // We'll refresh the track below in the async code
          } else {
            // Enhanced echo cancellation for audio tracks
            if (track.kind === 'audio' && track.getConstraints) {
              try {
                // Make sure echo cancellation is enabled on the track itself
                const constraints = track.getConstraints() || {};
                if (!constraints.echoCancellation) {
                  track.applyConstraints({
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                  }).catch(err => console.log('Could not apply audio constraints:', err));
                }
              } catch (err) {
                console.log('Error applying echo cancellation constraints:', err);
              }
            }
            
            console.log(`Adding ${track.kind} track to connection (state: ${track.readyState})`);
            pc.addTrack(track, window.appState.localStream);
          }
        });
        
        // Check if we have any ended audio tracks that need to be refreshed
        const hasEndedAudioTrack = tracks.some(track => 
          track.kind === 'audio' && track.readyState === 'ended'
        );
        
        if (hasEndedAudioTrack) {
          console.warn('Found ended audio track, getting a fresh one');
          refreshAudioAndAddToPeerConnection(pc, peerId);
        }
      } else {
        console.warn('Local stream has no tracks to add to peer connection');
        // Try to get fresh audio
        refreshAudioAndAddToPeerConnection(pc, peerId);
      }
    } else {
      console.warn('No local stream available when creating peer connection');
      
      // Try to get a fresh audio track for audio-only mode
      if (!window.appState.viewOnlyMode) {
        refreshAudioAndAddToPeerConnection(pc, peerId);
      }
    }
    
    // Function to refresh audio and add it to peer connection
    async function refreshAudioAndAddToPeerConnection(peerConnection, targetPeerId) {
      console.log('Attempting to get fresh audio for peer connection');
      try {
        // Try to get fresh audio directly here to avoid delay
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          console.log(`Got fresh audio track: ${audioTrack.label}, state: ${audioTrack.readyState}`);
          
          // Add this track to the peer connection
          if (window.appState.peerConnections[targetPeerId]) {
            // Add the track to the local stream first if it exists
            if (window.appState.localStream) {
              // Remove any existing audio tracks
              window.appState.localStream.getAudioTracks().forEach(track => {
                window.appState.localStream.removeTrack(track);
                track.stop();
              });
              
              // Add the new track
              window.appState.localStream.addTrack(audioTrack);
            } else {
              // Create a new stream with this track
              window.appState.localStream = new MediaStream([audioTrack]);
            }
            
            // Add to the peer connection
            peerConnection.addTrack(audioTrack, window.appState.localStream);
            console.log('Added fresh audio track to peer connection');
            
            // Store for future use
            window.persistentAudioStream = audioStream.clone();
            
            // Renegotiate the connection after a short delay
            setTimeout(() => {
              // Import dynamically to avoid circular dependencies
              import('../services/socket.js').then(({ sendRenegotiationOffer }) => {
                if (typeof sendRenegotiationOffer === 'function' && 
                    window.appState.peerConnections[targetPeerId]) {
                  peerConnection.createOffer().then(offer => {
                    peerConnection.setLocalDescription(offer).then(() => {
                      sendRenegotiationOffer(targetPeerId, peerConnection.localDescription);
                    });
                  });
                }
              });
            }, 500);
          }
        }
      } catch (err) {
        console.error('Failed to get fresh audio for peer connection:', err);
        
        // Fall back to the import approach if direct approach fails
        try {
          // Import the refreshAudioTrack function dynamically to avoid circular dependencies
          import('../utils/mediaHelpers.js').then(({ refreshAudioTrack }) => {
            if (typeof refreshAudioTrack === 'function') {
              refreshAudioTrack().then(track => {
                if (track && window.appState.peerConnections[targetPeerId]) {
                  console.log('Got fresh audio track via refreshAudioTrack()');
                  window.appState.peerConnections[targetPeerId].addTrack(track, window.appState.localStream);
                  
                  // Renegotiate the connection
                  import('../services/socket.js').then(({ sendRenegotiationOffer }) => {
                    if (typeof sendRenegotiationOffer === 'function' && 
                        window.appState.peerConnections[targetPeerId]) {
                      peerConnection.createOffer().then(offer => {
                        peerConnection.setLocalDescription(offer).then(() => {
                          sendRenegotiationOffer(targetPeerId, peerConnection.localDescription);
                        });
                      });
                    }
                  });
                }
              });
            }
          });
        } catch (err) {
          console.error('Failed to get fresh audio via import approach:', err);
        }
      }
    }
    
    // Handle ICE candidates with detailed logging for debugging
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Log candidate type for debugging international connectivity
        const candidate = event.candidate;
        const candidateType = candidate.type || 'unknown';
        const protocol = candidate.protocol || 'unknown';
        const address = candidate.address || candidate.ip || 'unknown';
        
        console.log(`🔄 Sending ICE candidate to ${peerId}: type=${candidateType}, protocol=${protocol}, address=${address.substring(0, 10)}...`);
        
        // Special logging for TURN candidates (important for international users)
        if (candidate.candidate && candidate.candidate.includes('relay')) {
          console.log(`🌐 TURN relay candidate generated for ${peerId} - this helps with restrictive firewalls`);
        }
        
        sendIceCandidate(peerId, event.candidate);
      } else {
        console.log(`✅ ICE gathering complete for ${peerId}`);
      }
    };
    
    // Log ICE connection state changes with detailed debugging
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${peerId}: ${pc.iceConnectionState}`);
      
      // Log detailed connection info for debugging international issues
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        pc.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              console.log(`✅ Connection established via ${report.localCandidateId} -> ${report.remoteCandidateId}`);
            }
          });
        });
      }
      
      // Handle connection failures with more aggressive retry
      if (pc.iceConnectionState === 'failed') {
        console.warn(`❌ ICE connection failed with ${peerId}, attempting restart`);
        pc.restartIce();
      } else if (pc.iceConnectionState === 'disconnected') {
        console.warn(`⚠️ ICE connection disconnected with ${peerId}, will retry in 3 seconds`);
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            console.log(`Restarting ICE for ${peerId} after disconnect`);
            pc.restartIce();
          }
        }, 3000);
      }
    };
    
    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log(`Received track from ${peerId}: ${event.track.kind}, enabled: ${event.track.enabled}, readyState: ${event.track.readyState}`);
      console.log(`Peer connection state: ${pc.connectionState}, ICE state: ${pc.iceConnectionState}, signaling state: ${pc.signalingState}`);
      
      // IMPORTANT: Prevent local echo by not playing our own audio back to us
      const currentUserId = getSocketId();
      if (peerId === currentUserId && event.track.kind === 'audio') {
        console.log('Ignoring our own audio track to prevent echo');
        return; // Don't process our own audio to prevent echo
      }
      
      // For debugging purposes, log all current peer connections
      console.log('Current peer connections:');
      Object.entries(window.appState.peerConnections).forEach(([id, conn]) => {
        console.log(`- Peer ${id}: connection state ${conn.connectionState}, ICE state ${conn.iceConnectionState}`);
      });
      
      // Create or get the video container for this peer
      let videoContainer = document.getElementById(`video-container-${peerId}`);
      if (!videoContainer) {
        console.log(`Creating new video container for peer ${peerId}`);
        videoContainer = createVideoContainerForPeer(peerId);
      } else {
        console.log(`Using existing video container for peer ${peerId}`);
      }
      
      // If we couldn't create a container, exit early
      if (!videoContainer) {
        console.error(`Failed to create or find video container for peer ${peerId}`);
        return;
      }
      
      // If this is a video track
      if (event.track.kind === 'video') {
        console.log(`Processing video track from peer ${peerId}`);
        
        // Get or create the video element
        let remoteVideo = document.getElementById(`video-${peerId}`);
        if (!remoteVideo) {
          remoteVideo = videoContainer.querySelector('video');
          if (!remoteVideo) {
            console.log(`Creating new video element for peer ${peerId}`);
            remoteVideo = document.createElement('video');
            remoteVideo.id = `video-${peerId}`;
            remoteVideo.className = 'w-full h-full object-cover';
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            videoContainer.appendChild(remoteVideo);
          }
        }
        
        // Get the stream from the video element or create a new one
        let stream = remoteVideo.srcObject;
        if (!stream) {
          console.log(`Creating new MediaStream for peer ${peerId}`);
          stream = new MediaStream();
          remoteVideo.srcObject = stream;
        } else {
          console.log(`Using existing stream for peer ${peerId}`);
          // Log existing tracks
          stream.getTracks().forEach(track => {
            console.log(`- Existing track in stream: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
          });
        }
        
        // Check if we already have a video track and replace it
        const existingVideoTrack = stream.getVideoTracks()[0];
        if (existingVideoTrack) {
          console.log(`Replacing existing video track for peer ${peerId}`);
          stream.removeTrack(existingVideoTrack);
        }
        
        // Add the new video track
        console.log(`Adding video track to stream for peer ${peerId}`);
        stream.addTrack(event.track);
        
        // Hide the placeholder since we now have video
        const placeholder = videoContainer.querySelector('.no-video-placeholder');
        if (placeholder) {
          console.log(`Hiding placeholder for peer ${peerId} as video is available`);
          placeholder.classList.add('hidden');
        }
        
        // Force remoteVideo element to update its srcObject to trigger playback
        remoteVideo.srcObject = null;
        remoteVideo.srcObject = stream;
        
        // Mark this participant as having video available
        if (window.appState.participants[peerId]) {
          window.appState.participants[peerId].hasVideo = true;
        }
        
        // Special handling for main view update
        const isHostPeer = window.appState.participants[peerId]?.isHost || false;
        
        // If this is the host and no other pinned participant, pin this peer
        if (isHostPeer && window.appState.pinnedParticipant === 'local') {
          console.log(`Auto-pinning host: ${peerId}`);
          window.appState.pinnedParticipant = peerId;
          document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
        }
        // Or if this is the first peer and no other pinned participant
        else if (Object.keys(window.appState.peerConnections).length === 1 && 
            window.appState.pinnedParticipant === 'local') {
          console.log(`Auto-pinning first peer: ${peerId}`);
          window.appState.pinnedParticipant = peerId;
          document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
        }
        
        // Update main video if this peer is the pinned participant
        if (window.appState.pinnedParticipant === peerId) {
          console.log(`Updating main video with pinned peer: ${peerId}`);
          
          // Dynamically import to avoid circular dependencies
          import('../ui/video.js').then(({ debouncedUpdateMainVideo }) => {
            if (typeof debouncedUpdateMainVideo === 'function') {
              debouncedUpdateMainVideo();
            }
          });
        }
        
        // Ensure the video is playing
        remoteVideo.play().catch(err => {
          console.warn(`Could not auto-play video for peer ${peerId}:`, err);
          
          // Try again with user interaction
          document.addEventListener('click', function playOnClick() {
            remoteVideo.play().catch(e => console.warn('Still cannot play video:', e));
            document.removeEventListener('click', playOnClick);
          }, { once: true });
        });
        
        // Log the status after adding the track
        console.log(`Video element for peer ${peerId} updated:`, {
          srcObject: remoteVideo.srcObject ? 'Set' : 'Not set',
          videoWidth: remoteVideo.videoWidth,
          videoHeight: remoteVideo.videoHeight,
          paused: remoteVideo.paused,
          networkState: remoteVideo.networkState,
          readyState: remoteVideo.readyState
        });
      }
      // If this is an audio track
      else if (event.track.kind === 'audio') {
        handleAudioTrack(event.track, peerId);
        
        // If we only have audio so far, make sure placeholder is visible
        let hasExistingVideo = false;
        
        // Get the video element if it exists
        const remoteVideo = document.getElementById(`video-${peerId}`);
        if (remoteVideo && remoteVideo.srcObject) {
          // Check if the stream has active video tracks
          hasExistingVideo = remoteVideo.srcObject.getVideoTracks().some(track => 
            track.readyState === 'live' && track.enabled
          );
        }
        
        if (!hasExistingVideo) {
          const placeholder = videoContainer.querySelector('.no-video-placeholder');
          if (!placeholder) {
            console.log(`Creating placeholder for audio-only peer ${peerId}`);
            const newPlaceholder = document.createElement('div');
            newPlaceholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800';
            newPlaceholder.innerHTML = '<i class="fas fa-user-circle text-gray-400 text-4xl"></i>';
            videoContainer.appendChild(newPlaceholder);
          } else {
            placeholder.classList.remove('hidden');
          }
        }
      }
    };
    
    // Helper function to create a video container for a peer
    function createVideoContainerForPeer(peerId) {
      const videoGrid = document.getElementById('participantsGrid');
      if (!videoGrid) {
        console.error('Participants grid not found');
        return null;
      }
      
      // First check if there's already a container with an alternative naming pattern
      const existingContainer = document.getElementById(`participant-${peerId}`);
      if (existingContainer) {
        console.log(`Found existing container with different ID pattern for peer ${peerId}, will use it`);
        existingContainer.id = `video-container-${peerId}`;
        return existingContainer;
      }
      
      // Create container
      const videoContainer = document.createElement('div');
      videoContainer.id = `video-container-${peerId}`;
      videoContainer.className = 'video-container h-video-thumb-mobile md:h-video-thumb relative';
      
      // Create video element
      const remoteVideo = document.createElement('video');
      remoteVideo.id = `video-${peerId}`;
      remoteVideo.className = 'w-full h-full object-cover';
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      
      // Create label
      const label = document.createElement('div');
      label.className = 'video-label absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm z-10';
      
      // Try to get participant name from app state
      const participantInfo = window.appState.participants[peerId];
      let participantName = `Participant ${peerId.substring(0, 5)}`;
      let isParticipantHost = false;
      
      if (participantInfo) {
        participantName = participantInfo.name || participantName;
        isParticipantHost = participantInfo.isHost || false;
      }
      
      label.textContent = isParticipantHost ? `${participantName} (Host)` : participantName;
      
      // Create controls
      const controls = document.createElement('div');
      controls.className = 'absolute top-2 right-2 flex gap-1 z-10';
      
      // Pin button
      const pinBtn = document.createElement('button');
      pinBtn.className = 'participant-control pin-btn bg-black bg-opacity-50 text-white p-2 rounded hover:bg-opacity-75';
      
      // Set initial pin button state based on current pinned participant
      if (window.appState.pinnedParticipant === peerId) {
        pinBtn.title = 'Unpin from main view';
        pinBtn.setAttribute('aria-label', 'Unpin video from main view');
        pinBtn.classList.add('active');
      } else {
        pinBtn.title = 'Pin to main view';
        pinBtn.setAttribute('aria-label', 'Pin video to main view');
      }
      
      pinBtn.setAttribute('data-participant-id', peerId);
      pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
      
      // Assemble the components
      controls.appendChild(pinBtn);
      videoContainer.appendChild(remoteVideo);
      videoContainer.appendChild(label);
      videoContainer.appendChild(controls);
      
      // Add to the grid
      videoGrid.appendChild(videoContainer);
      
      console.log(`Video container created for peer ${peerId}`);
      return videoContainer;
    }
    
    // Helper function to handle audio tracks
    function handleAudioTrack(track, peerId) {
      console.log(`Handling audio track for peer ${peerId}`);
      
      // IMPORTANT CHECK: Don't process our own audio to prevent echo
      const currentUserId = getSocketId();
      if (peerId === currentUserId) {
        console.log('Skipping our own audio to prevent echo');
        return;
      }
      
      // Always use a dedicated audio element for audio tracks
      let audioEl = document.getElementById(`audio-${peerId}`);
      
      if (!audioEl) {
        console.log(`Creating dedicated audio element for peer ${peerId}`);
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${peerId}`;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      } else {
        console.log(`Using existing audio element for peer ${peerId}`);
      }
      
      // Create a separate stream for audio to ensure it plays independently
      let audioStream = audioEl.srcObject;
      if (!audioStream) {
        audioStream = new MediaStream();
        audioEl.srcObject = audioStream;
      } else {
        // Remove any existing audio tracks
        const existingTracks = audioStream.getAudioTracks();
        existingTracks.forEach(t => audioStream.removeTrack(t));
      }
      
      // Add the new track
      audioStream.addTrack(track);
      
      // Force play to ensure audio is heard
      audioEl.play().catch(err => {
        console.warn(`Could not autoplay audio for peer ${peerId}:`, err);
        
        // Try to play again on user interaction
        document.addEventListener('click', function playOnClick() {
          audioEl.play().catch(e => console.warn('Still cannot play audio:', e));
          document.removeEventListener('click', playOnClick);
        }, { once: true });
      });
      
      console.log(`Audio element for peer ${peerId} updated`);
    }
    
    // If we're the host, create and send an offer
    if (window.appState.isHost) {
      createAndSendOffer(pc, peerId);
    }
    // NOW: Also create and send offers between non-host peers
    // This ensures everyone can see and hear each other
    else {
      // Add a small delay to avoid race conditions
      setTimeout(() => {
        console.log(`Non-host peer initiating connection to ${peerId}`);
        createAndSendOffer(pc, peerId);
      }, 500);
    }
    
    return pc;
  } catch (error) {
    console.error(`Error creating peer connection for ${peerId}:`, error);
    showError('Failed to establish connection with a participant.');
    throw error;
  }
}

// Create and send an offer to a peer
async function createAndSendOffer(peerConnection, peerId) {
  try {
    // Check if the connection already has local description
    if (peerConnection.signalingState === 'have-local-offer') {
      console.log(`Connection already has a pending offer for ${peerId}, skipping offer creation`);
      return;
    }
    
    // Create offer with explicit options to receive video even in audio-only mode
    const offerOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,  // Always receive video even if we don't have a camera
      iceRestart: true  // Force ICE restart to improve connection reliability
    };
    
    console.log(`Creating offer for ${peerId} with options:`, offerOptions);
    
    // Create offer with these options
    const offer = await peerConnection.createOffer(offerOptions);
    
    // Add explicit video codecs preference
    let sdpWithCodecs = offer.sdp;
    
    // Set local description
    await peerConnection.setLocalDescription(offer);
    
    // Wait a bit to collect ICE candidates
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Send offer to peer
    console.log(`Sending offer to ${peerId}, signaling state: ${peerConnection.signalingState}`);
    sendOffer(peerId, peerConnection.localDescription);
  } catch (error) {
    console.error(`Error creating and sending offer to ${peerId}:`, error);
  }
}

// Handle a remote offer
export async function handleRemoteOffer(peerId, sdp) {
  try {
    // Create peer connection if it doesn't exist
    let peerConnection = window.appState.peerConnections[peerId];
    
    if (!peerConnection) {
      peerConnection = createPeerConnection(peerId);
    }
    
    // Set remote description
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    
    // Create answer with explicit options to receive video even in audio-only mode
    const answerOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true  // Always receive video even if we don't have a camera
    };
    
    console.log(`Creating answer for ${peerId} with options:`, answerOptions);
    
    // Create answer with these options
    const answer = await peerConnection.createAnswer(answerOptions);
    
    // Set local description
    await peerConnection.setLocalDescription(answer);
    
    // Send answer to peer
    console.log(`Sending answer to ${peerId}`);
    sendAnswer(peerId, peerConnection.localDescription);
  } catch (error) {
    console.error(`Error handling offer from ${peerId}:`, error);
    showError('Failed to process connection request from a participant.');
  }
}

// Handle a remote answer
export async function handleRemoteAnswer(peerId, sdp) {
  try {
    // Get peer connection
    const peerConnection = window.appState.peerConnections[peerId];
    
    if (!peerConnection) {
      console.error(`No peer connection found for ${peerId}`);
      return;
    }
    
    // Set remote description
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    
    console.log(`Successfully set remote description for ${peerId}`);
  } catch (error) {
    console.error(`Error handling answer from ${peerId}:`, error);
    showError('Failed to complete connection with a participant.');
  }
}

// Handle a remote ICE candidate
export async function handleRemoteIceCandidate(peerId, candidate) {
  try {
    // Get peer connection
    const peerConnection = window.appState.peerConnections[peerId];
    
    if (!peerConnection) {
      console.error(`No peer connection found for ${peerId}`);
      return;
    }
    
    // Add ICE candidate
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    
    console.log(`Successfully added ICE candidate for ${peerId}`);
  } catch (error) {
    console.error(`Error handling ICE candidate from ${peerId}:`, error);
  }
}

// Close all peer connections
export function closeAllPeerConnections() {
  Object.entries(window.appState.peerConnections).forEach(([peerId, pc]) => {
    console.log(`Closing peer connection for ${peerId}`);
    pc.close();
  });
  
  window.appState.peerConnections = {};
}

// Force establishment of full mesh connections between all participants
export function establishFullMeshConnections() {
  console.log('Forcing establishment of full mesh connections');
  
  // Get all participants except ourselves
  const allParticipants = Object.values(window.appState.participants || {});
  const otherParticipants = allParticipants.filter(p => p.id !== getSocketId());
  
  console.log(`Found ${otherParticipants.length} other participants to establish connections with`);
  
  if (otherParticipants.length === 0) {
    console.log('No other participants to connect with');
    return;
  }
  
  // First check existing connections
  const existingConnections = Object.keys(window.appState.peerConnections || {});
  console.log(`Currently have ${existingConnections.length} active peer connections`);
  
  // Create new connections for anyone we're not connected to
  otherParticipants.forEach((participant, index) => {
    const peerId = participant.id;
    
    // Check if we already have a connection
    const existingConnection = window.appState.peerConnections[peerId];
    
    if (!existingConnection) {
      // Create a new connection with a delay to stagger connections
      setTimeout(() => {
        console.log(`Creating missing connection to participant ${peerId}`);
        createPeerConnection(peerId);
      }, index * 300);
    } else {
      console.log(`Checking connection with ${peerId}, state: ${existingConnection.connectionState}`);
      
      // If the connection is in a problematic state, recreate it
      if (existingConnection.connectionState === 'failed' || 
          existingConnection.connectionState === 'disconnected' ||
          existingConnection.iceConnectionState === 'failed' ||
          existingConnection.iceConnectionState === 'disconnected') {
        
        console.log(`Connection with ${peerId} is in ${existingConnection.connectionState} state, recreating`);
        
        // Close the existing connection
        existingConnection.close();
        delete window.appState.peerConnections[peerId];
        
        // Create a new connection with a small delay
        setTimeout(() => {
          createPeerConnection(peerId);
        }, index * 300 + 100);
      } 
      // Even for stable connections, create a new offer to ensure proper media exchange
      else if (!window.appState.isHost || (window.appState.isHost && participant.isHost === false)) {
        console.log(`Connection with ${peerId} exists but forcing renegotiation to ensure media exchange`);
        
        // Wait a bit before attempting renegotiation
        setTimeout(() => {
          try {
            createAndSendOffer(existingConnection, peerId);
          } catch (err) {
            console.error(`Error renegotiating with ${peerId}:`, err);
          }
        }, index * 300 + 500); 
      }
    }
  });
}