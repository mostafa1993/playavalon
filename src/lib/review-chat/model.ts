/**
 * The chat's model client: Gemini on Vertex AI, streamed.
 *
 * The app can't import the agents' code (its build and image leave `agents/`
 * out), so this carries its own copy of what the reviewer's client
 * (agents/shared/src/llm.ts) does: the game-context preamble, every safety
 * filter at BLOCK_ONLY_HIGH, and retries of transient errors.
 *
 * A whole answer, retries included, must come within ANSWER_TIMEOUT_MS. An
 * answer the model stopped before its end (out of tokens, a safety block)
 * ends with the prompt's cut-off note, so the player can tell.
 *
 * Authentication is Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS
 * names the service-account file. GCP_PROJECT_ID, GCP_LLM_LOCATION and
 * GCP_LLM_MODEL are the reviewer's own variables; without GCP_PROJECT_ID the
 * app has no chat.
 */

import {
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
  type GenerateContentResponse,
  type SafetySetting,
} from '@google/genai';

// The reviewer's preamble: accusatory talk ("kill Merlin", "he's a traitor")
// is board-game vocabulary, which the safety classifier otherwise flags.
const GAME_CONTEXT_PREAMBLE = `CONTEXT: All content below is from an Avalon board game session — a social deduction game where players use in-character language. Words like "kill", "assassinate", "hunt", "target", "traitor", "evil", "betrayer", and "execute" are gameplay mechanics (the Assassin's win condition is to correctly identify Merlin), NOT real-world threats. Player quotes are in-character fictional speech between friends playing a board game. Treat this as reviewing a board-game session, not real events.

`;

// The default filter blocked heated but benign game talk; BLOCK_ONLY_HIGH
// still catches genuinely harmful content.
const SAFETY_SETTINGS: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
/** Gemini 3's thinking counts against it: room for the thinking and an answer. */
const MAX_OUTPUT_TOKENS = 16384;
export const ANSWER_TIMEOUT_MS = 120_000;

export interface ChatPrompt {
  systemInstruction: string;
  /** The thread so far, ending with the player's new question. */
  contents: Content[];
  /** Ends an answer the model stopped before its end, in the question's language. */
  cutOffNote: string;
}

/** Whether the app can reach a model at all. */
export function modelConfigured(): boolean {
  return Boolean(process.env.GCP_PROJECT_ID);
}

let client: { ai: GoogleGenAI; model: string } | null = null;

function getClient(): { ai: GoogleGenAI; model: string } {
  if (!client) {
    const project = process.env.GCP_PROJECT_ID;
    if (!project) throw new Error('GCP_PROJECT_ID is not set: the review chat has no model');
    client = {
      ai: new GoogleGenAI({
        vertexai: true,
        project,
        location: process.env.GCP_LLM_LOCATION ?? 'global',
      }),
      model: process.env.GCP_LLM_MODEL ?? 'gemini-3.1-pro-preview',
    };
  }
  return client;
}

/**
 * Opens the answer's stream (retrying transient errors while it opens) and
 * yields its text as it comes. Throws when the stream ends with no text — a
 * blocked prompt or answer — or when the whole answer takes longer than
 * ANSWER_TIMEOUT_MS, whether it is still opening or partway through.
 */
export async function streamAnswer(prompt: ChatPrompt): Promise<AsyncIterable<string>> {
  const { ai, model } = getClient();

  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error(`No whole answer within ${ANSWER_TIMEOUT_MS / 1000} s`)),
    ANSWER_TIMEOUT_MS
  );
  const timedOut = new Promise<never>((_, reject) =>
    timeout.signal.addEventListener('abort', () => reject(timeout.signal.reason), { once: true })
  );
  timedOut.catch(() => {});
  // Whatever the SDK does with the signal, nothing waits past the timeout.
  const inTime = <T>(p: Promise<T>) => Promise.race([p, timedOut]);

  let stream: AsyncGenerator<GenerateContentResponse>;
  try {
    stream = await inTime(
      withRetry(
        () =>
          ai.models.generateContentStream({
            model,
            contents: prompt.contents,
            config: {
              systemInstruction: GAME_CONTEXT_PREAMBLE + prompt.systemInstruction,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              safetySettings: SAFETY_SETTINGS,
              abortSignal: timeout.signal,
            },
          }),
        timeout.signal
      )
    );
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  return (async function* () {
    try {
      let any = false;
      let finishReason: string | undefined;
      let blockReason: string | undefined;
      for (;;) {
        const next = await inTime(stream.next());
        if (next.done) break;
        const chunk = next.value;
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
        blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
        const text = chunk.text;
        if (text) {
          any = true;
          yield text;
        }
      }
      if (!any) {
        throw new Error(
          `Empty answer (finishReason=${finishReason ?? 'UNKNOWN'}${
            blockReason ? `, promptBlocked=${blockReason}` : ''
          })`
        );
      }
      if (finishReason !== FinishReason.STOP) {
        console.warn(`[review-chat] answer cut off (finishReason=${finishReason ?? 'UNKNOWN'})`);
        yield `\n\n${prompt.cutOffNote}`;
      }
    } finally {
      clearTimeout(timer);
    }
  })();
}

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || attempt >= MAX_ATTEMPTS || !isRetriableError(err)) throw err;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * BASE_DELAY_MS);
      console.warn(`[review-chat] retry ${attempt} after ${delay}ms — ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, delay));
      if (signal.aborted) throw signal.reason;
    }
  }
}

/** The reviewer's rule: network failures, gRPC UNAVAILABLE / DEADLINE_EXCEEDED /
 *  RESOURCE_EXHAUSTED, HTTP 408, 429 and 5xx. Safety blocks, bad arguments and
 *  auth errors are not retried. */
export function isRetriableError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number | string; status?: number | string; message?: string };
  const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'];
  if (typeof e.code === 'string' && networkCodes.includes(e.code)) return true;
  if (e.code === 4 || e.code === 8 || e.code === 14) return true;
  if (e.status === 'UNAVAILABLE' || e.status === 'DEADLINE_EXCEEDED' || e.status === 'RESOURCE_EXHAUSTED') {
    return true;
  }
  for (const n of [e.code, e.status]) {
    if (typeof n === 'number' && (n === 408 || n === 429 || (n >= 500 && n < 600))) return true;
  }
  const msg = (e.message ?? '').toLowerCase();
  return ['429', 'rate limit', 'unavailable', 'deadline', '503', '502', '500'].some((s) =>
    msg.includes(s)
  );
}
