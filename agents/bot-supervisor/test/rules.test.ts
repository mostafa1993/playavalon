import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief, renderIntel, renderRules } from '../src/brains/rules.ts';
import type { Identity } from '../src/types/Identity.ts';

const identity = (over: Partial<Identity> & { intel?: Partial<Identity['role_intel']> }): Identity => ({
  user_id: 'me',
  username: 'bot_sara',
  display_name: 'Sara',
  role: 'good',
  special_role: 'servant',
  ...over,
  role_intel: { known_players: [], known_players_label: '', ...over.intel },
});

test('a plain list, with hidden evil and a decoy warning', () => {
  const text = renderIntel(
    identity({
      special_role: 'merlin',
      intel: {
        known_players: ['Reza', 'Nima'],
        known_players_label: 'The evil among you',
        hidden_evil_count: 1,
        decoy_warning: 'One of the players you see as evil may be a good decoy.',
      },
    })
  );
  assert.equal(
    text,
    'The evil among you: Reza, Nima.\n1 evil player(s) are hidden from you.\nOne of the players you see as evil may be a good decoy.'
  );
});

test('split intel: certain evil and the mixed pair', () => {
  const text = renderIntel(
    identity({
      special_role: 'merlin',
      intel: {
        split_intel: {
          certainEvil: [{ id: 'r', name: 'Reza' }],
          mixedIntel: [{ id: 'a', name: 'Ali' }, { id: 'n', name: 'Nima' }],
          hiddenCount: 0,
        },
      },
    })
  );
  assert.equal(
    text,
    "Certainly evil: Reza.\nMixed pair: Ali, Nima — one of them is evil and one is good; you don't know which."
  );
});

test('the evil ring names one teammate and how many are hidden', () => {
  const text = renderIntel(
    identity({
      role: 'evil',
      special_role: 'minion',
      intel: { evil_ring: { knownTeammate: { id: 'r', name: 'Reza' }, hiddenCount: 2 } },
    })
  );
  assert.equal(text, "Your one known evil teammate: Reza (you don't know their role); 2 other evil player(s) are hidden from you.");
});

test('nothing shown says so; holding the Lady is said', () => {
  assert.equal(renderIntel(identity({})), 'You were shown no one: you know only your own role.');
  assert.equal(renderIntel(identity({ intel: { has_lady_of_lake: true } })), 'You hold the Lady of the Lake.');
});

test('the rules list only the roles and modes dealt, and the quest table', () => {
  const text = renderRules(
    { merlin: true, percival: true, morgana: true, lunatic: true, ladyOfLake: true, merlin_split_intel_enabled: true },
    7
  );
  assert.match(text, /quest 4 team of 4 \(needs 2 Fail cards to fail\)/);
  assert.match(text, /- Merlin \(good\)/);
  assert.match(text, /- Percival \(good\)/);
  assert.match(text, /- Morgana \(evil\)/);
  assert.match(text, /- Lunatic \(evil\): .*must play Fail on every quest/);
  assert.doesNotMatch(text, /- Mordred \(evil\)/);
  assert.doesNotMatch(text, /Brute/);
  assert.match(text, /Lady of the Lake: after quests 2, 3 and 4/);
  assert.match(text, /Split intel: Merlin sees two groups/);
  assert.doesNotMatch(text, /Decoy/);
  // 3 evil seats, all special: no plain Minion; 4 good with 2 special: Loyal Servants
  assert.doesNotMatch(text, /- Minion of Mordred/);
  assert.match(text, /- Loyal Servant of Arthur/);
});

test('no Merlin: the rules say good wins outright, and deal no Assassin', () => {
  const text = renderRules({ merlin: false }, 5);
  assert.match(text, /No Merlin and no Assassin in this game/);
  assert.doesNotMatch(text, /- Assassin/);
});

test('the brief names the bot, its role and its intel', () => {
  const brief = renderBrief(
    identity({ role: 'evil', special_role: 'assassin', intel: { known_players: ['Nima'], known_players_label: 'Your evil allies' } }),
    { merlin: true },
    5
  );
  assert.match(brief, /^You are Sara, playing Avalon by voice/);
  assert.match(brief, /Your role: Assassin \(evil\)/);
  assert.match(brief, /What you were secretly shown when roles were dealt:\nYour evil allies: Nima\./);
});

test('holding the Lady comes from the game when given, not from the deal', () => {
  const dealtIt = identity({ intel: { has_lady_of_lake: true } });
  assert.equal(renderIntel(dealtIt, false), 'You were shown no one: you know only your own role.');
  assert.equal(renderIntel(identity({}), true), 'You hold the Lady of the Lake.');
});
