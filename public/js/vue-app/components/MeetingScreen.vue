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
  background: #1a1a1a;
  overflow: hidden;
}
</style>

