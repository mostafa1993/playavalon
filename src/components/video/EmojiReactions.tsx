'use client';

import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { Smile } from 'lucide-react';
import { useLiveKit } from '@/hooks/useLiveKit';
import { EMOJI_REACTIONS } from './emojiReactionsMap';

export function EmojiReactions() {
  const { isConnected, sendReaction, isReactionCoolingDown } = useLiveKit();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!isConnected) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-full flex items-center justify-center text-avalon-text hover:text-avalon-gold transition-colors"
        title="Send a reaction"
      >
        <Smile size={18} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 flex items-center gap-1 px-2 py-1.5 bg-avalon-midnight/95 backdrop-blur-md rounded-full border border-avalon-dark-border shadow-lg z-50">
          {EMOJI_REACTIONS.map((reaction) => (
            <button
              key={reaction.key}
              disabled={isReactionCoolingDown}
              onClick={() => {
                sendReaction(reaction.key);
                setOpen(false);
              }}
              className={`
                w-10 h-10 rounded-full flex items-center justify-center transition-transform
                ${isReactionCoolingDown
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-avalon-navy hover:scale-125'}
              `}
              title={isReactionCoolingDown ? 'Too fast — wait a moment' : reaction.label}
            >
              <Image src={reaction.src} alt={reaction.label} width={28} height={28} unoptimized />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
