import test from 'node:test';
import assert from 'node:assert/strict';
import { situation } from '../src/voice/speechGen.ts';
import type { Identity } from '../src/types/Identity.ts';
import type { Observation } from '../src/types/Observation.ts';

const me: Identity = {
  user_id: 'me', username: 'bot_sara', display_name: 'Sara', role: 'good', special_role: 'servant',
  role_intel: { known_players: [], known_players_label: '' },
};
const names: Record<string, string> = { me: 'Sara', r: 'Reza', a: 'Ali' };
const nameOf = (id: string) => names[id] ?? id;

const observation = (leader: string, team: string[] | null): Observation =>
  ({
    room: { players: [] },
    game: {
      current_quest: 2, vote_track: 1, current_leader_id: leader,
      current_proposal: team ? { id: 'p', leader_id: leader, team_member_ids: team, proposal_number: 2 } : null,
      players: [],
    },
  }) as unknown as Observation;

test('the intro round', () => {
  assert.match(situation(me, observation('r', null), { quest: 0, round: 0, turnIndex: 3, speakers: 7 }, nameOf), /^This is the intro round/);
});

test('the leader opens with the team, and closes the round', () => {
  const obs = observation('me', ['me', 'a']);
  assert.equal(
    situation(me, obs, { quest: 2, round: 1, turnIndex: 0, speakers: 7 }, nameOf),
    'Quest 2, vote track 1/5. You are the leader and speak first: present your team [Sara, Ali] and why you chose it.'
  );
  assert.match(situation(me, obs, { quest: 2, round: 1, turnIndex: 6, speakers: 7 }, nameOf), /You are the leader and speak last, closing the round/);
});

test('a player speaks about the proposed team', () => {
  assert.equal(
    situation(me, observation('r', ['r', 'a']), { quest: 2, round: 1, turnIndex: 2, speakers: 7 }, nameOf),
    'Quest 2, vote track 1/5. Reza (leader) proposed [Reza, Ali]. It is your turn to speak about it: what you make of it, and how you will vote.'
  );
});

test('no team yet', () => {
  assert.match(situation(me, observation('r', null), { quest: 2, round: 1, turnIndex: 2, speakers: 7 }, nameOf), /Reza is the leader and no team is proposed yet/);
});
