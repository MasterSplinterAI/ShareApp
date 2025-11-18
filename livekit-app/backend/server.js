const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
// Allow CORS from localhost, network IP, and ngrok domains
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NETWORK_URL,
  'https://cockatoo-easy-similarly.ngrok.app', // Your custom ngrok domain
  'https://45304f934cbd.ngrok.app', // Previous ngrok URL
  'https://f46bc88e5f4e.ngrok.app', // Current ngrok URL
  /^https:\/\/.*\.ngrok\.app$/, // Any ngrok.app domain
  /^https:\/\/.*\.ngrok-free\.app$/, // Any ngrok-free.app domain (free accounts)
  /^https:\/\/.*\.ngrok\.io$/,  // Any ngrok.io domain
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, be more permissive
    if (process.env.NODE_ENV === 'development') {
      // Allow all ngrok domains and localhost
      if (origin.includes('ngrok') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        console.log(`✅ Allowing CORS for origin: ${origin}`);
        return callback(null, true);
      }
    }
    
    // Check if origin is in allowed list
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      console.log(`✅ Allowing CORS for origin: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ Blocking CORS for origin: ${origin}`);
      console.log(`   Allowed origins:`, allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Routes
const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'livekit-backend' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LiveKit backend server running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`Network URL: ${process.env.NETWORK_URL}`);
  console.log(`LiveKit URL: ${process.env.LIVEKIT_URL}`);
  console.log(`Server is accessible from network at: http://0.0.0.0:${PORT}`);
});
