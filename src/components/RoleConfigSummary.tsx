'use client';

import { computeRolesInPlay, getRoleDetails } from '@/lib/domain/role-config';
import { SPECIAL_ROLES, NO_MERLIN_NOTE, specialRoleKeyFromName } from '@/lib/utils/constants';
import type { RoleConfig } from '@/types/role-config';

interface RoleConfigSummaryProps {
  config: RoleConfig;
  expectedPlayers: number;
  compact?: boolean;
  className?: string;
}

/**
 * T026: Display summary of selected roles before confirmation
 */
export function RoleConfigSummary({
  config,
  expectedPlayers,
  compact = false,
  className = '',
}: RoleConfigSummaryProps) {
  const rolesInPlay = computeRolesInPlay(config);
  const details = getRoleDetails(config, expectedPlayers);
  // The roles beyond Merlin and the Assassin, the ones a setup chose
  const chosenRoles = rolesInPlay.filter(r => r !== 'Merlin' && r !== 'Assassin');

  if (compact) {
    return (
      <div className={`text-sm text-avalon-silver/70 ${className}`}>
        <span className="text-good-light">{details.goodCount} Good</span>
        {' • '}
        <span className="text-evil-light">{details.evilCount} Evil</span>
        {!config.merlin && (
          <>
            {' • '}
            <span className="text-avalon-gold">No Merlin</span>
          </>
        )}
        {chosenRoles.length > 0 && (
          <>
            {' • '}
            <span className="text-avalon-gold">{chosenRoles.join(', ')}</span>
          </>
        )}
        {config.ladyOfLake && (
          <>
            {' • '}
            <span className="text-blue-300">🌊 Lady</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`p-4 bg-avalon-midnight rounded-lg border border-avalon-dark-border ${className}`}>
      <h4 className="font-display text-avalon-gold text-sm mb-3">Game Configuration</h4>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <span className="text-xs text-avalon-text-muted uppercase tracking-wide">Good Team</span>
          <p className="text-good-light font-medium">{details.goodCount} Players</p>
          <p className="text-xs text-avalon-text-muted">
            {details.goodSpecialCount} special, {details.servantCount} servants
          </p>
        </div>
        <div>
          <span className="text-xs text-avalon-text-muted uppercase tracking-wide">Evil Team</span>
          <p className="text-evil-light font-medium">{details.evilCount} Players</p>
          <p className="text-xs text-avalon-text-muted">
            {details.evilSpecialCount} special, {details.minionCount} minions
          </p>
        </div>
      </div>

      <div className="border-t border-avalon-dark-border pt-3">
        <span className="text-xs text-avalon-text-muted uppercase tracking-wide mb-2 block">
          Roles in Play
        </span>
        {!config.merlin && (
          <p className="text-sm font-semibold text-avalon-gold mb-2">{NO_MERLIN_NOTE}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {rolesInPlay.map((roleName) => {
            const roleInfo = SPECIAL_ROLES[specialRoleKeyFromName(roleName)];
            const isGood = roleInfo?.team === 'good';
            
            return (
              <span
                key={roleName}
                className={`
                  inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                  ${isGood 
                    ? 'bg-good/20 text-good-light border border-good/40' 
                    : 'bg-evil/20 text-evil-light border border-evil/40'
                  }
                `}
              >
                {roleInfo?.emoji} {roleName}
              </span>
            );
          })}
        </div>
      </div>

      {config.ladyOfLake && (
        <div className="border-t border-avalon-dark-border pt-3 mt-3">
          <div className="flex items-center gap-2 text-sm">
            <span>🌊</span>
            <span className="text-blue-300">Lady of the Lake enabled</span>
          </div>
        </div>
      )}

      {/* Filler roles note */}
      {(details.servantCount > 0 || details.minionCount > 0) && (
        <p className="text-xs text-avalon-text-muted mt-3 italic">
          + {details.servantCount > 0 ? `${details.servantCount} Loyal Servant(s)` : ''}
          {details.servantCount > 0 && details.minionCount > 0 ? ' and ' : ''}
          {details.minionCount > 0 ? `${details.minionCount} Minion(s)` : ''}
        </p>
      )}
    </div>
  );
}

