'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { AlertTriangle, Search } from 'lucide-react';
import { Lobby } from '@/components/Lobby';
import { RoleRevealModal } from '@/components/RoleRevealModal';
import { VideoRoom } from '@/components/video';
import { ViewModeToggle } from '@/components/video/ViewModeToggle';
import { VideoControls } from '@/components/video/VideoControls';
import { ChatPanel } from '@/components/video/ChatPanel';
import { ResizableSplit } from '@/components/video/ResizableSplit';
import { useLiveKit } from '@/hooks/useLiveKit';
import { useRoom } from '@/hooks/useRoom';
import { useAuth } from '@/hooks/useAuth';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import type { SplitIntelVisibility, OberonSplitIntelVisibility } from '@/types/game';

export default function RoomPage() {
  const params = useParams();
  const code = params.code as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { room, isLoading: roomLoading, error, isConnected, rolesInPlay, leave, refresh } = useRoom(code);
  const { disconnect: disconnectVideo, isConnected: videoConnected, viewMode } = useLiveKit();

  // Activity heartbeat for disconnect detection
  useHeartbeat({ enabled: !!user && !roomLoading });

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
    has_decoy?: boolean;
    decoy_warning?: string;
    split_intel?: SplitIntelVisibility;
    oberon_split_intel?: OberonSplitIntelVisibility;
  } | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?returnTo=/rooms/${code}`);
    }
  }, [authLoading, user, router, code]);

  // Fetch role when roles are distributed
  useEffect(() => {
    const loadRole = async () => {
      try {
        const response = await fetch(`/api/rooms/${code}/role`);

        if (response.ok) {
          const { data } = await response.json();
          setRoleData(data);
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
          const response = await fetch(`/api/rooms/${code}/game`);

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

  const handleDistributeRoles = async () => {
    setIsDistributing(true);
    setRoleError(null);

    try {
      const response = await fetch(`/api/rooms/${code}/distribute`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to distribute roles');
      }

      await refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to distribute roles');
    } finally {
      setIsDistributing(false);
    }
  };

  const handleConfirmRole = async () => {
    try {
      const response = await fetch(`/api/rooms/${code}/confirm`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to confirm role');
      }

      if (roleData) {
        setRoleData({ ...roleData, is_confirmed: true });
      }
      setShowRoleModal(false);

      await refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to confirm role');
    }
  };

  const handleStartGame = async () => {
    setIsStarting(true);
    setRoleError(null);

    try {
      const response = await fetch(`/api/rooms/${code}/start`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to start game');
      }
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsStarting(false);
    }
  };

  const handleLeave = async () => {
    disconnectVideo();
    const success = await leave();
    if (success) {
      router.push('/');
    }
  };

  // Loading state
  if (authLoading || roomLoading) {
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
          <div className="text-4xl"><AlertTriangle size={32} /></div>
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

  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-avalon-midnight min-h-screen">
        <div className="card max-w-md w-full text-center space-y-4">
          <div className="text-4xl"><Search size={32} /></div>
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

  const lobbyContent = (
    <>
      {roleError && (
        <div className="p-4 bg-evil/20 border border-evil/50 rounded-lg animate-slide-up">
          <p className="text-evil-light text-sm text-center">{roleError}</p>
        </div>
      )}

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
    </>
  );

  return (
    <main className="h-screen bg-avalon-midnight flex flex-col overflow-hidden">
      {videoConnected && (
        <div className="fixed top-6 right-4 flex items-center gap-4 px-4 py-1.5 bg-avalon-midnight/60 backdrop-blur-md rounded-full border border-avalon-dark-border/50 z-50">
          <ViewModeToggle />
          <div className="flex items-center gap-2">
            <ChatPanel />
            <VideoControls />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {videoConnected && viewMode === 'video' ? (
          <div className="h-full">
            <VideoRoom roomCode={code} fullscreen hideControls />
          </div>
        ) : videoConnected && viewMode === 'split' ? (
          <ResizableSplit
            defaultLeftPercent={35}
            minLeftPercent={30}
            maxLeftPercent={60}
            left={
              <div className="h-full overflow-y-auto p-4 space-y-4">
                {lobbyContent}
              </div>
            }
            right={
              <VideoRoom roomCode={code} fullscreen hideControls />
            }
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="flex flex-col items-center p-6 md:p-8">
              <div className="w-full max-w-lg animate-fade-in space-y-4 pb-8">
                {!videoConnected && (
                  <div className="flex items-center justify-center py-2 px-4 bg-avalon-navy/50 rounded-lg border border-avalon-dark-border">
                    <VideoRoom roomCode={code} inline />
                  </div>
                )}
                {lobbyContent}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
