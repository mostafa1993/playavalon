/**
 * Rules of a speaking turn that the host's speaking timer applies
 * (src/hooks/useSpeakingTimer.ts).
 *
 * - A person's turn is 50 s; a bot's is 60: it takes up to 10 s to catch up
 *   on the speaker before it, then says its piece (plan 2026-11-15-2100, D2).
 * - A bot that has finished hands its turn on with a message on
 *   SPEAKER_DONE_TOPIC; the host's browser moves to the next speaker, as if
 *   the host had pressed skip. Only the speaker whose clock is running can.
 *
 * Bots join the voice room as `bot_<name>`; people join under their user id.
 */

export const SPEAKING_SECONDS = 50;
export const BOT_SPEAKING_SECONDS = 60;
export const SPEAKER_DONE_TOPIC = 'speaker-done';

export function isBotIdentity(identity: string | null | undefined): boolean {
  return typeof identity === 'string' && identity.startsWith('bot_');
}

/** How long the speaker with this voice-room identity may talk. */
export function speakingSeconds(identity: string | null | undefined): number {
  return isBotIdentity(identity) ? BOT_SPEAKING_SECONDS : SPEAKING_SECONDS;
}

/** Whether a "done" from this participant ends the turn now running. */
export function acceptsHandOn(
  state: { timerRunning: boolean; speakingOrder: string[]; currentSpeakerIndex: number },
  senderIdentity: string | null | undefined
): boolean {
  return (
    state.timerRunning &&
    !!senderIdentity &&
    state.speakingOrder[state.currentSpeakerIndex] === senderIdentity
  );
}
