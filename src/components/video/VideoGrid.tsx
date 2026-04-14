'use client';

/**
 * VideoGrid — responsive grid of participant video tiles
 * Tiles are always square and sized to fit within the container
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import { VideoTile } from './VideoTile';
import type { Participant } from 'livekit-client';

interface VideoGridProps {
  participants: Participant[];
  seatNumbers?: Map<string, number>;
  fullscreen?: boolean;
  /** Current speaker's identity */
  currentSpeaker?: string | null;
  /** Timer color */
  timerColor?: 'green' | 'yellow' | 'red' | null;
  /** Timer progress 0-1 */
  timerProgress?: number | null;
  /** Time remaining in seconds */
  timeRemaining?: number | null;
}

/**
 * Calculate the optimal grid layout (cols x rows) and tile size
 * to fit square tiles within the given container dimensions.
 */
function calcLayout(count: number, containerW: number, containerH: number, gap: number) {
  if (count === 0) return { cols: 1, rows: 1, tileSize: 0 };

  let bestCols = 1;
  let bestSize = 0;

  // Try different column counts and pick the one that gives the largest tiles
  for (let cols = 1; cols <= Math.min(count, 6); cols++) {
    const rows = Math.ceil(count / cols);
    const maxW = (containerW - gap * (cols - 1)) / cols;
    const maxH = (containerH - gap * (rows - 1)) / rows;
    const tileSize = Math.floor(Math.min(maxW, maxH));

    if (tileSize > bestSize) {
      bestSize = tileSize;
      bestCols = cols;
    }
  }

  const bestRows = Math.ceil(count / bestCols);
  return { cols: bestCols, rows: bestRows, tileSize: bestSize };
}

export function VideoGrid({ participants, seatNumbers, fullscreen = false, currentSpeaker, timerColor, timerProgress, timeRemaining }: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ cols: 1, rows: 1, tileSize: 200 });

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const { cols, rows, tileSize } = calcLayout(
        participants.length,
        el.clientWidth,
        el.clientHeight,
        8 // gap in px
      );
      setLayout({ cols, rows, tileSize });
    };

    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [participants.length]);

  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      const seatA = seatNumbers?.get(a.identity) ?? Infinity;
      const seatB = seatNumbers?.get(b.identity) ?? Infinity;
      return seatA - seatB;
    });
  }, [participants, seatNumbers]);

  if (participants.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-avalon-text-muted text-sm">
        No participants in video yet
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${fullscreen ? 'h-full' : 'min-h-[200px]'} flex items-center justify-center p-2`}
    >
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, ${layout.tileSize}px)`,
          gridAutoRows: `${layout.tileSize}px`,
        }}
      >
        {sortedParticipants.map((participant) => (
          <div
            key={participant.identity}
            style={{ width: layout.tileSize, height: layout.tileSize }}
          >
            <VideoTile
              participant={participant}
              seatNumber={seatNumbers?.get(participant.identity)}

              isCurrentSpeaker={currentSpeaker === participant.identity}
              timerColor={currentSpeaker === participant.identity ? timerColor : null}
              timerProgress={currentSpeaker === participant.identity ? timerProgress : null}
              timeRemaining={currentSpeaker === participant.identity ? timeRemaining : null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
