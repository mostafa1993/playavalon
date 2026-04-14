'use client';

/**
 * LadyOfLakePhase Component
 * Allows the Lady holder to select and investigate a player
 */

import { useState } from 'react';
import { Search, Eye } from 'lucide-react';
import type { GamePlayer, LadyOfLakeState } from '@/types/game';

interface LadyOfLakePhaseProps {
  gameId: string;
  players: GamePlayer[];
  ladyState: LadyOfLakeState;
  currentPlayerId: string;
  onInvestigationComplete: (result: 'good' | 'evil', newHolderNickname: string) => void;
}

export function LadyOfLakePhase({
  gameId,
  players,
  ladyState,
  currentPlayerId,
  onInvestigationComplete,
}: LadyOfLakePhaseProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHolder = ladyState.is_holder;
  
  // Get valid targets (exclude self, already investigated, and previous Lady holders)
  const validTargets = players.filter(
    (p) => 
      p.id !== ladyState.holder_id && 
      !ladyState.investigated_player_ids.includes(p.id) &&
      !ladyState.previous_lady_holder_ids.includes(p.id)
  );

  const handleSubmitInvestigation = async () => {
    if (!selectedPlayerId || !isHolder) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/games/${gameId}/lady-investigate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-player-id': currentPlayerId,
        },
        body: JSON.stringify({
          target_player_id: selectedPlayerId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to investigate');
      }

      onInvestigationComplete(data.data.result, data.data.new_holder_nickname);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to investigate');
      setIsSubmitting(false);
    }
  };

  const selectedPlayer = players.find((p) => p.id === selectedPlayerId);

  return (
    <div className="bg-gradient-to-br from-slate-900 to-blue-900 rounded-xl p-6 shadow-2xl border border-blue-500/30">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">🌊</div>
        <h2 className="text-2xl font-bold text-blue-300 mb-2">
          Lady of the Lake
        </h2>
        <p className="text-slate-300 text-sm">
          {isHolder
            ? 'Select a player to learn their true allegiance'
            : `${ladyState.holder_nickname} is using the Lady of the Lake...`}
        </p>
      </div>

      {/* Lady Holder View */}
      {isHolder && (
        <>
          <div className="bg-slate-800/50 rounded-lg p-4 mb-6 border border-blue-500/20">
            <p className="text-blue-200 text-center text-sm">
              You hold the Lady of the Lake. Choose wisely — you will learn if
              the selected player is <span className="text-emerald-400 font-semibold">Good</span> or{' '}
              <span className="text-red-400 font-semibold">Evil</span>.
            </p>
          </div>

          {/* Player Selection Grid */}
          <div className="mb-4">
            <p className="text-slate-300 text-sm mb-3 text-center">
              Select a player to investigate:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {players.map((player) => {
                const isInvestigated = ladyState.investigated_player_ids.includes(player.id);
                const isPreviousHolder = ladyState.previous_lady_holder_ids.includes(player.id);
                const isSelf = player.id === ladyState.holder_id;
                const isDisabled = isInvestigated || isPreviousHolder || isSelf || isSubmitting;
                const isSelected = selectedPlayerId === player.id;

                return (
                  <button
                    key={player.id}
                    onClick={() => !isDisabled && setSelectedPlayerId(player.id)}
                    disabled={isDisabled}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-900/50 text-blue-200'
                        : isDisabled
                        ? 'border-slate-700 bg-slate-800/30 text-slate-500 cursor-not-allowed opacity-50'
                        : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:border-blue-400 hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="text-2xl mb-1">
                      {isSelf ? '🌊' : isPreviousHolder ? '🚫' : isInvestigated ? '👁️' : isSelected ? '🎯' : '👤'}
                    </div>
                    <div className="font-medium text-sm truncate">
                      {player.nickname}
                      {isSelf && ' (You)'}
                    </div>
                    {isPreviousHolder && !isSelf && (
                      <div className="text-xs text-slate-500 mt-1">Past Holder</div>
                    )}
                    {isInvestigated && (
                      <div className="text-xs text-slate-500 mt-1">Investigated</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-4 text-center">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmitInvestigation}
            disabled={!selectedPlayerId || isSubmitting}
            className={`w-full py-3 px-4 rounded-lg font-bold text-lg transition-all ${
              selectedPlayerId && !isSubmitting
                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg'
                : 'bg-slate-700 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">🌊</span> Investigating...
              </span>
            ) : selectedPlayer ? (
              <><Search size={16} className="inline" /> Investigate {selectedPlayer.nickname}</>
            ) : (
              'Select a Player'
            )}
          </button>
        </>
      )}

      {/* Waiting State (Non-Holder) */}
      {!isHolder && (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="relative">
            <div className="absolute inset-0 animate-ping opacity-25">
              <div className="w-16 h-16 rounded-full bg-blue-500"></div>
            </div>
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center">
              <span className="text-3xl animate-pulse">🌊</span>
            </div>
          </div>
          <p className="mt-4 text-slate-400 text-sm animate-pulse">
            {ladyState.holder_nickname} is consulting the Lady...
          </p>
        </div>
      )}

      {/* Investigation History */}
      {ladyState.investigated_player_ids.length > 0 && (
        <div className="mt-6 pt-4 border-t border-slate-700">
          <p className="text-xs text-slate-500 text-center mb-2">
            Previously Investigated ({ladyState.investigated_player_ids.length})
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {ladyState.investigated_player_ids.map((id) => {
              const player = players.find((p) => p.id === id);
              return (
                <span
                  key={id}
                  className="px-2 py-1 bg-slate-700/50 rounded text-xs text-slate-400"
                >
                  <Eye size={16} className="inline" /> {player?.nickname || 'Unknown'}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

