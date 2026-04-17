'use client';

/**
 * PlayerSeats Component
 * Circular display of players around a table
 * T042, T043: Updated for Phase 6 to show disconnect status
 * 012: Refactored indicator system - fill colors for team state, border colors for identity
 * Mobile: Scales down proportionally to fit smaller screens
 */

import { useState, useEffect, useRef } from 'react';
import type { GamePlayer, CenterMessage, GamePhase, VoteRevealData, VoteInfo } from '@/types/game';

// Base dimensions for the player circle layout
const BASE_SIZE = 520; // Original fixed width/height in pixels

/**
 * T003: Get fill color based on team selection state
 * Priority: selected/draft > proposed > default
 * Note: Disconnected state does NOT override fill - use border + grayscale instead
 */
function getFillColor(
  selected: boolean,
  inDraftSelection: boolean,
  isProposed: boolean
): string {
  if (selected || inDraftSelection) return 'bg-sky-700';
  if (isProposed) return 'bg-emerald-700';
  return 'bg-slate-700';
}

/**
 * T004: Get border color based on identity state
 * Priority: isMe > selected/draft > proposed > default
 * Note: Disconnected state shown via red nickname only (not border)
 */
function getBorderColor(
  isMe: boolean,
  selected: boolean,
  inDraftSelection: boolean,
  isProposed: boolean
): string {
  if (isMe) return 'border-amber-400';
  if (selected || inDraftSelection) return 'border-sky-400';
  if (isProposed) return 'border-emerald-400';
  return 'border-slate-400';
}

/**
 * Get text color for avatar initial
 */
function getTextColor(
  isMe: boolean,
  selected: boolean,
  inDraftSelection: boolean,
  isProposed: boolean
): string {
  if (selected || inDraftSelection) return 'text-sky-100';
  if (isProposed) return 'text-emerald-100';
  if (isMe) return 'text-amber-200';
  return 'text-slate-200';
}

/**
 * T003: Find a player's vote from the votes array
 * Returns the vote info if found, undefined otherwise
 */
function findPlayerVote(playerId: string, votes: VoteInfo[] | undefined): VoteInfo | undefined {
  if (!votes) return undefined;
  return votes.find(v => v.player_id === playerId);
}

interface PlayerSeatsProps {
  players: GamePlayer[];
  currentPlayerId: string | null;
  selectedTeam?: string[];
  onPlayerClick?: (playerId: string) => void;
  selectable?: boolean;
  maxSelectable?: number;
  ladyHolderId?: string | null;
  /** Disable selection for these player IDs (e.g., previous Lady holders) */
  disabledPlayerIds?: string[];
  /** Feature 007: Draft team selection (leader's tentative selection) */
  draftTeam?: string[] | null;
  /** Feature 007: Whether draft selection is in progress */
  isDraftInProgress?: boolean;
  /** Feature 008: Game context for center messages */
  gamePhase?: GamePhase;
  questNumber?: number;
  questRequirement?: { size: number };
  isCurrentPlayerLeader?: boolean;
  isOnQuestTeam?: boolean;
  lastQuestResult?: 'success' | 'failed' | null;
  gameWinner?: 'good' | 'evil' | null;
  isAssassin?: boolean;
  /** Feature 013: Vote reveal inline display */
  voteRevealActive?: boolean;
  voteRevealData?: VoteRevealData;
}

