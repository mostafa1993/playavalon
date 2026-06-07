/**
 * Observer — fetches and assembles the current Observation snapshot.
 *
 * The Brain reads this on every tick. Observer is the single source of
 * truth for "what's going on right now?" so the rest of the engine
 * doesn't have to think about which endpoint provides which field.
 *
 * Strategy:
 *   - GET /api/rooms/[code]  on every tick (cheap, ~50ms).
 *   - GET /api/rooms/[code]/role  ONCE when the room first transitions to
 *     roles_distributed; cache the result for the rest of the game.
 *
 * Phase 0 doesn't need the in-game GET /api/games/[gameId] yet; that lands
 * in P1 when the agent needs to read its own vote / team state.
 */

import type { ApiClient } from './ApiClient.js';
import type { Observation, RoomObservation, GameObservation, GamePhase, MerlinQuizObservation } from '../types/Observation.js';
import type { Identity, Role, SpecialRole } from '../types/Identity.js';
import type { AgentLogger } from '../util/logger.js';
import { ApiError } from './ApiClient.js';

export interface ObserverOptions {
  api: ApiClient;
  roomCode: string;
  userId: string;
  username: string;
  logger: AgentLogger;
}

export class Observer {
  private readonly opts: ObserverOptions;
  private tick = 0;
  /** Cached role; null until distribution happens, then populated once. */
  private cachedIdentity: Identity | null = null;
  /** Cached gameId once the game has started; saves one round-trip per tick. */
  private cachedGameId: string | null = null;

  constructor(opts: ObserverOptions) {
    this.opts = opts;
  }

  /**
   * Fetch the latest observation. Cheap — caller can call as often as the
   * polling cadence allows.
   */
  async fetch(): Promise<Observation> {
    this.tick += 1;

    const roomRes = await this.opts.api.getRoom(this.opts.roomCode);
    const data = roomRes.data;

    const me = data.players.find((p) => p.id === this.opts.userId);
    const isInRoom = me !== undefined;

    // Are roles distributed? (Lazy-fetch role on first true.)
    const rolesDistributed = data.room.status === 'roles_distributed' || data.room.status === 'started';
    if (rolesDistributed && !this.cachedIdentity && isInRoom) {
      try {
        const roleRes = await this.opts.api.getRole(this.opts.roomCode);
        this.cachedIdentity = {
          user_id: this.opts.userId,
          username: this.opts.username,
          display_name: me?.display_name ?? this.opts.username,
          role: roleRes.data.role as Role,
          special_role: roleRes.data.special_role as SpecialRole,
          role_intel: {
            known_players: roleRes.data.known_players ?? [],
            known_players_label: roleRes.data.known_players_label ?? '',
            split_intel: roleRes.data.split_intel,
            oberon_split_intel: roleRes.data.oberon_split_intel,
            hidden_evil_count: roleRes.data.hidden_evil_count,
            has_lady_of_lake: roleRes.data.has_lady_of_lake,
          },
        };
        this.opts.logger.info('role fetched', {
          role: this.cachedIdentity.role,
          special_role: this.cachedIdentity.special_role,
        });
      } catch (err) {
        // Role endpoint might 404/4xx briefly during the transition window.
        // Don't fatal — Brain will see rolesDistributed=true but no identity
        // yet and just noop; we'll retry next tick.
        this.opts.logger.debug('role fetch failed; will retry next tick', { error: (err as Error).message });
      }
    }

    // Confirmation status of this agent — pulled from confirmations.details
    // if present (lobby dashboard added that), else inferred from cached role.
    const myDetail = data.confirmations?.details?.find((d) => d.player_id === this.opts.userId);
    const isConfirmed = myDetail?.is_confirmed ?? false;

    const room: RoomObservation = {
      code: data.room.code,
      status: data.room.status,
      expected_players: data.room.expected_players,
      manager_id: data.room.manager_id,
      ai_review_enabled: data.ai_review?.enabled ?? false,
      ai_consent_given: data.ai_review?.caller_consented ?? false,
      is_confirmed: isConfirmed,
      players: data.players.map((p) => ({
        id: p.id,
        display_name: p.display_name,
        is_manager: p.is_manager,
        is_connected: p.is_connected,
      })),
      roles_distributed: rolesDistributed,
    };

    // Fetch in-game state once the game has started OR if we've cached a
    // gameId already (room.status flips to 'closed' immediately on game-end,
    // but the game record + merlin quiz are still reachable — we need to
    // keep observing them to drive the post-game flow).
    let game: GameObservation | undefined;
    let isLeader = false;
    const shouldFetchGame = isInRoom && (room.status === 'started' || this.cachedGameId !== null);
    if (shouldFetchGame) {
      const gameState = await this.fetchGameState();
      if (gameState) {
        game = gameState;
        isLeader = game.current_leader_id === this.opts.userId;
      }
    }

    // Once the game is over, also fetch the Merlin quiz state.
    let merlin_quiz: MerlinQuizObservation | undefined;
    if (game?.phase === 'game_over' && this.cachedGameId) {
      try {
        const q = await this.opts.api.getMerlinQuiz(this.cachedGameId);
        merlin_quiz = {
          enabled: q.data.quiz_enabled,
          active: q.data.quiz_active,
          complete: q.data.quiz_complete,
          has_voted: q.data.has_voted,
          has_skipped: q.data.has_skipped,
        };
      } catch (err) {
        if (err instanceof ApiError) {
          this.opts.logger.debug(`merlin-quiz fetch ${err.status} ${err.code} — treating as no quiz`);
        } else {
          throw err;
        }
      }
    }

    return {
      room,
      game,
      merlin_quiz,
      self: {
        role: this.cachedIdentity?.role,
        special_role: this.cachedIdentity?.special_role,
        is_in_room: isInRoom,
        is_leader: isLeader,
      },
      tick: this.tick,
      fetched_at: new Date(),
    };
  }

