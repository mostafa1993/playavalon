'use client';

import { ArrowLeftRight } from 'lucide-react';
import { useLiveKit } from '@/hooks/useLiveKit';

export function LayoutSwapButton() {
  const { viewMode, isConnected, isLayoutSwapped, toggleLayoutSwap } = useLiveKit();

  if (!isConnected || viewMode !== 'split') return null;

  return (
    <button
      onClick={toggleLayoutSwap}
      className="p-1.5 rounded-full flex items-center justify-center text-avalon-text hover:text-avalon-gold transition-colors"
      title={isLayoutSwapped ? 'Swap: video → right, game → left' : 'Swap: video → left, game → right'}
    >
      <ArrowLeftRight size={18} />
    </button>
  );
}
