/**
 * Turn-speech generator — what the smart bot SAYS on its speaking slot.
 *
 * One LLM call: identity + intel + game state + the game so far (history and
 * talk) → a Persian statement that plays to win for the bot's side. The prompt
 * is speak-turn.yml.
 */

import type { LLMClient } from '@avalon/shared';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { SmartView } from '../brains/smartView.js';

export async function generateTurnSpeech(
  llm: LLMClient,
  args: {
    identity: Identity;
    observation: Observation;
    smart: SmartView;
  }
): Promise<string> {
  const { identity, observation, smart } = args;
  const game = observation.game;

  const intel =
    identity.role_intel.known_players.length > 0
      ? `${identity.role_intel.known_players_label}: ${identity.role_intel.known_players.join(', ')}`
      : '(no special intel)';

  const seats = game
    ? [...game.players]
        .sort((a, b) => a.seat_position - b.seat_position)
        .map((p) => {
          const tags = [
            p.is_leader ? 'leader' : '',
            p.id === identity.user_id ? 'ME' : '',
            p.is_on_team ? 'on-team' : '',
          ]
            .filter(Boolean)
            .join(', ');
          return `seat ${p.seat_position}: ${p.display_name}${tags ? ` (${tags})` : ''}`;
        })
        .join('\n')
    : '(game not started yet — this is the intro round)';

  const proposal = game?.current_proposal
    ? game.current_proposal.team_member_ids
        .map((id) => game.players.find((p) => p.id === id)?.display_name ?? id)
        .join(', ')
    : '(no team proposed right now)';

  const text = await llm.runText('speak-turn.yml', {
    my_name: identity.display_name,
    my_role: identity.role,
    my_special_role: identity.special_role,
    my_intel: intel,
    seat_table: seats,
    quest_number: game?.current_quest ?? 0,
    vote_track: game?.vote_track ?? 0,
    proposed_team: proposal,
    roles_in_play: smart.rolesInPlay(observation),
    game_so_far: await smart.gameSoFar(observation),
  });
  return text.trim();
}
