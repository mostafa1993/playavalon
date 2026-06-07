/**
 * Load + validate an agent YAML config from disk. Fails fast with a clear
 * error pointing at the file path on validation failure.
 *
 * Also resolves the agent's password according to credentials precedence:
 *   1. credentials.password         (inline; dev-only)
 *   2. credentials.password_file    (read file contents, trimmed)
 *   3. credentials.password_env     (env var; default 'BOT_PASSWORD')
 *   4. fallback: 'bot_password_dev_only'  (matches add-fake-players.ts)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { AgentConfigSchema, type AgentConfig } from './schema.js';

export interface ResolvedAgentConfig extends AgentConfig {
  /** Absolute path the config was loaded from — for diagnostics. */
  config_path: string;
  /** Resolved at load time so callers don't have to do the lookup. */
  resolved_password: string;
  /** Derived from name. */
  email: string;
}

export function loadAgentConfig(configPath: string): ResolvedAgentConfig {
  const absPath = resolve(configPath);
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new Error(`failed to read config file ${absPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`failed to parse YAML in ${absPath}: ${(err as Error).message}`);
  }

  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid agent config at ${absPath}:\n${issues}`);
  }

  const cfg = result.data;
  const resolved_password = resolvePassword(cfg, absPath);
  const email = `bot_${cfg.name}@playavalon.local`;

  return { ...cfg, config_path: absPath, resolved_password, email };
}

function resolvePassword(cfg: AgentConfig, configPath: string): string {
  if (cfg.credentials.password) {
    return cfg.credentials.password;
  }
  if (cfg.credentials.password_file) {
    const passFilePath = resolve(configPath, '..', cfg.credentials.password_file);
    try {
      return readFileSync(passFilePath, 'utf8').trim();
    } catch (err) {
      throw new Error(`failed to read password_file ${passFilePath}: ${(err as Error).message}`);
    }
  }
  const envVar = cfg.credentials.password_env;
  const envVal = process.env[envVar];
  if (envVal) return envVal;
  return 'bot_password_dev_only';
}
