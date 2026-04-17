/**
 * API Route: POST /api/watch/[gameId]/leave
 * Leave watching a game
 *
 * Feature 015: Watcher Mode
 * - Removes watcher from in-memory session store
 * - Does NOT write to any game database tables (per NFR-004)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { removeWatcher, getWatcherCount } from '@/lib/domain/watcher-session';
import type { LeaveWatchResponse } from '@/types/watcher';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/watch/[gameId]/leave
 * Stop watching a game
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Remove watcher from in-memory session (no database writes!)
    removeWatcher(gameId, user.id);

    const response: LeaveWatchResponse = {
      success: true,
      watcherCount: getWatcherCount(gameId),
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[Watch Leave Error]', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to leave watching' } },
      { status: 500 }
    );
  }
}
