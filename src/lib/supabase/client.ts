/**
 * Browser-side Supabase client
 *
 * Cookie-backed session via @supabase/ssr. The session JWT is stored in
 * httpOnly cookies set by the server — the browser client reads them to
 * authenticate requests automatically.
 */

import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) return supabaseInstance;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (typeof window === 'undefined') {
      // SSR/build fallback — return a dummy that won't be used
      return createSSRBrowserClient(
        'https://placeholder.supabase.co',
        'placeholder-key'
      );
    }
    // eslint-disable-next-line no-console
    console.error('Missing Supabase environment variables. Check .env.local');
  }

  supabaseInstance = createSSRBrowserClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-key',
    {
      auth: {
        // Disable navigator.locks-based coordination. The default lock can
        // deadlock across tab lifecycles: a previous tab that was closed
        // mid-operation can leave a held lock that blocks subsequent
        // getUser()/getSession() calls forever. We don't need cross-tab
        // coordination; run the critical section directly.
        lock: async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn(),
      },
    }
  );

  return supabaseInstance;
}
