// Connection test utility for diagnosing WebRTC connectivity issues

// Test TURN server connectivity
export async function testTurnConnectivity() {
  console.log('🔍 Testing TURN server connectivity...');
  
  const turnServers = [
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];
  
  const results = [];
  
  for (const server of turnServers) {
    try {
      const pc = new RTCPeerConnection({ iceServers: [server] });
      
      const result = await new Promise((resolve) => {
        let candidateFound = false;
        const timeout = setTimeout(() => {
          resolve({ server: server.urls, status: 'timeout', error: 'No candidates received within 5 seconds' });
        }, 5000);
        
        pc.onicecandidate = (event) => {
          if (event.candidate && event.candidate.candidate.includes('relay')) {
            candidateFound = true;
            clearTimeout(timeout);
            resolve({ server: server.urls, status: 'success', candidate: event.candidate.candidate });
          }
        };
        
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete' && !candidateFound) {
            clearTimeout(timeout);
            resolve({ server: server.urls, status: 'failed', error: 'No relay candidates generated' });
          }
        };
        
        // Create a dummy data channel to trigger ICE gathering
        pc.createDataChannel('test');
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
      });
      
      pc.close();
      results.push(result);
      
    } catch (error) {
      results.push({ server: server.urls, status: 'error', error: error.message });
    }
  }
  
  return results;
}

// Test general WebRTC support
export function testWebRTCSupport() {
  console.log('🔍 Testing WebRTC support...');
  
  const support = {
    getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    RTCPeerConnection: !!window.RTCPeerConnection,
    RTCDataChannel: !!(window.RTCPeerConnection && RTCPeerConnection.prototype.createDataChannel),
    RTCSessionDescription: !!window.RTCSessionDescription,
    RTCIceCandidate: !!window.RTCIceCandidate
  };
  
  console.log('WebRTC Support:', support);
  return support;
}

// Test network connectivity and firewall restrictions
export async function testNetworkConnectivity() {
  console.log('🔍 Testing network connectivity...');
  
  const tests = [
    { name: 'HTTPS', url: 'https://www.google.com/favicon.ico' },
    { name: 'WebSocket', url: 'wss://echo.websocket.org' },
    { name: 'STUN', server: 'stun:stun.l.google.com:19302' }
  ];
  
  const results = [];
  
  // Test HTTPS connectivity
  try {
    const response = await fetch(tests[0].url, { mode: 'no-cors' });
    results.push({ test: 'HTTPS', status: 'success' });
  } catch (error) {
    results.push({ test: 'HTTPS', status: 'failed', error: error.message });
  }
  
  // Test WebSocket connectivity
  try {
    const ws = new WebSocket(tests[1].url);
    const wsResult = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ test: 'WebSocket', status: 'timeout' }), 3000);
      
      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ test: 'WebSocket', status: 'success' });
      };
      
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ test: 'WebSocket', status: 'failed' });
      };
    });
    results.push(wsResult);
  } catch (error) {
    results.push({ test: 'WebSocket', status: 'error', error: error.message });
  }
  
  // Test STUN connectivity
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: tests[2].server }] });
    
    const stunResult = await new Promise((resolve) => {
      let candidateFound = false;
      const timeout = setTimeout(() => {
        resolve({ test: 'STUN', status: 'timeout' });
      }, 3000);
      
      pc.onicecandidate = (event) => {
        if (event.candidate && event.candidate.type === 'srflx') {
          candidateFound = true;
          clearTimeout(timeout);
          resolve({ test: 'STUN', status: 'success', candidate: event.candidate.candidate });
        }
      };
      
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete' && !candidateFound) {
          clearTimeout(timeout);
          resolve({ test: 'STUN', status: 'failed' });
        }
      };
      
      pc.createDataChannel('test');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
    });
    
    pc.close();
    results.push(stunResult);
    
  } catch (error) {
    results.push({ test: 'STUN', status: 'error', error: error.message });
  }
  
  return results;
}

// Run comprehensive connectivity diagnostics
export async function runConnectivityDiagnostics() {
  console.log('🚀 Running comprehensive connectivity diagnostics...');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    webrtcSupport: testWebRTCSupport(),
    networkTests: await testNetworkConnectivity(),
    turnTests: await testTurnConnectivity()
  };
  
  console.log('📊 Connectivity Diagnostics Results:', diagnostics);
  
  // Display user-friendly summary
  const issues = [];
  const successes = [];
  
  if (!diagnostics.webrtcSupport.RTCPeerConnection) {
    issues.push('❌ WebRTC not supported in this browser');
  } else {
    successes.push('✅ WebRTC is supported');
  }
  
  const failedNetworkTests = diagnostics.networkTests.filter(t => t.status !== 'success');
  if (failedNetworkTests.length > 0) {
    issues.push(`❌ Network connectivity issues: ${failedNetworkTests.map(t => t.test).join(', ')}`);
  } else {
    successes.push('✅ Basic network connectivity working');
  }
  
  const failedTurnTests = diagnostics.turnTests.filter(t => t.status !== 'success');
  if (failedTurnTests.length === diagnostics.turnTests.length) {
    issues.push('❌ All TURN servers unreachable - may have issues with restrictive firewalls');
  } else if (failedTurnTests.length > 0) {
    successes.push('⚠️ Some TURN servers working, others failed');
  } else {
    successes.push('✅ All TURN servers accessible');
  }
  
  console.log('\n📋 Summary:');
  successes.forEach(msg => console.log(msg));
  issues.forEach(msg => console.log(msg));
  
  if (issues.length > 0) {
    console.log('\n💡 Suggestions:');
    if (issues.some(i => i.includes('TURN'))) {
      console.log('- Try connecting from a different network (mobile hotspot, different WiFi)');
      console.log('- Check if your firewall or ISP blocks WebRTC traffic');
      console.log('- Consider using a VPN if in a restrictive network environment');
    }
  }
  
  return diagnostics;
} 