'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Sparkles, ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { ReviewApiResponse, ReviewDiscussion, ReviewSummary } from '@/types/review';

type Language = 'fa' | 'en';

export default function GameReviewPage() {
  const params = useParams();
  const gameId = params.gameId as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [language, setLanguage] = useState<Language>('fa');
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'pending' | 'recording' | 'generating' | 'ready' | 'failed' | 'disabled'
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
    setSummary(null);
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
          setSummary(body.data.summary);
          setStatus('ready');
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

  if (status !== 'ready' || !summary) return null;

  return (
    <ReviewShell
      onBack={() => router.push(`/game/${gameId}`)}
      title="AI Game Report"
      right={<LanguageToggle value={language} onChange={setLanguage} />}
    >
      <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-5">
        <OutcomeHeader summary={summary} />

        <Section
          title={isRtl ? 'بازیکنان و نقش‌ها' : 'Players & Roles'}
          body={summary.role_reveal}
          isRtl={isRtl}
        />

        <Section
          title={isRtl ? 'روایت بازی' : 'Game Narrative'}
          body={summary.narrative}
          isRtl={isRtl}
        />

        <div>
          <h2 className="text-avalon-gold font-display text-lg mb-2">
            {isRtl ? 'جزئیات ماموریت‌ها' : 'Quest Breakdown'}
          </h2>
          <div className="space-y-3">
            {summary.quests.map((q) => (
              <QuestCard key={q.quest_number} quest={q} isRtl={isRtl} />
            ))}
          </div>
        </div>

        {summary.discussion && summary.discussion.speakers.length > 0 && (
          <DiscussionSection discussion={summary.discussion} isRtl={isRtl} />
        )}

        <div className="text-avalon-silver/60 text-xs text-center pt-4">
          {isRtl ? 'تولید شده در' : 'Generated'}{' '}
          {new Date(summary.generatedAt).toLocaleString(isRtl ? 'fa-IR' : 'en-US')}
        </div>
      </div>
    </ReviewShell>
  );
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

function OutcomeHeader({ summary }: { summary: ReviewSummary }) {
  const winner = summary.outcome.winner;
  const isRtl = summary.language === 'fa';
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
      {summary.outcome.win_reason && (
        <p className="text-avalon-silver text-sm mt-1">{summary.outcome.win_reason}</p>
      )}
      <p className="text-avalon-silver/60 text-xs mt-2">
        {isRtl ? 'اتاق' : 'Room'} {summary.roomCode}
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

function QuestCard({
  quest,
  isRtl,
}: {
  quest: ReviewSummary['quests'][number];
  isRtl: boolean;
}) {
  const lastProp = quest.proposals[quest.proposals.length - 1];
  const t = (fa: string, en: string) => (isRtl ? fa : en);
  return (
    <details className="card p-3 group">
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <div>
          <span className="text-avalon-gold font-semibold">
            {t('ماموریت', 'Quest')} {quest.quest_number}
          </span>
          <span className="text-avalon-silver text-sm ml-2">
            {t('رهبر:', 'Leader:')} {quest.leader_display_name}
          </span>
        </div>
        {quest.mission && (
          <span
            className={`
              text-xs font-bold px-2 py-0.5 rounded
              ${quest.mission.result === 'success'
                ? 'bg-good/20 text-good'
                : 'bg-evil/20 text-evil-light'}
            `}
          >
            {quest.mission.result === 'success'
              ? t('موفق', 'Success')
              : t('شکست', 'Fail')}
            {quest.mission.fail_count > 0 && ` (${quest.mission.fail_count})`}
          </span>
        )}
      </summary>

      <div className="mt-3 space-y-3 text-sm">
        <div>
          <div className="text-avalon-silver text-xs mb-1">
            {t('پیشنهادها', 'Proposals')}
          </div>
          <div className="space-y-1">
            {quest.proposals.map((p) => (
              <div
                key={p.proposal_number}
                className="flex items-center justify-between bg-avalon-navy/50 rounded px-2 py-1"
              >
                <span className="text-avalon-text">
                  #{p.proposal_number} — {p.team.join(', ')}
                </span>
                <span
                  className={`text-xs font-medium ${
                    p.status === 'approved' ? 'text-good' : 'text-evil-light'
                  }`}
                >
                  {p.status === 'approved'
                    ? t('تصویب', 'Approved')
                    : t('رد', 'Rejected')}
                </span>
              </div>
            ))}
          </div>
          {lastProp && (
            <div className="text-avalon-silver/80 text-xs mt-1">
              {t('موافق:', 'Approved:')} {lastProp.approvals.join(', ') || '—'} ·{' '}
              {t('مخالف:', 'Rejected:')} {lastProp.rejections.join(', ') || '—'}
            </div>
          )}
        </div>

        {quest.narrative_summary && (
          <p className="text-avalon-text whitespace-pre-wrap">
            {quest.narrative_summary}
          </p>
        )}

        {quest.turning_points.length > 0 && (
          <div>
            <div className="text-avalon-silver text-xs mb-1">
              {t('لحظات کلیدی', 'Turning points')}
            </div>
            <ul className="list-disc list-inside text-avalon-text-secondary space-y-0.5">
              {quest.turning_points.map((tp, i) => (
                <li key={i}>{tp}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function DiscussionSection({
  discussion,
  isRtl,
}: {
  discussion: ReviewDiscussion;
  isRtl: boolean;
}) {
  const t = (fa: string, en: string) => (isRtl ? fa : en);
  return (
    <div>
      <h2 className="text-avalon-gold font-display text-lg mb-2">
        {t('بحث آدمکش', 'Assassin Discussion')}
      </h2>
      <div className="card p-3 space-y-3">
        <div className="text-avalon-silver text-xs">
          {t('آدمکش:', 'Assassin:')} {discussion.assassinDisplayName ?? '—'} ·{' '}
          {t('مدت:', 'Duration:')} {Math.round(discussion.durationSec)}s
        </div>
        <div className="space-y-2">
          {discussion.speakers
            .filter((s) => s.transcript.trim().length > 0)
            .map((s) => (
              <details key={s.identity} className="bg-avalon-navy/50 rounded px-2 py-1">
                <summary className="cursor-pointer list-none flex items-center justify-between">
                  <span className="text-avalon-text font-semibold">{s.display_name}</span>
                  <span className="text-avalon-silver/80 text-xs">
                    {Math.round(s.durationSec)}s
                  </span>
                </summary>
                <div className="mt-2 space-y-2 text-sm">
                  {s.summary?.key_points && s.summary.key_points.length > 0 && (
                    <ul className="list-disc list-inside text-avalon-text-secondary space-y-0.5">
                      {s.summary.key_points.map((kp, i) => (
                        <li key={i}>{kp}</li>
                      ))}
                    </ul>
                  )}
                  {s.summary?.notable_quotes && s.summary.notable_quotes.length > 0 && (
                    <div className="space-y-0.5">
                      {s.summary.notable_quotes.map((q, i) => (
                        <p
                          key={i}
                          className="text-avalon-gold/90 text-xs italic border-l-2 border-avalon-gold/40 pl-2"
                        >
                          « {q} »
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))}
        </div>
      </div>
    </div>
  );
}
