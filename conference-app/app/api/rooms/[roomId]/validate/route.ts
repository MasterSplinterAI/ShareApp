import { NextRequest, NextResponse } from 'next/server';
import { roomStorage } from '@/lib/rooms/storage';

// POST /api/rooms/[roomId]/validate - Validate room access
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } }
) {
  try {
    const { pin } = await request.json();

    if (!pin) {
      return NextResponse.json(
        { error: 'PIN is required' },
        { status: 400 }
      );
    }

    const validation = roomStorage.validateRoom(params.roomId, pin);

    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'Invalid room or PIN' },
        { status: 401 }
      );
    }

    const room = roomStorage.getRoom(params.roomId);
    const participantCount = roomStorage.getParticipantCount(params.roomId);

    return NextResponse.json({
      roomId: params.roomId,
      isHost: validation.isHost,
      participantPin: validation.participantPin,
      participantCount,
      createdAt: room?.createdAt,
    });
  } catch (error) {
    console.error('Error validating room:', error);
    return NextResponse.json(
      { error: 'Failed to validate room' },
      { status: 500 }
    );
  }
}
