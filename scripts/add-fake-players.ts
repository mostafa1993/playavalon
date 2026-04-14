/**
 * Dev script: Add fake players to a room for testing
 * Usage: npx tsx scripts/add-fake-players.ts <ROOM_CODE>
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

const FAKE_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana'];

async function main() {
  const roomCode = process.argv[2]?.toUpperCase();
  if (!roomCode) {
    console.error('Usage: npx tsx scripts/add-fake-players.ts <ROOM_CODE>');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find the room
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', roomCode)
    .single();

  if (roomErr || !room) {
    console.error('Room not found:', roomCode);
    process.exit(1);
  }

  // Count existing players
  const { count } = await supabase
    .from('room_players')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', room.id);

  const needed = room.expected_players - (count || 0);
  if (needed <= 0) {
    console.log('Room is already full!');
    process.exit(0);
  }

  console.log(`Room ${roomCode}: ${count}/${room.expected_players} players. Adding ${needed} fake players...`);

  for (let i = 0; i < needed; i++) {
    const name = FAKE_NAMES[i] || `Bot${i + 1}`;
    const playerId = randomUUID();

    // Try to find existing player with this nickname, or create new
    let player: any;
    const { data: existing } = await supabase
      .from('players')
      .select('*')
      .ilike('nickname', name)
      .single();

    if (existing) {
      player = existing;
    } else {
      const { data: created, error: playerErr } = await supabase
        .from('players')
        .insert({ player_id: playerId, nickname: name })
        .select()
        .single();

      if (playerErr) {
        console.error(`Failed to create player ${name}:`, playerErr.message);
        continue;
      }
      player = created;
    }

    // Add to room
    const { error: joinErr } = await supabase
      .from('room_players')
      .insert({
        room_id: room.id,
        player_id: player.id,
        is_connected: true,
      });

    if (joinErr) {
      console.error(`Failed to add ${name} to room:`, joinErr.message);
      continue;
    }

    console.log(`  Added: ${name}`);
  }

  console.log('Done! Room should now be full.');
}

main();
