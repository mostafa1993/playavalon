import { NextResponse } from 'next/server';
import { createServiceClient, createRouteClient } from '@/lib/supabase/server';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 30;

interface SignupBody {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export async function POST(request: Request) {
  let body: SignupBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const username = (body.username ?? '').trim().toLowerCase();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const displayName = (body.displayName ?? '').trim();

  if (!USERNAME_REGEX.test(username)) {
    return NextResponse.json(
      { error: 'Username must be 3-20 characters, letters/numbers/underscores only' },
      { status: 400 }
    );
  }
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (displayName.length === 0 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Display name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters` },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: existing, error: existingError } = await service
    .from('players')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }

  const autoConfirmEmail = process.env.NODE_ENV !== 'production';

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: autoConfirmEmail,
    user_metadata: { username, display_name: displayName },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? 'Failed to create user';
    const status = message.toLowerCase().includes('already') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const { error: profileError } = await service.from('players').insert({
    id: created.user.id,
    username,
    display_name: displayName,
  });

  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: 'Failed to create profile; please try again' },
      { status: 500 }
    );
  }

  // Prod: email must be confirmed before login; send verification and ask user to check inbox.
  if (!autoConfirmEmail) {
    return NextResponse.json({
      ok: true,
      userId: created.user.id,
      requiresEmailConfirmation: true,
    });
  }

  // Dev: email already confirmed — auto-login so signup feels seamless.
  const route = await createRouteClient();
  const { error: signInError } = await route.auth.signInWithPassword({ email, password });

  if (signInError) {
    return NextResponse.json(
      { ok: true, userId: created.user.id, autoLoginFailed: true },
      { status: 201 }
    );
  }

  return NextResponse.json({ ok: true, userId: created.user.id });
}
