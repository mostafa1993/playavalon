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

export async function generateTurnSpeech(
  llm: LLMClient,
  args: {
    identity: Identity;
    observation: Observation;
    smart: SmartView;
    turn: MyTurnInfo;
  }
): Promise<string> {
  const { identity, observation, smart, turn } = args;
  const game = observation.game;
  const nameOf = (id: string) => game?.players.find((p) => p.id === id)?.display_name ?? 'someone';

  const seats = game
    ? [...game.players]
        .sort((a, b) => a.seat_position - b.seat_position)
        .map((p) => {
          const tags = [p.is_leader ? 'leader' : '', p.id === identity.user_id ? 'you' : ''].filter(Boolean).join(', ');
          return `seat ${p.seat_position}: ${p.display_name}${tags ? ` (${tags})` : ''}`;
        })
        .join('\n')
    : observation.room.players.map((p) => p.display_name).join(', ');

  const text = await llm.runText('speak-turn.yml', {
    brief: smart.brief(identity, observation),
    seat_table: seats,
    game_so_far: await smart.gameSoFar(observation),
    situation: situation(identity, observation, turn, nameOf),
  });
  return text.trim();
}

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
