// Video layout manager - handles different view modes
// Supports: standard, grid-only, side-by-side, compact

const LAYOUT_MODES = {
  STANDARD: 'standard',      // Main video + grid below (current)
  GRID_ONLY: 'grid-only',    // All videos in equal grid
  SIDE_BY_SIDE: 'side-by-side', // Main video left, grid right
  COMPACT: 'compact'         // Smaller main video + larger grid
};

let currentLayoutMode = LAYOUT_MODES.STANDARD;

export function initializeLayoutManager() {
  // Set initial layout mode from localStorage or default
  const savedLayout = localStorage.getItem('videoLayoutMode');
  if (savedLayout && Object.values(LAYOUT_MODES).includes(savedLayout)) {
    currentLayoutMode = savedLayout;
  }
  
  // Initialize with equal-sized tile layout
  updateVideoTileLayout();
  
  applyLayout(currentLayoutMode);
  setupLayoutSwitcher();
}

export function setLayoutMode(mode) {
  if (!Object.values(LAYOUT_MODES).includes(mode)) {
    console.warn(`Invalid layout mode: ${mode}`);
    return;
  }
  
  currentLayoutMode = mode;
  localStorage.setItem('videoLayoutMode', mode);
  applyLayout(mode);
  
  // Update UI
  updateLayoutSwitcherUI();
}

export function getCurrentLayoutMode() {
  return currentLayoutMode;
}

export function getAvailableLayoutModes() {
  return Object.values(LAYOUT_MODES);
}

function applyLayout(mode) {
  const videoGrid = document.getElementById('videoGrid');
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  const participantsGrid = document.getElementById('participantsGrid');
  
  if (!videoGrid || !mainVideoContainer || !participantsGrid) {
    console.warn('Layout elements not found');
    return;
  }
  
  // Remove all layout classes
  videoGrid.classList.remove('layout-standard', 'layout-grid-only', 'layout-side-by-side', 'layout-compact');
  mainVideoContainer.classList.remove('layout-standard', 'layout-grid-only', 'layout-side-by-side', 'layout-compact');
  participantsGrid.classList.remove('layout-standard', 'layout-grid-only', 'layout-side-by-side', 'layout-compact');
  
  // Apply mode-specific classes
  videoGrid.classList.add(`layout-${mode}`);
  mainVideoContainer.classList.add(`layout-${mode}`);
  participantsGrid.classList.add(`layout-${mode}`);
  
  // Apply mode-specific layout
  switch (mode) {
    case LAYOUT_MODES.STANDARD:
      applyStandardLayout(mainVideoContainer, participantsGrid);
      break;
    case LAYOUT_MODES.GRID_ONLY:
      applyGridOnlyLayout(mainVideoContainer, participantsGrid);
      break;
    case LAYOUT_MODES.SIDE_BY_SIDE:
      applySideBySideLayout(mainVideoContainer, participantsGrid);
      break;
    case LAYOUT_MODES.COMPACT:
      applyCompactLayout(mainVideoContainer, participantsGrid);
      break;
  }
  
  console.log(`Applied layout mode: ${mode}`);
}

function applyStandardLayout(mainVideoContainer, participantsGrid) {
  // Standard: Main video large on top, grid below
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.className = 'flex flex-col gap-4 mb-6';
  }
  mainVideoContainer.style.cssText = 'width: 100%; aspect-ratio: 16/9; min-height: 400px; max-height: 70vh;';
  participantsGrid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 w-full video-grid';
  mainVideoContainer.classList.remove('hidden');
}

