'use client';

/**
 * GameBoard Component
 * Main game UI container
 */

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';
import { QuestTracker } from './QuestTracker';
import { TeamProposal } from './TeamProposal';
import { VotingPanel } from './VotingPanel';
import { QuestExecution } from './QuestExecution';
import { QuestResultDisplay } from './QuestResultDisplay';
import { LadyOfLakePhase } from './LadyOfLakePhase';
import { PlayerSeats } from './PlayerSeats';
import { InvestigationResult } from './InvestigationResult';
import { AssassinPhase } from './AssassinPhase';
import { GameOver } from './GameOver';
import { SessionTakeoverAlert } from '@/components/SessionTakeoverAlert';
import { RulebookModal } from '@/components/rulebook/RulebookModal';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getPhaseName, getPhaseDescription } from '@/lib/domain/game-state-machine';
import { getQuestRequirement } from '@/lib/domain/quest-config';

interface GameBoardProps {
  gameId: string;
}

export function GameBoard({ gameId }: GameBoardProps) {
  const router = useRouter();
  const { gameState, currentPlayerId, playerRole, specialRole, roomCode, loading, error, sessionTakenOver, refetch } = useGameState(gameId);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showRulebook, setShowRulebook] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyRoomCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  const [showVoteReveal, setShowVoteReveal] = useState(false);
  const [investigationResult, setInvestigationResult] = useState<{
    targetNickname: string;
    result: 'good' | 'evil';
    newHolderNickname: string;
  } | null>(null);

  // Track seen proposals in localStorage to persist across page refreshes
  const getSeenProposals = useCallback((): Set<string> => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem(`avalon_seen_proposals_${gameId}`);
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
      // Keep only last 20 to prevent localStorage bloat
      const arr = Array.from(seen).slice(-20);
      localStorage.setItem(`avalon_seen_proposals_${gameId}`, JSON.stringify(arr));
    } catch {
      // Ignore localStorage errors
    }
  }, [gameId, getSeenProposals]);

  // Show vote reveal when there's a new resolved proposal (not seen before)
  useEffect(() => {
    if (gameState?.last_vote_result) {
      const proposalId = gameState.last_vote_result.proposal_id;
      const seenProposals = getSeenProposals();
      // Only show if this proposal hasn't been seen before (including after refresh)
      if (!seenProposals.has(proposalId)) {
        markProposalSeen(proposalId);
        setShowVoteReveal(true);
      }
    }
  }, [gameState?.last_vote_result, getSeenProposals, markProposalSeen]);

  // Feature 013: Auto-dismiss vote reveal after 10 seconds
  useEffect(() => {
    if (showVoteReveal) {
      const timer = setTimeout(() => {
        setShowVoteReveal(false);
      }, 10000); // 10 seconds

      return () => clearTimeout(timer);
    }
  }, [showVoteReveal]);

  const handleVoteRevealComplete = useCallback(() => {
    setShowVoteReveal(false);
  }, []);

  const handleAction = useCallback(() => {
    // Refetch after any action to get latest state
    refetch();
  }, [refetch]);

  const handleInvestigationComplete = useCallback((result: 'good' | 'evil', newHolderNickname: string) => {
    // Find the target player nickname
    const targetId = gameState?.players.find(p =>
      gameState.lady_of_lake?.investigated_player_ids.includes(p.id) === false &&
      p.id !== gameState.lady_of_lake?.holder_id
    );
    // For now, we'll get it from the last investigation
    const targetNickname = gameState?.lady_of_lake?.last_investigation?.target_nickname || 'Unknown';

    setInvestigationResult({
      targetNickname: newHolderNickname, // The new holder IS the target
      result,
      newHolderNickname,
    });
  }, [gameState]);

  const handleInvestigationContinue = useCallback(() => {
    setInvestigationResult(null);
    refetch();
  }, [refetch]);

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
          <Button variant="secondary" onClick={() => refetch()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  const { game, players, current_proposal, quest_requirement, lady_of_lake, draft_team, is_draft_in_progress } = gameState;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const isLeader = currentPlayer?.is_leader || false;
  const ladyHolderId = lady_of_lake?.holder_id || game.lady_holder_id || null;

  // Game Over - Feature 010: Check if Merlin was in game for quiz
  // Merlin exists if any player has revealed_special_role === 'merlin'
  const hasMerlin = players.some(p => p.revealed_special_role === 'merlin');

  if (game.phase === 'game_over' && game.winner) {
    return (
      <div className="max-w-2xl mx-auto">
        <GameOver
          gameId={gameId}
          winner={game.winner}
          winReason={game.win_reason || ''}
          questResults={game.quest_results}
          playerRole={playerRole}
          players={players}
          currentPlayerId={currentPlayerId ?? undefined}
          currentPlayerDbId={currentPlayerId ?? undefined}
          hasMerlin={hasMerlin}
        />
      </div>
    );
  }

  // Assassin Phase
  if (game.phase === 'assassin' && gameState.assassin_phase) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Quest Tracker - still show progress */}
        <QuestTracker
          playerCount={game.player_count}
          currentQuest={game.current_quest}
          questResults={game.quest_results}
          voteTrack={game.vote_track}
        />

        {/* Assassin Phase UI */}
        <AssassinPhase
          gameId={gameId}
          players={players}
          assassinPhase={gameState.assassin_phase}
          isAssassin={gameState.is_assassin}
          currentPlayerId={currentPlayerId ?? ''}
          onGuessSubmitted={handleAction}
        />
      </div>
    );
  }

  // Lady of the Lake Phase
  if (game.phase === 'lady_of_lake' && gameState.lady_of_lake) {
    return (
      <>
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Quest Tracker - still show progress */}
          <QuestTracker
            playerCount={game.player_count}
            currentQuest={game.current_quest}
            questResults={game.quest_results}
            voteTrack={game.vote_track}
          />

          {/* Lady of the Lake Phase UI */}
          <LadyOfLakePhase
            gameId={gameId}
            players={players}
            ladyState={gameState.lady_of_lake}
            currentPlayerId={currentPlayerId ?? ''}
            onInvestigationComplete={handleInvestigationComplete}
          />
        </div>

        {/* Investigation Result Modal - rendered outside main div for overlay */}
        {investigationResult && (
          <InvestigationResult
            targetNickname={investigationResult.targetNickname}
            result={investigationResult.result}
            newHolderNickname={investigationResult.newHolderNickname}
            onContinue={handleInvestigationContinue}
          />
        )}
      </>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Compact Room Code Header */}
      {roomCode && (
        <div className="flex items-center justify-between bg-avalon-navy/50 rounded-md px-3 py-1.5 border border-avalon-dark-border">
          <button
            onClick={() => router.push('/')}
            className="text-avalon-text-muted hover:text-avalon-gold transition-colors text-xs flex items-center gap-1"
          >
            ← Home
          </button>
          <button
            onClick={handleCopyRoomCode}
            className="flex items-center gap-1.5 group"
          >
            <span className="text-avalon-text-muted text-xs">Room</span>
            <span className="font-mono font-bold text-avalon-gold text-sm tracking-wider">
              {roomCode}
            </span>
            <span className={`text-xs transition-all ${copied ? 'text-good' : 'text-avalon-text-muted group-hover:text-avalon-gold'}`}>
              {copied ? '✓' : '📋'}
            </span>
          </button>
        </div>
      )}

      {/* Compact Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-avalon-gold">
            {getPhaseName(game.phase)}
          </h1>
          <p className="text-xs text-avalon-text-muted">
            {getPhaseDescription(game.phase)}
          </p>
        </div>

        {/* Compact Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRulebook(true)}
            className="px-2 py-1.5 text-xs rounded-md border border-avalon-dark-border text-avalon-text-secondary hover:bg-avalon-dark-lighter transition-colors"
            title="View Rulebook"
          >
            ?
          </button>
          <button
            onClick={() => setShowRoleModal(true)}
            className="px-3 py-1.5 text-xs rounded-md border border-avalon-dark-border text-avalon-text-secondary hover:bg-avalon-dark-lighter transition-colors"
          >
            👁️ Role
          </button>
        </div>
      </div>

      {/* Quest Tracker */}
      <QuestTracker
        playerCount={game.player_count}
        currentQuest={game.current_quest}
        questResults={game.quest_results}
        voteTrack={game.vote_track}
      />

      {/* Lady of the Lake Investigation Announcement (visible to all players) */}
      {lady_of_lake?.last_investigation && (
        <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 flex items-center gap-3">
          <span className="text-2xl">🌊</span>
          <div className="flex-1">
            <p className="text-blue-200 text-sm">
              <span className="font-medium">{lady_of_lake.last_investigation.investigator_nickname}</span>
              {' '}investigated{' '}
              <span className="font-medium">{lady_of_lake.last_investigation.target_nickname}</span>
            </p>
            <p className="text-blue-300/60 text-xs">
              🌊 {lady_of_lake.holder_nickname} now holds the Lady of the Lake
            </p>
          </div>
        </div>
      )}

      {/* Phase-specific content */}
      <div className="bg-avalon-dark-blue/30 rounded-xl p-6 border border-avalon-silver/10">
        {/* Feature 013: Inline Vote Reveal - REPLACES phase content temporarily */}
        {showVoteReveal && gameState.last_vote_result ? (
          <div className="animate-fade-in">
            <PlayerSeats
              players={players}
              currentPlayerId={currentPlayerId}
              ladyHolderId={ladyHolderId}
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
            {/* Brief status message */}
            <p className="text-center text-avalon-silver/60 text-sm mt-4 animate-pulse">
              {gameState.last_vote_result.is_approved
                ? 'Team approved! Proceeding to quest...'
                : 'Team rejected! New leader selecting...'}
            </p>
          </div>
        ) : (
          <>
            {/* Team Building */}
            {game.phase === 'team_building' && (
              <TeamProposal
                gameId={gameId}
                players={players}
                currentPlayerId={currentPlayerId}
                questNumber={game.current_quest}
                questRequirement={quest_requirement}
                isLeader={isLeader}
                onProposalSubmitted={handleAction}
                ladyHolderId={ladyHolderId}
                draftTeam={draft_team}
                isDraftInProgress={is_draft_in_progress}
              />
            )}

            {/* Voting */}
            {game.phase === 'voting' && current_proposal && (
              <VotingPanel
                gameId={gameId}
                players={players}
                currentPlayerId={currentPlayerId}
                proposal={current_proposal}
                myVote={gameState.my_vote}
                votesSubmitted={gameState.votes_submitted}
                totalPlayers={gameState.total_players}
                onVoteSubmitted={handleAction}
                ladyHolderId={ladyHolderId}
                questNumber={game.current_quest}
              />
            )}

            {/* Quest */}
            {game.phase === 'quest' && current_proposal && (
              <QuestExecution
                gameId={gameId}
                players={players}
                currentPlayerId={currentPlayerId}
                proposal={current_proposal}
                questNumber={game.current_quest}
                questRequirement={quest_requirement}
                amTeamMember={gameState.am_team_member}
                canSubmitAction={gameState.can_submit_action}
                hasSubmittedAction={gameState.has_submitted_action}
                actionsSubmitted={gameState.actions_submitted}
                totalTeamMembers={gameState.total_team_members}
                playerRole={playerRole}
                specialRole={specialRole as import('@/types/database').SpecialRole | undefined}
                onActionSubmitted={handleAction}
              />
            )}

            {/* Quest Result */}
            {game.phase === 'quest_result' && game.quest_results.length > 0 && (
              <QuestResultDisplay
                gameId={gameId}
                questResult={game.quest_results[game.quest_results.length - 1]}
                failsRequired={getQuestRequirement(game.player_count, game.quest_results.length).fails}
                onContinue={handleAction}
              />
            )}
          </>
        )}
      </div>

      {/* Role Modal */}
      <Modal
        isOpen={showRoleModal}
        onClose={() => setShowRoleModal(false)}
        title="Your Role"
        size="sm"
      >
        <div className="text-center space-y-4">
          <div
            className={`
              w-24 h-24 rounded-full mx-auto flex items-center justify-center text-4xl
              ${playerRole === 'good'
                ? 'bg-emerald-500/20 border-2 border-emerald-500'
                : 'bg-red-500/20 border-2 border-red-500'}
            `}
          >
            {playerRole === 'good' ? '🛡️' : '🗡️'}
          </div>

          <div>
            <h3
              className={`text-2xl font-bold ${playerRole === 'good' ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {playerRole === 'good' ? 'Good' : 'Evil'}
            </h3>
            {specialRole && (
              <p className="text-avalon-gold capitalize mt-1">{specialRole.replace(/_/g, ' ')}</p>
            )}
          </div>

          <p className="text-avalon-silver/70 text-sm">
            {playerRole === 'good'
              ? 'Help the quests succeed. Watch for saboteurs!'
              : 'Sabotage the quests. Stay hidden!'}
          </p>
        </div>
      </Modal>

      {/* Investigation Result Modal - stays visible even after phase change */}
      {investigationResult && (
        <InvestigationResult
          targetNickname={investigationResult.targetNickname}
          result={investigationResult.result}
          newHolderNickname={investigationResult.newHolderNickname}
          onContinue={handleInvestigationContinue}
        />
      )}

      {/* T073: Session Takeover Alert */}
      <SessionTakeoverAlert isOpen={sessionTakenOver} />

      {/* Feature 014: Rulebook Modal */}
      <RulebookModal isOpen={showRulebook} onClose={() => setShowRulebook(false)} />
    </div>
  );
}
