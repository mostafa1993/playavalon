/**
 * Bot-side LLM client factory — env-configured Gemini via @avalon/shared.
 * Used by the LLMBrain (decisions) and the speech generator (the mouth).
 * Returns null when the env isn't configured (callers degrade gracefully).
 */

import { createLLMClient, type LLMClient } from '@avalon/shared';

export function createBotLLM(): LLMClient | null {
  const project = process.env.GCP_PROJECT_ID;
  if (!project) return null;
  return createLLMClient({
    project,
    location: process.env.GCP_LLM_LOCATION || 'us-central1',
    model: process.env.GCP_LLM_MODEL || 'gemini-3.1-pro-preview',
    promptsDir: process.env.BOT_PROMPTS_DIR || './prompts',
    retry: { maxAttempts: 2, baseDelayMs: 400 },
  });
}
