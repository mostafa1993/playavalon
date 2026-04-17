/**
 * POST /api/players/heartbeat
 * Update the authenticated player's last_activity_at timestamp
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { updatePlayerActivity } from '@/lib/supabase/players';
import type { HeartbeatResponse } from '@/types/player';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      const response: HeartbeatResponse = {
        success: false,
        error: 'UNAUTHORIZED',
      };
      return NextResponse.json(response, { status: 401 });
    }

    const supabase = createServiceClient();

    const updated = await updatePlayerActivity(supabase, user.id);

    if (!updated) {
      const response: HeartbeatResponse = {
        success: false,
        error: 'PLAYER_NOT_FOUND',
      };
      return NextResponse.json(response, { status: 404 });
    }

    const response: HeartbeatResponse = {
      success: true,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating player heartbeat:', error);
    const response: HeartbeatResponse = {
      success: false,
    };
    return NextResponse.json(response, { status: 500 });
  }
}
