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
  if (!userName) return

  const roomId = prompt('Enter room ID:')
  if (!roomId) return

  const accessCode = prompt('Enter access code (or leave blank):') || null

  emit('join', {
    userName,
    roomId,
    accessCode,
  })
}
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

