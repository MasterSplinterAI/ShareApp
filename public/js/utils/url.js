// URL utility module for handling room URLs

// Generate a random room ID
export function generateRoomId(length = 6) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }
  
  return result;
}

// Get room ID from URL parameters
export function getRoomFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('room');
}

// Set room ID in URL without reloading the page
export function setRoomInUrl(roomId) {
  if (!roomId) {
    return;
  }
  
  // Create URL object
  const url = new URL(window.location.href);
  
  // Set room parameter
  url.searchParams.set('room', roomId);
  
  // Update URL without reloading
  window.history.pushState({}, '', url);
}

// Remove room ID from URL
export function removeRoomFromUrl() {
  const url = new URL(window.location.href);
  
  // Remove room parameter
  url.searchParams.delete('room');
  
  // Update URL without reloading
  window.history.pushState({}, '', url);
}

// Get shareable link for a room (includes room code in URL)
export function getShareableLink(roomId) {
  if (!roomId) {
    return null;
  }
  
  const url = new URL(window.location.origin);
  url.searchParams.set('room', roomId);
  
  return url.toString();
}

// Get shareable link with access code hint (for display purposes)
export function getShareableLinkWithCode(roomId, accessCode) {
  const link = getShareableLink(roomId);
  if (!link || !accessCode) {
    return link;
  }
  
  // Note: We don't put the access code in the URL for security
  // Users will need to enter it when joining
  return link;
}

// Initialize room from URL if present
export function initRoomFromUrl() {
  const roomId = getRoomFromUrl();
  
  if (roomId) {
    // Store in app state for later use
    window.appState.roomId = roomId;
  }
  
  return roomId;
} 