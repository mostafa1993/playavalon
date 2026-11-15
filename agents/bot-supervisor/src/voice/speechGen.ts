/**
 * Turn-speech generator — what the smart bot SAYS on its speaking slot.
 *
 * speak-turn.yml: the brief (rules, roles, its role and intel), the game so
 * far, the private read, and what this turn is (the intro, the leader opening
 * or closing the round, or a player answering the proposed team) → the Persian
 * words. Written ahead as a draft (Hydrogen HIGH); when the slot opens, the
 * draft is brought up to date with what was said since (speak-update.yml,
 * streamed), or, with no draft, the words are written then (streamed, on
 * Hydrogen LOW). Plan 2026-11-15-2100, D3.
 */

import type { LLMClient, ModelOverride, PromptVars } from '@avalon/shared';
import { sentenceStream } from './streams.js';
import type { TalkTurn } from './talkMemory.js';
import type { SmartView } from '../brains/smartView.js';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { MyTurnInfo } from './voiceLayer.js';
import { seatTable } from '../brains/seats.js';

export interface SpeechArgs {
  identity: Identity;
  observation: Observation;
  smart: SmartView;
  turn: MyTurnInfo;
  /** What this speech is, when it isn't a speaking slot (the assassin discussion). */
  situation?: string;
}

async function speechVars(args: SpeechArgs): Promise<PromptVars> {
  const { identity, observation, smart, turn } = args;
  const nameOf = (id: string) => observation.game?.players.find((p) => p.id === id)?.display_name ?? 'someone';
  return {
    brief: smart.brief(identity, observation),
    seat_table: seatTable(identity, observation),
    game_so_far: await smart.gameSoFar(observation),
    private_read: smart.privateRead(),
    situation: args.situation ?? situation(identity, observation, turn, nameOf),
  };
}

/** The words, written whole (a draft, ahead of the slot). */
export async function generateTurnSpeech(llm: LLMClient, args: SpeechArgs & { override?: ModelOverride }): Promise<string> {
  const text = await llm.runText('speak-turn.yml', await speechVars(args), args.override);
  return text.trim();
}

/** The words written now, streamed sentence by sentence (no draft to start from). */
export async function* streamTurnSpeech(
  llm: LLMClient,
  args: SpeechArgs & { override: ModelOverride },
  signal: AbortSignal
): AsyncGenerator<string> {
  const vars = await speechVars(args);
  yield* sentenceStream(llm.streamText('speak-turn.yml', vars, args.override, signal));
}

/** The draft brought up to date with what is new since it was written, streamed sentence by sentence. */
export async function* streamUpdatedSpeech(
  llm: LLMClient,
  args: SpeechArgs & { draft: string; newSince: string },
  signal: AbortSignal
): AsyncGenerator<string> {
  const vars = { ...(await speechVars(args)), draft: args.draft, new_since: args.newSince };
  yield* sentenceStream(llm.streamText('speak-update.yml', vars, undefined, signal));
}

/** What is new since a draft: the turns heard since, and the team if it changed. */
export function renderNewSince(turns: readonly TalkTurn[], teamNow: string | null, teamChanged: boolean): string {
  const lines = turns.map((t) => `${t.speaker}: ${t.text}`);
  if (teamChanged) lines.push(teamNow ? `The team proposed now: [${teamNow}].` : 'The team proposed before has been voted on; no team is proposed now.');
  return lines.length ? lines.join('\n') : 'Nothing said since.';
}

/** The assassin-phase discussion, for an evil bot. */
export const DISCUSSION_SITUATION =
  'Good has won three quests: this is the assassin discussion. The good players are muted; you and ' +
  'your evil teammates talk freely for two minutes about who Merlin is, and the Assassin then names ' +
  'one player. Say who you think Merlin is and why, from how they played (votes, teams, what they ' +
  'said). If you are the Assassin, give your leading suspect and ask your teammates what they think.';

/** What this speaking turn is, in a sentence or two for the prompt. */
export function situation(
  identity: Identity,
  observation: Observation,
  turn: MyTurnInfo,
  nameOf: (id: string) => string
): string {
  const game = observation.game;
  if (turn.quest === 0 || !game) {
    return 'This is the intro round, before quest 1: say hello and introduce yourself to the table in a few friendly words. Nothing about roles yet.';
  }
  const proposal = game.current_proposal;
  const team = proposal ? proposal.team_member_ids.map(nameOf).join(', ') : null;
  const where = `Quest ${game.current_quest}, vote track ${game.vote_track}/5.`;
  const iLead = game.current_leader_id === identity.user_id;
  if (!team) {
    return `${where} ${iLead ? 'You are' : `${nameOf(game.current_leader_id)} is`} the leader and no team is proposed yet. Say who you think should go and why.`;
  }
  if (iLead && turn.turnIndex === 0) {
    return `${where} You are the leader and speak first: present your team [${team}] and why you chose it.`;
  }
  if (iLead) {
    return `${where} You are the leader and speak last, closing the round on your team [${team}]: answer what was said about it, then ask for the votes.`;
  }
  return `${where} ${nameOf(game.current_leader_id)} (leader) proposed [${team}]. It is your turn to speak about it: what you make of it, and how you will vote.`;
}
