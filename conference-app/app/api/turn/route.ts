import { NextRequest, NextResponse } from 'next/server';
import { getTURNInstance } from '@/lib/cloudflare/turn';
import { config } from '@/lib/config';

// GET /api/turn - Get TURN credentials
export async function GET(request: NextRequest) {
  try {
    // In production, you might want to verify the user has access to a room
    // For now, we'll provide TURN credentials to any authenticated request

    const turnInstance = getTURNInstance();
    const credentials = await turnInstance.generateCredentials();

    // Combine with fallback STUN servers
    const iceServers = [
      ...config.webrtc.iceServers,
      ...credentials,
    ];

    return NextResponse.json({ iceServers });
  } catch (error) {
    console.error('Error generating TURN credentials:', error);
    
    // Fallback to just STUN servers if TURN fails
    return NextResponse.json({ 
      iceServers: config.webrtc.iceServers 
    });
  }
}
