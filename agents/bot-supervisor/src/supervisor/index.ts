#!/usr/bin/env node
/**
 * Bot supervisor — long-running service that watches the rooms table for
 * games that opted in to bot fill-in (`rooms.agent_count > 0`) and spawns
 * the matching agent processes.
 *
 *   - Polls rooms table every POLL_INTERVAL_MS.
 *   - For each `status='waiting'` room with `agent_count > 0`, checks if
 *     enough bot processes are already spawned. If not, spawns more.
 *   - Spawned children use the existing cli/run.ts (one process per agent,
 *     per plan §4 — supabase-js auth is global per client).
 *   - Picks bots by the `order` field in each agents/bot-supervisor/configs/<name>.yaml.
 *     Lower order = picked first; alphabetical name tie-breaks.
 *   - On room transition out of 'waiting' (game starts, room closes, etc.)
 *     the supervisor doesn't kill the bots — they're playing the game and
 *     handle their own exit via game_over detection.
 *   - Crash-restart policy: per-(room, agent) counter. Up to 3 restarts;
 *     after that, log + give up for that slot.
 *   - SIGINT/SIGTERM → kills all child processes, exits cleanly.
 *
 * The supervisor is intentionally idempotent on restart: it re-discovers
 * which bots are already in each room (via room_players.is_bot), and only
 * spawns whatever's missing.
 *
 * Smart bots (`mode: smart`) share one set of ears per room: the supervisor
 * starts the room's ears process (cli/ears.ts) with its first smart bot and
 * stops it when the last one is done, and relays what it hears, and each
 * bot's own words, to the room's smart bots over IPC (roomRelay.ts).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { makeLogger } from '../util/logger.js';
import { ensureBot } from '../util/credentials.js';
import { RoomRelay, type FromBot, type Heard, type ToBot } from './roomRelay.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_CLI_PATH = resolve(__dirname, '..', 'cli', 'run.ts');
const EARS_CLI_PATH = resolve(__dirname, '..', 'cli', 'ears.ts');
/** agents/bot-supervisor: children start here, where `--import tsx` resolves. */
const PACKAGE_DIR = resolve(__dirname, '..', '..');

/** Relay to a child over IPC; a child that has just exited is logged, never fatal. */
function sendTo(proc: ChildProcess, message: ToBot, who: string): void {
  if (!proc.connected) return;
  proc.send(message, (err) => {
    if (err) log.warn(`relay to ${who} failed: ${err.message}`);
  });
}
const CONFIGS_DIR = process.env.AGENTS_CONFIGS_DIR || resolve(__dirname, '..', '..', 'configs');
const ENV_FILE = process.env.AGENTS_ENV_FILE || resolve(__dirname, '..', '..', '..', '..', '.env');
const POLL_INTERVAL_MS = Number(process.env.SUPERVISOR_POLL_MS || 5000);
const MAX_RESTARTS_PER_AGENT = Number(process.env.SUPERVISOR_MAX_RESTARTS || 3);

const log = makeLogger('supervisor');

interface AgentConfigSummary {
  name: string;
  username: string;
  order: number;
  path: string;
  /** `mode: smart` — the LLM brain, with a voice and the room's shared ears. */
  smart: boolean;
}

interface SpawnedAgent {
  roomCode: string;
  username: string;
  proc: ChildProcess;
  restartCount: number;
}

// In-memory tracking: key = `${roomCode}:${username}`
const spawned = new Map<string, SpawnedAgent>();

function loadEnvFile(path: string): void {
  let body: string;
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
    }
  }
}

