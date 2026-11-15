/**
 * The bot's prompt files, without calling a model: each parses, names a Gemini 4
 * model with a thinking level (and no temperature or thinking budget, which
 * Gemini 4 ignores or refuses), and asks only for vars its caller passes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { loadPrompt } from '@avalon/shared';

const promptsDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'prompts');

// LLMBrain.baseVars, and what each decision adds (src/brains/LLMBrain/index.ts).
const BASE = ['brief', 'seat_table', 'quest_number', 'vote_track', 'team_size', 'fails_required', 'game_so_far'];
const VARS: Record<string, string[]> = {
  'decide-propose.yml': [...BASE],
  'decide-vote.yml': [...BASE, 'proposed_team'],
  'decide-quest.yml': [...BASE],
  'decide-lady.yml': [...BASE, 'eligible_targets'],
  'decide-assassin.yml': [...BASE, 'candidates'],
  'decide-merlin-quiz.yml': [...BASE, 'candidates'],
  // generateTurnSpeech (src/voice/speechGen.ts)
  'speak-turn.yml': ['brief', 'seat_table', 'game_so_far', 'situation'],
};

test('every prompt file in the folder is covered here', () => {
  const files = fs.readdirSync(promptsDir).filter((f) => f.endsWith('.yml')).sort();
  assert.deepEqual(files, Object.keys(VARS).sort());
});

for (const [file, vars] of Object.entries(VARS)) {
  test(`${file}: Gemini 4 with a thinking level, and only known vars`, async () => {
    const p = await loadPrompt(promptsDir, file);
    assert.match(p.model ?? '', /^gemini-4-(carbon|hydrogen)$/);
    assert.ok(p.thinking_level, 'thinking_level');
    assert.equal(p.temperature, undefined);
    assert.equal(p.thinking_budget, undefined);
    const used = new Set([...`${p.system}\n${p.user}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
    for (const v of used) assert.ok(vars.includes(v), `${file} asks for {{${v}}}, which no caller passes`);
    assert.ok(used.has('game_so_far'), 'the game so far');
    assert.ok(used.has('brief'), 'the brief');
  });
}
