'use client';

/**
 * The player's private chat with the AI reviewer, under the game's report.
 *
 * It shows the player's thread, a box to ask, and each answer as it streams
 * in; each message is drawn right-to-left when it is mostly Persian. Near the
 * question limit it says how many are left. When the chat route says the chat
 * isn't available for this game (no record, say), the panel isn't drawn.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { textDirection } from '@/lib/review-chat/text-direction';
import { ERROR_CODES } from '@/lib/utils/constants';
import type { ReviewChatMessage, ReviewChatThreadResponse } from '@/types/review';

/** The limit is shown once this many questions or fewer are left. */
const SHOW_LEFT_AT = 5;
const MAX_QUESTION_LENGTH = 1000;

type Translate = (fa: string, en: string) => string;

interface Turn {
  turnNo: number;
  question: string;
  /** Null when the answer failed. */
  answer: string | null;
}

function toTurns(messages: ReviewChatMessage[]): Turn[] {
  const answers = new Map(
    messages.filter((m) => m.speaker === 'reviewer').map((m) => [m.turnNo, m.content])
  );
  return messages
    .filter((m) => m.speaker === 'player')
    .map((m) => ({ turnNo: m.turnNo, question: m.content, answer: answers.get(m.turnNo) ?? null }));
}

/** Why a question got no answer, in the page's language, from the route's
 *  refusal. None of these questions was counted. */
function refusal(status: number, code: string | undefined, limit: number, t: Translate): string {
  if (code === ERROR_CODES.QUESTION_LIMIT_REACHED) {
    return t(`به سقف ${limit} پرسش برای این بازی رسیده‌اید.`, `You've reached the ${limit}-question limit for this game.`);
  }
  if (code === ERROR_CODES.QUESTION_IN_PROGRESS) {
    return t('هر بار یک پرسش: صبر کنید تا پاسخ قبلی برسد.', 'One question at a time: wait for the last answer.');
  }
  if (status === 502) {
    return t(
      'بازبین نتوانست پاسخ دهد؛ دوباره بپرسید. این پرسش شمرده نشد.',
      "The reviewer couldn't answer. Ask again: this question wasn't counted."
    );
  }
  if (status === 409) return t('بازی هنوز تمام نشده است.', 'The game is still in play.');
  if (status === 404) return t('گفتگو برای این بازی در دسترس نیست.', "Chat isn't available for this game.");
  if (status === 400) {
    return t(`پرسش باید بین ۱ تا ${MAX_QUESTION_LENGTH} نویسه باشد.`, `A question must be 1 to ${MAX_QUESTION_LENGTH} characters.`);
  }
  return t('پاسخی نیامد؛ دوباره بپرسید.', 'No answer came. Ask again.');
}

