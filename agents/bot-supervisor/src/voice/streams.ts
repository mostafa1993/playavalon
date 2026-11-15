/**
 * Streamed speech (plan 2026-11-15-2100, rows C and G): a statement is spoken
 * sentence by sentence while the model is still writing it, and the turn
 * never hangs on one slow call.
 */

export const PENDING = Symbol('pending');

/** The value of a promise that has already settled, or PENDING; it never waits. */
export async function settled<T>(promise: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([promise, Promise.resolve(PENDING)]);
}

/** Sentences from a stream of text, each as soon as it is complete. */
export async function* sentenceStream(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += chunk;
    for (;;) {
      const m = /^([\s\S]*?)(?:([.!?؟…]+)\s+|\n+)/.exec(buffer);
      if (!m) break;
      buffer = buffer.slice(m[0].length);
      const sentence = (m[1] + (m[2] ?? '')).trim();
      if (sentence) yield sentence;
    }
  }
  const tail = buffer.trim();
  if (tail) yield tail;
}

/** A stream of sentences that stops when its signal aborts. */
export type SentenceSource = (signal: AbortSignal) => AsyncIterable<string>;

export interface Started {
  /** Its first sentence. */
  first: string;
  /** The sentences after it. Stopping early stops the stream. */
  rest: AsyncGenerator<string>;
  /** Which of the starts won (its index). */
  index: number;
  /** Stop its stream (also done when `rest` ends or is left). */
  stop(): void;
}

/**
 * The first of several tries to give a sentence wins; the others are stopped.
 * Each try starts at its `afterMs`, or at once when every try started so far
 * has failed (a hung call is hedged by a second one; a failed one, with
 * nothing else running, is replaced straight away). Null when every try
 * fails, or none gives a sentence within `withinMs`.
 */
export function firstSentence(tries: { afterMs: number; source: SentenceSource }[], withinMs: number): Promise<Started | null> {
  return new Promise((resolve) => {
    interface Running {
      index: number;
      ctrl: AbortController;
      it: AsyncIterator<string>;
    }
    const running: Running[] = [];
    const started = new Set<number>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let failed = 0;
    let inFlight = 0;
    let done = false;

    const finish = (winner: Running | null, first?: string) => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      for (const r of running) if (r !== winner) stop(r);
      resolve(winner ? { first: first!, rest: rest(winner), index: winner.index, stop: () => stop(winner) } : null);
    };

    const launch = (index: number) => {
      if (done || started.has(index)) return;
      started.add(index);
      const ctrl = new AbortController();
      let it: AsyncIterator<string>;
      try {
        it = tries[index]!.source(ctrl.signal)[Symbol.asyncIterator]();
      } catch {
        onFail();
        return;
      }
      const r: Running = { index, ctrl, it };
      running.push(r);
      inFlight += 1;
      it.next().then(
        (step) => {
          inFlight -= 1;
          if (step.done) onFail();
          else if (done) stop(r);
          else finish(r, step.value);
        },
        () => {
          inFlight -= 1;
          onFail();
        }
      );
    };

    const onFail = () => {
      failed += 1;
      if (inFlight > 0) return;
      const next = tries.findIndex((_, i) => !started.has(i));
      if (next >= 0) launch(next);
      else if (failed >= tries.length) finish(null);
    };

    tries.forEach((t, i) => {
      if (t.afterMs <= 0) launch(i);
      else timers.push(setTimeout(() => launch(i), t.afterMs));
    });
    timers.push(setTimeout(() => finish(null), Math.max(0, withinMs)));
  });
}

function stop(r: { ctrl: AbortController; it: AsyncIterator<string> }): void {
  r.ctrl.abort();
  void r.it.return?.()?.catch?.(() => {});
}

async function* rest(r: { ctrl: AbortController; it: AsyncIterator<string> }): AsyncGenerator<string> {
  try {
    for (;;) {
      const step = await r.it.next();
      if (step.done) return;
      yield step.value;
    }
  } finally {
    r.ctrl.abort();
  }
}

/** The sentences of a ready text, as a stream. */
export async function* fromSentences(sentences: string[]): AsyncGenerator<string> {
  for (const s of sentences) yield s;
}

/** A first sentence and the rest, as one stream; leaving it early stops the stream. */
export async function* joined(started: Started): AsyncGenerator<string> {
  try {
    yield started.first;
    yield* started.rest;
  } finally {
    started.stop();
  }
}

/**
 * The rest of a started stream pulled in at once, as it comes, and played from
 * there: the words are kept even if the call's deadline passes before they
 * are spoken (the slot may open a while after the words were composed).
 */
export function drained(started: Started): Started {
  const queue: string[] = [];
  let done = false;
  let failure: unknown = null;
  const waiter: { wake: (() => void) | null } = { wake: null };
  void (async () => {
    try {
      for await (const sentence of started.rest) {
        queue.push(sentence);
        waiter.wake?.();
      }
    } catch (err) {
      failure = err;
    } finally {
      done = true;
      waiter.wake?.();
    }
  })();
  async function* rest(): AsyncGenerator<string> {
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (done) {
        if (failure) throw failure;
        return;
      }
      await new Promise<void>((resolve) => {
        waiter.wake = resolve;
      });
      waiter.wake = null;
    }
  }
  return { first: started.first, rest: rest(), index: started.index, stop: started.stop };
}
