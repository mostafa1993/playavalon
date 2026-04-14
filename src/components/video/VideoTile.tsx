'use client';

/**
 * VideoTile — a single participant's video or audio-only tile
 * Shows video if camera is on, or a static avatar with initials if camera is off
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import {
  type Participant,
  ParticipantEvent,
  Track,
} from 'livekit-client';
import { useIsSpeaking } from '@livekit/components-react';
import { MicOff } from 'lucide-react';

interface VideoTileProps {
  participant: Participant;
  /** Seat number (1-based) shown as prefix to name during game */
  seatNumber?: number;
  /** If true, fill the parent container instead of using fixed aspect ratio */
  fillContainer?: boolean;
}

export function VideoTile({ participant, seatNumber, fillContainer = false }: VideoTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const isSpeaking = useIsSpeaking(participant);
  // Force re-render when tracks change on this participant
  const [, setTrackUpdate] = useState(0);

  useEffect(() => {
    const onTrackChange = () => setTrackUpdate((n) => n + 1);
    participant.on(ParticipantEvent.TrackPublished, onTrackChange);
    participant.on(ParticipantEvent.TrackUnpublished, onTrackChange);
    participant.on(ParticipantEvent.TrackMuted, onTrackChange);
    participant.on(ParticipantEvent.TrackUnmuted, onTrackChange);
    participant.on(ParticipantEvent.TrackSubscribed, onTrackChange);
    participant.on(ParticipantEvent.TrackUnsubscribed, onTrackChange);
    return () => {
      participant.off(ParticipantEvent.TrackPublished, onTrackChange);
      participant.off(ParticipantEvent.TrackUnpublished, onTrackChange);
      participant.off(ParticipantEvent.TrackMuted, onTrackChange);
      participant.off(ParticipantEvent.TrackUnmuted, onTrackChange);
      participant.off(ParticipantEvent.TrackSubscribed, onTrackChange);
      participant.off(ParticipantEvent.TrackUnsubscribed, onTrackChange);
    };
  }, [participant]);

  const isLocal = participant.isLocal;
  const cameraPublication = participant.getTrackPublication(Track.Source.Camera);
  const micPublication = participant.getTrackPublication(Track.Source.Microphone);

  const isCameraOn = isLocal
    ? !!cameraPublication?.track && !cameraPublication.isMuted
    : !!cameraPublication?.isSubscribed && !cameraPublication.isMuted;
  const isMicOn = isLocal
    ? !!micPublication?.track && !micPublication.isMuted
    : !!micPublication?.isSubscribed && !micPublication.isMuted;
  const rawName = participant.name || participant.identity;
  const name = seatNumber ? `${seatNumber} - ${rawName}` : rawName;
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Attach video track via ref callback — fires immediately when element mounts
  const videoRefCallback = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;
      // Detach any previous tracks
      el.srcObject = null;
      if (cameraPublication?.track) {
        cameraPublication.track.attach(el);
      }
    },
    [cameraPublication?.track]
  );

  // Attach audio track (remote participants only)
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isLocal) return;

    if (micPublication?.track) {
      micPublication.track.attach(el);
      return () => {
        micPublication.track?.detach(el);
      };
    }
  }, [micPublication?.track, isLocal]);

  return (
    <div
      className={`
        relative rounded-lg overflow-hidden bg-avalon-navy border-2 transition-colors
        ${isSpeaking ? 'border-avalon-gold' : 'border-avalon-dark-border'}
        ${fillContainer ? 'w-full h-full' : 'aspect-video'}
      `}
    >
      {isCameraOn ? (
        <video
          ref={videoRefCallback}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        /* Audio-only tile — show initials */
        <div className="w-full h-full flex items-center justify-center bg-avalon-navy">
          <div className="w-16 h-16 rounded-full bg-avalon-dark-lighter flex items-center justify-center">
            <span className="text-xl font-display font-bold text-avalon-text">
              {initials}
            </span>
          </div>
        </div>
      )}

      {/* Name bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 flex items-center gap-1.5">
        {isSpeaking && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        )}
        <span className="text-xs text-white truncate font-medium">
          {name}
          {isLocal && ' (You)'}
        </span>
        {!isMicOn && (
          <span className="ml-auto text-red-400 flex-shrink-0" title="Muted">
            <MicOff size={12} />
          </span>
        )}
      </div>

      {/* Remote audio element (hidden) */}
      {!isLocal && <audio ref={audioRef} autoPlay />}
    </div>
  );
}
