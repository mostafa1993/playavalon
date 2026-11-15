/**
 * Replay stored games through the reviewer's pipeline, every step after
 * speech-to-text.
 *
 *   npm run replay -- --export <export.json> --folders <dir> --games <id,id,…>
 *     --out <dir> [--runs N] [--mode god|blind] [--concurrency N]
 *
 * Each run goes to <out>/<gameId>/<mode>/run-<k>/ (k = 1…N), which must not
 * hold anything yet. Needs Vertex AI: GCP_PROJECT_ID, GCP_LLM_LOCATION (global)
 * and GOOGLE_APPLICATION_CREDENTIALS;
 * TRANSCRIPT_CORRECTION_ENABLED, LOW_CONFIDENCE_THRESHOLD and the RETRY_*
 * settings as the service reads them (src/config.ts).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { LLMClient, PromptVars } from '@avalon/shared';
import { loadPipelineConfig } from '../config.js';
import { readExportedGame, type ExportedGame } from '../gamestate/recordSource.js';
import { createPipelineLlm, type GameLog } from '../pipeline.js';
import {
  readShippedSummary,
  replayMode,
  replayRun,
  type ReplayMode,
} from '../replay.js';

const USAGE =
  'usage: replay --export <export.json> --folders <dir> --games <id,id,…> --out <dir> ' +
  '[--runs N] [--mode god|blind] [--concurrency N]';

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

/** Counts each prompt's calls and failures (after the client's own retries). */
function countingLlm(llm: LLMClient) {
  const counts = new Map<string, { calls: number; failed: number }>();
  const track = async <T>(promptFile: string, call: () => Promise<T>): Promise<T> => {
    const c = counts.get(promptFile) ?? { calls: 0, failed: 0 };
    counts.set(promptFile, c);
    c.calls += 1;
    try {
      return await call();
    } catch (err) {
      c.failed += 1;
      throw err;
    }
  };
  const counted: LLMClient = {
    runText: (promptFile: string, vars: PromptVars) =>
      track(promptFile, () => llm.runText(promptFile, vars)),
    runJson: <T>(promptFile: string, vars: PromptVars) =>
      track(promptFile, () => llm.runJson<T>(promptFile, vars)),
  };
  const report = () => {
    const all = [...counts.values()];
    const failed = [...counts.entries()]
      .filter(([, c]) => c.failed > 0)
      .map(([file, c]) => `${file} ${c.failed}/${c.calls}`);
    return (
      `${all.reduce((n, c) => n + c.calls, 0)} LLM calls, ` +
      `${all.reduce((n, c) => n + c.failed, 0)} failed${failed.length ? ` (${failed.join(', ')})` : ''}`
    );
  };
  return { llm: counted, report };
}

function runLog(gameId: string, mode: ReplayMode, run: number): GameLog {
  const prefix = `[replay ${gameId.slice(0, 8)} ${mode} run-${run}]`;
  return {
    info: (msg, extra) =>
      extra !== undefined ? console.log(`${prefix} ${msg}`, extra) : console.log(`${prefix} ${msg}`),
    error: (msg, err) =>
      err !== undefined ? console.error(`${prefix} ${msg}`, err) : console.error(`${prefix} ${msg}`),
  };
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw err;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      export: { type: 'string' },
      folders: { type: 'string' },
      games: { type: 'string' },
      out: { type: 'string' },
      runs: { type: 'string' },
      mode: { type: 'string' },
      concurrency: { type: 'string' },
    },
  });
  if (!values.export || !values.folders || !values.games || !values.out) throw new Error(USAGE);
  if (values.mode !== undefined && values.mode !== 'god' && values.mode !== 'blind') {
    throw new Error('--mode must be god or blind');
  }
  const override = values.mode as ReplayMode | undefined;
  const runs = positiveInt('runs', values.runs, 1);
  const concurrency = positiveInt('concurrency', values.concurrency, 6);
  const gameIds = values.games.split(',').map((id) => id.trim()).filter(Boolean);

  const config = loadPipelineConfig();
  const baseLlm = createPipelineLlm(config);

  // Every game's inputs and run folders are checked before any model call.
  const plan: Array<{
    gameId: string;
    exported: ExportedGame;
    sourceDir: string;
    mode: ReplayMode;
    run: number;
    runDir: string;
  }> = [];
  for (const gameId of gameIds) {
    const exported = await readExportedGame(values.export, gameId);
    const sourceDir = path.join(values.folders, gameId);
    const mode = replayMode(exported, await readShippedSummary(sourceDir), override);
    for (let run = 1; run <= runs; run += 1) {
      const runDir = path.join(values.out, gameId, mode, `run-${run}`);
      if (!(await isEmptyOrMissing(runDir))) {
        throw new Error(`${runDir} is not empty; each run needs a new folder.`);
      }
      plan.push({ gameId, exported, sourceDir, mode, run, runDir });
    }
  }

  const failures: string[] = [];
  for (const { gameId, exported, sourceDir, mode, run, runDir } of plan) {
    const log = runLog(gameId, mode, run);
    const { llm, report } = countingLlm(baseLlm);
    const started = Date.now();
    log.info(`→ ${runDir}`);
    try {
      await replayRun({
        llm,
        correction: config.correction.enabled,
        lowConfidenceThreshold: config.lowConfidenceThreshold,
        exported,
        sourceDir,
        runDir,
        mode,
        concurrency,
        log,
      });
      log.info(`done in ${duration(Date.now() - started)}; ${report()}`);
    } catch (err) {
      log.error(`failed after ${duration(Date.now() - started)}; ${report()}`, err);
      failures.push(`${gameId} ${mode} run-${run}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} run(s) failed: ${failures.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('[replay]', err instanceof Error ? err.message : err);
  process.exit(1);
});
