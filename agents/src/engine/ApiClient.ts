/**
 * ApiClient — typed wrapper around fetch() for the playavalon HTTP API.
 *
 *   - Attaches `Authorization: Bearer <jwt>` on every call (using a JWT
 *     supplied by SessionManager).
 *   - Transparent retry on transient failures (5xx) with exponential backoff.
 *   - One-time retry on 401: trigger a session refresh and try again.
 *   - Expected 4xx errors (NOT_LEADER, INVALID_PHASE, already-acted) are
 *     returned as structured `ApiError` so the Brain/Executor can handle
 *     them without try/catch noise.
 *
 * Phase 0 only needs the auth + room + role + confirm + consent endpoints.
 * The rest are added as later phases need them.
 */

import type { SessionManager } from './SessionManager.js';
import type { AgentLogger } from '../util/logger.js';
import { sleep } from '../util/jitter.js';

export interface ApiErrorBody {
  error?: { code?: string; message?: string } | string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly path: string,
  ) {
    super(`${status} ${code} (${path}): ${message}`);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  session: SessionManager;
  logger: AgentLogger;
  maxRetries5xx?: number;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly session: SessionManager;
  private readonly logger: AgentLogger;
  private readonly maxRetries5xx: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.session = opts.session;
    this.logger = opts.logger;
    this.maxRetries5xx = opts.maxRetries5xx ?? 3;
  }

  // ===== Phase 0 endpoints =====

  async whoAmI(): Promise<{ id: string; email: string | null } | null> {
    const res = await this.get<{ user: { id: string; email: string | null } | null }>('/api/auth/me');
    return res.user;
  }

  async getRoom(code: string): Promise<RoomDetailsResponse> {
    return this.get(`/api/rooms/${code}`);
  }

  async joinRoom(code: string): Promise<{ data: { is_rejoin: boolean; room_id: string } }> {
    return this.post(`/api/rooms/${code}/join`);
  }

  async getRole(code: string): Promise<RoleResponse> {
    return this.get(`/api/rooms/${code}/role`);
  }

  async sendAiConsent(code: string): Promise<unknown> {
    return this.post(`/api/rooms/${code}/ai-consent`);
  }

  async confirmRole(code: string): Promise<unknown> {
    return this.post(`/api/rooms/${code}/confirm`);
  }

  async heartbeat(): Promise<unknown> {
    return this.post('/api/players/heartbeat');
  }

  // ===== Phase 1 endpoints =====

  /**
   * Lightweight pointer: which game (if any) is currently live for this room.
   * Cheaper than getGame(); cache the gameId once and call getGame() directly
   * on subsequent ticks.
   */
  async getRoomGame(code: string): Promise<GameLinkResponse> {
    return this.get(`/api/rooms/${code}/game`);
  }

  async getGame(gameId: string): Promise<GameStateResponse> {
    return this.get(`/api/games/${gameId}`);
  }

  async proposeTeam(gameId: string, teamMemberIds: string[]): Promise<unknown> {
    return this.post(`/api/games/${gameId}/propose`, { team_member_ids: teamMemberIds });
  }

  async submitVote(gameId: string, vote: 'approve' | 'reject'): Promise<unknown> {
    return this.post(`/api/games/${gameId}/vote`, { vote });
  }

  // ===== Phase 2 endpoints =====

  async submitQuestAction(gameId: string, action: 'success' | 'fail'): Promise<unknown> {
    return this.post(`/api/games/${gameId}/quest/action`, { action });
  }

  /**
   * Any player can call this; the server is idempotent (later callers get
   * a no-op while the first call advances the phase). We send it from any
   * agent in 'quest_result' phase — first one wins.
   */
  async continueQuest(gameId: string): Promise<unknown> {
    return this.post(`/api/games/${gameId}/continue`);
  }

  // ===== Internal HTTP helpers =====

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown, retryCount = 0): Promise<T> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.session.getAccessToken()}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (err) {
      // Network error — retry as a 5xx-equivalent up to maxRetries5xx.
      if (retryCount < this.maxRetries5xx) {
        const backoff = 500 * Math.pow(3, retryCount);
        this.logger.warn(`network error on ${method} ${path}; retry in ${backoff}ms`, { error: (err as Error).message });
        await sleep(backoff);
        return this.request(method, path, body, retryCount + 1);
      }
      throw new ApiError(0, 'NETWORK_ERROR', (err as Error).message, path);
    }

    if (res.status === 401 && retryCount === 0) {
      // Maybe the JWT just expired — try refreshing and retry exactly once.
      this.logger.debug(`got 401 on ${path}; refreshing session and retrying`);
      await this.session.refreshNow();
      return this.request(method, path, body, retryCount + 1);
    }

    if (res.status >= 500 && retryCount < this.maxRetries5xx) {
      const backoff = 500 * Math.pow(3, retryCount);
      this.logger.warn(`${res.status} on ${method} ${path}; retry in ${backoff}ms`);
      await sleep(backoff);
      return this.request(method, path, body, retryCount + 1);
    }

    if (!res.ok) {
      let bodyText = '';
      let parsed: ApiErrorBody | null = null;
      try {
        bodyText = await res.text();
        parsed = bodyText ? (JSON.parse(bodyText) as ApiErrorBody) : null;
      } catch {
        // not JSON; bodyText holds raw
      }
      const errInfo = typeof parsed?.error === 'object' ? parsed.error : null;
      const code = errInfo?.code ?? 'UNKNOWN';
      const message = errInfo?.message ?? (typeof parsed?.error === 'string' ? parsed.error : bodyText || res.statusText);
      throw new ApiError(res.status, code, message, path);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

// ===== Response types (loose; only the fields the agent reads) =====

export interface RoomDetailsResponse {
  data: {
    room: {
      id: string;
      code: string;
      status: 'waiting' | 'roles_distributed' | 'started' | 'closed';
      expected_players: number;
      manager_id: string;
      ai_review_enabled?: boolean;
    };
    players: Array<{
      id: string;
      display_name: string;
      is_manager: boolean;
      is_connected: boolean;
    }>;
    current_player: { id: string; display_name: string; is_manager: boolean };
    confirmations?: {
      total: number;
      confirmed: number;
      details?: Array<{ player_id: string; display_name: string; is_confirmed: boolean; in_room: boolean }>;
    };
    ai_review?: {
      enabled: boolean;
      caller_consented: boolean;
      consented_count: number;
      total_players: number;
    };
  };
}

export interface RoleResponse {
  data: {
    role: 'good' | 'evil';
    special_role: string;
    role_name: string;
    role_description: string;
    is_confirmed: boolean;
    known_players?: string[];
    known_players_label?: string;
    hidden_evil_count?: number;
    has_lady_of_lake?: boolean;
    split_intel?: unknown;
    oberon_split_intel?: unknown;
    has_decoy?: boolean;
    decoy_warning?: string;
  };
}

export interface GameLinkResponse {
  data: {
    has_game: boolean;
    game_id?: string;
    phase?: string;
    current_quest?: number;
    current_leader_id?: string;
  };
}

/**
 * GET /api/games/[gameId] — the canonical in-game observation.
 * We type only the fields the agent reads. Anything else is allowed via
 * the unknown sink; the server adds more over time and we don't want to
 * have to chase every addition.
 */
export interface GameStateResponse {
  data: {
    game: {
      id: string;
      room_id: string;
      phase: string;
      current_quest: number;
      current_leader_id: string;
      vote_track: number;
      in_intro_phase?: boolean;
      player_count: number;
      seating_order: string[];
    };
    players: Array<{
      id: string;
      display_name: string;
      seat_position: number;
      is_leader: boolean;
      is_on_team: boolean;
      has_voted: boolean;
      is_connected: boolean;
    }>;
    current_proposal: null | {
      id: string;
      leader_id: string;
      team_member_ids: string[];
      proposal_number: number;
    };
    quest_requirement: { size: number; fails_required: number };
    my_vote: 'approve' | 'reject' | null;
    am_team_member: boolean;
    can_submit_action: boolean;
    has_submitted_action: boolean;
    votes_submitted: number;
    total_players: number;
    actions_submitted: number;
    total_team_members: number;
  };
  current_user_id: string;
  player_role: 'good' | 'evil';
  special_role: string | null;
  room_code: string;
  is_manager: boolean;
}
