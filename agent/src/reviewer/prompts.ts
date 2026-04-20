/**
 * YAML prompt loader + template filler.
 *
 * Each prompt file under `agent/prompts/` has the shape:
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
  response_mime_type?: 'application/json' | 'text/plain';
  system: string;
  user: string;
}

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
