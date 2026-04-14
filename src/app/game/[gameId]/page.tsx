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
import { useLiveKit } from '@/hooks/useLiveKit';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useGameState } from '@/hooks/useGameState';
import { getPlayerId, hasPlayerId } from '@/lib/utils/player-id';

export default function GamePage() {
  const router = useRouter();
  const params = useParams();
  const gameId = params.gameId as string;
  const [isReady, setIsReady] = useState(false);
  const [initialLeaderIndex, setInitialLeaderIndex] = useState<number | null>(null);
  const { isConnected, viewMode, room } = useLiveKit();
  const { roomCode, gameState } = useGameState(gameId);

  // Capture the initial leader index on first game state load
  useEffect(() => {
    if (initialLeaderIndex === null && gameState?.game?.leader_index != null) {
      setInitialLeaderIndex(gameState.game.leader_index);
    }
  }, [gameState?.game?.leader_index, initialLeaderIndex]);

  // Build seat numbers: first leader = seat 1, then clockwise
  const seatNumbers = useMemo(() => {
    if (!gameState?.game?.seating_order || !gameState.players || !room || initialLeaderIndex === null) return undefined;

    const { seating_order } = gameState.game;
    const leader_index = initialLeaderIndex;
    const playerCount = seating_order.length;
    const map = new Map<string, number>();

    // Map DB player id → LiveKit identity (participant.identity = localStorage player_id)
    // We match by nickname since game state doesn't expose localStorage player_id
    const participants = [
      room.localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ];

    for (let i = 0; i < playerCount; i++) {
      // Seat number: rotate so leader_index position = seat 1
      const seatNum = ((i - leader_index + playerCount) % playerCount) + 1;
      const dbPlayerId = seating_order[i];
      const gamePlayer = gameState.players.find((p: any) => p.id === dbPlayerId);
      if (!gamePlayer) continue;

      // Find the LiveKit participant with the matching nickname
      const lkParticipant = participants.find(p => p.name === gamePlayer.nickname);
      if (lkParticipant) {
        map.set(lkParticipant.identity, seatNum);
      }
    }

    return map.size > 0 ? map : undefined;
  }, [gameState?.game?.seating_order, initialLeaderIndex, gameState?.players, room]);

  // Redirect to home if not registered
  useEffect(() => {
    const id = getPlayerId();
    if (!id) {
      router.push('/');
    } else {
      setIsReady(true);
    }
  }, [router]);

  // T036: Activity heartbeat for disconnect detection
  useHeartbeat({ enabled: isReady && hasPlayerId() });

  const showVideo = isConnected && viewMode !== 'game';

  return (
    <main className="h-screen bg-avalon-midnight flex flex-col overflow-hidden">
      {/* Fixed top bar — always in the same position */}
      {isConnected && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-avalon-navy border-b border-avalon-dark-border flex-shrink-0 z-10">
          <ViewModeToggle />
          <div className="flex items-center gap-2">
            <ChatPanel />
            <VideoControls />
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0">
        {viewMode === 'video' && isConnected ? (
          /* Video-only mode */
          <div className="h-full">
            {roomCode && <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} fullscreen hideControls />}
          </div>
        ) : viewMode === 'split' && isConnected ? (
          /* Split mode */
          <div className="flex gap-0 h-full">
            <div className="w-[420px] flex-shrink-0 min-w-0 overflow-y-auto py-4 px-3">
              <GameBoard gameId={gameId} />
            </div>
            <div className="flex-1 min-w-0 h-full">
              {roomCode && <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} fullscreen hideControls />}
            </div>
          </div>
        ) : (
          /* Game-only mode or not connected */
          <div className="max-w-2xl mx-auto py-6 px-4 space-y-3">
            {!isConnected && roomCode && <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} />}
            <GameBoard gameId={gameId} />
          </div>
        )}
      </div>
    </main>
  );
}
