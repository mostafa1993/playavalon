'use client';

import { Sparkles } from 'lucide-react';

interface AIReviewToggleProps {
  enabled: boolean;
  consentedCount: number;
  totalPlayers: number;
  isToggling: boolean;
  onToggle: (enabled: boolean) => void;
}

/**
 * Manager-only toggle for the AI Game Reviewer feature.
 * When enabled, every player must accept the consent modal before
 * the manager can distribute roles.
 */
export function AIReviewToggle({
  enabled,
  consentedCount,
  totalPlayers,
  isToggling,
  onToggle,
}: AIReviewToggleProps) {
  const allConsented = enabled && consentedCount >= totalPlayers;

  return (
    <div className="card py-3 px-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles
            size={16}
            className="mt-0.5 flex-shrink-0 text-avalon-gold"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-avalon-text">
              AI Game Review
            </p>
            <p className="text-xs text-avalon-silver/80">
              Record speech + AI-generated post-game summary
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={isToggling}
          onClick={() => onToggle(!enabled)}
          className={`
            relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors
            focus:outline-none focus:ring-2 focus:ring-avalon-gold focus:ring-offset-2 focus:ring-offset-avalon-midnight
            disabled:opacity-50 disabled:cursor-not-allowed
            ${enabled ? 'bg-avalon-gold' : 'bg-avalon-dark-lighter border border-avalon-dark-border'}
          `}
        >
          <span
            className={`
              inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform
              ${enabled ? 'translate-x-5' : 'translate-x-0.5'}
              mt-[1px]
            `}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-2 pt-2 border-t border-avalon-dark-border/60">
          <div className="flex items-center justify-between">
            <p className="text-xs text-avalon-silver/80">
              Consents
            </p>
            <p
              className={`
                text-xs font-semibold
                ${allConsented ? 'text-good' : 'text-avalon-gold'}
              `}
            >
              {consentedCount} / {totalPlayers}
            </p>
          </div>
          {!allConsented && (
            <p className="mt-1 text-[11px] text-avalon-silver/70">
              Waiting for all players to accept the consent.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
