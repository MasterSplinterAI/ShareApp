import { NextRequest, NextResponse } from 'next/server';
import { getTURNInstance } from '@/lib/cloudflare/turn';
import { config } from '@/lib/config';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env.production if not already set
if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
  try {
    const envPath = join(process.cwd(), '.env.production');
    const envFile = readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      
      const match = trimmed.match(/^([^=:#]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
    console.log('✅ Loaded .env.production in TURN API route');
    console.log(`✅ CLOUDFLARE_TURN_API_TOKEN: ${process.env.CLOUDFLARE_TURN_API_TOKEN ? 'SET (' + process.env.CLOUDFLARE_TURN_API_TOKEN.substring(0, 10) + '...)' : 'NOT SET'}`);
    console.log(`✅ CLOUDFLARE_TURN_TOKEN_ID: ${process.env.CLOUDFLARE_TURN_TOKEN_ID ? 'SET (' + process.env.CLOUDFLARE_TURN_TOKEN_ID + ')' : 'NOT SET'}`);
  } catch (e: any) {
    console.log('⚠️ Could not load .env.production:', e.message);
  }
}

// GET /api/turn - Get TURN credentials
export async function GET(request: NextRequest) {
  try {
    // In production, you might want to verify the user has access to a room
    // For now, we'll provide TURN credentials to any authenticated request

    // Debug: Check if environment variables are available
    const hasApiToken = !!process.env.CLOUDFLARE_TURN_API_TOKEN;
    const hasTokenId = !!process.env.CLOUDFLARE_TURN_TOKEN_ID;
    console.log(`TURN API: Has API token: ${hasApiToken}, Has token ID: ${hasTokenId}`);

    let credentials: any[] = [];
    try {
      const turnInstance = getTURNInstance();
      credentials = await turnInstance.generateCredentials();
      console.log(`✅ Generated ${credentials.length} Cloudflare TURN server(s)`);
    } catch (error: any) {
      console.error('⚠️ Failed to generate Cloudflare TURN credentials:', error.message);
      console.error('Error stack:', error.stack);
      // Continue with fallback STUN servers only
    }

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
