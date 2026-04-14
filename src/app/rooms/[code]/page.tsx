'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { Lobby } from '@/components/Lobby';
import { RoleRevealModal } from '@/components/RoleRevealModal';
import { SessionTakeoverAlert } from '@/components/SessionTakeoverAlert';
import { VideoRoom } from '@/components/video';
import { useLiveKit } from '@/hooks/useLiveKit';
import { useRoom } from '@/hooks/useRoom';
import { usePlayer } from '@/hooks/usePlayer';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { getPlayerId } from '@/lib/utils/player-id';
import type { SplitIntelVisibility, OberonSplitIntelVisibility } from '@/types/game';

export default function RoomPage() {
  const params = useParams();
  const code = params.code as string;
  const router = useRouter();
  const { isRegistered, isLoading: playerLoading } = usePlayer();
  const { room, isLoading: roomLoading, error, isConnected, rolesInPlay, sessionTakenOver, leave, refresh } = useRoom(code);
  const { disconnect: disconnectVideo } = useLiveKit();

  // T035: Activity heartbeat for disconnect detection
  useHeartbeat({ enabled: isRegistered && !roomLoading && !sessionTakenOver });

  const [isDistributing, setIsDistributing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleData, setRoleData] = useState<{
    role: 'good' | 'evil';
    special_role?: 'merlin' | 'percival' | 'servant' | 'assassin' | 'morgana' | 'mordred' | 'oberon_standard' | 'oberon_chaos' | 'minion';
    role_name: string;
    role_description: string;
    is_confirmed: boolean;
    has_lady_of_lake?: boolean;
    known_players?: string[];
    known_players_label?: string;
    hidden_evil_count?: number;
    ability_note?: string;
    // Feature 009: Merlin Decoy Mode
    has_decoy?: boolean;
    decoy_warning?: string;
    // Feature 011: Merlin Split Intel Mode
    split_intel?: SplitIntelVisibility;
    // Feature 018: Oberon Split Intel Mode
    oberon_split_intel?: OberonSplitIntelVisibility;
  } | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Redirect to home if not registered
  useEffect(() => {
    if (!playerLoading && !isRegistered) {
      router.push('/');
    }
  }, [playerLoading, isRegistered, router]);

  // Fetch role when roles are distributed
  useEffect(() => {
    const loadRole = async () => {
      try {
        const playerId = getPlayerId();
        const response = await fetch(`/api/rooms/${code}/role`, {
          headers: {
            'X-Player-ID': playerId,
          },
        });

        if (response.ok) {
          const { data } = await response.json();
          setRoleData(data);
          // Show modal if not confirmed yet
          if (!data.is_confirmed) {
            setShowRoleModal(true);
          }
        }
      } catch (err) {
        console.error('Failed to fetch role:', err);
      }
    };

    if (room?.room.status === 'roles_distributed' || room?.room.status === 'started') {
      loadRole();
    }
  }, [room?.room.status, code]);

  // Redirect to game page when game starts
  useEffect(() => {
    const redirectToGame = async () => {
      if (room?.room.status === 'started') {
        try {
          const playerId = getPlayerId();
          const response = await fetch(`/api/rooms/${code}/game`, {
            headers: { 'X-Player-ID': playerId },
          });

          if (response.ok) {
            const { data } = await response.json();
            if (data.has_game && data.game_id) {
              router.push(`/game/${data.game_id}`);
            }
          }
        } catch (err) {
          console.error('Failed to get game:', err);
        }
      }
    };

    redirectToGame();
  }, [room?.room.status, code, router]);

  /**
   * Handle role distribution (manager only)
   */
  const handleDistributeRoles = async () => {
    setIsDistributing(true);
    setRoleError(null);

    try {
      const playerId = getPlayerId();
      const response = await fetch(`/api/rooms/${code}/distribute`, {
        method: 'POST',
        headers: {
          'X-Player-ID': playerId,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to distribute roles');
      }

      // Refresh room data
      await refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to distribute roles');
    } finally {
      setIsDistributing(false);
    }
  };

  /**
   * Handle role confirmation
   */
  const handleConfirmRole = async () => {
    try {
      const playerId = getPlayerId();
      const response = await fetch(`/api/rooms/${code}/confirm`, {
        method: 'POST',
        headers: {
          'X-Player-ID': playerId,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to confirm role');
      }

      // Update local state
      if (roleData) {
        setRoleData({ ...roleData, is_confirmed: true });
      }
      setShowRoleModal(false);

      // Refresh room data
      await refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to confirm role');
    }
  };

  /**
   * Handle starting the game (manager only)
   */
  const handleStartGame = async () => {
    setIsStarting(true);
    setRoleError(null);

    try {
      const playerId = getPlayerId();
      const response = await fetch(`/api/rooms/${code}/start`, {
        method: 'POST',
        headers: {
          'X-Player-ID': playerId,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to start game');
      }

      // Redirect will happen via useEffect when room status changes
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * Handle leaving the room
   */
  const handleLeave = async () => {
    disconnectVideo();
    const success = await leave();
    if (success) {
      router.push('/');
    }
  };

  // Loading state
  if (playerLoading || roomLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-avalon-midnight min-h-screen">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-avalon-gold/30 border-t-avalon-gold rounded-full animate-spin mx-auto" />
          <p className="text-avalon-text-secondary">Entering the chamber...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-avalon-midnight min-h-screen">
        <div className="card max-w-md w-full text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="font-display text-xl text-avalon-gold">Room Not Found</h2>
          <p className="text-avalon-text-secondary">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="text-avalon-gold hover:underline"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // No room data
  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-avalon-midnight min-h-screen">
        <div className="card max-w-md w-full text-center space-y-4">
          <div className="text-4xl">🔍</div>
          <h2 className="font-display text-xl text-avalon-gold">Room Not Found</h2>
          <p className="text-avalon-text-secondary">
            This room doesn&apos;t exist or you&apos;re not a member.
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-avalon-gold hover:underline"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-6 md:p-8 bg-avalon-midnight min-h-screen">
      <div className="w-full max-w-lg animate-fade-in space-y-4">
        {/* Video Room */}
        <VideoRoom roomCode={code} />

        {/* Error Display */}
        {roleError && (
          <div className="p-4 bg-evil/20 border border-evil/50 rounded-lg animate-slide-up">
            <p className="text-evil-light text-sm text-center">{roleError}</p>
          </div>
        )}

        {/* Main Lobby */}
        <Lobby
          room={room}
          rolesInPlay={rolesInPlay}
          onLeave={handleLeave}
          onDistributeRoles={handleDistributeRoles}
          onStartGame={handleStartGame}
          isDistributing={isDistributing}
          isStarting={isStarting}
          isConnected={isConnected}
        />

        {/* Role Reveal Modal */}
        {roleData && (
          <RoleRevealModal
            isOpen={showRoleModal}
            onClose={() => setShowRoleModal(false)}
            role={roleData.role}
            specialRole={roleData.special_role}
            roleName={roleData.role_name}
            roleDescription={roleData.role_description}
            knownPlayers={roleData.known_players}
            knownPlayersLabel={roleData.known_players_label}
            hiddenEvilCount={roleData.hidden_evil_count}
            hasLadyOfLake={roleData.has_lady_of_lake}
            isConfirmed={roleData.is_confirmed}
            onConfirm={handleConfirmRole}
            hasDecoy={roleData.has_decoy}
            decoyWarning={roleData.decoy_warning}
            splitIntel={roleData.split_intel}
            oberonSplitIntel={roleData.oberon_split_intel}
          />
        )}

        {/* Show Role Button (if already confirmed) */}
        {roleData?.is_confirmed && (
          <div className="mt-4">
            <button
              onClick={() => setShowRoleModal(true)}
              className="w-full text-center text-avalon-text-secondary hover:text-avalon-gold transition-colors text-sm"
            >
              View my role →
            </button>
          </div>
        )}
      </div>

      {/* T072: Session Takeover Alert */}
      <SessionTakeoverAlert isOpen={sessionTakenOver} />
    </div>
  );
}
