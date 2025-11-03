// Modern UI Manager - Toggle between old and new UI
// Based on Zoom/Teams design patterns

const UI_MODES = {
  CLASSIC: 'classic',      // Current UI
  MODERN: 'modern'          // New modern UI
};

let currentUIMode = UI_MODES.CLASSIC;

// Z-index hierarchy (from bottom to top):
// 0-10: Background content
// 20-30: Video containers and labels
// 40-50: Panels (chat, participants)
// 60-70: Modals
// 80-90: Controls and buttons
// 100+: Dropdowns and tooltips

const Z_INDEX = {
  VIDEO: 10,
  VIDEO_LABEL: 20,
  VIDEO_CONTROLS: 25,
  PANEL: 40,
  MODAL_BACKDROP: 50,
  MODAL: 60,
  CONTROLS_BAR: 80,
  CONTROL_BUTTON: 85,
  DROPDOWN: 100
};

export function initializeUIManager() {
  // Default to classic UI (don't read from localStorage for default)
  // Only check URL parameter if needed
  const urlParams = new URLSearchParams(window.location.search);
  const urlUIMode = urlParams.get('ui');
  
  // Use URL parameter if present, otherwise default to classic
  if (urlUIMode && Object.values(UI_MODES).includes(urlUIMode)) {
    currentUIMode = urlUIMode;
  } else {
    currentUIMode = UI_MODES.CLASSIC; // Default to classic
  }
  
  // Apply initial UI mode
  applyUIMode(currentUIMode);
  
  // Setup UI toggle button
  setupUIToggle();
}

export function setUIMode(mode) {
  if (!Object.values(UI_MODES).includes(mode)) {
    console.warn(`Invalid UI mode: ${mode}`);
    return;
  }
  
  currentUIMode = mode;
  localStorage.setItem('uiMode', mode);
  applyUIMode(mode);
}

export function getCurrentUIMode() {
  return currentUIMode;
}

function applyUIMode(mode) {
  const body = document.body;
  
  // Remove all UI mode classes
  body.classList.remove('ui-classic', 'ui-modern');
  
  // Add current mode class
  body.classList.add(`ui-${mode}`);
  
  // Apply mode-specific styles
  if (mode === UI_MODES.MODERN) {
    applyModernUI();
  } else {
    applyClassicUI();
  }
  
  console.log(`Applied UI mode: ${mode}`);
}

function applyModernUI() {
  // Inject modern UI CSS
  injectModernUICSS();
  
  // Restructure layout for modern UI
  restructureForModernUI();
  
  // Fix z-index issues
  fixZIndexHierarchy();
}

function applyClassicUI() {
  // Remove modern UI structure
  removeModernUI();
  
  // Ensure classic UI is visible
  const classicElements = document.querySelectorAll('.classic-ui');
  classicElements.forEach(el => el.classList.remove('hidden'));
}

