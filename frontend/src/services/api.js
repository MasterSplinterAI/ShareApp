import axios from 'axios';

// Detect if we're on localhost or network, and use appropriate API URL
const getApiBaseUrl = () => {
  // Check if VITE_API_URL is explicitly set
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isProduction = import.meta.env.PROD;
  
  // In production (HTTPS), use relative paths - Nginx will proxy /api to backend
  if (isProduction || protocol === 'https:') {
    return ''; // Use relative paths, axios will use current origin
  }
  
  // If accessing via network IP (192.168.x.x), use network IP for API
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // We're on the network, use the same hostname for API
    return `http://${hostname}:3000`;
  }
  
  // Default to localhost
  return 'http://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();

// Log API URL for debugging (only in development)
if (import.meta.env.DEV) {
  console.log('API Base URL:', API_BASE_URL);
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Token service for Daily.co
export const tokenService = {
  async getToken(roomName, userName, isOwner = false) {
    try {
      const response = await api.get('/api/auth/daily-token', {
        params: {
          roomName,
          userName: userName || 'Guest',
          isOwner: isOwner.toString()
        }
      });
      return response.data.token;
    } catch (error) {
      console.error('Failed to get Daily.co token:', error);
      throw error;
    }
  },
};

// Meeting service
export const meetingService = {
  async createMeeting() {
    try {
      const response = await api.post('/api/meetings/create');
      return response.data;
    } catch (error) {
      console.error('Failed to create meeting:', error);
      throw error;
    }
  },

  async validateMeeting(meetingId) {
    try {
      const response = await api.get(`/api/meetings/${meetingId}/validate`);
      return response.data;
    } catch (error) {
      console.error('Failed to validate meeting:', error);
      throw error;
    }
  },

  async getMeetingInfo(meetingId) {
    try {
      const response = await api.get(`/api/meetings/${meetingId}/info`);
      return response.data;
    } catch (error) {
      console.error('Failed to get meeting info:', error);
      throw error;
    }
  },
};

// Translation service
export const translationService = {
  async startTranslation(meetingId, token) {
    try {
      const response = await api.post('/api/translation/start', {
        meetingId,
        token,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to start translation:', error);
      throw error;
    }
  },

  async stopTranslation(meetingId) {
    try {
      const response = await api.post('/api/translation/stop', {
        meetingId,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to stop translation:', error);
      throw error;
    }
  },

  async getTranslationStatus(meetingId) {
    try {
      const response = await api.get(`/api/translation/status/${meetingId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get translation status:', error);
      throw error;
    }
  },

  async setLanguagePreference(meetingId, participantId, languageCode) {
    try {
      const response = await api.post('/api/translation/language', {
        meetingId,
        participantId,
        languageCode
      });
      return response.data;
    } catch (error) {
      console.error('Failed to set language preference:', error);
      throw error;
    }
  },

  async getLanguagePreference(meetingId, participantId) {
    try {
      const response = await api.get(`/api/translation/language/${meetingId}/${participantId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get language preference:', error);
      throw error;
    }
  },

  async getTranscriptions(meetingId, participantId) {
    try {
      const response = await api.get(`/api/translation/transcriptions/${meetingId}/${participantId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get transcriptions:', error);
      throw error;
    }
  }
};

export default api;

