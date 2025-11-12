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
    // CRITICAL: Prevent creating peer connection to ourselves
    const currentSocketId = getSocketId();
    if (peerId === currentSocketId) {
      console.warn(`Attempted to create peer connection to self (${peerId}), skipping`);
      return null;
    }
    
    // Ensure peerConnections exists
    if (!window.appState.peerConnections || typeof window.appState.peerConnections !== 'object') {
      window.appState.peerConnections = {}
    }
    
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
    
    // Add dedicated transceivers for camera and screen share
    const cameraTransceiver = pc.addTransceiver('video', {direction: 'sendrecv'});
    const screenTransceiver = pc.addTransceiver('video', {direction: 'sendrecv'});
    window.appState.peerTransceivers = window.appState.peerTransceivers || {};
    window.appState.peerTransceivers[peerId] = {
      camera: cameraTransceiver,
      screen: screenTransceiver
    };

    console.log(`Created peer connection with dedicated camera/screen transceivers for ${peerId}`);
    
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
            if (track.kind === 'audio') {
            pc.addTrack(track, window.appState.localStream);
            } else if (track.kind === 'video') {
              // Add camera to camera transceiver
              cameraTransceiver.sender.replaceTrack(track).catch(err => console.warn('Camera replaceTrack failed:', err));
            }
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
          let relayCandidates = [];
          let candidateSummary = { relay: 0, srflx: 0, host: 0 };
          
          stats.forEach(report => {
            if (report.type === 'local-candidate') {
              if (report.candidateType === 'relay') {
                hasRelay = true;
                candidateSummary.relay++;
                relayCandidates.push({
                  ip: report.ip || report.address,
                  port: report.port,
                  protocol: report.protocol,
                  url: report.url
                });
              } else if (report.candidateType === 'srflx') {
                candidateSummary.srflx++;
              } else if (report.candidateType === 'host') {
                candidateSummary.host++;
              }
            }
          });
          
          console.log(`📊 ICE Gathering Complete for ${peerId}:`);
          console.log(`   Relay candidates: ${candidateSummary.relay}`);
          console.log(`   STUN (srflx) candidates: ${candidateSummary.srflx}`);
          console.log(`   Host candidates: ${candidateSummary.host}`);
          
          if (relayCandidates.length > 0) {
            console.log(`✅ TURN relay candidates available for ${peerId}:`, relayCandidates.map(c => `${c.protocol}://${c.ip}:${c.port}`).join(', '));
          } else {
            console.warn(`⚠️ CRITICAL: No TURN relay candidates found for ${peerId}. Users with restrictive NATs (Caribbean, Colombia, etc.) may not be able to connect.`);
            console.warn(`   This is likely a TURN server configuration issue. Check Cloudflare TURN credentials.`);
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
          let localRelayCandidates = 0;
          let remoteRelayCandidates = 0;
          let connectionType = 'unknown';
          
          // Count all candidate types
          stats.forEach(report => {
            if (report.type === 'local-candidate') {
              if (report.candidateType === 'relay') localRelayCandidates++;
            }
            if (report.type === 'remote-candidate') {
              if (report.candidateType === 'relay') remoteRelayCandidates++;
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              // Find the actual candidate pair details
              const localCandidate = stats.get(report.localCandidateId);
              const remoteCandidate = stats.get(report.remoteCandidateId);
              
              if (localCandidate && localCandidate.type === 'local-candidate') {
                if (localCandidate.candidateType === 'relay') {
                  relayCount++;
                  connectionType = 'TURN relay';
                } else if (localCandidate.candidateType === 'srflx') {
                  srflxCount++;
                  if (connectionType === 'unknown') connectionType = 'STUN';
                } else if (localCandidate.candidateType === 'host') {
                  hostCount++;
                  if (connectionType === 'unknown') connectionType = 'Direct';
                }
              }
              
              console.log(`✅ Connection established to ${peerId} via ${connectionType || 'unknown'}`);
              console.log(`   Local candidate: ${localCandidate?.candidateType || 'unknown'} (${localCandidate?.ip || 'N/A'})`);
              console.log(`   Remote candidate: ${remoteCandidate?.candidateType || 'unknown'} (${remoteCandidate?.ip || 'N/A'})`);
            }
          });
          
          // Log TURN relay availability
          console.log(`📊 TURN Relay Status for ${peerId}:`);
          console.log(`   Local relay candidates: ${localRelayCandidates}`);
          console.log(`   Remote relay candidates: ${remoteRelayCandidates}`);
          
          // Warn if connection succeeded but no relay was used (potential issue for restrictive NATs)
          if (connectionType !== 'TURN relay' && (localRelayCandidates > 0 || remoteRelayCandidates > 0)) {
            console.warn(`⚠️ Connection to ${peerId} succeeded without TURN relay, but relay candidates were available. This may cause issues with restrictive NATs.`);
          }
          
          // Log connection type summary
          if (relayCount > 0) {
            console.log(`🌐 Using TURN relay for ${peerId} (important for international users)`);
          } else if (srflxCount > 0) {
            console.log(`🔗 Using STUN for ${peerId} (NAT traversal)`);
          } else if (hostCount > 0) {
            console.log(`🏠 Direct connection to ${peerId} (same network)`);
          }
          
          // Critical warning if no relay candidates available and connection is struggling
          if (localRelayCandidates === 0 && remoteRelayCandidates === 0) {
            console.warn(`⚠️ CRITICAL: No TURN relay candidates available for ${peerId}. Users with restrictive NATs may not be able to connect.`);
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
      // For international users with restrictive NATs, force TURN relay usage
      if (state === 'failed') {
        const retryCount = connectionRetries.get(peerId) || 0;
        
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount); // Exponential backoff
          connectionRetries.set(peerId, retryCount + 1);
          
          console.warn(`❌ ICE connection failed with ${peerId} (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${delay}ms`);
          
          // Check if TURN relay candidates are available (critical for restrictive NATs)
          pc.getStats().then(stats => {
            let hasRelayCandidates = false;
            let relayCandidateCount = 0;
            stats.forEach(report => {
              if (report.type === 'local-candidate' && report.candidateType === 'relay') {
                hasRelayCandidates = true;
                relayCandidateCount++;
              }
            });
            
            if (!hasRelayCandidates) {
              console.error(`⚠️ CRITICAL: Connection failed to ${peerId} and NO TURN relay candidates available!`);
              console.error(`   This user likely has a restrictive NAT (common in Caribbean, Colombia, etc.)`);
              console.error(`   Both users need TURN relay to connect. Check Cloudflare TURN server configuration.`);
            } else {
              console.log(`🔄 TURN relay candidates available (${relayCandidateCount}) but connection failed. Forcing ICE restart to use relay.`);
            }
          }).catch(err => {
            console.warn('Could not check for relay candidates:', err);
          });
          
          // Show user-friendly error message
          if (retryCount === 0) {
            showError(`Connection issue detected. Retrying with TURN relay...`, 5000);
          }
          
          setTimeout(() => {
            if (pc.iceConnectionState === 'failed' && window.appState.peerConnections[peerId] === pc) {
              console.log(`🔄 Restarting ICE for ${peerId} after failure - forcing TURN relay usage`);
              // Force ICE restart to regenerate candidates and prefer TURN relay
              pc.restartIce();
              
              // After ICE restart, create a new offer to force renegotiation
              setTimeout(async () => {
                if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') {
                  try {
                    await createAndSendOffer(pc, peerId);
                  } catch (err) {
                    console.error(`Failed to create offer after ICE restart for ${peerId}:`, err);
                  }
                }
              }, 1000);
            }
          }, delay);
        } else {
          console.error(`❌ ICE connection failed with ${peerId} after ${MAX_RETRIES} retries`);
          connectionRetries.delete(peerId);
          
          // Check one more time if TURN relay was available
          pc.getStats().then(stats => {
            let hasRelayCandidates = false;
            let relayCandidateCount = 0;
            stats.forEach(report => {
              if (report.type === 'local-candidate' && report.candidateType === 'relay') {
                hasRelayCandidates = true;
                relayCandidateCount++;
              }
            });
            
            if (!hasRelayCandidates) {
              console.error(`❌ FINAL DIAGNOSIS: No TURN relay candidates available for ${peerId}.`);
              console.error(`   This is a TURN server configuration issue. Both users need TURN relay to connect.`);
              showError(`Could not connect to participant. TURN relay server not available. Please check server configuration.`, 15000);
            } else {
              console.error(`❌ FINAL DIAGNOSIS: TURN relay candidates available (${relayCandidateCount}) but connection still failed.`);
              console.error(`   This may indicate a regional TURN server issue or network restrictions.`);
              showError(`Could not connect to participant. Network restrictions detected. TURN relay available but connection failed.`, 15000);
            }
          }).catch(() => {
            showError(`Could not connect to participant. This may be due to network restrictions. Please check your firewall settings.`, 10000);
          });
          
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
    
    // Handle remote tracks with better logging for debugging
    pc.ontrack = (event) => {
      console.log(`🎥 Received track from ${peerId}: ${event.track.kind}, enabled: ${event.track.enabled}, readyState: ${event.track.readyState}, id: ${event.track.id}, label: ${event.track.label}`);
      console.log(`📊 Peer connection state: ${pc.connectionState}, ICE state: ${pc.iceConnectionState}, signaling state: ${pc.signalingState}`);
      
      // Log all streams in the event
      if (event.streams && event.streams.length > 0) {
        event.streams.forEach((stream, idx) => {
          console.log(`📺 Stream ${idx} has ${stream.getVideoTracks().length} video tracks, ${stream.getAudioTracks().length} audio tracks`);
          stream.getVideoTracks().forEach(track => {
            console.log(`  - Video track: ${track.label}, id: ${track.id}`);
          });
        });
      }
      
      // Line ~515: Enhanced screen share detection
      const trackLabel = event.track.label.toLowerCase();
      const trackSettings = event.track.getSettings ? event.track.getSettings() : null;
      const displaySurface = trackSettings ? trackSettings.displaySurface : null;
      const allVideoTracks = (event.streams && event.streams[0] && event.streams[0].getVideoTracks) ? event.streams[0].getVideoTracks() : [];
      
      // Check if we already have a camera video track for this peer
      const existingVideoContainer = document.getElementById(`video-container-${peerId}`);
      const existingVideo = existingVideoContainer ? existingVideoContainer.querySelector('video') : null;
      const hasExistingCameraTrack = existingVideo && existingVideo.srcObject && existingVideo.srcObject.getVideoTracks().length > 0;
      
      // If we already have a camera track and this is a new video track, it's likely screen share
      const isNewScreenTrack = hasExistingCameraTrack && event.track.kind === 'video' && 
                               allVideoTracks.length > 1 && 
                               event.track !== allVideoTracks[0]; // Not the first track

      const isScreenShare = trackLabel.includes('screen') || 
                           trackLabel.includes('desktop') || 
                           trackLabel.includes('window') ||
                           trackLabel.includes('display') ||
                           trackLabel.includes('monitor') ||
                           (displaySurface && (displaySurface === 'screen' || 
                                              displaySurface === 'window' || 
                                              displaySurface === 'monitor' || 
                                              displaySurface === 'browser')) ||
                           // Fallback: if we already have camera and this is a new video track, treat as screen share
                           isNewScreenTrack;

      console.log(`Track detection - Label: "${event.track.label}", Settings:`, trackSettings, `isScreenShare: ${isScreenShare}`);

      // If this is a screen share track, handle it separately
      if (isScreenShare && event.track.kind === 'video') {
        console.log(`✅ Detected screen share track from peer ${peerId} - creating separate tile`);
        
        const screenShareContainerId = `screen-share-${peerId}`;
        let screenShareContainer = document.getElementById(screenShareContainerId);
        
        if (!screenShareContainer) {
          // Get the participants grid
          const participantsGrid = document.getElementById('participantsGrid');
          if (!participantsGrid) {
            console.error('Participants grid not found');
            return;
          }
          
          console.log(`Creating screen share container for peer ${peerId}`);
          
          // Create screen share container
          screenShareContainer = document.createElement('div');
          screenShareContainer.id = screenShareContainerId;
          screenShareContainer.className = 'video-container bg-black rounded-lg overflow-hidden relative screen-share-tile';
          screenShareContainer.style.aspectRatio = '16/9';
          screenShareContainer.setAttribute('data-screen-share', 'true');
          screenShareContainer.setAttribute('data-peer-id', peerId);
          
          // Create video element for screen share
          const screenShareVideo = document.createElement('video');
          screenShareVideo.id = `screen-share-video-${peerId}`;
          screenShareVideo.className = 'w-full h-full object-contain';
          screenShareVideo.autoplay = true;
          screenShareVideo.playsInline = true;
          
          // Create stream for screen share
          const screenShareStream = new MediaStream([event.track]);
          screenShareVideo.srcObject = screenShareStream;
          
          // Get participant name
          const participantInfo = window.appState.participants[peerId];
          const participantName = participantInfo?.name || `Participant ${peerId.substring(0, 5)}`;
          
          // Create label
          const screenShareLabel = document.createElement('div');
          screenShareLabel.className = 'video-label absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white px-3 py-2 text-sm z-10 flex items-center justify-between';
          screenShareLabel.innerHTML = `
            <span class="font-medium">🖥️ ${participantName}'s Screen</span>
            <span class="flex items-center gap-2">
              <span class="screen-share-indicator">
                <i class="fas fa-desktop text-xs"></i>
              </span>
            </span>
          `;
          
          // Assemble container (no pin button needed)
          screenShareContainer.appendChild(screenShareVideo);
          screenShareContainer.appendChild(screenShareLabel);
          
          // Setup fullscreen functionality for screen share tile
          import('../utils/fullscreen.js').then(({ setupFullscreenForTile }) => {
            if (typeof setupFullscreenForTile === 'function') {
              setupFullscreenForTile(screenShareContainer, screenShareVideo);
            }
          }).catch(err => {
            console.warn('Could not import fullscreen utility for screen share:', err);
          });
          
          // Add to participants grid
          participantsGrid.appendChild(screenShareContainer);
          
          console.log(`✅ Screen share tile created and added to grid for peer ${peerId}`);
          
          // Try to play
          screenShareVideo.play().catch(err => {
            console.warn(`Could not autoplay screen share for ${peerId}:`, err);
          });
          
          // Listen for track ending (when remote user stops sharing)
          event.track.addEventListener('ended', () => {
            console.log(`Screen share ended for peer ${peerId}`);
            if (screenShareContainer && screenShareContainer.parentNode) {
              screenShareContainer.remove();
              // Trigger layout update
              import('../ui/layout.js').then(({ updateVideoTileLayout }) => {
                updateVideoTileLayout();
              }).catch(err => {
                console.warn('Could not import updateVideoTileLayout:', err);
              });
            }
            // If this screen share was pinned, reset to local
            if (window.appState.pinnedParticipant === screenShareContainerId) {
              window.appState.pinnedParticipant = 'local';
              document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
            }
          });
          
          // Trigger layout update
          import('../ui/layout.js').then(({ updateVideoTileLayout }) => {
            updateVideoTileLayout();
          }).catch(err => {
            console.warn('Could not import updateVideoTileLayout:', err);
          });
          
          console.log(`Created separate screen share tile for peer ${peerId}`);
          return; // Always skip regular video processing for screen shares
        } else {
          // Update existing screen share tile
          console.log(`Updating existing screen share tile for peer ${peerId}`);
          const existingVideo = screenShareContainer.querySelector('video');
          if (existingVideo) {
            const screenShareStream = new MediaStream([event.track]);
            existingVideo.srcObject = screenShareStream;
            existingVideo.play().catch(err => {
              console.warn(`Could not play screen share in existing tile:`, err);
            });
          }
          return; // Always skip regular video processing for screen shares
        }
      }
      
      // IMPORTANT: For regular video tracks, make sure we're NOT adding screen share tracks
      // Filter out screen share tracks from regular video processing
      if (event.track.kind === 'video') {
        const regularTrackLabel = event.track.label.toLowerCase();
        const isRegularScreenShare = regularTrackLabel.includes('screen') || 
                                    regularTrackLabel.includes('desktop') || 
                                    regularTrackLabel.includes('window') ||
                                    regularTrackLabel.includes('display') ||
                                    // If this track arrived as an additional video track, treat as screen share
                                    ((event.streams && event.streams[0] && event.streams[0].getVideoTracks && event.streams[0].getVideoTracks().length > 1));
        
        if (isRegularScreenShare) {
          console.log(`⚠️ Screen share track detected in regular video processing - skipping to avoid duplicate`);
          return; // Already handled above
        }
      }
      
      // IMPORTANT: Prevent local echo by not playing our own audio back to us
      const currentUserId = getSocketId();
      if (peerId === currentUserId && event.track.kind === 'audio') {
        console.log('Ignoring our own audio track to prevent echo');
        return; // Don't process our own audio to prevent echo
      }
      
      // Dispatch event for modern UI to handle
      const stream = event.streams && event.streams.length > 0 ? event.streams[0] : new MediaStream([event.track]);
      document.dispatchEvent(new CustomEvent('peer-track-received', {
        detail: {
          peerId: peerId,
          track: event.track,
          stream: stream
        }
      }));
      
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
      
      // If this is a video track (regular camera feed, not screen share)
      if (event.track.kind === 'video') {
        console.log(`Processing regular video track (camera) from peer ${peerId}`);
        
        // Classic UI: Create DOM elements
        // Get or create the video element
        let remoteVideo = document.getElementById(`video-${peerId}`);
        if (!remoteVideo) {
          remoteVideo = videoContainer.querySelector('video');
          if (!remoteVideo && videoContainer) {
            console.log(`Creating new video element for peer ${peerId}`);
            remoteVideo = document.createElement('video');
            remoteVideo.id = `video-${peerId}`;
            remoteVideo.className = 'w-full h-full object-contain';
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            // Mute to satisfy autoplay; audio handled by dedicated audio element
            remoteVideo.muted = true;
            // Mark for refresh routines
            remoteVideo.setAttribute('data-participant-id', peerId);
            // Insert video BEFORE label so label overlay stays on top
            const label = videoContainer.querySelector('.video-label');
            if (label) {
              videoContainer.insertBefore(remoteVideo, label);
            } else {
              videoContainer.appendChild(remoteVideo);
            }
            // Setup fullscreen for this newly created tile
            import('../utils/fullscreen.js').then(({ setupFullscreenForTile }) => {
              if (typeof setupFullscreenForTile === 'function') {
                setupFullscreenForTile(videoContainer, remoteVideo);
              }
            }).catch(err => console.warn('Could not import fullscreen utility:', err));
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
            console.log(`- Existing track in stream: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}, label: ${track.label}`);
          });
        }
        
        // IMPORTANT: Check if incoming track is a screen share BEFORE replacing
        // If it is, we should NOT add it to the camera feed container
        const incomingTrackLabel = event.track.label.toLowerCase();
        const isIncomingScreenShare = incomingTrackLabel.includes('screen') || 
                                     incomingTrackLabel.includes('desktop') || 
                                     incomingTrackLabel.includes('window') ||
                                     incomingTrackLabel.includes('display');
        
        if (isIncomingScreenShare) {
          console.log(`⚠️ Screen share track detected in regular video processing for peer ${peerId} - should have been handled separately`);
          // Don't add screen share tracks to camera feed - they should be in separate tiles
          return;
        }
        
        // Check if we already have a video track and replace it (only for camera tracks)
        const existingVideoTrack = stream.getVideoTracks()[0];
        if (existingVideoTrack) {
          // Make sure we're not replacing with a screen share
          const existingTrackLabel = existingVideoTrack.label.toLowerCase();
          const isExistingScreenShare = existingTrackLabel.includes('screen') || 
                                       existingTrackLabel.includes('desktop') || 
                                       existingTrackLabel.includes('window') ||
                                       existingTrackLabel.includes('display');
          
          if (isExistingScreenShare) {
            console.log(`⚠️ Existing track is screen share for peer ${peerId} - creating separate camera container`);
            // Don't replace screen share with camera - they should be separate
            // Create a new stream for camera
            const cameraStream = new MediaStream([event.track]);
            remoteVideo.srcObject = cameraStream;
          } else {
            console.log(`Replacing existing camera video track for peer ${peerId}`);
          stream.removeTrack(existingVideoTrack);
            stream.addTrack(event.track);
        }
        } else {
          // No existing track, just add the new one
        stream.addTrack(event.track);
        }
        
        // Ensure object-contain is set (no cropping)
        remoteVideo.style.objectFit = 'contain';
        
        // Adjust container aspect ratio based on video dimensions when loaded
        remoteVideo.onloadedmetadata = () => {
          if (remoteVideo.videoWidth > 0 && remoteVideo.videoHeight > 0) {
            const aspectRatio = remoteVideo.videoWidth / remoteVideo.videoHeight;
            // If portrait video (height > width), adjust container
            if (aspectRatio < 1) {
              videoContainer.style.aspectRatio = `${remoteVideo.videoHeight} / ${remoteVideo.videoWidth}`;
              console.log(`Adjusted container to portrait aspect ratio: ${aspectRatio} for ${peerId}`);
            } else {
              // Landscape - use standard 16:9
              videoContainer.style.aspectRatio = '16/9';
            }
          }
        };
        
        // Remove the placeholder completely since we now have video (not just hide it)
        const placeholderEl = videoContainer.querySelector('.no-video-placeholder');
        if (placeholderEl) {
          console.log(`Removing placeholder for peer ${peerId} as video is available`);
          placeholderEl.remove(); // Remove completely, not just hide
        }
        
        // Ensure video element is visible and properly positioned
        remoteVideo.style.display = 'block';
        remoteVideo.style.visibility = 'visible';
        remoteVideo.style.position = 'relative'; // Ensure it's in normal flow
        remoteVideo.style.zIndex = '1'; // Above background
        
        // Always ensure playback after metadata
        const playVideo = () => {
          if (remoteVideo.srcObject && remoteVideo.srcObject.getVideoTracks().length > 0) {
            remoteVideo.play().then(() => {
              console.log(`Video playing for peer ${peerId}`);
            }).catch(err => {
              console.warn(`Could not autoplay for ${peerId}:`, err);
              // Retry on user interaction
              document.addEventListener('click', function playOnClick() {
                remoteVideo.play().catch(e => console.warn('Still cannot play video:', e));
                document.removeEventListener('click', playOnClick);
              }, { once: true });
            });
          }
        };
        
        remoteVideo.onloadedmetadata = playVideo;
        // If metadata already loaded, attempt play immediately
        if (remoteVideo.readyState >= 2) {
          playVideo();
        }
        
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
        
        // Video playback is handled above in playVideo() function
        
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
        
        // Handle placeholder logic
        if (videoContainer) {
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
      }
    };
    
    // Helper function to create a video container for a peer
    function createVideoContainerForPeer(peerId) {
      
      const videoGrid = document.getElementById('participantsGrid');
      if (!videoGrid) {
        console.warn('Participants grid not found');
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
      videoContainer.className = 'video-container bg-black rounded-lg overflow-hidden relative';
      videoContainer.style.aspectRatio = '16/9';
      
      // Do NOT create a video element yet. We'll create it when we receive a video track
      
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
      
      // Placeholder for when there's no video yet (added by default)
      const placeholder = document.createElement('div');
      placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800 zoom-like-avatar';
      
      const participantInfo2 = window.appState.participants[peerId];
      const participantName2 = participantInfo2?.name || peerId.substring(0, 5);
      const initials2 = participantName2.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      
      placeholder.innerHTML = `
        <div class="avatar-circle bg-blue-600 text-white text-2xl font-bold flex items-center justify-center w-20 h-20 rounded-full">
          ${initials2}
        </div>
        <div class="speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden">
          <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
        </div>
      `;
      
      // Assemble the components (no pin button needed)
      videoContainer.appendChild(placeholder);
      videoContainer.appendChild(label);
      
      // Fullscreen will be set up when the video element is created on first video track
      
      // Add to the grid
      videoGrid.appendChild(videoContainer);
      
      console.log(`Video container created for peer ${peerId}`);
      
      // Trigger layout update
      import('../ui/layout.js').then(({ updateVideoTileLayout }) => {
        updateVideoTileLayout();
      }).catch(err => {
        console.warn('Could not import updateVideoTileLayout:', err);
      });
      
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
        audioEl.setAttribute('data-participant-id', peerId);
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
    // Defer offer creation until signaling state is stable to avoid race conditions
    if (peerConnection.signalingState !== 'stable') {
      console.warn(`Deferring offer for ${peerId}; signalingState=${peerConnection.signalingState}`);
      setTimeout(() => {
        if (peerConnection.signalingState === 'stable') {
          createAndSendOffer(peerConnection, peerId);
        }
      }, 250);
      return;
    }
    
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
    
    // IMPORTANT: Before creating offer, ensure video tracks are added if camera is enabled
    // Also check if tracks were added AFTER connection was created (e.g., camera enabled mid-call)
    if (window.appState.localStream) {
      const hasVideoTracks = window.appState.localStream.getVideoTracks().length > 0;
      const senders = peerConnection.getSenders();
      const hasVideoSender = senders.some(s => s.track && s.track.kind === 'video');
      
      // If we have video tracks but no video sender, add them now
      if (hasVideoTracks && !hasVideoSender && window.appState.isCameraOn) {
        console.log(`Video tracks exist but no video sender found for ${peerId}, adding video tracks now`);
        const videoTracks = window.appState.localStream.getVideoTracks();
        videoTracks.forEach(track => {
          try {
            peerConnection.addTrack(track, window.appState.localStream);
            console.log(`Added video track to peer connection for ${peerId}`);
          } catch (err) {
            console.warn(`Could not add video track to ${peerId}:`, err);
          }
        });
      }
      
      // If camera is enabled but no video tracks, try to get them
      if (window.appState.isCameraOn && !hasVideoTracks) {
        console.log('Camera is on but no video tracks in stream, attempting to get video before creating offer');
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const videoTrack = videoStream.getVideoTracks()[0];
          if (videoTrack) {
            window.appState.localStream.addTrack(videoTrack);
            peerConnection.addTrack(videoTrack, window.appState.localStream);
            console.log('Added video track to peer connection before creating offer');
          }
        } catch (err) {
          console.warn('Could not get video track for offer:', err);
        }
      }
    }
    
    try {
      // Create offer with explicit options to receive video even in audio-only mode
      // IMPORTANT: Force ICE restart if we need TURN relay (for restrictive NATs)
      const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,  // Always receive video even if we don't have a camera
        iceRestart: false  // Don't force ICE restart unless connection is broken
      };
      
      // Only restart ICE if connection is in a bad state
      if (peerConnection.iceConnectionState === 'failed' || 
          peerConnection.iceConnectionState === 'disconnected') {
        offerOptions.iceRestart = true;
        console.log(`🔄 Forcing ICE restart for ${peerId} due to connection failure`);
      }
      
      // Force ICE restart if we've retried multiple times (likely needs TURN relay)
      const retryCount = connectionRetries.get(peerId) || 0;
      if (retryCount >= 2) {
        offerOptions.iceRestart = true;
        console.log(`🔄 Forcing ICE restart for ${peerId} (retry ${retryCount}) - attempting TURN relay`);
      }
      
      console.log(`Creating offer for ${peerId} with options:`, offerOptions);
      
      // Log what tracks we're sending
      const senders = peerConnection.getSenders();
      console.log(`📤 Sending offer with ${senders.length} senders:`, senders.map(s => ({
        kind: s.track?.kind,
        enabled: s.track?.enabled,
        readyState: s.track?.readyState
      })));
      
      // Create offer with these options
      const offer = await peerConnection.createOffer(offerOptions);
      
      // Log SDP to check for video m-lines
      const sdpLines = offer.sdp.split('\n');
      const videoMLines = sdpLines.filter(line => line.startsWith('m=video'));
      console.log(`📹 SDP contains ${videoMLines.length} video m-line(s):`, videoMLines.length > 0 ? 'YES' : 'NO');
      
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
    
    // Handle simultaneous offers - if we have a local offer, we need to resolve the conflict
    const peerConnection = window.appState.peerConnections[peerId];
    if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
      console.warn(`Received offer from ${peerId} but we already have a local offer. Resolving conflict by accepting remote offer.`);
      
      // Cancel our local offer and accept the remote one instead
      // This happens when both sides try to create offers simultaneously
      // We'll use the remote offer (rollback our local one)
      try {
        // Clear our pending offer flag
        pendingOffers.delete(peerId);
        
        // The remote description will be set below, which will transition us to 'have-remote-offer'
        // Then we'll create an answer
      } catch (err) {
        console.warn('Error resolving SDP conflict:', err);
        // Continue with normal offer handling
      }
    }
    
    // Create peer connection if it doesn't exist
    let pc = peerConnection;
    if (!pc) {
      pc = await createPeerConnection(peerId);
    }
    
    // Mark that we're processing an answer
    pendingAnswers.set(peerId, true);
    
    try {
      // Set remote description (this will transition from 'have-local-offer' to 'have-remote-offer' if we had a local offer)
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      
      // Process any queued ICE candidates now that remote description is set
      await processQueuedIceCandidates(peerId);
      
      // Create answer with explicit options to receive video even in audio-only mode
      const answerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true  // Always receive video even if we don't have a camera
      };
      
      console.log(`Creating answer for ${peerId} with options:`, answerOptions);
      
      // IMPORTANT: Make sure we have video tracks in our local stream before creating answer
      // This ensures video is included in the SDP even if camera was off initially
      // Also ensure existing video tracks from remote peer are properly handled
      if (window.appState.localStream) {
        const hasVideoTracks = window.appState.localStream.getVideoTracks().length > 0;
        const hasAudioTracks = window.appState.localStream.getAudioTracks().length > 0;
        const senders = pc.getSenders();
        const hasVideoSender = senders.some(s => s.track && s.track.kind === 'video');
        
        console.log(`Local stream before answer: ${hasVideoTracks ? 'has' : 'no'} video, ${hasAudioTracks ? 'has' : 'no'} audio`);
        console.log(`Peer connection has ${senders.length} senders, video sender: ${hasVideoSender}`);
        
        // IMPORTANT: Always ensure we have at least audio tracks in the connection
        // Even if we don't have video, we should still be able to receive video from remote peer
        if (!hasAudioTracks && !hasVideoSender) {
          // Try to get at least audio if we don't have any tracks
          try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioTrack = audioStream.getAudioTracks()[0];
            if (audioTrack) {
              window.appState.localStream.addTrack(audioTrack);
              pc.addTrack(audioTrack, window.appState.localStream);
              console.log('Added audio track to peer connection before creating answer');
            }
          } catch (err) {
            console.warn('Could not get audio track for answer:', err);
          }
        }
        
        // If we don't have video tracks but camera is enabled, try to get them
        if (!hasVideoTracks && window.appState.isCameraOn) {
          console.log('Camera is on but no video tracks in stream, attempting to get video');
          try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = videoStream.getVideoTracks()[0];
            if (videoTrack) {
              window.appState.localStream.addTrack(videoTrack);
              pc.addTrack(videoTrack, window.appState.localStream);
              console.log('Added video track to peer connection before creating answer');
            }
          } catch (err) {
            console.warn('Could not get video track for answer:', err);
          }
        }
      }
      
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
    const currentState = peerConnection.signalingState;
    
    if (currentState === 'have-local-offer') {
      // Normal case - set the answer
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    } else if (currentState === 'stable') {
      // State is already stable - this means both peers sent offers simultaneously
      // and we already resolved it. The answer is late, so we can safely ignore it
      console.log(`Answer from ${peerId} arrived after state became stable (already handled), ignoring gracefully`);
      return;
    } else if (currentState === 'have-remote-offer') {
      // We're in the middle of handling their offer - wait and retry
      console.log(`Answer from ${peerId} arrived while handling their offer (state: ${currentState}), will retry after answer is created`);
      // Wait a bit for our answer to be created, then try again
      setTimeout(async () => {
        if (peerConnection.signalingState === 'stable') {
          console.log(`Connection with ${peerId} is now stable, answer was redundant`);
        }
      }, 500);
      return;
    } else {
      console.warn(`Cannot set answer for ${peerId}: signaling state is ${currentState}, expected 'have-local-offer'`);
      return;
    }
    
    // Process any queued ICE candidates now that remote description is set
    await processQueuedIceCandidates(peerId);
    
    // Clear pending offer flag
    pendingOffers.delete(peerId);
    
    console.log(`Successfully set remote description for ${peerId}`);
  } catch (error) {
    pendingOffers.delete(peerId);
    console.error(`Error handling answer from ${peerId}:`, error);
    // Don't show error for state conflicts (they're expected during renegotiation)
    if (!error.message || (!error.message.includes('state') && !error.message.includes('signaling'))) {
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
      // Only renegotiate if connection is actually stable and not already negotiating
      else if (existingConnection.signalingState === 'stable' && 
               existingConnection.iceConnectionState === 'connected' &&
               !pendingOffers.has(peerId)) {
        // Connection is good, no need to force renegotiation
        console.log(`Connection with ${peerId} is stable and connected, no renegotiation needed`);
      }
    }
  });
}