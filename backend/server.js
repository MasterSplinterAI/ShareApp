const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - Allow CORS from localhost and local network
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

// Add local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const localNetworkPattern = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
const isLocalNetwork = (origin) => {
  if (!origin) return false;
  return localNetworkPattern.test(origin) || origin.includes(':5173');
};

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list or is local network
    if (allowedOrigins.includes(origin) || isLocalNetwork(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Request logging middleware (only log errors)
app.use((req, res, next) => {
  // Only log non-GET requests to reduce noise
  if (req.method !== 'GET') {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/translation', require('./routes/translation'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server - listen on all network interfaces (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}/health`);
  console.log(`Network: http://192.168.1.83:${PORT}/health`);
  console.log(`\nFrontend should be accessible at:`);
  console.log(`  Local: http://localhost:5173`);
  console.log(`  Network: http://192.168.1.83:5173`);
});

