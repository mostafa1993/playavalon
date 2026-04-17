'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Copy, Check } from 'lucide-react';
import { PlayerList } from './PlayerList';
import { RolesInPlay } from './RolesInPlay';
import { LadyOfLakeBadge } from './LadyOfLakeBadge';
import { RulebookModal } from './rulebook/RulebookModal';
import type { RoomDetails } from '@/types/room';

interface LobbyProps {
  room: RoomDetails;
  rolesInPlay?: string[];
  onLeave: () => void;
  onDistributeRoles?: () => Promise<void>;
  onStartGame?: () => Promise<void>;
  isDistributing?: boolean;
  isStarting?: boolean;
  isConnected?: boolean;
}

/**
 * T034: Main lobby view container
 * Updated for Phase 2 to include RolesInPlay section
 */
export function Lobby({
  room,
  rolesInPlay = [],
  onLeave,
  onDistributeRoles,
  onStartGame,
  isDistributing = false,
  isStarting = false,
  isConnected = true,
}: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const [showRulebook, setShowRulebook] = useState(false);

  const isManager = room.current_player.is_manager;
  const isFull = room.players.length >= room.room.expected_players;
  const canDistribute = isManager && isFull && room.room.status === 'waiting';
  const allConfirmed = room.confirmations?.confirmed === room.confirmations?.total;
  const canStart = isManager && room.room.status === 'roles_distributed' && allConfirmed;

  /**
   * Copy room code to clipboard
   */
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Room Header — compact */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <p className="text-avalon-silver text-xs font-semibold uppercase tracking-wider">
            Room Code
          </p>
          <button
            onClick={handleCopyCode}
            className="group flex items-center gap-1"
          >
            <span className="text-2xl font-mono font-bold text-avalon-gold tracking-widest">
              {room.room.code}
            </span>
            <span
              className={`
                text-xs font-medium transition-all
                ${copied
                  ? 'text-good'
                  : 'text-avalon-silver/50 group-hover:text-avalon-gold'
                }
              `}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </span>
          </button>
        </div>

        {/* Room Status */}
        <div className="flex items-center justify-center gap-2">
          <span
            className={`
              badge
              ${room.room.status === 'waiting'
                ? 'bg-avalon-gold/20 text-avalon-gold'
                : room.room.status === 'roles_distributed'
                ? 'bg-good/20 text-good'
                : 'bg-avalon-silver/20 text-avalon-silver'
              }
            `}
          >
            {room.room.status === 'waiting' && 'Waiting for players'}
            {room.room.status === 'roles_distributed' && 'Roles distributed'}
            {room.room.status === 'started' && 'Game in progress'}
          </span>
          
          {/* Real-time Connection Status */}
          <span
            className={`
              flex items-center gap-1.5 text-sm font-semibold
              ${isConnected ? 'text-good' : 'text-avalon-silver/50'}
            `}
            title={isConnected ? 'Real-time sync active' : 'Reconnecting...'}
          >
            <span
              className={`
                w-2.5 h-2.5 rounded-full
                ${isConnected ? 'bg-good animate-pulse' : 'bg-avalon-silver/50'}
              `}
            />
            {isConnected ? 'Live' : 'Syncing...'}
          </span>

          {/* Rulebook Button */}
          <button
            onClick={() => setShowRulebook(true)}
            className="px-2 py-1 text-xs rounded-md border border-avalon-dark-border text-avalon-text-secondary hover:bg-avalon-dark-lighter hover:text-avalon-gold transition-colors"
            title="View Rulebook"
          >
            ?
          </button>
        </div>
      </div>

      {/* Player List */}
      <div className="card">
        <PlayerList
          players={room.players}
          currentPlayerId={room.current_player.id}
          expectedPlayers={room.room.expected_players}
        />
      </div>

      {/* T034: Roles In Play Section */}
      {rolesInPlay.length > 0 && (
        <RolesInPlay
          rolesInPlay={rolesInPlay}
          roleConfig={room.room.role_config}
        />
      )}

      {/* Lady of the Lake indicator (after distribution) */}
      {room.lady_of_lake_holder && room.room.status !== 'waiting' && (
        <LadyOfLakeBadge
          holderName={room.lady_of_lake_holder.nickname}
          isCurrentPlayer={room.lady_of_lake_holder.id === room.current_player.id}
        />
      )}

      {/* Confirmation Progress (when roles distributed) */}
      {room.room.status === 'roles_distributed' && room.confirmations && (
        <div className="card py-2 px-3">
          <div className="flex items-center justify-between">
            <p className="text-avalon-silver text-sm font-semibold">Confirmations</p>
            <p className="text-lg font-display font-bold text-avalon-gold">
              {room.confirmations.confirmed} / {room.confirmations.total}
            </p>
          </div>
          {room.confirmations.confirmed === room.confirmations.total ? (
            <p className="text-good text-xs">All confirmed!</p>
          ) : (
            <p className="text-avalon-silver/80 text-xs">
              Waiting for all players to confirm...
            </p>
          )}
        </div>
      )}

      {/* Manager Controls */}
      {isManager && (
        <div className="space-y-2">
          {canDistribute && onDistributeRoles && (
            <Button
              variant="primary"
              fullWidth
              onClick={onDistributeRoles}
              isLoading={isDistributing}
            >
              ⚔️ Distribute Roles
            </Button>
          )}

          {canStart && onStartGame && (
            <Button
              variant="primary"
              fullWidth
              onClick={onStartGame}
              isLoading={isStarting}
            >
              🎮 Start Game
            </Button>
          )}

          {!isFull && room.room.status === 'waiting' && (
            <p className="text-center text-avalon-silver/80 text-xs">
              Waiting for {room.room.expected_players - room.players.length} more{' '}
              {room.room.expected_players - room.players.length === 1
                ? 'player'
                : 'players'}
              ...
            </p>
          )}
        </div>
      )}

      {/* Leave Button */}
      <div className="pt-2 border-t border-avalon-silver/10">
        <Button
          variant="ghost"
          fullWidth
          size="sm"
          onClick={onLeave}
          className="text-avalon-silver hover:text-evil-light"
        >
          Leave Room
        </Button>
      </div>

      {/* Rulebook Modal */}
      <RulebookModal isOpen={showRulebook} onClose={() => setShowRulebook(false)} />
    </div>
  );
}
