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
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
  type SafetySetting,
} from '@google/genai';
import type { AgentConfig } from '../config.js';
import { loadPrompt, fill } from './prompts.js';
import { isNetworkError, retry } from '../util/retry.js';

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
  runText: (promptFile: string, vars: PromptVars) => Promise<string>;
  /** Run a prompt file whose response_mime_type is application/json, return parsed JSON. */
  runJson: <T = unknown>(promptFile: string, vars: PromptVars) => Promise<T>;
}

export type PromptVars = Record<string, string | number | null | undefined>;

export function createLLMClient(config: AgentConfig): LLMClient {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: config.gemini.project,
    location: config.gemini.location,
  });

  const invoke = async (promptFile: string, vars: PromptVars): Promise<string> => {
    const prompt = await loadPrompt(config.storage.promptsDir, promptFile);
    const systemText = GAME_CONTEXT_PREAMBLE + fill(prompt.system, vars);
    const userText = fill(prompt.user, vars);

    const modelName = prompt.model ?? config.gemini.model;
    const temperature = prompt.temperature ?? 0.4;
    const maxOutputTokens = prompt.max_output_tokens ?? 4096;
    const responseMimeType = prompt.response_mime_type;

    return retry(
      async () => {
        const res = await ai.models.generateContent({
          model: modelName,
          contents: userText,
          config: {
            systemInstruction: systemText,
            temperature,
            maxOutputTokens,
            safetySettings: SAFETY_SETTINGS,
            ...(responseMimeType ? { responseMimeType } : {}),
          },
        });

        const text = res.text;
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
        return text;
      },
      {
        maxAttempts: config.retry.maxAttempts,
        baseDelayMs: config.retry.baseDelayMs,
        shouldRetry: (err) => isRetriableLlmError(err),
        onRetry: (err, attempt, delayMs) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[llm] retry ${attempt} on ${promptFile} after ${delayMs}ms — ${msg}`);
        },
      }
    );
  };

  return {
    runText: invoke,
    async runJson<T = unknown>(promptFile: string, vars: PromptVars): Promise<T> {
      const text = await invoke(promptFile, vars);
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
