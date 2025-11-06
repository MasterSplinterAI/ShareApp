import { NextRequest, NextResponse } from 'next/server';
import { roomStorage } from '@/lib/rooms/storage';

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
