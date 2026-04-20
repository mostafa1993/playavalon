'use client';

/**
 * Game Page
 * Main game play screen with video calling split layout
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { GameBoard } from '@/components/game/GameBoard';
import { VideoRoom } from '@/components/video';
import { ViewModeToggle } from '@/components/video/ViewModeToggle';
import { VideoControls } from '@/components/video/VideoControls';
import { ChatPanel } from '@/components/video/ChatPanel';
import { LayoutSwapButton } from '@/components/video/LayoutSwapButton';
import { EmojiReactions } from '@/components/video/EmojiReactions';
import { TimerButton } from '@/components/video/TimerButton';
import { useLiveKit } from '@/hooks/useLiveKit';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useGameState } from '@/hooks/useGameState';
import { useSpeakingTimer } from '@/hooks/useSpeakingTimer';
import { useDiscussionTimer } from '@/hooks/useDiscussionTimer';
import { useAuth } from '@/hooks/useAuth';

export default function GamePage() {
  const router = useRouter();
  const params = useParams();
  const gameId = params.gameId as string;
  const { user, loading: authLoading } = useAuth();
  const [initialLeaderIndex, setInitialLeaderIndex] = useState<number | null>(null);
  const { isConnected, viewMode, room, isLayoutSwapped } = useLiveKit();
  const { roomCode, gameState, isManager, playerRole } = useGameState(gameId);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?returnTo=/game/${gameId}`);
    }
  }, [authLoading, user, router, gameId]);

  // Capture the initial leader index on first game state load
  useEffect(() => {
    if (initialLeaderIndex === null && gameState?.game?.leader_index != null) {
      setInitialLeaderIndex(gameState.game.leader_index);
    }
  }, [gameState?.game?.leader_index, initialLeaderIndex]);

  // Stable keys for seat number memoization — avoid recalculating every 3s poll
  const seatingOrderKey = gameState?.game?.seating_order?.join(',') ?? '';
  const participantCount = room ? room.remoteParticipants.size + 1 : 0;

  // Build seat numbers: first leader = seat 1, then clockwise
  const seatNumbers = useMemo(() => {
    if (!gameState?.game?.seating_order || !gameState.players || !room || initialLeaderIndex === null) return undefined;

    const { seating_order } = gameState.game;
    const leader_index = initialLeaderIndex;
    const playerCount = seating_order.length;
    const map = new Map<string, number>();

    const participants = [
      room.localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ];

    for (let i = 0; i < playerCount; i++) {
      const seatNum = ((i - leader_index + playerCount) % playerCount) + 1;
      const dbPlayerId = seating_order[i];
      const gamePlayer = gameState.players.find((p) => p.id === dbPlayerId);
      if (!gamePlayer) continue;

      const lkParticipant = participants.find(p => p.name === gamePlayer.display_name);
      if (lkParticipant) {
        map.set(lkParticipant.identity, seatNum);
      }
    }

    return map.size > 0 ? map : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatingOrderKey, initialLeaderIndex, participantCount]);

  // Activity heartbeat for disconnect detection
  useHeartbeat({ enabled: !!user });

  // Find the leader's LiveKit identity for speaking timer
  const leaderIdentity = useMemo(() => {
    if (!gameState?.players || !room) return undefined;
    const leader = gameState.players.find((p) => p.is_leader);
    if (!leader) return undefined;
    const participants = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
    const lkParticipant = participants.find(p => p.name === leader.display_name);
    return lkParticipant?.identity ?? `db-${leader.id}`;
  }, [gameState?.players, room]);

  const speakingTimer = useSpeakingTimer({
    isManager,
    seatNumbers,
    leaderIdentity,
    questNumber: gameState?.game?.current_quest ?? 0,
  });

  // Assassin identity → LiveKit identity, via display_name.
  const assassinIdentity = useMemo(() => {
    const ap = gameState?.assassin_phase;
    if (!ap || !room) return null;
    const participants = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
    const lk = participants.find((p) => p.name === ap.assassin_display_name);
    return lk?.identity ?? `db-${ap.assassin_id}`;
  }, [gameState?.assassin_phase, room]);

  const isAssassinPhase = gameState?.game?.phase === 'assassin';
  const discussionTimer = useDiscussionTimer({
    isManager,
    enabled: isAssassinPhase,
    playerRole,
    assassinIdentity,
  });

  // Unified "active timer" — one of the two, depending on phase. Both hooks
  // expose the same shape so downstream (VideoRoom, VideoTile ring) doesn't
  // need to care which kind of turn we're in.
  const activeTimer = isAssassinPhase ? discussionTimer : speakingTimer;

  // Manager shortcut: "T" toggles whichever timer is active for the current phase.
  // timeRemaining is stored in a ref so the effect doesn't re-subscribe every tick.
  const timeRemainingRef = useRef<number | null>(activeTimer.timeRemaining);
  timeRemainingRef.current = activeTimer.timeRemaining;
  const { startTimer, skipToNext } = activeTimer;

  useEffect(() => {
    if (!isManager) return;
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 't') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;

      e.preventDefault();
      const remaining = timeRemainingRef.current;
      const isRunning = remaining !== null && remaining > 0;
      if (isRunning) {
        skipToNext();
      } else {
        startTimer();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isManager, startTimer, skipToNext]);

  return (
    <main className="h-screen bg-avalon-midnight flex flex-col overflow-hidden">
      {isConnected && (
        <div className={`fixed top-6 ${isLayoutSwapped && viewMode === 'split' ? 'left-4 origin-top-left' : 'right-4 origin-top-right'} scale-[1.15] flex items-center gap-4 px-4 py-1.5 bg-avalon-midnight/60 backdrop-blur-md rounded-full border border-avalon-dark-border/50 z-50`}>
          <ViewModeToggle />
          <div className="flex items-center gap-2">
            <TimerButton
              onStart={activeTimer.startTimer}
              onReset={activeTimer.skipToNext}
              isRunning={activeTimer.timeRemaining !== null && activeTimer.timeRemaining > 0}
              isManager={isManager}
            />
            <LayoutSwapButton />
            <EmojiReactions />
            <ChatPanel />
            <VideoControls />
          </div>
        </div>
      )}

      <div className={`flex-1 min-h-0 flex ${isLayoutSwapped && viewMode === 'split' ? 'flex-row-reverse' : ''}`}>
        <div
          className={`
            overflow-y-auto transition-none
            ${isConnected && viewMode === 'video' ? 'hidden' : ''}
            ${isConnected && viewMode === 'split' ? 'w-[35%] min-w-[300px] max-w-[60%] flex-shrink-0 py-2 px-2' : ''}
            ${!isConnected || viewMode === 'game' ? 'flex-1' : ''}
          `}
        >
          <div className={`${!isConnected || viewMode === 'game' ? 'max-w-2xl mx-auto py-4 px-4 pb-8' : ''}`}>
            {!isConnected && roomCode && (
              <div className="flex items-center justify-center py-2 px-4 mb-3 bg-avalon-navy/50 rounded-lg border border-avalon-dark-border">
                <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} inline />
              </div>
            )}
            <GameBoard gameId={gameId} />
          </div>
        </div>

        {isConnected && roomCode && (
          <div
            className={`
              ${viewMode === 'game' ? 'hidden' : 'flex-1 min-w-0 h-full'}
            `}
          >
            <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} fullscreen hideControls currentSpeaker={activeTimer.currentSpeaker} timerColor={activeTimer.timerColor} timerProgress={activeTimer.timerProgress} timeRemaining={activeTimer.timeRemaining} />
          </div>
        )}
      </div>
    </main>
  );
}
