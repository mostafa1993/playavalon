/**
 * Dev script: Fill a room with fake players for testing UI/state changes.
 * Usage: npx tsx scripts/add-fake-players.ts <ROOM_CODE>
 *
 * What it does:
 *   - For each missing slot, ensures a Supabase Auth user + players row
 *     exist for `bot_alice` … `bot_iris`.
 *   - Adds them to `room_players`.
 *
 * These bot accounts are the SAME ones the agent engine (under /agents)
 * uses to sign in. The actual ensureBot() helper now lives at
 * agents/src/util/credentials.ts and is imported here so the two stay
 * perfectly in sync.
 *
 * The bots created by this script DO NOT play the game — they're just
 * rows in the DB so the manager can hit "Distribute" at the right player
 * count. To have a bot actually play a turn, run the agent engine:
 *
 *   npx tsx agents/src/cli/run.ts agents/configs/alice.yaml --room <CODE>
 *
 * Bot credentials (also used by the agent engine):
 *   email:    bot_<name>@playavalon.local
 *   password: bot_password_dev_only        (override via BOT_PASSWORD env var)
 */

import { readFileSync } from 'fs';
import { ensureBot, serviceClientFromEnv } from '../agents/src/util/credentials.js';

const BOT_NAMES = ['alice', 'bob', 'charlie', 'diana', 'erin', 'frank', 'grace', 'henry', 'iris'];

// Load .env.local
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!;
}

const supabase = serviceClientFromEnv();

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

  // Which bot slots are already taken?
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
  for (let i = 0; added < needed && i < BOT_NAMES.length; i++) {
    const candidateUsername = `bot_${BOT_NAMES[i]}`;
    if (takenUsernames.has(candidateUsername)) continue;

    const bot = await ensureBot(supabase, { name: BOT_NAMES[i]! });
    const { error: joinErr } = await supabase
      .from('room_players')
      .insert({ room_id: room.id, player_id: bot.id, is_connected: true });
    if (joinErr) {
      console.error(`  ✗ ${bot.display_name}: ${joinErr.message}`);
      continue;
    }
    console.log(`  ✓ Added ${bot.display_name}  (login: ${bot.email} / ${bot.password})`);
    added += 1;
  }

  console.log(`\nDone — room ${roomCode} now full.`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
