// Media stream helper functions
import { showError } from '../ui/notifications.js';

/**
 * Broadcasts the local media stream to all peer connections
 * This is called after media device changes or when reconnecting with new streams
 */
export async function broadcastMediaToAllConnections() {
  if (!window.appState.localStream) {
    console.log('No local stream available to broadcast');
    return;
  }

  console.log('Broadcasting local media to all peer connections');
  
  // Get all tracks from the local stream
  const tracks = window.appState.localStream.getTracks();
  console.log(`Local stream has ${tracks.length} tracks to broadcast`);
  
  // Log each track for debugging
  tracks.forEach(track => {
    console.log(`Track to broadcast: ${track.kind}, label: ${track.label}, enabled: ${track.enabled}`);
  });

  // Process each peer connection - include connections that are still establishing
  // Ensure peerConnections exists and is an object
  if (!window.appState || !window.appState.peerConnections || typeof window.appState.peerConnections !== 'object') {
    console.log('No peer connections available to broadcast to');
    return;
  }
  
  Object.entries(window.appState.peerConnections).forEach(([peerId, peerConnection]) => {
    // Include connections that are established OR still establishing (new, checking)
    // This ensures video tracks are added even if connection was created before camera was enabled
    const isEstablished = peerConnection.connectionState === 'connected' || 
                          peerConnection.iceConnectionState === 'connected' ||
                          peerConnection.iceConnectionState === 'completed';
    
    const isEstablishing = peerConnection.iceConnectionState === 'new' ||
                           peerConnection.iceConnectionState === 'checking';
    
    if (isEstablished || isEstablishing) {
      console.log(`Broadcasting media to peer: ${peerId} (state: ${peerConnection.connectionState}, ICE: ${peerConnection.iceConnectionState})`);
      
      // Get existing senders
      const senders = peerConnection.getSenders();
      
      // For each track in our local stream
      tracks.forEach(track => {
        // Find if we already have a sender for this kind of track
        const existingSender = senders.find(sender => 
          sender.track && sender.track.kind === track.kind
        );
        
        if (existingSender) {
          // Replace existing track
          try {
            console.log(`Replacing ${track.kind} track for peer ${peerId}`);
            existingSender.replaceTrack(track).catch(err => {
              console.error(`Error replacing ${track.kind} track for peer ${peerId}:`, err);
              // Need to renegotiate on error
              renegotiateConnection(peerId);
            });
          } catch (err) {
            console.error(`Exception replacing ${track.kind} track for peer ${peerId}:`, err);
            // Need to renegotiate on error
            renegotiateConnection(peerId);
          }
        } else {
          // Add new track - this is critical for when camera is enabled after connection is created
          try {
            console.log(`Adding new ${track.kind} track to peer ${peerId}`);
            peerConnection.addTrack(track, window.appState.localStream);
            
            // If connection is already established, we need to renegotiate
            // If connection is still establishing, the tracks will be included in the initial offer/answer
            if (isEstablished) {
              console.log(`Connection with ${peerId} is established, triggering renegotiation for new ${track.kind} track`);
              renegotiateConnection(peerId);
            } else {
              console.log(`Connection with ${peerId} is still establishing, ${track.kind} track will be included in next offer/answer`);
            }
          } catch (err) {
            console.error(`Error adding ${track.kind} track to peer ${peerId}:`, err);
            // Try to renegotiate even on error
            if (isEstablished) {
              renegotiateConnection(peerId);
            }
          }
        }
      });
      
      // Check for extra senders that need removal (if we no longer have that kind of track)
      const currentTrackKinds = new Set(tracks.map(t => t.kind));
      senders.forEach(sender => {
        if (sender.track && !currentTrackKinds.has(sender.track.kind)) {
          try {
            console.log(`Removing ${sender.track.kind} sender from peer ${peerId} as we no longer have that track`);
            peerConnection.removeTrack(sender);
            // Need to renegotiate after removing track
            if (isEstablished) {
              renegotiateConnection(peerId);
            }
          } catch (err) {
            console.error(`Error removing track from peer ${peerId}:`, err);
          }
        }
      });
      
    } else {
      console.log(`Cannot broadcast to peer ${peerId}, connection state: ${peerConnection.connectionState}, ICE state: ${peerConnection.iceConnectionState}`);
    }
  });
}

/**
 * Renegotiate a connection after media tracks have changed
 */
