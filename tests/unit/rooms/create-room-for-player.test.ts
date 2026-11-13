/**
 * Unit tests for room creation (src/lib/rooms/create-room-for-player.ts),
 * with the database calls stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@/lib/utils/errors';
import { ERROR_CODES } from '@/lib/utils/constants';
import type { Room } from '@/types/database';

const db = vi.hoisted(() => ({
  cleanupPlayerStartedRooms: vi.fn(),
  getPlayerCurrentRoom: vi.fn(),
  createRoom: vi.fn(),
  addPlayerToRoom: vi.fn(),
  updateRoomStatus: vi.fn(),
}));

vi.mock('@/lib/supabase/players', () => ({
  cleanupPlayerStartedRooms: db.cleanupPlayerStartedRooms,
  getPlayerCurrentRoom: db.getPlayerCurrentRoom,
}));

vi.mock('@/lib/supabase/rooms', () => ({
  createRoom: db.createRoom,
  addPlayerToRoom: db.addPlayerToRoom,
  updateRoomStatus: db.updateRoomStatus,
}));

import {
  createRoomForPlayer,
  validateRoomSettings,
  type RoomSettings,
} from '@/lib/rooms/create-room-for-player';

const settings: RoomSettings = {
  expected_players: 7,
  role_config: { merlin: true, percival: true, ladyOfLake: true },
  intro_phase_enabled: true,
  agent_count: 2,
  ai_review_enabled: true,
  ai_review_mode: 'god',
};

/** A client whose room-code lookups find `counts` rooms, in turn */
function clientFindingCodes(counts: number[]): SupabaseClient {
  const queue = [...counts];
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ count: queue.shift() ?? 0, error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('validateRoomSettings', () => {
  it('accepts valid settings', () => {
    expect(validateRoomSettings(settings)).toBeNull();
  });

  it('refuses a player count outside 5-10', () => {
    for (const expected_players of [4, 11, 6.5]) {
      const error = validateRoomSettings({ ...settings, expected_players, agent_count: 0 });
      expect(error?.code).toBe(ERROR_CODES.INVALID_PLAYER_COUNT);
      expect(error?.status).toBe(400);
    }
  });

  it('refuses a role setup the player count does not allow', () => {
    const error = validateRoomSettings({
      ...settings,
      expected_players: 5,
      role_config: { merlin: true, lunatic: true },
      agent_count: 0,
    });
    expect(error?.code).toBe(ERROR_CODES.INVALID_ROLE_CONFIG);
    expect(error?.status).toBe(400);
  });

  it('refuses a role setup that needs Merlin without him', () => {
    const error = validateRoomSettings({ ...settings, role_config: { merlin: false, percival: true } });
    expect(error?.code).toBe(ERROR_CODES.INVALID_ROLE_CONFIG);
  });

  it('keeps at least one human seat', () => {
    expect(validateRoomSettings({ ...settings, agent_count: 6 })).toBeNull();
    const error = validateRoomSettings({ ...settings, agent_count: 7 });
    expect(error?.code).toBe(ERROR_CODES.INVALID_AGENT_COUNT);
    expect(error?.message).toContain('at least one human seat');
  });

  it('refuses a negative or fractional bot count', () => {
    for (const agent_count of [-1, 1.5, Number.NaN]) {
      expect(validateRoomSettings({ ...settings, agent_count })?.code).toBe(ERROR_CODES.INVALID_AGENT_COUNT);
    }
  });
});

describe('createRoomForPlayer', () => {
  const room = { id: 'room-1', code: 'ABCDEF' } as Room;

  beforeEach(() => {
    vi.clearAllMocks();
    db.cleanupPlayerStartedRooms.mockResolvedValue(0);
    db.getPlayerCurrentRoom.mockResolvedValue(null);
    db.createRoom.mockResolvedValue(room);
    db.addPlayerToRoom.mockResolvedValue({});
    db.updateRoomStatus.mockResolvedValue({});
  });

  it('refuses invalid settings before touching the database', async () => {
    const error = await createRoomForPlayer(clientFindingCodes([0]), 'p1', { ...settings, agent_count: 7 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(db.cleanupPlayerStartedRooms).not.toHaveBeenCalled();
    expect(db.createRoom).not.toHaveBeenCalled();
  });

  it('refuses a player already in a waiting or dealt room, after clearing finished memberships', async () => {
    db.getPlayerCurrentRoom.mockResolvedValue({ room_id: 'r', room_code: 'XYZXYZ', status: 'waiting' });
    const error = await createRoomForPlayer(clientFindingCodes([0]), 'p1', settings).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(ERROR_CODES.PLAYER_ALREADY_IN_ROOM);
    expect(error.status).toBe(409);
    expect(db.cleanupPlayerStartedRooms).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(db.createRoom).not.toHaveBeenCalled();
  });

  it('creates the room with every setting, the player as manager and first member', async () => {
    const created = await createRoomForPlayer(clientFindingCodes([0]), 'p1', settings);
    expect(created).toBe(room);
    expect(db.createRoom).toHaveBeenCalledWith(expect.anything(), {
      code: expect.stringMatching(/^[A-Z0-9]{6}$/),
      manager_id: 'p1',
      expected_players: 7,
      status: 'waiting',
      role_config: settings.role_config,
      lady_of_lake_enabled: true,
      intro_phase_enabled: true,
      agent_count: 2,
      ai_review_enabled: true,
      ai_review_mode: 'god',
    });
    expect(db.addPlayerToRoom).toHaveBeenCalledWith(expect.anything(), 'room-1', 'p1');
  });

  it('draws another code while the drawn one is taken', async () => {
    await createRoomForPlayer(clientFindingCodes([1, 1, 0]), 'p1', settings);
    expect(db.createRoom).toHaveBeenCalledTimes(1);
  });

  it('gives up after ten taken codes', async () => {
    const error = await createRoomForPlayer(clientFindingCodes(Array(10).fill(1)), 'p1', settings)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(db.createRoom).not.toHaveBeenCalled();
  });

  it('closes the room if adding its creator fails', async () => {
    const failure = new Error('insert failed');
    db.addPlayerToRoom.mockRejectedValue(failure);
    await expect(createRoomForPlayer(clientFindingCodes([0]), 'p1', settings)).rejects.toBe(failure);
    expect(db.updateRoomStatus).toHaveBeenCalledWith(expect.anything(), 'room-1', 'closed');
  });
});
