'use client';

import { Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface AIConsentModalProps {
  isOpen: boolean;
  isAccepting: boolean;
  error: string | null;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Consent modal shown to each player when the manager has enabled
 * AI Game Review. Must be accepted before the manager can distribute roles.
 *
 * Copy: English only (per spec decision).
 */
export function AIConsentModal({
  isOpen,
  isAccepting,
  error,
  onAccept,
  onDismiss,
}: AIConsentModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="card w-full max-w-md p-5 space-y-4 border border-avalon-gold/40 shadow-xl">
        <div className="flex items-start gap-2">
          <Sparkles className="flex-shrink-0 mt-0.5 text-avalon-gold" size={20} />
          <div>
            <h2
              id="ai-consent-title"
              className="text-lg font-display font-bold text-avalon-gold"
            >
              AI Game Review
            </h2>
            <p className="text-xs text-avalon-silver/80">
              Consent required to start the game
            </p>
          </div>
        </div>

        <div className="text-sm text-avalon-text space-y-2">
          <p>
            The manager has enabled <strong>AI Game Review</strong> for this match.
            During the game, each player&apos;s speech will be recorded turn by turn
            and transcribed by an AI service. At the end of the game, a narrative
            summary of the match will be generated and available to all players.
          </p>
          <p>
            <strong>What is recorded:</strong> your voice during your own speaking
            turns only.
          </p>
          <p>
            <strong>What is kept:</strong> only the text transcripts and the final
            AI-generated report. Audio files are discarded after transcription.
          </p>
          <p>
            <strong>Visibility:</strong> nothing is visible during the game. The
            report becomes available to all players after the game ends.
          </p>
          <p className="text-avalon-silver/80 text-xs">
            You can decline. If any player declines, the manager must disable this
            feature before the game can start.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-evil/10 border border-evil/30">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-evil-light" />
            <p className="text-xs text-evil-light">{error}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            fullWidth
            onClick={onDismiss}
            disabled={isAccepting}
            className="text-avalon-silver"
          >
            Not now
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={onAccept}
            isLoading={isAccepting}
          >
            I agree
          </Button>
        </div>
      </div>
    </div>
  );
}
