/**
 * Server-side Supabase clients
 *
 * Two client types:
 *   - createServiceClient(): service-role key, bypasses RLS. Use in API routes for
 *     privileged operations (creating users, writing game state, etc.).
 *   - createRouteClient(): cookie-backed auth client. Reads the current user's
 *     session from Next.js cookies. Use when you need auth.uid() to be set,
 *     or when RLS should apply.
 */

import { createServerClient as createSSRClient } from '@supabase/ssr';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import type { User } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Service-role client. Bypasses RLS. Server-only.
 */
export function createServiceClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase server environment variables');
  }

  return createServiceRoleClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Auth client for Next.js server contexts (route handlers, server components,
 * server actions). Reads/writes the session cookie. RLS applies as the
 * current user.
 */
export async function createRouteClient() {
  const cookieStore = await cookies();

  return createSSRClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // `setAll` is called from a Server Component; cookies can't be mutated there.
          // The middleware handles session refresh, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Get the currently authenticated user, or null if not signed in.
 *
 * Accepts auth in two ways, in priority order:
 *   1. `Authorization: Bearer <jwt>` header — used by non-browser clients
 *      (the agent engine in `agents/`, mobile apps, CLI tools). The JWT is
 *      validated against Supabase via a one-off network call.
 *   2. Session cookies — used by the normal browser flow via @supabase/ssr.
 *
 * Use at the top of any protected API route / server action.
 */
export async function getCurrentUser(): Promise<User | null> {
  // Path 1: Bearer header (non-browser clients).
  const headersList = await headers();
  const authHeader = headersList.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      const tokenClient = createServiceRoleClient(supabaseUrl, supabaseAnonKey);
      const { data: { user }, error } = await tokenClient.auth.getUser(token);
      if (!error && user) return user;
      // If the Bearer token is invalid we DO NOT fall through to cookies —
      // someone explicitly sent a token and it's wrong; that's a 401, not a
      // chance to retry as an anonymous user.
      return null;
    }
  }

  // Path 2: cookie session (browsers).
  const client = await createRouteClient();
  const { data: { user } } = await client.auth.getUser();
  return user;
}

/**
 * Require an authenticated user. Throws if no session.
 *
 * @throws Error with status-like message; caller should return 401.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('UNAUTHORIZED: Authentication required');
  }
  return user;
}
