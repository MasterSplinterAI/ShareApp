// Notification service for toast notifications and error display
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';

class NotificationService {
  constructor() {
    this.notifications = [];
    this.container = null;
    this.setupContainer();
  }

  /**
   * Setup notification container
   */
  setupContainer() {
    // Create container if it doesn't exist
    let container = document.getElementById('notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    this.container = container;
  }

  /**
   * Show notification
   */
  show(message, type = 'info', duration = 5000) {
    const notification = {
      id: `notification-${Date.now()}-${Math.random()}`,
      message,
      type,
      duration,
      timestamp: Date.now()
    };

    this.notifications.push(notification);
    this.renderNotification(notification);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this.remove(notification.id);
      }, duration);
    }

    logger.debug('NotificationService', 'Notification shown', { type, message });

    return notification.id;
  }

  /**
   * Show success notification
   */
  success(message, duration = 5000) {
    return this.show(message, 'success', duration);
  }

  /**
   * Show error notification
   */
  error(message, duration = 10000) {
    return this.show(message, 'error', duration);
  }

  /**
   * Show warning notification
   */
  warning(message, duration = 7000) {
    return this.show(message, 'warning', duration);
  }

  /**
   * Show info notification
   */
  info(message, duration = 5000) {
    return this.show(message, 'info', duration);
  }

  /**
   * Render notification element
   */
  renderNotification(notification) {
    const element = document.createElement('div');
    element.id = notification.id;
    element.className = `notification notification-${notification.type}`;
    element.style.cssText = `
      background: ${this.getBackgroundColor(notification.type)};
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 300px;
      max-width: 500px;
      pointer-events: auto;
      animation: slideIn 0.3s ease-out;
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    // Icon
    const icon = document.createElement('i');
    icon.className = `fas ${this.getIcon(notification.type)}`;
    element.appendChild(icon);

    // Message
    const messageEl = document.createElement('span');
    messageEl.textContent = notification.message;
    messageEl.style.flex = '1';
    element.appendChild(messageEl);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeBtn.onclick = () => this.remove(notification.id);
    element.appendChild(closeBtn);

    // Add animation styles if not already added
    if (!document.getElementById('notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    this.container.appendChild(element);
  }

  /**
   * Remove notification
   */
  remove(id) {
    const element = document.getElementById(id);
    if (element) {
      element.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => {
        element.remove();
      }, 300);
    }

    this.notifications = this.notifications.filter(n => n.id !== id);
  }

  /**
   * Clear all notifications
   */
  clear() {
    this.notifications.forEach(notification => this.remove(notification.id));
  }

  /**
   * Get background color for notification type
   */
  getBackgroundColor(type) {
    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };
    return colors[type] || colors.info;
  }

  /**
   * Get icon for notification type
   */
  getIcon(type) {
    const icons = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle'
    };
    return icons[type] || icons.info;
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
export default notificationService;

