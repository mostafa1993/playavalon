'use client';

import { useState } from 'react';
import { Settings2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { RoleConfigPanel } from '@/components/RoleConfigPanel';
import { RoleConfigSummary } from '@/components/RoleConfigSummary';
import { MAX_PLAYERS, ROLE_RATIOS } from '@/lib/utils/constants';
import { validateRoleConfig } from '@/lib/domain/role-config';
import type { RoleConfig } from '@/types/role-config';

export interface RoomConfigUpdate {
  expected_players: number;
  role_config: RoleConfig;
  intro_phase_enabled: boolean;
}

interface RoomConfigEditorProps {
  expectedPlayers: number;
  roleConfig: RoleConfig;
  introPhaseEnabled: boolean;
  /** People currently seated (humans + bots) — the floor for decreasing. */
  seatedPlayers: number;
  isSaving: boolean;
  error: string | null;
  onSave: (update: RoomConfigUpdate) => Promise<void>;
}

/**
 * Manager-only lobby panel for editing the room setup before roles are
 * distributed. Player count can grow up to MAX_PLAYERS and shrink only down to
 * the number of people already in the room (floor of 5 enforced by the option
 * range, since seated always includes the manager). Mirrors the create modal's
 * config UI by reusing RoleConfigPanel.
 */
export function RoomConfigEditor({
  expectedPlayers,
  roleConfig,
  introPhaseEnabled,
  seatedPlayers,
  isSaving,
  error,
  onSave,
}: RoomConfigEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftCount, setDraftCount] = useState(expectedPlayers);
  const [draftConfig, setDraftConfig] = useState<RoleConfig>(roleConfig);
  const [draftIntro, setDraftIntro] = useState(introPhaseEnabled);

  // Lowest allowed player count: never below those already seated, floor of 5.
  const lowerBound = Math.max(seatedPlayers, 5);
  const playerOptions = Array.from(
    { length: MAX_PLAYERS - lowerBound + 1 },
    (_, i) => lowerBound + i
  );

  const handleCountChange = (count: number) => {
    setDraftCount(count);
    // Match the create modal: if the current config is invalid at the new
    // count, reset it rather than letting the manager save an invalid setup.
    if (!validateRoleConfig(draftConfig, count).valid) {
      setDraftConfig({});
    }
  };

  const validation = validateRoleConfig(draftConfig, draftCount);
  const dirty =
    draftCount !== expectedPlayers ||
    draftIntro !== introPhaseEnabled ||
    JSON.stringify(draftConfig) !== JSON.stringify(roleConfig);

  const handleSave = async () => {
    await onSave({
      expected_players: draftCount,
      role_config: draftConfig,
      intro_phase_enabled: draftIntro,
    });
  };

  return (
    <div className="card py-3 px-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Settings2 size={16} className="text-avalon-gold" />
          <p className="text-sm font-semibold text-avalon-text">Edit setup</p>
        </div>
        {expanded ? (
          <ChevronDown size={16} className="text-avalon-silver/80" />
        ) : (
          <ChevronRight size={16} className="text-avalon-silver/80" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {/* Player count */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-avalon-silver/80">Players</p>
              <p className="text-xs font-bold">
                <span className="text-good-light">Good {ROLE_RATIOS[draftCount]?.good ?? 0}</span>
                {' · '}
                <span className="text-evil-light">Evil {ROLE_RATIOS[draftCount]?.evil ?? 0}</span>
              </p>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {playerOptions.map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleCountChange(num)}
                  className={`
                    py-2 rounded-md font-display text-base font-bold transition-all
                    ${draftCount === num
                      ? 'bg-avalon-gold text-avalon-midnight'
                      : 'bg-avalon-midnight border border-avalon-silver/30 text-avalon-silver hover:border-avalon-gold/50'
                    }
                  `}
                >
                  {num}
                </button>
              ))}
            </div>
            {lowerBound > 5 && (
              <p className="mt-1 text-[11px] text-avalon-silver/70">
                Can&apos;t go below {lowerBound} — that many are already in the room. Have
                someone leave to reduce further.
              </p>
            )}
          </div>

          {/* Special roles */}
          <RoleConfigPanel
            expectedPlayers={draftCount}
            config={draftConfig}
            onChange={setDraftConfig}
          />

          <RoleConfigSummary config={draftConfig} expectedPlayers={draftCount} />

          {/* Intro round */}
          <label className="flex items-start gap-3 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={draftIntro}
              onChange={(e) => setDraftIntro(e.target.checked)}
              className="mt-1 w-4 h-4 accent-avalon-gold cursor-pointer"
            />
            <div>
              <div className="text-sm font-semibold text-avalon-text">Intro round</div>
              <div className="text-xs text-avalon-silver/80 mt-0.5">
                One-time discussion round at game start before the first proposal.
              </div>
            </div>
          </label>

          {error && (
            <p className="text-evil-light text-xs">{error}</p>
          )}

          <Button
            variant="primary"
            fullWidth
            onClick={handleSave}
            isLoading={isSaving}
            disabled={!validation.valid || !dirty}
          >
            Save setup
          </Button>
        </div>
      )}
    </div>
  );
}
