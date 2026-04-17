'use client';

import type { RoomPlayerInfo } from '@/types/room';

interface PlayerCardProps {
  player: RoomPlayerInfo;
  isCurrentPlayer?: boolean;
}

/**
 * Single player display card for lobby
 */
export function PlayerCard({ player, isCurrentPlayer = false }: PlayerCardProps) {
  return (
    <div
      className={`
        flex items-center gap-3 p-3 rounded-lg transition-all
        ${isCurrentPlayer
          ? 'bg-avalon-gold/10 border border-avalon-gold/30'
          : 'bg-avalon-midnight/50 border border-avalon-silver/10'
        }
        ${!player.is_connected ? 'opacity-60' : ''}
      `}
    >
      {/* Avatar placeholder */}
      <div
        className={`
          w-12 h-12 rounded-full flex items-center justify-center
          font-display text-xl font-bold
          ${player.is_manager
            ? 'bg-avalon-gold text-avalon-midnight'
            : 'bg-avalon-navy text-avalon-silver'
          }
        `}
      >
        {player.display_name.charAt(0).toUpperCase()}
      </div>

      {/* Player info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`
              font-semibold text-base truncate
              ${isCurrentPlayer ? 'text-avalon-gold' : 'text-avalon-parchment'}
            `}
          >
            {player.display_name}
          </span>

          {isCurrentPlayer && (
            <span className="text-sm font-medium text-avalon-silver">(You)</span>
          )}
        </div>

        {/* Badges */}
        <div className="flex items-center gap-2 mt-0.5">
          {player.is_manager && (
            <span className="badge badge-manager text-sm font-semibold">
              🏠 Manager
            </span>
          )}

          {!player.is_connected && (
            <span className="badge bg-avalon-silver/20 text-avalon-silver text-sm font-medium">
              Disconnected
            </span>
          )}
        </div>
      </div>

      {/* Connection indicator */}
      <div
        className={`
          w-2 h-2 rounded-full
          ${player.is_connected ? 'bg-good' : 'bg-avalon-silver/50'}
        `}
        title={player.is_connected ? 'Connected' : 'Disconnected'}
      />
    </div>
  );
}
