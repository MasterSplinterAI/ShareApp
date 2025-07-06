if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(function(stream) {
            // Handle stream
        })
        .catch(function(error) {
            console.error('Error accessing media devices:', error);
        });
} else {
    console.error('Media devices not supported in this browser.');
    alert('Media devices are not supported in this browser. Please use a modern browser with WebRTC support.');
} 