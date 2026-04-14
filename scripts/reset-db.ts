/**
 * Dev script: Reset all game data in the database
 * Usage: npx tsx scripts/reset-db.ts
 *
 * Clears all players, rooms, games, and related data.
 * Does NOT drop tables — just truncates them.
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Delete in order to respect foreign key constraints
  const tables = [
    'merlin_quiz_votes',
    'game_events',
    'watcher_sessions',
    'lady_investigations',
    'quest_actions',
    'votes',
    'team_proposals',
    'player_roles',
    'games',
    'room_players',
    'rooms',
    'players',
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.log(`  ⚠️  ${table}: ${error.message}`);
    } else {
      console.log(`  ✓ ${table} cleared`);
    }
  }

  console.log('\n🧹 Database reset complete.');
}

main();
