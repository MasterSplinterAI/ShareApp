import axios from 'axios';
import { resolveApiBaseUrl } from '../lib/nativePlatform';

const API_BASE_URL = resolveApiBaseUrl();

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Room management
export const roomService = {
  // Create a new room (optionally with a specific name from an invite slug)
  create: async (roomName = null) => {
    const response = await api.post('/rooms/create', roomName ? { roomName } : {});
    return response.data;
  },

  // Generate an invite link (no room created yet -- room created on-demand)
  createInvite: async () => {
    const response = await api.post('/rooms/invite', {});
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

/** V2 public join preview + guest LiveKit token (no auth). */
export const joinPublicService = {
  joinInfo: (roomName, i) => api.get('/v2/join-info', { params: { roomName, i } }).then((r) => r.data),
  guestToken: (body) => api.post('/v2/guest-token', body).then((r) => r.data),
};

/** Ephemeral in-meeting chat — bypasses SQLite cache (no_cache: true) */
export const chatService = {
  translate: async (text, sourceLanguage, targetLanguage) => {
    if (!text || typeof text !== 'string') return text;
    if (sourceLanguage === targetLanguage) return text;
    try {
      const { data } = await api.post('/translate', {
        text,
        source_language: sourceLanguage,
        target_language: targetLanguage,
        no_cache: true,
      });
      return data?.translated ?? text;
    } catch {
      return text;
    }
  },
};

export default api;
