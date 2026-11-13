/**
 * Unit tests for POST /api/games/[gameId]/play-again, with the database calls
 * stubbed: claimed, being created, linked, refused, and the claim released
 * (and a created room closed) on failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/utils/errors';
import { ERROR_CODES } from '@/lib/utils/constants';
import type { Game } from '@/types/game';
import type { Room } from '@/types/database';

const db = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getGameById: vi.fn(),
  claimNextRoom: vi.fn(),
  linkNextRoom: vi.fn(),
  releaseNextRoomClaim: vi.fn(),
  findRoomById: vi.fn(),
  updateRoomStatus: vi.fn(),
  getPlayerCurrentRoom: vi.fn(),
  createRoomForPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: db.getCurrentUser,
  createServiceClient: () => ({}),
}));

vi.mock('@/lib/supabase/games', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/games')>()),
  getGameById: db.getGameById,
  claimNextRoom: db.claimNextRoom,
  linkNextRoom: db.linkNextRoom,
  releaseNextRoomClaim: db.releaseNextRoomClaim,
}));

vi.mock('@/lib/supabase/rooms', () => ({
  findRoomById: db.findRoomById,
  updateRoomStatus: db.updateRoomStatus,
}));

vi.mock('@/lib/supabase/players', () => ({
  getPlayerCurrentRoom: db.getPlayerCurrentRoom,
}));

vi.mock('@/lib/rooms/create-room-for-player', () => ({
  createRoomForPlayer: db.createRoomForPlayer,
}));

import { POST } from '@/app/api/games/[gameId]/play-again/route';

const PLAYER = 'player-1';

function finishedGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    room_id: 'room-old',
    phase: 'game_over',
    seating_order: [PLAYER, 'p2', 'p3', 'p4', 'p5'],
    next_room_id: null,
    next_room_claimed_by: null,
    next_room_claimed_at: null,
    ...overrides,
  } as Game;
}

const finishedRoom = {
  id: 'room-old',
  code: 'OLDOLD',
  status: 'closed',
  expected_players: 7,
  // Role distribution wrote the last game's decoy into the stored setup
  role_config: { merlin: true, percival: true, merlin_decoy_enabled: true, _merlin_decoy_player_id: 'p3' },
  intro_phase_enabled: true,
  agent_count: 2,
  ai_review_enabled: true,
  ai_review_mode: 'god',
} as unknown as Room;

const newRoom = { id: 'room-new', code: 'NEWNEW', status: 'waiting' } as Room;

async function press(gameId = 'game-1') {
  const response = await POST(new Request(`http://test/api/games/${gameId}/play-again`, { method: 'POST' }), {
    params: Promise.resolve({ gameId }),
  });
  return { status: response.status, body: await response.json() };
}

describe('POST /api/games/[gameId]/play-again', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // handleError logs the failures these tests cause on purpose
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.getCurrentUser.mockResolvedValue({ id: PLAYER });
    db.getGameById.mockResolvedValue(finishedGame());
    db.getPlayerCurrentRoom.mockResolvedValue(null);
    db.claimNextRoom.mockResolvedValue(true);
    db.linkNextRoom.mockResolvedValue(true);
    db.releaseNextRoomClaim.mockResolvedValue(undefined);
    db.updateRoomStatus.mockResolvedValue({});
    db.findRoomById.mockImplementation(async (_client: unknown, id: string) =>
      id === 'room-old' ? finishedRoom : id === 'room-new' ? newRoom : null
    );
    db.createRoomForPlayer.mockResolvedValue(newRoom);
  });

  describe('refused', () => {
    it('needs a signed-in user', async () => {
      db.getCurrentUser.mockResolvedValue(null);
      expect((await press()).status).toBe(401);
    });

    it('404s an unknown game', async () => {
      db.getGameById.mockResolvedValue(null);
      expect((await press()).status).toBe(404);
    });

    it('403s someone who did not play the game', async () => {
      db.getCurrentUser.mockResolvedValue({ id: 'stranger' });
      const { status, body } = await press();
      expect(status).toBe(403);
      expect(body.error.code).toBe(ERROR_CODES.NOT_IN_GAME);
      expect(db.claimNextRoom).not.toHaveBeenCalled();
    });

    it('409s a game still in play', async () => {
      db.getGameById.mockResolvedValue(finishedGame({ phase: 'voting' }));
      const { status, body } = await press();
      expect(status).toBe(409);
      expect(body.error.code).toBe(ERROR_CODES.GAME_NOT_OVER);
      expect(db.claimNextRoom).not.toHaveBeenCalled();
    });

    it("409s a player already in a waiting or dealt room, before claiming", async () => {
      db.getPlayerCurrentRoom.mockResolvedValue({ room_id: 'r', room_code: 'XYZXYZ', status: 'waiting' });
      const { status, body } = await press();
      expect(status).toBe(409);
      expect(body.error.code).toBe(ERROR_CODES.PLAYER_ALREADY_IN_ROOM);
      expect(body.error.message).toBe("You're already in another room");
      expect(db.claimNextRoom).not.toHaveBeenCalled();
    });
  });

  describe('linked', () => {
    it("answers the next room's code once it exists, without claiming", async () => {
      db.getGameById.mockResolvedValue(finishedGame({ next_room_id: 'room-new' }));
      const { status, body } = await press();
      expect(status).toBe(200);
      expect(body.data).toEqual({ status: 'linked', room_code: 'NEWNEW' });
      expect(db.claimNextRoom).not.toHaveBeenCalled();
      expect(db.createRoomForPlayer).not.toHaveBeenCalled();
    });

    it('answers "being created" when the linked room is gone between reads', async () => {
      db.getGameById.mockResolvedValue(finishedGame({ next_room_id: 'room-deleted' }));
      const { status, body } = await press();
      expect(status).toBe(202);
      expect(body.data).toEqual({ status: 'being_created', room_code: null });
    });
  });

  describe('being created', () => {
    it('answers "being created" while another claim is fresh', async () => {
      db.getGameById.mockResolvedValue(finishedGame({
        next_room_claimed_by: 'p2',
        next_room_claimed_at: new Date(Date.now() - 5_000).toISOString(),
      }));
      const { status, body } = await press();
      expect(status).toBe(202);
      expect(body.data).toEqual({ status: 'being_created', room_code: null });
      expect(db.getPlayerCurrentRoom).not.toHaveBeenCalled();
      expect(db.claimNextRoom).not.toHaveBeenCalled();
    });

    it('answers "being created" when another player wins the claim', async () => {
      db.claimNextRoom.mockResolvedValue(false);
      const { status, body } = await press();
      expect(status).toBe(202);
      expect(body.data.status).toBe('being_created');
      expect(db.createRoomForPlayer).not.toHaveBeenCalled();
      expect(db.releaseNextRoomClaim).not.toHaveBeenCalled();
    });
  });

  describe('claimed', () => {
    it("creates the room with the finished room's settings and links it", async () => {
      const { status, body } = await press();
      expect(status).toBe(201);
      expect(body.data).toEqual({ status: 'created', room_code: 'NEWNEW' });

      const claimedAt = db.claimNextRoom.mock.calls[0][3];
      expect(db.claimNextRoom).toHaveBeenCalledWith(expect.anything(), 'game-1', PLAYER, claimedAt);
      expect(db.createRoomForPlayer).toHaveBeenCalledWith(expect.anything(), PLAYER, {
        expected_players: 7,
        // The public options only: no hidden assignment from the last game
        role_config: { merlin: true, percival: true, merlin_decoy_enabled: true },
        intro_phase_enabled: true,
        agent_count: 2,
        ai_review_enabled: true,
        ai_review_mode: 'god',
      });
      expect(db.linkNextRoom).toHaveBeenCalledWith(expect.anything(), 'game-1', 'room-new', PLAYER, claimedAt);
      expect(db.releaseNextRoomClaim).not.toHaveBeenCalled();
      expect(db.updateRoomStatus).not.toHaveBeenCalled();
    });

    it('takes over a claim older than 30 seconds', async () => {
      db.getGameById.mockResolvedValue(finishedGame({
        next_room_claimed_by: 'p2',
        next_room_claimed_at: new Date(Date.now() - 40_000).toISOString(),
      }));
      const { status } = await press();
      expect(status).toBe(201);
      expect(db.claimNextRoom).toHaveBeenCalled();
    });
  });

  describe('claim released on failure', () => {
    it('releases the claim when creation is refused, with no room to close', async () => {
      db.createRoomForPlayer.mockRejectedValue(
        new ApiError(ERROR_CODES.PLAYER_ALREADY_IN_ROOM, 'Player is already in a room', 409)
      );
      const { status } = await press();
      expect(status).toBe(409);
      const claimedAt = db.claimNextRoom.mock.calls[0][3];
      expect(db.releaseNextRoomClaim).toHaveBeenCalledWith(expect.anything(), 'game-1', PLAYER, claimedAt);
      expect(db.updateRoomStatus).not.toHaveBeenCalled();
    });

    it('closes the created room and releases the claim when linking fails', async () => {
      db.linkNextRoom.mockResolvedValue(false);
      const { status } = await press();
      expect(status).toBe(500);
      expect(db.updateRoomStatus).toHaveBeenCalledWith(expect.anything(), 'room-new', 'closed');
      expect(db.releaseNextRoomClaim).toHaveBeenCalled();
    });

    it("releases the claim when the finished room's setup is unusable", async () => {
      db.findRoomById.mockResolvedValue({ ...finishedRoom, role_config: { percival: true } });
      const { status } = await press();
      expect(status).toBe(500);
      expect(db.createRoomForPlayer).not.toHaveBeenCalled();
      expect(db.releaseNextRoomClaim).toHaveBeenCalled();
    });
  });
});
