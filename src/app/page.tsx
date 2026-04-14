'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CreateRoomModal } from '@/components/CreateRoomModal';
import { FindMyGame } from '@/components/FindMyGame';
import { ReturningPlayerPanel } from '@/components/ReturningPlayerPanel';
import { usePlayer } from '@/hooks/usePlayer';
import { validateNickname, validateRoomCode } from '@/lib/domain/validation';
import type { RoleConfig } from '@/types/role-config';
import { Eye, BookOpen } from 'lucide-react';
import type { WatchStatusResponse } from '@/types/watcher';

export default function Home() {
  const router = useRouter();
  const { playerId, nickname, isRegistered, isLoading: playerLoading, register } = usePlayer();

  // Form states
  const [nicknameInput, setNicknameInput] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showReturningPlayer, setShowReturningPlayer] = useState(false);

  // Loading states
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [isWatchingRoom, setIsWatchingRoom] = useState(false);

  // Error states
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Feature 015: Watch status state
  const [watchStatus, setWatchStatus] = useState<WatchStatusResponse | null>(null);
  const [isCheckingWatchStatus, setIsCheckingWatchStatus] = useState(false);

  // Pre-fill nickname if already registered
  useEffect(() => {
    if (nickname) {
      setNicknameInput(nickname);
    }
  }, [nickname]);

  /**
   * Feature 015: Check if room is watchable when room code changes
   */
  const checkWatchStatus = useCallback(async (code: string) => {
    if (!playerId || code.length !== 6) {
      setWatchStatus(null);
      return;
    }

    setIsCheckingWatchStatus(true);
    try {
      const response = await fetch(`/api/rooms/${code.toUpperCase()}/watch-status`, {
        headers: { 'X-Player-ID': playerId },
      });

      if (response.ok) {
        const data = await response.json();
        setWatchStatus(data.data);
      } else {
        setWatchStatus(null);
      }
    } catch {
      setWatchStatus(null);
    } finally {
      setIsCheckingWatchStatus(false);
    }
  }, [playerId]);

  // Check watch status when room code input changes
  useEffect(() => {
    if (roomCodeInput.length === 6 && isRegistered) {
      checkWatchStatus(roomCodeInput);
    } else {
      setWatchStatus(null);
    }
  }, [roomCodeInput, isRegistered, checkWatchStatus]);

  /**
   * Feature 015: Handle watching a room
   */
  const handleWatchRoom = async () => {
    setRoomCodeError(null);
    setGeneralError(null);

    if (!playerId || !watchStatus?.gameId || !watchStatus.watchable) {
      return;
    }

    setIsWatchingRoom(true);
    try {
      // Navigate to watcher view (join will happen on page load)
      router.push(`/watch/${watchStatus.gameId}`);
    } catch (err) {
      setRoomCodeError(err instanceof Error ? err.message : 'Failed to start watching');
    } finally {
      setIsWatchingRoom(false);
    }
  };

  /**
   * Handle nickname registration
   */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setNicknameError(null);
    setGeneralError(null);

    const validation = validateNickname(nicknameInput);
    if (!validation.valid) {
      setNicknameError(validation.error || 'Invalid nickname');
      return;
    }

    setIsRegistering(true);
    try {
      const result = await register(nicknameInput);
      if (!result) {
        setNicknameError('Failed to register. Please try again.');
      }
    } catch {
      setNicknameError('Failed to register. Please try again.');
    } finally {
      setIsRegistering(false);
    }
  };

  /**
   * T030: Handle room creation with role configuration
   */
  const handleCreateRoom = async (expectedPlayers: number, roleConfig: RoleConfig) => {
    if (!playerId) return;

    setGeneralError(null);
    setIsCreatingRoom(true);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': playerId,
        },
        body: JSON.stringify({
          expected_players: expectedPlayers,
          role_config: roleConfig,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to create room');
      }

      // Redirect to the room lobby
      router.push(`/rooms/${data.data.code}`);
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : 'Failed to create room');
      setIsCreateModalOpen(false);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  /**
   * Handle joining room by code
   */
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomCodeError(null);
    setGeneralError(null);

    const validation = validateRoomCode(roomCodeInput);
    if (!validation.valid) {
      setRoomCodeError(validation.error || 'Invalid room code');
      return;
    }

    if (!playerId) {
      setRoomCodeError('Please enter your nickname first');
      return;
    }

    setIsJoiningRoom(true);
    try {
      const response = await fetch(`/api/rooms/${roomCodeInput.toUpperCase()}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': playerId,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to join room');
      }

      // Redirect to the room lobby
      router.push(`/rooms/${roomCodeInput.toUpperCase()}`);
    } catch (err) {
      setRoomCodeError(err instanceof Error ? err.message : 'Failed to join room');
    } finally {
      setIsJoiningRoom(false);
    }
  };

  // Show loading state during initial player initialization
  if (playerLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-avalon-midnight min-h-screen">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-avalon-gold/30 border-t-avalon-gold rounded-full animate-spin mx-auto" />
          <p className="text-avalon-text-secondary">Preparing the Round Table...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 bg-avalon-midnight min-h-screen">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        {/* Logo / Title */}
        <div className="text-center space-y-3">
          <h1 className="text-5xl md:text-6xl font-display font-bold text-avalon-gold text-shadow">
            AVALON
          </h1>
          <p className="text-lg md:text-xl text-avalon-text-secondary font-body italic">
            The Resistance: Social Deduction
          </p>
        </div>

        {/* General Error Display */}
        {generalError && (
          <div className="p-4 bg-evil/20 border border-evil/50 rounded-lg animate-slide-up">
            <p className="text-evil-light text-base font-medium text-center">{generalError}</p>
          </div>
        )}

        {/* Main Card */}
        <div className="card animate-slide-up">
          {!isRegistered ? (
            showReturningPlayer ? (
              /* Returning Player Flow - Session Restore */
              <ReturningPlayerPanel onBack={() => setShowReturningPlayer(false)} />
            ) : (
              /* Step 1: Enter Nickname */
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-display font-bold text-avalon-gold">
                    Welcome, Knight
                  </h2>
                  <p className="text-avalon-text-muted text-base font-medium">
                    Enter your name to join the Round Table
                  </p>
                </div>

                <form onSubmit={handleRegister} className="space-y-4">
                  <Input
                    label="Your Nickname"
                    placeholder="Enter 3-20 characters"
                    value={nicknameInput}
                    onChange={(e) => setNicknameInput(e.target.value)}
                    error={nicknameError || undefined}
                    maxLength={20}
                    disabled={isRegistering}
                  />

                  <Button
                    type="submit"
                    variant="primary"
                    fullWidth
                    isLoading={isRegistering}
                  >
                    Continue
                  </Button>
                </form>

                {/* Returning Player Option */}
                <div className="pt-4 border-t border-avalon-dark-border">
                  <button
                    onClick={() => setShowReturningPlayer(true)}
                    className="w-full text-center text-avalon-text-secondary hover:text-avalon-gold transition-colors text-base font-medium"
                  >
                    Already in a game? <span className="underline font-semibold">Restore session</span> →
                  </button>
                </div>
              </div>
            )
          ) : (
            /* Step 2: Create or Join Room */
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <p className="text-avalon-text-muted text-base font-medium">Welcome back,</p>
                <h2 className="text-2xl font-display font-bold text-avalon-gold">
                  {nickname}
                </h2>
              </div>

              {/* Create Room */}
              <div className="space-y-3">
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => setIsCreateModalOpen(true)}
                  size="lg"
                >
                  ⚔️ Create a Room
                </Button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-avalon-dark-border" />
                <span className="text-avalon-text-muted text-base font-medium">or</span>
                <div className="flex-1 h-px bg-avalon-dark-border" />
              </div>

              {/* Join by Code */}
              <form onSubmit={handleJoinRoom} className="space-y-3">
                <Input
                  label="Join by Room Code"
                  placeholder="Enter 6-character code"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  error={roomCodeError || undefined}
                  maxLength={6}
                  disabled={isJoiningRoom || isWatchingRoom}
                  className="text-center tracking-widest font-mono text-lg"
                />

                {/* Feature 015: Watch Status Indicator */}
                {roomCodeInput.length === 6 && (
                  <div className="text-xs text-center">
                    {isCheckingWatchStatus ? (
                      <span className="text-avalon-text-muted">Checking room status...</span>
                    ) : watchStatus?.watchable ? (
                      <span className="text-emerald-400">
                        <Eye size={16} className="inline" /> Game in progress • {watchStatus.watcherCount}/{watchStatus.watcherLimit} watching
                      </span>
                    ) : watchStatus?.reason === 'GAME_NOT_STARTED' ? (
                      <span className="text-blue-400">Room found • Game hasn&apos;t started yet</span>
                    ) : watchStatus?.reason === 'GAME_ENDED' ? (
                      <span className="text-avalon-text-muted">Game has ended</span>
                    ) : watchStatus?.reason === 'ROOM_NOT_FOUND' ? (
                      <span className="text-red-400">Room not found</span>
                    ) : null}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="secondary"
                    fullWidth
                    isLoading={isJoiningRoom}
                    disabled={roomCodeInput.length < 6 || isWatchingRoom}
                  >
                    Join Room
                  </Button>

                  {/* Feature 015: Watch Button - always show when room code entered */}
                  {roomCodeInput.length === 6 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleWatchRoom}
                      isLoading={isWatchingRoom}
                      disabled={isJoiningRoom || !watchStatus?.watchable || isCheckingWatchStatus}
                      className="flex-shrink-0"
                      title={
                        watchStatus?.reason === 'GAME_NOT_STARTED'
                          ? 'Game hasn\'t started yet'
                          : watchStatus?.reason === 'ROOM_NOT_FOUND'
                          ? 'Room not found'
                          : watchStatus?.reason === 'GAME_ENDED'
                          ? 'Game has ended'
                          : 'Watch this game'
                      }
                    >
                      <Eye size={16} className="inline" /> Watch
                    </Button>
                  )}
                </div>
              </form>

              {/* Browse Rooms Link */}
              <div className="pt-4 border-t border-avalon-dark-border">
                <button
                  onClick={() => router.push('/rooms')}
                  className="w-full text-center text-avalon-text-secondary hover:text-avalon-gold transition-colors text-base font-medium"
                >
                  Browse active rooms →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* T069: Find My Game Section */}
        {isRegistered && (
          <div className="card animate-slide-up">
            <FindMyGame />
          </div>
        )}

        {/* Footer Info */}
        <div className="text-center space-y-2">
          <button
            onClick={() => router.push('/rules')}
            className="text-avalon-text-secondary hover:text-avalon-gold transition-colors text-sm font-medium"
          >
            <BookOpen size={16} className="inline" /> View Rulebook
          </button>
          <p className="text-base font-medium text-avalon-text-muted">
            For 5-10 players • Real-time multiplayer
          </p>
        </div>
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
