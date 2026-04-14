'use client';

/**
 * MerlinQuizResults Component
 * Feature 010: Endgame Merlin Quiz
 *
 * Displays the quiz results showing vote counts for each player
 * and reveals who the actual Merlin was.
 */

import { useState, useEffect, useCallback } from 'react';
import { BookOpen } from 'lucide-react';
import type { MerlinQuizResults as QuizResults, MerlinQuizResultEntry } from '@/types/game';

interface MerlinQuizResultsProps {
  gameId: string;
  currentPlayerId: string;
  onShowRoles: () => void;
}

export function MerlinQuizResults({
  gameId,
  currentPlayerId,
  onShowRoles,
}: MerlinQuizResultsProps) {
  const [results, setResults] = useState<QuizResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMerlin, setShowMerlin] = useState(false);

  // Fetch quiz results
  const fetchResults = useCallback(async () => {
    try {
      const response = await fetch(`/api/games/${gameId}/merlin-quiz/results`, {
        headers: {
          'x-player-id': currentPlayerId,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to load results');
      }

      const data = await response.json();
      setResults(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setIsLoading(false);
    }
  }, [gameId, currentPlayerId]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin text-4xl">🔮</div>
        </div>
        <p className="text-center text-slate-400">Calculating results...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-red-900 rounded-xl p-6 shadow-2xl border border-red-500/30">
        <div className="text-center">
          <div className="text-4xl mb-2">❌</div>
          <p className="text-red-300 mb-4">{error}</p>
          <button
            onClick={onShowRoles}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            Skip to Role Reveal
          </button>
        </div>
      </div>
    );
  }

  // No results (quiz not complete or no votes)
  if (!results || !results.results) {
    return (
      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
        <div className="text-center">
          <div className="text-4xl mb-2">🔮</div>
          <p className="text-slate-300 mb-4">No quiz results available</p>
          <button
            onClick={onShowRoles}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            Show Roles
          </button>
        </div>
      </div>
    );
  }

  // Get entries sorted by vote count
  const sortedResults = [...results.results].sort((a, b) => b.vote_count - a.vote_count);

  return (
    <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 shadow-2xl border border-indigo-500/30">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">🔮</div>
        <h2 className="text-2xl font-bold text-indigo-300 mb-2">
          Quiz Results
        </h2>
        <p className="text-slate-300 text-sm">
          Here&apos;s who everyone thought was Merlin!
        </p>
      </div>

      {/* Stats */}
      <div className="flex justify-center gap-4 mb-6">
        <div className="text-center px-4 py-2 bg-slate-800/50 rounded-lg">
          <div className="text-lg font-bold text-indigo-300">{results.total_votes}</div>
          <div className="text-xs text-slate-400">Votes Cast</div>
        </div>
        {results.skipped_count > 0 && (
          <div className="text-center px-4 py-2 bg-slate-800/50 rounded-lg">
            <div className="text-lg font-bold text-slate-400">{results.skipped_count}</div>
            <div className="text-xs text-slate-400">Skipped</div>
          </div>
        )}
      </div>

      {/* Results Table */}
      <div className="bg-slate-800/50 rounded-lg overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left p-3 text-sm font-medium text-slate-400">Player</th>
              <th className="text-right p-3 text-sm font-medium text-slate-400">Votes</th>
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((entry, index) => (
              <ResultRow
                key={entry.player_id}
                entry={entry}
                rank={index + 1}
                showMerlin={showMerlin}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Reveal Merlin Button */}
      {!showMerlin && (
        <button
          onClick={() => setShowMerlin(true)}
          className="w-full py-3 px-4 rounded-lg font-bold text-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg transition-all mb-4"
        >
          🧙 Reveal Who Was Merlin
        </button>
      )}

      {/* Merlin Reveal */}
      {showMerlin && (
        <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl p-4 border-2 border-blue-400/50 mb-4 text-center animate-pulse-once">
          <div className="text-3xl mb-2">🧙</div>
          <p className="text-slate-300 text-sm mb-1">The real Merlin was...</p>
          <p className="text-2xl font-bold text-blue-300">
            {results.actual_merlin_nickname}
          </p>
          {sortedResults.length > 0 && sortedResults[0].is_actual_merlin && (
            <p className="text-emerald-400 text-sm mt-2">
              ✅ Most players guessed correctly!
            </p>
          )}
          {sortedResults.length > 0 && !sortedResults[0].is_actual_merlin && sortedResults[0].vote_count > 0 && (
            <p className="text-amber-400 text-sm mt-2">
              ❌ Most players were fooled!
            </p>
          )}
        </div>
      )}

      {/* Continue Button */}
      <button
        onClick={onShowRoles}
        className={`w-full py-3 px-4 rounded-lg font-medium ${
          showMerlin
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
        } transition-colors`}
      >
        {showMerlin ? <><BookOpen size={16} className="inline" /> Show All Roles</> : 'Skip to Role Reveal'}
      </button>
    </div>
  );
}

// Individual result row component
function ResultRow({
  entry,
  rank,
  showMerlin,
}: {
  entry: MerlinQuizResultEntry;
  rank: number;
  showMerlin: boolean;
}) {
  const isMerlin = showMerlin && entry.is_actual_merlin;
  const isMostVoted = entry.is_most_voted && entry.vote_count > 0;

  return (
    <tr
      className={`
        border-b border-slate-700/50 transition-colors
        ${isMerlin ? 'bg-blue-500/20' : ''}
        ${isMostVoted && !isMerlin ? 'bg-indigo-500/10' : ''}
      `}
    >
      <td className="p-3">
        <div className="flex items-center gap-2">
          {/* Rank badge */}
          {rank <= 3 && entry.vote_count > 0 && (
            <span className="text-lg">
              {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
            </span>
          )}

          {/* Player name */}
          <span className={`font-medium ${isMerlin ? 'text-blue-300' : 'text-slate-200'}`}>
            {entry.nickname}
          </span>

          {/* Merlin indicator */}
          {isMerlin && (
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-blue-500/30 text-blue-300 border border-blue-400/50">
              🧙 Merlin
            </span>
          )}

          {/* Most voted indicator */}
          {isMostVoted && !isMerlin && (
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-indigo-500/30 text-indigo-300">
              Most Voted
            </span>
          )}
        </div>
      </td>
      <td className="p-3 text-right">
        <span
          className={`
            font-bold text-lg
            ${entry.vote_count === 0 ? 'text-slate-500' : ''}
            ${isMostVoted ? 'text-indigo-300' : 'text-slate-300'}
            ${isMerlin ? 'text-blue-300' : ''}
          `}
        >
          {entry.vote_count}
        </span>
      </td>
    </tr>
  );
}
