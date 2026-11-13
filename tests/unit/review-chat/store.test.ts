/**
 * Unit tests: the chat's queries, against a fake Supabase client that records
 * every call — a player reads and changes only their own thread of one game,
 * a duplicate number is told apart from other errors, and the question limit
 * comes from configuration.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteMessage,
  getReview,
  getThread,
  questionLimit,
  storeMessage,
} from '@/lib/review-chat/store';

type Call = [string, ...unknown[]];

/** A client whose every query records its calls and resolves to `result`. */
function fakeClient(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = [];
  const query: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push([String(prop), ...args]);
          return query;
        };
      },
    }
  );
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const filters = (calls: Call[]) => calls.filter((c) => c[0] === 'eq');

afterEach(() => {
  delete process.env.REVIEW_CHAT_MAX_QUESTIONS;
});

describe('getThread', () => {
  it("reads only this player's thread of this game, question before answer", async () => {
    const { client, calls } = fakeClient({ data: [] });
    await getThread(client, 'g1', 'p1');
    expect(calls[0]).toEqual(['from', 'review_chat_messages']);
    expect(filters(calls)).toEqual([
      ['eq', 'game_id', 'g1'],
      ['eq', 'player_id', 'p1'],
    ]);
    expect(calls.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual(['turn_no', 'speaker']);
  });

  it('maps the rows', async () => {
    const { client } = fakeClient({
      data: [
        { turn_no: 1, speaker: 'player', content: 'q', created_at: 't1' },
        { turn_no: 1, speaker: 'reviewer', content: 'a', created_at: 't2' },
      ],
    });
    expect(await getThread(client, 'g1', 'p1')).toEqual([
      { turnNo: 1, speaker: 'player', content: 'q', createdAt: 't1' },
      { turnNo: 1, speaker: 'reviewer', content: 'a', createdAt: 't2' },
    ]);
  });

  it('throws a database error', async () => {
    const { client } = fakeClient({ error: { code: '42501', message: 'denied' } });
    await expect(getThread(client, 'g1', 'p1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('storeMessage', () => {
  const message = { gameId: 'g1', playerId: 'p1', turnNo: 3, speaker: 'player' as const, content: 'q' };

  it("inserts the message under the player's id and number", async () => {
    const { client, calls } = fakeClient();
    expect(await storeMessage(client, message)).toBe(true);
    expect(calls).toEqual([
      ['from', 'review_chat_messages'],
      ['insert', { game_id: 'g1', player_id: 'p1', turn_no: 3, speaker: 'player', content: 'q' }],
    ]);
  });

  it('is false when the number is taken', async () => {
    const { client } = fakeClient({ error: { code: '23505', message: 'duplicate key' } });
    expect(await storeMessage(client, message)).toBe(false);
  });

  it('throws any other error', async () => {
    const { client } = fakeClient({ error: { code: '23503', message: 'foreign key' } });
    await expect(storeMessage(client, message)).rejects.toMatchObject({ code: '23503' });
  });
});

describe('deleteMessage', () => {
  it("removes only that player's one message of that game", async () => {
    const { client, calls } = fakeClient();
    await deleteMessage(client, { gameId: 'g1', playerId: 'p1', turnNo: 3, speaker: 'player' });
    expect(calls.slice(0, 2)).toEqual([['from', 'review_chat_messages'], ['delete']]);
    expect(filters(calls)).toEqual([
      ['eq', 'game_id', 'g1'],
      ['eq', 'player_id', 'p1'],
      ['eq', 'turn_no', 3],
      ['eq', 'speaker', 'player'],
    ]);
  });
});

describe('getReview', () => {
  it("reads the game's review row", async () => {
    const { client, calls } = fakeClient({ data: { status: 'ready', summary_fa_path: '/x' } });
    expect(await getReview(client, 'g1')).toEqual({ status: 'ready', summary_fa_path: '/x' });
    expect(calls[0]).toEqual(['from', 'game_reviews']);
    expect(filters(calls)).toEqual([['eq', 'game_id', 'g1']]);
  });
});

describe('questionLimit', () => {
  it('is 30 by default, or REVIEW_CHAT_MAX_QUESTIONS', () => {
    expect(questionLimit()).toBe(30);
    process.env.REVIEW_CHAT_MAX_QUESTIONS = '5';
    expect(questionLimit()).toBe(5);
  });

  it('refuses a value that is not a positive whole number', () => {
    for (const value of ['0', '-1', '2.5', 'many']) {
      process.env.REVIEW_CHAT_MAX_QUESTIONS = value;
      expect(() => questionLimit(), value).toThrow(/positive integer/);
    }
  });
});
