'use client';

/**
 * VideoGrid — responsive grid of participant video tiles
 * Automatically adjusts column count based on participant count
 */

import { VideoTile } from './VideoTile';
import type { Participant } from 'livekit-client';

interface VideoGridProps {
  participants: Participant[];
  /** Map of participant identity → seat number (1-based) */
  seatNumbers?: Map<string, number>;
}

function getGridCols(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-3';
  return 'grid-cols-4';
}

export function VideoGrid({ participants, seatNumbers }: VideoGridProps) {
  if (participants.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-avalon-text-muted text-sm">
        No participants in video yet
      </div>
    );
  }

  return (
    <div className={`grid ${getGridCols(participants.length)} gap-2 p-2`}>
      {participants.map((participant) => (
        <VideoTile
          key={participant.identity}
          participant={participant}
          seatNumber={seatNumbers?.get(participant.identity)}
        />
      ))}
    </div>
  );
}
