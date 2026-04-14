'use client';

/**
 * SessionTakeoverAlert Component
 * Phase 6: Player Recovery & Reconnection
 *
 * Alert shown when another device/browser has reclaimed this player's seat.
 */

import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { RefreshCw } from 'lucide-react';

interface SessionTakeoverAlertProps {
  isOpen: boolean;
}

export function SessionTakeoverAlert({ isOpen }: SessionTakeoverAlertProps) {
  const router = useRouter();

  const handleAcknowledge = () => {
    // T075: Clear localStorage room reference (keep player_id but clear room context)
    // Note: We don't clear player_id/nickname as the user may want to rejoin

    // T076: Redirect to home page
    router.push('/');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleAcknowledge}
      title="Session Taken Over"
      showCloseButton={false}
    >
      <div className="space-y-6 text-center">
        <div className="text-6xl"><RefreshCw size={48} /></div>

        <div className="space-y-2">
          <p className="text-lg text-avalon-text">
            Your seat has been reclaimed by another device.
          </p>
          <p className="text-sm text-avalon-text-muted">
            Someone using your nickname has taken over your position in the game
            from a different browser or device.
          </p>
        </div>

        <div className="p-4 rounded-lg bg-avalon-dark-lighter border border-avalon-dark-border">
          <p className="text-sm text-avalon-text-muted">
            If this wasn&apos;t you, another player may have claimed your seat
            after you were disconnected for too long.
          </p>
        </div>

        <button
          onClick={handleAcknowledge}
          className="w-full py-3 px-4 rounded-lg bg-avalon-accent hover:bg-avalon-accent-hover text-white font-medium transition-colors"
        >
          Return to Home
        </button>
      </div>
    </Modal>
  );
}
