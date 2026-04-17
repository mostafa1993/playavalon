'use client';

/**
 * Game Page
 * Main game play screen with video calling split layout
 */

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { GameBoard } from '@/components/game/GameBoard';
import { VideoRoom } from '@/components/video';
import { ViewModeToggle } from '@/components/video/ViewModeToggle';
import { VideoControls } from '@/components/video/VideoControls';
import { ChatPanel } from '@/components/video/ChatPanel';
import { TimerButton } from '@/components/video/TimerButton';
import { useLiveKit } from '@/hooks/useLiveKit';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useGameState } from '@/hooks/useGameState';
import { useSpeakingTimer } from '@/hooks/useSpeakingTimer';
import { useAuth } from '@/hooks/useAuth';

export default function GamePage() {
  const router = useRouter();
  const params = useParams();
  const gameId = params.gameId as string;
  const { user, loading: authLoading } = useAuth();
  const [initialLeaderIndex, setInitialLeaderIndex] = useState<number | null>(null);
  const { isConnected, viewMode, room } = useLiveKit();
  const { roomCode, gameState, isManager } = useGameState(gameId);

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

  return (
    <main className="h-screen bg-avalon-midnight flex flex-col overflow-hidden">
      {isConnected && (
        <div className="fixed top-6 right-4 flex items-center gap-4 px-4 py-1.5 bg-avalon-midnight/60 backdrop-blur-md rounded-full border border-avalon-dark-border/50 z-50">
          <ViewModeToggle />
          <div className="flex items-center gap-2">
            <TimerButton
              onStart={speakingTimer.startTimer}
              isRunning={speakingTimer.timeRemaining !== null && speakingTimer.timeRemaining > 0}
              isManager={isManager}
            />
            <ChatPanel />
            <VideoControls />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
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
            <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} fullscreen hideControls currentSpeaker={speakingTimer.currentSpeaker} timerColor={speakingTimer.timerColor} timerProgress={speakingTimer.timerProgress} timeRemaining={speakingTimer.timeRemaining} />
          </div>
        )}
      </div>
    </main>
  );
}
