/**
 * The seat table every smart-bot prompt gets: each player by seat, marking
 * the leader, the bot itself and the proposed team. Before the game (the intro
 * round) the room's players by name.
 */

import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';

export function seatTable(identity: Identity, observation: Observation): string {
  const game = observation.game;
  if (!game || game.players.length === 0) {
    return observation.room.players.map((p) => p.display_name).join(', ');
  }
  return [...game.players]
    .sort((a, b) => a.seat_position - b.seat_position)
    .map((p) => {
      const tags = [
        p.is_leader ? 'leader' : '',
        p.id === identity.user_id ? 'you' : '',
        p.is_on_team ? 'on the proposed team' : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `seat ${p.seat_position}: ${p.display_name}${tags ? ` (${tags})` : ''}`;
    })
    .join('\n');
}
