'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { RoleConfigPanel } from '@/components/RoleConfigPanel';
import { RoleConfigSummary } from '@/components/RoleConfigSummary';
import { MIN_PLAYERS, MAX_PLAYERS, ROLE_RATIOS } from '@/lib/utils/constants';
import { validateRoleConfig } from '@/lib/domain/role-config';
import type { RoleConfig } from '@/types/role-config';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateRoom: (
    expectedPlayers: number,
    roleConfig: RoleConfig,
    introPhaseEnabled: boolean,
  ) => Promise<void>;
  isLoading?: boolean;
}

/**
 * T027: Modal for creating a new game room
 * Updated for Phase 2: Includes role configuration panel
 */
export function CreateRoomModal({
  isOpen,
  onClose,
  onCreateRoom,
  isLoading = false,
}: CreateRoomModalProps) {
  const [expectedPlayers, setExpectedPlayers] = useState(5);
  const [roleConfig, setRoleConfig] = useState<RoleConfig>({});
  const [introPhaseEnabled, setIntroPhaseEnabled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateRoom(expectedPlayers, roleConfig, introPhaseEnabled);
  };

  // T029b: Reset invalid options when player count changes
  const handlePlayerCountChange = (count: number) => {
    setExpectedPlayers(count);
    // Re-validate and clear invalid options
    const validation = validateRoleConfig(roleConfig, count);
    if (!validation.valid) {
      // Reset to default config if current is invalid
      setRoleConfig({});
    }
  };

  const playerOptions = Array.from(
    { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
    (_, i) => MIN_PLAYERS + i
  );

  const validation = validateRoleConfig(roleConfig, expectedPlayers);

  const footerButtons = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={isLoading}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        form="create-room-form"
        variant="primary"
        isLoading={isLoading}
        disabled={!validation.valid}
      >
        Create Room
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create a New Room"
      size="lg"
      scrollable
      footer={footerButtons}
    >
      <form id="create-room-form" onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-lg font-bold text-avalon-parchment mb-2">
            Number of Players
          </label>
          <p className="text-base font-medium text-avalon-silver/80 mb-4">
            Select how many knights will join this quest (5-10 players)
          </p>

          <div className="grid grid-cols-3 gap-3">
            {playerOptions.map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handlePlayerCountChange(num)}
                className={`
                  py-3 px-4 rounded-lg font-display text-xl font-bold transition-all
                  ${expectedPlayers === num
                    ? 'bg-avalon-gold text-avalon-midnight ring-2 ring-avalon-gold ring-offset-2 ring-offset-avalon-navy'
                    : 'bg-avalon-midnight border border-avalon-silver/30 text-avalon-silver hover:border-avalon-gold/50'
                  }
                `}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        {/* Team Composition Summary */}
        <div className="p-4 bg-avalon-midnight/50 rounded-lg border border-avalon-silver/20">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-display text-avalon-gold text-base font-bold">Team Composition</h4>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm font-semibold text-avalon-silver hover:text-avalon-gold transition-colors"
            >
              {showAdvanced ? '▼ Hide Advanced' : '▶ Advanced Options'}
            </button>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span className="text-good-light">
              Good: {ROLE_RATIOS[expectedPlayers]?.good ?? 0}
            </span>
            <span className="text-evil-light">
              Evil: {ROLE_RATIOS[expectedPlayers]?.evil ?? 0}
            </span>
          </div>

          {/* Compact role summary when advanced is hidden - smooth transition */}
          <div className={`
            transition-all duration-200 overflow-hidden
            ${!showAdvanced && Object.keys(roleConfig).length > 0 ? 'max-h-20 opacity-100 mt-2 pt-2 border-t border-avalon-silver/10' : 'max-h-0 opacity-0'}
          `}>
            <RoleConfigSummary
              config={roleConfig}
              expectedPlayers={expectedPlayers}
              compact
            />
          </div>
        </div>

        {/* Advanced Role Configuration - smooth transition to prevent layout jump */}
        <div
          className={`
            transition-all duration-300 ease-in-out overflow-hidden
            ${showAdvanced ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}
          `}
        >
          <div className="border border-avalon-silver/20 rounded-lg p-4 bg-avalon-midnight/30">
            <h4 className="font-display text-avalon-parchment text-lg font-bold mb-4">
              Configure Special Roles
            </h4>
            <RoleConfigPanel
              expectedPlayers={expectedPlayers}
              config={roleConfig}
              onChange={setRoleConfig}
            />

            {/* Full summary */}
            <RoleConfigSummary
              config={roleConfig}
              expectedPlayers={expectedPlayers}
              className="mt-4"
            />

            {/* Feature 023: Intro round toggle */}
            <div className="mt-4 pt-4 border-t border-avalon-silver/10">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={introPhaseEnabled}
                  onChange={(e) => setIntroPhaseEnabled(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-avalon-gold cursor-pointer"
                />
                <div>
                  <div className="font-display text-avalon-parchment text-base font-bold">
                    Intro round
                  </div>
                  <div className="text-sm text-avalon-silver/80 mt-1">
                    Run a one-time discussion round at game start before the
                    first proposal. The first leader speaks, then everyone in
                    order, then the leader closes — no team is proposed during
                    this round. After the manager ends it, the same leader
                    proposes Quest 1 normally.
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
