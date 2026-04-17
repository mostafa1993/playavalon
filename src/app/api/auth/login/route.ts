import { NextResponse } from 'next/server';
import { createServiceClient, createRouteClient } from '@/lib/supabase/server';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LoginBody {
  identifier: string;
  password: string;
}

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const identifier = (body.identifier ?? '').trim();
  const password = body.password ?? '';

  if (!identifier || !password) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  let email = identifier.toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    const service = createServiceClient();
    const { data: profile } = await service
      .from('players')
      .select('id')
      .eq('username', email)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const { data: userResp, error: userErr } = await service.auth.admin.getUserById(profile.id);
    if (userErr || !userResp.user?.email) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    email = userResp.user.email;
  }

  const route = await createRouteClient();
  const { error } = await route.auth.signInWithPassword({ email, password });

  if (error) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
