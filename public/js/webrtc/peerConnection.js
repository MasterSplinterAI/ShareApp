// WebRTC peer connection module for managing peer-to-peer connections
import { sendOffer, sendAnswer, sendIceCandidate, getSocketId } from '../services/socket.js';
import { showError } from '../ui/notifications.js';
import { getIceServersSync, getIceServers } from '../utils/iceServers.js';
import { startAudioLevelMonitoring, stopAudioLevelMonitoring } from '../utils/audioLevel.js';

// Track connection retry attempts per peer
const connectionRetries = new Map();
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2000; // Base delay in ms

// Queue for ICE candidates that arrive before remote description is set
const iceCandidateQueues = new Map();

// Track pending offers to prevent duplicates
const pendingOffers = new Map();
const pendingAnswers = new Map();

// Create a new peer connection with a remote peer
export async function createPeerConnection(peerId) {
  try {
    // Prevent duplicate connections
    if (window.appState.peerConnections[peerId]) {
      const existing = window.appState.peerConnections[peerId];
      // Only recreate if connection is failed/disconnected
      if (existing.connectionState !== 'failed' && 
          existing.connectionState !== 'disconnected' &&
          existing.iceConnectionState !== 'failed' &&
          existing.iceConnectionState !== 'disconnected') {
        console.log(`Peer connection for ${peerId} already exists and is healthy, reusing it`);
        return existing;
      }
      // Close the bad connection before creating a new one
      console.log(`Closing unhealthy connection for ${peerId} before recreating`);
      existing.close();
      delete window.appState.peerConnections[peerId];
    }
    
    console.log(`Creating peer connection for ${peerId}`);
    
    // Get ICE servers (try async first, fallback to sync)
    let iceServers = getIceServersSync();
    try {
      // Try to get fresh servers if not cached
      iceServers = await getIceServers();
    } catch (e) {
      console.warn('Using cached/default ICE servers');
    }
    
    // Create a new RTCPeerConnection with enhanced options for better connectivity
    const pc = new RTCPeerConnection({ 
      iceServers,
      // Enhanced configuration for better international connectivity
      iceCandidatePoolSize: 10, // Pre-gather more candidates
      bundlePolicy: 'max-bundle', // Bundle for efficiency
      rtcpMuxPolicy: 'require', // Require RTCP muxing
      sdpSemantics: 'unified-plan',
      // Enable all audio processing options
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
    
    // Handle ICE candidates with detailed logging for debugging international connectivity
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Log candidate type for debugging international connectivity
        const candidate = event.candidate;
        const candidateType = candidate.type || 'unknown';
        const protocol = candidate.protocol || 'unknown';
        const address = candidate.address || candidate.ip || 'unknown';
        
        // Only log every 5th candidate to reduce noise
        const candidateCount = (pc.onicecandidateCount || 0) + 1;
        pc.onicecandidateCount = candidateCount;
        
        if (candidateCount % 5 === 1 || candidateType === 'relay') {
          console.log(`🔄 ICE candidate ${candidateCount} for ${peerId}: type=${candidateType}, protocol=${protocol}, address=${address.substring(0, 15)}...`);
        }
        
        // Special logging for TURN candidates (important for international users)
        if (candidate.candidate && candidate.candidate.includes('relay')) {
          console.log(`🌐 TURN relay candidate generated for ${peerId} - this helps with restrictive firewalls/NATs`);
        }
        
        sendIceCandidate(peerId, event.candidate);
      } else {
        console.log(`✅ ICE gathering complete for ${peerId} (${pc.onicecandidateCount || 0} candidates collected)`);
        pc.onicecandidateCount = 0;
      }
    };
    
    // Track ICE gathering state
    pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering state for ${peerId}: ${pc.iceGatheringState}`);
      
      if (pc.iceGatheringState === 'complete') {
        // Check if we have relay candidates (important for international connectivity)
        pc.getStats().then(stats => {
          let hasRelay = false;
          stats.forEach(report => {
            if (report.type === 'local-candidate' && report.candidateType === 'relay') {
              hasRelay = true;
            }
          });
          
          if (!hasRelay) {
            console.warn(`⚠️ No TURN relay candidates found for ${peerId}. International users may have connectivity issues.`);
          }
        }).catch(err => {
          console.warn('Could not check for relay candidates:', err);
        });
      }
    };
    
    // Log ICE connection state changes with detailed debugging and better retry logic
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`ICE connection state with ${peerId}: ${state}`);
      
      // Reset retry count on successful connection
      if (state === 'connected' || state === 'completed') {
        connectionRetries.delete(peerId);
        
        // Log detailed connection info for debugging international issues
        pc.getStats().then(stats => {
          let relayCount = 0;
          let hostCount = 0;
          let srflxCount = 0;
          
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              console.log(`✅ Connection established via ${report.localCandidateId} -> ${report.remoteCandidateId}`);
              
              // Check what type of connection was used
              stats.forEach(candidateReport => {
                if (candidateReport.type === 'local-candidate' && candidateReport.id === report.localCandidateId) {
                  if (candidateReport.candidateType === 'relay') relayCount++;
                  else if (candidateReport.candidateType === 'host') hostCount++;
                  else if (candidateReport.candidateType === 'srflx') srflxCount++;
                }
              });
            }
          });
          
          // Log connection type summary
          if (relayCount > 0) {
            console.log(`🌐 Using TURN relay (important for international users)`);
          } else if (srflxCount > 0) {
            console.log(`🔗 Using STUN (NAT traversal)`);
          } else if (hostCount > 0) {
            console.log(`🏠 Direct connection (same network)`);
          }
        }).catch(err => {
          console.warn('Error getting connection stats:', err);
        });
        
        // Update connection status UI
        import('../ui/notifications.js').then(({ updateConnectionStatus }) => {
          if (typeof updateConnectionStatus === 'function') {
            updateConnectionStatus('active');
          }
        });
      }
      
      // Handle connection failures with exponential backoff retry
      if (state === 'failed') {
        const retryCount = connectionRetries.get(peerId) || 0;
        
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount); // Exponential backoff
          connectionRetries.set(peerId, retryCount + 1);
          
          console.warn(`❌ ICE connection failed with ${peerId} (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${delay}ms`);
          
          // Show user-friendly error message
          if (retryCount === 0) {
            showError(`Connection issue detected. Retrying connection...`, 5000);
          }
          
          setTimeout(() => {
            if (pc.iceConnectionState === 'failed' && window.appState.peerConnections[peerId] === pc) {
              console.log(`Restarting ICE for ${peerId} after failure`);
              pc.restartIce();
            }
          }, delay);
        } else {
          console.error(`❌ ICE connection failed with ${peerId} after ${MAX_RETRIES} retries`);
          connectionRetries.delete(peerId);
          
          // Show persistent error message
          showError(`Could not connect to participant. This may be due to network restrictions. Please check your firewall settings.`, 10000);
          
          // Emit event for UI to handle
          document.dispatchEvent(new CustomEvent('peer-connection-failed', {
            detail: { peerId, retryCount: MAX_RETRIES }
          }));
        }
      } else if (state === 'disconnected') {
        console.warn(`⚠️ ICE connection disconnected with ${peerId}, will retry in 3 seconds`);
        
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' && window.appState.peerConnections[peerId] === pc) {
            console.log(`Restarting ICE for ${peerId} after disconnect`);
            pc.restartIce();
          }
        }, 3000);
      } else if (state === 'checking') {
        // Connection is attempting to establish
        const retryCount = connectionRetries.get(peerId) || 0;
        if (retryCount === 0) {
          // First attempt - show connecting status
          import('../ui/notifications.js').then(({ updateConnectionStatus }) => {
            if (typeof updateConnectionStatus === 'function') {
              updateConnectionStatus('connecting');
            }
          });
        }
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
        
        // Start audio level monitoring for speaking indicators
        try {
          const audioStream = new MediaStream([event.track]);
          startAudioLevelMonitoring(peerId, audioStream);
        } catch (err) {
          console.warn(`Could not start audio level monitoring for ${peerId}:`, err);
        }
        
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
            newPlaceholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800 zoom-like-avatar';
            
            // Create avatar with initials
            const participantInfo = window.appState.participants[peerId];
            const participantName = participantInfo?.name || peerId.substring(0, 5);
            const initials = participantName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            
            newPlaceholder.innerHTML = `
              <div class="avatar-circle bg-blue-600 text-white text-2xl font-bold flex items-center justify-center w-20 h-20 rounded-full">
                ${initials}
              </div>
              <div class="speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden">
                <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            `;
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
      
      // Create label with status indicators
      const label = document.createElement('div');
      label.className = 'video-label absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white px-3 py-2 text-sm z-10 flex items-center justify-between';
      
      // Try to get participant name from app state
      const participantInfo = window.appState.participants[peerId];
      let participantName = `Participant ${peerId.substring(0, 5)}`;
      let isParticipantHost = false;
      
      if (participantInfo) {
        participantName = participantInfo.name || participantName;
        isParticipantHost = participantInfo.isHost || false;
      }
      
      // Name section
      const nameSpan = document.createElement('span');
      nameSpan.textContent = isParticipantHost ? `${participantName} (Host)` : participantName;
      nameSpan.className = 'font-medium';
      
      // Status indicators section
      const statusSpan = document.createElement('span');
      statusSpan.className = 'flex items-center gap-2';
      statusSpan.innerHTML = `
        <span class="mic-status" data-peer-id="${peerId}">
          <i class="fas fa-microphone text-xs"></i>
        </span>
        <span class="video-status" data-peer-id="${peerId}">
          <i class="fas fa-video text-xs"></i>
        </span>
        <span class="speaking-indicator-wrapper hidden" data-peer-id="${peerId}">
          <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        </span>
      `;
      
      label.appendChild(nameSpan);
      label.appendChild(statusSpan);
      
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
    // Prevent duplicate offers
    if (pendingOffers.has(peerId)) {
      console.log(`Already have a pending offer for ${peerId}, skipping`);
      return;
    }
    
    // Check if the connection already has local description
    if (peerConnection.signalingState === 'have-local-offer') {
      console.log(`Connection already has a pending offer for ${peerId}, skipping offer creation`);
      return;
    }
    
    // Check if we have a remote offer (would cause conflict)
    if (peerConnection.signalingState === 'have-remote-offer') {
      console.warn(`Cannot create offer for ${peerId}: already have remote offer. Waiting for answer.`);
      return;
    }
    
    // Mark that we're sending an offer
    pendingOffers.set(peerId, true);
    
    try {
      // Create offer with explicit options to receive video even in audio-only mode
      const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,  // Always receive video even if we don't have a camera
        iceRestart: false  // Don't force ICE restart unless connection is broken
      };
      
      // Only restart ICE if connection is in a bad state
      if (peerConnection.iceConnectionState === 'failed' || 
          peerConnection.iceConnectionState === 'disconnected') {
        offerOptions.iceRestart = true;
      }
      
      console.log(`Creating offer for ${peerId} with options:`, offerOptions);
      
      // Create offer with these options
      const offer = await peerConnection.createOffer(offerOptions);
      
      // Set local description
      await peerConnection.setLocalDescription(offer);
      
      // Wait a bit to collect ICE candidates
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Send offer to peer
      console.log(`Sending offer to ${peerId}, signaling state: ${peerConnection.signalingState}`);
      sendOffer(peerId, peerConnection.localDescription);
      
      // Clear pending flag after a delay (in case answer doesn't arrive)
      setTimeout(() => {
        if (peerConnection.signalingState !== 'have-local-offer') {
          pendingOffers.delete(peerId);
        }
      }, 5000);
    } catch (error) {
      pendingOffers.delete(peerId);
      throw error;
    }
  } catch (error) {
    console.error(`Error creating and sending offer to ${peerId}:`, error);
  }
}

// Handle a remote offer
export async function handleRemoteOffer(peerId, sdp) {
  try {
    // Prevent duplicate offers
    if (pendingAnswers.has(peerId)) {
      console.log(`Already processing answer for ${peerId}, ignoring duplicate offer`);
      return;
    }
    
    // Check if we already have a local offer (would cause conflict)
    const peerConnection = window.appState.peerConnections[peerId];
    if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
      console.warn(`Received offer from ${peerId} but we already have a local offer. Ignoring to prevent SDP conflict.`);
      return;
    }
    
    // Create peer connection if it doesn't exist
    let pc = peerConnection;
    if (!pc) {
      pc = await createPeerConnection(peerId);
    }
    
    // Mark that we're processing an answer
    pendingAnswers.set(peerId, true);
    
    try {
      // Set remote description
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // Process any queued ICE candidates now that remote description is set
      await processQueuedIceCandidates(peerId);
      
      // Create answer with explicit options to receive video even in audio-only mode
      const answerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true  // Always receive video even if we don't have a camera
      };
      
      console.log(`Creating answer for ${peerId} with options:`, answerOptions);
      
      // Create answer with these options
      const answer = await pc.createAnswer(answerOptions);
      
      // Set local description
      await pc.setLocalDescription(answer);
      
      // Send answer to peer
      console.log(`Sending answer to ${peerId}`);
      sendAnswer(peerId, pc.localDescription);
    } finally {
      // Clear pending flag after a delay
      setTimeout(() => {
        pendingAnswers.delete(peerId);
      }, 1000);
    }
  } catch (error) {
    pendingAnswers.delete(peerId);
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
    
    // Check signaling state - can only set answer if we have a local offer
    if (peerConnection.signalingState !== 'have-local-offer') {
      console.warn(`Cannot set answer for ${peerId}: signaling state is ${peerConnection.signalingState}, expected 'have-local-offer'`);
      return;
    }
    
    // Set remote description
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    
    // Process any queued ICE candidates now that remote description is set
    await processQueuedIceCandidates(peerId);
    
    // Clear pending offer flag
    pendingOffers.delete(peerId);
    
    console.log(`Successfully set remote description for ${peerId}`);
  } catch (error) {
    pendingOffers.delete(peerId);
    console.error(`Error handling answer from ${peerId}:`, error);
    // Don't show error for state conflicts (they're expected during renegotiation)
    if (!error.message || !error.message.includes('state')) {
      showError('Failed to complete connection with a participant.');
    }
  }
}

// Handle a remote ICE candidate
export async function handleRemoteIceCandidate(peerId, candidate) {
  try {
    // Get peer connection
    const peerConnection = window.appState.peerConnections[peerId];
    
    if (!peerConnection) {
      console.log(`No peer connection found for ${peerId}, queueing ICE candidate`);
      // Queue the candidate for later
      if (!iceCandidateQueues.has(peerId)) {
        iceCandidateQueues.set(peerId, []);
      }
      iceCandidateQueues.get(peerId).push(candidate);
      return;
    }
    
    // If remote description isn't set yet, queue the candidate
    if (!peerConnection.remoteDescription) {
      console.log(`Remote description not set for ${peerId}, queueing ICE candidate`);
      if (!iceCandidateQueues.has(peerId)) {
        iceCandidateQueues.set(peerId, []);
      }
      iceCandidateQueues.get(peerId).push(candidate);
      return;
    }
    
    // Add ICE candidate
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    
    console.log(`Successfully added ICE candidate for ${peerId}`);
  } catch (error) {
    // If error is about remote description not being set, queue it
    if (error.message && error.message.includes('remote description')) {
      console.log(`Queueing ICE candidate for ${peerId} (remote description not ready)`);
      if (!iceCandidateQueues.has(peerId)) {
        iceCandidateQueues.set(peerId, []);
      }
      iceCandidateQueues.get(peerId).push(candidate);
    } else {
      console.error(`Error handling ICE candidate from ${peerId}:`, error);
    }
  }
}

// Process queued ICE candidates for a peer
async function processQueuedIceCandidates(peerId) {
  const queue = iceCandidateQueues.get(peerId);
  if (!queue || queue.length === 0) {
    return;
  }
  
  const peerConnection = window.appState.peerConnections[peerId];
  if (!peerConnection || !peerConnection.remoteDescription) {
    return;
  }
  
  console.log(`Processing ${queue.length} queued ICE candidates for ${peerId}`);
  
  // Process all queued candidates
  while (queue.length > 0) {
    const candidate = queue.shift();
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log(`Successfully added queued ICE candidate for ${peerId}`);
    } catch (err) {
      console.warn(`Failed to add queued ICE candidate for ${peerId}:`, err);
      // Don't re-queue, just log the warning
    }
  }
  
  // Clear the queue
  iceCandidateQueues.delete(peerId);
}

// Clean up all state for a specific peer
export function cleanupPeerConnection(peerId) {
  // Stop audio level monitoring
  stopAudioLevelMonitoring(peerId);
  
  // Close and remove peer connection
  if (window.appState.peerConnections[peerId]) {
    window.appState.peerConnections[peerId].close();
    delete window.appState.peerConnections[peerId];
  }
  
  // Clear pending operations
  pendingOffers.delete(peerId);
  pendingAnswers.delete(peerId);
  iceCandidateQueues.delete(peerId);
  connectionRetries.delete(peerId);
  
  console.log(`Cleaned up all state for peer ${peerId}`);
}

// Close all peer connections
export function closeAllPeerConnections() {
  Object.entries(window.appState.peerConnections).forEach(([peerId, pc]) => {
    console.log(`Closing peer connection for ${peerId}`);
    pc.close();
  });
  
  window.appState.peerConnections = {};
  
  // Clear all queues and pending operations
  iceCandidateQueues.clear();
  pendingOffers.clear();
  pendingAnswers.clear();
  connectionRetries.clear();
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
  otherParticipants.forEach(async (participant, index) => {
    const peerId = participant.id;
    
    // Check if we already have a connection
    const existingConnection = window.appState.peerConnections[peerId];
    
    if (!existingConnection) {
      // Create a new connection with a delay to stagger connections
      setTimeout(async () => {
        console.log(`Creating missing connection to participant ${peerId}`);
        try {
          await createPeerConnection(peerId);
        } catch (err) {
          console.error(`Failed to create connection to ${peerId}:`, err);
        }
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
        setTimeout(async () => {
          try {
            await createPeerConnection(peerId);
          } catch (err) {
            console.error(`Failed to recreate connection to ${peerId}:`, err);
          }
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