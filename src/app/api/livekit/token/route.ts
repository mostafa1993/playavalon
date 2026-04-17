/**
 * API Route: POST /api/livekit/token
 * Generate a LiveKit access token for a player to join a video room
 */

import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findPlayerById } from '@/lib/supabase/players';
import { findRoomByCode, isPlayerInRoom } from '@/lib/supabase/rooms';
import { errors, handleError } from '@/lib/utils/errors';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

/**
 * POST /api/livekit/token
 * Body: { roomCode: string }
 * Returns: { token: string, wsUrl: string }
 */
export async function POST(request: Request) {
  try {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return errors.internalError('LiveKit is not configured');
    }

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    const body = await request.json();
    const { roomCode } = body;

    if (!roomCode || typeof roomCode !== 'string') {
      return errors.invalidRequest('roomCode is required');
    }

    const supabase = createServiceClient();

    // Get player profile for LiveKit participant metadata
    const player = await findPlayerById(supabase, user.id);
    if (!player) {
      return errors.playerNotFound();
    }

    // Verify room exists
    const room = await findRoomByCode(supabase, roomCode);
    if (!room) {
      return errors.roomNotFound();
    }

    // Verify player is in this room
    const inRoom = await isPlayerInRoom(supabase, room.id, user.id);
    if (!inRoom) {
      return errors.notRoomMember();
    }

    // Generate LiveKit access token
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: player.display_name,
      ttl: '6h',
    });

    token.addGrant({
      room: roomCode.toUpperCase(),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    return NextResponse.json({
      data: {
        token: jwt,
        wsUrl: LIVEKIT_URL,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
