# Local Testing Guide

## ✅ Servers are Running!

The application is now running locally with:
- **Next.js App**: http://localhost:3000
- **Socket.io Server**: http://localhost:3001

## 🎯 Quick Test Steps

### Test 1: Create a Room (Host)

1. Open http://localhost:3000 in your browser
2. Click **"Host a Meeting"**
3. Click **"Create Room"**
4. You'll receive:
   - Room ID (e.g., "ABCD1234")
   - Host PIN (for you)
   - Participant PIN (for guests)

### Test 2: Join as Participant

1. Open a new browser tab or different browser
2. Go to http://localhost:3000
3. Click **"Join a Meeting"**
4. Enter the Room ID and Participant PIN
5. Click **"Join"**

### Test 3: Test Features

Once in the room, test these features:
- **🎤 Audio**: Click microphone button to mute/unmute
- **📹 Video**: Click camera button to turn on/off video
- **🖥️ Screen Share**: Click screen button to share your screen
- **📱 Mobile**: If testing on mobile, try Picture-in-Picture

## 🔍 Testing Tips

### For Best Local Testing:

1. **Multiple Browsers**: Use different browsers (Chrome + Firefox) to simulate multiple participants
2. **Incognito Mode**: Use incognito/private windows for additional test participants
3. **Mobile Testing**: Access from your phone using your computer's local IP:
   ```
   http://[YOUR_LOCAL_IP]:3000
   ```
   (Find your IP with `ipconfig` on Windows or `ifconfig` on Mac/Linux)

### What Works Without TURN:

- ✅ Local network connections (same WiFi)
- ✅ Screen sharing
- ✅ All UI features
- ✅ Room persistence

### What Needs TURN (for production):

- ❌ Connections through firewalls/NAT
- ❌ Different network connections
- ❌ Mobile data connections

## 🛠️ Troubleshooting

### If video doesn't work:
1. Check browser permissions (camera/microphone)
2. Make sure no other app is using the camera
3. Try refreshing the page

### If connection fails:
1. Check both servers are running (check terminal)
2. Try using Chrome (best WebRTC support)
3. Check browser console for errors (F12)

### If screen share doesn't work:
1. Some browsers need HTTPS for screen sharing in production
2. Try Chrome for best compatibility
3. Check system permissions

## 📊 Monitor the Servers

You can see server activity in the terminal where you ran `npm run dev:all`:
- Connection logs
- Room creation/joining
- WebRTC signaling events
- Any errors

## 🛑 Stop the Servers

To stop both servers, press `Ctrl+C` in the terminal where they're running.

## 🎉 Ready for Production?

To add your Cloudflare TURN credentials:

1. Edit `.env.local`
2. Replace `your_api_token_here` with your actual Cloudflare API token
3. Restart the servers

The app will then use Cloudflare TURN relay for better connectivity across different networks.
