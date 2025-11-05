# Vue 3 Quick Start Guide

## ✅ Setup Complete!

Your Vue 3 frontend is ready to go! Here's how to use it:

## Development Mode

### Terminal 1: Backend Server
```bash
npm run dev
# Server runs on http://localhost:3000
```

### Terminal 2: Vue Dev Server (with hot reload)
```bash
npm run dev:vue
# Vue app runs on http://localhost:5173
```

## Access the UIs

- **Classic UI**: `http://localhost:3000/` (your existing UI)
- **Vue UI**: `http://localhost:5173/vue-app.html` (new Vue UI)
- **Production Vue**: `http://localhost:3000/vue` (via backend server)

## What's Been Created

### ✅ Core Structure
- `public/vue-app.html` - Vue app entry point
- `public/js/vue-app/main.js` - Vue initialization
- `public/js/vue-app/App.vue` - Root component

### ✅ Composables (Reusable Logic)
- `useAppState.js` - Reactive state management (syncs with window.appState)
- `useSocket.js` - Socket.io integration
- `useMedia.js` - Media device management

### ✅ Components
- `HomeScreen.vue` - Host/Join meeting screen
- `MeetingScreen.vue` - Main meeting container
- `VideoGrid.vue` - Grid layout for videos
- `VideoTile.vue` - Individual video component
- `Controls.vue` - Bottom control bar

### ✅ Integration
- Server route added: `/vue` → serves Vue app
- State sync: Vue appState ↔ window.appState (for WebRTC compatibility)
- Existing WebRTC code works unchanged!

## Key Features

### 🎯 Reactive State
```vue
<!-- Change state → UI updates automatically -->
<button @click="appState.isCameraOn = !appState.isCameraOn">
  {{ appState.isCameraOn ? 'Camera On' : 'Camera Off' }}
</button>
```

### 🎯 Component-Based
```vue
<!-- Reusable, self-contained components -->
<VideoTile 
  :stream="stream"
  :participant="participant"
  @pin="handlePin"
/>
```

### 🎯 Mobile-Optimized
- Automatic touch event handling
- Responsive grid layouts
- Mobile-friendly controls

## Next Steps

1. **Test the Vue UI**
   ```bash
   npm run dev:vue
   # Open http://localhost:5173/vue-app.html
   ```

2. **Compare with Classic UI**
   - Open both UIs side-by-side
   - Test features (join, video, screen share)
   - Note any differences

3. **Customize**
   - Edit components in `public/js/vue-app/components/`
   - Adjust styles in component `<style>` blocks
   - Add new features as Vue components

4. **Production Build**
   ```bash
   npm run build:vue
   # Built files go to dist/
   ```

## Architecture Benefits

### ✅ No More Manual DOM Updates
- Vue handles all DOM manipulation
- No more `querySelector`, `getElementById`
- No more manual `updateVideoUI()` calls

### ✅ Automatic State Sync
- Vue appState ↔ window.appState
- Existing WebRTC code works unchanged
- Zero risk migration

### ✅ Better Mobile Support
- Vue's event system handles touch correctly
- No manual touch handlers needed
- Better z-index management

### ✅ Component Scoping
- CSS scoped per component
- No global style conflicts
- Cleaner code organization

## Troubleshooting

### Vue Dev Server Won't Start
```bash
# Make sure you're in project root
cd /Users/rhule/Documents/ShareApp/share-app
npm run dev:vue
```

### Socket.io Not Connecting
- Make sure backend server is running (`npm run dev`)
- Check Vite proxy config in `vite.config.js`

### State Not Syncing
- Check browser console for errors
- Verify `window.appState` exists
- Check sync interval in `useAppState.js`

### Video Not Showing
- Check WebRTC peer connections
- Verify streams are being added to `appState.peerConnections`
- Check browser console for WebRTC errors

## Comparison: Classic vs Vue

| Feature | Classic UI | Vue UI |
|---------|-----------|--------|
| **State Updates** | Manual DOM manipulation | Automatic reactivity |
| **Mobile Touch** | Manual handlers | Built-in support |
| **Component Reuse** | Copy-paste code | Import components |
| **CSS Conflicts** | Global styles | Scoped styles |
| **Debugging** | Console logs | Vue DevTools |
| **Bundle Size** | Smaller | ~35KB Vue overhead |

## Ready to Test!

1. Start backend: `npm run dev`
2. Start Vue dev server: `npm run dev:vue`
3. Open: `http://localhost:5173/vue-app.html`
4. Host or join a meeting
5. Test video, audio, screen share

**Enjoy your new Vue 3 frontend! 🎉**

