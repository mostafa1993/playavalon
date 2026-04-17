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
import { BookOpen, LogOut } from 'lucide-react';

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
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div>
            <h1 className="font-display text-5xl font-bold text-avalon-gold">Avalon</h1>
            <p className="text-avalon-text-muted mt-2">
              Social deduction in the realm of King Arthur
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button variant="primary" fullWidth onClick={() => router.push('/login')}>
              Log in
            </Button>
            <Button variant="secondary" fullWidth onClick={() => router.push('/signup')}>
              Sign up
            </Button>
            <Link href="/rules" className="text-avalon-text-muted text-sm hover:text-avalon-gold inline-flex items-center justify-center gap-1 mt-2">
              <BookOpen size={14} /> Rulebook
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-avalon-gold">Avalon</h1>
            <p className="text-avalon-text-muted text-sm">
              Welcome, <span className="text-avalon-text">{profile?.display_name ?? user.email}</span>
            </p>
          </div>
          <button
            onClick={signOut}
            className="text-avalon-text-muted hover:text-avalon-gold text-xs inline-flex items-center gap-1"
            title="Log out"
          >
            <LogOut size={14} /> Log out
          </button>
        </div>

        <div className="space-y-4">
          <Button
            variant="primary"
            fullWidth
            onClick={() => setIsCreateModalOpen(true)}
            isLoading={isCreatingRoom}
          >
            Create a room
          </Button>

          <form onSubmit={handleJoinRoom} className="space-y-2">
            <Input
              label="Join by room code"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
              placeholder="ABC123"
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
              Join
            </Button>
          </form>

          {generalError && (
            <p className="text-avalon-crimson text-sm text-center">{generalError}</p>
          )}

          <Link href="/rules" className="text-avalon-text-muted text-sm hover:text-avalon-gold inline-flex items-center justify-center gap-1 w-full">
            <BookOpen size={14} /> Rulebook
          </Link>
        </div>

        <CreateRoomModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreateRoom={handleCreateRoom}
          isLoading={isCreatingRoom}
        />
      </div>
    </div>
  );
}
