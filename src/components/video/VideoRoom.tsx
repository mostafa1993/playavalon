'use client';

/**
 * VideoRoom — top-level video component
 * Wraps the video grid, controls, view mode toggle, and chat
 * Used in both lobby and game pages
 */

import { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { RoomEvent, type Participant, ConnectionState } from 'livekit-client';
import { useLiveKit } from '@/hooks/useLiveKit';
import { VideoGrid } from './VideoGrid';
import { VideoControls } from './VideoControls';
import { ViewModeToggle } from './ViewModeToggle';
import { ChatPanel } from './ChatPanel';

interface VideoRoomProps {
  /** Room code to connect to */
  roomCode: string;
  /** If true, auto-connect on mount */
  autoConnect?: boolean;
  /** Map of participant identity (player_id) → seat number (1-based) */
  seatNumbers?: Map<string, number>;
  /** If true, expand to fill parent container (used in video-only mode) */
  fullscreen?: boolean;
  /** If true, don't render the header bar and controls (parent handles them) */
  hideControls?: boolean;
  /** If true, render only the join buttons (no wrapper box) */
  inline?: boolean;
  /** Current speaker identity for timer */
  currentSpeaker?: string | null;
  /** Timer color */
  timerColor?: 'green' | 'yellow' | 'red' | null;
  /** Timer progress 0-1 */
  timerProgress?: number | null;
  /** Time remaining */
  timeRemaining?: number | null;
}

export function VideoRoom({ roomCode, autoConnect = false, seatNumbers, fullscreen = false, hideControls = false, inline = false, currentSpeaker, timerColor, timerProgress, timeRemaining }: VideoRoomProps) {
  const {
    room,
    isConnected,
    connectionState,
    connect,
    error,
    viewMode,
  } = useLiveKit();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isJoining, setIsJoining] = useState(false);

  // Auto-connect if requested
  useEffect(() => {
    if (autoConnect && roomCode) {
      connect(roomCode);
    }
  }, [autoConnect, roomCode, connect]);

  // Track participants
  useEffect(() => {
    if (!room) {
      setParticipants([]);
      return;
    }

    const updateParticipants = () => {
      const all: Participant[] = [
        room.localParticipant,
        ...Array.from(room.remoteParticipants.values()),
      ];
      setParticipants(all);
    };

    updateParticipants();

    room.on(RoomEvent.ParticipantConnected, updateParticipants);
    room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
    room.on(RoomEvent.TrackSubscribed, updateParticipants);
    room.on(RoomEvent.TrackUnsubscribed, updateParticipants);
    room.on(RoomEvent.TrackMuted, updateParticipants);
    room.on(RoomEvent.TrackUnmuted, updateParticipants);

    return () => {
      room.off(RoomEvent.ParticipantConnected, updateParticipants);
      room.off(RoomEvent.ParticipantDisconnected, updateParticipants);
      room.off(RoomEvent.TrackSubscribed, updateParticipants);
      room.off(RoomEvent.TrackUnsubscribed, updateParticipants);
      room.off(RoomEvent.TrackMuted, updateParticipants);
      room.off(RoomEvent.TrackUnmuted, updateParticipants);
    };
  }, [room]);

  // Join buttons — shared between inline and full modes
  const joinButtons = (
    <button
      disabled={isJoining}
      onClick={async () => {
        setIsJoining(true);
        try {
          await connect(roomCode, { enableCamera: false, enableMic: false });
        } finally {
          setIsJoining(false);
        }
      }}
      className="px-2.5 py-1 bg-avalon-gold text-avalon-midnight rounded-md text-xs font-medium hover:bg-avalon-gold-light transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
    >
      <Video size={14} />
      {isJoining ? 'Joining...' : 'Join video call'}
    </button>
  );

  // Not connected — show join button
  if (!isConnected) {
    if (inline) {
      return connectionState === ConnectionState.Connecting ? (
        <span className="text-avalon-text-muted text-xs">Connecting...</span>
      ) : (
        joinButtons
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 bg-avalon-navy rounded-lg border border-avalon-dark-border">
        {connectionState === ConnectionState.Connecting ? (
          <>
            <div className="w-8 h-8 border-3 border-avalon-gold/30 border-t-avalon-gold rounded-full animate-spin" />
            <p className="text-avalon-text-muted text-sm">Connecting to video...</p>
          </>
        ) : (
          <>
            <p className="text-avalon-text-secondary text-sm">Join video call to see other players</p>
            {error && (
              <p className="text-red-400 text-xs">{error}</p>
            )}
            {joinButtons}
          </>
        )}
      </div>
    );
  }

  // Connected — show video content based on view mode
  if (viewMode === 'game' && !hideControls) {
    // Game mode: video hidden, only show minimal controls bar
    return (
      <div className="flex items-center justify-between px-3 py-1.5 bg-avalon-navy rounded-lg border border-avalon-dark-border">
        <ViewModeToggle />
        <div className="flex items-center gap-2">
          <ChatPanel />
          <span className="text-xs text-avalon-text-muted">
            {participants.length} in call
          </span>
        </div>
      </div>
    );
  }

  if (hideControls) {
    // Parent handles header/controls — just render the grid
    return (
      <div className={`${fullscreen ? 'h-full' : ''} bg-avalon-navy`}>
        <VideoGrid participants={participants} seatNumbers={seatNumbers} fullscreen={fullscreen} currentSpeaker={currentSpeaker} timerColor={timerColor} timerProgress={timerProgress} timeRemaining={timeRemaining} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-avalon-navy ${fullscreen ? 'h-full' : 'rounded-lg border border-avalon-dark-border'} overflow-hidden`}>
      {/* Header with toggle + chat */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-avalon-dark-border flex-shrink-0">
        <ViewModeToggle />
        <ChatPanel />
      </div>

      {/* Video grid */}
      <div className="flex-1 min-h-0">
        <VideoGrid participants={participants} seatNumbers={seatNumbers} fullscreen={fullscreen} currentSpeaker={currentSpeaker} timerColor={timerColor} timerProgress={timerProgress} timeRemaining={timeRemaining} />
      </div>

      {/* Controls */}
      <div className="flex-shrink-0">
        <VideoControls />
      </div>
    </div>
  );
}
