'use client';

/**
 * TeamProposal Component
 * For leader to select team members
 * Feature 007: Added real-time draft team broadcasting
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { AlertTriangle } from 'lucide-react';
import { PlayerSeats } from './PlayerSeats';
import type { GamePlayer, QuestRequirement } from '@/types/game';
import { proposeTeam, updateDraftTeam } from '@/lib/api/game';

// Debounce helper for draft team updates
function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  return useCallback((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const newTimeoutId = setTimeout(() => callback(...args), delay);
    setTimeoutId(newTimeoutId);
  }, [callback, delay, timeoutId]);
}

interface TeamProposalProps {
  gameId: string;
  players: GamePlayer[];
  currentPlayerId: string | null;
  questNumber: number;
  questRequirement: QuestRequirement;
  isLeader: boolean;
  onProposalSubmitted: () => void;
  ladyHolderId?: string | null;
  /** Feature 007: Draft team from game state (visible to all players) */
  draftTeam?: string[] | null;
  /** Feature 007: Whether draft is in progress */
  isDraftInProgress?: boolean;
}

export function TeamProposal({
  gameId,
  players,
  currentPlayerId,
  questNumber,
  questRequirement,
  isLeader,
  onProposalSubmitted,
  ladyHolderId,
  draftTeam,
  isDraftInProgress = false,
}: TeamProposalProps) {
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  const leader = players.find((p) => p.is_leader);
  const requiredSize = questRequirement.size;

  // Feature 007: Debounced broadcast function (200ms)
  const broadcastDraftTeam = useDebouncedCallback(
    async (teamIds: string[]) => {
      try {
        await updateDraftTeam(gameId, teamIds);
        setBroadcastError(null);
      } catch (err) {
        console.error('Failed to broadcast draft team:', err);
        setBroadcastError('Unable to broadcast selection');
        // Don't block UI - local state still updates
      }
    },
    200
  );

  const handlePlayerClick = (playerId: string) => {
    if (!isLeader) return;

    setSelectedTeam((prev) => {
      const newTeam = prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : prev.length < requiredSize
        ? [...prev, playerId]
        : prev;

      // Feature 007: Broadcast to all players (debounced)
      broadcastDraftTeam(newTeam);

      return newTeam;
    });
  };

  const handleSubmit = async () => {
    if (selectedTeam.length !== requiredSize) return;

    setSubmitting(true);
    setError(null);

    try {
      await proposeTeam(gameId, selectedTeam);
      setSelectedTeam([]);
      onProposalSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to propose team');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Player Selection Circle */}
      <PlayerSeats
        players={players}
        currentPlayerId={currentPlayerId}
        selectedTeam={selectedTeam}
        onPlayerClick={handlePlayerClick}
        selectable={isLeader}
        maxSelectable={requiredSize}
        ladyHolderId={ladyHolderId}
        draftTeam={draftTeam}
        isDraftInProgress={isDraftInProgress}
        gamePhase="team_building"
        questNumber={questNumber}
        questRequirement={questRequirement}
        isCurrentPlayerLeader={isLeader}
      />

      {/* Feature 007: Selection count visible to all players */}
      {/* Leader sees their local state, others see server state */}
      {(isLeader || isDraftInProgress) && (
        <div className="text-center">
          <p className={`text-sm font-semibold ${
            (isLeader ? selectedTeam.length : (draftTeam?.length || 0)) === requiredSize
              ? 'text-green-400'
              : 'text-cyan-400'
          }`}>
            {isLeader ? 'Your selection' : 'Selecting team'}: {isLeader ? selectedTeam.length : (draftTeam?.length || 0)} / {requiredSize}
          </p>
        </div>
      )}

      {/* Selection Status */}
      {isLeader && (
        <div className="text-center">
          <p className="text-avalon-silver/60 text-sm">
            {selectedTeam.length} / {requiredSize} selected (local)
          </p>

          {/* Selected Players Preview */}
          {selectedTeam.length > 0 && (
            <div className="flex justify-center gap-2 mt-2 flex-wrap">
              {selectedTeam.map((id) => {
                const player = players.find((p) => p.id === id);
                return (
                  <span
                    key={id}
                    className="px-3 py-1 bg-cyan-500/20 border border-cyan-500/40 rounded-full text-cyan-400 text-sm"
                  >
                    {player?.nickname || 'Unknown'}
                  </span>
                );
              })}
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm mt-2">{error}</p>
          )}

          {/* Feature 007: Broadcast error (doesn't block submission) */}
          {broadcastError && (
            <p className="text-orange-400 text-xs mt-1"><AlertTriangle size={16} className="inline" /> {broadcastError}</p>
          )}

          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={selectedTeam.length !== requiredSize || submitting}
            isLoading={submitting}
            className="mt-4"
          >
            Propose Team
          </Button>
        </div>
      )}

      {/* Waiting message for non-leaders */}
      {!isLeader && (
        <div className="text-center text-avalon-silver/60 animate-pulse">
          Waiting for {leader?.nickname} to propose a team...
        </div>
      )}
    </div>
  );
}
