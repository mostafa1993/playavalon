/**
 * API Route: POST /api/cleanup
 * Archives stale rooms (marks as 'closed' instead of deleting)
 * This preserves game history for statistics
 *
 * This endpoint can be called by:
 * - Supabase pg_cron (recommended - runs in database)
 * - Vercel Cron Jobs (requires Pro plan)
 * - External cron service
 * - Manual trigger for testing
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getRoomsToArchive, getArchiveReason, type RoomForArchive } from '@/lib/domain/room-cleanup';
import { logger } from '@/lib/utils/logger';

/**
 * Verify the request is authorized
 * In production, use a secret key or Vercel's built-in cron authentication
 */
function isAuthorized(request: Request): boolean {
  // In development, allow all requests
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Check for Vercel Cron secret (automatically set by Vercel)
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }

  // Check for custom API key
  const apiKey = request.headers.get('x-api-key');
  if (apiKey && apiKey === process.env.CLEANUP_API_KEY) {
    return true;
  }

  return false;
}

export async function POST(request: Request) {
  try {
    // Verify authorization
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();

    // Fetch all active rooms (not already closed)
    const { data: rooms, error: fetchError } = await supabase
      .from('rooms')
      .select('id, code, status, last_activity_at')
      .neq('status', 'closed');

    if (fetchError) {
      throw fetchError;
    }

    // Determine which rooms to archive
    const roomsToArchive = getRoomsToArchive(rooms as RoomForArchive[]);

    if (roomsToArchive.length === 0) {
      logger.info('archive.complete', {
        action: 'archive',
        roomsChecked: rooms?.length || 0,
        roomsArchived: 0,
      });

      return NextResponse.json({
        data: {
          roomsChecked: rooms?.length || 0,
          roomsArchived: 0,
          archivedRoomCodes: [],
        },
      });
    }

    // Archive stale rooms (set status to 'closed')
    const archivedRoomCodes: string[] = [];
    const errors: Array<{ roomCode: string; error: string }> = [];

    for (const room of roomsToArchive) {
      const { error: updateError } = await supabase
        .from('rooms')
        .update({
          status: 'closed',
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', room.id);

      if (updateError) {
        errors.push({ roomCode: room.code, error: updateError.message });
        logger.error('archive.error', {
          roomCode: room.code,
          error: updateError.message,
        });
      } else {
        archivedRoomCodes.push(room.code);
        logger.info('room.archived', {
          roomCode: room.code,
          reason: getArchiveReason(room.status),
        });
      }
    }

    logger.info('archive.run', {
      roomsArchived: archivedRoomCodes.length,
      trigger: 'api',
    });

    return NextResponse.json({
      data: {
        roomsChecked: rooms?.length || 0,
        roomsArchived: archivedRoomCodes.length,
        archivedRoomCodes,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    logger.error('archive.failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Archive failed' } },
      { status: 500 }
    );
  }
}

// Also support GET for easy testing via browser
export async function GET(request: Request) {
  return POST(request);
}
