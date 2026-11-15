/**
 * Thin Gemini (Vertex AI) wrapper.
 *
 * The agent never uses raw model calls — everything goes through a YAML
 * prompt file. This module loads the file, fills its template vars,
 * and invokes Gemini with the configured defaults.
 *
 * Uses the unified @google/genai SDK in Vertex AI mode. Authentication is
 * via Application Default Credentials; set GOOGLE_APPLICATION_CREDENTIALS
 * to a service-account JSON path, or rely on the GCE/Workload Identity
 * metadata server in production.
 */

import {
  FinishReason,
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  ThinkingLevel,
  type SafetySetting,
  type ThinkingConfig,
} from '@google/genai';
import fs from 'node:fs';
import { loadPrompt, fill, type PromptFile, type ThinkingLevelName } from './prompts.js';
import { isNetworkError, retry } from './retry.js';

// Prepended to every system prompt. Clarifies to Gemini that accusatory
// language ("kill Merlin", "he's a traitor") is gameplay vocabulary from a
// bounded board-game domain, not real-world violence. Reduces false
// positives from the safety classifier.
const GAME_CONTEXT_PREAMBLE = `CONTEXT: All content below is from an Avalon board game session — a social deduction game where players use in-character language. Words like "kill", "assassinate", "hunt", "target", "traitor", "evil", "betrayer", and "execute" are gameplay mechanics (the Assassin's win condition is to correctly identify Merlin), NOT real-world threats. Player quotes are in-character fictional speech between friends playing a board game. Treat this as reviewing a board-game session, not real events.

`;

// Backstop against the default Gemini safety filter over-triggering on
// heated but benign in-game accusations. BLOCK_ONLY_HIGH still catches
// genuinely harmful content while passing through adversarial gameplay.
const SAFETY_SETTINGS: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export interface LLMClient {
  /** Run a prompt file, substituting `{{var}}` placeholders, return the raw text. */
  runText: (promptFile: string, vars: PromptVars, override?: ModelOverride) => Promise<string>;
  /** Run a prompt file whose response_mime_type is application/json, return parsed JSON. */
  runJson: <T = unknown>(promptFile: string, vars: PromptVars, override?: ModelOverride) => Promise<T>;
  /**
   * Run a text prompt and yield its answer as it is written. Not retried: the
   * caller decides what a slow or failed stream means. `signal` aborts it.
   */
  streamText: (promptFile: string, vars: PromptVars, override?: ModelOverride, signal?: AbortSignal) => AsyncGenerator<string>;
}

/**
 * Run a prompt otherwise than its file says: on another model and thinking
 * level (e.g. a faster fallback), and/or with another deadline.
 */
export interface ModelOverride {
  model?: string;
  thinking_level?: ThinkingLevelName;
  timeout_seconds?: number;
}

/** The prompt file as this call runs it. */
function withOverride(loaded: PromptFile, override?: ModelOverride): PromptFile {
  if (!override) return loaded;
  const onModel: PromptFile = override.model
    ? { ...loaded, model: override.model, thinking_level: override.thinking_level, thinking_budget: undefined, temperature: undefined }
    : override.thinking_level
      ? { ...loaded, thinking_level: override.thinking_level, thinking_budget: undefined }
      : loaded;
  return override.timeout_seconds ? { ...onModel, timeout_seconds: override.timeout_seconds } : onModel;
}

/**
 * With LLM_DUMP_FILE set, every answered call is appended to that file as a
 * JSON line (prompt, model, level, seconds, the filled prompts, the answer):
 * the record that measurements replay.
 */
function dump(entry: {
  prompt: string;
  model: string;
  level?: string;
  ms: number;
  system: string;
  user: string;
  output: string;
  usage?: { input?: number; output?: number; thoughts?: number };
}): void {
  const file = process.env.LLM_DUMP_FILE;
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch (err) {
    console.warn(`[llm] could not record the call: ${(err as Error).message}`);
  }
}

export type PromptVars = Record<string, string | number | null | undefined>;

/** Decoupled client options (the consumer maps its own config onto these). */
export interface LLMClientOptions {
  /** GCP project / Vertex location. */
  project: string;
  location: string;
  /** The model for prompts that don't name one; without it, every prompt must. */
  model?: string;
  /** Directory holding the YAML prompt files. */
  promptsDir: string;
  retry?: {
    maxAttempts?: number;
    baseDelayMs?: number;
  };
}

