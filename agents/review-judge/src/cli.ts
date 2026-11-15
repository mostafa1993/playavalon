/**
 * Judge one report.
 *
 *   npm run judge -- --record <god record.json> --fa <summary.fa.json> [--en <summary.en.json>] --out <dir>
 *
 * Writes <dir>/verdicts.json (every sentence with its kind and verdict, and the
 * English–Persian differences) and <dir>/measures.json (the plan's four
 * measures). Needs Vertex AI credentials: GCP_PROJECT_ID, GCP_LLM_LOCATION
 * (default global, where the preview models are served) and GOOGLE_APPLICATION_CREDENTIALS. Each
 * prompt names its model (gemini-3.1-pro-preview: the measuring stick stays the same).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { parseArgs } from 'node:util';
import { createLLMClient } from '@avalon/shared';
import { readRecord } from './record.js';
import { readReport } from './report.js';
import { judgeReport } from './judge.js';
import { computeMeasures } from './measures.js';

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      record: { type: 'string' },
      fa: { type: 'string' },
      en: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.record || !values.fa || !values.out) {
    throw new Error('usage: judge --record <record.json> --fa <summary.fa.json> [--en <summary.en.json>] --out <dir>');
  }
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error('GCP_PROJECT_ID is not set');

  const llm = createLLMClient({
    project,
    location: process.env.GCP_LLM_LOCATION ?? 'global',
    promptsDir: path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'prompts'),
    retry: { maxAttempts: 3, baseDelayMs: 1000 },
  });

  const record = readRecord(await readJson(values.record));
  const persian = readReport(await readJson(values.fa));
  const english = values.en ? readReport(await readJson(values.en)) : null;

  const verdicts = await judgeReport(llm, record, persian, english);
  const measures = computeMeasures(record, persian, verdicts);

  const existing = await fs.readdir(values.out).catch(() => [] as string[]);
  if (existing.length) throw new Error(`--out ${values.out} is not empty; give a new folder`);
  await fs.mkdir(values.out, { recursive: true });
  await fs.writeFile(path.join(values.out, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
  await fs.writeFile(path.join(values.out, 'measures.json'), JSON.stringify(measures, null, 2));
  console.log(JSON.stringify(measures));
}

main().catch((err) => {
  console.error('[judge]', err instanceof Error ? err.message : err);
  process.exit(1);
});