function applyGridOnlyLayout(mainVideoContainer, participantsGrid) {
  // Grid only: Hide main video, show all videos in equal grid
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.className = 'mb-6';
  }
  mainVideoContainer.classList.add('hidden');
  
  // Calculate optimal grid columns based on participant count
  const participantCount = participantsGrid.children.length;
  let cols = 2;
  if (participantCount <= 2) cols = 2;
  else if (participantCount <= 4) cols = 2;
  else if (participantCount <= 6) cols = 3;
  else if (participantCount <= 9) cols = 3;
  else if (participantCount <= 12) cols = 4;
  else cols = 5;
  
  // Use Tailwind classes, but we'll need to set them dynamically
  const baseClasses = 'grid gap-3 w-full video-grid';
  participantsGrid.className = baseClasses;
  
  // Set grid columns using style attribute for dynamic values
  const gridTemplateCols = `repeat(${cols}, minmax(0, 1fr))`;
  participantsGrid.style.gridTemplateColumns = gridTemplateCols;
  
  // Add responsive classes for larger screens
  if (participantCount > 4) {
    participantsGrid.classList.add('sm:grid-cols-2');
  }
  if (participantCount > 6) {
    participantsGrid.classList.add('md:grid-cols-3');
  }
  if (participantCount > 9) {
    participantsGrid.classList.add('lg:grid-cols-4');
  }
}

function applySideBySideLayout(mainVideoContainer, participantsGrid) {
  // Side-by-side: Main video on left, grid on right
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.className = 'flex flex-col md:flex-row gap-4 mb-6';
  }
  mainVideoContainer.style.cssText = 'width: 100%; md:width: 60%; aspect-ratio: 16/9; min-height: 300px; max-height: 60vh;';
  participantsGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-3 w-full md:w-40% video-grid';
  mainVideoContainer.classList.remove('hidden');
  
  // Use CSS custom properties for responsive width
  if (window.innerWidth >= 768) {
    mainVideoContainer.style.width = '60%';
    participantsGrid.style.width = '40%';
  } else {
    mainVideoContainer.style.width = '100%';
    participantsGrid.style.width = '100%';
  }
}

function applyCompactLayout(mainVideoContainer, participantsGrid) {
  // Compact: Smaller main video, larger grid
  const videoGrid = document.getElementById('videoGrid');
  if (videoGrid) {
    videoGrid.className = 'flex flex-col gap-4 mb-6';
  }
  mainVideoContainer.style.cssText = 'width: 100%; aspect-ratio: 16/9; min-height: 250px; max-height: 40vh;';
  participantsGrid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 w-full video-grid';
  mainVideoContainer.classList.remove('hidden');
}

