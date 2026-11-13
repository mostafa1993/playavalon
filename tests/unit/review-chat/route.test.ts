/**
 * Unit tests for GET/POST /api/reviews/[gameId]/chat, with the database, the
 * reviewer's files and the model stubbed: the checks in their order, the
 * question limit counted on stored questions, the answer streamed and stored
 * under its question's number, and a question no answer came to removed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReviewChatMessage } from '@/types/review';
import { blindRecord, godRecord, godReportFa, roleRows } from './fixtures';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getGameById: vi.fn(),
  getRoleAssignments: vi.fn(),
  getReview: vi.fn(),
  getThread: vi.fn(),
  storeMessage: vi.fn(),
  deleteMessage: vi.fn(),
  readGameRecord: vi.fn(),
  readSummaryFile: vi.fn(),
  modelConfigured: vi.fn(),
  streamAnswer: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: m.getCurrentUser,
  createServiceClient: () => ({}),
}));
vi.mock('@/lib/supabase/games', () => ({ getGameById: m.getGameById }));
vi.mock('@/lib/supabase/roles', () => ({ getRoleAssignments: m.getRoleAssignments }));
// Every room closed: the chat opens on the game's phase alone (plan D8).
vi.mock('@/lib/supabase/rooms', () => ({ findRoomById: async () => ({ status: 'closed' }) }));
vi.mock('@/lib/review-chat/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/review-chat/store')>()),
  getReview: m.getReview,
  getThread: m.getThread,
  storeMessage: m.storeMessage,
  deleteMessage: m.deleteMessage,
}));
vi.mock('@/lib/review-chat/files', () => ({
  reviewDataDir: () => '/data/games',
  readGameRecord: m.readGameRecord,
  readSummaryFile: m.readSummaryFile,
}));
vi.mock('@/lib/review-chat/model', () => ({
  modelConfigured: m.modelConfigured,
  streamAnswer: m.streamAnswer,
}));

import { GET, POST } from '@/app/api/reviews/[gameId]/chat/route';

const GAME = '6f1c1a52-6c2e-4e7b-9a43-0d6f3b1e2a10';
const PLAYER = 'c';
const SUMMARY = `/data/games/${GAME}/summary.fa.json`;

const message = (turnNo: number, speaker: ReviewChatMessage['speaker']): ReviewChatMessage => ({
  turnNo,
  speaker,
  content: `${speaker} ${turnNo}`,
  createdAt: '2026-01-02T10:00:00.000Z',
});

/** `questions` stored questions, the first `answered` of them answered. */
function thread(questions: number, answered = questions): ReviewChatMessage[] {
  return Array.from({ length: questions }, (_, i) => i + 1).flatMap((n) =>
    n <= answered ? [message(n, 'player'), message(n, 'reviewer')] : [message(n, 'player')]
  );
}

async function* chunks(...texts: string[]) {
  for (const t of texts) yield t;
}

const game = (phase: string, seating = ['a', 'b', 'c', 'd', 'e']) => ({
  id: GAME,
  room_id: 'room-1',
  phase,
  seating_order: seating,
});

async function ask(question: unknown = 'Who led quest 1?', gameId = GAME) {
  return POST(
    new Request(`http://test/api/reviews/${gameId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
    { params: Promise.resolve({ gameId }) }
  );
}

async function read(gameId = GAME) {
  return GET(new Request(`http://test/api/reviews/${gameId}/chat`), {
    params: Promise.resolve({ gameId }),
  });
}

async function errorOf(response: Response) {
  return { status: response.status, ...(await response.json()).error };
}

const notAvailable = { status: 404, message: "Chat isn't available for this game" };

/** A player of a finished, reviewed game with a record and a report, and an
 *  empty thread. */
function chatOpen() {
  m.getCurrentUser.mockResolvedValue({ id: PLAYER });
  m.getGameById.mockResolvedValue(game('game_over'));
  m.modelConfigured.mockReturnValue(true);
  m.getReview.mockResolvedValue({ status: 'ready', summary_fa_path: SUMMARY });
  m.readGameRecord.mockResolvedValue(godRecord);
  m.readSummaryFile.mockResolvedValue(godReportFa);
  m.getThread.mockResolvedValue([]);
  m.storeMessage.mockResolvedValue(true);
  m.deleteMessage.mockResolvedValue(undefined);
  m.getRoleAssignments.mockResolvedValue(roleRows);
  m.streamAnswer.mockImplementation(async () => chunks('Bo ', 'led.'));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The routes log the failures some tests cause on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  chatOpen();
});

afterEach(() => {
  delete process.env.REVIEW_CHAT_MAX_QUESTIONS;
});

