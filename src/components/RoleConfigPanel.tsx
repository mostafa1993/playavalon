'use client';

import { useState, useEffect } from 'react';
import { validateRoleConfig, getRoleDetails } from '@/lib/domain/role-config';
import { SPECIAL_ROLES, LADY_OF_LAKE_MIN_RECOMMENDED } from '@/lib/utils/constants';
import { canEnableEvilRingVisibility, shouldAutoDisableRing } from '@/lib/domain/evil-ring-visibility';
import { AlertTriangle } from 'lucide-react';
import type { RoleConfig, OberonMode } from '@/types/role-config';

interface RoleConfigPanelProps {
  expectedPlayers: number;
  config: RoleConfig;
  onChange: (config: RoleConfig) => void;
  className?: string;
}

/**
 * T025: Role configuration panel for room creation
 * Allows room manager to select which special roles to include
 */
export function RoleConfigPanel({
  expectedPlayers,
  config,
  onChange,
  className = '',
}: RoleConfigPanelProps) {
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>({ valid: true, errors: [], warnings: [] });

  // T029b: Re-validate when player count changes
  useEffect(() => {
    const result = validateRoleConfig(config, expectedPlayers);
    setValidation(result);
  }, [config, expectedPlayers]);

  const roleDetails = getRoleDetails(config, expectedPlayers);

  const handleToggle = (key: keyof RoleConfig, value: boolean) => {
    const newConfig = { ...config, [key]: value || undefined };
    // Clean up undefined values
    if (!newConfig[key]) delete newConfig[key];
    onChange(newConfig);
  };

  // T028: Handle Oberon mode toggle
  // Feature 018: Auto-disable Oberon Split Intel when Oberon Standard is removed
  // Feature 019: Auto-disable Evil Ring Visibility when prerequisites no longer met
  const handleOberonChange = (mode: OberonMode | false) => {
    const newConfig = { ...config };
    if (mode) {
      newConfig.oberon = mode;
    } else {
      delete newConfig.oberon;
    }

    // Feature 018: Auto-disable Oberon Split Intel if Oberon Standard is removed or changed to Chaos
    if (newConfig.oberon_split_intel_enabled && mode !== 'standard') {
      delete newConfig.oberon_split_intel_enabled;
    }

    // Feature 019: Auto-disable Evil Ring Visibility if prerequisites no longer met
    const ringAutoDisable = shouldAutoDisableRing(
      newConfig,
      expectedPlayers,
      mode || undefined
    );
    if (ringAutoDisable.shouldDisable) {
      delete newConfig.evil_ring_visibility_enabled;
    }

    onChange(newConfig);
  };

  // Feature 019: Auto-disable Evil Ring Visibility when player count changes
  useEffect(() => {
    const ringAutoDisable = shouldAutoDisableRing(config, expectedPlayers, config.oberon);
    if (ringAutoDisable.shouldDisable && config.evil_ring_visibility_enabled) {
      onChange({
        ...config,
        evil_ring_visibility_enabled: undefined,
      });
    }
  }, [expectedPlayers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Good Team Roles */}
      <div>
        <h4 className="font-display text-base font-bold text-good-light mb-3 flex items-center gap-2">
          ⚔️ Good Team Roles
          <span className="text-sm font-medium text-avalon-silver/70">
            ({roleDetails.goodSpecialCount}/{roleDetails.goodCount} special)
          </span>
        </h4>

        <div className="space-y-2">
          {/* Merlin - Always included */}
          <RoleToggle
            role="merlin"
            enabled={true}
            locked
            label="Merlin (Always Included)"
            description={SPECIAL_ROLES.merlin.description}
            emoji={SPECIAL_ROLES.merlin.emoji}
          />

          {/* Percival - Optional */}
          <RoleToggle
            role="percival"
            enabled={config.percival || false}
            onChange={(v) => handleToggle('percival', v)}
            label="Percival"
            description={SPECIAL_ROLES.percival.description}
            emoji={SPECIAL_ROLES.percival.emoji}
          />
        </div>
      </div>

      {/* Evil Team Roles */}
      <div>
        <h4 className="font-display text-base font-bold text-evil-light mb-3 flex items-center gap-2">
          🗡️ Evil Team Roles
          <span className="text-sm font-medium text-avalon-silver/70">
            ({roleDetails.evilSpecialCount}/{roleDetails.evilCount} special)
          </span>
        </h4>

        <div className="space-y-2">
          {/* Assassin - Always included */}
          <RoleToggle
            role="assassin"
            enabled={true}
            locked
            label="Assassin (Always Included)"
            description={SPECIAL_ROLES.assassin.description}
            emoji={SPECIAL_ROLES.assassin.emoji}
          />

          {/* Morgana - Optional */}
          <RoleToggle
            role="morgana"
            enabled={config.morgana || false}
            onChange={(v) => handleToggle('morgana', v)}
            label="Morgana"
            description={SPECIAL_ROLES.morgana.description}
            emoji={SPECIAL_ROLES.morgana.emoji}
          />

          {/* Mordred - Optional */}
          <RoleToggle
            role="mordred"
            enabled={config.mordred || false}
            onChange={(v) => handleToggle('mordred', v)}
            label="Mordred"
            description={SPECIAL_ROLES.mordred.description}
            emoji={SPECIAL_ROLES.mordred.emoji}
          />

          {/* T028: Oberon with mode toggle */}
          <div className="p-3 rounded-lg border border-avalon-silver/20 bg-avalon-midnight/30">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{SPECIAL_ROLES.oberon_standard.emoji}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-base text-avalon-parchment">Oberon</span>
                  <select
                    value={config.oberon || ''}
                    onChange={(e) => handleOberonChange(e.target.value as OberonMode | '' || false)}
                    className="text-sm font-medium bg-avalon-midnight border border-avalon-silver/30 rounded px-2 py-1.5 text-avalon-silver"
                  >
                    <option value="">Disabled</option>
                    <option value="standard">Standard (Visible to Merlin)</option>
                    <option value="chaos">Chaos (Hidden from Everyone)</option>
                  </select>
                </div>
                <p className="text-sm text-avalon-silver/70 mt-1">
                  {config.oberon === 'chaos'
                    ? SPECIAL_ROLES.oberon_chaos.description
                    : SPECIAL_ROLES.oberon_standard.description}
                </p>
              </div>
            </div>
          </div>

          {/* Feature 020: Big Box Expansion Roles (7+ players only) */}
          {expectedPlayers >= 7 && (
            <>
              {/* Lunatic */}
              <RoleToggle
                role="lunatic"
                enabled={config.lunatic || false}
                onChange={(v) => handleToggle('lunatic', v)}
                label="Lunatic"
                description={SPECIAL_ROLES.lunatic.description}
                emoji={SPECIAL_ROLES.lunatic.emoji}
              />

              {/* Brute */}
              <RoleToggle
                role="brute"
                enabled={config.brute || false}
                onChange={(v) => handleToggle('brute', v)}
                label="Brute"
                description={SPECIAL_ROLES.brute.description}
                emoji={SPECIAL_ROLES.brute.emoji}
              />
            </>
          )}
        </div>
      </div>

      {/* Game Options */}
      <div>
        <h4 className="font-display text-base font-bold text-blue-300 mb-3 flex items-center gap-2">
          🎮 Game Options
        </h4>

        <div className="space-y-2">
          {/* Lady of the Lake */}
          <RoleToggle
            role="ladyOfLake"
            enabled={config.ladyOfLake || false}
            onChange={(v) => handleToggle('ladyOfLake', v)}
            label="Lady of the Lake"
            description="Investigate player loyalties after Quest 2, 3, 4"
            emoji="🌊"
          />

          {/* T044: Warning for small games - always reserve space to prevent layout shift */}
          <div className={`overflow-hidden transition-all duration-200 ${
            config.ladyOfLake && expectedPlayers < LADY_OF_LAKE_MIN_RECOMMENDED
              ? 'max-h-10 opacity-100 mt-2'
              : 'max-h-0 opacity-0'
          }`}>
            <p className="text-sm font-medium text-yellow-400 flex items-center gap-1">
              <AlertTriangle size={16} className="inline" /> Recommended for {LADY_OF_LAKE_MIN_RECOMMENDED}+ players
            </p>
          </div>

          {/* Feature 009: Merlin Decoy Mode */}
          <RoleToggle
            role="merlin_decoy"
            enabled={config.merlin_decoy_enabled || false}
            onChange={(v) => {
              // T018: Mutual exclusivity - disable Split Intel and Oberon Split Intel when enabling Decoy
              if (v) {
                onChange({
                  ...config,
                  merlin_decoy_enabled: true,
                  merlin_split_intel_enabled: undefined,
                  oberon_split_intel_enabled: undefined,
                });
              } else {
                handleToggle('merlin_decoy_enabled', v);
              }
            }}
            label="Merlin Decoy Mode"
            description="One random good player appears evil to Merlin, creating uncertainty"
            emoji="🃏"
            disabled={config.merlin_split_intel_enabled || config.oberon_split_intel_enabled}
            disabledReason={config.oberon_split_intel_enabled ? "Cannot use with Oberon Split Intel Mode" : "Cannot use with Split Intel Mode"}
          />

          {/* Feature 011: Merlin Split Intel Mode */}
          <RoleToggle
            role="merlin_split_intel"
            enabled={config.merlin_split_intel_enabled || false}
            onChange={(v) => {
              // T018: Mutual exclusivity - disable Decoy and Oberon Split Intel when enabling Split Intel
              if (v) {
                onChange({
                  ...config,
                  merlin_split_intel_enabled: true,
                  merlin_decoy_enabled: undefined,
                  oberon_split_intel_enabled: undefined,
                });
              } else {
                handleToggle('merlin_split_intel_enabled', v);
              }
            }}
            label="Merlin Split Intel Mode"
            description="Merlin sees two groups: certain evil players, and a mixed group with one evil and one good"
            emoji="🔀"
            disabled={config.merlin_decoy_enabled || config.oberon_split_intel_enabled}
            disabledReason={config.oberon_split_intel_enabled ? "Cannot use with Oberon Split Intel Mode" : "Cannot use with Decoy Mode"}
          />

          {/* Feature 018: Oberon Split Intel Mode */}
          <RoleToggle
            role="oberon_split_intel"
            enabled={config.oberon_split_intel_enabled || false}
            onChange={(v) => {
              // Mutual exclusivity - disable Decoy and Split Intel when enabling Oberon Split Intel
              if (v) {
                onChange({
                  ...config,
                  oberon_split_intel_enabled: true,
                  merlin_decoy_enabled: undefined,
                  merlin_split_intel_enabled: undefined,
                });
              } else {
                handleToggle('oberon_split_intel_enabled', v);
              }
            }}
            label="Oberon Split Intel Mode"
            description="Merlin sees Oberon mixed with a good player, while other evil (Morgana, Assassin) are shown as certain evil"
            emoji="👤🔀"
            disabled={
              config.oberon !== 'standard' ||
              config.merlin_decoy_enabled ||
              config.merlin_split_intel_enabled
            }
            disabledReason={
              config.oberon === 'chaos'
                ? "Not available with Oberon (Chaos) - Oberon must be visible to Merlin"
                : !config.oberon
                ? "Requires Oberon (Standard) to be enabled"
                : config.merlin_decoy_enabled
                ? "Cannot use with Decoy Mode"
                : config.merlin_split_intel_enabled
                ? "Cannot use with Split Intel Mode"
                : undefined
            }
          />

          {/* Feature 019: Evil Ring Visibility Mode */}
          {(() => {
            const ringPrereq = canEnableEvilRingVisibility(expectedPlayers, config.oberon);
            return (
              <RoleToggle
                role="evil_ring_visibility"
                enabled={config.evil_ring_visibility_enabled || false}
                onChange={(v) => handleToggle('evil_ring_visibility_enabled', v)}
                label="Evil Ring Visibility"
                description="Evil players only know one teammate each (chain pattern)"
                emoji="⭕"
                disabled={!ringPrereq.canEnable}
                disabledReason={ringPrereq.reason}
              />
            );
          })()}

          {/* T019: Warning for Mordred + Oberon Chaos with Split Intel - smooth transition */}
          <div className={`overflow-hidden transition-all duration-200 ${
            config.merlin_split_intel_enabled && config.mordred && config.oberon === 'chaos'
              ? 'max-h-24 opacity-100'
              : 'max-h-0 opacity-0'
          }`}>
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-sm font-medium text-red-400">
                <AlertTriangle size={16} className="inline" /> With Mordred + Oberon Chaos, all evil may be hidden from Merlin.
                Split Intel Mode will be blocked if no visible evil players exist.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* T029: Validation warnings - smooth transition */}
      <div className={`overflow-hidden transition-all duration-200 ${
        validation.warnings.length > 0 ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
      }`}>
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <h5 className="text-base font-bold text-yellow-400 mb-1">Suggestions</h5>
          <ul className="text-sm text-yellow-300/80 space-y-1">
            {validation.warnings.map((warning, i) => (
              <li key={i}>• {warning}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Validation errors - smooth transition */}
      <div className={`overflow-hidden transition-all duration-200 ${
        validation.errors.length > 0 ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
      }`}>
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <h5 className="text-base font-bold text-red-400 mb-1">Configuration Error</h5>
          <ul className="text-sm text-red-300/80 space-y-1">
            {validation.errors.map((error, i) => (
              <li key={i}>• {error}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface RoleToggleProps {
  role: string;
  enabled: boolean;
  locked?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onChange?: (enabled: boolean) => void;
  label: string;
  description: string;
  emoji: string;
}

/**
 * RoleToggle - Uses button instead of label+checkbox to prevent scroll jump
 * The browser's scroll-to-focus behavior on hidden inputs caused layout jumps on mobile
 */
function RoleToggle({
  enabled,
  locked,
  disabled,
  disabledReason,
  onChange,
  label,
  description,
  emoji,
}: RoleToggleProps) {
  const isDisabled = locked || disabled;

  const handleClick = () => {
    if (!isDisabled && onChange) {
      onChange(!enabled);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className={`
        w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-all
        ${isDisabled
          ? 'border-avalon-silver/10 bg-avalon-midnight/20 cursor-not-allowed opacity-70'
          : enabled
            ? 'border-avalon-gold/50 bg-avalon-gold/10 cursor-pointer'
            : 'border-avalon-silver/20 bg-avalon-midnight/30 cursor-pointer hover:border-avalon-silver/40'
        }
      `}
      title={disabled ? disabledReason : undefined}
    >
      <span className="text-2xl">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`font-semibold text-base ${enabled ? 'text-avalon-gold' : 'text-avalon-parchment'}`}>
            {label}
          </span>
          {/* Visual toggle indicator - no hidden input needed */}
          <div className={`
            w-10 h-6 rounded-full transition-colors flex-shrink-0
            ${isDisabled ? 'bg-avalon-silver/30' : enabled ? 'bg-avalon-gold' : 'bg-avalon-silver/30'}
          `}>
            <div className={`
              w-5 h-5 rounded-full bg-white transition-transform mt-0.5
              ${enabled ? 'translate-x-4' : 'translate-x-0.5'}
            `} />
          </div>
        </div>
        <p className="text-sm text-avalon-silver/70 mt-1">{description}</p>
        {disabled && disabledReason && (
          <p className="text-xs text-amber-400/70 mt-1 italic">{disabledReason}</p>
        )}
      </div>
    </button>
  );
}
