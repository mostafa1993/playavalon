/**
 * API Route: POST /api/livekit/token
 * Generate a LiveKit access token for a player to join a video room
 */

import { NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { createServerClient, getPlayerIdFromRequest } from '@/lib/supabase/server';
import { findPlayerByPlayerId } from '@/lib/supabase/players';
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

    const playerId = getPlayerIdFromRequest(request);
    if (!playerId) {
      return errors.unauthorized();
    }

    const body = await request.json();
    const { roomCode } = body;

    if (!roomCode || typeof roomCode !== 'string') {
      return errors.invalidRequest('roomCode is required');
    }

    const supabase = createServerClient();

    // Verify player exists
    const player = await findPlayerByPlayerId(supabase, playerId);
    if (!player) {
      return errors.playerNotFound();
    }

    // Verify room exists
    const room = await findRoomByCode(supabase, roomCode);
    if (!room) {
      return errors.roomNotFound();
    }

    // Verify player is in this room (room_players uses player's DB id, not localStorage id)
    const inRoom = await isPlayerInRoom(supabase, room.id, player.id);
    if (!inRoom) {
      return errors.notRoomMember();
    }

    // Generate LiveKit access token
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: playerId,
      name: player.nickname,
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
