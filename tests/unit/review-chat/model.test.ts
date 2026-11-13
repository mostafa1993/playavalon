/**
 * Unit tests: the chat's model client, with the Gemini SDK stubbed — which
 * errors it retries while the answer opens, an empty answer, an answer cut
 * off before its end, and the overall timeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({ generate: vi.fn(), options: [] as unknown[] }));

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContentStream: m.generate };
    constructor(options: unknown) {
      m.options.push(options);
    }
  },
}));

import {
  ANSWER_TIMEOUT_MS,
  isRetriableError,
  modelConfigured,
  streamAnswer,
  type ChatPrompt,
} from '@/lib/review-chat/model';

const prompt: ChatPrompt = {
  systemInstruction: 'Answer from the record.',
  contents: [{ role: 'user', parts: [{ text: 'Who led quest 1?' }] }],
  cutOffNote: '(the answer was cut off)',
};

const chunk = (text: string | undefined, finishReason?: string, blockReason?: string) => ({
  text,
  candidates: [{ finishReason }],
  promptFeedback: blockReason ? { blockReason } : undefined,
});

async function* stream(...chunks: ReturnType<typeof chunk>[]) {
  for (const c of chunks) yield c;
}

async function collect(answer: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const t of answer) text += t;
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GCP_PROJECT_ID = 'project-1';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('modelConfigured', () => {
  it('needs GCP_PROJECT_ID', () => {
    expect(modelConfigured()).toBe(true);
    delete process.env.GCP_PROJECT_ID;
    expect(modelConfigured()).toBe(false);
  });
});

describe('streamAnswer', () => {
  it('streams the text with the preamble, safety settings and a timeout signal', async () => {
    m.generate.mockResolvedValue(stream(chunk('Bo '), chunk('led.', 'STOP')));
    expect(await collect(await streamAnswer(prompt))).toBe('Bo led.');

    const request = m.generate.mock.calls[0][0];
    expect(request.contents).toEqual(prompt.contents);
    expect(request.config.systemInstruction).toMatch(/^CONTEXT: All content below is from an Avalon/);
    expect(request.config.systemInstruction).toContain('Answer from the record.');
    expect(request.config.safetySettings).toHaveLength(4);
    expect(request.config.safetySettings.every((s: { threshold: string }) => s.threshold === 'BLOCK_ONLY_HIGH')).toBe(true);
    expect(request.config.maxOutputTokens).toBe(16384);
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(m.options[0]).toMatchObject({ vertexai: true, project: 'project-1' });
  });

  it('retries a transient error while the answer opens', async () => {
    vi.useFakeTimers();
    m.generate
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { status: 503 }))
      .mockResolvedValueOnce(stream(chunk('ok', 'STOP')));
    const opened = streamAnswer(prompt);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await collect(await opened)).toBe('ok');
    expect(m.generate).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts', async () => {
    vi.useFakeTimers();
    m.generate.mockRejectedValue(Object.assign(new Error('Too Many Requests'), { status: 429 }));
    const opened = streamAnswer(prompt);
    const failed = expect(opened).rejects.toThrow('Too Many Requests');
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(m.generate).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error that is not transient', async () => {
    m.generate.mockRejectedValue(Object.assign(new Error('Permission denied'), { status: 403 }));
    await expect(streamAnswer(prompt)).rejects.toThrow('Permission denied');
    expect(m.generate).toHaveBeenCalledTimes(1);
  });

  it('fails an answer with no text, naming why', async () => {
    m.generate.mockResolvedValue(stream(chunk(undefined, 'SAFETY', 'PROHIBITED_CONTENT')));
    await expect(collect(await streamAnswer(prompt))).rejects.toThrow(
      'Empty answer (finishReason=SAFETY, promptBlocked=PROHIBITED_CONTENT)'
    );
  });

  it('marks an answer stopped before its end', async () => {
    for (const reason of ['MAX_TOKENS', 'SAFETY', undefined]) {
      m.generate.mockResolvedValue(stream(chunk('Bo led'), chunk(' quest', reason)));
      expect(await collect(await streamAnswer(prompt)), String(reason)).toBe(
        'Bo led quest\n\n(the answer was cut off)'
      );
    }
  });

  it('times out an answer that stalls partway', async () => {
    vi.useFakeTimers();
    m.generate.mockResolvedValue(
      (async function* () {
        yield chunk('Bo ');
        await new Promise(() => {});
      })()
    );
    const answer = (await streamAnswer(prompt))[Symbol.asyncIterator]();
    expect((await answer.next()).value).toBe('Bo ');
    const stalled = expect(answer.next()).rejects.toThrow(`No whole answer within ${ANSWER_TIMEOUT_MS / 1000} s`);
    await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
    await stalled;
  });

  it('times out an answer that never opens', async () => {
    vi.useFakeTimers();
    m.generate.mockReturnValue(new Promise(() => {}));
    const opened = expect(streamAnswer(prompt)).rejects.toThrow(/No whole answer within/);
    await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
    await opened;
  });
});

describe('isRetriableError', () => {
  it('retries network failures, rate limits and server errors', () => {
    for (const err of [
      new TypeError('fetch failed'),
      { code: 'ECONNRESET' },
      { code: 14 },
      { status: 'UNAVAILABLE' },
      { status: 429 },
      { status: 503 },
      { code: 408 },
      new Error('got status 500 from the server'),
    ]) {
      expect(isRetriableError(err), JSON.stringify(err)).toBe(true);
    }
  });

  it('does not retry bad requests, auth errors or safety blocks', () => {
    for (const err of [
      { status: 400, message: 'Invalid argument' },
      { status: 403, message: 'Permission denied' },
      new Error('Empty answer (finishReason=SAFETY)'),
      null,
      'boom',
    ]) {
      expect(isRetriableError(err), JSON.stringify(err)).toBe(false);
    }
  });
});