function setupLayoutSwitcher() {
  // Create layout switcher button if it doesn't exist
  let layoutBtn = document.getElementById('layoutSwitcherBtn');
  if (!layoutBtn) {
    const controlsDiv = document.querySelector('#controls .flex:nth-child(2)');
    if (!controlsDiv) {
      // Try alternative selector - find the controls and create flex container
      const controls = document.getElementById('controls');
      if (!controls) {
        console.warn('Controls element not found, cannot add layout switcher');
        return;
      }
      
      // Look for existing flex containers
      const existingFlex = controls.querySelector('.flex');
      if (existingFlex && existingFlex.classList.contains('gap-3')) {
        controlsDiv = existingFlex;
      } else {
        // Create a new flex container if needed
        const flexContainer = document.createElement('div');
        flexContainer.className = 'flex gap-3';
        controls.appendChild(flexContainer);
        controlsDiv = flexContainer;
      }
    }
    
    layoutBtn = document.createElement('button');
    layoutBtn.id = 'layoutSwitcherBtn';
    layoutBtn.className = 'btn-circle btn-secondary';
    layoutBtn.title = 'Switch Layout';
    layoutBtn.setAttribute('aria-label', 'Switch Video Layout');
    layoutBtn.innerHTML = '<i class="fas fa-th"></i>';
    // Ensure mobile clickability
    layoutBtn.style.cssText = 'position: relative; z-index: 1000; pointer-events: auto; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer;';
    
    // Create layout menu
    const layoutMenu = document.createElement('div');
    layoutMenu.id = 'layoutMenu';
    layoutMenu.className = 'absolute bottom-full right-0 mb-2 bg-gray-800 rounded-lg shadow-xl z-50 hidden border border-gray-700';
    
    layoutMenu.innerHTML = `
      <ul class="py-2">
        <li>
          <button class="layout-option w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors" data-layout="standard">
            <i class="fas fa-desktop mr-2"></i> Standard
          </button>
        </li>
        <li>
          <button class="layout-option w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors" data-layout="grid-only">
            <i class="fas fa-th mr-2"></i> Grid Only
          </button>
        </li>
        <li>
          <button class="layout-option w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors" data-layout="side-by-side">
            <i class="fas fa-columns mr-2"></i> Side by Side
          </button>
        </li>
        <li>
          <button class="layout-option w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors" data-layout="compact">
            <i class="fas fa-compress mr-2"></i> Compact
          </button>
        </li>
      </ul>
    `;
    
    // Make button relative for menu positioning
    layoutBtn.style.position = 'relative';
    layoutBtn.appendChild(layoutMenu);
    
    // Insert before the leave button (last element) or at the end
    const leaveBtn = controlsDiv.querySelector('#leaveBtn');
    if (leaveBtn) {
      controlsDiv.insertBefore(layoutBtn, leaveBtn);
    } else {
      controlsDiv.appendChild(layoutBtn);
    }
    
    // Check if mobile once at the top of the function
    const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    // Add mobile touch handlers for layout button
    if (isMobile) {
      // Add touch handlers for mobile
      layoutBtn.addEventListener('touchstart', function(e) {
        e.stopPropagation();
        this.style.transform = 'scale(0.95)';
      }, { passive: false });
      
      layoutBtn.addEventListener('touchend', function(e) {
        e.stopPropagation();
        e.preventDefault();
        this.style.transform = '';
        // Manually trigger click
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        this.dispatchEvent(clickEvent);
      }, { passive: false });
      
      // Ensure button is clickable
      layoutBtn.style.cssText += 'position: relative !important; z-index: 10001 !important; pointer-events: auto !important; touch-action: manipulation !important; -webkit-tap-highlight-color: transparent !important;';
    }
    
    // Toggle menu
    layoutBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.target.closest('#layoutMenu')) return;
      layoutMenu.classList.toggle('hidden');
    });
    
    // Handle layout selection
    layoutMenu.querySelectorAll('.layout-option').forEach(option => {
      option.addEventListener('click', () => {
        const layout = option.dataset.layout;
        setLayoutMode(layout);
        layoutMenu.classList.add('hidden');
      });
      
      // Add mobile touch handlers for menu items
      if (isMobile) {
        option.addEventListener('touchstart', function(e) {
          e.stopPropagation();
          this.style.backgroundColor = 'rgba(55, 65, 81, 0.5)'; // gray-700 with opacity
        }, { passive: false });
        
        option.addEventListener('touchend', function(e) {
          e.stopPropagation();
          e.preventDefault();
          this.style.backgroundColor = '';
          // Manually trigger click
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          this.dispatchEvent(clickEvent);
        }, { passive: false });
        
        // Ensure menu item is clickable
        option.style.cssText += 'position: relative !important; z-index: 10003 !important; pointer-events: auto !important; touch-action: manipulation !important; -webkit-tap-highlight-color: rgba(0,0,0,0.1) !important; cursor: pointer !important;';
      }
    });
    
    // Ensure menu itself is clickable on mobile
    if (isMobile) {
      layoutMenu.style.cssText += 'position: absolute !important; z-index: 10002 !important; pointer-events: auto !important; touch-action: auto !important;';
    }
    
    // Close menu when clicking outside
    document.addEventListener('click', (event) => {
      if (!layoutBtn.contains(event.target)) {
        layoutMenu.classList.add('hidden');
      }
    });
  }
  
  updateLayoutSwitcherUI();
}

function updateLayoutSwitcherUI() {
  const layoutBtn = document.getElementById('layoutSwitcherBtn');
  if (!layoutBtn) return;
  
  // Update active state in menu
  const layoutMenu = layoutBtn.querySelector('#layoutMenu');
  if (layoutMenu) {
    layoutMenu.querySelectorAll('.layout-option').forEach(option => {
      if (option.dataset.layout === currentLayoutMode) {
        option.classList.add('bg-gray-700');
      } else {
        option.classList.remove('bg-gray-700');
      }
    });
  }
}

