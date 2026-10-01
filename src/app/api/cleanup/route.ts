/**
 * API Route: POST /api/cleanup
 * Runs cleanup_rooms() (migration 028): closes rooms empty for 1h or older than
 * 16h and repairs games left live or missing ended_at. pg_cron runs the same
 * function every 15 minutes; the cleanup-cron container hits this daily as a
 * keepalive.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
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

    // Same sweep pg_cron runs every 15 minutes (migration 028)
    const { data, error } = await supabase
      .rpc('cleanup_rooms')
      .single<{ rooms_closed: number; games_repaired: number }>();

    if (error) {
      throw error;
    }

    logger.info('archive.run', { ...data, trigger: 'api' });

    return NextResponse.json({ data });
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
