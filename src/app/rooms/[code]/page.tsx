'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import { AlertTriangle, Search } from 'lucide-react';
import { Lobby } from '@/components/Lobby';
import type { RoomConfigUpdate } from '@/components/lobby/RoomConfigEditor';
import { RoleRevealModal } from '@/components/RoleRevealModal';
import { VideoRoom } from '@/components/video';
import { ViewModeToggle } from '@/components/video/ViewModeToggle';
import { VideoControls } from '@/components/video/VideoControls';
import { ChatPanel } from '@/components/video/ChatPanel';
import { LayoutSwapButton } from '@/components/video/LayoutSwapButton';
import { EmojiReactions } from '@/components/video/EmojiReactions';
import { ResizableSplit } from '@/components/video/ResizableSplit';
import { useLiveKit } from '@/hooks/useLiveKit';
import { useRoom } from '@/hooks/useRoom';
import { useAuth } from '@/hooks/useAuth';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import type { RoleDetails } from '@/types/role';

export default function RoomPage() {
  const params = useParams();
  const code = params.code as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { room, isLoading: roomLoading, error, isConnected, rolesInPlay, leave, refresh } = useRoom(code);
  const { disconnect: disconnectVideo, isConnected: videoConnected, viewMode, isLayoutSwapped, setControlsLocked, broadcastControlsLock } = useLiveKit();

  // Activity heartbeat for disconnect detection
  useHeartbeat({ enabled: !!user && !roomLoading });

  const [isDistributing, setIsDistributing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isTogglingAIReview, setIsTogglingAIReview] = useState(false);
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [updateConfigError, setUpdateConfigError] = useState<string | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleData, setRoleData] = useState<RoleDetails | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?returnTo=/rooms/${code}`);
    }
  }, [authLoading, user, router, code]);

  // Fetch role when roles are distributed. Also re-fetched on room activity, so
  // a re-deal after someone leaves is picked up even if the brief 'waiting'
  // state fell between polls.
  useEffect(() => {
    const status = room?.room.status;

    // Back in the lobby (someone left mid-deal): the old roles are gone.
    if (status === 'waiting') {
      setRoleData(null);
      setShowRoleModal(false);
      setConfirmError(null);
      return;
    }
    if (status !== 'roles_distributed' && status !== 'started') return;

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

    loadRole();
  }, [room?.room.status, room?.room.last_activity_at, code]);

  // Fallback lock sync: polling catches players who missed the LiveKit broadcast,
  // and re-applies the correct lock state when a player reconnects video mid-window.
  useEffect(() => {
    setControlsLocked(room?.room.status === 'roles_distributed');
  }, [room?.room.status, setControlsLocked, videoConnected]);

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

      broadcastControlsLock(true);
      await refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to distribute roles');
    } finally {
      setIsDistributing(false);
    }
  };

  const handleConfirmRole = async () => {
    setConfirmError(null);
    try {
      const response = await fetch(`/api/rooms/${code}/confirm`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        // A retry after a lost response: the first attempt already went through.
        if (data.error?.code !== 'ALREADY_CONFIRMED') {
          throw new Error(data.error?.message || 'Failed to confirm role');
        }
      }

      setRoleData((prev) => prev && { ...prev, is_confirmed: true });
      setShowRoleModal(false);

      await refresh();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to confirm role');
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

  // Feature 022: AI Game Reviewer
  const handleToggleAIReview = async (enabled: boolean, mode: 'blind' | 'god' = 'blind') => {
    setIsTogglingAIReview(true);
    setRoleError(null);
    try {
      const response = await fetch(`/api/rooms/${code}/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, mode }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to toggle AI Game Review');
      }
      await refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'Failed to toggle AI Game Review');
    } finally {
      setIsTogglingAIReview(false);
    }
  };

  // Edit room setup (role config + player count + intro) before distribution.
  const handleUpdateConfig = async (update: RoomConfigUpdate) => {
    setIsUpdatingConfig(true);
    setUpdateConfigError(null);
    try {
      const response = await fetch(`/api/rooms/${code}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to update room setup');
      }
      await refresh();
    } catch (err) {
      setUpdateConfigError(err instanceof Error ? err.message : 'Failed to update room setup');
    } finally {
      setIsUpdatingConfig(false);
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
        onToggleAIReview={handleToggleAIReview}
        isTogglingAIReview={isTogglingAIReview}
        onUpdateConfig={handleUpdateConfig}
        isUpdatingConfig={isUpdatingConfig}
        updateConfigError={updateConfigError}
      />

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
      {/* Rendered outside the layout below so it shows in every view mode
          (the lobby panel is hidden in 'video' view) and survives layout
          switches such as a video reconnect. */}
      {roleData && (
        <RoleRevealModal
          isOpen={showRoleModal}
          onClose={() => setShowRoleModal(false)}
          details={roleData}
          onConfirm={handleConfirmRole}
          confirmError={confirmError}
        />
      )}

      {videoConnected && (
        <div className={`fixed top-6 ${isLayoutSwapped && viewMode === 'split' ? 'left-4 origin-top-left' : 'right-4 origin-top-right'} md:scale-[1.15] flex items-center gap-2 md:gap-4 px-2 md:px-4 py-1.5 bg-avalon-midnight/60 backdrop-blur-md rounded-full border border-avalon-dark-border/50 z-50`}>
          <ViewModeToggle />
          <div className="flex items-center gap-2">
            <LayoutSwapButton />
            <EmojiReactions />
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
            reversed={isLayoutSwapped}
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
