/**
 * AgentEngine — the main loop tying everything together.
 *
 *   while alive:
 *     observe ─► decide ─► [jitter] ─► execute
 *
 *   - Polls the API every config.runtime.observation_poll_ms (default 2s).
 *   - Maintains a periodic heartbeat ping so the UI doesn't show the agent
 *     as disconnected.
 *   - Joins the room if the agent isn't a member yet.
 *   - Exits cleanly when the game ends OR on SIGINT/SIGTERM.
 *
 * One AgentEngine per process (= per agent). The plan deliberately avoids
 * multiplexing — see specs/023-rule-based-agents/plan.md §4 for the
 * justification (auth/realtime are global per supabase client).
 */

import type { ResolvedAgentConfig } from '../config/loader.js';
import type { AgentLogger } from '../util/logger.js';
import type { Brain } from '../brains/Brain.js';
import type { Identity } from '../types/Identity.js';
import type { Action } from '../types/Action.js';
import { SessionManager } from './SessionManager.js';
import { ApiClient, ApiError } from './ApiClient.js';
import { Observer } from './Observer.js';
import { ActionExecutor } from './ActionExecutor.js';
import { jitter, randomDelayMs, sleep } from '../util/jitter.js';
import { makeBrain } from '../brains/factory.js';

export interface AgentEngineOptions {
  config: ResolvedAgentConfig;
  roomCode: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  logger: AgentLogger;
  /** Override the Brain. Defaults to whatever factory() makes from config. */
  brain?: Brain;
}

export class AgentEngine {
  private readonly opts: AgentEngineOptions;
  private readonly logger: AgentLogger;
  private session!: SessionManager;
  private api!: ApiClient;
  private observer!: Observer;
  private executor!: ActionExecutor;
  private brain!: Brain;

  private alive = true;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(opts: AgentEngineOptions) {
    this.opts = opts;
    this.logger = opts.logger;
  }

  /** Main entry. Returns when the game ends or a fatal error occurs. */
  async run(): Promise<void> {
    // Signal handlers — graceful shutdown.
    const shutdown = (sig: string) => {
      this.logger.info(`got ${sig}, shutting down`);
      this.alive = false;
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    try {
      await this.bootstrap();
      await this.joinRoomIfNeeded();
      await this.mainLoop();
    } finally {
      await this.cleanup();
    }
  }

  private async bootstrap(): Promise<void> {
    const cfg = this.opts.config;

    this.session = new SessionManager({
      supabaseUrl: this.opts.supabaseUrl,
      supabaseAnonKey: this.opts.supabaseAnonKey,
      email: cfg.email,
      password: cfg.resolved_password,
      logger: this.logger,
    });
    await this.session.signIn();

    this.api = new ApiClient({
      baseUrl: cfg.runtime.base_url,
      session: this.session,
      logger: this.logger,
      maxRetries5xx: cfg.runtime.max_action_retries,
    });

    // Sanity check: confirm the Bearer auth round-trip actually works against
    // this server. Catches misconfigured base_url and auth-fix regressions
    // immediately rather than 60s into a stuck poll loop.
    const me = await this.api.whoAmI();
    if (!me || me.id !== this.session.getUserId()) {
      throw new Error(`whoAmI mismatch — server thinks we're ${me?.id ?? 'nobody'}, session says ${this.session.getUserId()}`);
    }
    this.logger.info('auth round-trip ok', { server_user_id: me.id });

    this.observer = new Observer({
      api: this.api,
      roomCode: this.opts.roomCode,
      userId: this.session.getUserId(),
      username: `bot_${cfg.name}`,
      logger: this.logger,
    });

    this.executor = new ActionExecutor({
      api: this.api,
      roomCode: this.opts.roomCode,
      getGameId: () => this.observer.gameId(),
      logger: this.logger,
    });

    this.brain = this.opts.brain ?? makeBrain(cfg.brain);

    // Heartbeat — fire once immediately + on an interval.
    this.startHeartbeat();
  }

  private async joinRoomIfNeeded(): Promise<void> {
    // We can't know membership until we observe — peek once.
    const obs = await this.observer.fetch();
    if (obs.self.is_in_room) {
      this.logger.info(`already in room ${this.opts.roomCode}`);
      return;
    }
    this.logger.info(`joining room ${this.opts.roomCode}`);
    try {
      await this.api.joinRoom(this.opts.roomCode);
      this.logger.info('joined');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PLAYER_ALREADY_IN_ROOM') {
        // Edge case: we're in a different room. Treat as fatal — manual cleanup needed.
        throw new Error(`agent is already in another room; clean up before retrying. (${err.message})`);
      }
      throw err;
    }
  }

