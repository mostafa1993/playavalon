/**
 * The rules a smart bot plays by, as text for its prompts: the game's rules,
 * the roles and modes dealt in this game (and only those), the quests' team
 * sizes, and the bot's own secret knowledge in whatever form the app dealt it
 * (a plain list, split intel, an evil ring, a decoy warning).
 *
 * Mirrors the app: src/lib/utils/constants.ts (SPECIAL_ROLES),
 * src/lib/domain/rulebook-content.ts (GAME_MODES), src/lib/domain/quest-config.ts
 * (QUEST_CONFIG). The agents can't import from the app; keep these in sync.
 */

import { formatRolesInPlay, readRoleConfig, roleCounts, summarizeRoleConfig, type RolesInPlay } from '@avalon/shared';
import type { Identity, SpecialRole } from '../types/Identity.js';

/** Team size and fails needed per quest, by player count. */
const QUESTS: Record<number, Array<[size: number, fails: number]>> = {
  5: [[2, 1], [3, 1], [2, 1], [3, 1], [3, 1]],
  6: [[2, 1], [3, 1], [4, 1], [3, 1], [4, 1]],
  7: [[2, 1], [3, 1], [3, 1], [4, 2], [4, 1]],
  8: [[3, 1], [4, 1], [4, 1], [5, 2], [5, 1]],
  9: [[3, 1], [4, 1], [4, 1], [5, 2], [5, 1]],
  10: [[3, 1], [4, 1], [4, 1], [5, 2], [5, 1]],
};

const ROLE_TEXT: Record<SpecialRole, string> = {
  merlin:
    'Merlin (good): sees the evil players from the start, except Mordred and Oberon (Chaos). ' +
    'If good wins three quests, the Assassin names one player as Merlin, and a right guess wins ' +
    'the game for evil — so Merlin steers the table without showing what he knows.',
  percival:
    'Percival (good): sees Merlin, and Morgana too if she is dealt; they look the same to him, ' +
    'so he knows Merlin is one of them but not which. He protects Merlin, often by drawing the ' +
    "Assassin's eye to himself.",
  servant: 'Loyal Servant of Arthur (good): knows nothing beyond being good.',
  assassin:
    'Assassin (evil): knows the evil team (not Oberon). If good wins three quests, names one ' +
    'player as Merlin; a right guess wins the game for evil.',
  morgana: 'Morgana (evil): knows the evil team (not Oberon); looks like Merlin to Percival.',
  mordred: 'Mordred (evil): knows the evil team (not Oberon); hidden from Merlin.',
  oberon_standard:
    'Oberon (evil): does not know the other evil players and they do not know him; Merlin sees him.',
  oberon_chaos:
    'Oberon (Chaos) (evil): knows no one, and no one sees him — not the evil team, not Merlin.',
  minion: 'Minion of Mordred (evil): knows the evil team (not Oberon).',
  lunatic: 'Lunatic (evil): knows the evil team (not Oberon); must play Fail on every quest they are on.',
  brute: 'Brute (evil): knows the evil team (not Oberon); may play Fail only on quests 1–3, and must play Success from quest 4.',
};

/** The special roles a role setup deals; generic servants and minions fill the rest. */
function rolesDealt(cfg: Record<string, unknown>): SpecialRole[] {
  const roles: SpecialRole[] = [];
  if (cfg.merlin === true) roles.push('merlin', 'assassin');
  if (cfg.percival === true) roles.push('percival');
  if (cfg.morgana === true) roles.push('morgana');
  if (cfg.mordred === true) roles.push('mordred');
  if (cfg.oberon === 'standard') roles.push('oberon_standard');
  if (cfg.oberon === 'chaos') roles.push('oberon_chaos');
  if (cfg.lunatic === true) roles.push('lunatic');
  if (cfg.brute === true) roles.push('brute');
  return roles;
}

function modesText(cfg: Record<string, unknown>): string[] {
  const modes: string[] = [];
  if (cfg.merlin !== true) {
    modes.push('No Merlin and no Assassin in this game: three successful quests win for good outright.');
  }
  if (cfg.ladyOfLake === true) {
    modes.push(
      'Lady of the Lake: after quests 2, 3 and 4 its holder privately learns one player\'s ' +
        'alignment (good or evil); the token then passes to that player; nobody is looked at twice. ' +
        'What the holder tells the table about it may be true or a lie.'
    );
  }
  if (cfg.merlin_decoy_enabled === true) {
    modes.push('Decoy: one good player (not knowing it) appears evil to Merlin.');
  }
  if (cfg.merlin_split_intel_enabled === true) {
    modes.push(
      'Split intel: Merlin sees two groups — "certain evil", and a "mixed" pair of one evil and one good player.'
    );
  }
  if (cfg.oberon_split_intel_enabled === true) {
    modes.push('Oberon split intel: Merlin sees Oberon in a "mixed" pair with one good player, the other evil apart.');
  }
  if (cfg.evil_ring_visibility_enabled === true) {
    modes.push('Evil ring: each evil player knows only one evil teammate (by name, not role), in a ring.');
  }
  return modes;
}

