/**
 * Unit tests for POST /api/rooms/[code]/leave, with the database calls
 * stubbed: a room no human is left in is closed, never deleted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Room } from '@/types/database';
import type { RoomMember } from '@/lib/domain/room-members';

const db = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  findRoomByCode: vi.fn(),
  removePlayerFromRoom: vi.fn(),
  isPlayerInRoom: vi.fn(),
  getRoomMembers: vi.fn(),
  transferManager: vi.fn(),
  updateRoomStatus: vi.fn(),
  deleteRoles: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: db.getCurrentUser,
  createServiceClient: () => ({
    from: () => ({ delete: () => ({ eq: db.deleteRoles }) }),
  }),
}));

vi.mock('@/lib/supabase/rooms', () => ({
  findRoomByCode: db.findRoomByCode,
  removePlayerFromRoom: db.removePlayerFromRoom,
  isPlayerInRoom: db.isPlayerInRoom,
  getRoomMembers: db.getRoomMembers,
  transferManager: db.transferManager,
  updateRoomStatus: db.updateRoomStatus,
}));

import { POST } from '@/app/api/rooms/[code]/leave/route';

const CODE = 'ABCDEF';
const room = (status: Room['status'], manager_id = 'leaver') =>
  ({ id: 'room-1', code: CODE, status, manager_id }) as Room;
const bot = (id: string): RoomMember => ({ player_id: id, joined_at: '2026-11-13T10:00:00Z', is_bot: true });
const human = (id: string): RoomMember => ({ player_id: id, joined_at: '2026-11-13T10:01:00Z', is_bot: false });

async function leave() {
  const response = await POST(new Request(`http://test/api/rooms/${CODE}/leave`, { method: 'POST' }), {
    params: Promise.resolve({ code: CODE }),
  });
  return response.status;
}

describe('POST /api/rooms/[code]/leave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getCurrentUser.mockResolvedValue({ id: 'leaver' });
    db.isPlayerInRoom.mockResolvedValue(true);
    db.removePlayerFromRoom.mockResolvedValue(undefined);
    db.updateRoomStatus.mockResolvedValue({});
    db.transferManager.mockResolvedValue('h2');
    db.deleteRoles.mockResolvedValue({ error: null });
  });

  it('closes a waiting room left with only bots', async () => {
    db.findRoomByCode.mockResolvedValue(room('waiting'));
    db.getRoomMembers.mockResolvedValue([bot('b1'), bot('b2')]);
    expect(await leave()).toBe(200);
    expect(db.updateRoomStatus).toHaveBeenCalledWith(expect.anything(), 'room-1', 'closed');
    expect(db.transferManager).not.toHaveBeenCalled();
  });

  it('closes a room left by its only member', async () => {
    db.findRoomByCode.mockResolvedValue(room('waiting'));
    db.getRoomMembers.mockResolvedValue([]);
    expect(await leave()).toBe(200);
    expect(db.updateRoomStatus).toHaveBeenCalledWith(expect.anything(), 'room-1', 'closed');
  });

  it('closes a dealt room left with only bots, without rolling it back', async () => {
    db.findRoomByCode.mockResolvedValue(room('roles_distributed'));
    db.getRoomMembers.mockResolvedValue([bot('b1')]);
    expect(await leave()).toBe(200);
    expect(db.updateRoomStatus).toHaveBeenCalledTimes(1);
    expect(db.updateRoomStatus).toHaveBeenCalledWith(expect.anything(), 'room-1', 'closed');
    expect(db.deleteRoles).not.toHaveBeenCalled();
  });

  it('leaves a closed room closed', async () => {
    db.findRoomByCode.mockResolvedValue(room('closed'));
    db.getRoomMembers.mockResolvedValue([bot('b1')]);
    expect(await leave()).toBe(200);
    expect(db.updateRoomStatus).not.toHaveBeenCalled();
  });

  it('passes the manager role on when a human is left', async () => {
    db.findRoomByCode.mockResolvedValue(room('waiting'));
    db.getRoomMembers.mockResolvedValue([bot('b1'), human('h2')]);
    expect(await leave()).toBe(200);
    expect(db.transferManager).toHaveBeenCalledWith(expect.anything(), 'room-1');
    expect(db.updateRoomStatus).not.toHaveBeenCalled();
  });

  it('keeps the manager when someone else leaves', async () => {
    db.getCurrentUser.mockResolvedValue({ id: 'h3' });
    db.findRoomByCode.mockResolvedValue(room('waiting', 'h2'));
    db.getRoomMembers.mockResolvedValue([human('h2')]);
    expect(await leave()).toBe(200);
    expect(db.transferManager).not.toHaveBeenCalled();
  });

  it('rolls a dealt room back to waiting when humans are left', async () => {
    db.findRoomByCode.mockResolvedValue(room('roles_distributed', 'h2'));
    db.getCurrentUser.mockResolvedValue({ id: 'h3' });
    db.getRoomMembers.mockResolvedValue([human('h2')]);
    expect(await leave()).toBe(200);
    expect(db.deleteRoles).toHaveBeenCalledWith('room_id', 'room-1');
    expect(db.updateRoomStatus).toHaveBeenCalledWith(expect.anything(), 'room-1', 'waiting');
  });
});
