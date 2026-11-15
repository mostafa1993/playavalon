import { describe, expect, it } from 'vitest';
import { acceptsHandOn } from '@/lib/domain/speaking-turn';

describe('speaking turns', () => {
  it('only the speaker whose clock is running can hand the turn on', () => {
    const state = { timerRunning: true, speakingOrder: ['lead', 'bot_alice', 'p3', 'lead'], currentSpeakerIndex: 1 };
    expect(acceptsHandOn(state, 'bot_alice')).toBe(true);
    expect(acceptsHandOn(state, 'p3')).toBe(false);
    expect(acceptsHandOn(state, null)).toBe(false);
    expect(acceptsHandOn({ ...state, timerRunning: false }, 'bot_alice')).toBe(false);
    expect(acceptsHandOn({ ...state, currentSpeakerIndex: 4 }, 'bot_alice')).toBe(false);
  });
});
