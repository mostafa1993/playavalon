/**
 * Dev script: auto-confirm bot players' roles, one by one with random delays.
 * Usage: npx tsx scripts/confirm-bots.ts <ROOM_CODE>
 *
 * ⚠️  Superseded by the agent engine (Phase 0). For new use, prefer running
 * actual agents — they hit the real /api/rooms/[code]/confirm endpoint
 * exactly like a human would:
 *
 *   npx tsx agents/src/cli/run.ts agents/configs/alice.yaml --room <CODE>
 *
 * This script is kept around for now because it's still the fastest way
 * to flip many bots' confirmations for a UI-only test of the lobby
 * dashboard. Will be removed once the agent engine is the default path
 * for everyone (~1 week after P3 ships and stabilizes).
 *
 * Useful for visually watching the lobby confirmation dashboard animate
 * (each bot's tile flips from ⏳ waiting → ✓ confirmed in real time via
 * Supabase Realtime). Works by writing player_roles.is_confirmed=true
 * directly via the service client — no HTTP, no auth juggling.
 *
 * Important: the script does NOT confirm the manager (or any non-bot
 * player). You should click "I Understand My Role" yourself LAST — that
 * click goes through /api/rooms/[code]/confirm, which triggers the
 * proper auto-start path (creates the games row + seating + leader).
 * If you let a bot's confirm be the last one, auto-start won't fire
 * because we bypassed the API; you'd be stuck at "all confirmed but
 * no game record."
 *
 * Override timing with env vars if you want:
 *   BOT_DELAY_MIN=1 BOT_DELAY_MAX=4 npx tsx scripts/confirm-bots.ts XXXXXX
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const MIN_DELAY = Number(process.env.BOT_DELAY_MIN ?? 3);
const MAX_DELAY = Number(process.env.BOT_DELAY_MAX ?? 10);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const roomCode = process.argv[2]?.toUpperCase();
  if (!roomCode) {
    console.error('Usage: npx tsx scripts/confirm-bots.ts <ROOM_CODE>');
    process.exit(1);
  }

  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .select('id, status')
    .eq('code', roomCode)
    .single();
  if (roomErr || !room) {
    console.error('Room not found:', roomCode);
    process.exit(1);
  }
  if (room.status !== 'roles_distributed') {
    console.error(`Room status is "${room.status}", not "roles_distributed".`);
    console.error('Run this script AFTER the manager clicks Distribute in the lobby.');
    process.exit(1);
  }

  // Find all unconfirmed bot roles in this room
  const { data: rows, error: rowsErr } = await supabase
    .from('player_roles')
    .select(`
      player_id,
      players!inner ( username, display_name )
    `)
    .eq('room_id', room.id)
    .eq('is_confirmed', false);
  if (rowsErr) throw rowsErr;

  type Row = {
    player_id: string;
    players: { username: string; display_name: string } | { username: string; display_name: string }[];
  };

  const bots = (rows as Row[] | null ?? [])
    .map((r) => {
      const p = Array.isArray(r.players) ? r.players[0] : r.players;
      return { player_id: r.player_id, username: p?.username, display_name: p?.display_name };
    })
    .filter((b) => b.username?.startsWith('bot_'));

  if (bots.length === 0) {
    console.log('No unconfirmed bot players in this room. Either Distribute hasn\'t run, or every bot is already confirmed.');
    process.exit(0);
  }

  console.log(`Found ${bots.length} bot(s) to auto-confirm:`);
  bots.forEach((b) => console.log(`  - ${b.display_name}`));
  console.log();

  // Confirm each bot in turn, with a random delay between them so the
  // dashboard updates progressively rather than all at once.
  for (const bot of bots) {
    const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    console.log(`⏳ ${bot.display_name} confirming in ${delay.toFixed(1)}s…`);
    await sleep(delay * 1000);

    const { error } = await supabase
      .from('player_roles')
      .update({ is_confirmed: true })
      .eq('room_id', room.id)
      .eq('player_id', bot.player_id);

    if (error) {
      console.error(`  ✗ ${bot.display_name}: ${error.message}`);
    } else {
      console.log(`  ✓ ${bot.display_name} confirmed`);
    }
  }

  console.log('\nDone — all bots confirmed.');
  console.log('Now click "I Understand My Role" in YOUR browser to trigger the game-start auto-fire.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
