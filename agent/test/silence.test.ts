import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRms, isSilent } from '../src/stt/silence.js';

test('computeRms returns 0 for empty buffer', () => {
  assert.equal(computeRms(new Int16Array(0)), 0);
});

test('computeRms returns 0 for all-zero buffer', () => {
  assert.equal(computeRms(new Int16Array(1000)), 0);
});

test('computeRms returns expected magnitude for constant signal', () => {
  // Constant amplitude 1000 → RMS = 1000 exactly.
  const buf = new Int16Array(1000).fill(1000);
  const rms = computeRms(buf);
  assert.ok(Math.abs(rms - 1000) < 1);
});

test('isSilent is true below threshold, false above', () => {
  const quiet = new Int16Array(1000).fill(50);   // RMS = 50
  const speech = new Int16Array(1000).fill(3000); // RMS = 3000
  assert.equal(isSilent(quiet, 250), true);
  assert.equal(isSilent(speech, 250), false);
});

test('isSilent treats empty buffers as silent', () => {
  assert.equal(isSilent(new Int16Array(0), 250), true);
});
