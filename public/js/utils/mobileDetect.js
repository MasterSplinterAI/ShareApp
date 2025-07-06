// Simplified mobile device detection without aggressive optimizations

// Detect if the current device is mobile
export function isMobileDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const isMobile = mobileRegex.test(userAgent) || window.innerWidth <= 768;
  
  // Add mobile-specific class to body if mobile
  if (isMobile) {
    document.body.classList.add('mobile-device');
  } else {
    document.body.classList.remove('mobile-device');
  }
  
  return isMobile;
}

// Check if the current device is iOS (iPhone, iPad, iPod)
export function isIOSDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  return /iPhone|iPad|iPod/i.test(userAgent) && 
         !window.MSStream; // Rule out Windows Phone
}

// Check if the current device is Android
export function isAndroidDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  return /Android/i.test(userAgent);
}

// Apply minimal iOS class without aggressive interventions
export function applyIOSOptimizations() {
  if (!isIOSDevice()) return;
  
  console.log('Adding iOS device class');
  document.body.classList.add('ios-device');
  
  // Only set proper orientation classes
  updateOrientationClass();
  window.addEventListener('resize', updateOrientationClass);
  window.addEventListener('orientationchange', () => {
    setTimeout(updateOrientationClass, 150);
  });
}

// Simple orientation class management
function updateOrientationClass() {
  const isPortrait = window.innerHeight > window.innerWidth;
  if (isPortrait) {
    document.body.classList.add('ios-portrait-mode');
    document.body.classList.remove('ios-landscape-mode');
  } else {
    document.body.classList.add('ios-landscape-mode');
    document.body.classList.remove('ios-portrait-mode');
  }
}

// Apply minimal Android class
export function applyAndroidOptimizations() {
  if (!isAndroidDevice()) return;
  
  console.log('Adding Android device class');
  document.body.classList.add('android-device');
}

// Initialize mobile detection - minimal version
export function initMobileDetection() {
  const isMobile = isMobileDevice();
  
  if (isMobile) {
    console.log('Mobile device detected');
    
    if (isIOSDevice()) {
      console.log('iOS device detected');
      applyIOSOptimizations();
    }
    
    if (isAndroidDevice()) {
      console.log('Android device detected');
      applyAndroidOptimizations();
    }
    
    // Set initial orientation attribute
    const isLandscape = window.innerWidth > window.innerHeight;
    document.body.setAttribute('data-orientation', isLandscape ? 'landscape' : 'portrait');
  }
  
  return isMobile;
} 