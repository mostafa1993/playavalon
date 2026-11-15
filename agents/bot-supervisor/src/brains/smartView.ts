/**
 * SmartView — what a smart bot's prompts know of the game beyond its own role:
 * the talk it heard, the game's public history (fetched fresh when a prompt is
 * written, so a restarted bot knows it too), and the brief every prompt opens
 * with (the rules, the roles of this game, its own role and intel).
 */

import type { ApiClient } from '../engine/ApiClient.js';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { AgentLogger } from '../util/logger.js';
import type { TalkMemory } from '../voice/talkMemory.js';
import { renderGameSoFar } from './gameSoFar.js';
import { renderBrief } from './rules.js';

export interface SmartView {
  readonly talk: TalkMemory;
  /** The game so far — history and talk together — for a prompt. */
  gameSoFar(observation: Observation): Promise<string>;
  /** Who the bot is, the rules and roles of this game, its role and intel. */
  brief(identity: Identity, observation: Observation): string;
  /** The bot's latest private read of the table, rendered (privateRead.ts). */
  privateRead(): string;
}

export function createSmartView(deps: {
  talk: TalkMemory;
  api: Pick<ApiClient, 'getHistory'>;
  meId: string;
  logger: AgentLogger;
  /** The latest private read, rendered; the engine's ReadKeeper. */
  privateRead: () => string;
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
        discussion: deps.talk.discussion(),
        players: game?.players ?? observation.room.players,
        meId: deps.meId,
      });
    },

    privateRead: deps.privateRead,

    brief(identity, observation) {
      const playerCount = observation.game?.players.length ?? observation.room.expected_players;
      return renderBrief(identity, observation.room.role_config, playerCount);
    },
  };
}