export function createLLMClient(opts: LLMClientOptions): LLMClient {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: opts.project,
    location: opts.location,
  });

  /**
   * A Gemini 4 call that runs out of output tokens (its thinking past the cap,
   * seen on a whole game's record) is asked once more a thinking level lower,
   * HIGH → MEDIUM → LOW, rather than failing.
   */
  const invoke = async (promptFile: string, vars: PromptVars, override?: ModelOverride): Promise<string> => {
    try {
      return await invokeOnce(promptFile, vars, override);
    } catch (err) {
      const lower = err instanceof OutOfTokensError && isGemini4(err.model) ? lowerThinkingLevel(err.level) : null;
      if (!lower || !(err instanceof OutOfTokensError)) throw err;
      console.warn(`[llm] ${promptFile} ran out of tokens on ${err.model} ${err.level}; asking once more on ${lower}`);
      return invoke(promptFile, vars, { model: err.model, thinking_level: lower });
    }
  };

  /** The call as a prompt file and its vars make it. */
  const prepare = async (promptFile: string, vars: PromptVars, override?: ModelOverride) => {
    const prompt = withOverride(await loadPrompt(opts.promptsDir, promptFile), override);
    const modelName = prompt.model ?? opts.model;
    if (!modelName) throw new Error(`${promptFile} names no model, and the client has no default`);
    const systemText = GAME_CONTEXT_PREAMBLE + fill(prompt.system, vars);
    const userText = fill(prompt.user, vars);
    const timeoutSeconds = prompt.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
    const config = {
      systemInstruction: systemText,
      ...samplingFor(promptFile, modelName, prompt),
      maxOutputTokens: prompt.max_output_tokens ?? 4096,
      safetySettings: SAFETY_SETTINGS,
      ...(prompt.response_mime_type ? { responseMimeType: prompt.response_mime_type } : {}),
    };
    return { prompt, modelName, systemText, userText, timeoutSeconds, config };
  };

  const invokeOnce = async (promptFile: string, vars: PromptVars, override?: ModelOverride): Promise<string> => {
    const { prompt, modelName, systemText, userText, timeoutSeconds, config } = await prepare(promptFile, vars, override);

    return retry(
      async () => {
        const started = Date.now();
        let res;
        try {
          res = await ai.models.generateContent({
            model: modelName,
            contents: userText,
            config: { ...config, abortSignal: AbortSignal.timeout(timeoutSeconds * 1000) },
          });
        } catch (err) {
          if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            // Retried as a transient error ("deadline" in the message).
            throw new Error(`LLM call for ${promptFile} passed its deadline of ${timeoutSeconds} s`);
          }
          throw err;
        }

        const text = res.text;
        if (res.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) {
          // Cut off (or empty) at the output cap: a truncated answer is no answer.
          throw new OutOfTokensError(promptFile, modelName, prompt.thinking_level);
        }
        if (typeof text !== 'string' || text.length === 0) {
          const candidate = res.candidates?.[0];
          const finishReason = candidate?.finishReason ?? 'UNKNOWN';
          const blockReason = res.promptFeedback?.blockReason;
          throw new Error(
            `LLM returned empty response for prompt ${promptFile} (finishReason=${finishReason}${
              blockReason ? `, promptBlocked=${blockReason}` : ''
            })`
          );
        }
        dump({
          prompt: promptFile, model: modelName, level: prompt.thinking_level, ms: Date.now() - started,
          system: systemText, user: userText, output: text, usage: usageOf(res.usageMetadata),
        });
        return text;
      },
      {
        maxAttempts: opts.retry?.maxAttempts,
        baseDelayMs: opts.retry?.baseDelayMs,
        shouldRetry: (err) => isRetriableLlmError(err),
        onRetry: (err, attempt, delayMs) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[llm] retry ${attempt} on ${promptFile} after ${delayMs}ms — ${msg}`);
        },
      }
    );
  };

  async function* streamText(promptFile: string, vars: PromptVars, override?: ModelOverride, signal?: AbortSignal): AsyncGenerator<string> {
    const { prompt, modelName, systemText, userText, timeoutSeconds, config } = await prepare(promptFile, vars, override);
    const deadline = AbortSignal.timeout(timeoutSeconds * 1000);
    const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const started = Date.now();
    let output = '';
    let usage: ReturnType<typeof usageOf>;
    try {
      const chunks = await ai.models.generateContentStream({ model: modelName, contents: userText, config: { ...config, abortSignal } });
      for await (const chunk of chunks) {
        if (chunk.usageMetadata) usage = usageOf(chunk.usageMetadata);
        if (chunk.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS) {
          throw new OutOfTokensError(promptFile, modelName, prompt.thinking_level);
        }
        const text = chunk.text;
        if (text) {
          output += text;
          yield text;
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error(
          deadline.aborted
            ? `LLM call for ${promptFile} passed its deadline of ${timeoutSeconds} s`
            : `LLM call for ${promptFile} was stopped`
        );
      }
      throw err;
    }
    if (!output) throw new Error(`LLM returned an empty stream for prompt ${promptFile}`);
    dump({ prompt: promptFile, model: modelName, level: prompt.thinking_level, ms: Date.now() - started, system: systemText, user: userText, output, usage });
  }

  return {
    streamText,
    runText: invoke,
    async runJson<T = unknown>(promptFile: string, vars: PromptVars, override?: ModelOverride): Promise<T> {
      const text = await invoke(promptFile, vars, override);
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw new Error(
          `LLM ${promptFile} returned invalid JSON (first 200 chars: ${text.slice(0, 200)}): ${(err as Error).message}`
        );
      }
    },
  };
}

/** A call's token counts, for the call record. */
function usageOf(u: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined) {
  return u ? { input: u.promptTokenCount, output: u.candidatesTokenCount, thoughts: u.thoughtsTokenCount } : undefined;
}

/** How long one model call may take, unless its prompt says otherwise. */
const DEFAULT_TIMEOUT_SECONDS = 600;

/** A call whose answer hit its output cap: empty, or cut off. */
export class OutOfTokensError extends Error {
  constructor(
    readonly promptFile: string,
    readonly model: string,
    readonly level: ThinkingLevelName | undefined
  ) {
    super(`LLM ran out of output tokens for prompt ${promptFile} (finishReason=MAX_TOKENS)`);
  }
}

/** The next thinking level down, or null at LOW (or with no level). */
export function lowerThinkingLevel(level: ThinkingLevelName | undefined): ThinkingLevelName | null {
  if (level === 'HIGH') return 'MEDIUM';
  if (level === 'MEDIUM') return 'LOW';
  return null;
}

/** A Gemini 4 model (gemini-4-argon, -carbon, -hydrogen, …). */
export function isGemini4(model: string): boolean {
  return model.startsWith('gemini-4');
}

/**
 * Temperature and thinking for one call. Gemini 4 refuses `thinking_budget`
 * (HTTP 400) and ignores `temperature`, so a Gemini 4 prompt carrying either
 * is refused here, where the mistake is named, rather than at the API.
 */
export function samplingFor(
  promptFile: string,
  model: string,
  prompt: Pick<PromptFile, 'temperature' | 'thinking_budget' | 'thinking_level'>
): { temperature?: number; thinkingConfig?: ThinkingConfig } {
  if (isGemini4(model)) {
    if (prompt.thinking_budget !== undefined) {
      throw new Error(`${promptFile}: ${model} takes thinking_level, not thinking_budget`);
    }
    if (prompt.temperature !== undefined) {
      throw new Error(`${promptFile}: ${model} ignores temperature; remove it from the prompt`);
    }
  }
  const thinkingConfig: ThinkingConfig | undefined =
    prompt.thinking_level !== undefined
      ? { thinkingLevel: ThinkingLevel[prompt.thinking_level] }
      : prompt.thinking_budget !== undefined
        ? { thinkingBudget: prompt.thinking_budget }
        : undefined;
  return {
    ...(isGemini4(model) ? {} : { temperature: prompt.temperature ?? 0.4 }),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };
}

/**
 * Decide whether a Gemini API error is worth retrying.
 *
 * The @google/genai SDK surfaces:
 *   - HTTP-style errors with numeric `code` (408/429/5xx),
 *   - gRPC status numbers/strings (UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED),
 *   - plain Errors whose message contains 429/503/"unavailable" etc.
 *
 * Anything else (safety block, invalid arg, auth) is non-transient.
 */
function isRetriableLlmError(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  if (!err || typeof err !== 'object') return false;

  const e = err as { code?: number | string; status?: string; message?: string };

  // gRPC status codes (numeric or string)
  if (e.code === 4 || e.code === 8 || e.code === 14) return true;
  if (e.status === 'UNAVAILABLE' || e.status === 'DEADLINE_EXCEEDED' || e.status === 'RESOURCE_EXHAUSTED') {
    return true;
  }

  // HTTP-shaped errors from the SDK
  if (typeof e.code === 'number') {
    if (e.code === 408 || e.code === 429 || (e.code >= 500 && e.code < 600)) return true;
  }

  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('unavailable') ||
    msg.includes('deadline') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500')
  );
}
