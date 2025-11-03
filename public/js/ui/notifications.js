// UI notifications module for showing error messages and connection status

// Show error toast
export function showError(message, duration = 8000) {
  const errorToast = document.getElementById('errorToast');
  const errorMessage = document.getElementById('errorMessage');
  
  if (!errorToast || !errorMessage) {
    // Fallback to alert if elements not found
    console.error('Error toast elements not found');
    alert(`Error: ${message}`);
    return;
  }
  
  // Set message
  errorMessage.textContent = message;
  
  // Show toast - handle both classic and modern UI styles
  errorToast.style.display = 'flex';
  errorToast.classList.remove('hidden');
  errorToast.classList.remove('translate-y-full', 'opacity-0');
  
  // Add a more noticeable animation for important errors
  if (duration > 5000) {
    errorToast.classList.add('animate-bounce');
    setTimeout(() => {
      errorToast.classList.remove('animate-bounce');
    }, 1000);
  }
  
  // Auto-hide after duration
  const timerId = setTimeout(() => {
    hideError();
  }, duration);
  
  // Store the timer ID on the element to ensure we can clear it if needed
  errorToast.dataset.timerId = timerId;
}

// Hide error toast
export function hideError() {
  const errorToast = document.getElementById('errorToast');
  
  if (!errorToast) {
    return;
  }
  
  // Clear any existing timeout
  if (errorToast.dataset.timerId) {
    clearTimeout(parseInt(errorToast.dataset.timerId));
  }
  
  // Hide toast - handle both classic and modern UI styles
  errorToast.style.display = 'none';
  errorToast.classList.add('hidden');
  errorToast.classList.add('translate-y-full', 'opacity-0');
}

// Update connection status indicator
export function updateConnectionStatus(status) {
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionStatusText = document.getElementById('connectionStatusText');
  
  if (!connectionStatus || !connectionStatusText) {
    return;
  }
  
  switch (status) {
    case 'idle':
      // No active connection, don't show the indicator
      connectionStatus.classList.add('hidden');
      break;
      
    case 'connecting':
      // Connecting to a room
      connectionStatus.classList.remove('hidden');
      connectionStatusText.className = 'text-yellow-700 bg-yellow-100 px-3 py-1 rounded-full text-sm font-medium';
      connectionStatusText.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Connecting...';
      break;
      
    case 'connected':
      // Connected to server but not yet in a room
      connectionStatus.classList.remove('hidden');
      connectionStatusText.className = 'text-blue-700 bg-blue-100 px-3 py-1 rounded-full text-sm font-medium';
      connectionStatusText.innerHTML = '<i class="fas fa-server mr-2"></i> Connected to server';
      
      // Hide after 3 seconds
      setTimeout(() => {
        if (connectionStatus.classList.contains('hidden')) return;
        
        connectionStatus.classList.add('hidden');
      }, 3000);
      break;
      
    case 'active':
      // Connected and in a room
      connectionStatus.classList.remove('hidden');
      connectionStatusText.className = 'text-green-700 bg-green-100 px-3 py-1 rounded-full text-sm font-medium';
      connectionStatusText.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Connected';
      
      // Hide after 3 seconds
      setTimeout(() => {
        if (connectionStatus.classList.contains('hidden')) return;
        
        connectionStatus.classList.add('hidden');
      }, 3000);
      break;
      
    case 'disconnected':
      // Disconnected from server
      connectionStatus.classList.remove('hidden');
      connectionStatusText.className = 'text-red-700 bg-red-100 px-3 py-1 rounded-full text-sm font-medium';
      connectionStatusText.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i> Disconnected';
      break;
      
    case 'error':
      // Connection error
      connectionStatus.classList.remove('hidden');
      connectionStatusText.className = 'text-red-700 bg-red-100 px-3 py-1 rounded-full text-sm font-medium';
      connectionStatusText.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Connection Error';
      break;
      
    default:
      connectionStatus.classList.add('hidden');
  }
}

// Show a notification with optional type, duration, and action button
export function showNotification(message, type = 'info', duration = 5000, actionText = null, actionCallback = null) {
  // Find or create the notification element
  let notification = document.getElementById('notification');
  let notificationText = document.getElementById('notificationText');
  let actionButton = document.getElementById('notificationAction');
  
  // Create notification elements if they don't exist
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'notification';
    notification.className = 'notification';
    document.body.appendChild(notification);
    
    notificationText = document.createElement('span');
    notificationText.id = 'notificationText';
    notification.appendChild(notificationText);
    
    actionButton = document.createElement('button');
    actionButton.id = 'notificationAction';
    actionButton.className = 'notification-action hidden';
    notification.appendChild(actionButton);
  }
  
  // Set message
  notificationText.textContent = message;
  
  // Apply appropriate class based on type
  notification.className = `notification ${type}`;
  
  // Handle action button if provided
  if (actionText && actionCallback) {
    actionButton.textContent = actionText;
    actionButton.className = 'notification-action';
    
    // Remove any existing click handlers
    const newActionButton = actionButton.cloneNode(true);
    notification.replaceChild(newActionButton, actionButton);
    actionButton = newActionButton;
    
    // Add new click handler
    actionButton.addEventListener('click', () => {
      actionCallback();
      notification.classList.remove('show');
    });
  } else {
    actionButton.className = 'notification-action hidden';
  }
  
  // Show notification
  notification.classList.add('show');
  
  // Clear any existing timeout
  if (window.notificationTimeout) {
    clearTimeout(window.notificationTimeout);
  }
  
  // Hide after duration
  window.notificationTimeout = setTimeout(() => {
    notification.classList.remove('show');
  }, duration);
  
  return notification;
} 