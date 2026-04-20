/**
 * API Route: POST /api/rooms/[code]/ai-consent
 * A player accepts the AI Game Reviewer consent for this room.
 * Only insertable when ai_review_enabled=true and the caller is a room member.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, isPlayerInRoom } from '@/lib/supabase/rooms';
import { validateRoomCode } from '@/lib/domain/validation';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;

    const user = await getCurrentUser();
    if (!user) return errors.unauthorized();

    const codeValidation = validateRoomCode(code);
    if (!codeValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_CODE', message: codeValidation.error } },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const room = await findRoomByCode(supabase, code);
    if (!room) return errors.roomNotFound();

    const member = await isPlayerInRoom(supabase, room.id, user.id);
    if (!member) return errors.notRoomMember();

    if (!room.ai_review_enabled) {
      return errors.invalidRequest('AI Game Review is not enabled for this room');
    }

    if (room.status !== 'waiting') return errors.rolesAlreadyDistributed();

    const { error: upsertErr } = await supabase
      .from('room_ai_consents')
      .upsert(
        { room_id: room.id, player_id: user.id, accepted: true },
        { onConflict: 'room_id,player_id' }
      );
    if (upsertErr) throw upsertErr;

    return NextResponse.json({ data: { accepted: true } });
  } catch (error) {
    return handleError(error);
  }
}
