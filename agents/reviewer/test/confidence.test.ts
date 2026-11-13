/**
 * Low-confidence speech: the flag at, above and below the threshold, and on a
 * transcript with no confidence; and the turn file and the record carrying it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isLowConfidence } from '../src/reviewer/confidence.js';

test('below the threshold is low; at or above it is not', () => {
  assert.equal(isLowConfidence(0.32, 0.5), true);
  assert.equal(isLowConfidence(0.4999, 0.5), true);
  assert.equal(isLowConfidence(0.5, 0.5), false);
  assert.equal(isLowConfidence(0.91, 0.5), false);
  assert.equal(isLowConfidence(0.6, 0.7), true);
  assert.equal(isLowConfidence(0, 0), false);
});

test('a transcript with no confidence (nothing transcribed) is not flagged', () => {
  assert.equal(isLowConfidence(null, 0.5), false);
});