  /**
   * Resolve gameId on first call, then poll /api/games/[gameId] directly.
   * Returns undefined if the game record doesn't exist yet (briefly possible
   * during the auto-start race) or if the fetch fails — caller treats that
   * the same as "no game info yet, try again next tick."
   */
  private async fetchGameState(): Promise<GameObservation | undefined> {
    try {
      if (!this.cachedGameId) {
        const linkRes = await this.opts.api.getRoomGame(this.opts.roomCode);
        if (!linkRes.data.has_game || !linkRes.data.game_id) return undefined;
        this.cachedGameId = linkRes.data.game_id;
      }
      const res = await this.opts.api.getGame(this.cachedGameId);
      const d = res.data;
      return {
        game_id: d.game.id,
        phase: d.game.phase as GamePhase,
        current_quest: d.game.current_quest,
        current_leader_id: d.game.current_leader_id,
        vote_track: d.game.vote_track,
        in_intro_phase: d.game.in_intro_phase ?? false,
        quest_requirement: d.quest_requirement,
        players: d.players.map((p) => ({
          id: p.id,
          display_name: p.display_name,
          seat_position: p.seat_position,
          is_leader: p.is_leader,
          is_on_team: p.is_on_team,
          has_voted: p.has_voted,
          is_connected: p.is_connected,
        })),
        current_proposal: d.current_proposal,
        my_vote: d.my_vote,
        am_team_member: d.am_team_member,
        has_voted: d.my_vote !== null,
        has_submitted_action: d.has_submitted_action,
        votes_submitted: d.votes_submitted,
        actions_submitted: d.actions_submitted,
        total_team_members: d.total_team_members,
        lady_of_lake: d.lady_of_lake
          ? {
              holder_id: d.lady_of_lake.holder_id,
              investigated_player_ids: d.lady_of_lake.investigated_player_ids,
              is_holder: d.lady_of_lake.is_holder,
              can_investigate: d.lady_of_lake.can_investigate,
            }
          : null,
        assassin_phase: d.assassin_phase
          ? {
              assassin_id: d.assassin_phase.assassin_id,
              merlin_id: d.assassin_phase.merlin_id,
              can_guess: d.assassin_phase.can_guess,
            }
          : null,
        is_assassin: d.is_assassin,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        this.opts.logger.debug(`game state fetch returned ${err.status} ${err.code}; treating as transient`);
        return undefined;
      }
      throw err;
    }
  }

  /** Returns the cached Identity once role distribution has happened. */
  identity(): Identity | null {
    return this.cachedIdentity;
  }

  /** Returns the cached gameId once the game has started. */
  gameId(): string | null {
    return this.cachedGameId;
  }
}
