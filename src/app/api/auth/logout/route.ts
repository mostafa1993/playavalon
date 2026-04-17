import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';

export async function POST() {
  try {
    const route = await createRouteClient();
    await route.auth.signOut();
  } catch {
    // Cookies get cleared regardless; always succeed from client's perspective.
  }
  return NextResponse.json({ ok: true });
}
