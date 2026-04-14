'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { RoomList } from '@/components/RoomList';
import { CreateRoomModal } from '@/components/CreateRoomModal';
import { usePlayer } from '@/hooks/usePlayer';
import { createBrowserClient } from '@/lib/supabase/client';
import { getPlayerId } from '@/lib/utils/player-id';
import { RefreshCw } from 'lucide-react';
import type { RoomListItem } from '@/types/room';

/**
 * Active rooms list page
 */
export default function RoomsPage() {
  const router = useRouter();
  const { isRegistered, isLoading: playerLoading, playerId } = usePlayer();

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningCode, setJoiningCode] = useState<string | null>(null);
  const [watchingCode, setWatchingCode] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  /**
   * Fetch rooms from API
   */
  const fetchRooms = useCallback(async () => {
    try {
      const response = await fetch('/api/rooms');
      if (!response.ok) {
        throw new Error('Failed to fetch rooms');
      }
      const { data } = await response.json();
      setRooms(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch rooms');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and real-time subscription
  useEffect(() => {
    fetchRooms();

    // Set up Supabase Realtime subscription for room changes
    const supabase = createBrowserClient();

    const channel = supabase
      .channel('rooms-list')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
        },
        () => {
          // Refresh room list on any room change
          fetchRooms();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
        },
        () => {
          // Refresh on player count changes
          fetchRooms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRooms]);

  // Redirect to home if not registered
  useEffect(() => {
    if (!playerLoading && !isRegistered) {
      router.push('/');
    }
  }, [playerLoading, isRegistered, router]);

  /**
   * Handle joining a room
   */
  const handleJoinRoom = async (code: string) => {
    if (!playerId) return;

    setJoiningCode(code);
    setError(null);

    try {
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: {
          'X-Player-ID': playerId,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to join room');
      }

      // Redirect to the room lobby
      router.push(`/rooms/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
      setJoiningCode(null);
    }
  };

  /**
   * Feature 015: Handle watching a game
   */
  const handleWatchRoom = (code: string, gameId: string) => {
    setWatchingCode(code);
    setError(null);
    // Navigate to watcher view (join will happen on page load)
    router.push(`/watch/${gameId}`);
  };

  /**
   * Handle room creation
   */
  const handleCreateRoom = async (expectedPlayers: number) => {
    const id = getPlayerId();
    if (!id) return;

    setIsCreatingRoom(true);
    setError(null);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': id,
        },
        body: JSON.stringify({ expected_players: expectedPlayers }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to create room');
      }

      // Redirect to the room lobby
      router.push(`/rooms/${data.data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
      setIsCreateModalOpen(false);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // Loading state
  if (playerLoading || isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-avalon-midnight min-h-screen">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-avalon-gold/30 border-t-avalon-gold rounded-full animate-spin mx-auto" />
          <p className="text-avalon-text-secondary">Searching for active rooms...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-start p-6 md:p-8 bg-avalon-midnight">
      <div className="w-full max-w-lg space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-avalon-gold">
              Active Rooms
            </h1>
            <p className="text-avalon-text-muted text-sm">
              Join an existing room or create your own
            </p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="text-avalon-text-secondary hover:text-avalon-gold transition-colors"
          >
            ← Back
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-evil/20 border border-evil/50 rounded-lg animate-slide-up">
            <p className="text-evil-light text-sm text-center">{error}</p>
          </div>
        )}

        {/* Create Room Button */}
        <Button
          variant="primary"
          fullWidth
          onClick={() => setIsCreateModalOpen(true)}
        >
          ⚔️ Create a Room
        </Button>

        {/* Room List */}
        <RoomList
          rooms={rooms}
          onJoin={handleJoinRoom}
          onWatch={handleWatchRoom}
          joiningCode={joiningCode}
          watchingCode={watchingCode}
        />

        {/* Refresh Button */}
        <button
          onClick={fetchRooms}
          className="w-full text-center text-avalon-text-secondary hover:text-avalon-gold transition-colors text-sm"
        >
          <RefreshCw size={16} className="inline" /> Refresh list
        </button>
      </div>

      {/* Create Room Modal */}
      <CreateRoomModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateRoom={handleCreateRoom}
        isLoading={isCreatingRoom}
      />
    </div>
  );
}
