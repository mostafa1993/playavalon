'use client';

/**
 * ResizableSplit — two panels with a draggable divider
 * User can drag the divider to resize the panels
 */

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

interface ResizableSplitProps {
  left: ReactNode;
  right: ReactNode;
  /** Initial left panel width as percentage (0-100). Default: 40 */
  defaultLeftPercent?: number;
  /** Minimum left panel width as percentage. Default: 20 */
  minLeftPercent?: number;
  /** Maximum left panel width as percentage. Default: 70 */
  maxLeftPercent?: number;
  /** If true, visually reverse the panels (left slot renders on the right). The drag math inverts automatically. */
  reversed?: boolean;
}

export function ResizableSplit({
  left,
  right,
  defaultLeftPercent = 40,
  minLeftPercent = 20,
  maxLeftPercent = 70,
  reversed = false,
}: ResizableSplitProps) {
  const [leftPercent, setLeftPercent] = useState(() => {
    if (typeof window === 'undefined') return defaultLeftPercent;
    const saved = localStorage.getItem('avalon-split-percent');
    return saved ? Number(saved) : defaultLeftPercent;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let raw = (x / rect.width) * 100;
      // When reversed, the left slot is visually on the right — invert so dragging
      // always grows/shrinks the slot the user is visually dragging towards.
      if (reversed) raw = 100 - raw;
      const percent = Math.min(maxLeftPercent, Math.max(minLeftPercent, raw));
      setLeftPercent(percent);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('avalon-split-percent', String(leftPercent));
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftPercent, minLeftPercent, maxLeftPercent, reversed]);

  return (
    <div ref={containerRef} className={`flex h-full w-full ${reversed ? 'flex-row-reverse' : ''}`}>
      {/* Left panel */}
      <div style={{ width: `${leftPercent}%` }} className="flex-shrink-0 min-w-0 overflow-y-auto">
        {left}
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1.5 flex-shrink-0 bg-avalon-dark-border hover:bg-avalon-gold/50 cursor-col-resize transition-colors active:bg-avalon-gold/70"
      />

      {/* Right panel */}
      <div className="flex-1 min-w-0 h-full">
        {right}
      </div>
    </div>
  );
}
