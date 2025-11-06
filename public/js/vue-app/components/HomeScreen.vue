<template>
  <div class="home-screen">
    <div class="home-content">
      <h1 class="app-title">ShareApp</h1>
      <p class="app-subtitle">Video conferencing made simple</p>
      
      <div class="actions">
        <button @click="handleHost" class="btn btn-primary">
          <i class="fas fa-plus-circle"></i>
          <span>Host Meeting</span>
        </button>
        <button @click="handleJoin" class="btn btn-secondary">
          <i class="fas fa-sign-in-alt"></i>
          <span>Join Meeting</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'

const emit = defineEmits(['host', 'join'])

const handleHost = () => {
  const userName = prompt('Enter your name:')
  if (!userName) return

  // Prompt for access codes
  const hostCode = prompt('Enter host code (or leave blank):') || null
  const participantCode = prompt('Enter participant code (or leave blank):') || null

  emit('host', {
    userName,
    hostCode,
    participantCode,
  })
}

const handleJoin = () => {
  const userName = prompt('Enter your name:')
  if (!userName || userName.trim() === '') return

  const roomId = prompt('Enter room ID:')
  if (!roomId || roomId.trim() === '') return

  const accessCodeInput = prompt('Enter access code (or leave blank):')
  // Convert empty string to null, trim whitespace
  const accessCode = accessCodeInput && accessCodeInput.trim() !== '' ? accessCodeInput.trim() : null

  emit('join', {
    userName: userName.trim(),
    roomId: roomId.trim(),
    accessCode,
  })
}

// Add mobile touch handlers for buttons
onMounted(() => {
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  
  if (isMobile) {
    const hostBtn = document.querySelector('.btn-primary')
    const joinBtn = document.querySelector('.btn-secondary')
    
    const addTouchHandler = (btn) => {
      if (!btn) return
      
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault()
        e.stopPropagation()
      }, { passive: false })
      
      btn.addEventListener('touchend', (e) => {
        e.preventDefault()
        e.stopPropagation()
        btn.click()
      }, { passive: false })
      
      // Ensure mobile clickability
      btn.style.cssText += 'position: relative; z-index: 100; pointer-events: auto; touch-action: manipulation; -webkit-tap-highlight-color: rgba(0,0,0,0.1); cursor: pointer; min-width: 44px; min-height: 44px;'
    }
    
    addTouchHandler(hostBtn)
    addTouchHandler(joinBtn)
  }
})
</script>

<style scoped>
.home-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.home-content {
  text-align: center;
  padding: 2rem;
}

.app-title {
  font-size: 3rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.app-subtitle {
  font-size: 1.2rem;
  opacity: 0.9;
  margin-bottom: 3rem;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 300px;
  margin: 0 auto;
}

.btn {
  padding: 1rem 2rem;
  font-size: 1.1rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 500;
  position: relative;
  z-index: 100;
  pointer-events: auto;
  touch-action: manipulation;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
  min-width: 44px;
  min-height: 44px;
}

.btn-primary {
  background: white;
  color: #667eea;
}

.btn-primary:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 2px solid white;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-2px);
}

@media (max-width: 768px) {
  .app-title {
    font-size: 2rem;
  }
  
  .app-subtitle {
    font-size: 1rem;
  }
  
  .btn {
    padding: 0.875rem 1.5rem;
    font-size: 1rem;
  }
}
</style>