  private async mainLoop(): Promise<void> {
    const pollMs = this.opts.config.runtime.observation_poll_ms;
    const cfg = this.opts.config;
    this.logger.info('main loop started');

    while (this.alive) {
      let obs;
      try {
        obs = await this.observer.fetch();
      } catch (err) {
        this.logger.error('observation failed', err);
        await sleep(pollMs);
        continue;
      }

      // Exit conditions. Game-over takes priority over room-closed because
      // the server closes the room IMMEDIATELY on game-end (e.g., the
      // assassin-guess endpoint sets status='closed'), but the Merlin quiz
      // is still reachable via the games API and we may still need to vote.
      if (obs.game?.phase === 'game_over') {
        const quiz = obs.merlin_quiz;
        const quizDone = !quiz || !quiz.enabled || quiz.complete;
        const myPart = quiz?.has_voted || quiz?.has_skipped;
        const iAmMerlin = this.observer.identity()?.special_role === 'merlin';
        if (quizDone || iAmMerlin || myPart) {
          this.logger.info('game_over: exit conditions met', {
            quiz_enabled: quiz?.enabled ?? false,
            quiz_complete: quiz?.complete ?? null,
            my_part: myPart ?? false,
            i_am_merlin: iAmMerlin,
          });
          await sleep(500);
          return;
        }
        // else: quiz is open and we haven't voted yet — let the loop
        // fall through to brain.decide() (which fires merlin_quiz).
        // Don't return here even if room.status === 'closed'.
      } else if (obs.room.status === 'closed') {
        // Room closed WITHOUT a normal game_over (e.g., manager kicked
        // everyone, or cleanup-cron archived a stale room). Nothing to do.
        this.logger.info('room closed; exiting');
        return;
      }

      // We can only ask the Brain to decide if we have our identity (post-distribution).
      // Pre-distribution there's nothing to decide anyway — just wait.
      const identity = this.observer.identity();
      if (identity) {
        const brainCtx = {
          identity,
          observation: obs,
          options: this.brainOptionsForCtx(),
          rng: Math.random,
          logger: this.logger,
        };
        const action = await this.brain.decide(brainCtx);
        if (action && action.kind !== 'noop') {
          // Human-feel jitter for this action kind.
          const [min, max] = this.timingFor(action.kind, cfg);
          if (min > 0 || max > 0) {
            const delay = randomDelayMs(min, max);
            this.logger.debug(`jitter ${delay}ms before ${action.kind}`);
            await sleep(delay);
            // Re-fetch right before firing — staleness guard.
            // (If the state moved on, the action would 4xx; cheap insurance.)
            try {
              const fresh = await this.observer.fetch();
              if (this.shouldDropAction(action, fresh)) {
                this.logger.debug(`dropping stale ${action.kind} (state moved)`);
                continue;
              }
            } catch {
              // Soft-fail; just try the action.
            }
          }
          await this.executor.execute(action);
          // After acting, loop immediately so the next observation reflects it.
          continue;
        }
      }

      await sleep(pollMs);
    }
  }

  /** Action-kind → timing range from yaml config. */
  private timingFor(kind: Action['kind'], cfg: ResolvedAgentConfig): [number, number] {
    switch (kind) {
      case 'consent_ai': return [200, 1000];  // small, not config-exposed
      case 'confirm_role': return cfg.timing.confirm_role_ms;
      case 'propose': return cfg.timing.propose_team_ms;
      case 'vote': return cfg.timing.vote_ms;
      case 'quest_action': return cfg.timing.quest_action_ms;
      case 'continue': return cfg.timing.continue_ms;
      case 'lady_investigate': return cfg.timing.lady_investigate_ms;
      case 'assassin_guess': return cfg.timing.assassin_guess_ms;
      case 'merlin_quiz': return cfg.timing.merlin_quiz_vote_ms;
      case 'noop': return [0, 0];
    }
  }

  /** Heuristic: would this action be obviously stale given the latest observation? */
  private shouldDropAction(action: Action, fresh: Awaited<ReturnType<Observer['fetch']>>): boolean {
    if (action.kind === 'confirm_role' && fresh.room.is_confirmed) return true;
    if (action.kind === 'consent_ai' && fresh.room.ai_consent_given) return true;
    if (action.kind === 'propose' && fresh.game?.phase !== 'team_building') return true;
    if (action.kind === 'propose' && fresh.game && !fresh.self.is_leader) return true;
    if (action.kind === 'vote' && (fresh.game?.phase !== 'voting' || fresh.game.has_voted)) return true;
    if (action.kind === 'quest_action') {
      if (fresh.game?.phase !== 'quest') return true;
      if (!fresh.game.am_team_member) return true;
      if (fresh.game.has_submitted_action) return true;
    }
    if (action.kind === 'continue' && fresh.game?.phase !== 'quest_result') return true;
    if (action.kind === 'lady_investigate' &&
        (fresh.game?.phase !== 'lady_of_lake' || !fresh.game.lady_of_lake?.can_investigate)) return true;
    if (action.kind === 'assassin_guess' &&
        (fresh.game?.phase !== 'assassin' || !fresh.game.assassin_phase?.can_guess)) return true;
    if (action.kind === 'merlin_quiz' &&
        (fresh.merlin_quiz?.has_voted || fresh.merlin_quiz?.has_skipped || fresh.merlin_quiz?.complete || !fresh.merlin_quiz?.enabled)) return true;
    return false;
  }

  private brainOptionsForCtx(): Record<string, unknown> {
    const b = this.opts.config.brain;
    if (b.type === 'rule') return b.options as Record<string, unknown>;
    return {};
  }

  private startHeartbeat(): void {
    const tick = () => {
      this.api.heartbeat().catch((err) => this.logger.debug('heartbeat failed', { error: (err as Error).message }));
    };
    tick();
    this.heartbeatTimer = setInterval(tick, this.opts.config.runtime.heartbeat_interval_ms);
  }

  private async cleanup(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.session) this.session.stop();
    this.logger.info('clean exit');
  }
}

// keep TS happy about the unused import warning if Identity isn't referenced
export type { Identity };
