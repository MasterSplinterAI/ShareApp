// Enhancement module for the main app
// Adds requested features without breaking existing functionality

(function() {
    console.log('[Enhancements] Loading app enhancements...');
    
    // Wait for DOM and original app to be ready
    let enhancementReady = false;
    
    // Configuration
    const config = {
        layoutMode: localStorage.getItem('layoutMode') || 'equal', // equal, pinned, focus
        pinnedVideo: null,
        screenShares: new Set(),
        videoOrder: []
    };
    
    // Initialize enhancements
    function initEnhancements() {
        if (enhancementReady) return;
        enhancementReady = true;
        
        console.log('[Enhancements] Initializing...');
        
        // Check for URL parameters and auto-fill for participants
        handleUrlParameters();
        
        // Enhance host flow
        enhanceHostFlow();
        
        // Setup auto-join interceptor
        setupAutoJoinInterceptor();
        
        // Add layout controls
        addLayoutControls();
        
        // Monitor video changes
        setupVideoMonitoring();
        
        // Enhance mobile controls
        enhanceMobileControls();
        
        // Add drag and drop
        setupDragAndDrop();
        
        // Fix button styling when returning to home
        fixButtonStyling();
    }
    
    // Fix button styling when returning to home screen
    function fixButtonStyling() {
        // Watch for when home screen becomes visible
        const homeObserver = new MutationObserver(() => {
            const homeScreen = document.getElementById('home');
            const hostBtn = document.getElementById('hostBtn');
            const joinBtn = document.getElementById('joinBtn');
            
            if (homeScreen && homeScreen.style.display !== 'none' && !homeScreen.classList.contains('hidden')) {
                // Reset button styles to ensure they're green
                if (hostBtn) {
                    hostBtn.className = 'btn btn-primary w-full md:w-64';
                    hostBtn.classList.remove('btn-secondary', 'btn-danger');
                }
                if (joinBtn) {
                    joinBtn.className = 'btn btn-primary w-full md:w-64';
                    joinBtn.classList.remove('btn-secondary', 'btn-danger');
                }
            }
        });
        
        homeObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });
        
        // Also listen for visibility changes
        document.addEventListener('visibilitychange', () => {
            const homeScreen = document.getElementById('home');
            if (homeScreen && !homeScreen.classList.contains('hidden')) {
                const hostBtn = document.getElementById('hostBtn');
                const joinBtn = document.getElementById('joinBtn');
                if (hostBtn) hostBtn.className = 'btn btn-primary w-full md:w-64';
                if (joinBtn) joinBtn.className = 'btn btn-primary w-full md:w-64';
            }
        });
    }
    
    // Handle URL parameters for participants joining with room code and PIN
    function handleUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        const pin = urlParams.get('pin');
        
        if (roomId && pin) {
            console.log('[Enhancement] Found room and PIN in URL:', roomId, pin);
            
            // Store for auto-join
            window.autoJoinRoom = roomId;
            window.autoJoinPin = pin;
            
            // Override promptForAccessCode to return PIN from URL immediately
            import('/js/ui/events.js').then(eventsModule => {
                if (eventsModule.promptForAccessCode) {
                    const originalPrompt = eventsModule.promptForAccessCode;
                    eventsModule.promptForAccessCode = function(mode) {
                        console.log('[Enhancement] Bypassing access code modal, returning PIN from URL');
                        // Return immediately with PIN from URL, no modal shown
                        return Promise.resolve(pin);
                    };
                }
            }).catch(err => {
                console.warn('[Enhancement] Could not override promptForAccessCode:', err);
            });
        } else if (roomId) {
            // Room ID in URL but no PIN - check if room requires PIN
            // The app will handle prompting for PIN if needed
            window.autoJoinRoom = roomId;
        }
    }
    
    // Setup auto-join interceptor to bypass multiple screens
    function setupAutoJoinInterceptor() {
        // Monitor for form changes
        const observer = new MutationObserver(() => {
            // If we have auto-join details, fill them in
            if (window.autoJoinRoom) {
                // Fill room ID field
                const roomInput = document.getElementById('roomId');
                if (roomInput && !roomInput.value) {
                    roomInput.value = window.autoJoinRoom;
                    roomInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                
                // Fill PIN field
                const pinInput = document.getElementById('pin');
                if (pinInput && !pinInput.value) {
                    pinInput.value = window.autoJoinPin;
                    pinInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                
                // Auto-click join button if visible
                const joinBtn = document.getElementById('joinBtn');
                if (joinBtn && !joinBtn.disabled && roomInput && roomInput.value && pinInput && pinInput.value) {
                    setTimeout(() => {
                        joinBtn.click();
                        
                        // Clear auto-join after using
                        window.autoJoinRoom = null;
                        window.autoJoinPin = null;
                    }, 100);
                }
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Enhance the host flow to show PINs before joining
    function enhanceHostFlow() {
        const originalHostBtn = document.getElementById('hostBtn');
        if (!originalHostBtn) return;
        
        // Store original click handler
        const originalHandler = originalHostBtn.onclick;
        
        // Replace with enhanced handler
        originalHostBtn.onclick = function(e) {
            e.preventDefault();
            showEnhancedHostDialog();
        };
        
        // Also enhance the original createRoom function if it exists
        if (window.createRoom) {
            const originalCreateRoom = window.createRoom;
            window.createRoom = function() {
                // Call original
                originalCreateRoom();
                
                // Wait for room creation
                setTimeout(() => {
                    const roomId = document.getElementById('roomId')?.textContent;
                    const hostPin = document.getElementById('hostPin')?.textContent;
                    const participantPin = document.getElementById('participantPin')?.textContent;
                    
                    if (roomId && hostPin && participantPin) {
                        showRoomDetails(roomId, hostPin, participantPin);
                    }
                }, 500);
            };
        }
    }
    
    // Show enhanced host dialog with room details
    async function showEnhancedHostDialog() {
        // Generate room details immediately
        const roomId = generateRoomId();
        const hostPin = generatePin();
        const participantPin = generatePin();
        
        // Create room on server with our PINs
        try {
            const response = await fetch('/api/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: roomId,
                    hostPin: hostPin,
                    participantPin: participantPin
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to create room on server');
            }
            
            const roomData = await response.json();
            // Use server-confirmed room ID and PINs
            const confirmedRoomId = roomData.roomId || roomId;
            const confirmedHostPin = roomData.hostPin || hostPin;
            const confirmedParticipantPin = roomData.participantPin || participantPin;
            
            // Store for auto-join
            window.createdRoomId = confirmedRoomId;
            window.createdHostPin = confirmedHostPin;
            window.createdParticipantPin = confirmedParticipantPin;
            
            // Override promptForAccessCodes to return our PINs immediately (no modal)
            overrideAccessCodesPrompt(confirmedHostPin, confirmedParticipantPin);
            
            // Create modal with room details
            const modal = document.createElement('div');
            modal.className = 'enhancement-modal';
            modal.innerHTML = `
                <div class="modal-backdrop" onclick="this.parentElement.remove()"></div>
                <div class="modal-content">
                    <h2>Room Created Successfully!</h2>
                    <div class="room-details">
                        <div class="detail-item">
                            <label>Room ID:</label>
                            <div class="detail-value">
                                <code id="modal-room-id">${confirmedRoomId}</code>
                                <button onclick="copyToClipboard('${confirmedRoomId}', this)">Copy</button>
                            </div>
                        </div>
                        <div class="detail-item">
                            <label>Host PIN:</label>
                            <div class="detail-value">
                                <code id="modal-host-pin">${confirmedHostPin}</code>
                                <button onclick="copyToClipboard('${confirmedHostPin}', this)">Copy</button>
                            </div>
                        </div>
                        <div class="detail-item">
                            <label>Participant PIN:</label>
                            <div class="detail-value">
                                <code id="modal-participant-pin">${confirmedParticipantPin}</code>
                                <button onclick="copyToClipboard('${confirmedParticipantPin}', this)">Copy</button>
                            </div>
                        </div>
                        <div class="detail-item">
                            <label>Share Link:</label>
                            <div class="detail-value">
                                <input type="text" id="share-link" readonly 
                                       value="${window.location.origin}/?room=${confirmedRoomId}&pin=${confirmedParticipantPin}"
                                       data-room-id="${confirmedRoomId}" data-pin="${confirmedParticipantPin}">
                                <button onclick="copyShareLink()">Copy Link</button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-primary" onclick="joinAsHostDirect()">
                            Join as Host
                        </button>
                        <button class="btn-secondary" onclick="this.closest('.enhancement-modal').remove()">
                            Save for Later
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Add styles if not already added
            addEnhancementStyles();
        } catch (error) {
            console.error('[Enhancement] Failed to create room on server:', error);
            // Fallback: still show modal but warn user
            alert('Warning: Room may not be saved on server. Please try again.');
        }
    }
    
    // Override promptForAccessCodes to bypass the old modal
    function overrideAccessCodesPrompt(hostPin, participantPin) {
        // Wait for events module to load, then override
        import('/js/ui/events.js').then(eventsModule => {
            if (eventsModule.promptForAccessCodes) {
                const originalPrompt = eventsModule.promptForAccessCodes;
                eventsModule.promptForAccessCodes = function() {
                    console.log('[Enhancement] Bypassing access codes modal, returning pre-generated PINs');
                    // Return immediately with our PINs, no modal shown
                    return Promise.resolve({
                        accessCode: participantPin,
                        hostCode: hostPin
                    });
                };
            }
        }).catch(err => {
            console.warn('[Enhancement] Could not override promptForAccessCodes:', err);
        });
    }
    
    // Direct join as host, bypassing all intermediate screens
    window.joinAsHostDirect = function() {
        const roomId = window.createdRoomId;
        const hostPin = window.createdHostPin;
        const participantPin = window.createdParticipantPin;
        
        // Close modal
        const modal = document.querySelector('.enhancement-modal');
        if (modal) modal.remove();
        
        // Override generateRoomId BEFORE clicking host button
        import('/js/utils/url.js').then(urlModule => {
            const originalGenerateRoomId = urlModule.generateRoomId;
            urlModule.generateRoomId = function() {
                urlModule.generateRoomId = originalGenerateRoomId;
                console.log('[Enhancement] Using pre-generated room ID:', roomId);
                return roomId;
            };
        }).catch(() => {
            if (window.generateRoomId) {
                const originalGenerateRoomId = window.generateRoomId;
                window.generateRoomId = function() {
                    window.generateRoomId = originalGenerateRoomId;
                    return roomId;
                };
            }
        });
        
        // Ensure PIN override is set
        overrideAccessCodesPrompt(hostPin, participantPin);
        
        // Track if username was filled
        let usernameFilled = false;
        
        // Watch for username modal only (PIN modal is bypassed)
        const modalWatcher = new MutationObserver(() => {
            if (usernameFilled) return;
            
            const modalOverlay = document.querySelector('.modal-overlay');
            if (!modalOverlay) return;
            
            // Handle username prompt modal
            if (modalOverlay.textContent.includes('Host a Meeting') || modalOverlay.textContent.includes('Enter your name')) {
                const nameInput = modalOverlay.querySelector('input[type="text"][placeholder*="name"]');
                if (nameInput && !nameInput.value) {
                    usernameFilled = true;
                    console.log('[Enhancement] Found username modal, auto-filling "Host"');
                    nameInput.value = 'Host';
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // Click the Host Meeting button
                    setTimeout(() => {
                        const hostMeetingBtn = Array.from(modalOverlay.querySelectorAll('button')).find(
                            btn => btn.textContent.includes('Host Meeting') || btn.textContent.includes('Continue')
                        );
                        if (hostMeetingBtn) {
                            console.log('[Enhancement] Clicking Host Meeting button');
                            hostMeetingBtn.click();
                            modalWatcher.disconnect();
                        }
                    }, 100);
                }
            }
        });
        
        modalWatcher.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        setTimeout(() => modalWatcher.disconnect(), 10000);
        
        // Click the host button to start the flow
        const hostBtn = document.getElementById('hostBtn');
        if (hostBtn) {
            hostBtn.click();
        }
    }
    
    // Add layout control buttons
    function addLayoutControls() {
        const controls = document.getElementById('controls');
        if (!controls) return;
        
        // Create layout switcher
        const layoutSwitcher = document.createElement('div');
        layoutSwitcher.className = 'layout-switcher';
        layoutSwitcher.innerHTML = `
            <button class="layout-btn ${config.layoutMode === 'equal' ? 'active' : ''}" 
                    onclick="setLayoutMode('equal')" title="Equal Size Grid">
                <svg width="20" height="20" viewBox="0 0 20 20">
                    <rect x="1" y="1" width="8" height="8" fill="currentColor"/>
                    <rect x="11" y="1" width="8" height="8" fill="currentColor"/>
                    <rect x="1" y="11" width="8" height="8" fill="currentColor"/>
                    <rect x="11" y="11" width="8" height="8" fill="currentColor"/>
                </svg>
            </button>
            <button class="layout-btn ${config.layoutMode === 'pinned' ? 'active' : ''}" 
                    onclick="setLayoutMode('pinned')" title="Pin Video">
                <svg width="20" height="20" viewBox="0 0 20 20">
                    <rect x="1" y="1" width="18" height="12" fill="currentColor"/>
                    <rect x="1" y="15" width="5" height="4" fill="currentColor"/>
                    <rect x="7.5" y="15" width="5" height="4" fill="currentColor"/>
                    <rect x="14" y="15" width="5" height="4" fill="currentColor"/>
                </svg>
            </button>
            <button class="layout-btn ${config.layoutMode === 'focus' ? 'active' : ''}" 
                    onclick="setLayoutMode('focus')" title="Focus Mode">
                <svg width="20" height="20" viewBox="0 0 20 20">
                    <rect x="2" y="2" width="16" height="16" fill="currentColor"/>
                </svg>
            </button>
        `;
        
        controls.insertBefore(layoutSwitcher, controls.firstChild);
    }
    
    // Setup video monitoring for screen shares
    function setupVideoMonitoring() {
        const videosContainer = document.getElementById('videos');
        if (!videosContainer) return;
        
        // Override the original screen share behavior to create separate tile
        interceptScreenShare();
        
        // Monitor for new videos
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            processVideoContainer(node);
                        }
                    });
                    
                    mutation.removedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            handleVideoRemoved(node);
                        }
                    });
                }
            });
            
            // Apply layout
            applyLayout();
        });
        
        observer.observe(videosContainer, {
            childList: true,
            subtree: true
        });
        
        // Process existing videos
        videosContainer.querySelectorAll('.video-container').forEach(container => {
            processVideoContainer(container);
        });
    }
    
    // Intercept screen share to create separate tile
    function interceptScreenShare() {
        // Override the original share screen function if it exists
        if (window.shareScreen) {
            const originalShareScreen = window.shareScreen;
            window.shareScreen = async function() {
                try {
                    // Get screen stream
                    const screenStream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: false
                    });
                    
                    // Create a separate container for screen share
                    const screenContainer = document.createElement('div');
                    screenContainer.className = 'video-container screen-share';
                    screenContainer.id = 'screen-share-' + Date.now();
                    
                    const screenVideo = document.createElement('video');
                    screenVideo.autoplay = true;
                    screenVideo.playsInline = true;
                    screenVideo.srcObject = screenStream;
                    
                    const screenLabel = document.createElement('div');
                    screenLabel.className = 'screen-indicator';
                    screenLabel.innerHTML = '🖥️ Your Screen Share';
                    
                    screenContainer.appendChild(screenVideo);
                    screenContainer.appendChild(screenLabel);
                    
                    // Add to videos container
                    const videosContainer = document.getElementById('videos');
                    if (videosContainer) {
                        videosContainer.appendChild(screenContainer);
                    }
                    
                    // Store reference
                    window.currentScreenShare = {
                        stream: screenStream,
                        container: screenContainer
                    };
                    
                    // Handle stream ending
                    screenStream.getVideoTracks()[0].onended = () => {
                        screenContainer.remove();
                        window.currentScreenShare = null;
                        
                        // Call original stop function if it exists
                        if (window.stopScreenShare) {
                            window.stopScreenShare();
                        }
                    };
                    
                    // Call original function to handle WebRTC
                    if (originalShareScreen.call) {
                        return originalShareScreen.call(this);
                    }
                    
                } catch (error) {
                    console.error('Error sharing screen:', error);
                }
            };
        }
        
        // Also intercept stop screen share
        if (window.stopScreenShare) {
            const originalStopScreenShare = window.stopScreenShare;
            window.stopScreenShare = function() {
                // Remove our screen share container
                if (window.currentScreenShare) {
                    window.currentScreenShare.container.remove();
                    window.currentScreenShare.stream.getTracks().forEach(track => track.stop());
                    window.currentScreenShare = null;
                }
                
                // Call original
                return originalStopScreenShare.call(this);
            };
        }
    }
    
    // Process video container to detect screen shares
    function processVideoContainer(container) {
        const video = container.querySelector('video');
        if (!video || !video.srcObject) return;
        
        const stream = video.srcObject;
        const tracks = stream.getVideoTracks();
        
        if (tracks.length > 0) {
            const label = tracks[0].label.toLowerCase();
            const isScreenShare = label.includes('screen') || 
                                 label.includes('window') || 
                                 label.includes('tab') ||
                                 label.includes('display');
            
            if (isScreenShare) {
                container.classList.add('screen-share');
                config.screenShares.add(container.id || container);
                
                // Add screen share indicator
                if (!container.querySelector('.screen-indicator')) {
                    const indicator = document.createElement('div');
                    indicator.className = 'screen-indicator';
                    indicator.innerHTML = '🖥️ Screen Share';
                    container.appendChild(indicator);
                }
            }
        }
        
        // Add pin button
        if (!container.querySelector('.pin-btn')) {
            const pinBtn = document.createElement('button');
            pinBtn.className = 'pin-btn';
            pinBtn.innerHTML = '📌';
            pinBtn.onclick = () => togglePin(container);
            container.appendChild(pinBtn);
        }
    }
    
    // Handle video removal (especially for screen shares)
    function handleVideoRemoved(container) {
        // Remove from screen shares set
        config.screenShares.delete(container.id || container);
        
        // If this was the pinned video, unpin
        if (config.pinnedVideo === container) {
            config.pinnedVideo = null;
        }
        
        // Re-apply layout
        applyLayout();
    }
    
    // Apply the selected layout
    function applyLayout() {
        const videosContainer = document.getElementById('videos');
        if (!videosContainer) return;
        
        const containers = Array.from(videosContainer.querySelectorAll('.video-container'));
        
        // Remove old layout classes
        videosContainer.className = videosContainer.className.replace(/layout-\w+/g, '');
        containers.forEach(c => c.classList.remove('pinned', 'focused', 'thumbnail'));
        
        // Apply new layout
        videosContainer.classList.add(`layout-${config.layoutMode}`);
        
        switch (config.layoutMode) {
            case 'equal':
                // All videos equal size
                applyEqualLayout(containers);
                break;
                
            case 'pinned':
                // One large video, others small
                applyPinnedLayout(containers);
                break;
                
            case 'focus':
                // Full screen for active speaker or pinned
                applyFocusLayout(containers);
                break;
        }
    }
    
    // Equal size grid layout
    function applyEqualLayout(containers) {
        const count = containers.length;
        const videosContainer = document.getElementById('videos');
        
        // Set grid based on count
        let cols = 1;
        if (count === 2) cols = 2;
        else if (count <= 4) cols = 2;
        else if (count <= 6) cols = 3;
        else if (count <= 9) cols = 3;
        else cols = 4;
        
        videosContainer.style.display = 'grid';
        videosContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        videosContainer.style.gap = '10px';
        
        containers.forEach(container => {
            container.style.gridColumn = '';
            container.style.gridRow = '';
            container.style.width = '';
            container.style.height = '';
        });
    }
    
    // Pinned layout with one large video
    function applyPinnedLayout(containers) {
        const videosContainer = document.getElementById('videos');
        
        if (!config.pinnedVideo && containers.length > 0) {
            // Auto-pin first video if none pinned
            config.pinnedVideo = containers[0];
        }
        
        if (config.pinnedVideo) {
            config.pinnedVideo.classList.add('pinned');
            
            // Layout: main video takes most space, others are thumbnails
            videosContainer.style.display = 'grid';
            videosContainer.style.gridTemplateColumns = '1fr 200px';
            videosContainer.style.gridTemplateRows = 'auto';
            videosContainer.style.gap = '10px';
            
            // Pinned video takes main area
            config.pinnedVideo.style.gridColumn = '1';
            config.pinnedVideo.style.gridRow = '1 / -1';
            
            // Others in sidebar
            let sidebarIndex = 0;
            containers.forEach(container => {
                if (container !== config.pinnedVideo) {
                    container.classList.add('thumbnail');
                    container.style.gridColumn = '2';
                    container.style.gridRow = `${sidebarIndex + 1}`;
                    sidebarIndex++;
                }
            });
        }
    }
    
    // Focus layout - full screen for one video
    function applyFocusLayout(containers) {
        const focused = config.pinnedVideo || containers[0];
        
        if (focused) {
            focused.classList.add('focused');
            containers.forEach(container => {
                if (container !== focused) {
                    container.style.display = 'none';
                }
            });
        }
    }
    
    // Toggle pin on a video
    window.togglePin = function(container) {
        if (config.pinnedVideo === container) {
            config.pinnedVideo = null;
            container.classList.remove('pinned');
        } else {
            // Unpin previous
            if (config.pinnedVideo) {
                config.pinnedVideo.classList.remove('pinned');
            }
            config.pinnedVideo = container;
            container.classList.add('pinned');
        }
        
        applyLayout();
    };
    
    // Set layout mode
    window.setLayoutMode = function(mode) {
        config.layoutMode = mode;
        localStorage.setItem('layoutMode', mode);
        
        // Update button states
        document.querySelectorAll('.layout-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`.layout-btn[onclick*="${mode}"]`)?.classList.add('active');
        
        applyLayout();
    };
    
    // Setup drag and drop for video reordering
    function setupDragAndDrop() {
        const videosContainer = document.getElementById('videos');
        if (!videosContainer) return;
        
        let draggedElement = null;
        
        videosContainer.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('video-container')) {
                draggedElement = e.target;
                e.target.style.opacity = '0.5';
            }
        });
        
        videosContainer.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('video-container')) {
                e.target.style.opacity = '';
            }
        });
        
        videosContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(videosContainer, e.clientY);
            if (draggedElement && afterElement == null) {
                videosContainer.appendChild(draggedElement);
            } else if (draggedElement && afterElement) {
                videosContainer.insertBefore(draggedElement, afterElement);
            }
        });
    }
    
    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.video-container:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    // Enhance mobile controls
    function enhanceMobileControls() {
        // Make buttons larger on mobile
        if (window.innerWidth <= 768) {
            const controls = document.getElementById('controls');
            if (controls) {
                controls.classList.add('mobile-controls');
            }
        }
        
        // Add touch gestures for layout switching
        let touchStartX = 0;
        document.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
        });
        
        document.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchStartX - touchEndX;
            
            // Swipe to change layout
            if (Math.abs(diff) > 100) {
                const modes = ['equal', 'pinned', 'focus'];
                const currentIndex = modes.indexOf(config.layoutMode);
                const nextIndex = diff > 0 
                    ? (currentIndex + 1) % modes.length 
                    : (currentIndex - 1 + modes.length) % modes.length;
                setLayoutMode(modes[nextIndex]);
            }
        });
    }
    
    // Helper functions
    function generateRoomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let roomId = '';
        for (let i = 0; i < 8; i++) {
            roomId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return roomId;
    }
    
    function generatePin() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
    
    // Global functions for UI
    window.copyToClipboard = function(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        });
    };
    
    window.copyShareLink = function() {
        const shareLink = document.getElementById('share-link');
        if (shareLink) {
            shareLink.select();
            document.execCommand('copy');
            alert('Share link copied to clipboard!');
        }
    };
    
    window.joinAsHost = function(roomId, hostPin) {
        // Close modal
        document.querySelector('.enhancement-modal')?.remove();
        
        // Store the room details globally
        window.autoJoinRoom = roomId;
        window.autoJoinPin = hostPin;
        window.autoJoinIsHost = true;
        
        // Try to bypass all intermediate screens and join directly
        // First, set all the necessary values
        if (document.getElementById('roomId')) {
            document.getElementById('roomId').value = roomId;
        }
        if (document.getElementById('pin')) {
            document.getElementById('pin').value = hostPin;
        }
        
        // Set a default username if needed
        if (document.getElementById('username')) {
            document.getElementById('username').value = 'Host';
        }
        
        // Hide home screen
        const homeScreen = document.getElementById('home');
        if (homeScreen) homeScreen.style.display = 'none';
        
        // Try to join directly by calling the final join function
        if (window.socket && window.joinRoom) {
            // If socket exists, we can try to join directly
            console.log('[Enhancement] Attempting direct join to room:', roomId);
            
            // Set global variables that the app might check
            window.roomId = roomId;
            window.pin = hostPin;
            window.isHost = true;
            
            // Show the room UI
            const roomDiv = document.getElementById('room');
            if (roomDiv) {
                roomDiv.style.display = 'block';
            }
            
            // Call join
            setTimeout(() => {
                if (window.joinRoom) {
                    window.joinRoom();
                }
            }, 100);
            
        } else {
            // Fallback: go through join flow but auto-fill and auto-submit
            const joinScreen = document.getElementById('join');
            if (joinScreen) {
                joinScreen.style.display = 'block';
                
                // Auto-click through the flow
                setTimeout(() => {
                    const joinBtn = document.getElementById('joinBtn');
                    if (joinBtn) joinBtn.click();
                    
                    // After first click, might need to click again for username
                    setTimeout(() => {
                        const nextBtn = document.querySelector('#join button:not([disabled])');
                        if (nextBtn) nextBtn.click();
                    }, 200);
                }, 100);
            }
        }
    };
    
    // Add enhancement styles
    function addEnhancementStyles() {
        if (document.getElementById('enhancement-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'enhancement-styles';
        styles.textContent = `
            /* Modal styles */
            .enhancement-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .modal-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
            }
            
            .modal-content {
                position: relative;
                background: white;
                border-radius: 10px;
                padding: 30px;
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            }
            
            .modal-content h2 {
                margin-bottom: 20px;
                color: #333;
            }
            
            .room-details {
                margin: 20px 0;
            }
            
            .detail-item {
                margin-bottom: 15px;
                padding: 15px;
                background: #f5f5f5;
                border-radius: 8px;
            }
            
            .detail-item label {
                display: block;
                margin-bottom: 5px;
                color: #666;
                font-size: 12px;
                text-transform: uppercase;
            }
            
            .detail-value {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .detail-value code {
                flex: 1;
                padding: 8px 12px;
                background: white;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-family: monospace;
                font-size: 16px;
            }
            
            .detail-value input {
                flex: 1;
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
            }
            
            .detail-value button {
                padding: 8px 16px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            }
            
            .detail-value button:hover {
                background: #45a049;
            }
            
            .modal-actions {
                display: flex;
                gap: 10px;
                margin-top: 20px;
            }
            
            .modal-actions button {
                flex: 1;
                padding: 12px;
                border: none;
                border-radius: 6px;
                font-size: 16px;
                cursor: pointer;
            }
            
            .btn-primary {
                background: #4CAF50;
                color: white;
            }
            
            .btn-primary:hover {
                background: #45a049;
            }
            
            .btn-secondary {
                background: #f1f1f1;
                color: #333;
            }
            
            .btn-secondary:hover {
                background: #ddd;
            }
            
            /* Layout switcher */
            .layout-switcher {
                display: flex;
                gap: 5px;
                padding: 5px;
                background: rgba(0, 0, 0, 0.1);
                border-radius: 5px;
            }
            
            .layout-btn {
                padding: 8px;
                background: white;
                border: 1px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .layout-btn:hover {
                background: #f0f0f0;
            }
            
            .layout-btn.active {
                background: #4CAF50;
                color: white;
                border-color: #4CAF50;
            }
            
            /* Video container enhancements */
            .video-container {
                position: relative;
                transition: all 0.3s ease;
                cursor: move;
            }
            
            .video-container.dragging {
                opacity: 0.5;
            }
            
            .pin-btn {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.5);
                color: white;
                border: none;
                border-radius: 50%;
                width: 30px;
                height: 30px;
                cursor: pointer;
                display: none;
                z-index: 10;
            }
            
            .video-container:hover .pin-btn {
                display: block;
            }
            
            .video-container.pinned .pin-btn {
                display: block;
                background: #4CAF50;
            }
            
            .screen-indicator {
                position: absolute;
                top: 10px;
                left: 10px;
                background: #4CAF50;
                color: white;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 12px;
                z-index: 10;
            }
            
            /* Layout specific styles */
            .layout-equal .video-container {
                width: 100%;
                height: 100%;
            }
            
            .layout-pinned .video-container.pinned {
                width: 100%;
                height: 100%;
            }
            
            .layout-pinned .video-container.thumbnail {
                width: 100%;
                height: 150px;
            }
            
            .layout-focus .video-container.focused {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 80px;
                width: 100%;
                height: calc(100% - 80px);
                z-index: 100;
            }
            
            /* Mobile controls enhancement */
            .mobile-controls button {
                padding: 15px !important;
                font-size: 14px !important;
            }
            
            /* Style home screen buttons */
            #hostBtn, #joinBtn {
                background: #4CAF50 !important;
                color: white !important;
                border: none !important;
                padding: 12px 24px !important;
                border-radius: 6px !important;
                font-size: 16px !important;
                cursor: pointer !important;
                transition: all 0.3s !important;
            }
            
            #hostBtn:hover, #joinBtn:hover {
                background: #45a049 !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 8px rgba(0,0,0,0.2) !important;
            }
            
            @media (max-width: 768px) {
                .layout-switcher {
                    position: fixed;
                    bottom: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 100;
                    background: rgba(255, 255, 255, 0.9);
                }
                
                .modal-content {
                    padding: 20px;
                }
                
                .detail-value {
                    flex-direction: column;
                }
                
                .detail-value button {
                    width: 100%;
                }
            }
        `;
        
        document.head.appendChild(styles);
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEnhancements);
    } else {
        initEnhancements();
    }
    
    // Also try after a delay to ensure app.js is loaded
    setTimeout(initEnhancements, 1000);
    
})();
