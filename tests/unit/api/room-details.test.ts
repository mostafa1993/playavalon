/**
 * Unit tests for GET /api/rooms/[code], with the database calls stubbed: the
 * lobby's link back to the previous game goes only to people who played it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  findRoomByCode: vi.fn(),
  isPlayerInRoom: vi.fn(),
  getRoomDetails: vi.fn(),
  previousGame: vi.fn(),
  reviewCount: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: db.getCurrentUser,
  createServiceClient: () => ({
    from: (table: string) =>
      table === 'games'
        ? { select: () => ({ eq: () => ({ maybeSingle: db.previousGame }) }) }
        : { select: () => ({ eq: db.reviewCount }) },
  }),
}));

vi.mock('@/lib/supabase/rooms', () => ({
  findRoomByCode: db.findRoomByCode,
  isPlayerInRoom: db.isPlayerInRoom,
  getRoomDetails: db.getRoomDetails,
}));

import { GET } from '@/app/api/rooms/[code]/route';

const CODE = 'ABCDEF';
const room = {
  id: 'room-2',
  code: CODE,
  status: 'waiting',
  role_config: { merlin: true },
  ai_review_enabled: true,
  ai_review_mode: 'god',
  lady_of_lake_holder_id: null,
};

async function previousGameFor(userId: string) {
  db.getCurrentUser.mockResolvedValue({ id: userId });
  const response = await GET(new Request(`http://test/api/rooms/${CODE}`), {
    params: Promise.resolve({ code: CODE }),
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.data.previous_game;
}

describe('GET /api/rooms/[code] — the previous game', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.findRoomByCode.mockResolvedValue(room);
    db.isPlayerInRoom.mockResolvedValue(true);
    db.getRoomDetails.mockResolvedValue({ room, players: [] });
    db.previousGame.mockResolvedValue({
      data: { id: 'game-1', seating_order: ['p1', 'p2', 'p3', 'p4', 'p5'] },
      error: null,
    });
    db.reviewCount.mockResolvedValue({ count: 1, error: null });
  });

  it('goes to a member who played the previous game', async () => {
    expect(await previousGameFor('p2')).toEqual({ id: 'game-1', reviewed: true });
  });

  it('is withheld from a member who did not play it', async () => {
    expect(await previousGameFor('stranger')).toBeNull();
    expect(db.reviewCount).not.toHaveBeenCalled();
  });

  it('is null for a room no finished game points at', async () => {
    db.previousGame.mockResolvedValue({ data: null, error: null });
    expect(await previousGameFor('p2')).toBeNull();
  });
});
