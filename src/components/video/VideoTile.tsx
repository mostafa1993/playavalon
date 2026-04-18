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
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useLiveKit } from '@/hooks/useLiveKit';
import { EMOJI_REACTION_BY_KEY } from './emojiReactionsMap';

interface VideoTileProps {
  participant: Participant;
  /** Seat number (1-based) shown as prefix to name during game */
  seatNumber?: number;
  /** Timer color for speaking turn: green/yellow/red or null */
  timerColor?: 'green' | 'yellow' | 'red' | null;
  /** Timer progress 0-1 (1=full, 0=empty) or null */
  timerProgress?: number | null;
  /** Whether this participant is the current speaker */
  isCurrentSpeaker?: boolean;
  /** Time remaining in seconds */
  timeRemaining?: number | null;
}

export function VideoTile({ participant, seatNumber, timerColor, timerProgress, isCurrentSpeaker = false, timeRemaining }: VideoTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const isSpeaking = useIsSpeaking(participant);
  const { toggleMic, toggleCamera, reactions } = useLiveKit();
  const reaction = reactions.get(participant.identity);
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
  const initials = rawName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Track the attached video element + track for cleanup
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const attachedVideoTrackRef = useRef<any>(null);

  // Attach video track via ref callback — fires immediately when element mounts
  const videoRefCallback = useCallback(
    (el: HTMLVideoElement | null) => {
      // Detach previous track from previous element
      if (attachedVideoTrackRef.current && videoElRef.current) {
        attachedVideoTrackRef.current.detach(videoElRef.current);
      }
      videoElRef.current = el;
      if (!el) {
        attachedVideoTrackRef.current = null;
        return;
      }
      el.srcObject = null;
      if (cameraPublication?.track) {
        cameraPublication.track.attach(el);
        attachedVideoTrackRef.current = cameraPublication.track;
      }
    },
    [cameraPublication?.track]
  );

  // Cleanup video track on unmount
  useEffect(() => {
    return () => {
      if (attachedVideoTrackRef.current && videoElRef.current) {
        attachedVideoTrackRef.current.detach(videoElRef.current);
      }
    };
  }, []);

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

  // Border style
  const borderColorClass = isCurrentSpeaker
    ? 'border-transparent' // SVG ring handles the colored border
    : isSpeaking
    ? 'border-avalon-gold'
    : 'border-avalon-dark-border';

  // Timer ring color
  const ringColor = timerColor === 'red' ? '#ef4444'
    : timerColor === 'yellow' ? '#facc15'
    : '#22c55e';

  // The perimeter of the rounded rect (approximate for stroke-dasharray)
  // We use a rect path that goes clockwise from top-center
  const progress = timerProgress ?? 1;

  return (
    <div
      className={`
        relative rounded-lg overflow-hidden bg-avalon-navy border-2 transition-colors
        ${borderColorClass}
        w-full h-full
      `}
    >
      {/* SVG border ring that shrinks as timer progresses */}
      {isCurrentSpeaker && (
        <svg
          className="absolute inset-0 w-full h-full z-10 pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Perimeter: 2*(98+98) = 392 */}
          {/* Background track (dim) */}
          <rect
            x="1" y="1" width="98" height="98" rx="1" ry="1"
            fill="none"
            stroke={ringColor}
            strokeWidth="2"
            strokeOpacity="0.2"
          />
          {/* Progress ring — shrinks */}
          <rect
            x="1" y="1" width="98" height="98" rx="1" ry="1"
            fill="none"
            stroke={ringColor}
            strokeWidth="2"
            strokeDasharray={`${progress * 392} ${392}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.3s linear, stroke 0.5s ease' }}
          />
        </svg>
      )}

      {/* Circular countdown clock — positioned inside the border ring with padding */}
      {isCurrentSpeaker && (
        <div className="absolute top-5 left-5 z-20">
          <div className="relative w-14 h-14">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18" cy="18" r="15"
                fill="rgba(0,0,0,0.6)"
                stroke={ringColor}
                strokeWidth="2"
                strokeOpacity="0.3"
              />
              {timeRemaining != null && (
                <circle
                  cx="18" cy="18" r="15"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="2.5"
                  strokeDasharray={`${progress * 94.2} 94.2`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.3s linear, stroke 0.5s ease' }}
                />
              )}
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
              {timeRemaining != null ? Math.ceil(timeRemaining) : '●'}
            </span>
          </div>
        </div>
      )}
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

      {/* Floating emoji reaction overlay — keyed by ts so each new reaction re-triggers the animation */}
      {reaction && EMOJI_REACTION_BY_KEY.has(reaction.emoji) && (
        <div
          key={reaction.ts}
          className="absolute bottom-10 left-1/2 z-30 pointer-events-none animate-reaction-float"
        >
          <div className="animate-reaction-bounce" style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={EMOJI_REACTION_BY_KEY.get(reaction.emoji)!.src}
              alt=""
              width={72}
              height={72}
            />
          </div>
        </div>
      )}

      {/* Per-tile controls (local only) — bottom-right, above the name bar */}
      {isLocal && (
        <div className="absolute bottom-7 right-1.5 flex items-center gap-1 z-20">
          <button
            onClick={(e) => { e.stopPropagation(); toggleMic(); }}
            className={`
              p-1.5 rounded-full bg-black/60 backdrop-blur-sm transition-colors
              ${isMicOn ? 'text-white hover:text-avalon-gold' : 'text-red-400 hover:text-red-300'}
            `}
            title={isMicOn ? 'Mute mic' : 'Unmute mic'}
          >
            {isMicOn ? <Mic size={14} /> : <MicOff size={14} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); toggleCamera(); }}
            className={`
              p-1.5 rounded-full bg-black/60 backdrop-blur-sm transition-colors
              ${isCameraOn ? 'text-white hover:text-avalon-gold' : 'text-red-400 hover:text-red-300'}
            `}
            title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {isCameraOn ? <Video size={14} /> : <VideoOff size={14} />}
          </button>
        </div>
      )}

      {/* Name bar — z-20 to sit above the timer ring */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 flex items-center gap-1.5 z-20">
        {isSpeaking && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        )}
        <span className="text-xs text-white truncate font-medium">
          {name}
          {isLocal && ' (You)'}
        </span>
        {!isLocal && !isMicOn && (
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
