/**
 * Unit tests for GET /api/reviews/[gameId], with the database and the summary
 * file stubbed: the report opens only for a player of the game, and only once
 * the game can't be played any more — over, or its room closed — since the
 * reviewer can mark a live game's review ready. A report whose translation
 * failed is Persian only: its English request is ready with no summary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getGameById: vi.fn(),
  findRoomById: vi.fn(),
  review: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => {
  // game_reviews: .from().select().eq().maybeSingle()
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: m.review(), error: null }),
  };
  return { getCurrentUser: m.getCurrentUser, createServiceClient: () => ({ from: () => query }) };
});
vi.mock('@/lib/supabase/games', () => ({ getGameById: m.getGameById }));
vi.mock('@/lib/supabase/rooms', () => ({ findRoomById: m.findRoomById }));
vi.mock('node:fs/promises', () => ({ default: { readFile: m.readFile } }));

import { GET } from '@/app/api/reviews/[gameId]/route';

const GAME = '6f1c1a52-6c2e-4e7b-9a43-0d6f3b1e2a10';
const PLAYER = 'p1';
const SUMMARY = { format: 2, mode: 'god', narrative: 'روایت' };

async function open(gameId = GAME, lang = 'fa') {
  const res = await GET(new Request(`http://test/api/reviews/${gameId}?lang=${lang}`), {
    params: Promise.resolve({ gameId }),
  });
  return { status: res.status, body: await res.json() };
}

function gameIn(phase: string, roomStatus: string) {
  m.getGameById.mockResolvedValue({ id: GAME, room_id: 'room-1', phase, seating_order: [PLAYER, 'p2'] });
  m.findRoomById.mockResolvedValue({ id: 'room-1', status: roomStatus });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue({ id: PLAYER });
  gameIn('game_over', 'closed');
  m.review.mockReturnValue({
    status: 'ready',
    summary_fa_path: `/data/games/${GAME}/summary.fa.json`,
    summary_en_path: `/data/games/${GAME}/summary.en.json`,
    error_message: null,
    updated_at: '2026-01-01T00:00:00Z',
  });
  m.readFile.mockResolvedValue(JSON.stringify(SUMMARY));
});

describe('GET /api/reviews/[gameId]', () => {
  it('serves a finished game’s report', async () => {
    expect(await open()).toEqual({
      status: 200,
      body: { data: { enabled: true, status: 'ready', language: 'fa', summary: SUMMARY } },
    });
  });

  it('serves a Persian-only report: its English request is ready with no summary, never an error', async () => {
    m.review.mockReturnValue({
      status: 'ready',
      summary_fa_path: `/data/games/${GAME}/summary.fa.json`,
      summary_en_path: null,
      error_message: null,
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(await open(GAME, 'en')).toEqual({
      status: 200,
      body: { data: { enabled: true, status: 'ready', language: 'en', summary: null } },
    });
    expect(m.readFile).not.toHaveBeenCalled();
    expect((await open(GAME, 'fa')).body.data).toEqual({
      enabled: true,
      status: 'ready',
      language: 'fa',
      summary: SUMMARY,
    });
  });

  it('serves it whatever the room, once the game is over', async () => {
    gameIn('game_over', 'started');
    expect((await open()).status).toBe(200);
    expect(m.findRoomById).not.toHaveBeenCalled();
  });

  it('serves an abandoned game’s report once its room is closed', async () => {
    gameIn('voting', 'closed');
    expect((await open()).body.data.summary).toEqual(SUMMARY);
  });

  it('refuses a live game’s report, though its review is ready', async () => {
    for (const roomStatus of ['started', 'roles_distributed', 'waiting']) {
      gameIn('quest_execution', roomStatus);
      expect(await open(), roomStatus).toMatchObject({ status: 409, body: { error: { code: 'GAME_NOT_OVER' } } });
    }
    expect(m.review).not.toHaveBeenCalled();
    expect(m.readFile).not.toHaveBeenCalled();
  });

  it('refuses a game whose room is gone, unless it is over', async () => {
    gameIn('voting', 'closed');
    m.findRoomById.mockResolvedValue(null);
    expect((await open()).status).toBe(409);
  });

  it('403s someone who did not play the game, before the game state', async () => {
    m.getCurrentUser.mockResolvedValue({ id: 'stranger' });
    gameIn('voting', 'started');
    expect((await open()).status).toBe(403);
    expect(m.findRoomById).not.toHaveBeenCalled();
  });

  it('401s a signed-out caller', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    expect((await open()).status).toBe(401);
  });

  it('404s a game id that is not a UUID, before reading the game', async () => {
    for (const id of ['game-1', '../etc', '6f1c1a52']) {
      expect(await open(id), id).toMatchObject({ status: 404, body: { error: { message: 'Game not found' } } });
    }
    expect(m.getGameById).not.toHaveBeenCalled();
  });
});
