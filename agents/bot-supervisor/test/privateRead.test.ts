import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient } from '@avalon/shared';
import { ReadKeeper, renderRead, stateKey, type PrivateRead } from '../src/brains/privateRead.ts';
import type { SmartView } from '../src/brains/smartView.ts';
import type { Identity } from '../src/types/Identity.ts';
import type { Observation } from '../src/types/Observation.ts';
import { TalkMemory } from '../src/voice/talkMemory.ts';

const me = { user_id: 'me', display_name: 'Sara' } as Identity;
const obs = (proposal: string | null, phase = 'voting'): Observation =>
  ({
    room: { players: [] },
    game: { phase, current_quest: 2, vote_track: 0, current_proposal: proposal ? { id: proposal } : null, players: [] },
  }) as unknown as Observation;

const read = (n: number): PrivateRead => ({
  players: [{ name: 'Reza', read: 'evil', role: 'Assassin', why: `update ${n}` }],
  plan: `plan ${n}`,
  public_line: `line ${n}`,
  current_team: `team ${n}`,
});

const silent = { info() {}, warn() {}, debug() {}, error() {} } as never;

function keeper(answers: Array<() => Promise<unknown>>) {
  const talk = new TalkMemory();
  const calls: Array<Record<string, unknown>> = [];
  const llm = {
    async runJson(_file: string, vars: Record<string, unknown>) {
      calls.push(vars);
      const next = answers.shift();
      if (!next) throw new Error('no answer left');
      return next();
    },
    async runText() { return ''; },
  } as unknown as LLMClient;
  const smart = {
    talk,
    brief: () => 'brief',
    gameSoFar: async () => 'so far',
    privateRead: () => '',
  } as unknown as SmartView;
  const k = new ReadKeeper({ llm: () => llm, smart, seatTable: () => 'seats', logger: silent });
  return { k, talk, calls };
}

test('the state key moves with a new proposal, a phase or a turn of talk', () => {
  assert.notEqual(stateKey(obs('p1'), 3), stateKey(obs('p2'), 3));
  assert.notEqual(stateKey(obs('p1'), 3), stateKey(obs('p1'), 4));
  assert.notEqual(stateKey(obs('p1', 'voting'), 3), stateKey(obs('p1', 'quest'), 3));
  assert.equal(stateKey(obs('p1'), 3), stateKey(obs('p1'), 3));
});

test('events during an update make one more update, on the newest state, not one each', async () => {
  let release!: () => void;
  const first = new Promise<void>((r) => (release = r));
  const { k, talk, calls } = keeper([async () => { await first; return read(1); }, async () => read(2)]);
  k.notice(me, obs('p1'));
  talk.addTurn(2, 0, 1, 'Ali', 'a');
  k.notice(me, obs('p1'));
  talk.addTurn(2, 0, 2, 'Mina', 'b');
  k.notice(me, obs('p1'));
  k.notice(me, obs('p1')); // nothing new
  release();
  await k.idle();
  assert.equal(k.updates, 2);
  assert.equal(calls.length, 2);
  assert.match(k.rendered(), /plan 2/);
  // the second update was given the first read as the previous one
  assert.match(String(calls[1].previous_read), /plan 1/);
});

test('a failed or malformed update keeps the previous read', async () => {
  const { k, talk } = keeper([async () => read(1), async () => { throw new Error('boom'); }, async () => ({ plan: 'x' })]);
  k.notice(me, obs('p1'));
  await k.idle();
  talk.addTurn(2, 0, 1, 'Ali', 'a');
  k.notice(me, obs('p1'));
  await k.idle();
  talk.addTurn(2, 0, 2, 'Mina', 'b');
  k.notice(me, obs('p1'));
  await k.idle();
  assert.equal(k.updates, 1);
  assert.match(k.rendered(), /plan 1/);
});

test('no reads after the game is over', async () => {
  const { k, calls } = keeper([async () => read(1)]);
  k.notice(me, obs(null, 'game_over'));
  await k.idle();
  assert.equal(calls.length, 0);
});

test('the rendered read names its time, each player, the plan and the public line', () => {
  const text = renderRead(read(1), 'quest 2, phase voting, after 4 turn(s) of talk in the game');
  assert.equal(
    text,
    [
      'Written at quest 2, phase voting, after 4 turn(s) of talk in the game; the game so far may have moved on since.',
      '- Reza: evil, maybe Assassin — update 1',
      'Your plan: plan 1',
      "What you have said at the table (don't contradict it): line 1",
      'On the team: team 1',
    ].join('\n')
  );
  assert.equal(renderRead(null, null), '(no read yet: judge from the game so far)');
});
