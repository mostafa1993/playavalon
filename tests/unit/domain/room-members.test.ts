import { describe, it, expect } from 'vitest';
import { countHumans, longestPresentHuman, type RoomMember } from '@/lib/domain/room-members';

const human = (player_id: string, joined_at: string): RoomMember => ({ player_id, joined_at, is_bot: false });
const bot = (player_id: string, joined_at: string): RoomMember => ({ player_id, joined_at, is_bot: true });

describe('countHumans', () => {
  it('counts only the humans among members', () => {
    expect(countHumans([
      human('h1', '2026-11-13T10:00:00Z'),
      bot('b1', '2026-11-13T10:00:01Z'),
      bot('b2', '2026-11-13T10:00:02Z'),
      human('h2', '2026-11-13T10:00:03Z'),
    ])).toBe(2);
  });

  it('is 0 when only bots are left', () => {
    expect(countHumans([bot('b1', '2026-11-13T10:00:00Z'), bot('b2', '2026-11-13T10:00:01Z')])).toBe(0);
  });

  it('is 0 for an empty room', () => {
    expect(countHumans([])).toBe(0);
  });
});

describe('longestPresentHuman', () => {
  it('picks the human who joined first', () => {
    expect(longestPresentHuman([
      human('later', '2026-11-13T10:05:00Z'),
      human('first', '2026-11-13T10:01:00Z'),
      human('middle', '2026-11-13T10:03:00Z'),
    ])).toBe('first');
  });

  it('skips a bot that joined before every human', () => {
    expect(longestPresentHuman([
      bot('bot', '2026-11-13T09:00:00Z'),
      human('human', '2026-11-13T10:00:00Z'),
    ])).toBe('human');
  });

  it('is null when only bots are left', () => {
    expect(longestPresentHuman([bot('b1', '2026-11-13T09:00:00Z')])).toBeNull();
  });

  it('is null for an empty room', () => {
    expect(longestPresentHuman([])).toBeNull();
  });
});
