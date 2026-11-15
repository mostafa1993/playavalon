/**
 * The shared client's temperature and thinking settings per model family
 * (`samplingFor`), and the prompt loader's checks on `thinking_level`.
 * No model is called.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ThinkingLevel } from '@google/genai';
import { isGemini4, loadPrompt, samplingFor } from '@avalon/shared';

test('isGemini4 names the Gemini 4 family only', () => {
  assert.equal(isGemini4('gemini-4-carbon'), true);
  assert.equal(isGemini4('gemini-4-hydrogen'), true);
  assert.equal(isGemini4('gemini-3.1-pro-preview'), false);
  assert.equal(isGemini4('gemini-3.8-flash'), false);
});

test('Gemini 3: temperature (default 0.4) and the thinking budget are sent', () => {
  assert.deepEqual(samplingFor('p.yml', 'gemini-3.1-pro-preview', { thinking_budget: 2500 }), {
    temperature: 0.4,
    thinkingConfig: { thinkingBudget: 2500 },
  });
  assert.deepEqual(samplingFor('p.yml', 'gemini-3.1-pro-preview', { temperature: 0.2 }), {
    temperature: 0.2,
  });
});

test('Gemini 4: the thinking level is sent, and no temperature', () => {
  assert.deepEqual(samplingFor('p.yml', 'gemini-4-carbon', { thinking_level: 'HIGH' }), {
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
  });
  assert.deepEqual(samplingFor('p.yml', 'gemini-4-hydrogen', {}), {});
});

test('Gemini 4 refuses a thinking budget or a temperature, naming the prompt', () => {
  assert.throws(
    () => samplingFor('decide-vote.yml', 'gemini-4-carbon', { thinking_budget: 2500 }),
    /decide-vote\.yml: gemini-4-carbon takes thinking_level, not thinking_budget/
  );
  assert.throws(
    () => samplingFor('speak-turn.yml', 'gemini-4-hydrogen', { temperature: 0.7 }),
    /speak-turn\.yml: gemini-4-hydrogen ignores temperature/
  );
});

test('the loader refuses an unknown thinking level, or a level with a budget', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompts-'));
  const base = 'name: x\nsystem: s\nuser: u\n';
  await fs.writeFile(path.join(dir, 'bad-level.yml'), base + 'thinking_level: XHIGH\n');
  await fs.writeFile(path.join(dir, 'both.yml'), base + 'thinking_level: LOW\nthinking_budget: 100\n');
  await fs.writeFile(path.join(dir, 'ok.yml'), base + 'thinking_level: MEDIUM\n');
  await assert.rejects(loadPrompt(dir, 'bad-level.yml'), /thinking_level must be one of LOW, MEDIUM, HIGH/);
  await assert.rejects(loadPrompt(dir, 'both.yml'), /not both/);
  assert.equal((await loadPrompt(dir, 'ok.yml')).thinking_level, 'MEDIUM');
  await fs.rm(dir, { recursive: true });
});
