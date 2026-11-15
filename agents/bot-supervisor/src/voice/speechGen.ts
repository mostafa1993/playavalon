/**
 * Turn-speech generator — what the smart bot SAYS on its speaking slot.
 *
 * One call (speak-turn.yml): the brief (rules, roles, its role and intel), the
 * game so far, and what this turn is (the intro, the leader opening or closing
 * the round, or a player answering the proposed team) → the Persian words it
 * says.
 */

import type { LLMClient } from '@avalon/shared';
import type { SmartView } from '../brains/smartView.js';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { MyTurnInfo } from './voiceLayer.js';
import { seatTable } from '../brains/seats.js';

export async function generateTurnSpeech(
  llm: LLMClient,
  args: {
    identity: Identity;
    observation: Observation;
    smart: SmartView;
    turn: MyTurnInfo;
    /** What this speech is, when it isn't a speaking slot (the assassin discussion). */
    situation?: string;
  }
): Promise<string> {
  const { identity, observation, smart, turn } = args;
  const game = observation.game;
  const nameOf = (id: string) => game?.players.find((p) => p.id === id)?.display_name ?? 'someone';

  const text = await llm.runText('speak-turn.yml', {
    brief: smart.brief(identity, observation),
    seat_table: seatTable(identity, observation),
    game_so_far: await smart.gameSoFar(observation),
    private_read: smart.privateRead(),
    situation: args.situation ?? situation(identity, observation, turn, nameOf),
  });
  return text.trim();
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
