/**
 * Rules of a speaking turn that the host's speaking timer applies
 * (src/hooks/useSpeakingTimer.ts).
 *
 * - Every turn is 50 s, a person's or a bot's.
 * - A bot that has finished hands its turn on with a message on
 *   SPEAKER_DONE_TOPIC; the host's browser moves to the next speaker, as if
 *   the host had pressed skip. Only the speaker whose clock is running can.
 *
 * Bots join the voice room as `bot_<name>`; people join under their user id.
 */

export const SPEAKING_SECONDS = 50;
export const SPEAKER_DONE_TOPIC = 'speaker-done';

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
