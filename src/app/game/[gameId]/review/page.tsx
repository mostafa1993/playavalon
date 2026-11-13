'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Sparkles, ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { ReviewApiResponse } from '@/types/review';
import {
  summaryView,
  type ReviewAssassinPhaseView,
  type ReviewQuestView,
  type ReviewView,
} from '@/lib/review/summary-view';

type Language = 'fa' | 'en';

export default function GameReviewPage() {
  const params = useParams();
  const gameId = params.gameId as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [language, setLanguage] = useState<Language>('fa');
  const [view, setView] = useState<ReviewView | null>(null);
  const [status, setStatus] = useState<
    | 'loading'
    | 'pending'
    | 'recording'
    | 'generating'
    | 'ready'
    | 'failed'
    | 'disabled'
    | 'unavailable'
  >('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.push(`/login?returnTo=/game/${gameId}/review`);
  }, [authLoading, user, router, gameId]);

  useEffect(() => {
    if (!user) return;
    // Reset on language change so we don't render the previous language's
    // summary inside the new language's UI chrome while the new fetch runs.
    setStatus('loading');
    setView(null);
    setError(null);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/reviews/${gameId}?lang=${language}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error?.message || `Request failed (${res.status})`);
        }
        const body = (await res.json()) as ReviewApiResponse;
        if (cancelled) return;

        if (!body.data.enabled) {
          setStatus('disabled');
          return;
        }
        if (body.data.status === 'ready') {
          // A report in an earlier format can't be shown (plan D17).
          const next = summaryView(body.data.summary);
          setView(next);
          setStatus(next ? 'ready' : 'unavailable');
          return;
        }
        setStatus(body.data.status);
        setError(body.data.error_message ?? null);

        if (body.data.status !== 'failed') {
          // Poll again while the agent is still working.
          timer = setTimeout(fetchOnce, 10_000);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load review');
        setStatus('failed');
      }
    };

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user, gameId, language]);

  const isRtl = language === 'fa';

  if (authLoading || status === 'loading') {
    return (
      <main className="min-h-screen bg-avalon-midnight flex items-center justify-center p-6">
        <Loader2 className="animate-spin text-avalon-gold" size={32} />
      </main>
    );
  }

  if (status === 'disabled') {
    return (
      <ReviewShell onBack={() => router.push(`/game/${gameId}`)} title="AI Game Report">
        <div className="card p-6 text-center space-y-3">
          <p className="text-avalon-text-secondary">
            AI Game Review was not enabled for this game.
          </p>
        </div>
      </ReviewShell>
    );
  }

  if (status === 'unavailable') {
    return (
      <ReviewShell onBack={() => router.push(`/game/${gameId}`)} title="AI Game Report">
        <div className="card p-6 text-center space-y-3">
          <p className="text-avalon-text">This report is no longer available.</p>
        </div>
      </ReviewShell>
    );
  }

  if (status === 'failed') {
    return (
      <ReviewShell onBack={() => router.push(`/game/${gameId}`)} title="AI Game Report">
        <div className="card p-6 flex items-start gap-3 border border-evil/40">
          <AlertTriangle className="text-evil-light flex-shrink-0 mt-1" size={20} />
          <div>
            <p className="text-avalon-text font-semibold mb-1">
              Report generation failed.
            </p>
            {error && <p className="text-avalon-silver text-sm">{error}</p>}
          </div>
        </div>
      </ReviewShell>
    );
  }

  if (status === 'pending' || status === 'recording' || status === 'generating') {
    const label =
      status === 'generating'
        ? 'Generating the narrative…'
        : status === 'recording'
          ? 'Recording turns…'
          : 'Waiting for the agent to pick this game up…';
    return (
      <ReviewShell onBack={() => router.push(`/game/${gameId}`)} title="AI Game Report">
        <div className="card p-6 flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-avalon-gold" size={28} />
          <p className="text-avalon-text">{label}</p>
          <p className="text-avalon-silver text-xs">This page will refresh automatically.</p>
        </div>
      </ReviewShell>
    );
  }

  if (status !== 'ready' || !view) return null;

  return (
    <ReviewShell
      onBack={() => router.push(`/game/${gameId}`)}
      title="AI Game Report"
      right={<LanguageToggle value={language} onChange={setLanguage} />}
    >
      <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-5">
        <OutcomeHeader view={view} />

        {view.roles && <RolesSection roles={view.roles} isRtl={isRtl} />}

        <Section
          title={
            view.mode === 'blind'
              ? isRtl
                ? 'روایت کارآگاه'
                : "The Detective's Story"
              : isRtl
                ? 'روایت بازی'
                : 'Game Narrative'
          }
          body={view.narrative}
          isRtl={isRtl}
        />

        {view.performance.length > 0 && <PerformanceSection view={view} isRtl={isRtl} />}

        {view.detective && <DetectiveSections detective={view.detective} isRtl={isRtl} />}

        <div>
          <h2 className="text-avalon-gold font-display text-lg mb-2">
            {isRtl ? 'جزئیات ماموریت‌ها' : 'Quest Breakdown'}
          </h2>
          <div className="space-y-3">
            {view.quests.map((q) => (
              <QuestCard key={q.quest} quest={q} isRtl={isRtl} />
            ))}
          </div>
        </div>

        {view.assassinPhase && <AssassinPhaseSection phase={view.assassinPhase} isRtl={isRtl} />}

        <div className="text-avalon-silver/60 text-xs text-center pt-4">
          {isRtl ? 'تولید شده در' : 'Generated'}{' '}
          {new Date(view.generatedAt).toLocaleString(isRtl ? 'fa-IR' : 'en-US')}
        </div>
      </div>
    </ReviewShell>
  );
}

