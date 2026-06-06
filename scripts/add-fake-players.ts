/**
 * Dev script: Fill a room with fake players for testing UI/state changes
 * Usage: npx tsx scripts/add-fake-players.ts <ROOM_CODE>
 *
 * What it does:
 *   - For each missing slot, creates (or reuses) a Supabase Auth user
 *     with a stable username like "bot_alice", "bot_bob", …
 *   - Inserts the matching `players` row (Supabase Auth schema:
 *     id = auth UID, username, display_name)
 *   - Adds them to `room_players`
 *
 * The bots never log in or click anything themselves — they're just rows in
 * the DB, so they show up in the lobby and let the manager hit "Distribute"
 * at the right player count. To simulate state transitions (e.g. confirming
 * a role), run SQL in the Supabase dashboard, e.g.:
 *
 *   UPDATE player_roles SET is_confirmed = true
 *   WHERE room_id = (SELECT id FROM rooms WHERE code = 'XXXXXX')
 *     AND player_id = (SELECT id FROM players WHERE username = 'bot_alice');
 *
 * Bot credentials (if you want to actually log in as one in another browser):
 *   email:    bot_<name>@playavalon.local
 *   password: bot_password_dev_only
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const BOT_NAMES = ['alice', 'bob', 'charlie', 'diana', 'erin', 'frank', 'grace', 'henry', 'iris'];
const BOT_PASSWORD = 'bot_password_dev_only';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function ensureBot(index: number): Promise<{ id: string; username: string; display_name: string }> {
  const username = `bot_${BOT_NAMES[index] ?? `bot${index + 1}`}`;
  const displayName = (BOT_NAMES[index] ?? `Bot${index + 1}`).replace(/^\w/, (c) => c.toUpperCase());
  const email = `${username}@playavalon.local`;

  // Already in players? Reuse.
  const { data: existing } = await supabase
    .from('players')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle();
  if (existing) return existing;

  // Try to create the auth user. If they already exist in auth (from a
  // previous run that lost the players row somehow), look up + insert players.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: BOT_PASSWORD,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  });

  let authId: string;
  if (created?.user) {
    authId = created.user.id;
  } else if (createErr && /already/i.test(createErr.message)) {
    // Auth user exists; find it. listUsers' typed return is a discriminated
    // union and TS gets confused, so we narrow manually.
    const result = await supabase.auth.admin.listUsers();
    const users = (result.data?.users ?? []) as Array<{ id: string; email?: string }>;
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (!found) throw new Error(`Auth user exists for ${email} but listUsers couldn't find it`);
    authId = found.id;
  } else {
    throw createErr ?? new Error('createUser returned no user');
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('players')
    .insert({ id: authId, username, display_name: displayName })
    .select('id, username, display_name')
    .single();
  if (insertErr) throw insertErr;
  return inserted;
}

async function main() {
  const roomCode = process.argv[2]?.toUpperCase();
  if (!roomCode) {
    console.error('Usage: npx tsx scripts/add-fake-players.ts <ROOM_CODE>');
    process.exit(1);
  }

  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', roomCode)
    .single();
  if (roomErr || !room) {
    console.error('Room not found:', roomCode);
    process.exit(1);
  }

  const { count } = await supabase
    .from('room_players')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', room.id);

  const needed = room.expected_players - (count ?? 0);
  if (needed <= 0) {
    console.log(`Room ${roomCode} already at ${count}/${room.expected_players} — nothing to add.`);
    process.exit(0);
  }

  console.log(`Room ${roomCode}: ${count}/${room.expected_players}. Adding ${needed} bot(s)…\n`);

  // Which bot slots are already taken (so we don't try to re-add the same bot)?
  const { data: alreadyIn } = await supabase
    .from('room_players')
    .select('player_id, players!inner(username)')
    .eq('room_id', room.id);
  const takenUsernames = new Set(
    (alreadyIn ?? [])
      .map((rp: { players: { username: string } | { username: string }[] }) =>
        Array.isArray(rp.players) ? rp.players[0]?.username : rp.players?.username
      )
      .filter(Boolean)
  );

  let added = 0;
  for (let i = 0; added < needed && i < BOT_NAMES.length + 10; i++) {
    const candidateUsername = `bot_${BOT_NAMES[i] ?? `bot${i + 1}`}`;
    if (takenUsernames.has(candidateUsername)) continue;

    const bot = await ensureBot(i);
    const { error: joinErr } = await supabase
      .from('room_players')
      .insert({ room_id: room.id, player_id: bot.id, is_connected: true });
    if (joinErr) {
      console.error(`  ✗ ${bot.display_name}: ${joinErr.message}`);
      continue;
    }
    console.log(`  ✓ Added ${bot.display_name}  (login: ${bot.username}@playavalon.local / ${BOT_PASSWORD})`);
    added += 1;
  }

  console.log(`\nDone — room ${roomCode} now full.`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
