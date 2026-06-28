/**
 * API Route: POST /api/rooms/[code]/config
 * Manager edits the room setup (role configuration, player count, intro round)
 * while the room is still in the lobby (status === 'waiting'), before roles are
 * distributed. Re-validates the full config against the effective player count.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, getRoomPlayerCount } from '@/lib/supabase/rooms';
import { validateRoomCode } from '@/lib/domain/validation';
import { validateRoleConfig } from '@/lib/domain/role-config';
import { MIN_PLAYERS, MAX_PLAYERS } from '@/lib/utils/constants';
import { errors, handleError } from '@/lib/utils/errors';
import type { RoleConfig } from '@/types/role-config';

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

    const body = (await request.json().catch(() => null)) as {
      role_config?: RoleConfig;
      expected_players?: unknown;
      intro_phase_enabled?: unknown;
    } | null;
    if (!body) {
      return errors.invalidRequest('Expected a JSON body');
    }

    const supabase = createServiceClient();

    const room = await findRoomByCode(supabase, code);
    if (!room) return errors.roomNotFound();

    if (room.manager_id !== user.id) return errors.notRoomManager();

    // Config is editable only before roles are distributed.
    if (room.status !== 'waiting') return errors.rolesAlreadyDistributed();

    // Resolve the effective values: a field that's omitted keeps the current one.
    // Both are validated together so a change to either stays internally consistent
    // (e.g. lowering player count can't leave a now-invalid role config behind).
    if (
      body.role_config !== undefined &&
      (typeof body.role_config !== 'object' ||
        body.role_config === null ||
        Array.isArray(body.role_config))
    ) {
      return errors.invalidRequest('role_config must be an object');
    }
    const newConfig: RoleConfig =
      body.role_config !== undefined ? body.role_config : (room.role_config ?? {});

    let newExpected = room.expected_players;
    if (body.expected_players !== undefined) {
      const n = body.expected_players;
      if (typeof n !== 'number' || !Number.isInteger(n)) {
        return errors.invalidRequest('expected_players must be a whole number');
      }
      if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
        return errors.invalidRequest(`expected_players must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
      }
      // Decrease is only allowed down to the number of people currently seated
      // (humans + bots). Increase is always fine up to MAX_PLAYERS. If someone
      // leaves, the floor drops and a further decrease becomes possible.
      const seated = await getRoomPlayerCount(supabase, room.id);
      if (n < seated) {
        return errors.invalidRequest(
          `Cannot reduce below the ${seated} player(s) already in the room. Ask someone to leave first.`
        );
      }
      newExpected = n;
    }

    const newIntro =
      body.intro_phase_enabled !== undefined
        ? body.intro_phase_enabled === true
        : room.intro_phase_enabled;

    // Re-validate the role config against the effective player count.
    const configValidation = validateRoleConfig(newConfig, newExpected);
    if (!configValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROLE_CONFIG', message: configValidation.errors.join('; ') } },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from('rooms')
      .update({
        role_config: newConfig,
        expected_players: newExpected,
        lady_of_lake_enabled: newConfig.ladyOfLake || false,
        intro_phase_enabled: newIntro,
      })
      .eq('id', room.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({
      data: {
        expected_players: newExpected,
        role_config: newConfig,
        intro_phase_enabled: newIntro,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
