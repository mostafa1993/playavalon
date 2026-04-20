/**
 * API Route: POST /api/rooms/[code]/ai-review
 * Manager toggles the AI Game Reviewer feature.
 * Flipping the toggle in either direction clears all existing consents
 * so they must be collected fresh.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode } from '@/lib/supabase/rooms';
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

    const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== 'boolean') {
      return errors.invalidRequest('Expected { enabled: boolean }');
    }
    const enabled = body.enabled;

    const supabase = createServiceClient();

    const room = await findRoomByCode(supabase, code);
    if (!room) return errors.roomNotFound();

    if (room.manager_id !== user.id) return errors.notRoomManager();

    if (room.status !== 'waiting') return errors.rolesAlreadyDistributed();

    const { error: updateErr } = await supabase
      .from('rooms')
      .update({ ai_review_enabled: enabled })
      .eq('id', room.id);
    if (updateErr) throw updateErr;

    const { error: clearErr } = await supabase
      .from('room_ai_consents')
      .delete()
      .eq('room_id', room.id);
    if (clearErr) throw clearErr;

    return NextResponse.json({ data: { ai_review_enabled: enabled } });
  } catch (error) {
    return handleError(error);
  }
}
