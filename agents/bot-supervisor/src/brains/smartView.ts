/**
 * SmartView — what a smart bot's prompts know of the game beyond its own role:
 * the talk it heard, the game's public history (fetched fresh when a prompt is
 * written, so a restarted bot knows it too), and the public role setup.
 */

import { formatRolesInPlay, readRoleConfig, summarizeRoleConfig } from '@avalon/shared';
import type { ApiClient } from '../engine/ApiClient.js';
import type { Observation } from '../types/Observation.js';
import type { AgentLogger } from '../util/logger.js';
import type { TalkMemory } from '../voice/talkMemory.js';
import { renderGameSoFar } from './gameSoFar.js';

export interface SmartView {
  readonly talk: TalkMemory;
  /** The game so far — history and talk together — for a prompt. */
  gameSoFar(observation: Observation): Promise<string>;
  /** The game's public role setup, one line. */
  rolesInPlay(observation: Observation): string;
}

export function createSmartView(deps: {
  talk: TalkMemory;
  api: Pick<ApiClient, 'getHistory'>;
  meId: string;
  logger: AgentLogger;
}): SmartView {
  return {
    talk: deps.talk,

    async gameSoFar(observation) {
      const game = observation.game;
      let history = null;
      if (game) {
        try {
          history = await deps.api.getHistory(game.game_id);
        } catch (err) {
          deps.logger.warn(`[smart] history unavailable (${(err as Error).message}); the prompt has the talk only`);
        }
      }
      return renderGameSoFar({
        history,
        talk: deps.talk.all(),
        players: game?.players ?? observation.room.players,
        meId: deps.meId,
      });
    },

    rolesInPlay(observation) {
      const playerCount = observation.game?.players.length ?? observation.room.expected_players;
      try {
        return formatRolesInPlay(summarizeRoleConfig(playerCount, readRoleConfig(observation.room.role_config)));
      } catch {
        return '(role setup unavailable)';
      }
    },
  };
}
