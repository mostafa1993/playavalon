'use client';

/**
 * VideoRoom — top-level video component
 * Wraps the video grid, controls, view mode toggle, and chat
 * Used in both lobby and game pages
 */

import { useEffect, useState } from 'react';
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
}

export function VideoRoom({ roomCode, autoConnect = false, seatNumbers }: VideoRoomProps) {
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

  // Not connected — show join button
  if (!isConnected) {
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
            <div className="flex gap-2">
              <button
                disabled={isJoining}
                onClick={async () => {
                  setIsJoining(true);
                  try {
                    await connect(roomCode, { enableCamera: true, enableMic: true });
                  } finally {
                    setIsJoining(false);
                  }
                }}
                className="px-4 py-2 bg-avalon-gold text-avalon-midnight rounded-lg text-sm font-medium hover:bg-avalon-gold-light transition-colors disabled:opacity-50"
              >
                {isJoining ? 'Joining...' : 'Join with video'}
              </button>
              <button
                disabled={isJoining}
                onClick={async () => {
                  setIsJoining(true);
                  try {
                    await connect(roomCode, { enableCamera: false, enableMic: true });
                  } finally {
                    setIsJoining(false);
                  }
                }}
                className="px-4 py-2 bg-avalon-dark-lighter text-avalon-text rounded-lg text-sm font-medium hover:bg-avalon-dark-border transition-colors disabled:opacity-50"
              >
                {isJoining ? 'Joining...' : 'Join audio only'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Connected — show video content based on view mode
  if (viewMode === 'game') {
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

  // Video or Split mode
  return (
    <div className="flex flex-col bg-avalon-navy rounded-lg border border-avalon-dark-border overflow-hidden">
      {/* Header with toggle + chat */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-avalon-dark-border">
        <ViewModeToggle />
        <ChatPanel />
      </div>

      {/* Video grid */}
      <div className="flex-1 min-h-0">
        <VideoGrid participants={participants} seatNumbers={seatNumbers} />
      </div>

      {/* Controls */}
      <VideoControls />
    </div>
  );
}
