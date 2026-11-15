import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGameSoFar } from '../src/brains/gameSoFar.ts';
import type { GameHistory } from '../src/types/History.ts';
import type { TalkTurn } from '../src/voice/talkMemory.ts';

const players = [
  { id: 'r', display_name: 'Reza' },
  { id: 'a', display_name: 'Ali' },
  { id: 's', display_name: 'Sara' },
  { id: 'm', display_name: 'Mina' },
  { id: 'n', display_name: 'Nima' },
];

const history: GameHistory = {
  proposals: [
    {
      quest: 1, proposal_number: 1, leader_id: 'r', team_member_ids: ['r', 'n'], status: 'rejected',
      votes: [
        { player_id: 'r', vote: 'approve' }, { player_id: 'n', vote: 'approve' },
        { player_id: 'a', vote: 'reject' }, { player_id: 's', vote: 'reject' }, { player_id: 'm', vote: 'reject' },
      ],
    },
    {
      quest: 1, proposal_number: 2, leader_id: 'a', team_member_ids: ['a', 'm'], status: 'approved',
      votes: [
        { player_id: 'r', vote: 'reject' }, { player_id: 'n', vote: 'approve' },
        { player_id: 'a', vote: 'approve' }, { player_id: 's', vote: 'approve' }, { player_id: 'm', vote: 'approve' },
      ],
    },
    { quest: 2, proposal_number: 1, leader_id: 's', team_member_ids: ['s', 'a', 'm'], status: 'pending', votes: null },
  ],
  quests: [{ quest: 1, result: 'success', success_count: 2, fail_count: 0, team_member_ids: ['a', 'm'] }],
  lady: [
    { quest: 1, investigator_id: 's', target_id: 'n', result: 'evil' },
    { quest: 1, investigator_id: 'm', target_id: 'r', result: null },
  ],
};

const talk: TalkTurn[] = [
  { quest: 0, round: 0, speaker: 'Reza', text: 'سلام بچه‌ها' },
  { quest: 1, round: 0, speaker: 'Mina', text: 'رضا چرا نیما رو آوردی؟' },
  { quest: 1, round: 1, speaker: 'Sara', text: 'به این تیم اعتماد دارم' },
  { quest: 2, round: 0, speaker: 'Nima', text: 'سارا خیلی مطمئنه' },
  { quest: 2, round: 1, speaker: 'Ali', text: 'یه دور دیگه' },
];

const text = renderGameSoFar({ history, talk, players, meId: 's' });

test('the intro talk comes first', () => {
  assert.match(text, /^Intro round \(before quest 1\):\n {2}Reza: سلام بچه‌ها/);
});

test('each proposal is followed by the talk about it and its vote', () => {
  assert.ok(
    text.includes(
      [
        '  Proposal 1: Reza (leader) proposed [Reza, Nima]',
        '    Talk:',
        '      Mina: رضا چرا نیما رو آوردی؟',
        '    Vote: REJECTED — approve: Reza, Nima; reject: Ali, Sara (you), Mina',
        '  Proposal 2: Ali (leader) proposed [Ali, Mina]',
        '    Talk:',
        '      Sara (you): به این تیم اعتماد دارم',
        '    Vote: APPROVED — approve: Nima, Ali, Sara (you), Mina; reject: Reza',
      ].join('\n')
    ),
    text
  );
});

test('quest results and the Lady are shown; a Lady result only when the bot looked', () => {
  assert.ok(text.includes('  Quest result: SUCCESS — team [Ali, Mina]: 2 success, 0 fail cards'), text);
  assert.ok(text.includes('  Lady of the Lake: Sara (you) looked at Nima: EVIL (only you know this)'), text);
  assert.ok(text.includes('  Lady of the Lake: Mina looked at Reza (only they know the result)'), text);
});

test('a proposal being voted on shows no votes; talk with no proposal yet is kept', () => {
  assert.ok(text.includes('  Proposal 1: Sara (you) (leader) proposed [Sara (you), Ali, Mina]\n    Talk:\n      Nima: سارا خیلی مطمئنه\n    Vote: being cast now'), text);
  assert.ok(text.includes('  Talk (round 2, no proposal recorded for it yet):\n    Ali: یه دور دیگه'), text);
});

test('an empty game says so', () => {
  assert.equal(renderGameSoFar({ history: null, talk: [], players, meId: 's' }), '(nothing has happened yet)');
});
