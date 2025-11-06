// Application configuration
// Centralizes all environment variables and configuration

export const config = {
  // Cloudflare TURN Configuration
  cloudflare: {
    turnApiToken: process.env.CLOUDFLARE_TURN_API_TOKEN || '',
    turnTokenId: process.env.CLOUDFLARE_TURN_TOKEN_ID || '59d87715faf308d4ea571375623ec7a3',
  },

  // WebSocket Configuration
  websocket: {
    url: typeof window !== 'undefined' 
         ? window.location.origin // Always use the current origin
         : (process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'),
  },

  // Redis Configuration (optional)
  redis: {
    url: process.env.REDIS_URL,
  },

  // Room Configuration
  room: {
    maxParticipants: 10,
    pinLength: 6,
    ttl: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  },

  // WebRTC Configuration
  webrtc: {
    iceServers: [
      // Public STUN servers as fallback
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    // TURN servers will be added dynamically from Cloudflare
  },

  // Development mode
  isDevelopment: process.env.NODE_ENV === 'development',
};

// Validate required configuration
export function validateConfig(): void {
  if (!config.cloudflare.turnApiToken) {
    console.warn('⚠️ CLOUDFLARE_TURN_API_TOKEN not set - TURN relay will not work');
  }
  
  if (!config.cloudflare.turnTokenId) {
    throw new Error('CLOUDFLARE_TURN_TOKEN_ID is required');
  }
}
