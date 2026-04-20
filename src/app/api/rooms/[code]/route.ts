/**
 * API Route: GET /api/rooms/[code]
 * Get room details including players
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, getRoomDetails, isPlayerInRoom } from '@/lib/supabase/rooms';
import { validateRoomCode } from '@/lib/domain/validation';
import { computeRolesInPlay } from '@/lib/domain/role-config';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/rooms/[code]
 * Get room details with player list
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Validate room code format
    const codeValidation = validateRoomCode(code);
    if (!codeValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_CODE', message: codeValidation.error } },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Find the room
    const room = await findRoomByCode(supabase, code);
    if (!room) {
      return errors.roomNotFound();
    }

    // Check if player is in this room
    const isMember = await isPlayerInRoom(supabase, room.id, user.id);
    if (!isMember) {
      return errors.notRoomMember();
    }

    // Get room details with players
    const details = await getRoomDetails(supabase, room.id, user.id);
    if (!details) {
      return errors.roomNotFound();
    }

    // Compute roles in play from room configuration
    const roleConfig = room.role_config || {};
    const rolesInPlay = computeRolesInPlay(roleConfig);

    // Get Lady of Lake holder info if applicable
    let ladyOfLakeHolder = null;
    if (room.lady_of_lake_holder_id) {
      const holder = details.players.find(p => p.id === room.lady_of_lake_holder_id);
      if (holder) {
        ladyOfLakeHolder = { id: holder.id, display_name: holder.display_name };
      }
    }

    // Feature 022: AI Game Reviewer state
    let aiReview: {
      enabled: boolean;
      caller_consented: boolean;
      consented_count: number;
      total_players: number;
    } | undefined;
    if (room.ai_review_enabled) {
      const { data: consents, error: consentErr } = await supabase
        .from('room_ai_consents')
        .select('player_id, accepted')
        .eq('room_id', room.id)
        .eq('accepted', true);
      if (consentErr) throw consentErr;

      const acceptedIds = new Set((consents || []).map((c: { player_id: string }) => c.player_id));
      // Count only current members' consents; stale rows from left players
      // should not inflate the displayed consent count.
      const currentPlayerIds = new Set(details.players.map((p) => p.id));
      let consentedCurrent = 0;
      currentPlayerIds.forEach((id) => {
        if (acceptedIds.has(id)) consentedCurrent += 1;
      });

      aiReview = {
        enabled: true,
        caller_consented: acceptedIds.has(user.id) && currentPlayerIds.has(user.id),
        consented_count: consentedCurrent,
        total_players: details.players.length,
      };
    } else {
      aiReview = {
        enabled: false,
        caller_consented: false,
        consented_count: 0,
        total_players: details.players.length,
      };
    }

    return NextResponse.json({
      data: {
        ...details,
        roles_in_play: rolesInPlay,
        lady_of_lake_holder: ladyOfLakeHolder,
        ai_review: aiReview,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
