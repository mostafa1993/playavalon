'use client';

/**
 * ViewModeToggle — three-state toggle: Video / Split / Game
 */

import { Video, Columns2, Gamepad2, type LucideIcon } from 'lucide-react';
import { useLiveKit, type ViewMode } from '@/hooks/useLiveKit';

const modes: { value: ViewMode; label: string; Icon: LucideIcon }[] = [
  { value: 'video', label: 'Video', Icon: Video },
  { value: 'split', label: 'Split', Icon: Columns2 },
  { value: 'game', label: 'Game', Icon: Gamepad2 },
];

export function ViewModeToggle() {
  const { viewMode, setViewMode, isConnected } = useLiveKit();

  if (!isConnected) return null;

  return (
    <div className="flex items-center bg-avalon-navy rounded-lg border border-avalon-dark-border p-0.5">
      {modes.map((mode) => (
        <button
          key={mode.value}
          onClick={() => setViewMode(mode.value)}
          className={`
            px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5
            ${viewMode === mode.value
              ? 'bg-avalon-gold text-avalon-midnight'
              : 'text-avalon-text-muted hover:text-avalon-text'}
          `}
        >
          <mode.Icon size={14} /> {mode.label}
        </button>
      ))}
    </div>
  );
}
