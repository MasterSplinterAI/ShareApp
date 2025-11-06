# Mobile Connection Debug Guide

## 📱 Test URLs for Your Mobile Device

### Main App:
```
http://192.168.1.47:3000
```

### Debug Test Page:
```
http://192.168.1.47:3000/mobile-test.html
```

## 🔍 What We've Fixed

1. **Added extensive logging** throughout the connection process
2. **WebSocket improvements**:
   - Added polling as fallback transport
   - Allow all CORS origins for testing
   - Added connection timeout (10 seconds)
   - Dynamic WebSocket URL based on current host

3. **Media handling improvements**:
   - Graceful fallback to audio-only if video fails
   - Better error handling for permissions
   - Won't fail completely if media is denied

4. **Room validation**:
   - Case-insensitive room IDs
   - PIN trimming for extra spaces

## 🧪 Mobile Test Page

I've created a special test page at `/mobile-test.html` that will help diagnose the issue:

1. **WebSocket Test** - Tests if mobile can connect to Socket.io server
2. **Media Test** - Tests camera/microphone permissions
3. **API Test** - Tests if APIs are reachable
4. **Full Conference Test** - Simulates the full connection flow

### How to Use the Test Page:

1. On your mobile device, go to:
   ```
   http://192.168.1.47:3000/mobile-test.html
   ```

2. Run each test in order:
   - Click "Test WebSocket" 
   - Click "Test Camera/Mic" (will ask for permissions)
   - Click "Test API"
   - Click "Test Full Flow"

3. Check the Debug Log at the bottom for detailed information

## 📊 What to Look For

### If WebSocket Test Fails:
- Mobile can't reach the Socket.io server
- Could be firewall or network issue
- Check if port 3001 is accessible

### If Media Test Fails:
- Browser doesn't have camera/mic permissions
- iOS Safari needs special handling
- Some browsers require HTTPS for media access

### If API Test Fails:
- Mobile can't reach the Next.js server
- Check if port 3000 is accessible

### If Full Test Fails:
- Check where in the process it fails
- Look at the specific error message

## 🖥️ Monitor Server Logs

While testing on mobile, watch the server logs:

```bash
tail -f /Users/rhule/.cursor/worktrees/share-app/xJVlP/conference-app/server.log
```

Look for:
- "Client connected" messages
- "User joining room" messages
- Any error messages

## 🔧 Common Mobile Issues

### iOS Safari:
- Requires user gesture for media access
- May need to enable camera/mic in Settings > Safari
- WebRTC support varies by iOS version (14.5+ recommended)

### Android Chrome:
- Usually works well
- May need to allow permissions in site settings
- Check Chrome flags for WebRTC (chrome://flags)

### General Mobile:
- Some networks block WebSocket connections
- Corporate WiFi may have restrictions
- Try mobile data vs WiFi

## 📝 Quick Debug Checklist

1. [ ] Can mobile access `http://192.168.1.47:3000`?
2. [ ] Does the mobile test page load?
3. [ ] Does WebSocket test pass?
4. [ ] Does media permission work?
5. [ ] Can you see "Client connected" in server logs?
6. [ ] Does the full test complete?

## 🚀 Next Steps

Based on test results:

1. **If WebSocket fails**: 
   - Try using mobile data instead of WiFi
   - Check firewall settings
   - May need to use HTTPS/WSS in production

2. **If media fails**:
   - Check browser permissions
   - Try different browser
   - May need HTTPS for production

3. **If everything passes but app still fails**:
   - Check browser console for errors
   - Look for specific error messages
   - May be a React/Next.js specific issue

## 💡 Current Theory

The "Connecting to conference..." issue on mobile when hosting is likely due to:

1. **WebSocket connection failure** - Mobile can't connect to Socket.io server
2. **Media permission timing** - Mobile browsers handle permissions differently
3. **CORS/Security** - Mobile browsers are stricter about mixed content

The mobile test page will help identify which of these is the issue!
