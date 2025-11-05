# Vue 3 Quick Setup Guide

## Step 1: Install Dependencies

```bash
npm install vue@latest
npm install -D vite @vitejs/plugin-vue
```

## Step 2: Create Vite Config

Create `vite.config.js` in project root:

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/vue-app.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
```

## Step 3: Update package.json Scripts

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "build:css": "tailwindcss -i ./src/styles.css -o ./public/styles.css --watch",
    "dev:vue": "vite",
    "build:vue": "vite build",
    "preview:vue": "vite preview"
  }
}
```

## Step 4: Create Vue App Structure

### Directory Structure:
```
public/
├── vue-app.html          # Entry HTML file
└── js/
    └── vue-app/
        ├── main.js       # Vue app entry
        ├── App.vue       # Root component
        ├── composables/
        │   ├── useWebRTC.js
        │   ├── useSocket.js
        │   └── useAppState.js
        └── components/
            ├── VideoGrid.vue
            ├── VideoTile.vue
            ├── Controls.vue
            └── HomeScreen.vue
```

## Step 5: Create Basic Vue App

### `public/vue-app.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShareApp - Vue UI</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/vue-app/main.js"></script>
</body>
</html>
```

### `public/js/vue-app/main.js`:
```js
import { createApp } from 'vue'
import App from './App.vue'
import './styles.css' // If you want to import CSS

const app = createApp(App)
app.mount('#app')
```

### `public/js/vue-app/App.vue`:
```vue
<template>
  <div id="app" class="app-container">
    <HomeScreen v-if="!isInMeeting" @join="handleJoin" @host="handleHost" />
    <MeetingScreen v-else />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import HomeScreen from './components/HomeScreen.vue'
import MeetingScreen from './components/MeetingScreen.vue'
import { useAppState } from './composables/useAppState.js'

const { isInMeeting } = useAppState()

const handleJoin = (data) => {
  // Handle join logic
  console.log('Join:', data)
}

const handleHost = (data) => {
  // Handle host logic
  console.log('Host:', data)
}
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}
</style>
```

## Step 6: Create Composables (Reuse Existing Backend)

### `public/js/vue-app/composables/useAppState.js`:
```js
import { reactive } from 'vue'

export const appState = reactive({
  localStream: null,
  screenStream: null,
  peerConnections: {},
  roomId: null,
  isHost: false,
  pinnedParticipant: 'local',
  participants: {},
  isCameraOn: false,
  isMicOn: true,
  isScreenSharing: false,
  isInMeeting: false,
  deviceSettings: {
    selectedCamera: null,
    selectedMic: null,
    selectedSpeaker: null,
  },
})

export function useAppState() {
  return {
    appState,
    isInMeeting: () => appState.roomId !== null,
  }
}
```

### `public/js/vue-app/composables/useSocket.js`:
```js
import { io } from '/socket.io/socket.io.js'
import { appState } from './useAppState.js'
import { createPeerConnection } from '../../webrtc/peerConnection.js'

let socket = null

export function useSocket() {
  const connect = () => {
    socket = io()
    
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id)
    })
    
    socket.on('room-joined', (data) => {
      appState.roomId = data.roomId
      appState.isHost = data.isHost
      appState.isInMeeting = true
      // Handle existing participants
    })
    
    socket.on('user-joined', async (data) => {
      // Create peer connection using existing function
      await createPeerConnection(data.userId)
    })
    
    socket.on('user-left', (data) => {
      // Handle user leaving
    })
  }
  
  const joinRoom = (roomId, userName, accessCode = null) => {
    socket.emit('join', {
      roomId,
      userName,
      providedAccessCode: accessCode,
    })
  }
  
  return {
    connect,
    joinRoom,
    socket: () => socket,
  }
}
```

## Step 7: Create Basic Components

### `public/js/vue-app/components/HomeScreen.vue`:
```vue
<template>
  <div class="home-screen">
    <h1>ShareApp</h1>
    <div class="actions">
      <button @click="handleHost" class="btn btn-primary">
        <i class="fas fa-plus-circle"></i> Host Meeting
      </button>
      <button @click="handleJoin" class="btn btn-secondary">
        <i class="fas fa-sign-in-alt"></i> Join Meeting
      </button>
    </div>
  </div>
</template>

<script setup>
const emit = defineEmits(['host', 'join'])

const handleHost = () => {
  const userName = prompt('Enter your name:')
  if (userName) {
    emit('host', { userName })
  }
}

const handleJoin = () => {
  const userName = prompt('Enter your name:')
  const roomId = prompt('Enter room ID:')
  if (userName && roomId) {
    emit('join', { userName, roomId })
  }
}
</script>

<style scoped>
.home-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 2rem;
}

.actions {
  display: flex;
  gap: 1rem;
  flex-direction: column;
}

.btn {
  padding: 1rem 2rem;
  font-size: 1.1rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #4a6cf7;
  color: white;
}

.btn-primary:hover {
  background: #3a5ce7;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn-secondary:hover {
  background: #5b6572;
}
</style>
```

### `public/js/vue-app/components/MeetingScreen.vue`:
```vue
<template>
  <div class="meeting-screen">
    <VideoGrid />
    <Controls />
  </div>
</template>

<script setup>
import VideoGrid from './VideoGrid.vue'
import Controls from './Controls.vue'
</script>

<style scoped>
.meeting-screen {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
```

## Step 8: Update Server to Serve Vue App

### Add to `server.js`:
```js
// Serve Vue app at /vue route
app.get('/vue', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vue-app.html'));
});
```

## Step 9: Development Workflow

### Terminal 1: Backend Server
```bash
npm run dev
```

### Terminal 2: Vue Dev Server
```bash
npm run dev:vue
```

### Access:
- Classic UI: `http://localhost:3000/`
- Vue UI: `http://localhost:5173/vue-app.html` (or via Vite proxy)

## Step 10: Production Build

```bash
npm run build:vue
```

This creates `dist/` folder with built files. Update server to serve from `dist/` for production.

---

## Next Steps

1. ✅ Set up Vue 3 + Vite
2. ✅ Create basic app structure
3. ✅ Integrate existing WebRTC services
4. ✅ Build VideoGrid component
5. ✅ Build Controls component
6. ✅ Mobile optimization
7. ✅ Test side-by-side with classic UI

---

## Key Benefits You'll See Immediately

1. **No More Manual DOM Manipulation**
   - Vue handles all DOM updates automatically
   - No more `querySelector`, `getElementById`

2. **Reactive State**
   - Change `appState.isCameraOn` → UI updates automatically
   - No manual `updateVideoUI()` calls

3. **Component Scoping**
   - CSS scoped per component
   - No z-index conflicts
   - Cleaner code organization

4. **Better Mobile Support**
   - Vue's event system handles touch correctly
   - No manual touch handlers needed

---

Ready to start? Run `npm install vue@latest vite @vitejs/plugin-vue` and follow the steps!

