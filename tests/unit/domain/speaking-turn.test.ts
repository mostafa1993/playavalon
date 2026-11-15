import { describe, expect, it } from 'vitest';
import {
  acceptsHandOn,
  BOT_SPEAKING_SECONDS,
  isBotIdentity,
  SPEAKING_SECONDS,
  speakingSeconds,
} from '@/lib/domain/speaking-turn';

describe('speaking turns', () => {
  it('a bot speaks for 60 s, a person for 50', () => {
    expect(BOT_SPEAKING_SECONDS).toBe(60);
    expect(speakingSeconds('bot_alice')).toBe(60);
    expect(speakingSeconds('3641a6f2-7084-4cf7-aab1-709b151462e4')).toBe(SPEAKING_SECONDS);
    expect(speakingSeconds(null)).toBe(SPEAKING_SECONDS);
    expect(isBotIdentity('db-bot_x')).toBe(false);
  });

  it('only the speaker whose clock is running can hand the turn on', () => {
    const state = { timerRunning: true, speakingOrder: ['lead', 'bot_alice', 'p3', 'lead'], currentSpeakerIndex: 1 };
    expect(acceptsHandOn(state, 'bot_alice')).toBe(true);
    expect(acceptsHandOn(state, 'p3')).toBe(false);
    expect(acceptsHandOn(state, null)).toBe(false);
    expect(acceptsHandOn({ ...state, timerRunning: false }, 'bot_alice')).toBe(false);
    expect(acceptsHandOn({ ...state, currentSpeakerIndex: 4 }, 'bot_alice')).toBe(false);
  });
});
