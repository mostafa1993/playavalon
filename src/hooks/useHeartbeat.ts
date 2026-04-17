'use client';

/**
 * Heartbeat hook for player activity tracking
 *
 * Sends periodic heartbeat requests to update the authenticated user's
 * last_activity_at. Pauses when tab is hidden, resumes on focus.
 * Only runs when a user is signed in.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { HEARTBEAT_INTERVAL_SECONDS } from '@/lib/domain/connection-status';

interface UseHeartbeatOptions {
  /** Whether heartbeat is enabled (default: true) */
  enabled?: boolean;
  /** Callback when heartbeat fails */
  onError?: (error: Error) => void;
  /** Callback when heartbeat succeeds */
  onSuccess?: () => void;
}

/**
 * Hook that sends heartbeat to server every 30 seconds.
 * Auth is handled via cookies — no custom headers needed.
 */
export function useHeartbeat(options: UseHeartbeatOptions = {}) {
  const { enabled = true, onError, onSuccess } = options;
  const { user } = useAuth();

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isVisibleRef = useRef(true);
  const lastHeartbeatRef = useRef<number>(0);

  const sendHeartbeat = useCallback(async () => {
    try {
      const response = await fetch('/api/players/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Heartbeat failed: ${response.status}`);
      }

      lastHeartbeatRef.current = Date.now();
      onSuccess?.();
    } catch (error) {
      console.error('Heartbeat error:', error);
      onError?.(error instanceof Error ? error : new Error('Heartbeat failed'));
    }
  }, [onError, onSuccess]);

  const startHeartbeat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    sendHeartbeat();

    intervalRef.current = setInterval(() => {
      if (isVisibleRef.current) {
        sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_SECONDS * 1000);
  }, [sendHeartbeat]);

  const stopHeartbeat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !user) return;

    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;

      if (!document.hidden) {
        sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, user, sendHeartbeat]);

  useEffect(() => {
    if (enabled && user) {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }

    return () => {
      stopHeartbeat();
    };
  }, [enabled, user, startHeartbeat, stopHeartbeat]);

  return {
    sendHeartbeat,
    lastHeartbeat: lastHeartbeatRef.current,
  };
}
