'use client';

import { Modal } from '@/components/ui/Modal';
import { RulebookContent } from './RulebookContent';
import { BookOpen } from 'lucide-react';

interface RulebookModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal wrapper for the rulebook content
 * Used in game rooms for quick-access reference
 */
export function RulebookModal({ isOpen, onClose }: RulebookModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={<><BookOpen size={16} className="inline" /> Rulebook</>}
      size="lg"
      scrollable
    >
      <RulebookContent compact />
    </Modal>
  );
}

