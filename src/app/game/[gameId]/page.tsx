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
import { ResizableSplit } from '@/components/video/ResizableSplit';
import { useLiveKit } from '@/hooks/useLiveKit';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useGameState } from '@/hooks/useGameState';
import { getPlayerId, hasPlayerId } from '@/lib/utils/player-id';

/**
 * ScaleToFit — scales its children down to fit the container without scrolling
 */
function ScaleToFit({ children, className }: { children: React.ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;

      // Reset scale to measure natural height
      inner.style.transform = 'scale(1)';
      const naturalHeight = inner.scrollHeight;
      const availableHeight = outer.clientHeight;

      if (naturalHeight > availableHeight && naturalHeight > 0) {
        setScale(Math.max(0.5, availableHeight / naturalHeight));
      } else {
        setScale(1);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    if (outerRef.current) observer.observe(outerRef.current);
    if (innerRef.current) observer.observe(innerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={`overflow-hidden ${className || ''}`}>
      <div
        ref={innerRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          width: `${100 / scale}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

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
          /* Split mode — draggable divider between game and video */
          <ResizableSplit
            defaultLeftPercent={35}
            minLeftPercent={30}
            maxLeftPercent={60}
            left={
              <ScaleToFit className="h-full">
                <GameBoard gameId={gameId} />
              </ScaleToFit>
            }
            right={
              roomCode ? <VideoRoom roomCode={roomCode} seatNumbers={seatNumbers} fullscreen hideControls /> : <div />
            }
          />
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
