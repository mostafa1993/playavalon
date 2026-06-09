/**
 * Shared helper to ensure a bot's Supabase Auth user + players row exist.
 * Used by both `agents/bot-supervisor/src/cli/run.ts` (so a fresh config can self-bootstrap)
 * and `scripts/add-fake-players.ts` (so the dev convenience script populates
 * rooms with the same accounts the agent engine signs in as).
 *
 * Idempotent: if the username + auth user already exist, returns the existing
 * row. Safe to call on every agent startup.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const BOT_PASSWORD_DEFAULT = 'bot_password_dev_only';

export interface BotIdentity {
  id: string;            // Supabase auth.users.id == players.id
  username: string;      // 'bot_alice'
  display_name: string;  // 'Alice'
  email: string;         // 'bot_alice@playavalon.local'
  password: string;
}

export interface EnsureBotInput {
  name: string;           // 'alice' — will become bot_alice
  display_name?: string;  // optional override; defaults to capitalized name
  password?: string;      // optional override; defaults to BOT_PASSWORD_DEFAULT
}

/**
 * Build a service-role Supabase client suitable for managing auth users
 * and the players table. Service role bypasses RLS.
 */
export function serviceClientFromEnv(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY,
): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      'serviceClientFromEnv: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env',
    );
  }
  // Pass the `ws` package as realtime transport. supabase-js >=2.47
  // refuses to construct in Node <22 otherwise (see SessionManager.ts
  // for the same reason). We don't use realtime; this just lets the
  // client be instantiated.
  return createClient(url, serviceKey, {
    realtime: { transport: WebSocket as unknown as never },
  });
}

export async function ensureBot(
  service: SupabaseClient,
  input: EnsureBotInput,
): Promise<BotIdentity> {
  const username = `bot_${input.name}`;
  const display_name = input.display_name ?? capitalize(input.name);
  const email = `${username}@playavalon.local`;
  const password = input.password ?? BOT_PASSWORD_DEFAULT;

  // Already in players? Reuse.
  const { data: existing } = await service
    .from('players')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle();
  if (existing) {
    return { ...existing, email, password };
  }

  // Try to create the auth user.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name },
  });

  let authId: string;
  if (created?.user) {
    authId = created.user.id;
  } else if (createErr && /already/i.test(createErr.message)) {
    // Auth user exists but the players row doesn't — find by email.
    const list = await service.auth.admin.listUsers();
    const users = (list.data?.users ?? []) as Array<{ id: string; email?: string }>;
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (!found) {
      throw new Error(`auth user exists for ${email} but listUsers couldn't find it`);
    }
    authId = found.id;
  } else if (createErr) {
    throw createErr;
  } else {
    throw new Error('createUser returned no user and no error');
  }

  const { data: inserted, error: insertErr } = await service
    .from('players')
    .insert({ id: authId, username, display_name })
    .select('id, username, display_name')
    .single();
  if (insertErr) throw insertErr;

  return { ...inserted, email, password };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export const BOT_PASSWORD = BOT_PASSWORD_DEFAULT;