export function ReviewChat({ gameId, isRtl }: { gameId: string; isRtl: boolean }) {
  const t: Translate = (fa, en) => (isRtl ? fa : en);
  const pageDir = isRtl ? 'rtl' : 'ltr';
  const dirOf = (text: string) => textDirection(text) ?? pageDir;

  const [thread, setThread] = useState<{ limit: number; messages: ReviewChatMessage[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ question: string; answer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** The thread as stored; null when the chat isn't available. */
  const loadThread = useCallback(async () => {
    const res = await fetch(`/api/reviews/${gameId}/chat`);
    if (!res.ok) return null;
    return ((await res.json()) as ReviewChatThreadResponse).data;
  }, [gameId]);

  useEffect(() => {
    let cancelled = false;
    loadThread()
      .then((data) => {
        if (!cancelled) setThread(data);
      })
      .catch(() => {
        if (!cancelled) setThread(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadThread]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [thread, pending]);

  if (!thread) return null;

  const turns = toTurns(thread.messages);
  const left = thread.limit - turns.length - (pending ? 1 : 0);

  const ask = async () => {
    const question = draft.trim();
    if (!question || pending || left <= 0) return;
    setDraft('');
    setError(null);
    setNotice(null);
    setPending({ question, answer: '' });

    // Once the answer starts, the question is stored and counts.
    let stored = false;
    let answer: string | null = null;
    try {
      const res = await fetch(`/api/reviews/${gameId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(refusal(res.status, body.error?.code, thread.limit, t));
        setDraft(question);
      } else {
        stored = true;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setPending({ question, answer: text });
        }
        answer = text;
      }
    } catch {
      if (stored) {
        setError(t('پاسخ کامل نشد؛ دوباره بپرسید.', 'The answer was cut off. Ask again.'));
      } else {
        setError(t('پاسخی نیامد؛ دوباره بپرسید.', 'No answer came. Ask again.'));
        setDraft(question);
      }
    }

    // The stored thread is the truth: it has the answer, or the question
    // without one when the answer failed partway.
    const data = await loadThread().catch(() => null);
    if (data) {
      setThread(data);
    } else if (stored) {
      // Keep the turn on screen as it went.
      setThread((prev) => {
        if (!prev) return prev;
        const turnNo = Math.max(0, ...prev.messages.map((m) => m.turnNo)) + 1;
        const createdAt = new Date().toISOString();
        const added: ReviewChatMessage[] = [{ turnNo, speaker: 'player', content: question, createdAt }];
        if (answer !== null) added.push({ turnNo, speaker: 'reviewer', content: answer, createdAt });
        return { ...prev, messages: [...prev.messages, ...added] };
      });
      setNotice(
        t(
          'گفتگو تازه نشد؛ برای دیدن آن همان‌طور که ذخیره شده، صفحه را دوباره باز کنید.',
          "Couldn't refresh the conversation: reload the page to see it as stored."
        )
      );
    }
    setPending(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask();
    }
  };

  const shown: Array<{ key: string; question: string; answer: string | null; streaming: boolean }> = [
    ...turns.map((turn) => ({ key: `t${turn.turnNo}`, ...turn, streaming: false })),
    ...(pending ? [{ key: 'pending', ...pending, streaming: true }] : []),
  ];

  return (
    <section className="card p-4 space-y-3" data-testid="review-chat">
      <div>
        <h2 className="text-avalon-gold font-display text-lg flex items-center gap-2">
          <MessageCircle size={18} />
          {t('از بازبین بپرسید', 'Ask the AI reviewer')}
        </h2>
        <p className="text-avalon-silver/80 text-xs mt-1">
          {t(
            'هر پرسشی درباره‌ی این بازی دارید بپرسید. این گفتگو فقط برای شماست.',
            'Ask anything about this game. Only you can see this conversation.'
          )}
        </p>
      </div>

      {shown.length > 0 && (
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto space-y-3 pe-1">
          {shown.map((m) => (
            <div key={m.key} className="space-y-2">
              <div className="flex justify-end">
                <p
                  dir={dirOf(m.question)}
                  className="max-w-[85%] bg-avalon-gold/15 border border-avalon-gold/30 rounded-lg px-3 py-2 text-avalon-text text-sm whitespace-pre-wrap"
                >
                  {m.question}
                </p>
              </div>
              <div className="flex justify-start">
                {m.answer ? (
                  <p
                    dir={dirOf(m.answer)}
                    className="max-w-[90%] bg-avalon-navy/60 border border-avalon-dark-border rounded-lg px-3 py-2 text-avalon-text text-sm leading-relaxed whitespace-pre-wrap"
                  >
                    {m.answer}
                  </p>
                ) : m.streaming ? (
                  <Loader2 className="animate-spin text-avalon-gold m-2" size={18} />
                ) : (
                  <p className="text-avalon-silver/60 text-xs italic px-1">
                    {t('بی‌پاسخ ماند', 'No answer')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-evil-light text-sm">{error}</p>}
      {notice && <p className="text-avalon-silver/80 text-xs">{notice}</p>}

      {left <= SHOW_LEFT_AT && (
        <p className="text-avalon-silver text-xs">
          {left > 0
            ? t(`${left} پرسش باقی مانده`, `${left} question${left === 1 ? '' : 's'} left`)
            : t(
                `به سقف ${thread.limit} پرسش برای این بازی رسیده‌اید`,
                `You've reached the ${thread.limit}-question limit for this game`
              )}
        </p>
      )}

      {left > 0 && (
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            dir="auto"
            rows={2}
            maxLength={MAX_QUESTION_LENGTH}
            disabled={pending !== null}
            placeholder={t('مثلاً: چرا ماموریت دوم شکست خورد؟', 'e.g. Why did the second quest fail?')}
            aria-label={t('پرسش شما', 'Your question')}
            className="flex-1 resize-none px-3 py-2 rounded-lg bg-avalon-midnight border border-avalon-silver/30 text-avalon-parchment placeholder-avalon-silver/50 text-sm focus:outline-none focus:border-avalon-gold focus:ring-2 focus:ring-avalon-gold/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={pending !== null || draft.trim().length === 0}
            aria-label={t('بپرس', 'Ask')}
            className="h-10 px-3 rounded-lg bg-avalon-gold text-avalon-midnight flex items-center gap-1.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} className="rtl:-scale-x-100" />}
            {t('بپرس', 'Ask')}
          </button>
        </form>
      )}
    </section>
  );
}
