'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { PlayerList } from './PlayerList';
import { RolesInPlay } from './RolesInPlay';
import { LadyOfLakeBadge } from './LadyOfLakeBadge';
import { RulebookModal } from './rulebook/RulebookModal';
import { AIReviewToggle } from './lobby/AIReviewToggle';
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
  // Feature 022
  onToggleAIReview?: (enabled: boolean) => Promise<void>;
  isTogglingAIReview?: boolean;
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
  onToggleAIReview,
  isTogglingAIReview = false,
}: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const [showRulebook, setShowRulebook] = useState(false);
  const [confirmationsExpanded, setConfirmationsExpanded] = useState(false);
  // Track which player a force-confirm request is currently in-flight for
  // (per-player loading state so multiple force-confirms in a row don't
  // stomp each other's spinners).
  const [forcingPlayerId, setForcingPlayerId] = useState<string | null>(null);
  const [forceConfirmError, setForceConfirmError] = useState<string | null>(null);

  /**
   * Force-confirm a stuck player's role. Manager-only escape hatch:
   * when a player insists they've confirmed but the dashboard shows
   * them as ⏳ waiting, the manager can override. The endpoint is
   * idempotent — if the player has actually confirmed since the
   * dashboard last refreshed, the call returns success with no-op.
   */
  const handleForceConfirm = async (playerId: string, displayName: string) => {
    if (forcingPlayerId) return; // simple guard — only one at a time
    if (!confirm(`Force-confirm ${displayName}? Use only if they say they've already confirmed but the system still shows them as waiting.`)) {
      return;
    }
    setForcingPlayerId(playerId);
    setForceConfirmError(null);
    try {
      const res = await fetch(
        `/api/rooms/${room.room.code}/players/${playerId}/force-confirm`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setForceConfirmError(data?.error?.message ?? 'Force-confirm failed');
      }
      // Realtime broadcast on player_roles UPDATE will refresh the
      // dashboard; no manual refetch needed.
    } catch {
      setForceConfirmError('Network error');
    } finally {
      setForcingPlayerId(null);
    }
  };

  const isManager = room.current_player.is_manager;
  const isFull = room.players.length >= room.room.expected_players;
  const canDistribute = isManager && isFull && room.room.status === 'waiting';
  const allConfirmed = room.confirmations?.confirmed === room.confirmations?.total;
  const canStart = isManager && room.room.status === 'roles_distributed' && allConfirmed;
  const aiReviewEnabled = !!room.ai_review?.enabled;
  const aiConsented = room.ai_review?.consented_count ?? 0;
  const aiTotal = room.ai_review?.total_players ?? room.players.length;
  const aiConsentsComplete = !aiReviewEnabled || aiConsented >= aiTotal;
  const distributeBlockedByConsent = canDistribute && !aiConsentsComplete;

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
          currentUserId={room.current_player.id}
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
          holderName={room.lady_of_lake_holder.display_name}
          isCurrentPlayer={room.lady_of_lake_holder.id === room.current_player.id}
        />
      )}

      {/* Confirmation Progress (when roles distributed). Manager-only and
          collapsed by default — manager clicks the header to expand the
          per-player breakdown. Non-managers don't need the operational view;
          they have their own role card on the page. */}
      {isManager && room.room.status === 'roles_distributed' && room.confirmations && (
        <div className="card py-2 px-3">
          <button
            type="button"
            onClick={() => setConfirmationsExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left"
            aria-expanded={confirmationsExpanded}
          >
            <div className="flex items-center gap-2">
              {confirmationsExpanded ? (
                <ChevronDown size={16} className="text-avalon-silver/80" />
              ) : (
                <ChevronRight size={16} className="text-avalon-silver/80" />
              )}
              <p className="text-avalon-silver text-sm font-semibold">Confirmations</p>
            </div>
            <p className="text-lg font-display font-bold text-avalon-gold">
              {room.confirmations.confirmed} / {room.confirmations.total}
            </p>
          </button>

          {confirmationsExpanded && (() => {
            const details = room.confirmations!.details ?? [];
            const orphans = details.filter((d) => !d.in_room);
            const pending = details.filter((d) => d.in_room && !d.is_confirmed);
            const confirmed = details.filter((d) => d.in_room && d.is_confirmed);
            const allDone = room.confirmations!.confirmed === room.confirmations!.total;

            return (
              <>
                {allDone ? (
                  <p className="text-good text-xs mt-1">All confirmed!</p>
                ) : (
                  <p className="text-avalon-silver/80 text-xs mt-1">
                    {pending.length > 0
                      ? `Waiting for ${pending.length} player${pending.length === 1 ? '' : 's'} to confirm…`
                      : 'Waiting for all players to confirm…'}
                  </p>
                )}

                {/* Per-player breakdown — sorted: pending first, then orphans, then confirmed */}
                <ul className="mt-2 space-y-1 text-xs">
                  {[...pending, ...orphans, ...confirmed].map((p) => {
                    const isForcing = forcingPlayerId === p.player_id;
                    return (
                      <li
                        key={p.player_id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate text-avalon-silver">
                          {p.display_name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {!p.in_room ? (
                            <span
                              className="badge bg-evil/20 text-evil whitespace-nowrap"
                              title="This player left the room after roles were distributed. Their orphan role row is blocking the count — see the docs / leave route handling."
                            >
                              ⚠ left
                            </span>
                          ) : p.is_confirmed ? (
                            <span className="badge bg-good/20 text-good whitespace-nowrap">
                              ✓ confirmed
                            </span>
                          ) : (
                            <>
                              <span className="badge bg-avalon-gold/20 text-avalon-gold whitespace-nowrap">
                                ⏳ waiting
                              </span>
                              {/* Manager escape hatch — only for in-room, not-yet-confirmed players. */}
                              <button
                                type="button"
                                onClick={() => handleForceConfirm(p.player_id, p.display_name)}
                                disabled={isForcing || forcingPlayerId !== null}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-avalon-silver/30 text-avalon-silver hover:text-avalon-gold hover:border-avalon-gold/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                                title="Force-confirm this player's role (manager override)"
                              >
                                {isForcing ? '…' : 'Force ✓'}
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {forceConfirmError && (
                  <p className="mt-2 text-evil text-xs">{forceConfirmError}</p>
                )}

                {orphans.length > 0 && (
                  <p className="mt-2 text-evil text-xs">
                    {orphans.length} player{orphans.length === 1 ? ' has' : 's have'} left
                    after roles were distributed. The remaining players should leave and
                    rejoin so the manager can re-distribute.
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Feature 022: AI Game Reviewer — manager-only toggle, waiting phase only */}
      {isManager && room.room.status === 'waiting' && onToggleAIReview && (
        <AIReviewToggle
          enabled={aiReviewEnabled}
          consentedCount={aiConsented}
          totalPlayers={aiTotal}
          isToggling={isTogglingAIReview}
          onToggle={(enabled) => { void onToggleAIReview(enabled); }}
        />
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
              disabled={distributeBlockedByConsent}
            >
              ⚔️ Distribute Roles
            </Button>
          )}

          {distributeBlockedByConsent && (
            <p className="text-center text-avalon-silver/80 text-xs">
              Waiting for all players to accept the AI Review consent
              ({aiConsented} / {aiTotal}).
            </p>
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
