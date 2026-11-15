/**
 * YAML prompt loader + template filler.
 *
 * Each prompt file under `agents/reviewer/prompts/` has the shape:
 *
 *   name: <id>
 *   model: <optional override; falls back to agent default>
 *   temperature: <float>
 *   max_output_tokens: <int>
 *   response_mime_type: application/json | text/plain
 *   system: |
 *     <instructions>
 *   user: |
 *     <template with {{placeholders}}>
 *
 * Prompts are loaded once on first use and cached in-process. Because the
 * Docker image mounts `prompts/` read-only, edits to a running container
 * require a restart — intentional to avoid reading half-written files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

export interface PromptFile {
  name: string;
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  /**
   * Thinking-model reasoning cap (Gemini 3.x). These models spend output
   * tokens on internal reasoning BEFORE the visible text — left unbounded on a
   * long prompt the thinking can consume the entire max_output_tokens budget,
   * yielding an empty response with finishReason=MAX_TOKENS. Setting this caps
   * reasoning so visible output is always reachable. 0 disables thinking.
   */
  thinking_budget?: number;
  /**
   * Gemini 4's reasoning control (LOW, MEDIUM, HIGH), in place of
   * `thinking_budget`, which Gemini 4 refuses (HTTP 400). Gemini 4 also
   * ignores `temperature`; the client refuses either in a Gemini 4 prompt.
   */
  thinking_level?: ThinkingLevelName;
  /**
   * How long one call may take before it is given up (and retried as a
   * timeout). Default 600. A call with no deadline once hung a smart bot's
   * private read for the rest of a game.
   */
  timeout_seconds?: number;
  response_mime_type?: 'application/json' | 'text/plain';
  system: string;
  user: string;
}

export const THINKING_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

const cache = new Map<string, PromptFile>();

export async function loadPrompt(promptsDir: string, fileName: string): Promise<PromptFile> {
  const fullPath = path.join(promptsDir, fileName);
  const cached = cache.get(fullPath);
  if (cached) return cached;

  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = yaml.load(raw);
  if (!isPromptFile(parsed)) {
    throw new Error(`Invalid prompt file ${fileName}: missing required 'system' or 'user' fields`);
  }
  if (parsed.thinking_level !== undefined && !THINKING_LEVELS.includes(parsed.thinking_level)) {
    throw new Error(`Invalid prompt file ${fileName}: thinking_level must be one of ${THINKING_LEVELS.join(', ')}`);
  }
  if (parsed.thinking_level !== undefined && parsed.thinking_budget !== undefined) {
    throw new Error(`Invalid prompt file ${fileName}: set thinking_level or thinking_budget, not both`);
  }

  cache.set(fullPath, parsed);
  return parsed;
}

/**
 * Replace {{var}} placeholders in a template. Missing vars are kept as
 * `{{var}}` so they surface loudly in the LLM output instead of silently
 * turning into empty strings.
 */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return match;
    return String(v);
  });
}

function isPromptFile(x: unknown): x is PromptFile {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<PromptFile>;
  return typeof p.name === 'string' && typeof p.system === 'string' && typeof p.user === 'string';
}
