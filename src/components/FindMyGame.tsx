'use client';

/**
 * FindMyGame Component
 * Phase 6: Player Recovery & Reconnection
 *
 * Allows players to find and rejoin their active games by entering their nickname.
 */

import { useState, useCallback } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { validateNickname } from '@/lib/domain/nickname-validation';
import { getPlayerId } from '@/lib/utils/player-id';
import { ReclaimConfirmation } from './ReclaimConfirmation';
import type { FindGameResponse } from '@/types/player';

export function FindMyGame() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<FindGameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReclaimModal, setShowReclaimModal] = useState(false);

  const handleSearch = useCallback(async () => {
    const trimmed = nickname.trim();

    // Validate nickname
    const validation = validateNickname(trimmed);
    if (!validation.valid) {
      setError(validation.errors[0]);
      return;
    }

    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(
        `/api/players/find-game?nickname=${encodeURIComponent(trimmed)}`
      );
      const data: FindGameResponse = await response.json();
      setResult(data);

      if (!data.found) {
        setError('No active games found for this nickname');
      }
    } catch {
      setError('Failed to search. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [nickname]);

  const handleRejoin = () => {
    if (!result?.game) return;

    // If player can reclaim (disconnected + grace period passed), show reclaim modal
    if (result.game.can_reclaim) {
      setShowReclaimModal(true);
    } else if (result.game.grace_period_remaining) {
      // Still in grace period
      setError(`Please wait ${result.game.grace_period_remaining} seconds before reclaiming`);
    } else {
      // Player is still connected - they should use their original session
      setError('This player is still connected. Use your original browser/device.');
    }
  };

  const handleDirectJoin = () => {
    if (!result?.game) return;
    // Navigate directly to the room/game
    if (result.game.status === 'started') {
      // Would need game_id - for now go to room
      router.push(`/rooms/${result.game.room_code}`);
    } else {
      router.push(`/rooms/${result.game.room_code}`);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'waiting':
        return (
          <span className="px-2 py-1 text-xs rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            Waiting for players
          </span>
        );
      case 'roles_distributed':
        return (
          <span className="px-2 py-1 text-xs rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
            Roles assigned
          </span>
        );
      case 'started':
        return (
          <span className="px-2 py-1 text-xs rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            Game in progress
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-display text-avalon-gold">
          Find My Game
        </h3>
        <p className="text-sm text-avalon-text-muted mt-1">
          Lost your session? Enter your nickname to find your active game.
        </p>
      </div>

      {/* Search Form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Enter your nickname"
          className="flex-1 px-4 py-2 rounded-lg bg-avalon-dark-lighter border border-avalon-dark-border text-avalon-text placeholder-avalon-text-muted focus:outline-none focus:ring-2 focus:ring-avalon-accent"
          disabled={isSearching}
        />
        <button
          onClick={handleSearch}
          disabled={isSearching || !nickname.trim()}
          className="px-4 py-2 rounded-lg bg-avalon-accent hover:bg-avalon-accent-hover text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSearching ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <Search size={16} />
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Search Result */}
      {result?.found && result.game && (
        <div className="p-4 rounded-lg bg-avalon-dark-lighter border border-avalon-dark-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-avalon-text-muted">Room Code</p>
              <p className="text-xl font-mono font-bold text-avalon-gold">
                {result.game.room_code}
              </p>
            </div>
            {getStatusBadge(result.game.status)}
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-avalon-text-muted">Players</span>
            <span className="text-avalon-text">
              {result.game.player_count} / {result.game.expected_players}
            </span>
          </div>

          {result.game.is_manager && (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <span>🏠</span>
              <span>You are the room manager</span>
            </div>
          )}

          {result.game.can_reclaim ? (
            <button
              onClick={handleRejoin}
              className="w-full py-2 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition-colors"
            >
              <RefreshCw size={16} className="inline" /> Reclaim My Seat
            </button>
          ) : result.game.grace_period_remaining ? (
            <div className="text-center">
              <p className="text-sm text-avalon-text-muted">
                Wait {result.game.grace_period_remaining}s to reclaim
              </p>
              <button
                onClick={handleSearch}
                className="mt-2 text-sm text-avalon-accent hover:underline"
              >
                Refresh status
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-avalon-text-muted text-center">
                You&apos;re still connected in another session
              </p>
              <button
                onClick={handleDirectJoin}
                className="w-full py-2 px-4 rounded-lg bg-avalon-dark border border-avalon-dark-border hover:bg-avalon-dark-lighter text-avalon-text font-medium transition-colors"
              >
                Go to Room
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reclaim Modal */}
      {result?.game && (
        <ReclaimConfirmation
          isOpen={showReclaimModal}
          onClose={() => setShowReclaimModal(false)}
          roomCode={result.game.room_code}
          nicknameToReclaim={nickname.trim()}
        />
      )}
    </div>
  );
}
