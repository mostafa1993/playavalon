'use client';

/**
 * TimerButton — manager-only dual-function button:
 *   idle    → Start (kick off the speaking timer)
 *   running → Reset (stop current timer + advance to next speaker)
 */

import { Timer, RotateCcw } from 'lucide-react';

interface TimerButtonProps {
  onStart: () => void;
  onReset: () => void;
  isRunning: boolean;
  isManager: boolean;
}

export function TimerButton({ onStart, onReset, isRunning, isManager }: TimerButtonProps) {
  if (!isManager) return null;

  return (
    <button
      onClick={isRunning ? onReset : onStart}
      className={`
        p-1.5 rounded-full flex items-center justify-center transition-colors
        ${isRunning
          ? 'text-red-400 hover:text-red-300'
          : 'text-avalon-text hover:text-avalon-gold'}
      `}
      title={isRunning ? 'Reset: skip to next speaker' : 'Start speaking timer'}
    >
      {isRunning ? <RotateCcw size={18} /> : <Timer size={18} />}
    </button>
  );
}
