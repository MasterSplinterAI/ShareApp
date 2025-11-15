# Daily.co Migration Guide

## ✅ Migration Complete!

The codebase has been successfully migrated from VideoSDK to Daily.co. Here's what was changed and what you need to do next.

## 🔄 What Changed

### Backend
- **`backend/routes/auth.js`**: Updated to use Daily.co token generation API (`/api/auth/daily-token`)
- **`backend/routes/meetings.js`**: Updated to use Daily.co room creation and validation APIs
- Removed VideoSDK JWT token generation (Daily.co uses simpler API key authentication)

### Frontend
- **Installed**: `@daily-co/daily-react` and `@daily-co/daily-js` packages
- **`frontend/src/components/MeetingRoom.jsx`**: Migrated from `MeetingProvider` to `DailyProvider`
- **`frontend/src/components/Controls.jsx`**: Updated to use Daily.co hooks (`useDaily`, `useLocalParticipant`)
- **`frontend/src/components/VideoGrid.jsx`**: Updated to use Daily.co participant hooks
- **`frontend/src/services/api.js`**: Updated token service to use Daily.co endpoint
- **`frontend/src/App.jsx`**: Added `roomUrl` state management
- **`frontend/src/components/HomeScreen.jsx`**: Updated to pass `roomUrl` through callbacks

## 📋 Setup Instructions

### 1. Create Daily.co Account
1. Go to [https://www.daily.co/](https://www.daily.co/)
2. Sign up for a free account
3. Choose your subdomain (e.g., `yourcompany.daily.co`)

### 2. Get Your API Key
1. Log into your Daily.co dashboard
2. Navigate to **Developers** section
3. Copy your **API Key**

### 3. Update Backend Environment Variables

Update `backend/.env` with your Daily.co credentials:

```bash
# Daily.co Configuration
DAILY_API_KEY=your_daily_api_key_here

# Server Configuration
PORT=3000

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5173
```

### 4. Update Frontend Environment Variables (Optional)

If you want to set a default Daily.co domain, create `frontend/.env`:

```bash
VITE_DAILY_DOMAIN=yourcompany.daily.co
```

**Note**: The app will automatically use the `roomUrl` returned from the backend when creating/joining rooms, so this is optional.

### 5. Start the Application

```bash
# Terminal 1: Start backend
cd backend
npm install  # If you haven't already
npm start

# Terminal 2: Start frontend
cd frontend
npm install  # If you haven't already
npm run dev
```

## 🧪 Testing

1. **Create a Meeting**: Click "Host Meeting" → Enter your name → Share the link
2. **Join a Meeting**: Click "Join Meeting" → Enter meeting ID → Enter your name
3. **Test Features**:
   - Toggle microphone
   - Toggle camera
   - Screen sharing
   - Chat (if implemented)
   - Participants list

## 🔍 Key Differences from VideoSDK

1. **Authentication**: Daily.co uses API key directly (no JWT generation needed)
2. **Room URLs**: Daily.co provides full room URLs (e.g., `https://yourdomain.daily.co/room-name`)
3. **Hooks**: Different hook names:
   - `useMeeting()` → `useDaily()`
   - `useParticipant(id)` → `useParticipant(sessionId)`
   - `useLocalParticipant()` → `useLocalParticipant()`
4. **Joining**: Uses `daily.join({ url: roomUrl, userName: name })` instead of token-based join

## 🐛 Troubleshooting

### "Failed to create room" error
- Check that `DAILY_API_KEY` is set correctly in `backend/.env`
- Verify your API key is valid in Daily.co dashboard

### "Failed to connect" error
- Ensure backend is running on port 3000
- Check browser console for detailed error messages
- Verify CORS settings in `backend/server.js`

### Video not showing
- Check browser permissions for camera/microphone
- Verify Daily.co domain is correct
- Check browser console for WebRTC errors

## 📚 Resources

- [Daily.co Documentation](https://docs.daily.co/)
- [Daily.co React SDK](https://docs.daily.co/reference/daily-react)
- [Daily.co REST API](https://docs.daily.co/reference/rest-api)

## 🎉 Next Steps

1. Set up your Daily.co account and API key
2. Test the application locally
3. Your existing translation agent should work without changes (it's separate from the video SDK)
4. Deploy when ready!

