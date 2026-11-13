'use client';

import { SPECIAL_ROLES, getSpecialRoleDescription } from '@/lib/utils/constants';
import type { RoleConfig } from '@/types/role-config';

interface RolesInPlayProps {
  rolesInPlay: string[];
  roleConfig: RoleConfig;
  showTitle?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * T033: Display list of active special roles in the game
 * Shown to all players in lobby before and after role distribution
 */
export function RolesInPlay({
  rolesInPlay,
  roleConfig,
  showTitle = true,
  compact = false,
  className = '',
}: RolesInPlayProps) {
  if (rolesInPlay.length === 0) {
    return null;
  }

  // Separate roles by team for better display
  const goodRoles = rolesInPlay.filter(name => {
    const key = normalizeRoleName(name);
    return SPECIAL_ROLES[key]?.team === 'good';
  });

  const evilRoles = rolesInPlay.filter(name => {
    const key = normalizeRoleName(name);
    return SPECIAL_ROLES[key]?.team === 'evil';
  });

  // T035: Check for Oberon mode
  const oberonMode = roleConfig.oberon;
  const hasOberon = rolesInPlay.some(r => r.includes('Oberon'));

  if (compact) {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {rolesInPlay.map((role) => (
          <RoleBadge key={role} name={role} merlinInPlay={roleConfig.merlin} small />
        ))}
      </div>
    );
  }

  return (
    <div className={`p-4 bg-avalon-navy rounded-lg border border-avalon-dark-border ${className}`}>
      {showTitle && (
        <h4 className="font-display text-avalon-gold text-base font-bold mb-3">
          🎲 Roles in This Game
        </h4>
      )}

      <div className="space-y-3">
        {/* Good Team Roles */}
        {goodRoles.length > 0 && (
          <div>
            <span className="text-sm text-good-light font-bold uppercase tracking-wide">Good Team</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {goodRoles.map((role) => (
                <RoleBadge key={role} name={role} merlinInPlay={roleConfig.merlin} team="good" />
              ))}
            </div>
          </div>
        )}

        {/* Evil Team Roles */}
        {evilRoles.length > 0 && (
          <div>
            <span className="text-sm text-evil-light font-bold uppercase tracking-wide">Evil Team</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {evilRoles.map((role) => (
                <RoleBadge key={role} name={role} merlinInPlay={roleConfig.merlin} team="evil" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Game Mode Indicators */}
      {(hasOberon || roleConfig.merlin_decoy_enabled || roleConfig.merlin_split_intel_enabled || roleConfig.oberon_split_intel_enabled || roleConfig.evil_ring_visibility_enabled) && (
        <div className="mt-3 pt-3 border-t border-avalon-dark-border space-y-2">
          {/* T035: Oberon mode indicator (only show if NOT using Oberon Split Intel) */}
          {hasOberon && oberonMode && !roleConfig.oberon_split_intel_enabled && (
            <div className="flex items-center gap-2 text-sm font-medium">
              {oberonMode === 'chaos' ? (
                <>
                  <span className="text-purple-400">👻</span>
                  <span className="text-purple-300 font-semibold">Chaos Mode: Oberon is hidden from everyone!</span>
                </>
              ) : (
                <>
                  <span className="text-slate-400">👤</span>
                  <span className="text-slate-300 font-medium">
                    {roleConfig.merlin
                      ? 'Standard Mode: Oberon visible to Merlin'
                      : 'Standard Mode: Oberon works alone, unknown to the evil team'}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Feature 009: Merlin Decoy indicator */}
          {roleConfig.merlin_decoy_enabled && (
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-amber-400">🃏</span>
              <span className="text-amber-300 font-semibold">
                Merlin Decoy Mode: One good player appears evil to Merlin!
              </span>
            </div>
          )}

          {/* Feature 011: Merlin Split Intel indicator */}
          {roleConfig.merlin_split_intel_enabled && (
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-cyan-400">🔀</span>
              <span className="text-cyan-300 font-semibold">
                Split Intel Mode: Merlin sees two groups with different certainty!
              </span>
            </div>
          )}

          {/* Feature 018: Oberon Split Intel indicator */}
          {roleConfig.oberon_split_intel_enabled && (
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-teal-400">👤🔀</span>
              <span className="text-teal-300 font-semibold">
                Oberon Split Intel: Merlin sees Oberon mixed with a good player!
              </span>
            </div>
          )}

          {/* Feature 019: Evil Ring Visibility indicator */}
          {roleConfig.evil_ring_visibility_enabled && (
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-rose-400">⭕</span>
              <span className="text-rose-300 font-semibold">
                Evil Ring Visibility: Evil players only know one teammate each!
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RoleBadgeProps {
  name: string;
  merlinInPlay: boolean;
  team?: 'good' | 'evil';
  small?: boolean;
}

function RoleBadge({ name, merlinInPlay, team, small }: RoleBadgeProps) {
  const roleKey = normalizeRoleName(name);
  const roleInfo = SPECIAL_ROLES[roleKey];
  const emoji = roleInfo?.emoji || '❓';
  const actualTeam = team || roleInfo?.team || 'good';

  const sizeClasses = small
    ? 'px-2.5 py-1 text-sm'
    : 'px-3 py-1.5 text-base';

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-md font-bold
        ${sizeClasses}
        ${actualTeam === 'good'
          ? 'bg-good/30 text-good-light border border-good/50'
          : 'bg-evil/30 text-evil-light border border-evil/50'
        }
      `}
      title={roleInfo && getSpecialRoleDescription(roleKey, merlinInPlay)}
    >
      <span>{emoji}</span>
      <span>{name}</span>
    </span>
  );
}

/**
 * Normalize role name to match SPECIAL_ROLES keys
 */
function normalizeRoleName(name: string): keyof typeof SPECIAL_ROLES {
  // First normalize the string without casting
  const normalized = name
    .toLowerCase()
    .replace(' (chaos)', '_chaos')
    .replace(/\s+/g, '_');

  // Handle special cases for display name -> key mapping
  if (normalized === 'oberon') return 'oberon_standard';
  if (normalized === 'loyal_servant_of_arthur') return 'servant';
  if (normalized === 'loyal_servant') return 'servant';
  if (normalized === 'the_assassin') return 'assassin';
  if (normalized === 'minion_of_mordred') return 'minion';

  // Cast to SpecialRole key after special case handling
  return normalized as keyof typeof SPECIAL_ROLES;
}