describe('the checks, in order', () => {
  /** Everything wrong at once, so each step shows the first check that fails. */
  function allWrong() {
    m.getCurrentUser.mockResolvedValue(null);
    m.getGameById.mockResolvedValue(game('voting', ['a']));
    m.modelConfigured.mockReturnValue(false);
    m.getReview.mockResolvedValue({ status: 'generating', summary_fa_path: null });
    m.readGameRecord.mockResolvedValue(null);
    m.readSummaryFile.mockResolvedValue(null);
    m.getThread.mockResolvedValue(thread(30));
  }

  const fixes: Array<() => void> = [
    () => m.getCurrentUser.mockResolvedValue({ id: PLAYER }),
    () => m.getGameById.mockResolvedValue(game('voting', ['a', PLAYER])),
    () => m.getGameById.mockResolvedValue(game('game_over', ['a', PLAYER])),
    () => m.modelConfigured.mockReturnValue(true),
    () => m.getReview.mockResolvedValue({ status: 'ready', summary_fa_path: SUMMARY }),
    () => m.readGameRecord.mockResolvedValue(godRecord),
    () => m.readSummaryFile.mockResolvedValue(godReportFa),
    () => m.getThread.mockResolvedValue(thread(29)),
  ];

  async function afterFixes(n: number) {
    allWrong();
    fixes.slice(0, n).forEach((fix) => fix());
    return ask();
  }

  it('401 when signed out, before reading the game', async () => {
    const res = await afterFixes(0);
    expect(res.status).toBe(401);
    expect(m.getGameById).not.toHaveBeenCalled();
  });

  it('403 for someone not in the seating order, before the phase or review', async () => {
    expect(await errorOf(await afterFixes(1))).toMatchObject({ status: 403, code: 'NOT_IN_GAME' });
    expect(m.getReview).not.toHaveBeenCalled();
  });

  it('409 while the game is not over, before the review', async () => {
    expect(await errorOf(await afterFixes(2))).toMatchObject({ status: 409, code: 'GAME_NOT_OVER' });
    expect(m.getReview).not.toHaveBeenCalled();
  });

  it('404 when the app has no model, before the review', async () => {
    expect(await errorOf(await afterFixes(3))).toMatchObject(notAvailable);
    expect(m.getReview).not.toHaveBeenCalled();
  });

  it('404 while the review is not ready, before reading the record', async () => {
    expect(await errorOf(await afterFixes(4))).toMatchObject(notAvailable);
    expect(m.readGameRecord).not.toHaveBeenCalled();
  });

  it('404 without record.json, before reading the report', async () => {
    expect(await errorOf(await afterFixes(5))).toMatchObject(notAvailable);
    expect(m.readSummaryFile).not.toHaveBeenCalled();
  });

  it('404 without a report it can read, before the thread', async () => {
    expect((await afterFixes(6)).status).toBe(404);
    expect(m.getThread).not.toHaveBeenCalled();
  });

  it('429 at the limit, storing nothing and calling no model', async () => {
    expect(await errorOf(await afterFixes(7))).toMatchObject({
      status: 429,
      code: 'QUESTION_LIMIT_REACHED',
      message: "You've reached the 30-question limit for this game",
    });
    expect(m.storeMessage).not.toHaveBeenCalled();
    expect(m.streamAnswer).not.toHaveBeenCalled();
  });

  it('answers once every check passes', async () => {
    const res = await afterFixes(8);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Bo led.');
  });

  it('checks access before the question itself', async () => {
    allWrong();
    fixes[0]();
    expect((await ask('')).status).toBe(403);
  });

  it('404s a game id that is not a UUID, before reading the game', async () => {
    for (const id of ['game-1', '../etc', '6f1c1a52']) {
      expect(await errorOf(await ask('q', id)), id).toMatchObject({ status: 404, message: 'Game not found' });
      expect((await read(id)).status).toBe(404);
    }
    expect(m.getGameById).not.toHaveBeenCalled();
  });

  it('refuses a game left unfinished, even in a closed room (game_over only)', async () => {
    m.getGameById.mockResolvedValue(game('voting'));
    expect((await ask()).status).toBe(409);
    expect((await read()).status).toBe(409);
  });

  it('GET makes the same checks', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    expect((await read()).status).toBe(401);
    chatOpen();
    m.readGameRecord.mockResolvedValue(null);
    expect(await errorOf(await read())).toMatchObject(notAvailable);
    chatOpen();
    m.modelConfigured.mockReturnValue(false);
    expect(await errorOf(await read())).toMatchObject(notAvailable);
  });
});

describe('GET', () => {
  it("returns the caller's thread and the limit", async () => {
    m.getThread.mockResolvedValue(thread(2, 1));
    const res = await read();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { limit: 30, messages: thread(2, 1) } });
    expect(m.getThread).toHaveBeenCalledWith({}, GAME, PLAYER);
  });

  it('reads the report from the game’s own folder', async () => {
    await read();
    expect(m.readGameRecord).toHaveBeenCalledWith('/data/games', GAME);
    expect(m.readSummaryFile).toHaveBeenCalledWith('/data/games', GAME, SUMMARY);
  });
});

