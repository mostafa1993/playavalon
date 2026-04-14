'use client';

/**
 * TimerButton — manager-only button to start the speaking timer
 */

import { Timer } from 'lucide-react';

interface TimerButtonProps {
  onStart: () => void;
  isRunning: boolean;
  isManager: boolean;
}

export function TimerButton({ onStart, isRunning, isManager }: TimerButtonProps) {
  if (!isManager) return null;

  return (
    <button
      onClick={onStart}
      disabled={isRunning}
      className={`
        p-1.5 rounded-full flex items-center justify-center transition-colors
        ${isRunning
          ? 'text-green-400 animate-pulse cursor-not-allowed'
          : 'text-avalon-text hover:text-avalon-gold'}
      `}
      title={isRunning ? 'Timer running...' : 'Start speaking timer'}
    >
      <Timer size={18} />
    </button>
  );
}
