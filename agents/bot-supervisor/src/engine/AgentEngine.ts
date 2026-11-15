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
import type { Observation } from '../types/Observation.js';
import { SessionManager } from './SessionManager.js';
import { ApiClient, ApiError } from './ApiClient.js';
import { Observer } from './Observer.js';
import { ActionExecutor } from './ActionExecutor.js';
import { jitter, randomDelayMs, sleep } from '../util/jitter.js';
import { makeBrain } from '../brains/factory.js';
import { TalkMemory } from '../voice/talkMemory.js';
import { VoiceLayer, sentences, turnKey, type MyTurnInfo } from '../voice/voiceLayer.js';
import { DISCUSSION_SITUATION, generateTurnSpeech } from '../voice/speechGen.js';
import { createBotLLM } from '../llm/client.js';
import { createSmartView, type SmartView } from '../brains/smartView.js';
import type { FromBot, Heard } from '../supervisor/roomRelay.js';
import { ReadKeeper } from '../brains/privateRead.js';
import { seatTable } from '../brains/seats.js';

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
  /** Smart mode only: the bot's running memory + its LiveKit ears. */
  private talkMemory: TalkMemory | null = null;
  private smartView: SmartView | null = null;
  private reads: ReadKeeper | null = null;
  private voice: VoiceLayer | null = null;

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
      // Smart mode: the memory exists from the start; the LiveKit presence
      // (ears + mouth) is created lazily in the main loop once we know our
      // display_name (required for the visible player join → speaking turn).
      if (this.opts.config.mode === 'smart') {
        this.talkMemory = new TalkMemory();
        this.smartView = createSmartView({
          talk: this.talkMemory,
          api: this.api,
          meId: this.session.getUserId(),
          logger: this.logger,
          privateRead: () => this.reads?.rendered() ?? '(no read yet: judge from the game so far)',
        });
        this.listen();
        const readLlm = createBotLLM();
        this.reads = new ReadKeeper({
          llm: () => readLlm,
          smart: this.smartView,
          seatTable,
          logger: this.logger,
        });
      }
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

    this.brain = this.opts.brain ?? makeBrain(cfg);

    // Heartbeat — fire once immediately + on an interval.
    this.startHeartbeat();
  }

  private async joinRoomIfNeeded(): Promise<void> {
    // Call POST /api/rooms/[code]/join unconditionally. The endpoint is
    // idempotent: if we're already a member of this room it returns
    // is_rejoin=true with 200 (and bumps our is_connected flag), so a
    // "peek first" Observer.fetch() is redundant. Critically, that peek
    // ALSO 403s with NOT_ROOM_MEMBER when the bot isn't yet in the room
    // (Observer.fetch → GET /api/rooms/[code], which requires membership)
    // — so we have to join before we can observe.
    this.logger.info(`joining room ${this.opts.roomCode}`);
    try {
      await this.api.joinRoom(this.opts.roomCode);
      this.logger.info('joined (or already a member)');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PLAYER_ALREADY_IN_ROOM') {
        // Server says we're in a DIFFERENT room (the join endpoint checks
        // getPlayerCurrentRoom and rejects if it returns another room).
        // Treat as fatal — manual cleanup needed.
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
        this.ensureVoice(identity.display_name);
        this.reads?.notice(identity, obs);
        const brainCtx = {
          identity,
          observation: obs,
          options: this.brainOptionsForCtx(),
          rng: Math.random,
          logger: this.logger,
          smart: this.smartView,
          talkClock: this.voice?.clock ?? null,
          discussionClock: this.voice?.discussionClock ?? null,
        };
        const action = await this.brain.decide(brainCtx);
        // A leader opens the round its proposal starts: write that opening, with
        // the chosen team, before the proposal goes in and the host starts the clock.
        if (action?.kind === 'propose') await this.writeOpening(action.team, obs);
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

  /** Smart mode: join LiveKit (ears + mouth) once, as soon as we know who we are. */
  private voiceStarted = false;
  private ensureVoice(displayName: string): void {
    if (this.opts.config.mode !== 'smart' || this.voiceStarted || !this.talkMemory) return;
    this.voiceStarted = true;
    void VoiceLayer.tryCreate({
      roomCode: this.opts.roomCode,
      botName: this.opts.config.name,
      displayName,
      voice: this.opts.config.voice,
      logger: this.logger,
    }).then((voice) => {
      this.voice = voice;
      if (!voice) return;
      voice.setOnPrepare((info) => this.prepareSpeech(info));
      voice.setOnMyTurn((info) => void this.handleMyTurn(info));
      voice.setOnDiscussionStart(() => void this.speakInDiscussion());
    });
  }

  /**
   * The room's ears, through the supervisor: everything said, each person's
   * words transcribed once, each smart bot's as it said them. "ready" asks for
   * all that was heard before this bot (re)started.
   */
  private listen(): void {
    if (!process.send) {
      this.logger.warn('[ears] not run by the supervisor: no room ears, the bot hears nothing');
      return;
    }
    process.on('message', (m: Heard) => {
      if (m.type === 'turn') this.talkMemory?.addTurn(m.quest, m.round, m.speaker, m.text);
      else if (m.type === 'discussion') this.talkMemory?.addDiscussion(m.speaker, m.text);
    });
    this.tell({ type: 'ready' });
  }

  private tell(message: FromBot): void {
    if (process.send) process.send(message);
  }

  /** Statements being written for upcoming slots, by turn key. */
  private readonly prepared = new Map<string, Promise<string | null>>();

  /**
   * The prepared statement if it is ready within QUICK_AFTER_MS of the slot
   * opening; otherwise a quick one is written too, and whichever comes first
   * is said — the bot speaks in its turn rather than miss it.
   */
  private async inTime(prepared: Promise<string | null>, quick: () => Promise<string | null>): Promise<string | null> {
    const early = await Promise.race([prepared, sleep(QUICK_AFTER_MS).then(() => undefined)]);
    if (early !== undefined) return early;
    this.logger.info('[mouth] the statement is not ready; writing a quick one as well');
    const fast = quick();
    const first = await Promise.race([prepared.then((t) => ({ t, from: 'prepared' })), fast.then((t) => ({ t, from: 'quick' }))]);
    if (first.t) {
      this.logger.info(`[mouth] saying the ${first.from} statement`);
      return first.t;
    }
    return first.from === 'prepared' ? fast : prepared;
  }

  /** The leader's opening of a quest's round, written when it chose its team. */
  private opening: { quest: number; text: Promise<string | null> } | null = null;

  /** The bot is near its turn: start writing its statement (a leader's opening is written with its proposal). */
  private prepareSpeech(info: MyTurnInfo): void {
    const key = turnKey(info);
    if (opensRound(info)) return;
    if (!this.prepared.has(key)) this.prepared.set(key, this.writeSpeech(info));
  }

  /** As leader, write the round's opening with the team just chosen; wait for it, so the slot finds it ready. */
  private async writeOpening(team: string[], obs: Observation): Promise<void> {
    if (!this.voice || !obs.game) return;
    const names = team.map((id) => obs.game!.players.find((p) => p.id === id)?.display_name ?? 'someone').join(', ');
    const quest = obs.game.current_quest;
    const text = this.writeSpeech(
      { quest, round: 0, turnIndex: 0, speakers: 0 },
      `Quest ${quest}, vote track ${obs.game.vote_track}/5. You are the leader and speak first: present your team [${names}] and why you chose it.`
    );
    this.opening = { quest, text };
    await text;
  }

  /** Write the statement for a slot (or for the situation given); `quick` on Hydrogen LOW. */
  private async writeSpeech(info: MyTurnInfo, situation?: string, quick = false): Promise<string | null> {
    const started = Date.now();
    try {
      const identity = this.observer.identity();
      const smart = this.smartView;
      const llm = (this.speechLLM ??= createBotLLM());
      if (!identity || !smart || !llm) return null;
      const obs = await this.observer.fetch();
      const text = await generateTurnSpeech(llm, {
        identity, observation: obs, smart, turn: info, situation, override: quick ? QUICK_SPEECH : undefined,
      });
      this.logger.info(`[mouth] ${quick ? 'quick ' : ''}statement written in ${Math.round((Date.now() - started) / 1000)} s (${sentences(text).length} sentences)`);
      return text || null;
    } catch (err) {
      this.logger.warn(`[mouth] writing the statement failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** The assassin discussion started: an evil bot says its Merlin read, once. */
  private async speakInDiscussion(): Promise<void> {
    try {
      const voice = this.voice;
      const identity = this.observer.identity();
      const smart = this.smartView;
      const llm = (this.speechLLM ??= createBotLLM());
      if (!voice || !identity || !smart || !llm || identity.role !== 'evil') return;
      const obs = await this.observer.fetch();
      const text = await generateTurnSpeech(llm, {
        identity,
        observation: obs,
        smart,
        turn: { quest: obs.game?.current_quest ?? 0, round: 0, turnIndex: 0, speakers: 0 },
        situation: DISCUSSION_SITUATION,
      });
      // No slot in the discussion: the usual length, counted from when the words are ready.
      const spoken = text ? await voice.say(text, Date.now(), { free: true }) : null;
      if (spoken) {
        this.logger.info(`[mouth] said in the discussion: ${spoken}`);
        this.talkMemory?.addDiscussion(identity.display_name, spoken);
        this.tell({ type: 'discussed', speaker: identity.display_name, text: spoken });
      }
    } catch (err) {
      this.logger.warn(`[mouth] speaking in the discussion failed: ${(err as Error).message}`);
    }
  }

  /** My speaking slot: say the statement prepared for it (or write it now), remember it, hand the turn on. */
  private async handleMyTurn(info: MyTurnInfo): Promise<void> {
    const slotStartedAt = Date.now();
    const key = turnKey(info);
    try {
      const voice = this.voice;
      const identity = this.observer.identity();
      if (!voice || !identity) return;
      const opening = opensRound(info) && this.opening?.quest === info.quest ? this.opening.text : null;
      if (opening) this.opening = null;
      const pending = opening ?? this.prepared.get(key) ?? this.writeSpeech(info);
      this.prepared.delete(key);
      const text = await this.inTime(pending, () => this.writeSpeech(info, undefined, true));
      if (!text) {
        await voice.handOn();
        return;
      }
      const spoken = await voice.say(text, slotStartedAt);
      // Remember what I said — my ears can't hear my published track.
      if (spoken) {
        this.logger.info(`[mouth] said (Q${info.quest}/R${info.round}): ${spoken}`);
        this.talkMemory?.addTurn(info.quest, info.round, identity.display_name, spoken);
        this.tell({ type: 'said', quest: info.quest, round: info.round, speaker: identity.display_name, text: spoken });
      }
      await voice.handOn();
    } catch (err) {
      this.logger.warn(`[mouth] speaking turn failed: ${(err as Error).message}`);
    }
  }
  private speechLLM: ReturnType<typeof createBotLLM> | null = null;

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
    if (this.voice) await this.voice.close().catch(() => {});
    if (this.session) this.session.stop();
    this.logger.info('clean exit');
  }
}

// keep TS happy about the unused import warning if Identity isn't referenced
export type { Identity };

/** The leader's first turn of a quest's round (the intro round has no proposal to present). */
function opensRound(info: MyTurnInfo): boolean {
  return info.quest > 0 && info.turnIndex === 0;
}

/** How long into its slot the bot waits for its prepared statement before writing a quick one too. */
const QUICK_AFTER_MS = 6_000;
/** The quick statement: Hydrogen on LOW, about 7-10 s. */
const QUICK_SPEECH = { model: 'gemini-4-hydrogen', thinking_level: 'LOW' } as const;
