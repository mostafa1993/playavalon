/**
 * Regression checks for the prompt YAML files.
 *
 * These tests don't hit the LLM. They verify that:
 *   1. Every prompt file parses and has the required `name`/`system`/`user` fields.
 *   2. The placeholders every prompt expects line up with the vars the agent
 *      code actually passes. If this drifts (e.g., someone renames a
 *      placeholder without updating code), we catch it before shipping.
 *   3. Each prompt's declared `response_mime_type` matches the kind of output
 *      the code is built to consume.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { loadPrompt, fill, type PromptFile } from '../src/reviewer/prompts.js';

const promptsDir = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
  'prompts'
);

// Each prompt file + the vars the agent code passes in (by name).
// Keep this in sync with the actual callers in src/reviewer/*.ts.
const prompts: Array<{
  file: string;
  mime: 'application/json' | 'text/plain';
  expectedVars: string[];
}> = [
  {
    file: 'turn-summarizer.yml',
    mime: 'application/json',
    expectedVars: [
      'quest_number',
      'turn_index',
      'speaker_display_name',
      'speaker_seat',
      'leader_display_name',
      'proposed_team',
      'seat_table',
      'transcript',
    ],
  },
  {
    file: 'dossier-update.yml',
    mime: 'application/json',
    expectedVars: [
      'player_display_name',
      'player_seat',
      'quest_number',
      'turn_index',
      'previous_dossier',
      'turn_summary',
    ],
  },
  {
    file: 'quest-synthesizer.yml',
    mime: 'application/json',
    expectedVars: ['quest_number', 'quest_data', 'turn_summaries'],
  },
  { file: 'role-reveal-fa.yml', mime: 'text/plain', expectedVars: ['roster'] },
  { file: 'role-reveal-en.yml', mime: 'text/plain', expectedVars: ['roster'] },
  {
    file: 'final-narrative-fa.yml',
    mime: 'text/plain',
    expectedVars: ['meta', 'outcome', 'dossiers', 'quests'],
  },
  {
    file: 'final-narrative-en.yml',
    mime: 'text/plain',
    expectedVars: ['meta', 'outcome', 'dossiers', 'quests'],
  },
];

function collectPlaceholders(p: PromptFile): Set<string> {
  const re = /\{\{(\w+)\}\}/g;
  const found = new Set<string>();
  for (const text of [p.system, p.user]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return found;
}

for (const spec of prompts) {
  test(`prompt ${spec.file} loads and has required fields`, async () => {
    const p = await loadPrompt(promptsDir, spec.file);
    assert.equal(typeof p.name, 'string');
    assert.ok(p.name.length > 0, 'name should not be empty');
    assert.ok(p.system.length > 0, 'system should not be empty');
    assert.ok(p.user.length > 0, 'user should not be empty');
  });

  test(`prompt ${spec.file} declares expected response_mime_type`, async () => {
    const p = await loadPrompt(promptsDir, spec.file);
    assert.equal(
      p.response_mime_type,
      spec.mime,
      `expected response_mime_type=${spec.mime}`
    );
  });

  test(`prompt ${spec.file} placeholders match the vars the code passes`, async () => {
    const p = await loadPrompt(promptsDir, spec.file);
    const placeholders = collectPlaceholders(p);
    const expected = new Set(spec.expectedVars);

    const missingInPrompt = [...expected].filter((v) => !placeholders.has(v));
    const unusedInCode = [...placeholders].filter((v) => !expected.has(v));

    assert.deepEqual(
      missingInPrompt,
      [],
      `prompt ${spec.file} doesn't reference these vars from code: ${missingInPrompt.join(', ')}`
    );
    assert.deepEqual(
      unusedInCode,
      [],
      `prompt ${spec.file} references vars the code doesn't pass: ${unusedInCode.join(', ')}`
    );
  });
}

test('every prompt YAML in prompts/ is covered by the expectations above', async () => {
  const entries = await fs.readdir(promptsDir);
  const onDisk = entries.filter((f) => f.endsWith('.yml')).sort();
  const covered = prompts.map((p) => p.file).sort();
  assert.deepEqual(
    onDisk,
    covered,
    'Unexpected or missing prompt files. Update the `prompts` list in this test.'
  );
});

test('fill() substitutes {{var}} and preserves unknown placeholders', () => {
  const out = fill('hello {{name}}, missing {{other}}', { name: 'world' });
  assert.equal(out, 'hello world, missing {{other}}');
});

test('fill() handles number and null values', () => {
  assert.equal(fill('n={{n}} m={{m}}', { n: 42, m: null }), 'n=42 m={{m}}');
});
