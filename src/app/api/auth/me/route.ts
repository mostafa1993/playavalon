import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null, profile: null }, { status: 200 });
  }

  const service = createServiceClient();
  const { data: profile } = await service
    .from('players')
    .select('id, username, display_name')
    .eq('id', user.id)
    .maybeSingle();

  return NextResponse.json({
    user: { id: user.id, email: user.email ?? null },
    profile: profile ?? null,
  });
}
