import { NextRequest, NextResponse } from 'next/server';

// POST /api/rooms - Create a new room
export async function POST(request: NextRequest) {
  try {
    // Access global roomStorage at runtime (set by server-unified.js)
    // Fallback to require if global is not available (for development/testing)
    const roomStorage = (typeof global !== 'undefined' && (global as any).roomStorage) 
      || require('../../../server-room-storage').roomStorage;
    
    const { roomId, hostPin, participantPin } = roomStorage.createRoom();

    return NextResponse.json({
      roomId,
      hostPin,
      participantPin,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return NextResponse.json(
      { error: 'Failed to create room' },
      { status: 500 }
    );
  }
}
