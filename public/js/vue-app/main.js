// Vue App Entry Point
import { createApp } from 'vue'
import App from './App.vue'
import { initializeIceServers } from '../utils/iceServers.js'

// Initialize ICE servers early
await initializeIceServers()

const app = createApp(App)
app.mount('#app')