// Dynamic equal-sized tile layout - 2 columns (2 wide, up to 5 rows) with larger tiles
export function updateVideoTileLayout() {
  const participantsGrid = document.getElementById('participantsGrid');
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  const videoGrid = document.getElementById('videoGrid');
  
  if (!participantsGrid) return;
  
  // Count all video containers (including local, remote, and screen shares)
  const allContainers = Array.from(participantsGrid.querySelectorAll('.video-container'));
  const participantCount = allContainers.length;
  
  console.log(`Updating video tile layout for ${participantCount} participants - using 2-column grid with larger tiles`);
  
  // ALWAYS hide main video container - we want all tiles equal-sized in the grid
  if (mainVideoContainer) {
    mainVideoContainer.classList.add('hidden');
    // Remove any fixed sizes
    mainVideoContainer.style.cssText = '';
  }
  
  // Always use 2-column grid (2 wide, up to 5 rows down) with smaller gap for larger tiles
  // This works well for both desktop and mobile
  participantsGrid.className = 'grid w-full video-grid';
  participantsGrid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  participantsGrid.style.gap = '8px'; // Smaller gap for larger tiles
  participantsGrid.style.padding = '8px';
  
  // Make the grid container take more vertical space
  if (videoGrid) {
    videoGrid.className = 'flex flex-col mb-6';
    videoGrid.style.minHeight = 'calc(100vh - 200px)'; // Take most of viewport height
  }
  
  // Ensure all containers have equal sizing - make them larger
  allContainers.forEach(container => {
    container.style.width = '';
    container.style.height = '';
    container.style.aspectRatio = '16/9';
    container.style.minHeight = '';
    container.style.maxHeight = '';
    container.style.minWidth = '';
    container.style.maxWidth = '';
  });
  
  console.log(`Applied 2-column grid layout for ${participantCount} tiles with larger sizing`);
}

// Recalculate grid layout when participants change
export function updateLayoutForParticipantCount() {
  if (currentLayoutMode === LAYOUT_MODES.GRID_ONLY) {
    const participantsGrid = document.getElementById('participantsGrid');
    if (!participantsGrid) return;
    
    const participantCount = participantsGrid.children.length;
    let cols = 2;
    if (participantCount <= 2) cols = 2;
    else if (participantCount <= 4) cols = 2;
    else if (participantCount <= 6) cols = 3;
    else if (participantCount <= 9) cols = 3;
    else if (participantCount <= 12) cols = 4;
    else cols = 5;
    
    const baseClasses = 'grid gap-3 w-full video-grid';
    participantsGrid.className = baseClasses;
    
    // Set grid columns using style attribute for dynamic values
    const gridTemplateCols = `repeat(${cols}, minmax(0, 1fr))`;
    participantsGrid.style.gridTemplateColumns = gridTemplateCols;
    
    // Add responsive classes for larger screens
    if (participantCount > 4) {
      participantsGrid.classList.add('sm:grid-cols-2');
    }
    if (participantCount > 6) {
      participantsGrid.classList.add('md:grid-cols-3');
    }
    if (participantCount > 9) {
      participantsGrid.classList.add('lg:grid-cols-4');
    }
  }
  
  // Also handle side-by-side layout responsive width
  if (currentLayoutMode === LAYOUT_MODES.SIDE_BY_SIDE) {
    const mainVideoContainer = document.getElementById('mainVideoContainer');
    const participantsGrid = document.getElementById('participantsGrid');
    
    if (mainVideoContainer && participantsGrid) {
      if (window.innerWidth >= 768) {
        mainVideoContainer.style.width = '60%';
        participantsGrid.style.width = '40%';
      } else {
        mainVideoContainer.style.width = '100%';
        participantsGrid.style.width = '100%';
      }
    }
  }
}

