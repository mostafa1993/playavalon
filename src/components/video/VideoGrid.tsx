'use client';

/**
 * VideoGrid — responsive grid of participant video tiles
 * Fills available space, adjusts layout based on participant count
 */

import { VideoTile } from './VideoTile';
import type { Participant } from 'livekit-client';

interface VideoGridProps {
  participants: Participant[];
  /** Map of participant identity → seat number (1-based) */
  seatNumbers?: Map<string, number>;
  /** If true, fill the entire container */
  fullscreen?: boolean;
}

/**
 * Returns grid classes optimized for the number of participants.
 * Aims for square-ish tiles that fill the space.
 */
function getGridLayout(count: number): string {
  switch (count) {
    case 1:
      return 'grid-cols-1 grid-rows-1';
    case 2:
      return 'grid-cols-2 grid-rows-1';
    case 3:
      // 2 on top, 1 centered below
      return 'grid-cols-2 grid-rows-2';
    case 4:
      return 'grid-cols-2 grid-rows-2';
    case 5:
    case 6:
      return 'grid-cols-3 grid-rows-2';
    case 7:
    case 8:
      return 'grid-cols-4 grid-rows-2';
    case 9:
      return 'grid-cols-3 grid-rows-3';
    case 10:
      return 'grid-cols-4 grid-rows-3';
    default:
      return 'grid-cols-4';
  }
}

export function VideoGrid({ participants, seatNumbers, fullscreen = false }: VideoGridProps) {
  if (participants.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-avalon-text-muted text-sm">
        No participants in video yet
      </div>
    );
  }

  const count = participants.length;

  return (
    <div
      className={`
        grid ${getGridLayout(count)} gap-1 p-1
        ${fullscreen ? 'h-full' : ''}
        place-items-center place-content-center
      `}
    >
      {participants.map((participant, i) => (
        <div
          key={participant.identity}
          className={`
            ${count === 3 && i === 2 ? 'col-start-1 col-end-3 justify-self-center' : ''}
          `}
        >
          <VideoTile
            participant={participant}
            seatNumber={seatNumbers?.get(participant.identity)}
            fillContainer={fullscreen}
          />
        </div>
      ))}
    </div>
  );
}
