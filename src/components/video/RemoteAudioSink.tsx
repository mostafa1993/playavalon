'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type RemoteParticipant,
  ParticipantEvent,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import { useLiveKit } from '@/hooks/useLiveKit';

function ParticipantAudio({ participant }: { participant: RemoteParticipant }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    participant.on(ParticipantEvent.TrackSubscribed, rerender);
    participant.on(ParticipantEvent.TrackUnsubscribed, rerender);
    participant.on(ParticipantEvent.TrackPublished, rerender);
    participant.on(ParticipantEvent.TrackUnpublished, rerender);
    return () => {
      participant.off(ParticipantEvent.TrackSubscribed, rerender);
      participant.off(ParticipantEvent.TrackUnsubscribed, rerender);
      participant.off(ParticipantEvent.TrackPublished, rerender);
      participant.off(ParticipantEvent.TrackUnpublished, rerender);
    };
  }, [participant]);

  const micPub = participant.getTrackPublication(Track.Source.Microphone) as
    | RemoteTrackPublication
    | undefined;
  const micTrack = micPub?.track as RemoteTrack | undefined;

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !micTrack) return;
    micTrack.attach(el);
    return () => {
      micTrack.detach(el);
    };
  }, [micTrack]);

  return <audio ref={audioRef} autoPlay />;
}

export function RemoteAudioSink() {
  const { room, isConnected } = useLiveKit();
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);

  useEffect(() => {
    if (!room) {
      setParticipants([]);
      return;
    }
    const update = () => {
      setParticipants(Array.from(room.remoteParticipants.values()));
    };
    update();
    room.on(RoomEvent.ParticipantConnected, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    return () => {
      room.off(RoomEvent.ParticipantConnected, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
    };
  }, [room]);

  if (!isConnected) return null;

  return (
    <>
      {participants.map((p) => (
        <ParticipantAudio key={p.identity} participant={p} />
      ))}
    </>
  );
}