/** The rules, the roles and modes of this game, and its quests, for a prompt. */
export function renderRules(roleConfig: Record<string, unknown> | null, playerCount: number): string {
  const lines = [
    'How Avalon works: good wins three quests, evil wins three quests by failing them (or five',
    'rejected proposals in a row within one quest). Each quest a leader (the role passes clockwise)',
    'proposes a team; everyone votes approve or reject in the open; on approval, the team plays',
    'quest cards in secret — good players must play Success, evil players may play Fail — and only',
    'the counts are revealed. Who played Fail is never shown.',
  ];
  const quests = QUESTS[playerCount];
  if (quests) {
    lines.push(
      `Quests with ${playerCount} players: ` +
        quests
          .map(([size, fails], i) => `quest ${i + 1} team of ${size}${fails > 1 ? ` (needs ${fails} Fail cards to fail)` : ''}`)
          .join('; ') +
        '.'
    );
  }
  if (!roleConfig) return [...lines, 'Roles in this game: unknown.'].join('\n');
  let setup: RolesInPlay | null = null;
  try {
    setup = summarizeRoleConfig(playerCount, readRoleConfig(roleConfig));
  } catch {
    // an unreadable setup: the special roles are still described below
  }
  lines.push(setup ? formatRolesInPlay(setup) : 'Roles in this game: (setup unavailable)');
  lines.push('What each role in this game is:');
  for (const role of rolesDealt(roleConfig)) lines.push(`- ${ROLE_TEXT[role]}`);
  // The generic roles only when the setup deals them (a 7-player game with three
  // special evil roles has no plain Minion).
  const counts = setup ? roleCounts(setup) : [];
  if (counts.some((c) => c.role === 'Loyal Servant')) lines.push(`- ${ROLE_TEXT.servant}`);
  if (counts.some((c) => c.role === 'Minion')) lines.push(`- ${ROLE_TEXT.minion}`);
  const modes = modesText(roleConfig);
  if (modes.length > 0) lines.push('Modes in this game:', ...modes.map((m) => `- ${m}`));
  return lines.join('\n');
}

/** The bot's own role, in words. */
export function renderMyRole(identity: Identity): string {
  return ROLE_TEXT[identity.special_role] ?? `${identity.special_role} (${identity.role})`;
}

/**
 * Everything the bot was secretly shown when roles were dealt, and whether it
 * holds the Lady of the Lake now (`holdsLady`, from the game; the identity's
 * flag is from the deal and goes stale when the token passes).
 */
export function renderIntel(identity: Identity, holdsLady = identity.role_intel.has_lady_of_lake ?? false): string {
  const intel = identity.role_intel;
  const lines: string[] = [];
  const split = intel.split_intel ?? intel.oberon_split_intel;
  if (split) {
    lines.push(`Certainly evil: ${names(split.certainEvil)}.`);
    lines.push(`Mixed pair: ${names(split.mixedIntel)} — one of them is evil and one is good; you don't know which.`);
  } else if (intel.evil_ring) {
    lines.push(
      `Your one known evil teammate: ${intel.evil_ring.knownTeammate.name} (you don't know their role); ` +
        `${intel.evil_ring.hiddenCount} other evil player(s) are hidden from you.`
    );
  } else if (intel.known_players.length > 0) {
    lines.push(`${intel.known_players_label || 'You see'}: ${intel.known_players.join(', ')}.`);
  }
  const hidden = split?.hiddenCount ?? intel.hidden_evil_count;
  if (!intel.evil_ring && hidden && hidden > 0) {
    lines.push(`${hidden} evil player(s) are hidden from you.`);
  }
  if (intel.decoy_warning) lines.push(intel.decoy_warning);
  if (holdsLady) lines.push('You hold the Lady of the Lake.');
  return lines.length > 0 ? lines.join('\n') : 'You were shown no one: you know only your own role.';
}

function names(group: ReadonlyArray<{ name: string }>): string {
  return group.length > 0 ? group.map((p) => p.name).join(', ') : 'nobody';
}

/**
 * What every smart-bot prompt opens with: who the bot is, the rules and the
 * roles of this game, its own role and what it was secretly shown.
 */
export function renderBrief(
  identity: Identity,
  roleConfig: Record<string, unknown> | null,
  playerCount: number,
  holdsLady?: boolean
): string {
  return [
    `You are ${identity.display_name}, playing Avalon by voice with a table of Persian-speaking ` +
      'friends, and you play to win for your side.',
    '',
    renderRules(roleConfig, playerCount),
    '',
    `Your role: ${renderMyRole(identity)}`,
    `What you were secretly shown when roles were dealt:\n${renderIntel(identity, holdsLady)}`,
  ].join('\n');
}
