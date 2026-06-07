#!/usr/bin/env node
/**
 * CLI: run a single agent against a room.
 *
 *   npx tsx agents/src/cli/run.ts <config.yaml> --room <CODE>
 *
 * The agent will:
 *   1. Load + validate the YAML config.
 *   2. Resolve the password (env / file / default).
 *   3. Sign into Supabase as that bot.
 *   4. Join the room if not already a member.
 *   5. Poll game state, decide via Brain, act via API — until game ends
 *      or you Ctrl-C.
 *
 * Required env vars (read from .env.local at the project root by default):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Optional:
 *   BOT_PASSWORD          — password for the bot account (default 'bot_password_dev_only')
 *   LOG_LEVEL             — pino log level (default 'info')
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAgentConfig } from '../config/loader.js';
import { makeLogger } from '../util/logger.js';
import { AgentEngine } from '../engine/AgentEngine.js';

interface ParsedOpts {
  room: string;
  envFile: string;
  baseUrl?: string;
}

function loadEnvFile(path: string): void {
  let body: string;
  try {
    body = readFileSync(resolve(path), 'utf8');
  } catch {
    // Allow not having an env file — caller may have populated env elsewhere.
    return;
  }
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (k && process.env[k] === undefined) {
      const v = (vRaw ?? '').replace(/^["']|["']$/g, '');
      process.env[k] = v;
    }
  }
}

async function main(): Promise<void> {
  const program = new Command()
    .name('run-agent')
    .description('Run a single playavalon agent against a room')
    .argument('<config>', 'path to the agent YAML config')
    .requiredOption('-r, --room <code>', 'room code to join')
    .option('-e, --env-file <path>', 'path to .env file (default ../.env.local relative to /agents)', '../.env.local')
    .option('-b, --base-url <url>', 'override the API base URL from the config');

  program.parse(process.argv);
  const opts = program.opts<ParsedOpts>();
  const [configPath] = program.args;

  if (!configPath) {
    console.error('config path is required');
    process.exit(1);
  }

  // Load env file BEFORE loading config (so credentials.password_env can resolve).
  loadEnvFile(opts.envFile);

  const config = loadAgentConfig(configPath);
  if (opts.baseUrl) {
    config.runtime.base_url = opts.baseUrl;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (env or env file)');
    process.exit(1);
  }

  const logger = makeLogger(config.name);
  logger.info('starting', {
    config: config.config_path,
    room: opts.room.toUpperCase(),
    base_url: config.runtime.base_url,
    brain: config.brain.type,
  });

  const engine = new AgentEngine({
    config,
    roomCode: opts.room.toUpperCase(),
    supabaseUrl,
    supabaseAnonKey,
    logger,
  });

  try {
    await engine.run();
    logger.info('done');
    process.exit(0);
  } catch (err) {
    logger.error('fatal', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
