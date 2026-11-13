/**
 * The blind reviewer's roles-in-play line, with and without Merlin, and the
 * stored setup's `merlin` read with no fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRolesInPlay,
  readRoleConfig,
  summarizeRoleConfig,
} from '../src/gamestate/roleConfig.js';

test('with Merlin, the line lists Merlin and the Assassin with the chosen roles', () => {
  const roles = summarizeRoleConfig(5, { merlin: true, percival: true, morgana: true });
  assert.deepEqual(roles, {
    goodCount: 3,
    evilCount: 2,
    merlinInPlay: true,
    specialRoles: ['Merlin', 'Percival', 'Assassin', 'Morgana'],
  });
  const line = formatRolesInPlay(roles);
  assert.match(line, /^- 5 players: 3 good, 2 evil\.$/m);
  assert.match(line, /^- Special roles in play: Merlin, Percival, Assassin, Morgana\.$/m);
  assert.doesNotMatch(line, /No Merlin/);
});

test('without Merlin, the line says so and lists only the roles that stay', () => {
  const roles = summarizeRoleConfig(7, { merlin: false, oberon: 'standard', lunatic: true });
  assert.deepEqual(roles, {
    goodCount: 4,
    evilCount: 3,
    merlinInPlay: false,
    specialRoles: ['Oberon', 'Lunatic'],
  });
  const line = formatRolesInPlay(roles);
  assert.match(line, /^- Special roles in play: Oberon, Lunatic\.$/m);
  assert.match(line, /^- No Merlin and no Assassin in this game\.$/m);
});

test('without Merlin or any special role, the line says none and no Merlin', () => {
  const roles = summarizeRoleConfig(5, { merlin: false });
  assert.deepEqual(roles?.specialRoles, []);
  const line = formatRolesInPlay(roles);
  assert.match(line, /^- Special roles in play: none\.$/m);
  assert.match(line, /^- No Merlin and no Assassin in this game\.$/m);
  assert.doesNotMatch(line, /in play: \./);
});

test('a player count outside 5–10 has no summary', () => {
  assert.equal(summarizeRoleConfig(4, { merlin: true }), null);
  assert.equal(formatRolesInPlay(null), '(role configuration unavailable)');
});

test('a stored setup without a boolean merlin is refused', () => {
  assert.deepEqual(readRoleConfig({ merlin: false, lunatic: true }), { merlin: false, lunatic: true });
  for (const raw of [null, {}, { percival: true }, { merlin: 'yes' }, 'merlin']) {
    assert.throws(() => readRoleConfig(raw), /no boolean merlin/);
  }
});
