'use client';

/**
 * MerlinQuiz Component
 * Feature 010: Endgame Merlin Quiz
 *
 * Allows all players to guess who Merlin was at the end of the game.
 * Shows at game_over phase, before role reveal, when Merlin was in the game.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { GamePlayer, MerlinQuizState, MerlinQuizVote } from '@/types/game';
import { QUIZ_TIMEOUT_SECONDS, getRemainingSeconds } from '@/lib/domain/merlin-quiz';

interface MerlinQuizProps {
  gameId: string;
  players: GamePlayer[];
  currentPlayerId: string;
  onQuizComplete: () => void;
  onSkip: () => void;
}

export function MerlinQuiz({
  gameId,
  players,
  currentPlayerId,
  onQuizComplete,
  onSkip,
}: MerlinQuizProps) {
  const [quizState, setQuizState] = useState<MerlinQuizState | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(QUIZ_TIMEOUT_SECONDS);

  // Fetch quiz state
  const fetchQuizState = useCallback(async () => {
    try {
      const response = await fetch(`/api/games/${gameId}/merlin-quiz`);

      if (response.ok) {
        const data = await response.json();
        setQuizState(data.data);
        setLoadError(null);

        // Update remaining time
        if (data.data.quiz_started_at) {
          setRemainingSeconds(getRemainingSeconds(data.data.quiz_started_at));
        }

        // Check if quiz is complete
        if (data.data.quiz_complete) {
          onQuizComplete();
        }
      } else {
        const data = await response.json();
        setLoadError(data.error?.message || 'Failed to load quiz');
      }
    } catch (err) {
      console.error('Failed to fetch quiz state:', err);
      setLoadError('Quiz feature unavailable');
    }
  }, [gameId, onQuizComplete]);

  // Initial fetch and polling
  useEffect(() => {
    fetchQuizState();

    // Poll every 5 seconds
    const pollInterval = setInterval(fetchQuizState, 5000);

    return () => clearInterval(pollInterval);
  }, [fetchQuizState]);

  // Countdown timer
  useEffect(() => {
    if (!quizState?.quiz_active || quizState.quiz_complete) return;

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        const newValue = Math.max(0, prev - 1);
        if (newValue === 0) {
          onQuizComplete();
        }
        return newValue;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [quizState?.quiz_active, quizState?.quiz_complete, onQuizComplete]);

  // Real-time subscription for quiz votes
  useEffect(() => {
    const supabase = getSupabaseClient();

    const channel = supabase
      .channel(`quiz-votes-${gameId}`)
      .on<MerlinQuizVote>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'merlin_quiz_votes',
          filter: `game_id=eq.${gameId}`,
        },
        () => {
          // Refresh quiz state when a new vote comes in
          fetchQuizState();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, fetchQuizState]);

  // Get other players (exclude self)
  const otherPlayers = players.filter((p) => p.id !== currentPlayerId);

  const handleSubmitVote = async (suspectedId: string | null) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/games/${gameId}/merlin-quiz`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          suspected_player_id: suspectedId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to submit vote');
      }

      const data = await response.json();

      // Update local state
      setQuizState((prev) =>
        prev
          ? {
              ...prev,
              has_voted: true,
              has_skipped: suspectedId === null,
              my_vote: suspectedId ?? 'skipped',
              votes_submitted: data.data.votes_submitted,
            }
          : null
      );

      // Check if quiz is complete
      if (data.data.quiz_complete) {
        onQuizComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit vote');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    handleSubmitVote(null);
  };

  // Loading error state - allow skip to role reveal
  if (loadError) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
        <div className="text-center">
          <div className="text-4xl mb-3">🔮</div>
          <p className="text-slate-400 mb-4 text-sm">{loadError}</p>
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Skip to Role Reveal →
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!quizState) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
        <div className="flex flex-col items-center justify-center py-8">
          <div className="animate-spin text-4xl mb-3">🔮</div>
          <p className="text-slate-400 text-sm">Loading quiz...</p>
        </div>
      </div>
    );
  }

  // Quiz not enabled
  if (!quizState.quiz_enabled) {
    return null;
  }

  // Player has already voted - show waiting state
  if (quizState.has_voted) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
        <div className="text-center mb-4">
          <div className="text-5xl mb-2">🔮</div>
          <h2 className="text-2xl font-bold text-indigo-300 mb-2">
            Vote Submitted!
          </h2>
          <p className="text-slate-300 text-sm">
            {quizState.has_skipped
              ? 'You chose to skip the quiz.'
              : 'Waiting for other players to make their guesses...'}
          </p>
        </div>

        {/* Progress */}
        <div className="bg-slate-800/50 rounded-lg p-4 border border-indigo-500/20">
          <div className="flex justify-between items-center mb-2">
            <span className="text-slate-400 text-sm">Votes submitted</span>
            <span className="text-indigo-300 font-semibold">
              {quizState.votes_submitted} / {quizState.total_players}
            </span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500"
              style={{
                width: `${(quizState.votes_submitted / quizState.total_players) * 100}%`,
              }}
            />
          </div>

          {/* Timer */}
          <div className="flex justify-center mt-3">
            <div className="text-slate-400 text-sm">
              ⏱️ {remainingSeconds}s remaining
            </div>
          </div>
        </div>

        {/* Skip button to go to results */}
        {quizState.votes_submitted >= quizState.connected_players && (
          <button
            onClick={onSkip}
            className="mt-4 w-full py-2 px-4 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Show Results →
          </button>
        )}
      </div>
    );
  }

  // Main quiz interface
  return (
    <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">🔮</div>
        <h2 className="text-2xl font-bold text-indigo-300 mb-2">
          Who Was Merlin?
        </h2>
        <p className="text-slate-300 text-sm">
          Before the roles are revealed, guess who you think was Merlin!
        </p>
      </div>

      {/* Timer */}
      <div className="flex justify-center mb-4">
        <div
          className={`px-4 py-2 rounded-full ${
            remainingSeconds <= 10
              ? 'bg-red-500/20 text-red-300 animate-pulse'
              : 'bg-indigo-500/20 text-indigo-300'
          }`}
        >
          ⏱️ {remainingSeconds}s remaining
        </div>
      </div>

      {/* Player selection */}
      <div className="mb-4">
        <p className="text-slate-300 text-sm mb-3 text-center">
          Select who you believe was Merlin:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {otherPlayers.map((player) => (
            <button
              key={player.id}
              onClick={() => setSelectedPlayerId(player.id)}
              disabled={isSubmitting}
              className={`p-3 rounded-lg border-2 transition-all ${
                selectedPlayerId === player.id
                  ? 'border-indigo-500 bg-indigo-900/50 text-indigo-200'
                  : 'border-slate-600 bg-slate-800/50 text-slate-300 hover:border-indigo-400 hover:bg-slate-700/50'
              } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="text-2xl mb-1">
                {selectedPlayerId === player.id ? '🧙' : '👤'}
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

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => selectedPlayerId && handleSubmitVote(selectedPlayerId)}
          disabled={!selectedPlayerId || isSubmitting}
          className={`w-full py-3 px-4 rounded-lg font-bold text-lg transition-all ${
            selectedPlayerId && !isSubmitting
              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg'
              : 'bg-slate-700 text-slate-400 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">🔮</span> Submitting...
            </span>
          ) : (
            '🧙 Submit My Guess'
          )}
        </button>

        <button
          onClick={handleSkip}
          disabled={isSubmitting}
          className="w-full py-2 px-4 rounded-lg font-medium text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
        >
          Skip Quiz
        </button>
      </div>

      {/* Progress indicator */}
      <div className="mt-4 pt-4 border-t border-slate-700/50">
        <div className="flex justify-between items-center text-xs text-slate-400">
          <span>Votes: {quizState.votes_submitted}/{quizState.total_players}</span>
          <span>Voters: {quizState.connected_players}</span>
        </div>
      </div>
    </div>
  );
}
