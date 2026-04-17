'use client';

/**
 * WatcherGameBoard Component
 * Feature 015: Read-only game view for spectators
 *
 * CRITICAL: This component has NO interactive controls
 * - No voting buttons
 * - No quest action buttons
 * - No team selection
 * - No assassin guessing
 * - No Lady investigation
 *
 * Reuses display components from the player view.
 */

import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';
import { useWatcherState } from '@/hooks/useWatcherState';
import { QuestTracker } from './QuestTracker';
import { PlayerSeats } from './PlayerSeats';
import { RulebookModal } from '@/components/rulebook/RulebookModal';
import { Button } from '@/components/ui/Button';
import { getPhaseName, getPhaseDescription } from '@/lib/domain/game-state-machine';
import { getQuestRequirement } from '@/lib/domain/quest-config';
import { Eye } from 'lucide-react';
import type { WatcherGameState } from '@/types/watcher';

interface WatcherGameBoardProps {
  gameId: string;
}

export function WatcherGameBoard({ gameId }: WatcherGameBoardProps) {
  const router = useRouter();
  const { gameState, loading, error, refetch } = useWatcherState(gameId);
  const [showRulebook, setShowRulebook] = useState(false);
  const [showVoteReveal, setShowVoteReveal] = useState(false);

  // Track seen proposals to prevent re-showing on poll
  const getSeenProposals = useCallback((): Set<string> => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem(`avalon_watcher_seen_proposals_${gameId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }, [gameId]);

  const markProposalSeen = useCallback((proposalId: string) => {
    if (typeof window === 'undefined') return;
    try {
      const seen = getSeenProposals();
      seen.add(proposalId);
      const arr = Array.from(seen).slice(-20);
      localStorage.setItem(`avalon_watcher_seen_proposals_${gameId}`, JSON.stringify(arr));
    } catch {
      // Ignore localStorage errors
    }
  }, [gameId, getSeenProposals]);

  // Show vote reveal when there's a new resolved proposal
  useEffect(() => {
    if (gameState?.last_vote_result) {
      const proposalId = gameState.last_vote_result.proposal_id;
      const seenProposals = getSeenProposals();
      if (!seenProposals.has(proposalId)) {
        markProposalSeen(proposalId);
        setShowVoteReveal(true);
      }
    }
  }, [gameState?.last_vote_result, getSeenProposals, markProposalSeen]);

  // Auto-dismiss vote reveal after 10 seconds
  useEffect(() => {
    if (showVoteReveal) {
      const timer = setTimeout(() => {
        setShowVoteReveal(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showVoteReveal]);

  // Handle stop watching
  const handleStopWatching = useCallback(async () => {
    try {
      await fetch(`/api/watch/${gameId}/leave`, {
        method: 'POST',
      });
    } catch {
      // Ignore errors on leave
    }
    router.push('/');
  }, [gameId, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-avalon-gold border-t-transparent mx-auto mb-4" />
          <p className="text-avalon-silver/80">Loading game...</p>
        </div>
      </div>
    );
  }

  if (error || !gameState) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || 'Failed to load game'}</p>
          <div className="flex gap-4 justify-center">
            <Button variant="secondary" onClick={() => refetch()}>
              Try Again
            </Button>
            <Button variant="ghost" onClick={() => router.push('/')}>
              Go Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { game, players, current_proposal, lady_of_lake } = gameState;

  // Game Over - show final state with roles revealed
  if (game.phase === 'game_over' && game.winner) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <WatcherHeader onStopWatching={handleStopWatching} />
        <WatcherGameOverView gameState={gameState} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Watcher Header */}
      <WatcherHeader onStopWatching={handleStopWatching} />

      {/* Phase Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-avalon-gold">
            {getPhaseName(game.phase)}
          </h1>
          <p className="text-xs text-avalon-text-muted">
            {getPhaseDescription(game.phase)}
          </p>
        </div>

        <button
          onClick={() => setShowRulebook(true)}
          className="px-2 py-1.5 text-xs rounded-md border border-avalon-dark-border text-avalon-text-secondary hover:bg-avalon-dark-lighter transition-colors"
          title="View Rulebook"
        >
          ?
        </button>
      </div>

      {/* Quest Tracker */}
      <QuestTracker
        playerCount={game.player_count}
        currentQuest={game.current_quest}
        questResults={game.quest_results}
        voteTrack={game.vote_track}
      />

      {/* Lady of the Lake Investigation Announcement */}
      {lady_of_lake?.last_investigation && (
        <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 flex items-center gap-3">
          <span className="text-2xl">🌊</span>
          <div className="flex-1">
            <p className="text-blue-200 text-sm">
              <span className="font-medium">{lady_of_lake.last_investigation.investigator_display_name}</span>
              {' '}investigated{' '}
              <span className="font-medium">{lady_of_lake.last_investigation.target_display_name}</span>
            </p>
            <p className="text-blue-300/60 text-xs">
              🌊 {lady_of_lake.holder_display_name} now holds the Lady of the Lake
            </p>
          </div>
        </div>
      )}

      {/* Phase Content - READ ONLY */}
      <div className="bg-avalon-dark-blue/30 rounded-xl p-6 border border-avalon-silver/10">
        {showVoteReveal && gameState.last_vote_result ? (
          <div className="animate-fade-in">
            <PlayerSeats
              players={players}
              currentPlayerId={null}
              ladyHolderId={game.lady_holder_id}
              gamePhase={game.phase}
              questNumber={game.current_quest}
              voteRevealActive={true}
              voteRevealData={{
                votes: gameState.last_vote_result.votes,
                isApproved: gameState.last_vote_result.is_approved,
                approveCount: gameState.last_vote_result.approve_count,
                rejectCount: gameState.last_vote_result.reject_count,
              }}
            />
            <p className="text-center text-avalon-silver/60 text-sm mt-4 animate-pulse">
              {gameState.last_vote_result.is_approved
                ? 'Team approved! Proceeding to quest...'
                : 'Team rejected! New leader selecting...'}
            </p>
          </div>
        ) : (
          <WatcherPhaseContent gameState={gameState} />
        )}
      </div>

      {/* Rulebook Modal */}
      <RulebookModal isOpen={showRulebook} onClose={() => setShowRulebook(false)} />
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

interface WatcherHeaderProps {
  onStopWatching: () => void;
}

function WatcherHeader({ onStopWatching }: WatcherHeaderProps) {
  return (
    <div className="flex items-center justify-between bg-avalon-navy/50 rounded-md px-3 py-1.5 border border-avalon-dark-border">
      <div className="flex items-center gap-2">
        <span className="text-xl"><Eye size={16} /></span>
        <span className="text-avalon-silver text-sm font-medium">Watching</span>
      </div>
      <button
        onClick={onStopWatching}
        className="text-avalon-text-muted hover:text-red-400 transition-colors text-xs"
      >
        Stop Watching
      </button>
    </div>
  );
}

interface WatcherPhaseContentProps {
  gameState: WatcherGameState;
}

function WatcherPhaseContent({ gameState }: WatcherPhaseContentProps) {
  const { game, players, current_proposal, quest_requirement } = gameState;
  const leader = players.find(p => p.is_leader);

  // Team Building Phase - matches player view (TeamProposal component)
  if (game.phase === 'team_building') {
    const draftInProgress = !!(game.draft_team && game.draft_team.length > 0);

    return (
      <div className="space-y-4">
        {/* Player Selection Circle - same as players see */}
        <PlayerSeats
          players={players}
          currentPlayerId={null}
          ladyHolderId={game.lady_holder_id}
          gamePhase={game.phase}
          questNumber={game.current_quest}
          draftTeam={game.draft_team}
          isDraftInProgress={draftInProgress}
          questRequirement={quest_requirement}
        />

        {/* Selection count - same format as players see */}
        {draftInProgress && (
          <div className="text-center">
            <p className={`text-sm font-semibold ${
              (game.draft_team?.length || 0) === quest_requirement.size
                ? 'text-green-400'
                : 'text-cyan-400'
            }`}>
              Selecting team: {game.draft_team?.length || 0} / {quest_requirement.size}
            </p>
          </div>
        )}

        {/* Waiting message - same as non-leaders see */}
        <div className="text-center text-avalon-silver/60 animate-pulse">
          Waiting for {leader?.display_name || 'Leader'} to propose a team...
        </div>
      </div>
    );
  }

  // Voting Phase - matches player view (VotingPanel component)
  if (game.phase === 'voting' && current_proposal) {
    return (
      <div className="space-y-4">
        {/* Player seats with team highlighted - same as players see */}
        <PlayerSeats
          players={players}
          currentPlayerId={null}
          ladyHolderId={game.lady_holder_id}
          gamePhase={game.phase}
          questNumber={game.current_quest}
        />

        {/* Vote Progress - same as players see */}
        <div className="text-center text-sm text-avalon-silver/70">
          <span className="text-avalon-gold font-medium">{gameState.votes_submitted}</span>
          {' / '}
          <span>{gameState.total_players}</span>
          {' votes submitted'}
        </div>

        {/* Waiting message */}
        <div className="text-center text-avalon-silver/60 animate-pulse">
          Waiting for all players to vote...
        </div>
      </div>
    );
  }

  // Quest Phase - matches player view (QuestExecution component)
  if (game.phase === 'quest' && current_proposal) {
    return (
      <div className="space-y-4">
        {/* Player seats with team highlighted - same as players see */}
        <PlayerSeats
          players={players}
          currentPlayerId={null}
          ladyHolderId={game.lady_holder_id}
          gamePhase={game.phase}
          questNumber={game.current_quest}
        />

        {/* Action Progress - same as players see */}
        <div className="text-center text-sm text-avalon-silver/70">
          <span className="text-avalon-gold font-medium">{gameState.actions_submitted}</span>
          {' / '}
          <span>{gameState.total_team_members}</span>
          {' quest actions submitted'}
        </div>

        {/* Waiting message */}
        <div className="text-center text-avalon-silver/60 animate-pulse">
          Team is executing the quest...
        </div>
      </div>
    );
  }

  // Quest Result Phase - matches player view (QuestResultDisplay component)
  if (game.phase === 'quest_result' && game.quest_results.length > 0) {
    const lastResult = game.quest_results[game.quest_results.length - 1];
    const failsRequired = getQuestRequirement(game.player_count, game.quest_results.length).fails;

    return (
      <div className="space-y-4">
        {/* Player seats */}
        <PlayerSeats
          players={players}
          currentPlayerId={null}
          ladyHolderId={game.lady_holder_id}
          gamePhase={game.phase}
          questNumber={game.current_quest}
        />

        {/* Quest Result - same format as players see */}
        <div className="text-center">
          <div
            className={`
              inline-block px-6 py-3 rounded-full text-xl font-bold
              ${lastResult.result === 'success'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-red-500/20 text-red-400'}
            `}
          >
            {lastResult.result === 'success' ? '✅ SUCCESS' : '❌ FAILED'}
          </div>

          <div className="mt-2 text-sm text-avalon-silver/70">
            <p>
              {lastResult.success_count} success / {lastResult.fail_count} fail
              {failsRequired > 1 && ` (${failsRequired} fails required)`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Lady of the Lake Phase - matches player view (LadyOfLakePhase component)
  if (game.phase === 'lady_of_lake') {
    const holder = players.find(p => p.display_name === gameState.lady_of_lake?.holder_display_name);

    return (
      <div className="space-y-4">
        {/* Player seats */}
        <PlayerSeats
          players={players}
          currentPlayerId={null}
          ladyHolderId={game.lady_holder_id}
          gamePhase={game.phase}
          questNumber={game.current_quest}
        />

        {/* Waiting message */}
        <div className="text-center text-avalon-silver/60 animate-pulse">
          <span className="font-medium text-blue-300">{holder?.display_name || 'Lady Holder'}</span>
          {' '}is choosing a player to investigate...
        </div>
      </div>
    );
  }

  // Assassin Phase - matches player view (AssassinPhase component)
  if (game.phase === 'assassin') {
    return (
      <div className="space-y-4">
        {/* Player seats */}
        <PlayerSeats
          players={players}
          currentPlayerId={null}
          ladyHolderId={game.lady_holder_id}
          gamePhase={game.phase}
          questNumber={game.current_quest}
        />

        {/* Waiting message */}
        <div className="text-center text-avalon-silver/60 animate-pulse">
          Good has won 3 quests! The Assassin is choosing who to eliminate...
        </div>
      </div>
    );
  }

  // Default fallback
  return (
    <PlayerSeats
      players={players}
      currentPlayerId={null}
      ladyHolderId={game.lady_holder_id}
      gamePhase={game.phase}
      questNumber={game.current_quest}
    />
  );
}

interface WatcherGameOverViewProps {
  gameState: WatcherGameState;
}

function WatcherGameOverView({ gameState }: WatcherGameOverViewProps) {
  const { game, players } = gameState;

  return (
    <div className="space-y-6">
      {/* Result Header */}
      <div className="text-center">
        <h1
          className={`text-3xl font-bold mb-2 ${
            game.winner === 'good' ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {game.winner === 'good' ? '🛡️ Good Wins!' : '🗡️ Evil Wins!'}
        </h1>
        <p className="text-avalon-silver/70">{game.win_reason || 'Game Over'}</p>
      </div>

      {/* Quest Summary */}
      <QuestTracker
        playerCount={game.player_count}
        currentQuest={game.current_quest}
        questResults={game.quest_results}
        voteTrack={game.vote_track}
      />

      {/* Role Reveal */}
      <div className="bg-avalon-dark-blue/30 rounded-xl p-6 border border-avalon-silver/10">
        <h3 className="text-lg font-semibold text-avalon-gold mb-4 text-center">
          Role Reveal
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {/* Good Team */}
          <div>
            <h4 className="text-sm font-medium text-emerald-400 mb-2">🛡️ Good Team</h4>
            <div className="space-y-1">
              {players
                .filter(p => p.revealed_role === 'good')
                .map(p => (
                  <div key={p.id} className="text-sm">
                    <span className="text-avalon-silver">{p.display_name}</span>
                    {p.revealed_special_role && (
                      <span className="text-emerald-300/70 ml-1 text-xs capitalize">
                        ({p.revealed_special_role.replace(/_/g, ' ')})
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Evil Team */}
          <div>
            <h4 className="text-sm font-medium text-red-400 mb-2">🗡️ Evil Team</h4>
            <div className="space-y-1">
              {players
                .filter(p => p.revealed_role === 'evil')
                .map(p => (
                  <div key={p.id} className="text-sm">
                    <span className="text-avalon-silver">{p.display_name}</span>
                    {p.revealed_special_role && (
                      <span className="text-red-300/70 ml-1 text-xs capitalize">
                        ({p.revealed_special_role.replace(/_/g, ' ')})
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
