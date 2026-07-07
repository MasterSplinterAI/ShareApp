const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust the first proxy hop (nginx) so express-rate-limit / req.ip see the real client IP.
app.set('trust proxy', 1);

// Security headers. CSP/CORP are disabled because this process only serves a
// JSON API (the SPA is served statically by nginx) and CORS is handled below.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

// Throttle auth + public endpoints to blunt credential stuffing / brute force.
// In-memory store is sufficient for the current single-instance PM2 deploy.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
const publicJoinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});

// Middleware
// Allow CORS from localhost, network IP, and ngrok domains
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NETWORK_URL,
  process.env.STAGING_FRONTEND_URL,
  'https://staging.jarmetals.com',
  'https://share.jarmetals.com',
  'https://cockatoo-easy-similarly.ngrok.app', // Your custom ngrok domain
  'https://45304f934cbd.ngrok.app', // Previous ngrok URL
  'https://f46bc88e5f4e.ngrok.app', // Previous ngrok URL
  'https://e8376093ae1c.ngrok.app', // Current ngrok URL
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
const { handleV2BillingWebhook } = require('./routes/v2/billingWebhook');
const { handleLiveKitWebhook } = require('./routes/webhooks');
const { handleResendInboundWebhook } = require('./routes/v2/resendInboundWebhook');

// Raw-body routes must come before express.json()
app.post('/api/v2/billing/webhook', express.raw({ type: 'application/json' }), handleV2BillingWebhook);
app.post('/api/webhooks/livekit', express.raw({ type: '*/*' }), handleLiveKitWebhook);
app.post('/api/v2/webhooks/resend/inbound', express.raw({ type: 'application/json' }), handleResendInboundWebhook);
app.use(express.json());

// Routes
const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const translateRoutes = require('./routes/translate');

const v2Routes = require('./routes/v2');
const v2Database = require('./db/v2Database');

// Rate limits on sensitive auth + public join endpoints (mounted before the
// route handlers so they run first, then fall through). /me and prefs are left
// unthrottled since the app polls them.
app.use('/api/v2/auth/login', authLimiter);
app.use('/api/v2/auth/signup', authLimiter);
app.use('/api/v2/auth/forgot-password', authLimiter);
app.use('/api/v2/auth/reset-password', authLimiter);
app.use('/api/v2/auth/change-password', authLimiter);
app.use('/api/v2/join-info', publicJoinLimiter);
app.use('/api/v2/guest-token', publicJoinLimiter);
app.use('/api/auth', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/v2', v2Routes);
app.use('/api/cost-events', require('./routes/costEvents'));
app.use('/api/quality-events', require('./routes/qualityEvents'));

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

(async function start() {
  try {
    await v2Database.initDatabase();
  } catch (e) {
    console.error('[v2Database] init failed:', e.message);
  }
  try {
    const { startGuestInviteReminders } = require('./lib/guestInvites');
    const baseUrl = (process.env.PUBLIC_FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'https://staging.jarmetals.com').replace(/\/$/, '');
    startGuestInviteReminders((roomName, token) =>
      token
        ? `${baseUrl}/join/${encodeURIComponent(roomName)}?i=${encodeURIComponent(token)}`
        : `${baseUrl}/join/${encodeURIComponent(roomName)}`
    );
  } catch (e) {
    console.error('[guestInvites] scheduler start failed:', e.message);
  }
  try {
    const { settleDueOverageCycles } = require('./lib/v2OverageSettlement');
    const intervalMs = Number(process.env.V2_OVERAGE_SETTLEMENT_INTERVAL_MS || 0);
    if (intervalMs > 0) {
      const tick = () => {
        settleDueOverageCycles().catch((err) => console.error('[overage-settlement]', err.message));
      };
      tick();
      setInterval(tick, intervalMs);
      console.log(`[overage-settlement] scheduler every ${intervalMs}ms`);
    }
  } catch (e) {
    console.error('[overage-settlement] scheduler start failed:', e.message);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LiveKit backend server running on port ${PORT}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
    console.log(`Network URL: ${process.env.NETWORK_URL}`);
    console.log(`LiveKit URL: ${process.env.LIVEKIT_URL}`);
    console.log(`Server is accessible from network at: http://0.0.0.0:${PORT}`);
  });
})();
