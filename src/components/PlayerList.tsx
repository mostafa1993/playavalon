'use client';

import { PlayerCard } from './PlayerCard';
import type { RoomPlayerInfo } from '@/types/room';

interface PlayerListProps {
  players: RoomPlayerInfo[];
  currentUserId: string;
  expectedPlayers: number;
}

/**
 * List of players in the room lobby
 */
export function PlayerList({
  players,
  currentUserId,
  expectedPlayers,
}: PlayerListProps) {
  // Sort players: manager first, then by join time
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.is_manager) return -1;
    if (b.is_manager) return 1;
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  const emptySlots = expectedPlayers - players.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-avalon-gold text-sm font-bold uppercase tracking-wider">
          Knights at the Table
        </h3>
        <span className="text-avalon-silver text-sm font-bold">
          {players.length}/{expectedPlayers}
        </span>
      </div>

      <div className="space-y-1.5">
        {sortedPlayers.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            isCurrentPlayer={player.id === currentUserId}
          />
        ))}

        {emptySlots > 0 && (
          <>
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-avalon-silver/20"
              >
                <div className="w-9 h-9 rounded-full bg-avalon-midnight/30 flex items-center justify-center">
                  <span className="text-avalon-silver/30 text-base">?</span>
                </div>
                <span className="text-avalon-silver/50 text-sm font-medium italic">
                  Waiting for knight...
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