function RolesSection({
  roles,
  isRtl,
}: {
  roles: NonNullable<ReviewView['roles']>;
  isRtl: boolean;
}) {
  const t = (fa: string, en: string) => (isRtl ? fa : en);
  const side = (title: string, color: string, lines: typeof roles.good) => (
    <div className="card p-3">
      <div className={`font-display mb-2 ${color}`}>{title}</div>
      <ul className="space-y-1 text-sm">
        {lines.map((p) => (
          <li key={p.seat} className="flex items-center justify-between gap-2">
            <span className="text-avalon-text">
              <span className="text-avalon-silver/70 text-xs">
                {t('صندلی', 'Seat')} {p.seat}
              </span>{' '}
              {p.name}
            </span>
            <span className="text-avalon-silver">{p.role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div>
      <h2 className="text-avalon-gold font-display text-lg mb-2">
        {t('بازیکنان و نقش‌ها', 'Players & Roles')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {side(t('نیکان', 'Good'), 'text-good', roles.good)}
        {side(t('پلیدان', 'Evil'), 'text-evil-light', roles.evil)}
      </div>
    </div>
  );
}

function PerformanceSection({ view, isRtl }: { view: ReviewView; isRtl: boolean }) {
  return (
    <div>
      <h2 className="text-avalon-gold font-display text-lg mb-2">
        {isRtl ? 'ارزیابی عملکرد بازیکنان' : 'Player Performance'}
      </h2>
      <div className="space-y-2">
        {view.performance.map((p) => (
          <div key={p.name} className="card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-avalon-text font-medium">{p.name}</span>
              <span className="text-avalon-silver text-xs">{p.role}</span>
            </div>
            <p className="text-avalon-silver text-sm mt-1 whitespace-pre-wrap">{p.assessment}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetectiveSections({
  detective,
  isRtl,
}: {
  detective: NonNullable<ReviewView['detective']>;
  isRtl: boolean;
}) {
  return (
    <>
      <div>
        <h2 className="text-avalon-gold font-display text-lg mb-2">
          {isRtl ? 'حدس‌های نهایی نقش‌ها' : 'Final Role Guesses'}
        </h2>
        <p className="text-avalon-silver/70 text-xs mb-2">
          {isRtl
            ? 'این‌ها فقط حدس‌اند — کارآگاه هرگز نقش واقعی را ندیده است.'
            : 'These are guesses only — the detective never saw the true roles.'}
        </p>
        <div className="space-y-2">
          {detective.finalGuesses.map((g) => (
            <div key={g.player} className="card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-avalon-text font-medium">{g.player}</span>
                <span className="text-avalon-gold text-sm flex items-center gap-1">
                  {g.guessed_role}
                  <ConfidenceBadge confidence={g.confidence} isRtl={isRtl} />
                </span>
              </div>
              <p className="text-avalon-silver text-sm mt-1 whitespace-pre-wrap">{g.reasoning}</p>
            </div>
          ))}
        </div>
      </div>
      {detective.timeline.length > 1 && (
        <details className="card p-3">
          <summary className="cursor-pointer text-avalon-gold font-display">
            {isRtl ? 'سیر تکامل حدس‌ها (دور به دور)' : 'How the guesses evolved (round by round)'}
          </summary>
          <div className="mt-3 space-y-3">
            {detective.timeline.map((r) => (
              <div key={r.round} className="border-l-2 border-avalon-gold/30 pl-3">
                <div className="text-avalon-silver text-xs mb-1">
                  {r.quest === 0
                    ? isRtl
                      ? `دور ${r.round} — معارفه`
                      : `Round ${r.round} — Intro`
                    : isRtl
                      ? `دور ${r.round} — ماموریت ${r.quest}`
                      : `Round ${r.round} — Quest ${r.quest}`}
                </div>
                <ul className="space-y-0.5">
                  {r.guesses.map((g) => (
                    <li key={g.player} className="text-sm">
                      <span className="text-avalon-text">{g.player}</span>
                      {' → '}
                      <span className="text-avalon-gold">{g.guessed_role}</span>
                      <span className="text-avalon-silver/60"> ({g.confidence})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function ConfidenceBadge({
  confidence,
  isRtl,
}: {
  confidence: 'low' | 'med' | 'high';
  isRtl: boolean;
}) {
  const labels = isRtl
    ? { low: 'کم', med: 'متوسط', high: 'زیاد' }
    : { low: 'low', med: 'med', high: 'high' };
  const colors = {
    low: 'text-avalon-silver/60',
    med: 'text-avalon-silver',
    high: 'text-avalon-gold',
  };
  return <span className={`text-xs shrink-0 ${colors[confidence]}`}>[{labels[confidence]}]</span>;
}

function ReviewShell({
  title,
  onBack,
  right,
  children,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-avalon-midnight">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-avalon-silver hover:text-avalon-gold transition-colors text-sm"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2 text-avalon-gold">
            <Sparkles size={18} />
            <h1 className="font-display text-xl">{title}</h1>
          </div>
          <div className="min-w-[60px] flex justify-end">{right ?? null}</div>
        </div>
        {children}
      </div>
    </main>
  );
}

function LanguageToggle({
  value,
  onChange,
}: {
  value: Language;
  onChange: (lang: Language) => void;
}) {
  return (
    <div className="flex items-center bg-avalon-navy border border-avalon-dark-border rounded-md p-0.5">
      {(['fa', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`
            px-2.5 py-1 rounded text-xs font-medium transition-colors
            ${value === l
              ? 'bg-avalon-gold text-avalon-midnight'
              : 'text-avalon-text-muted hover:text-avalon-text'}
          `}
        >
          {l === 'fa' ? 'فارسی' : 'English'}
        </button>
      ))}
    </div>
  );
}

function OutcomeHeader({ view }: { view: ReviewView }) {
  const winner = view.outcome.winner;
  const isRtl = view.language === 'fa';
  const label = winner
    ? isRtl
      ? winner === 'good'
        ? 'پیروزی نیکان'
        : 'پیروزی پلیدان'
      : winner === 'good'
        ? 'Good wins'
        : 'Evil wins'
    : isRtl
      ? 'نامشخص'
      : 'Undecided';
  const color =
    winner === 'good'
      ? 'text-good'
      : winner === 'evil'
        ? 'text-evil-light'
        : 'text-avalon-silver';

  return (
    <div className="card p-4 text-center">
      <div className={`font-display text-2xl ${color}`}>{label}</div>
      {view.outcome.reason && (
        <p className="text-avalon-silver text-sm mt-1">{view.outcome.reason}</p>
      )}
      <p className="text-avalon-silver/60 text-xs mt-2">
        {isRtl ? 'اتاق' : 'Room'} {view.roomCode}
      </p>
    </div>
  );
}

function Section({
  title,
  body,
  isRtl,
}: {
  title: string;
  body: string;
  isRtl: boolean;
}) {
  return (
    <div>
      <h2 className="text-avalon-gold font-display text-lg mb-2">{title}</h2>
      <div className="card p-4">
        <div
          className="text-avalon-text whitespace-pre-wrap leading-relaxed"
          style={{ textAlign: isRtl ? 'right' : 'left' }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function QuestCard({ quest, isRtl }: { quest: ReviewQuestView; isRtl: boolean }) {
  const t = (fa: string, en: string) => (isRtl ? fa : en);
  const list = (names: string[]) => names.join(isRtl ? '، ' : ', ') || '—';
  return (
    <details open className="card p-3">
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <span className="text-avalon-gold font-semibold">
          {t('ماموریت', 'Quest')} {quest.quest}
        </span>
        {quest.mission && (
          <span
            className={`
              text-xs font-bold px-2 py-0.5 rounded
              ${quest.mission.result === 'success'
                ? 'bg-good/20 text-good'
                : 'bg-evil/20 text-evil-light'}
            `}
          >
            {quest.mission.result === 'success' ? t('موفق', 'Success') : t('شکست', 'Fail')}
          </span>
        )}
      </summary>

      <div className="mt-3 space-y-3 text-sm">
        <div className="space-y-1.5">
          {quest.proposals.map((p) => (
            <div key={p.number} className="bg-avalon-navy/50 rounded px-2 py-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-avalon-text">
                  {t('پیشنهاد', 'Proposal')} {p.number} · {t('رهبر:', 'Leader:')}{' '}
                  <span className="font-medium">{p.leader}</span>
                </span>
                <span
                  className={`text-xs font-medium ${
                    p.status === 'approved'
                      ? 'text-good'
                      : p.status === 'rejected'
                        ? 'text-evil-light'
                        : 'text-avalon-silver'
                  }`}
                >
                  {p.status === 'approved'
                    ? t('تصویب', 'Approved')
                    : p.status === 'rejected'
                      ? t('رد', 'Rejected')
                      : t('بدون رأی', 'Not voted')}
                </span>
              </div>
              <div className="text-avalon-text-secondary">
                {t('تیم:', 'Team:')} {list(p.team)}
              </div>
              {p.status !== 'pending' && (
                <div className="text-avalon-silver/80 text-xs">
                  {t('موافق:', 'Approved:')} {list(p.approvals)} · {t('مخالف:', 'Rejected:')}{' '}
                  {list(p.rejections)}
                </div>
              )}
            </div>
          ))}
        </div>

        {quest.mission && (
          <div className="text-avalon-text-secondary">
            {t('ماموریت:', 'Mission:')} {list(quest.mission.team)} ·{' '}
            {t(
              `${quest.mission.successCount} موفق، ${quest.mission.failCount} شکست`,
              `${quest.mission.successCount} success, ${quest.mission.failCount} fail`
            )}
          </div>
        )}

        {quest.lady.map((l, i) => (
          <div key={i} className="text-avalon-text-secondary">
            {t('بانوی دریاچه:', 'Lady of the Lake:')}{' '}
            {t(`${l.investigator} ${l.target} را بررسی کرد`, `${l.investigator} looked at ${l.target}`)}
            {l.result &&
              (l.result === 'good'
                ? t(' — نیک دید', ' — saw good')
                : t(' — پلید دید', ' — saw evil'))}
          </div>
        ))}

        {quest.commentary && (
          <p className="text-avalon-text whitespace-pre-wrap">{quest.commentary}</p>
        )}
      </div>
    </details>
  );
}

function AssassinPhaseSection({
  phase,
  isRtl,
}: {
  phase: ReviewAssassinPhaseView;
  isRtl: boolean;
}) {
  const t = (fa: string, en: string) => (isRtl ? fa : en);
  return (
    <div>
      <h2 className="text-avalon-gold font-display text-lg mb-2">
        {t('مرحله‌ی آدمکش', 'Assassin Phase')}
      </h2>
      <div className="card p-3 space-y-3">
        <div className="text-avalon-silver text-xs space-x-2 rtl:space-x-reverse">
          {phase.assassin && (
            <span>
              {t('آدمکش:', 'Assassin:')} {phase.assassin} ·
            </span>
          )}
          <span>
            {t('انتخاب آدمکش:', "Assassin's pick:")} {phase.pick ?? '—'}
          </span>
          {phase.durationSec !== null && (
            <span>
              · {t('مدت بحث:', 'Discussion:')} {Math.round(phase.durationSec)}s
            </span>
          )}
        </div>
        {phase.speakers.length > 0 && (
          <div className="space-y-2">
            {phase.speakers.map((s, i) => (
              <div key={i} className="bg-avalon-navy/50 rounded px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-avalon-text font-semibold">{s.name}</span>
                  <span className="text-avalon-silver/80 text-xs">{Math.round(s.durationSec)}s</span>
                </div>
                {s.lowConfidence && (
                  <p className="text-avalon-silver/80 text-xs mt-1">
                    {t(
                      'صدا واضح شنیده نشد؛ این متن ممکن است نادرست باشد.',
                      'Unclear audio: this transcript may be wrong.'
                    )}
                  </p>
                )}
                {/* The talk is Persian whatever the report's language. */}
                <p
                  dir="auto"
                  className={`text-sm mt-1 whitespace-pre-wrap ${
                    s.lowConfidence ? 'text-avalon-silver/70 italic' : 'text-avalon-text-secondary'
                  }`}
                >
                  {s.transcript}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
