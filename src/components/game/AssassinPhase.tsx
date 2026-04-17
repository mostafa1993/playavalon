'use client';

/**
 * AssassinPhase Component
 * Allows the Assassin to guess who Merlin is after Good wins 3 quests
 */

import { useState } from 'react';
import type { GamePlayer, AssassinPhaseState } from '@/types/game';

interface AssassinPhaseProps {
  gameId: string;
  players: GamePlayer[];
  assassinPhase: AssassinPhaseState;
  isAssassin: boolean;
  currentPlayerId: string;
  onGuessSubmitted: () => void;
}

export function AssassinPhase({
  gameId,
  players,
  assassinPhase,
  isAssassin,
  currentPlayerId,
  onGuessSubmitted,
}: AssassinPhaseProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get Good players (potential Merlin candidates) - filter out the Assassin
  const goodCandidates = players.filter(
    (p) => p.id !== assassinPhase.assassin_id
  );

  const handleSubmitGuess = async () => {
    if (!selectedPlayerId || !isAssassin) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/games/${gameId}/assassin-guess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guessed_player_id: selectedPlayerId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit guess');
      }

      onGuessSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit guess');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 to-purple-900 rounded-xl p-6 shadow-2xl border border-purple-500/30">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">🗡️</div>
        <h2 className="text-2xl font-bold text-purple-300 mb-2">
          The Assassin&apos;s Gambit
        </h2>
        <p className="text-slate-300 text-sm">
          Good has won 3 quests, but the Assassin has one final chance...
        </p>
      </div>

      {/* Dramatic message */}
      <div className="bg-slate-800/50 rounded-lg p-4 mb-6 border border-purple-500/20">
        {isAssassin ? (
          <div className="text-center">
            <p className="text-purple-200 font-semibold mb-2">
              You are the Assassin!
            </p>
            <p className="text-slate-300 text-sm">
              Identify Merlin to snatch victory from defeat. Choose wisely - you
              only get one guess.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-slate-200 font-semibold mb-2">
              {assassinPhase.assassin_display_name} is choosing their target...
            </p>
            <p className="text-slate-400 text-sm">
              Hold your breath. If the Assassin finds Merlin, Evil wins!
            </p>
          </div>
        )}
      </div>

      {/* Player selection (Assassin only) */}
      {isAssassin && (
        <>
          <div className="mb-4">
            <p className="text-slate-300 text-sm mb-3 text-center">
              Select who you believe is Merlin:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {goodCandidates.map((player) => (
                <button
                  key={player.id}
                  onClick={() => setSelectedPlayerId(player.id)}
                  disabled={isSubmitting}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedPlayerId === player.id
                      ? 'border-purple-500 bg-purple-900/50 text-purple-200'
                      : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:border-purple-400 hover:bg-slate-700/50'
                  } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="text-2xl mb-1">
                    {selectedPlayerId === player.id ? '🎯' : '👤'}
                  </div>
                  <div className="font-medium text-sm truncate">
                    {player.display_name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-4 text-center">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmitGuess}
            disabled={!selectedPlayerId || isSubmitting}
            className={`w-full py-3 px-4 rounded-lg font-bold text-lg transition-all ${
              selectedPlayerId && !isSubmitting
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg'
                : 'bg-slate-700 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⚔️</span> Striking...
              </span>
            ) : (
              '⚔️ Strike! This is Merlin!'
            )}
          </button>
        </>
      )}

      {/* Waiting state (non-Assassin) */}
      {!isAssassin && (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="relative">
            <div className="absolute inset-0 animate-ping opacity-25">
              <div className="w-16 h-16 rounded-full bg-purple-500"></div>
            </div>
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
              <span className="text-3xl animate-pulse">🗡️</span>
            </div>
          </div>
          <p className="mt-4 text-slate-400 text-sm animate-pulse">
            The Assassin is deliberating...
          </p>
        </div>
      )}
    </div>
  );
}

