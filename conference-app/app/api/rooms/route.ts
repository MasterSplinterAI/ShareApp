import { NextRequest, NextResponse } from 'next/server';

// Use the global roomStorage instance set by server-unified.js
// This ensures API routes and Socket.io use the same singleton
const roomStorage = (typeof global !== 'undefined' && (global as any).roomStorage) 
  || require('../../../server-room-storage').roomStorage;

// POST /api/rooms - Create a new room
export async function POST(request: NextRequest) {
  try {
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