/** Load every YAML in configs/ and return a sorted-by-order list. */
function loadConfigSummaries(): AgentConfigSummary[] {
  let files: string[];
  try {
    files = readdirSync(CONFIGS_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch (err) {
    log.error(`could not read configs dir ${CONFIGS_DIR}`, err);
    return [];
  }
  const summaries: AgentConfigSummary[] = [];
  for (const f of files) {
    const path = resolve(CONFIGS_DIR, f);
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = yaml.load(raw) as { name?: string; order?: number; mode?: string };
      if (!parsed?.name) continue;
      summaries.push({
        name: parsed.name,
        username: `bot_${parsed.name}`,
        order: typeof parsed.order === 'number' ? parsed.order : 99,
        path,
        smart: parsed.mode === 'smart',
      });
    } catch (err) {
      log.warn(`skipping invalid config ${basename(path)}`, { error: (err as Error).message });
    }
  }
  return summaries.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function spawnAgent(roomCode: string, cfg: AgentConfigSummary, restartCount: number): SpawnedAgent {
  log.info(`spawning agent ${cfg.username} for room ${roomCode}` + (restartCount > 0 ? ` (restart ${restartCount})` : ''));
  // Children inherit the supervisor's full env via spawn's `env: process.env`.
  // We do NOT pass `--env-file` here:
  //   - In Docker, no .env file exists on disk (docker-compose populates env
  //     vars at startup; the supervisor inherits, children inherit again).
  //   - In local dev, the supervisor's own loadEnvFile() at startup populates
  //     process.env, which children inherit.
  // We DID pass --env-file before, and it broke in Docker because Node 20.6+
  // treats `--env-file <path>` as a native fatal flag — exit code 9 when the
  // path doesn't exist.
  const args = ['--import', 'tsx', RUN_CLI_PATH, cfg.path, '--room', roomCode];
  // Forward AGENT_BASE_URL if set (used in docker-compose to point children
  // at the in-network http://app:3000 instead of the public URL).
  if (process.env.AGENT_BASE_URL) {
    args.push('--base-url', process.env.AGENT_BASE_URL);
  }
  // A direct node child (not through npx) so the IPC channel reaches it, started
  // in this package's folder, from which `--import tsx` resolves.
  const proc = spawn(process.execPath, args, {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: process.env,
    cwd: PACKAGE_DIR,
  });
  // A send to a child that has just exited fails (EPIPE) on the ChildProcess;
  // unheard, that error would end the supervisor and every bot it runs.
  proc.on('error', (err) => log.warn(`agent ${cfg.username} (room ${roomCode}): ${err.message}`));
  const key = `${roomCode}:${cfg.username}`;
  const tracked: SpawnedAgent = { roomCode, username: cfg.username, proc, restartCount };
  spawned.set(key, tracked);
  if (cfg.smart) {
    const room = roomHearing(roomCode);
    room.relay.addBot(cfg.username, { send: (m: ToBot) => sendTo(proc, m, cfg.username) });
    proc.on('message', (m) => room.relay.fromBot(cfg.username, m as FromBot));
  }

  proc.on('exit', (code) => {
    log.info(`agent ${cfg.username} (room ${roomCode}) exited code=${code}`);
    spawned.delete(key);
    if (cfg.smart) hearing.get(roomCode)?.relay.removeBot(cfg.username);
    // Restart only on abnormal exits AND under the retry cap. Code 0 = the
    // agent saw game_over and exited cleanly; that's its job, don't restart.
    if (code !== 0 && tracked.restartCount < MAX_RESTARTS_PER_AGENT) {
      const next = tracked.restartCount + 1;
      log.warn(`agent ${cfg.username} crashed; scheduling restart ${next}/${MAX_RESTARTS_PER_AGENT}`);
      setTimeout(() => {
        // Only restart if we haven't been told to shut down.
        if (shuttingDown) return;
        spawnAgent(roomCode, cfg, next);
      }, 2000);
    } else if (code !== 0) {
      log.error(`agent ${cfg.username} for room ${roomCode} crashed ${MAX_RESTARTS_PER_AGENT} times; giving up`);
    }
    if (cfg.smart) stopEarsIfDone(roomCode);
  });

  return tracked;
}

/** One room's shared hearing: the relay and its ears process. */
interface RoomHearing {
  relay: RoomRelay;
  ears: ChildProcess | null;
  earsRestarts: number;
}
const hearing = new Map<string, RoomHearing>();

/** The room's hearing, starting its ears with the room's first smart bot. */
function roomHearing(roomCode: string): RoomHearing {
  let room = hearing.get(roomCode);
  if (!room) {
    room = { relay: new RoomRelay(), ears: null, earsRestarts: 0 };
    hearing.set(roomCode, room);
    startEars(roomCode, room);
  }
  return room;
}

function startEars(roomCode: string, room: RoomHearing): void {
  log.info(`starting the ears for room ${roomCode}`);
  const proc = spawn(process.execPath, ['--import', 'tsx', EARS_CLI_PATH, '--room', roomCode], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: process.env,
    cwd: PACKAGE_DIR,
  });
  proc.on('error', (err) => log.warn(`the ears for room ${roomCode}: ${err.message}`));
  room.ears = proc;
  proc.on('message', (m) => room.relay.fromEars(m as Heard));
  proc.on('exit', (code) => {
    if (room.ears === proc) room.ears = null;
    if (hearing.get(roomCode) !== room || shuttingDown || code === 0) return;
    if (room.earsRestarts >= MAX_RESTARTS_PER_AGENT) {
      log.error(`the ears for room ${roomCode} crashed ${MAX_RESTARTS_PER_AGENT} times; the smart bots there are deaf`);
      return;
    }
    room.earsRestarts += 1;
    log.warn(`the ears for room ${roomCode} crashed (code ${code}); restart ${room.earsRestarts}/${MAX_RESTARTS_PER_AGENT}`);
    setTimeout(() => {
      if (hearing.get(roomCode) === room && !shuttingDown) startEars(roomCode, room);
    }, 2000);
  });
}

/** When no smart bot of the room is running or about to restart, stop its ears. */
function stopEarsIfDone(roomCode: string): void {
  // A crashed bot restarts after 2 s: look again after that.
  setTimeout(() => {
    const room = hearing.get(roomCode);
    if (!room || room.relay.botCount > 0) return;
    hearing.delete(roomCode);
    log.info(`no smart bot left in room ${roomCode}; stopping its ears`);
    room.ears?.kill('SIGTERM');
  }, 3000);
}

async function reconcileOnce(supabase: SupabaseClient, configs: AgentConfigSummary[]): Promise<void> {
  // Find rooms that opted in and are still waiting for the manager to distribute.
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id, code, agent_count, expected_players')
    .gt('agent_count', 0)
    .eq('status', 'waiting');
  if (error) {
    log.error('failed to query rooms', error);
    return;
  }
  if (!rooms || rooms.length === 0) return;

  for (const room of rooms) {
    // How many bots are already in the room (joined via the engine)?
    const { count: alreadyJoined, error: cntErr } = await supabase
      .from('room_players')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .eq('is_bot', true);
    if (cntErr) {
      log.error(`room ${room.code}: failed to count is_bot players`, cntErr);
      continue;
    }
    const inFlight = Array.from(spawned.values()).filter((s) => s.roomCode === room.code).length;
    const covered = (alreadyJoined ?? 0) + inFlight;
    const needed = room.agent_count - covered;
    if (needed <= 0) continue;

    // Pick the next N config slots whose username isn't already in this room AND
    // isn't currently in-flight for this room.
    const alreadyUsernames = await getRoomBotUsernames(supabase, room.id);
    const inFlightUsernames = new Set(
      Array.from(spawned.values()).filter((s) => s.roomCode === room.code).map((s) => s.username),
    );
    const exclude = new Set([...alreadyUsernames, ...inFlightUsernames]);
    const eligible = configs.filter((c) => !exclude.has(c.username));
    const toSpawn = eligible.slice(0, needed);

    if (toSpawn.length < needed) {
      log.warn(`room ${room.code}: wanted ${needed} bots but only ${toSpawn.length} configs available (pool exhausted?)`);
    }

    for (const cfg of toSpawn) {
      spawnAgent(room.code, cfg, 0);
    }
  }
}

async function getRoomBotUsernames(supabase: SupabaseClient, roomId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('room_players')
    .select('players!inner(username)')
    .eq('room_id', roomId)
    .eq('is_bot', true);
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ players: { username: string } | { username: string }[] }>) {
    const u = Array.isArray(row.players) ? row.players[0]?.username : row.players?.username;
    if (u) set.add(u);
  }
  return set;
}

