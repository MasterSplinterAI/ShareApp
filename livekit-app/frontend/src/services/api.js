import axios from 'axios';

// Detect if we're accessing via ngrok or network
const isNgrok = window.location.hostname.includes('ngrok.app') || 
                 window.location.hostname.includes('ngrok-free.app') ||
                 window.location.hostname.includes('ngrok.io');
const isNetworkAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const isHTTPS = window.location.protocol === 'https:';

// Determine API base URL
let API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

if (isNgrok || (isNetworkAccess && isHTTPS)) {
  // When using ngrok or HTTPS, backend needs to be proxied through ngrok too
  // For ngrok, we can use the same domain with /api path (Vite proxy)
  // Or set up a separate ngrok tunnel for backend
  API_BASE_URL = '/api'; // Use Vite proxy which will work with ngrok
} else if (isNetworkAccess) {
  // Network access without HTTPS - use HTTP backend
  API_BASE_URL = `http://${window.location.hostname}:3001/api`;
}

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Room management
export const roomService = {
  // Create a new room
  create: async () => {
    // No roomMode needed - agent uses unified optimized mode automatically
    const response = await api.post('/rooms/create', {});
    return response.data;
  },

  // Get room info
  getInfo: async (roomName) => {
    const response = await api.get(`/rooms/${roomName}`);
    return response.data;
  },

  // Get participants in a room
  getParticipants: async (roomName) => {
    const response = await api.get(`/rooms/${roomName}/participants`);
    return response.data;
  },

  // Delete a room
  delete: async (roomName, hostCode) => {
    const response = await api.delete(`/rooms/${roomName}`, {
      data: { hostCode }
    });
    return response.data;
  },
};

// Authentication and token generation
export const authService = {
  // Get access token for joining a room
  getToken: async (roomName, participantName, isHost = false) => {
    const response = await api.post('/auth/token', {
      roomName,
      participantName,
      isHost
    });
    return response.data;
  },
};

// Translation preferences (for future use)
export const translationService = {
  // Update language preference
  updateLanguage: async (roomName, participantId, language) => {
    const response = await api.post('/translation/language', {
      roomName,
      participantId,
      language
    });
    return response.data;
  },

  // Get transcriptions
  getTranscriptions: async (roomName, participantId) => {
    const response = await api.get(`/translation/transcriptions/${roomName}/${participantId}`);
    return response.data;
  },
};

export default api;
