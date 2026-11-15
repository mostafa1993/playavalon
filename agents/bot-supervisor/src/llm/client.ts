/**
 * Bot-side LLM client factory — env-configured Gemini via @avalon/shared.
 * Used by the LLMBrain (decisions) and the speech generator (the mouth).
 * Returns null when the env isn't configured (callers degrade gracefully).
 *
 * Every bot prompt names its own model (Gemini 4 Carbon to think, Hydrogen to
 * act), so there is no default model here. Gemini 4 is served on `global`,
 * `us` and `eu`.
 */

import { createLLMClient, type LLMClient } from '@avalon/shared';

export function createBotLLM(): LLMClient | null {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) return null;
  return createLLMClient({
    project,
    location: process.env.GCP_LLM_LOCATION || 'global',
    promptsDir: process.env.BOT_PROMPTS_DIR || './prompts',
    retry: { maxAttempts: 2, baseDelayMs: 400 },
  });
}
