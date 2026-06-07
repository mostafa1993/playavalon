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
import type { Observation, RoomObservation } from '../types/Observation.js';
import type { Identity, Role, SpecialRole } from '../types/Identity.js';
import type { AgentLogger } from '../util/logger.js';

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

    return {
      room,
      // game: undefined in P0 — populated in P1+ when we add the /api/games/[gameId] fetch
      self: {
        role: this.cachedIdentity?.role,
        special_role: this.cachedIdentity?.special_role,
        is_in_room: isInRoom,
        is_leader: false, // populated in P1 from game.current_leader_id === userId
      },
      tick: this.tick,
      fetched_at: new Date(),
    };
  }

  /** Returns the cached Identity once role distribution has happened. */
  identity(): Identity | null {
    return this.cachedIdentity;
  }
}
