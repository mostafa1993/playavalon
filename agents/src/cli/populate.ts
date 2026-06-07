#!/usr/bin/env node
/**
 * CLI: spawn multiple agents in one command.
 *
 *   npx tsx agents/src/cli/populate.ts --room <CODE> --bots alice,bob,charlie,diana
 *
 * Spawns one subprocess per bot (each running cli/run.ts). Their stdout is
 * piped through a labeled multiplexer so you see all agents' logs in one
 * terminal with a per-agent prefix. Ctrl-C cleanly propagates SIGTERM to
 * every child.
 *
 * Why subprocesses and not async loops in one process: see plan §4.
 * Each agent needs its own Supabase auth session + websocket; supabase-js's
 * setAuth is global per client, so two agents in one process is impossible.
 *
 * Required env (read from .env.local at the repo root by default):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import { Command } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ParsedOpts {
  room: string;
  bots: string;
  configsDir: string;
  envFile: string;
  baseUrl?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_CLI_PATH = resolve(__dirname, 'run.ts');

interface Child {
  name: string;
  proc: ChildProcess;
  exited: boolean;
  exitCode: number | null;
}

const COLORS = [
  '\x1b[34m', // blue
  '\x1b[32m', // green
  '\x1b[33m', // yellow
  '\x1b[35m', // magenta
  '\x1b[36m', // cyan
  '\x1b[91m', // bright red
  '\x1b[94m', // bright blue
  '\x1b[92m', // bright green
  '\x1b[95m', // bright magenta
];
const RESET = '\x1b[0m';
const TTY = Boolean(process.stdout.isTTY);
const colorFor = (i: number): string => (TTY ? COLORS[i % COLORS.length]! : '');
const reset = (): string => (TTY ? RESET : '');

function loadEnvFile(path: string): void {
  let body: string;
  try { body = readFileSync(resolve(path), 'utf8'); } catch { return; }
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      const v = (m[2] ?? '').replace(/^["']|["']$/g, '');
      process.env[m[1]] = v;
    }
  }
}

function pipeWithPrefix(stream: NodeJS.ReadableStream, name: string, color: string, target: NodeJS.WritableStream): void {
  let buffer = '';
  const prefix = `${color}[${name}]${reset()} `;
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';  // keep partial last line
    for (const line of lines) {
      target.write(prefix + line + '\n');
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) target.write(prefix + buffer + '\n');
  });
}

async function main(): Promise<void> {
  const program = new Command()
    .name('populate-agents')
    .description('Spawn multiple playavalon agents against a single room')
    .requiredOption('-r, --room <code>', 'room code to join')
    .requiredOption('-b, --bots <names>', 'comma-separated list of agent names (e.g. alice,bob,charlie)')
    .option('-c, --configs-dir <path>', 'directory containing <name>.yaml files', resolve(__dirname, '../../configs'))
    .option('-e, --env-file <path>', '.env file path (default ../.env.local relative to /agents)', '../.env.local')
    .option('--base-url <url>', 'override API base URL');

  program.parse(process.argv);
  const opts = program.opts<ParsedOpts>();
  loadEnvFile(opts.envFile);

  const botNames = opts.bots.split(',').map((s) => s.trim()).filter(Boolean);
  if (botNames.length === 0) {
    console.error('--bots must be a non-empty comma-separated list');
    process.exit(1);
  }

  console.error(`spawning ${botNames.length} agent(s) for room ${opts.room.toUpperCase()}...\n`);

  const children: Child[] = botNames.map((name, i) => {
    const configPath = resolve(opts.configsDir, `${name}.yaml`);
    const args = ['tsx', RUN_CLI_PATH, configPath, '--room', opts.room.toUpperCase(), '--env-file', opts.envFile];
    if (opts.baseUrl) args.push('--base-url', opts.baseUrl);
    const proc = spawn('npx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const color = colorFor(i);
    if (proc.stdout) pipeWithPrefix(proc.stdout, name, color, process.stdout);
    if (proc.stderr) pipeWithPrefix(proc.stderr, name, color, process.stderr);
    const child: Child = { name, proc, exited: false, exitCode: null };
    proc.on('exit', (code) => {
      child.exited = true;
      child.exitCode = code;
      console.error(`${color}[${name}]${reset()} exited (code=${code})`);
    });
    return child;
  });

  // SIGINT/SIGTERM → propagate SIGTERM to all children, give them 5s, then SIGKILL.
  let shuttingDown = false;
  const shutdown = (sig: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\ngot ${sig}, signaling children to exit...`);
    for (const c of children) {
      if (!c.exited) {
        try { c.proc.kill('SIGTERM'); } catch { /* already dead */ }
      }
    }
    setTimeout(() => {
      for (const c of children) {
        if (!c.exited) {
          console.error(`${c.name}: did not exit in time; SIGKILL`);
          try { c.proc.kill('SIGKILL'); } catch { /* no-op */ }
        }
      }
      process.exit(1);
    }, 5000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Wait for all children to exit.
  await new Promise<void>((resolveAll) => {
    const check = (): void => {
      if (children.every((c) => c.exited)) resolveAll();
    };
    for (const c of children) c.proc.on('exit', check);
    check();
  });
  const failures = children.filter((c) => c.exitCode !== 0);
  if (failures.length > 0) {
    console.error(`\n${failures.length}/${children.length} agent(s) exited with non-zero status`);
    process.exit(1);
  }
  console.error('\nall agents exited cleanly');
  process.exit(0);
}

main().catch((err) => {
  console.error('populate fatal:', err);
  process.exit(1);
});
