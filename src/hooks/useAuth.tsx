'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase/client';

export interface PlayerProfile {
  id: string;
  username: string;
  display_name: string;
}

interface AuthContextValue {
  user: User | null;
  profile: PlayerProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('players')
      .select('id, username, display_name')
      .eq('id', userId)
      .maybeSingle();
    setProfile((data as PlayerProfile | null) ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    setUser(currentUser);
    if (currentUser) {
      await loadProfile(currentUser.id);
    } else {
      setProfile(null);
    }
  }, [loadProfile]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[useAuth] mount: initializing');
    const supabase = getSupabaseClient();
    // eslint-disable-next-line no-console
    console.log('[useAuth] got supabase client');
    let mounted = true;

    (async () => {
      try {
        // eslint-disable-next-line no-console
        console.log('[useAuth] calling getUser...');
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        // eslint-disable-next-line no-console
        console.log('[useAuth] getUser returned:', currentUser?.id ?? 'null');
        if (!mounted) return;
        setUser(currentUser);
        if (currentUser) {
          try {
            // eslint-disable-next-line no-console
            console.log('[useAuth] loading profile for', currentUser.id);
            await loadProfile(currentUser.id);
            // eslint-disable-next-line no-console
            console.log('[useAuth] profile loaded');
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[useAuth] loadProfile failed:', err);
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useAuth] getUser failed:', err);
      } finally {
        // eslint-disable-next-line no-console
        console.log('[useAuth] setting loading=false');
        if (mounted) setLoading(false);
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        try {
          await loadProfile(session.user.id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[useAuth] loadProfile (onAuthChange) failed:', err);
        }
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server request fails, clear local state and redirect.
    }
    setUser(null);
    setProfile(null);
    router.push('/login');
    router.refresh();
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
