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

    const body = await request.json().catch(() => null) as {
      enabled?: unknown;
      mode?: unknown;
    } | null;
    if (!body || typeof body.enabled !== 'boolean') {
      return errors.invalidRequest('Expected { enabled: boolean, mode?: "blind" | "god" }');
    }
    const enabled = body.enabled;
    // Mode defaults to 'blind' (the privacy-respecting detective). Only meaningful
    // when enabled; harmless to set when disabling.
    let mode: 'blind' | 'god' = 'blind';
    if (body.mode !== undefined) {
      if (body.mode !== 'blind' && body.mode !== 'god') {
        return errors.invalidRequest('mode must be "blind" or "god"');
      }
      mode = body.mode;
    }

    const supabase = createServiceClient();

    const room = await findRoomByCode(supabase, code);
    if (!room) return errors.roomNotFound();

    if (room.manager_id !== user.id) return errors.notRoomManager();

    if (room.status !== 'waiting') return errors.rolesAlreadyDistributed();

    const { error: updateErr } = await supabase
      .from('rooms')
      .update({ ai_review_enabled: enabled, ai_review_mode: mode })
      .eq('id', room.id);
    if (updateErr) throw updateErr;

    // Clear consents only when the enabled state actually flips. A mode-only
    // change (blind ↔ god while still enabled) keeps existing consents, since
    // consent is about audio recording, not the review mode.
    if (enabled !== room.ai_review_enabled) {
      const { error: clearErr } = await supabase
        .from('room_ai_consents')
        .delete()
        .eq('room_id', room.id);
      if (clearErr) throw clearErr;
    }

    return NextResponse.json({ data: { ai_review_enabled: enabled, ai_review_mode: mode } });
  } catch (error) {
    return handleError(error);
  }
}
