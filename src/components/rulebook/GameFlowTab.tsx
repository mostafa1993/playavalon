'use client';

import { GAME_PHASES, WIN_CONDITIONS } from '@/lib/domain/rulebook-content';
import { RefreshCw } from 'lucide-react';

/**
 * Game Flow tab content - explains game phases and win conditions
 */
export function GameFlowTab() {
  return (
    <div
      role="tabpanel"
      id="tabpanel-flow"
      aria-labelledby="tab-flow"
      className="space-y-6 animate-fade-in"
    >
      {/* Game Phases */}
      <section>
        <h3 className="flex items-center gap-2 text-lg font-display font-bold text-avalon-gold mb-4">
          <span><RefreshCw size={16} /></span>
          <span>Game Phases</span>
        </h3>
        <div className="space-y-3">
          {GAME_PHASES.map((phase, index) => (
            <PhaseCard key={phase.id} phase={phase} stepNumber={index + 1} />
          ))}
        </div>
      </section>

      {/* Win Conditions */}
      <section>
        <h3 className="flex items-center gap-2 text-lg font-display font-bold text-avalon-gold mb-4">
          <span>🏆</span>
          <span>Win Conditions</span>
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          {/* Good Team Win */}
          <div className="p-4 rounded-lg bg-good/10 border border-good/30">
            <h4 className="font-display font-bold text-good-light mb-2 flex items-center gap-2">
              <span>⚔️</span>
              <span>Good Wins</span>
            </h4>
            <ul className="space-y-1">
              {WIN_CONDITIONS.filter(w => w.team === 'good').map((condition, i) => (
                <li key={i} className="text-sm text-good-light/80 flex items-start gap-2">
                  <span className="text-good-light">✓</span>
                  <span>{condition.description}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Evil Team Win */}
          <div className="p-4 rounded-lg bg-evil/10 border border-evil/30">
            <h4 className="font-display font-bold text-evil-light mb-2 flex items-center gap-2">
              <span>🗡️</span>
              <span>Evil Wins</span>
            </h4>
            <ul className="space-y-1">
              {WIN_CONDITIONS.filter(w => w.team === 'evil').map((condition, i) => (
                <li key={i} className="text-sm text-evil-light/80 flex items-start gap-2">
                  <span className="text-evil-light">✗</span>
                  <span>{condition.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

interface PhaseCardProps {
  phase: {
    id: string;
    name: string;
    description: string;
    details?: string[];
  };
  stepNumber: number;
}

function PhaseCard({ phase, stepNumber }: PhaseCardProps) {
  return (
    <div className="flex gap-4 p-3 rounded-lg bg-avalon-midnight/30 border border-avalon-silver/10 hover:border-avalon-silver/20 transition-colors">
      {/* Step Number */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-avalon-gold/20 border border-avalon-gold/50 flex items-center justify-center">
        <span className="text-avalon-gold font-bold text-sm">{stepNumber}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className="font-display font-semibold text-avalon-text mb-1">
          {phase.name}
        </h4>
        <p className="text-sm text-avalon-text-secondary mb-2">
          {phase.description}
        </p>
        {phase.details && phase.details.length > 0 && (
          <ul className="space-y-0.5">
            {phase.details.map((detail, index) => (
              <li
                key={index}
                className="text-xs text-avalon-text-muted flex items-start gap-1.5"
              >
                <span className="text-avalon-gold/60 mt-0.5">•</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

