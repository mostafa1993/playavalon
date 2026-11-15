import test from 'node:test';
import assert from 'node:assert/strict';
import { sentences, turnKey } from '../src/voice/voiceLayer.ts';

test('a statement splits into sentences, end marks kept', () => {
  assert.deepEqual(sentences('ببینید، تیم اول فیل شد. علی چرا رضا رو آوردی؟ من رای منفی میدم!'), [
    'ببینید، تیم اول فیل شد.',
    'علی چرا رضا رو آوردی؟',
    'من رای منفی میدم!',
  ]);
  assert.deepEqual(sentences('بدون نقطه'), ['بدون نقطه']);
});

test('a turn key is the same for the prepare and the slot', () => {
  assert.equal(turnKey({ quest: 2, round: 1, turnIndex: 3 }), '2:1:3');
});