describe('the question limit', () => {
  it('counts every stored question, answered or not', async () => {
    m.getThread.mockResolvedValue(thread(30, 12));
    expect(await errorOf(await ask())).toMatchObject({
      status: 429,
      message: "You've reached the 30-question limit for this game",
    });
  });

  it('counts questions, not messages: the 30th question is asked', async () => {
    m.getThread.mockResolvedValue(thread(29));
    expect((await ask()).status).toBe(200);
    expect(m.storeMessage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ turnNo: 30, speaker: 'player' })
    );
  });

  it('comes from REVIEW_CHAT_MAX_QUESTIONS', async () => {
    process.env.REVIEW_CHAT_MAX_QUESTIONS = '3';
    m.getThread.mockResolvedValue(thread(3, 0));
    expect(await errorOf(await ask())).toMatchObject({
      status: 429,
      message: "You've reached the 3-question limit for this game",
    });
  });

  it('refuses a question whose number another one just took, before the model', async () => {
    m.storeMessage.mockResolvedValue(false);
    expect(await errorOf(await ask())).toMatchObject({
      status: 429,
      code: 'QUESTION_IN_PROGRESS',
      message: 'Only one question at a time',
    });
    expect(m.streamAnswer).not.toHaveBeenCalled();
    expect(m.deleteMessage).not.toHaveBeenCalled();
  });
});

describe('the answer', () => {
  it('stores the question first, then streams the answer and stores it under the same number', async () => {
    m.getThread.mockResolvedValue(thread(2));
    m.streamAnswer.mockImplementation(async () => {
      // The question is stored before the model is called.
      expect(m.storeMessage).toHaveBeenCalledTimes(1);
      return chunks('Bo ', 'led ', 'quest 1.');
    });
    const res = await ask('  Who led quest 1?  ');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Bo led quest 1.');
    expect(m.storeMessage.mock.calls.map((c) => c[1])).toEqual([
      { gameId: GAME, playerId: PLAYER, turnNo: 3, speaker: 'player', content: 'Who led quest 1?' },
      { gameId: GAME, playerId: PLAYER, turnNo: 3, speaker: 'reviewer', content: 'Bo led quest 1.' },
    ]);
  });

  it('gives the model the record, the report and the thread, ending with the question', async () => {
    m.getThread.mockResolvedValue(thread(1));
    await (await ask()).text();
    const prompt = m.streamAnswer.mock.calls[0][0];
    expect(prompt.systemInstruction).toContain('The player asking sits in seat 3');
    expect(prompt.systemInstruction).toContain('Proposal 1: leader Ana, team Ana, Bo — rejected');
    expect(prompt.systemInstruction).toContain('روایت بازی.');
    expect(prompt.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(prompt.contents.at(-1)).toEqual({ role: 'user', parts: [{ text: 'Who led quest 1?' }] });
    expect(m.getRoleAssignments).not.toHaveBeenCalled();
  });

  it("tells a blind game's chat the true roles from the role rows", async () => {
    m.readGameRecord.mockResolvedValue(blindRecord);
    await (await ask()).text();
    expect(m.getRoleAssignments).toHaveBeenCalledWith({}, 'room-1');
    expect(m.streamAnswer.mock.calls[0][0].systemInstruction).toContain('- Seat 1: Ana — good, Merlin');
  });

  it('502 when the model cannot be reached, and the question is removed again', async () => {
    m.getThread.mockResolvedValue(thread(4));
    m.streamAnswer.mockRejectedValue(new Error('PERMISSION_DENIED'));
    expect(await errorOf(await ask())).toMatchObject({ status: 502, code: 'REVIEWER_UNAVAILABLE' });
    expect(m.storeMessage).toHaveBeenCalledTimes(1);
    expect(m.deleteMessage).toHaveBeenCalledWith(
      {},
      { gameId: GAME, playerId: PLAYER, turnNo: 5, speaker: 'player' }
    );
  });

  it('502, and the question removed, when the answer fails before any text', async () => {
    m.streamAnswer.mockImplementation(async () =>
      (async function* () {
        throw new Error('Empty answer (finishReason=SAFETY)');
      })()
    );
    expect((await ask()).status).toBe(502);
    expect(m.deleteMessage).toHaveBeenCalledWith({}, expect.objectContaining({ turnNo: 1, speaker: 'player' }));
  });

  it('ends the stream with an error when the model fails midway; the question still counts', async () => {
    m.streamAnswer.mockImplementation(async () =>
      (async function* () {
        yield 'Bo ';
        throw new Error('stream reset');
      })()
    );
    const res = await ask();
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
    expect(m.storeMessage).toHaveBeenCalledTimes(1);
    expect(m.deleteMessage).not.toHaveBeenCalled();
  });

  it('refuses an empty or overlong question, storing nothing', async () => {
    expect((await ask('   ')).status).toBe(400);
    expect((await ask('x'.repeat(1001))).status).toBe(400);
    expect((await ask(42)).status).toBe(400);
    expect(m.storeMessage).not.toHaveBeenCalled();
  });
});