function injectModernUICSS() {
  // Check if already injected
  if (document.getElementById('modern-ui-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'modern-ui-styles';
  style.textContent = `
    /* Modern UI Styles - Zoom/Teams inspired */
    .ui-modern {
      /* Ensure proper stacking context */
      position: relative;
    }
    
    /* Video Grid - Modern Layout */
    .ui-modern #videoGrid {
      position: relative;
      width: 100%;
      height: calc(100vh - 140px); /* Account for controls */
      overflow: hidden;
      background: #000;
      z-index: ${Z_INDEX.VIDEO};
    }
    
    /* Main Video Container */
    .ui-modern #mainVideoContainer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: ${Z_INDEX.VIDEO};
      background: #000;
    }
    
    /* Participants Grid - Grid View */
    .ui-modern #participantsGrid {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 4px;
      padding: 4px;
      z-index: ${Z_INDEX.VIDEO};
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    
    /* Video Containers */
    .ui-modern .video-container {
      position: relative;
      background: #000;
      border-radius: 4px;
      overflow: hidden;
      aspect-ratio: 16/9;
      z-index: ${Z_INDEX.VIDEO};
    }
    
    .ui-modern video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    /* Video Labels */
    .ui-modern .video-label {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
      padding: 8px 12px;
      color: white;
      font-size: 12px;
      z-index: ${Z_INDEX.VIDEO_LABEL};
      pointer-events: none;
    }
    
    /* Video Controls (pin buttons) */
    .ui-modern .participant-control,
    .ui-modern .video-control {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(0, 0, 0, 0.6);
      border: none;
      border-radius: 4px;
      color: white;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: ${Z_INDEX.VIDEO_CONTROLS};
      transition: all 0.2s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    
    .ui-modern .participant-control:hover,
    .ui-modern .video-control:hover {
      background: rgba(0, 0, 0, 0.8);
      transform: scale(1.1);
    }
    
    .ui-modern .participant-control:active,
    .ui-modern .video-control:active {
      transform: scale(0.95);
    }
    
    /* Controls Bar - Fixed Bottom (Zoom style) */
    .ui-modern #controls {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      padding: 12px 16px;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      z-index: ${Z_INDEX.CONTROLS_BAR};
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    /* Control Buttons */
    .ui-modern #controls .btn-circle {
      width: 48px;
      height: 48px;
      min-width: 48px;
      min-height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      z-index: ${Z_INDEX.CONTROL_BUTTON};
      position: relative;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      pointer-events: auto !important;
    }
    
    .ui-modern #controls .btn-circle i {
      font-size: 20px;
      pointer-events: none;
    }
    
    .ui-modern #controls .btn-circle:hover {
      transform: scale(1.1);
      background: rgba(255, 255, 255, 0.2) !important;
    }
    
    .ui-modern #controls .btn-circle:active {
      transform: scale(0.95);
    }
    
    /* Leave Button */
    .ui-modern #leaveBtn {
      background: #dc3545;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 24px;
      font-weight: 600;
      cursor: pointer;
      z-index: ${Z_INDEX.CONTROL_BUTTON};
      position: relative;
      touch-action: manipulation;
      pointer-events: auto !important;
    }
    
    .ui-modern #leaveBtn:hover {
      background: #c82333;
      transform: scale(1.05);
    }
    
    /* Panels */
    .ui-modern #participantsPanel,
    .ui-modern #chatPanel {
      position: fixed;
      top: 0;
      right: 0;
      width: 100%;
      max-width: 400px;
      height: calc(100vh - 80px);
      bottom: 80px;
      background: white;
      z-index: ${Z_INDEX.PANEL};
      box-shadow: -2px 0 10px rgba(0,0,0,0.1);
    }
    
    /* Modals */
    .ui-modern #deviceModal,
    .ui-modern #networkModal {
      z-index: ${Z_INDEX.MODAL};
    }
    
    .ui-modern #deviceModal::before,
    .ui-modern #networkModal::before {
      content: '';
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: ${Z_INDEX.MODAL_BACKDROP};
    }
    
    /* Dropdowns */
    .ui-modern #layoutMenu,
    .ui-modern #settingsMenu {
      z-index: ${Z_INDEX.DROPDOWN};
    }
    
    /* Mobile Optimizations */
    @media (max-width: 768px) {
      .ui-modern #videoGrid {
        height: calc(100vh - 100px);
      }
      
      .ui-modern #controls {
        padding: 16px 12px;
        gap: 8px;
      }
      
      .ui-modern #controls .btn-circle {
        width: 56px;
        height: 56px;
        min-width: 56px;
        min-height: 56px;
      }
      
      .ui-modern #controls .btn-circle i {
        font-size: 24px;
      }
      
      .ui-modern #leaveBtn {
        padding: 14px 20px;
        font-size: 16px;
      }
      
      .ui-modern #participantsGrid {
        grid-template-columns: repeat(2, 1fr);
        gap: 2px;
        padding: 2px;
      }
      
      .ui-modern #participantsPanel,
      .ui-modern #chatPanel {
        width: 100%;
        max-width: 100%;
        bottom: 100px;
      }
      
      /* Ensure buttons are always clickable */
      .ui-modern #controls button {
        pointer-events: auto !important;
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(255, 255, 255, 0.1);
      }
    }
    
    /* Portrait mobile */
    @media (max-width: 768px) and (orientation: portrait) {
      .ui-modern #participantsGrid {
        grid-template-columns: repeat(2, 1fr);
      }
      
      .ui-modern .video-container {
        aspect-ratio: 9/16;
      }
    }
    
    /* Landscape mobile */
    @media (max-width: 768px) and (orientation: landscape) {
      .ui-modern #videoGrid {
        height: calc(100vh - 80px);
      }
      
      .ui-modern #controls {
        padding: 8px 12px;
      }
      
      .ui-modern #participantsGrid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    
    /* Grid View Toggle */
    .ui-modern .grid-view-toggle {
      position: fixed;
      top: 16px;
      right: 16px;
      background: rgba(0, 0, 0, 0.6);
      border: none;
      border-radius: 24px;
      color: white;
      padding: 8px 16px;
      cursor: pointer;
      z-index: ${Z_INDEX.CONTROL_BUTTON};
      display: flex;
      align-items: center;
      gap: 8px;
      touch-action: manipulation;
    }
    
    .ui-modern .grid-view-toggle:hover {
      background: rgba(0, 0, 0, 0.8);
    }
    
    /* Speaker View (main video visible) */
    .ui-modern.speaker-view #mainVideoContainer {
      display: block;
    }
    
    .ui-modern.speaker-view #participantsGrid {
      display: none;
    }
    
    /* Grid View (all videos equal) */
    .ui-modern.grid-view #mainVideoContainer {
      display: none;
    }
    
    .ui-modern.grid-view #participantsGrid {
      display: grid;
    }
  `;
  
  document.head.appendChild(style);
}

function restructureForModernUI() {
  // Add grid view toggle button
  if (!document.getElementById('gridViewToggle')) {
    const toggle = document.createElement('button');
    toggle.id = 'gridViewToggle';
    toggle.className = 'grid-view-toggle';
    toggle.innerHTML = '<i class="fas fa-th"></i> <span>Grid</span>';
    toggle.addEventListener('click', toggleGridView);
    document.body.appendChild(toggle);
  }
  
  // Ensure controls are in the right place
  const controls = document.getElementById('controls');
  if (controls) {
    controls.style.position = 'fixed';
    controls.style.bottom = '0';
    controls.style.left = '0';
    controls.style.right = '0';
  }
}

function toggleGridView() {
  const body = document.body;
  const isGridView = body.classList.contains('grid-view');
  
  if (isGridView) {
    body.classList.remove('grid-view');
    body.classList.add('speaker-view');
    const toggleBtn = document.getElementById('gridViewToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-th"></i> <span>Grid</span>';
    }
  } else {
    body.classList.remove('speaker-view');
    body.classList.add('grid-view');
    const toggleBtn = document.getElementById('gridViewToggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-user"></i> <span>Speaker</span>';
    }
  }
  
  // Also update layout manager if in modern UI
  if (currentUIMode === UI_MODES.MODERN) {
    import('./layout.js').then(({ setLayoutMode, LAYOUT_MODES }) => {
      // Import layout modes - map grid view to grid-only, speaker to standard
      const newLayout = isGridView ? LAYOUT_MODES.GRID_ONLY : LAYOUT_MODES.STANDARD;
      // Note: We're handling this in modern UI differently, so we won't change layout mode
      // The modern UI handles its own grid/speaker toggle
    }).catch(err => console.warn('Could not import layout manager:', err));
  }
}

function removeModernUI() {
  const toggle = document.getElementById('gridViewToggle');
  if (toggle) toggle.remove();
  
  const style = document.getElementById('modern-ui-styles');
  if (style) style.remove();
}

function fixZIndexHierarchy() {
  // Ensure all elements have proper z-index
  const videoContainers = document.querySelectorAll('.video-container');
  videoContainers.forEach(container => {
    container.style.zIndex = Z_INDEX.VIDEO;
  });
  
  const controls = document.getElementById('controls');
  if (controls) {
    controls.style.zIndex = Z_INDEX.CONTROLS_BAR;
  }
  
  const buttons = controls?.querySelectorAll('button');
  buttons?.forEach(btn => {
    btn.style.zIndex = Z_INDEX.CONTROL_BUTTON;
    btn.style.pointerEvents = 'auto';
  });
}

function setupUIToggle() {
  // Add UI toggle button to settings menu
  const settingsMenu = document.getElementById('settingsMenu');
  if (settingsMenu) {
    const uiToggleMenuItem = settingsMenu.querySelector('#uiToggleMenuItem');
    if (uiToggleMenuItem) {
      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'uiToggleBtn';
      toggleBtn.className = 'w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors';
      toggleBtn.innerHTML = `
        <i class="fas fa-palette mr-2"></i> Switch to ${currentUIMode === UI_MODES.CLASSIC ? 'Modern' : 'Classic'} UI
      `;
      
      toggleBtn.addEventListener('click', () => {
        const newMode = currentUIMode === UI_MODES.CLASSIC ? UI_MODES.MODERN : UI_MODES.CLASSIC;
        setUIMode(newMode);
        // Update button text
        toggleBtn.innerHTML = `
          <i class="fas fa-palette mr-2"></i> Switch to ${newMode === UI_MODES.CLASSIC ? 'Modern' : 'Classic'} UI
        `;
        // Close settings menu
        settingsMenu.classList.add('hidden');
      });
      
      uiToggleMenuItem.appendChild(toggleBtn);
    } else {
      // Fallback: create menu item if structure doesn't exist
      const menuItems = settingsMenu.querySelector('ul');
      if (menuItems) {
        const toggleItem = document.createElement('li');
        toggleItem.innerHTML = `
          <button id="uiToggleBtn" class="w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors">
            <i class="fas fa-palette mr-2"></i> Switch to ${currentUIMode === UI_MODES.CLASSIC ? 'Modern' : 'Classic'} UI
          </button>
        `;
        menuItems.appendChild(toggleItem);
        
        const uiToggleBtn = document.getElementById('uiToggleBtn');
        uiToggleBtn.addEventListener('click', () => {
          const newMode = currentUIMode === UI_MODES.CLASSIC ? UI_MODES.MODERN : UI_MODES.CLASSIC;
          setUIMode(newMode);
          uiToggleBtn.innerHTML = `
            <i class="fas fa-palette mr-2"></i> Switch to ${newMode === UI_MODES.CLASSIC ? 'Modern' : 'Classic'} UI
          `;
          settingsMenu.classList.add('hidden');
        });
      }
    }
  }
}

// Export for use in other modules
export { UI_MODES, Z_INDEX };

