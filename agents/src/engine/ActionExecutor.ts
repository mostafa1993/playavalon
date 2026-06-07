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
      this.opts.logger.info(`-> ${action.kind}`);
      switch (action.kind) {
        case 'consent_ai':
          await this.opts.api.sendAiConsent(this.opts.roomCode);
          return true;
        case 'confirm_role':
          await this.opts.api.confirmRole(this.opts.roomCode);
          return true;
        // P1+ cases would go here.
        case 'propose':
        case 'vote':
        case 'quest_action':
        case 'continue':
        case 'lady_investigate':
        case 'assassin_guess':
        case 'merlin_quiz':
          this.opts.logger.warn(`action kind ${action.kind} not implemented in P0`);
          return true;
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
}
