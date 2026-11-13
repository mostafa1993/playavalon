'use client';

import { SPECIAL_ROLES, GOOD_SPECIAL_ROLES, EVIL_SPECIAL_ROLES } from '@/lib/utils/constants';
import type { SpecialRole } from '@/types/role';

/**
 * Roles tab content - displays all 9 roles organized by team
 */
export function RolesTab() {
  // All roles that appear in games
  const displayGoodRoles: SpecialRole[] = ['merlin', 'percival', 'servant'];
  const displayEvilRoles: SpecialRole[] = ['assassin', 'morgana', 'mordred', 'oberon_standard', 'oberon_chaos', 'minion'];

  return (
    <div
      role="tabpanel"
      id="tabpanel-roles"
      aria-labelledby="tab-roles"
      className="space-y-6 animate-fade-in"
    >
      {/* Good Team */}
      <section>
        <h3 className="flex items-center gap-2 text-lg font-display font-bold text-good-light mb-4">
          <span>⚔️</span>
          <span>Good Team</span>
        </h3>
        <div className="space-y-3">
          {displayGoodRoles.map((roleKey) => {
            const role = SPECIAL_ROLES[roleKey];
            return (
              <RoleCard
                key={roleKey}
                emoji={role.emoji}
                name={role.name}
                description={role.description}
                team="good"
              />
            );
          })}
        </div>
      </section>

      {/* Evil Team */}
      <section>
        <h3 className="flex items-center gap-2 text-lg font-display font-bold text-evil-light mb-4">
          <span>🗡️</span>
          <span>Evil Team</span>
        </h3>
        <div className="space-y-3">
          {displayEvilRoles.map((roleKey) => {
            const role = SPECIAL_ROLES[roleKey];
            return (
              <RoleCard
                key={roleKey}
                emoji={role.emoji}
                name={role.name}
                description={role.description}
                team="evil"
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface RoleCardProps {
  emoji: string;
  name: string;
  description: string;
  team: 'good' | 'evil';
}

function RoleCard({ emoji, name, description, team }: RoleCardProps) {
  const teamColors = team === 'good'
    ? 'bg-good/10 border-good/30 hover:border-good/50'
    : 'bg-evil/10 border-evil/30 hover:border-evil/50';

  const textColor = team === 'good' ? 'text-good-light' : 'text-evil-light';

  return (
    <div className={`
      flex items-start gap-3 p-3 rounded-lg border transition-colors
      ${teamColors}
    `}>
      <span className="text-2xl flex-shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <h4 className={`font-semibold ${textColor}`}>{name}</h4>
        <p className="text-sm text-avalon-text-muted mt-1">{description}</p>
      </div>
    </div>
  );
}

