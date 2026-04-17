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

export interface PlayerProfile {
  id: string;
  username: string;
  display_name: string;
}

interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  profile: PlayerProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<{ user: AuthUser | null; profile: PlayerProfile | null }> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!res.ok) return { user: null, profile: null };
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { user, profile } = await fetchMe();
    setUser(user);
    setProfile(profile);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { user, profile } = await fetchMe();
        if (!mounted) return;
        setUser(user);
        setProfile(profile);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useAuth] fetch /api/auth/me failed:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort — clear local state and redirect regardless.
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
