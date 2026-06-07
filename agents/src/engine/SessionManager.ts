/**
 * SessionManager — owns the agent's Supabase session lifecycle.
 *
 * Responsibilities:
 *   - Sign in once at startup via supabase.auth.signInWithPassword.
 *   - Expose the current JWT to ApiClient on demand.
 *   - Refresh the session ~5min before expiry; on refresh failure, fall
 *     back to a fresh signInWithPassword.
 *   - Provide the raw SupabaseClient so other modules (heartbeat, future
 *     realtime if it ever works in Node) can use it.
 *
 * NOT responsible for HTTP calls to our own /api routes — that's ApiClient.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgentLogger } from '../util/logger.js';

const REFRESH_LEAD_MS = 5 * 60 * 1000; // refresh 5min before expiry

export interface SessionManagerOptions {
  supabaseUrl: string;
  supabaseAnonKey: string;
  email: string;
  password: string;
  logger: AgentLogger;
}

export class SessionManager {
  private readonly opts: SessionManagerOptions;
  private readonly supabase: SupabaseClient;
  private userId: string | null = null;
  private accessToken: string | null = null;
  private expiresAt: number = 0;  // ms epoch
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
    this.supabase = createClient(opts.supabaseUrl, opts.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Sign in. Throws on failure (caller should fatal-exit). */
  async signIn(): Promise<void> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: this.opts.email,
      password: this.opts.password,
    });
    if (error || !data.session || !data.user) {
      throw new Error(`sign-in failed for ${this.opts.email}: ${error?.message ?? 'no session'}`);
    }
    this.userId = data.user.id;
    this.accessToken = data.session.access_token;
    this.expiresAt = data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600_000;
    this.opts.logger.info('signed in', { user_id: this.userId, expires_in_min: Math.round((this.expiresAt - Date.now()) / 60_000) });
    this.scheduleRefresh();
  }

  getUserId(): string {
    if (!this.userId) throw new Error('SessionManager: getUserId() before signIn()');
    return this.userId;
  }

  /** Current JWT — guaranteed non-null after signIn(). */
  getAccessToken(): string {
    if (!this.accessToken) throw new Error('SessionManager: getAccessToken() before signIn()');
    return this.accessToken;
  }

  /** Force a refresh now. Used by ApiClient on a 401. */
  async refreshNow(): Promise<void> {
    this.opts.logger.debug('refreshing session (forced)');
    try {
      const { data, error } = await this.supabase.auth.refreshSession();
      if (error || !data.session || !data.user) throw new Error(error?.message ?? 'no session after refresh');
      this.accessToken = data.session.access_token;
      this.expiresAt = data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600_000;
      this.scheduleRefresh();
      this.opts.logger.debug('session refreshed');
    } catch (err) {
      this.opts.logger.warn('refresh failed; re-signing in', { error: (err as Error).message });
      await this.signIn();
    }
  }

  /** The underlying supabase-js client. Exposed for advanced uses. */
  raw(): SupabaseClient {
    return this.supabase;
  }

  /** Stop the refresh timer. Idempotent. */
  stop(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const msUntilRefresh = Math.max(30_000, this.expiresAt - Date.now() - REFRESH_LEAD_MS);
    this.refreshTimer = setTimeout(() => {
      this.refreshNow().catch((err) => this.opts.logger.error('scheduled refresh failed', err));
    }, msUntilRefresh);
  }
}