let shuttingDown = false;
function shutdown(sig: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`got ${sig}, killing ${spawned.size} child agent(s)`);
  for (const s of spawned.values()) {
    try { s.proc.kill('SIGTERM'); } catch { /* noop */ }
  }
  for (const room of hearing.values()) {
    try { room.ears?.kill('SIGTERM'); } catch { /* noop */ }
  }
  setTimeout(() => {
    for (const s of spawned.values()) {
      try { s.proc.kill('SIGKILL'); } catch { /* noop */ }
    }
    process.exit(0);
  }, 5000);
}

async function main(): Promise<void> {
  loadEnvFile(ENV_FILE);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    log.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, {
    realtime: { transport: WebSocket as unknown as never },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const configs = loadConfigSummaries();
  log.info(`supervisor starting`, {
    poll_interval_ms: POLL_INTERVAL_MS,
    config_pool_size: configs.length,
    configs: configs.map((c) => c.name).join(','),
  });

  // Self-bootstrap: ensure every config has a Supabase Auth account + players
  // row. ensureBot() is idempotent — for existing accounts it's a no-op lookup;
  // for new YAMLs the supervisor self-provisions on startup. Failures here are
  // logged but non-fatal so a single broken account doesn't keep the
  // supervisor from doing its job for the rest.
  for (const cfg of configs) {
    try {
      const identity = await ensureBot(supabase, { name: cfg.name });
      log.info(`bot account ready: ${identity.username} (${identity.id})`);
    } catch (err) {
      log.error(`ensureBot(${cfg.name}) failed — agent will not be spawnable until fixed`, err);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (!shuttingDown) {
    try {
      await reconcileOnce(supabase, configs);
    } catch (err) {
      log.error('reconcile cycle failed', err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  log.error('supervisor fatal', err);
  process.exit(1);
});
