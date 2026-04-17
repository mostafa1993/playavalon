'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CreateRoomModal } from '@/components/CreateRoomModal';
import { useAuth } from '@/hooks/useAuth';
import { validateRoomCode } from '@/lib/domain/validation';
import type { RoleConfig } from '@/types/role-config';
import { BookOpen, LogOut, Swords } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const { user, profile, loading, signOut } = useAuth();

  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const handleCreateRoom = async (expectedPlayers: number, roleConfig: RoleConfig) => {
    setGeneralError(null);
    setIsCreatingRoom(true);
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_players: expectedPlayers, role_config: roleConfig }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to create room' }));
        setGeneralError(data.error || 'Failed to create room');
        return;
      }
      const data = await response.json();
      const code = data.data?.code ?? data.code;
      if (code) router.push(`/rooms/${code}`);
    } catch {
      setGeneralError('Network error');
    } finally {
      setIsCreatingRoom(false);
      setIsCreateModalOpen(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomCodeError(null);
    setGeneralError(null);

    const validation = validateRoomCode(roomCodeInput);
    if (!validation.valid) {
      setRoomCodeError(validation.error || 'Invalid room code');
      return;
    }

    setIsJoiningRoom(true);
    try {
      const code = roomCodeInput.toUpperCase();
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to join room' }));
        setRoomCodeError(data.error || 'Failed to join room');
        return;
      }
      router.push(`/rooms/${code}`);
    } catch {
      setRoomCodeError('Network error');
    } finally {
      setIsJoiningRoom(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-avalon-text-muted">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center space-y-3 mb-8">
          <h1 className="font-display text-6xl font-bold text-avalon-gold tracking-wide">
            AVALON
          </h1>
          <p className="text-avalon-text-muted italic">
            The Resistance: Social Deduction
          </p>
        </div>

        <div className="w-full max-w-md bg-avalon-navy/50 border border-avalon-dark-border rounded-lg p-6 space-y-3">
          <Button variant="primary" fullWidth onClick={() => router.push('/login')}>
            Log in
          </Button>
          <Button variant="secondary" fullWidth onClick={() => router.push('/signup')}>
            Sign up
          </Button>
        </div>

        <div className="mt-8 text-center space-y-2">
          <Link
            href="/rules"
            className="text-avalon-text-muted text-sm hover:text-avalon-gold inline-flex items-center justify-center gap-1.5"
          >
            <BookOpen size={14} /> View Rulebook
          </Link>
          <p className="text-avalon-text-muted text-xs">
            For 5-10 players • Real-time multiplayer
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 relative">
      <button
        onClick={signOut}
        className="absolute top-4 right-4 text-avalon-text-muted hover:text-avalon-gold text-xs inline-flex items-center gap-1"
        title="Log out"
      >
        <LogOut size={14} /> Log out
      </button>

      <div className="w-full max-w-md text-center space-y-3 mb-8">
        <h1 className="font-display text-6xl font-bold text-avalon-gold tracking-wide">
          AVALON
        </h1>
        <p className="text-avalon-text-muted italic">
          The Resistance: Social Deduction
        </p>
      </div>

      <div className="w-full max-w-md bg-avalon-navy/50 border border-avalon-dark-border rounded-lg p-6 space-y-5">
        <div className="text-center space-y-1">
          <p className="text-avalon-text-muted text-sm">Welcome back,</p>
          <h2 className="font-display text-3xl font-bold text-avalon-gold">
            {profile?.display_name ?? user.email}
          </h2>
        </div>

        <Button
          variant="primary"
          fullWidth
          leftIcon={<Swords size={18} />}
          onClick={() => setIsCreateModalOpen(true)}
          isLoading={isCreatingRoom}
        >
          Create a room
        </Button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-avalon-dark-border" />
          <span className="text-avalon-text-muted text-xs uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-avalon-dark-border" />
        </div>

        <form onSubmit={handleJoinRoom} className="space-y-2">
          <Input
            label="Join by Room Code"
            value={roomCodeInput}
            onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
            placeholder="Enter 6-character code"
            maxLength={6}
            className="text-center tracking-widest font-mono text-lg"
            error={roomCodeError ?? undefined}
            fullWidth
          />
          <Button
            type="submit"
            variant="secondary"
            fullWidth
            isLoading={isJoiningRoom}
            disabled={roomCodeInput.length !== 6}
          >
            Join Room
          </Button>
        </form>

        {generalError && (
          <p className="text-avalon-crimson text-sm text-center">{generalError}</p>
        )}

        <div className="pt-2 border-t border-avalon-dark-border text-center">
          <Link
            href="/rooms"
            className="text-avalon-text-muted text-sm hover:text-avalon-gold transition-colors"
          >
            Browse active rooms →
          </Link>
        </div>
      </div>

      <div className="mt-8 text-center space-y-2">
        <Link
          href="/rules"
          className="text-avalon-text-muted text-sm hover:text-avalon-gold inline-flex items-center justify-center gap-1.5"
        >
          <BookOpen size={14} /> View Rulebook
        </Link>
        <p className="text-avalon-text-muted text-xs">
          For 5-10 players • Real-time multiplayer
        </p>
      </div>

      <CreateRoomModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateRoom={handleCreateRoom}
        isLoading={isCreatingRoom}
      />
    </div>
  );
}