export function PlayerSeats({
  players,
  currentPlayerId,
  selectedTeam = [],
  onPlayerClick,
  selectable = false,
  maxSelectable = 0,
  ladyHolderId,
  disabledPlayerIds = [],
  draftTeam,
  isDraftInProgress = false,
  gamePhase,
  questNumber,
  questRequirement,
  isCurrentPlayerLeader = false,
  isOnQuestTeam = false,
  lastQuestResult,
  gameWinner,
  isAssassin = false,
  voteRevealActive = false,
  voteRevealData,
}: PlayerSeatsProps) {
  const angleStep = (2 * Math.PI) / players.length;
  const radius = 210; // Distance from center - scales well for up to 10 players

  /**
   * Feature 008: Get dynamic center message based on game state
   * T006: getCenterMessage() skeleton
   * T011: Enhanced with leader context
   * T013-T018: All phase messages
   * T020: Defensive checks for missing/null data
   */
  const getCenterMessage = (): CenterMessage => {
    // T020: Defensive checks - provide safe defaults
    const phase = gamePhase || 'team_building';
    const quest = questNumber || 1;
    const teamSize = questRequirement?.size || 0;

    // T020: Safely get leader name
    const leader = players.find((p) => p.is_leader);
    let leaderName = leader?.display_name || 'Leader';

    // T020: Safely get Lady holder name
    const ladyHolder = players.find((p) => p.id === ladyHolderId);
    let ladyName = ladyHolder?.display_name || 'Player';

    // T012: Truncate long display names to 15 chars + "..."
    if (leaderName.length > 15) {
      leaderName = leaderName.slice(0, 15) + '...';
    }
    if (ladyName.length > 15) {
      ladyName = ladyName.slice(0, 15) + '...';
    }

    // T007, T011: Team building phase (enhanced with leader context)
    if (phase === 'team_building') {
      return {
        line1: `Quest ${quest}`,
        line2: isCurrentPlayerLeader
          ? `Select ${teamSize} players for the quest`
          : `${leaderName} is selecting a team`,
      };
    }

    // T008: Voting phase
    if (phase === 'voting') {
      return {
        line1: `Quest ${quest}`,
        line2: 'Vote on the proposed team',
      };
    }

    // T014: Quest execution phase
    if (phase === 'quest') {
      return {
        line1: `Quest ${quest}`,
        line2: isOnQuestTeam
          ? 'Submit your quest action'
          : 'Quest team is deciding...',
      };
    }

    // T015: Quest result phase
    if (phase === 'quest_result') {
      return {
        line1: `Quest ${quest}`,
        line2: lastQuestResult === 'success'
          ? 'Quest succeeded!'
          : 'Quest failed!',
      };
    }

    // T016: Assassin phase
    if (phase === 'assassin') {
      return {
        line1: 'Assassin Phase',
        line2: isAssassin
          ? 'Select your target'
          : 'The Assassin is choosing...',
      };
    }

    // T017: Lady of the Lake phase
    if (phase === 'lady_of_lake') {
      const isLadyHolder = ladyHolderId === currentPlayerId;
      return {
        line1: 'Lady of the Lake',
        line2: isLadyHolder
          ? 'Select a player to investigate'
          : `${ladyName} is investigating...`,
      };
    }

    // T018: Game over phase
    if (phase === 'game_over') {
      return {
        line1: 'Game Over',
        line2: gameWinner === 'good' ? 'Good Wins!' : 'Evil Wins!',
      };
    }

    // T019: Fallback for unknown phases
    return {
      line1: `Quest ${quest}`,
      line2: 'Game in progress...',
    };
  };

  const getPlayerPosition = (index: number) => {
    // Start from top (subtract PI/2 to rotate)
    const angle = angleStep * index - Math.PI / 2;
    const x = Math.cos(angle) * radius + 260; // Center X
    const y = Math.sin(angle) * radius + 260; // Center Y
    return { x, y };
  };

  const isSelected = (playerId: string) => selectedTeam.includes(playerId);
  const canSelect = selectable && selectedTeam.length < maxSelectable;
  const isDisabled = (playerId: string) => disabledPlayerIds.includes(playerId);

  // Feature 007: Draft team selection state
  // For leader (selectable=true): use local selectedTeam (handled by isSelected)
  // For other players: show draft_team from server
  const isDraftSelected = (playerId: string) => {
    if (selectable) return false; // Leader uses selectedTeam for instant feedback
    return isDraftInProgress && draftTeam && draftTeam.includes(playerId);
  };

  // T009: Get dynamic center message
  const centerMessage = getCenterMessage();

  // Mobile responsive scaling - CSS-only approach using max-width and aspect-ratio
  // This avoids JavaScript measurement issues and works on first render
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    // Initial measurement
    updateWidth();

    // Recalculate on resize
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Calculate scale: container width / base size, capped at 1
  // Before measurement, use CSS to constrain, after measurement use calculated scale
  const scale = containerWidth ? Math.min(1, containerWidth / BASE_SIZE) : 1;
  const actualSize = containerWidth ? Math.min(containerWidth, BASE_SIZE) : BASE_SIZE;

  return (
    // Outer: constrains width, measures available space
    <div ref={containerRef} className="w-full max-w-[520px] mx-auto">
      {/* Responsive container: maintains aspect ratio, sized to fit */}
      <div
        className="relative w-full"
        style={{
          // Use aspect-ratio for height, or fallback to calculated height
          aspectRatio: '1 / 1',
          maxWidth: BASE_SIZE,
        }}
      >
        {/* Scaled content layer */}
        <div
          className="absolute inset-0 origin-top-left"
          style={{
            width: BASE_SIZE,
            height: BASE_SIZE,
            transform: `scale(${scale})`,
          }}
        >
      {/* Feature 008: Dynamic center messages */}
      {/* Feature 013: Vote summary display when reveal is active */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 rounded-full bg-gradient-to-br from-amber-800 to-amber-950 border-4 border-amber-700 shadow-lg">
        {voteRevealActive && voteRevealData ? (
          // T008-T010: Vote summary display
          <div className="flex flex-col items-center justify-center h-full text-center px-3 animate-vote-reveal">
            {/* T009: Emoji based on approval status */}
            <span className="text-4xl mb-1">
              {voteRevealData.isApproved ? '✅' : '❌'}
            </span>
            {/* T010: Approve-reject count format */}
            <span className="text-2xl font-bold text-amber-400">
              {voteRevealData.approveCount}-{voteRevealData.rejectCount}
            </span>
          </div>
        ) : (
          // Normal center message
          <div className="flex flex-col items-center justify-center h-full text-center px-3">
            <span className="text-xl font-bold text-amber-500 leading-tight">
              {centerMessage.line1}
            </span>
            <span className="text-sm text-amber-400 leading-tight mt-1">
              {centerMessage.line2}
            </span>
          </div>
        )}
      </div>

      {/* Players */}
      {players.map((player, index) => {
        const { x, y } = getPlayerPosition(index);
        const isMe = player.id === currentPlayerId;
        const selected = isSelected(player.id);
        const disabled = isDisabled(player.id);
        const clickable = selectable && !disabled && (selected || canSelect || !isMe);
        const hasLady = ladyHolderId === player.id;
        // T042: Check connection status
        const isDisconnected = !player.is_connected;

        // Feature 007: Determine visual state (coerce to boolean for type safety)
        const inDraftSelection = isDraftSelected(player.id) ?? false;
        const isProposed = player.is_on_team ?? false; // Officially proposed team

        return (
          <div
            key={player.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: x, top: y }}
          >
            <button
              onClick={() => clickable && onPlayerClick?.(player.id)}
              disabled={!clickable}
              className={`
                relative flex flex-col items-center transition-all duration-200
                ${clickable ? 'cursor-pointer hover:scale-110' : 'cursor-default'}
                ${selected ? 'scale-110' : ''}
                ${disabled ? 'opacity-50' : ''}
              `}
            >
              {/* Avatar - 012: Refactored with fill/border color system */}
              {/* Feature 013: Vote reveal inline display */}
              {(() => {
                // Pre-calculate vote for styling
                const playerVote = voteRevealActive ? findPlayerVote(player.id, voteRevealData?.votes) : null;
                const voteType = playerVote?.vote;

                // Option B: Full background color for vote reveal
                const getVoteRevealBg = () => {
                  if (!voteRevealActive) return '';
                  if (voteType === 'approve') return 'bg-emerald-600 border-emerald-400';
                  if (voteType === 'reject') return 'bg-red-600 border-red-400';
                  return 'bg-slate-600 border-slate-400'; // Missing vote
                };

                return (
                  <div
                    className={`
                      w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold
                      transition-all duration-300
                      ${voteRevealActive ? getVoteRevealBg() : getFillColor(selected, inDraftSelection, isProposed)}
                      ${voteRevealActive ? '' : getBorderColor(isMe, selected, inDraftSelection, isProposed)}
                      ${!voteRevealActive ? getTextColor(isMe, selected, inDraftSelection, isProposed) : 'text-white'}
                      ${player.is_leader ? 'ring-4 ring-amber-400 ring-offset-2 ring-offset-avalon-midnight' : ''}
                      ${inDraftSelection && selectable ? 'animate-pulse shadow-lg shadow-sky-400/50' : ''}
                    `}
                    style={{ borderWidth: isMe ? '4px' : '3px' }}
                  >
                    {/* T004-T006: Show vote icon or initial */}
                    {voteRevealActive ? (
                      voteType ? (
                        // Option B: White icon on colored background
                        <span className="text-4xl font-bold text-white animate-vote-reveal">
                          {voteType === 'approve' ? '✓' : '✗'}
                        </span>
                      ) : (
                        // T006: Missing vote - show "?" in white
                        <span className="text-4xl font-bold text-white/70 animate-vote-reveal">
                          ?
                        </span>
                      )
                    ) : (
                      player.display_name.charAt(0).toUpperCase()
                    )}
                  </div>
                );
              })()}

              {/* Crown for leader - T020: Keep at top center */}
              {player.is_leader && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-2xl">
                  👑
                </div>
              )}

              {/* Lady of the Lake token - middle RIGHT, close to circle */}
              {hasLady && (
                <div className="absolute -right-3 top-1/2 -translate-y-1/2 text-xl" title="Lady of the Lake">
                  🌊
                </div>
              )}

              {/* Vote indicator - middle LEFT, close to circle */}
              {player.has_voted && (
                <div
                  className="absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center text-xs text-black font-bold"
                  title="Has voted"
                >
                  ✓
                </div>
              )}

              {/* Name - T031: Simplified color logic */}
              <span
                className={`
                  mt-3 text-base font-semibold whitespace-nowrap
                  ${isDisconnected ? 'text-red-400' : isMe ? 'text-amber-300 font-bold' : 'text-slate-100'}
                `}
              >
                {isMe ? 'You' : player.display_name}
              </span>
            </button>
          </div>
        );
      })}
        </div>
      </div>
    </div>
  );
}
