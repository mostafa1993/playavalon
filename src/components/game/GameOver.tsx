'use client';

/**
 * GameOver Component
 * Shows final game result with all player roles revealed
 * Feature 010: Now includes Merlin Quiz before role reveal
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MerlinQuiz } from './MerlinQuiz';
import { MerlinQuizResults } from './MerlinQuizResults';
import type { GameWinner, QuestResult, GamePlayer, MerlinQuizState } from '@/types/game';
import { getWinnerAnnouncement, getWinReasonText, countQuestResults } from '@/lib/domain/win-conditions';
import { getPlayerId } from '@/lib/utils/player-id';

// Quiz display states
type QuizDisplayState = 'quiz' | 'results' | 'roles';

// Role display config
const ROLE_DISPLAY: Record<string, { emoji: string; label: string; color: string }> = {
  merlin: { emoji: '🧙', label: 'Merlin', color: 'text-blue-400' },
  percival: { emoji: '🛡️', label: 'Percival', color: 'text-sky-400' },
  servant: { emoji: '⚔️', label: 'Loyal Servant', color: 'text-emerald-400' },
  assassin: { emoji: '🗡️', label: 'Assassin', color: 'text-red-400' },
  morgana: { emoji: '🧙‍♀️', label: 'Morgana', color: 'text-purple-400' },
  mordred: { emoji: '🐍', label: 'Mordred', color: 'text-red-500' },
  oberon_standard: { emoji: '👤', label: 'Oberon', color: 'text-gray-400' },
  oberon_chaos: { emoji: '👻', label: 'Oberon (Chaos)', color: 'text-gray-500' },
  minion: { emoji: '😈', label: 'Minion of Mordred', color: 'text-red-300' },
};

interface GameOverProps {
  gameId: string;
  winner: GameWinner;
  winReason: string;
  questResults: QuestResult[];
  playerRole?: 'good' | 'evil';
  players: GamePlayer[];
  currentPlayerId?: string;
  currentPlayerDbId?: string;
  hasMerlin?: boolean;
}

export function GameOver({
  gameId,
  winner,
  winReason,
  questResults,
  playerRole,
  players,
  currentPlayerId,
  currentPlayerDbId,
  hasMerlin = false,
}: GameOverProps) {
  const router = useRouter();

  // Feature 010: Get localStorage playerId for API calls
  const localStoragePlayerId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return getPlayerId();
  }, []);

  // Feature 010: Quiz state management
  const [quizDisplayState, setQuizDisplayState] = useState<QuizDisplayState>(
    hasMerlin ? 'quiz' : 'roles'
  );
  const [quizState, setQuizState] = useState<MerlinQuizState | null>(null);

  // Fetch initial quiz state to check if quiz is already complete
  const checkQuizState = useCallback(async () => {
    if (!hasMerlin || !gameId || !localStoragePlayerId) return;

    try {
      const response = await fetch(`/api/games/${gameId}/merlin-quiz`, {
        headers: { 'x-player-id': localStoragePlayerId },
      });

      if (response.ok) {
        const data = await response.json();
        setQuizState(data.data);

        // If quiz is already complete, skip to results
        if (data.data.quiz_complete) {
          setQuizDisplayState('results');
        }
      }
    } catch (error) {
      console.error('Failed to check quiz state:', error);
      // On error, skip to roles
      setQuizDisplayState('roles');
    }
  }, [gameId, localStoragePlayerId, hasMerlin]);

  useEffect(() => {
    checkQuizState();
  }, [checkQuizState]);

  // Handle quiz completion
  const handleQuizComplete = useCallback(() => {
    setQuizDisplayState('results');
  }, []);

  // Handle showing roles after results
  const handleShowRoles = useCallback(() => {
    setQuizDisplayState('roles');
  }, []);

  const isWinner = playerRole === winner;
  const score = countQuestResults(questResults);
  const announcement = getWinnerAnnouncement(winner, winReason as '3_quest_successes' | '3_quest_failures' | '5_rejections' | 'assassin_found_merlin');
  const reasonText = getWinReasonText(winReason as '3_quest_successes' | '3_quest_failures' | '5_rejections' | 'assassin_found_merlin');

  // Get role display info
  const getRoleDisplay = (specialRole?: string, role?: 'good' | 'evil') => {
    if (specialRole && ROLE_DISPLAY[specialRole]) {
      return ROLE_DISPLAY[specialRole];
    }
    if (role === 'evil') {
      return ROLE_DISPLAY.minion;
    }
    return ROLE_DISPLAY.servant;
  };

  // Sort players: Good first, then Evil
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.revealed_role === 'good' && b.revealed_role === 'evil') return -1;
    if (a.revealed_role === 'evil' && b.revealed_role === 'good') return 1;
    return 0;
  });

  // Feature 010: Show quiz before role reveal
  if (quizDisplayState === 'quiz' && hasMerlin && localStoragePlayerId && currentPlayerId) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-8">
        {/* Winner Banner (compact) */}
        <div
          className={`
            w-full max-w-md text-center p-4 rounded-xl
            ${winner === 'good'
              ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30'
              : 'bg-gradient-to-br from-red-500/20 to-red-900/20 border border-red-500/30'}
          `}
        >
          <div className="text-4xl mb-2">
            {winner === 'good' ? '🏆' : '💀'}
          </div>
          <h1
            className={`text-xl font-bold ${winner === 'good' ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}
          </h1>
        </div>

        {/* Merlin Quiz */}
        <div className="w-full max-w-md">
          <MerlinQuiz
            gameId={gameId}
            players={players}
            currentPlayerId={localStoragePlayerId}
            currentPlayerDbId={currentPlayerId}
            onQuizComplete={handleQuizComplete}
            onSkip={handleShowRoles}
          />
        </div>

        {/* Skip directly to role reveal */}
        <button
          onClick={handleShowRoles}
          className="text-sm text-slate-400 hover:text-slate-300 underline"
        >
          Skip to role reveal →
        </button>
      </div>
    );
  }

  // Feature 010: Show quiz results before role reveal
  if (quizDisplayState === 'results' && hasMerlin && localStoragePlayerId) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-8">
        {/* Winner Banner (compact) */}
        <div
          className={`
            w-full max-w-md text-center p-4 rounded-xl
            ${winner === 'good'
              ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30'
              : 'bg-gradient-to-br from-red-500/20 to-red-900/20 border border-red-500/30'}
          `}
        >
          <div className="text-4xl mb-2">
            {winner === 'good' ? '🏆' : '💀'}
          </div>
          <h1
            className={`text-xl font-bold ${winner === 'good' ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}
          </h1>
        </div>

        {/* Merlin Quiz Results */}
        <div className="w-full max-w-lg">
          <MerlinQuizResults
            gameId={gameId}
            currentPlayerId={localStoragePlayerId}
            onShowRoles={handleShowRoles}
          />
        </div>
      </div>
    );
  }

  // Original game over view with role reveal
  return (
    <div className="flex flex-col items-center justify-center space-y-5">
      {/* Winner Banner */}
      <div
        className={`
          w-full max-w-md text-center p-7 rounded-2xl
          ${winner === 'good'
            ? 'bg-gradient-to-br from-emerald-500/30 to-emerald-900/30 border border-emerald-500/50'
            : 'bg-gradient-to-br from-red-500/30 to-red-900/30 border border-red-500/50'}
        `}
      >
        <div className="text-6xl mb-3">
          {winner === 'good' ? '🏆' : '💀'}
        </div>
        <h1
          className={`text-3xl font-bold mb-1 ${winner === 'good' ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {winner === 'good' ? 'Good Wins!' : 'Evil Wins!'}
        </h1>
        <p className="text-lg text-avalon-silver/90 mt-1">{announcement}</p>
        <p className="text-sm text-avalon-silver/70">{reasonText}</p>
      </div>

      {/* Personal Result */}
      {playerRole && (
        <div
          className={`
            px-6 py-2.5 rounded-xl text-lg font-bold
            ${isWinner
              ? 'bg-avalon-gold/20 text-avalon-gold border border-avalon-gold/40'
              : 'bg-gray-500/20 text-gray-400 border border-gray-500/40'}
          `}
        >
          {isWinner ? '🎉 You Win!' : '😔 You Lose'}
          <span className="ml-2 text-sm font-normal">
            (You were {playerRole === 'good' ? 'Good' : 'Evil'})
          </span>
        </div>
      )}

      {/* Final Score + Quest Results — combined row */}
      <div className="flex items-center gap-10">
        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className="text-4xl font-bold text-emerald-400">{score.good}</div>
            <div className="text-xs text-avalon-silver/60">Good</div>
          </div>
          <div className="text-base text-avalon-silver/40">vs</div>
          <div className="text-center">
            <div className="text-4xl font-bold text-red-400">{score.evil}</div>
            <div className="text-xs text-avalon-silver/60">Evil</div>
          </div>
        </div>
        <div className="flex gap-2">
          {questResults.map((result, index) => (
            <div
              key={index}
              className={`
                w-10 h-10 rounded-full flex items-center justify-center text-base font-bold
                ${result.result === 'success'
                  ? 'bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400'
                  : 'bg-red-500/20 border-2 border-red-500 text-red-400'}
              `}
            >
              {result.result === 'success' ? '✓' : '✗'}
            </div>
          ))}
          {Array(5 - questResults.length).fill(null).map((_, index) => (
            <div
              key={`empty-${index}`}
              className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold bg-avalon-dark-blue border-2 border-avalon-silver/20 text-avalon-silver/40"
            >
              -
            </div>
          ))}
        </div>
      </div>

      {/* Role Reveal Section */}
      {players.length > 0 && players[0].revealed_role && (
        <div className="w-full max-w-2xl bg-avalon-dark-blue/50 rounded-xl p-5 border border-avalon-silver/20">
          <h3 className="text-lg font-bold text-avalon-silver text-center mb-3">
            <BookOpen size={16} className="inline" /> Role Reveal
          </h3>

          <div className="grid grid-cols-2 gap-3">
            {/* Good Team */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-emerald-400 text-center mb-2">
                ⚔️ Loyal Servants of Arthur
              </h4>
              {sortedPlayers
                .filter(p => p.revealed_role === 'good')
                .map((player) => {
                  const roleDisplay = getRoleDisplay(player.revealed_special_role, player.revealed_role);
                  const isCurrentPlayer = player.id === currentPlayerId;
                  return (
                    <div
                      key={player.id}
                      className={`
                        flex items-center gap-2 p-2 rounded-lg bg-slate-800/50
                        ${isCurrentPlayer ? 'ring-2 ring-avalon-gold' : ''}
                        ${player.was_decoy ? 'ring-1 ring-amber-400/50' : ''}
                        ${player.was_mixed_group ? 'ring-1 ring-cyan-400/50' : ''}
                        ${player.was_mixed_group_with_oberon ? 'ring-1 ring-teal-400/50' : ''}
                      `}
                    >
                      <span className="text-xl">{roleDisplay.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium truncate ${isCurrentPlayer ? 'text-avalon-gold' : 'text-slate-200'}`}>
                          {player.nickname}
                          {isCurrentPlayer && ' (You)'}
                          {/* Feature 009: Decoy indicator */}
                          {player.was_decoy && (
                            <span className="ml-1 text-amber-400" title="This player appeared evil to Merlin">
                              🃏
                            </span>
                          )}
                          {/* Feature 011: Mixed Group indicator */}
                          {player.was_mixed_group && (
                            <span className="ml-1 text-cyan-400" title="This player was in Merlin's mixed intel group">
                              🔀
                            </span>
                          )}
                          {/* Feature 018: Oberon Mixed Group indicator */}
                          {player.was_mixed_group_with_oberon && (
                            <span className="ml-1 text-teal-400" title="This player was mixed with Oberon in Merlin's view">
                              👤🔀
                            </span>
                          )}
                        </div>
                        <div className={`text-xs ${roleDisplay.color} flex items-center gap-1`}>
                          {roleDisplay.label}
                          {/* Feature 009: Decoy label */}
                          {player.was_decoy && (
                            <span className="text-amber-400 font-medium">(Decoy)</span>
                          )}
                          {/* Feature 011: Mixed Group label */}
                          {player.was_mixed_group && (
                            <span className="text-cyan-400 font-medium">(Mixed Group)</span>
                          )}
                          {/* Feature 018: Oberon Mixed Group label */}
                          {player.was_mixed_group_with_oberon && (
                            <span className="text-teal-400 font-medium">(Mixed with Oberon)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Evil Team */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-red-400 text-center mb-2">
                😈 Minions of Mordred
              </h4>
              {sortedPlayers
                .filter(p => p.revealed_role === 'evil')
                .map((player) => {
                  const roleDisplay = getRoleDisplay(player.revealed_special_role, player.revealed_role);
                  const isCurrentPlayer = player.id === currentPlayerId;
                  return (
                    <div
                      key={player.id}
                      className={`
                        flex items-center gap-2 p-2 rounded-lg bg-slate-800/50
                        ${isCurrentPlayer ? 'ring-2 ring-avalon-gold' : ''}
                        ${player.was_mixed_group ? 'ring-1 ring-cyan-400/50' : ''}
                      `}
                    >
                      <span className="text-xl">{roleDisplay.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium truncate ${isCurrentPlayer ? 'text-avalon-gold' : 'text-slate-200'}`}>
                          {player.nickname}
                          {isCurrentPlayer && ' (You)'}
                          {/* Feature 011: Mixed Group indicator */}
                          {player.was_mixed_group && (
                            <span className="ml-1 text-cyan-400" title="This player was in Merlin's mixed intel group">
                              🔀
                            </span>
                          )}
                        </div>
                        <div className={`text-xs ${roleDisplay.color} flex items-center gap-1`}>
                          {roleDisplay.label}
                          {/* Feature 011: Mixed Group label */}
                          {player.was_mixed_group && (
                            <span className="text-cyan-400 font-medium">(Mixed Group)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push('/')}
        >
          Back to Home
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          View Game Again
        </Button>
      </div>
    </div>
  );
}
