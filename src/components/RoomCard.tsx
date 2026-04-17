'use client';

import { Button } from '@/components/ui/Button';
import { Eye } from 'lucide-react';
import type { RoomListItem } from '@/types/room';

interface RoomCardProps {
  room: RoomListItem;
  onJoin: (code: string) => void;
  onWatch?: (code: string, gameId: string) => void;
  isJoining?: boolean;
  isWatching?: boolean;
}

/**
 * Single room card for the room list
 * Feature 015: Added Watch button for games in progress
 */
export function RoomCard({
  room,
  onJoin,
  onWatch,
  isJoining = false,
  isWatching = false,
}: RoomCardProps) {
  const isFull = room.current_players >= room.expected_players;
  const isGameInProgress = room.status === 'started' && !!room.current_game_id;

  return (
    <div className="card hover:border-avalon-gold/30 transition-all">
      <div className="flex items-center justify-between gap-4">
        {/* Room Info */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-avalon-gold text-lg tracking-wider">
              {room.code}
            </span>
            {isFull && !isGameInProgress && (
              <span className="badge bg-avalon-silver/20 text-avalon-silver text-xs">
                Full
              </span>
            )}
            {isGameInProgress && (
              <span className="badge bg-emerald-500/20 text-emerald-400 text-xs">
                In Progress
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-avalon-silver">
            <span className="flex items-center gap-1">
              <span>🏠</span>
              <span className="truncate">{room.manager_display_name}</span>
            </span>
            <span className="flex items-center gap-1">
              <span>👥</span>
              <span>
                {room.current_players}/{room.expected_players}
              </span>
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {/* Watch Button - only show for games in progress */}
          {isGameInProgress && onWatch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onWatch(room.code, room.current_game_id!)}
              disabled={isWatching || isJoining}
              isLoading={isWatching}
              title="Watch this game"
            >
              <Eye size={16} />
            </Button>
          )}

          {/* Join Button */}
          <Button
            variant={isFull || isGameInProgress ? 'ghost' : 'primary'}
            size="sm"
            onClick={() => onJoin(room.code)}
            disabled={isFull || isJoining || isGameInProgress || isWatching}
            isLoading={isJoining}
          >
            {isGameInProgress ? 'Started' : isFull ? 'Full' : 'Join'}
          </Button>
        </div>
      </div>

      {/* Player slots visualization */}
      <div className="mt-3 pt-3 border-t border-avalon-silver/10">
        <div className="flex gap-1">
          {Array.from({ length: room.expected_players }).map((_, i) => (
            <div
              key={i}
              className={`
                flex-1 h-1.5 rounded-full
                ${i < room.current_players
                  ? 'bg-avalon-gold'
                  : 'bg-avalon-silver/20'
                }
              `}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
