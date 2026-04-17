/**
 * API Route: GET /api/rooms/[code]/watch-status
 * Check if a room's game is watchable
 *
 * Feature 015: Watcher Mode
 * - Returns whether the game can be watched
 * - Returns current watcher count and limit
 * - Does NOT write to any database tables
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getWatcherCount, isWatcherLimitReached } from '@/lib/domain/watcher-session';
import { MAX_WATCHERS_PER_GAME } from '@/types/watcher';
import type { WatchStatusResponse } from '@/types/watcher';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/rooms/[code]/watch-status
 * Check if a room's game is watchable
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();

    // Get room by code (READ ONLY)
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, status, current_game_id')
      .eq('code', code.toUpperCase())
      .maybeSingle();

    if (roomError) {
      console.error('[Watch Status] Room query error:', roomError);
      return NextResponse.json(
        { error: { code: 'QUERY_ERROR', message: 'Failed to check room' } },
        { status: 500 }
      );
    }

    if (!room) {
      const response: WatchStatusResponse = {
        watchable: false,
        reason: 'ROOM_NOT_FOUND',
      };
      return NextResponse.json({ data: response });
    }

    // Check if game has started
    if (!room.current_game_id) {
      const response: WatchStatusResponse = {
        watchable: false,
        reason: 'GAME_NOT_STARTED',
      };
      return NextResponse.json({ data: response });
    }

    if (room.status === 'completed') {
      const response: WatchStatusResponse = {
        watchable: false,
        reason: 'GAME_ENDED',
      };
      return NextResponse.json({ data: response });
    }

    const { data: game } = await supabase
      .from('games')
      .select('id, phase')
      .eq('id', room.current_game_id)
      .single();

    if (!game) {
      const response: WatchStatusResponse = {
        watchable: false,
        reason: 'GAME_NOT_FOUND',
      };
      return NextResponse.json({ data: response });
    }

    const watcherCount = getWatcherCount(room.current_game_id);
    const limitReached = isWatcherLimitReached(room.current_game_id);

    const response: WatchStatusResponse = {
      watchable: !limitReached,
      gameId: room.current_game_id,
      watcherCount,
      watcherLimit: MAX_WATCHERS_PER_GAME,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[Watch Status Error]', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to get watch status' } },
      { status: 500 }
    );
  }
}