async function renegotiateConnection(peerId) {
  try {
    const peerConnection = window.appState.peerConnections[peerId];
    if (!peerConnection) {
      console.error(`Cannot renegotiate - no connection found for ${peerId}`);
      return;
    }
    
    // Don't renegotiate if connection isn't in stable state
    if (peerConnection.signalingState !== 'stable') {
      console.warn(`Connection for ${peerId} not in stable state (${peerConnection.signalingState}), waiting...`);
      
      // Try again after a delay if needed
      setTimeout(() => {
        if (window.appState.peerConnections[peerId] && 
            window.appState.peerConnections[peerId].signalingState === 'stable') {
          console.log(`Connection with ${peerId} is now stable, proceeding with renegotiation`);
          renegotiateConnection(peerId);
        }
      }, 1000);
      
      return;
    }
    
    console.log(`Creating renegotiation offer for ${peerId}`);
    
    // Create offer with proper options for renegotiation
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      voiceActivityDetection: false,
      iceRestart: true
    });
    
    // Set local description
    await peerConnection.setLocalDescription(offer);
    
    // Send the offer with renegotiation flag
    console.log(`Sending renegotiation offer to ${peerId}`);
    
    // Import socket function dynamically to avoid circular dependencies
    const { sendRenegotiationOffer } = await import('../services/socket.js');
    
    if (typeof sendRenegotiationOffer === 'function') {
      sendRenegotiationOffer(peerId, peerConnection.localDescription);
    } else {
      // Fallback if specific function isn't available
      const { sendOffer } = await import('../services/socket.js');
      if (typeof sendOffer === 'function') {
        // Send with additional data to indicate renegotiation
        sendOffer(peerId, peerConnection.localDescription, true);
      } else {
        console.error('Cannot find socket function to send renegotiation offer');
      }
    }
  } catch (error) {
    console.error(`Error renegotiating connection with ${peerId}:`, error);
  }
}

/**
 * Refreshes audio tracks to ensure they're live and working
 */
export async function refreshAudioTrack() {
  try {
    // Try to create a fresh stream or use existing one
    if (!window.appState.localStream) {
      console.log('Creating new local stream since none exists');
      window.appState.localStream = new MediaStream();
    }
    
    console.log('Refreshing audio track...');
    
    // Get new audio stream with enhanced echo cancellation settings
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Enhanced settings to reduce echo/feedback
        latency: 0,
        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16
      }
    });
    
    // Store for future use
    window.persistentAudioStream = audioStream.clone();
    
    // Get the new audio track
    const newAudioTrack = audioStream.getAudioTracks()[0];
    
    if (!newAudioTrack) {
      console.error('Failed to get new audio track');
      return;
    }
    
    console.log('Got fresh audio track:', newAudioTrack.label, 'state:', newAudioTrack.readyState);
    
    // Double check that echo cancellation is enabled
    try {
      const constraints = newAudioTrack.getConstraints ? newAudioTrack.getConstraints() : {};
      if (!constraints.echoCancellation) {
        console.log('Ensuring echo cancellation is enabled on new audio track');
        newAudioTrack.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }).catch(e => console.log('Could not apply audio constraints:', e));
      }
    } catch (e) {
      console.log('Error checking audio constraints:', e);
    }
    
    // Replace audio track in local stream
    const oldAudioTracks = window.appState.localStream.getAudioTracks();
    oldAudioTracks.forEach(track => {
      console.log(`Removing old audio track: ${track.label}, state: ${track.readyState}`);
      window.appState.localStream.removeTrack(track);
      track.stop();
    });
    
    // Add the new track to local stream
    console.log(`Adding new audio track to local stream: ${newAudioTrack.label}`);
    window.appState.localStream.addTrack(newAudioTrack);
    
    // Set enabled state based on mute status
    newAudioTrack.enabled = window.appState.isMicOn;
    
    // Update any local video elements with the refreshed stream
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = window.appState.localStream;
      localVideo.muted = true; // Prevent echo
    }
    
    // If local is in main view, update that too
    if (window.appState.pinnedParticipant === 'local') {
      const mainVideo = document.getElementById('mainVideo');
      if (mainVideo) {
        mainVideo.srcObject = window.appState.localStream;
        mainVideo.muted = true; // Prevent echo
      }
    }
    
    // Make sure all local audio elements are muted to prevent feedback
    // Import dynamically to avoid circular dependencies
    try {
      const { muteLocalAudioElements } = await import('../services/media.js');
      if (typeof muteLocalAudioElements === 'function') {
        muteLocalAudioElements();
      }
    } catch (e) {
      console.log('Could not import muteLocalAudioElements:', e);
      // Fallback - mute local video element directly
      if (localVideo) {
        localVideo.muted = true;
      }
    }
    
    // Log the state of the local stream
    console.log('Local stream after refresh:');
    window.appState.localStream.getTracks().forEach(track => {
      console.log(`- Track: ${track.kind}, label: ${track.label}, state: ${track.readyState}, enabled: ${track.enabled}`);
    });
    
    // Broadcast updated stream to all peers
    console.log('Broadcasting refreshed stream to all peers');
    broadcastMediaToAllConnections();
    
    return newAudioTrack;
  } catch (error) {
    console.error('Error refreshing audio track:', error);
    showError('Could not access microphone. Please check your device.');
    return null;
  }
}

/**
 * Creates a placeholder for users without video
 */
export function createVideoPlaceholder(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  
  // Check if placeholder already exists
  let placeholder = container.querySelector('.no-video-placeholder');
  
  if (!placeholder) {
    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800';
    placeholder.innerHTML = '<i class="fas fa-user-circle text-gray-400 text-4xl"></i>';
    container.appendChild(placeholder);
  }
  
  // Make sure it's visible
  placeholder.classList.remove('hidden');
  
  return placeholder;
}

/**
 * Removes a video placeholder if it exists
 */
export function removeVideoPlaceholder(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const placeholder = container.querySelector('.no-video-placeholder');
  if (placeholder) {
    placeholder.classList.add('hidden');
  }
} 