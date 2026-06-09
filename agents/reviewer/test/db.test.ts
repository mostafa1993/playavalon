/**
 * Blind-mode purity regression test.
 *
 * The honesty guarantee of blind mode is that the reviewer NEVER reads the
 * player_roles table for that game — so it can only deduce roles, never know
 * them. This test spies on which tables loadMetaSnapshot queries and asserts
 * blind touches `players` (for the roster) but never `player_roles`. If someone
 * later wires a role read into the blind path, this fails loudly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMetaSnapshot } from '../src/gamestate/db.js';

interface FakeResult {
  data: unknown;
  error: null;
}

/** A minimal Supabase-shaped client that records the tables it's asked for. */
function makeFakeDb(results: Record<string, FakeResult>, queried: string[]) {
  const from = (table: string) => {
    queried.push(table);
    const result: FakeResult = results[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.in = () => builder;
    builder.single = () => Promise.resolve(result);
    // Make the builder itself awaitable (the players/player_roles queries await
    // the builder directly rather than .single()).
    builder.then = (
      resolve: (v: FakeResult) => unknown,
      reject?: (e: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return builder;
  };
  // The shape the production code uses is a small subset of SupabaseClient.
  return { from } as unknown as Parameters<typeof loadMetaSnapshot>[0];
}

const GAME = {
  id: 'game-1',
  room_id: 'room-1',
  player_count: 2,
  seating_order: ['p1', 'p2'],
  leader_index: 0,
  current_leader_id: 'p1',
  created_at: '2026-01-01T00:00:00Z',
};
const ROOM = { id: 'room-1', code: 'ABCDEF' };
const PLAYERS = [
  { id: 'p1', display_name: 'Alice' },
  { id: 'p2', display_name: 'Bob' },
];
const ROLES = [
  { player_id: 'p1', role: 'good', special_role: 'merlin', players: { id: 'p1', display_name: 'Alice' } },
  { player_id: 'p2', role: 'evil', special_role: 'assassin', players: { id: 'p2', display_name: 'Bob' } },
];

test('blind mode never queries player_roles (reads players for the roster instead)', async () => {
  const queried: string[] = [];
  const db = makeFakeDb(
    {
      games: { data: GAME, error: null },
      rooms: { data: ROOM, error: null },
      players: { data: PLAYERS, error: null },
    },
    queried
  );

  const meta = await loadMetaSnapshot(db, 'game-1', 'blind');

  assert.ok(queried.includes('players'), 'blind should read the players table for the roster');
  assert.ok(
    !queried.includes('player_roles'),
    'BLIND MUST NEVER QUERY player_roles — the honesty guarantee is broken'
  );
  // Roster is present but role-free.
  assert.equal(meta.players.length, 2);
  assert.equal(meta.players[0]?.display_name, 'Alice');
  assert.equal(meta.players[0]?.role, undefined);
  assert.equal(meta.players[0]?.special_role, undefined);
});

test('god mode reads player_roles (the true roles it is meant to know)', async () => {
  const queried: string[] = [];
  const db = makeFakeDb(
    {
      games: { data: GAME, error: null },
      rooms: { data: ROOM, error: null },
      player_roles: { data: ROLES, error: null },
    },
    queried
  );

  const meta = await loadMetaSnapshot(db, 'game-1', 'god');

  assert.ok(queried.includes('player_roles'), 'god should read player_roles');
  assert.ok(!queried.includes('players'), 'god gets names from the player_roles join, not a separate players read');
  assert.ok(
    meta.players.some((p) => p.role === 'evil'),
    'god roster carries the true roles'
  );
});
