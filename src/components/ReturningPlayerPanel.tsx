'use client';

/**
 * ReturningPlayerPanel Component
 * Phase 6: Player Recovery & Reconnection
 *
 * Allows players on a new device/browser to restore their session
 * by entering their existing nickname and room code.
 * This bypasses the normal registration flow by retrieving their original player ID.
 */
import { RefreshCw } from 'lucide-react';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { validateNickname } from '@/lib/domain/nickname-validation';
import { validateRoomCode } from '@/lib/domain/validation';
import { setPlayerIdentity } from '@/lib/utils/player-id';
import type { RestoreSessionSuccessResponse, RestoreSessionErrorResponse } from '@/types/player';

interface ReturningPlayerPanelProps {
  onBack: () => void;
}

export function ReturningPlayerPanel({ onBack }: ReturningPlayerPanelProps) {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gracePeriod, setGracePeriod] = useState<number | null>(null);
  const [autoRetryIn, setAutoRetryIn] = useState<number | null>(null);

  // Countdown timer for auto-retry during grace period
  useEffect(() => {
    if (gracePeriod !== null && gracePeriod > 0) {
      setAutoRetryIn(gracePeriod);
    }
  }, [gracePeriod]);

  useEffect(() => {
    if (autoRetryIn === null || autoRetryIn <= 0) return;

    const timer = setInterval(() => {
      setAutoRetryIn((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRetryIn]);

  // Auto-retry when countdown reaches 0
  useEffect(() => {
    if (autoRetryIn === 0 && nickname && roomCode) {
      handleRestore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRetryIn]);

  const handleRestore = useCallback(async () => {
    setError(null);
    setGracePeriod(null);

    // Validate inputs
    const nicknameValidation = validateNickname(nickname.trim());
    if (!nicknameValidation.valid) {
      setError(nicknameValidation.errors[0]);
      return;
    }

    const roomValidation = validateRoomCode(roomCode.trim());
    if (!roomValidation.valid) {
      setError(roomValidation.error || 'Invalid room code');
      return;
    }

    setIsRestoring(true);

    try {
      const response = await fetch('/api/players/restore-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname.trim(),
          room_code: roomCode.trim().toUpperCase(),
        }),
      });

      const data = await response.json() as RestoreSessionSuccessResponse | RestoreSessionErrorResponse;

      if (data.success) {
        // Save the returned player ID to localStorage
        setPlayerIdentity(data.player_id, data.nickname);

        // Navigate to the room or game
        if (data.game_id) {
          router.push(`/game/${data.game_id}`);
        } else {
          router.push(`/rooms/${data.room_code}`);
        }
      } else {
        // Handle errors
        if (data.error === 'GRACE_PERIOD' && data.grace_period_remaining) {
          setError(`Please wait ${Math.ceil(data.grace_period_remaining)} seconds...`);
          setGracePeriod(data.grace_period_remaining);
        } else {
          setError(data.message);
        }
      }
    } catch {
      setError('Failed to restore session. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  }, [nickname, roomCode, router]);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-display text-avalon-gold">
          Welcome Back, Knight
        </h2>
        <p className="text-avalon-parchment/70 text-sm">
          Restore your session to rejoin your game
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-avalon-parchment/80 mb-1">
            Your Nickname
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Enter your existing nickname"
            className="w-full px-4 py-3 rounded-lg bg-avalon-dark-lighter border border-avalon-dark-border text-avalon-text placeholder-avalon-text-muted focus:outline-none focus:ring-2 focus:ring-avalon-accent"
            disabled={isRestoring}
            maxLength={20}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-avalon-parchment/80 mb-1">
            Room Code
          </label>
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="Enter 6-character code"
            className="w-full px-4 py-3 rounded-lg bg-avalon-dark-lighter border border-avalon-dark-border text-avalon-text placeholder-avalon-text-muted focus:outline-none focus:ring-2 focus:ring-avalon-accent text-center tracking-widest font-mono text-lg"
            disabled={isRestoring}
            maxLength={6}
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Grace period countdown */}
      {gracePeriod !== null && autoRetryIn !== null && autoRetryIn > 0 && (
        <div className="text-center">
          <p className="text-sm text-avalon-text-muted">
            Auto-retrying in {autoRetryIn} seconds...
          </p>
          <div className="mt-2 h-1 bg-avalon-dark-lighter rounded-full overflow-hidden">
            <div
              className="h-full bg-avalon-accent transition-all duration-1000"
              style={{
                width: `${(autoRetryIn / gracePeriod) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={handleRestore}
          disabled={isRestoring || !nickname.trim() || !roomCode.trim() || (autoRetryIn !== null && autoRetryIn > 0)}
          className="w-full py-3 px-4 rounded-lg bg-avalon-accent hover:bg-avalon-accent-hover text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRestoring ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Restoring...
            </span>
          ) : (
            <><RefreshCw size={16} className="inline" /> Restore Session</>
          )}
        </button>

        <button
          onClick={onBack}
          disabled={isRestoring}
          className="w-full py-2 text-sm text-avalon-silver hover:text-avalon-gold transition-colors disabled:opacity-50"
        >
          ← Back to registration
        </button>
      </div>

      <p className="text-xs text-center text-avalon-text-muted">
        You can only restore a session if you were disconnected for at least 90 seconds.
      </p>
    </div>
  );
}

