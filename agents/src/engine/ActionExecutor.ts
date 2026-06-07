/**
 * ActionExecutor — dispatches Action objects to the right ApiClient method.
 *
 * Responsibilities:
 *   - Translate `{kind: 'confirm_role'}` etc. into the actual HTTP call.
 *   - Treat expected 4xx (already-confirmed, wrong-phase, intro-in-progress)
 *     as non-errors — the Brain re-decides next tick.
 *   - Treat unexpected errors as soft failures: log + skip + continue.
 *
 * P0 only handles: consent_ai, confirm_role. Later phases add cases as
 * their action kinds become live.
 */

import type { ApiClient } from './ApiClient.js';
import { ApiError } from './ApiClient.js';
import type { Action } from '../types/Action.js';
import type { AgentLogger } from '../util/logger.js';

const EXPECTED_4XX_CODES = new Set([
  'ALREADY_CONFIRMED',
  'INTRO_IN_PROGRESS',
  'INVALID_PHASE',
  'NOT_LEADER',
  'PLAYER_ALREADY_IN_ROOM',
  'NOT_ROOM_MEMBER',  // can briefly happen during reconnect; ok to retry
]);

export interface ActionExecutorOptions {
  api: ApiClient;
  roomCode: string;
  /** Provider for the current gameId (set by Observer after game starts).
   *  Lazy because the game doesn't exist when the executor is constructed. */
  getGameId: () => string | null;
  logger: AgentLogger;
}

export class ActionExecutor {
  private readonly opts: ActionExecutorOptions;

  constructor(opts: ActionExecutorOptions) {
    this.opts = opts;
  }

  /** Execute an action. Returns true on success, false on expected/handled failure. */
  async execute(action: Action): Promise<boolean> {
    if (action.kind === 'noop') return true;
    try {
      this.opts.logger.info(`-> ${action.kind}`, this.describeAction(action));
      switch (action.kind) {
        case 'consent_ai':
          await this.opts.api.sendAiConsent(this.opts.roomCode);
          return true;
        case 'confirm_role':
          await this.opts.api.confirmRole(this.opts.roomCode);
          return true;
        case 'propose': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.proposeTeam(gameId, action.team);
          return true;
        }
        case 'vote': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.submitVote(gameId, action.choice);
          return true;
        }
        case 'quest_action': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.submitQuestAction(gameId, action.choice);
          return true;
        }
        case 'continue': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.continueQuest(gameId);
          return true;
        }
        case 'lady_investigate': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.ladyInvestigate(gameId, action.target_id);
          return true;
        }
        case 'assassin_guess': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.assassinGuess(gameId, action.target_id);
          return true;
        }
        case 'merlin_quiz': {
          const gameId = this.requireGameId(action.kind);
          await this.opts.api.submitMerlinQuiz(gameId, action.target_id);
          return true;
        }
      }
    } catch (err) {
      if (err instanceof ApiError && EXPECTED_4XX_CODES.has(err.code)) {
        this.opts.logger.debug(`expected ${err.code} on ${action.kind}; will re-evaluate next tick`);
        return false;
      }
      this.opts.logger.error(`unexpected error on ${action.kind}`, err);
      return false;
    }
  }

  private requireGameId(actionKind: string): string {
    const id = this.opts.getGameId();
    if (!id) throw new Error(`cannot execute ${actionKind}: gameId not yet known`);
    return id;
  }

  private describeAction(action: Action): Record<string, unknown> {
    if (action.kind === 'propose') return { team_size: action.team.length };
    if (action.kind === 'vote') return { choice: action.choice };
    if (action.kind === 'quest_action') return { choice: action.choice };
    if (action.kind === 'lady_investigate') return { target_id: action.target_id };
    if (action.kind === 'assassin_guess') return { target_id: action.target_id };
    if (action.kind === 'merlin_quiz') return { target_id: action.target_id };
    return {};
  }
}
