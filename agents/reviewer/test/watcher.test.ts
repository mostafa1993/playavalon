/**
 * Watcher zombie-game regression test.
 *
 * A game abandoned mid-play keeps ended_at unset, so it still looks active.
 * The watcher must move on when a newer game starts, and must not go back to
 * the abandoned one once the newer game ends.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { startWatcher } from '../src/gamestate/watcher.js';

/** Live games, oldest first; `ended` mirrors ended_at being set. */
type Games = Array<{ id: string; ended: boolean }>;

/** Answers the two queries the watcher makes: newest active game, and has-ended. */
function makeFakeDb(games: Games) {
  const from = () => {
    let id: string | null = null;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: string) => {
      if (col === 'id') id = val;
      return builder;
    };
    builder.is = () => builder;
    builder.neq = () => builder;
    builder.order = () => builder;
    builder.limit = () => {
      const newest = games.filter((g) => !g.ended).at(-1);
      const data = newest
        ? [{
            id: newest.id,
            room_id: `room-${newest.id}`,
            rooms: { code: 'ABC123', ai_review_enabled: true, ai_review_mode: 'blind' },
          }]
        : [];
      return Promise.resolve({ data, error: null });
    };
    builder.maybeSingle = () => {
      const game = games.find((g) => g.id === id);
      const data = game ? { ended_at: game.ended ? 'now' : null, phase: 'quest' } : null;
      return Promise.resolve({ data, error: null });
    };
    return builder;
  };
  return { from } as unknown as Parameters<typeof startWatcher>[0];
}

const ticks = () => new Promise((r) => setTimeout(r, 50));

test('switches to a newer game and never returns to the abandoned one', async () => {
  const games: Games = [{ id: 'A', ended: false }];
  const events: string[] = [];
  const watcher = startWatcher(makeFakeDb(games), 5, {
    onGameStart: (g) => { events.push(`start ${g.id}`); },
    onGameEnd: (id) => { events.push(`end ${id}`); },
  });

  try {
    await ticks();
    assert.deepEqual(events, ['start A']);

    // A is abandoned (never ended) and the group starts B.
    games.push({ id: 'B', ended: false });
    await ticks();
    assert.deepEqual(events, ['start A', 'end A', 'start B']);

    // B finishes normally; A still looks active but must not be picked up again.
    games[1]!.ended = true;
    await ticks();
    assert.deepEqual(events, ['start A', 'end A', 'start B', 'end B']);
  } finally {
    watcher.stop();
  }
});
