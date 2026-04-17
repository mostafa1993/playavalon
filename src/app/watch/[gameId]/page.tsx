'use client';

/**
 * Watcher View Page
 * Feature 015: /app/watch/[gameId]/page.tsx
 *
 * Entry point for spectators watching a game.
 */

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { WatcherGameBoard } from '@/components/game/WatcherGameBoard';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Eye } from 'lucide-react';

interface PageParams {
  gameId: string;
}

export default function WatcherPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const resolvedParams = use(params);
  const gameId = resolvedParams.gameId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [isJoining, setIsJoining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasJoined, setHasJoined] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?returnTo=/watch/${gameId}`);
    }
  }, [authLoading, user, router, gameId]);

  // Join as watcher on mount
  useEffect(() => {
    if (!user) return;

    async function joinAsWatcher() {
      try {
        const response = await fetch(`/api/watch/${gameId}/join`, {
          method: 'POST',
        });

        if (!response.ok) {
          const data = await response.json();
          const errorCode = data.error?.code;

          switch (errorCode) {
            case 'GAME_NOT_STARTED':
              setError('Game hasn\'t started yet. Watching will be available once the game begins.');
              break;
            case 'WATCHER_LIMIT_REACHED':
              setError('This game has reached the maximum number of spectators (10).');
              break;
            case 'GAME_NOT_FOUND':
              setError('Game not found.');
              break;
            case 'UNAUTHORIZED':
              setError('You must be logged in to watch games.');
              break;
            default:
              setError(data.error?.message || 'Failed to join as watcher');
          }
          setIsJoining(false);
          return;
        }

        setHasJoined(true);
        setIsJoining(false);
      } catch (err) {
        console.error('Failed to join as watcher:', err);
        setError('Failed to connect. Please try again.');
        setIsJoining(false);
      }
    }

    joinAsWatcher();
  }, [gameId, user]);

  if (authLoading || isJoining) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 bg-avalon-midnight min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-avalon-gold border-t-transparent mx-auto mb-4" />
          <p className="text-avalon-silver/80">Joining as spectator...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 bg-avalon-midnight min-h-screen">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4"><Eye size={48} /></div>
          <h1 className="text-2xl font-bold text-avalon-gold mb-4">
            Cannot Watch Game
          </h1>
          <p className="text-red-400 mb-6">{error}</p>
          <Button onClick={() => router.push('/')}>
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  if (hasJoined) {
    return (
      <div className="flex-1 flex flex-col p-6 md:p-8 bg-avalon-midnight min-h-screen">
        <WatcherGameBoard gameId={gameId} />
      </div>
    );
  }

  return null;
}
