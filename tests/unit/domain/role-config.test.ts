/**
 * Unit tests for role configuration domain logic
 * T011: Tests for validateRoleConfig, computeRolesInPlay, getRoleDetails
 */

import { describe, it, expect } from 'vitest';
import {
  getDefaultConfig,
  isDefaultConfig,
  setMerlin,
  configForPlayerCount,
  validateRoleConfig,
  computeRolesInPlay,
  getRoleDetails,
  designateLadyOfLakeHolder,
} from '@/lib/domain/role-config';
import { pickRoleConfig, type RoleConfig } from '@/types/role-config';

/** The options a setup without Merlin refuses, each as it would be switched on. */
const needsMerlin: { name: string; options: Partial<RoleConfig> }[] = [
  { name: 'Percival', options: { percival: true } },
  { name: 'Mordred', options: { mordred: true } },
  { name: 'Morgana', options: { morgana: true } },
  { name: 'Oberon (Chaos)', options: { oberon: 'chaos' } },
  { name: 'Merlin Decoy', options: { merlin_decoy_enabled: true } },
  { name: 'Split Intel', options: { merlin_split_intel_enabled: true } },
  {
    name: 'Oberon Split Intel',
    options: { oberon: 'standard', oberon_split_intel_enabled: true },
  },
];

describe('getDefaultConfig', () => {
  it('returns Merlin with no other options', () => {
    const config = getDefaultConfig();
    expect(config).toEqual({ merlin: true });
  });
});

describe('validateRoleConfig', () => {
  describe('player count validation', () => {
    it('rejects player count below 5', () => {
      const result = validateRoleConfig({ merlin: true }, 4);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid player count: 4. Must be between 5 and 10.');
    });

    it('rejects player count above 10', () => {
      const result = validateRoleConfig({ merlin: true }, 11);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid player count: 11. Must be between 5 and 10.');
    });

    it('accepts valid player counts 5-10', () => {
      for (let count = 5; count <= 10; count++) {
        const result = validateRoleConfig({ merlin: true }, count);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });
  });

  describe('good team slot validation', () => {
    it('accepts Percival in 5-player game (3 good slots)', () => {
      const result = validateRoleConfig({ merlin: true, percival: true }, 5);
      expect(result.valid).toBe(true);
    });

    it('accepts Percival in 10-player game (6 good slots)', () => {
      const result = validateRoleConfig({ merlin: true, percival: true }, 10);
      expect(result.valid).toBe(true);
    });
  });

  describe('evil team slot validation', () => {
    it('accepts Morgana in 5-player game (2 evil slots)', () => {
      const result = validateRoleConfig({ merlin: true, morgana: true }, 5);
      expect(result.valid).toBe(true);
    });

    it('rejects Morgana + Mordred + Oberon in 5-player game (only 2 evil slots)', () => {
      const result = validateRoleConfig(
        { merlin: true, morgana: true, mordred: true, oberon: 'standard' },
        5
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Too many Evil special roles'))).toBe(true);
    });

    it('accepts Morgana + Mordred + Oberon in 10-player game (4 evil slots)', () => {
      const result = validateRoleConfig(
        { merlin: true, morgana: true, mordred: true, oberon: 'standard' },
        10
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('balance warnings', () => {
    it('warns when Percival without Morgana', () => {
      const result = validateRoleConfig({ merlin: true, percival: true }, 5);
      expect(result.warnings).toContain('Percival works best with Morgana for balance.');
    });

    it('warns when Morgana without Percival', () => {
      const result = validateRoleConfig({ merlin: true, morgana: true }, 5);
      expect(result.warnings).toContain(
        "Morgana's disguise ability has no effect without Percival."
      );
    });

    it('no warnings when both Percival and Morgana', () => {
      const result = validateRoleConfig({ merlin: true, percival: true, morgana: true }, 5);
      expect(result.warnings).not.toContain('Percival works best with Morgana for balance.');
      expect(result.warnings).not.toContain(
        "Morgana's disguise ability has no effect without Percival."
      );
    });
  });

  describe('Lady of Lake warnings', () => {
    it('warns when Lady of Lake in small game', () => {
      const result = validateRoleConfig({ merlin: true, ladyOfLake: true }, 5);
      expect(result.warnings.some(w => w.includes('Lady of the Lake is recommended'))).toBe(true);
    });

    it('no warning when Lady of Lake in 7+ player game', () => {
      const result = validateRoleConfig({ merlin: true, ladyOfLake: true }, 7);
      expect(result.warnings.some(w => w.includes('Lady of the Lake is recommended'))).toBe(false);
    });
  });

  describe('hidden evil warnings', () => {
    it('warns when multiple evil hidden from Merlin', () => {
      const result = validateRoleConfig({ merlin: true, mordred: true, oberon: 'chaos' }, 7);
      expect(result.warnings.some(w => w.includes('hidden from Merlin'))).toBe(true);
    });

    it('no warning for single hidden evil', () => {
      const result = validateRoleConfig({ merlin: true, mordred: true }, 7);
      expect(result.warnings.some(w => w.includes('Multiple evil'))).toBe(false);
    });
  });

  describe('Merlin in or out', () => {
    it('refuses a setup with no merlin key', () => {
      const result = validateRoleConfig({} as RoleConfig, 5);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('merlin must be true or false'))).toBe(true);
    });

    it('refuses a setup whose merlin is not a boolean', () => {
      const result = validateRoleConfig({ merlin: 'yes' } as unknown as RoleConfig, 5);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('merlin must be true or false'))).toBe(true);
    });

    it('accepts a 5-player setup without Merlin', () => {
      const result = validateRoleConfig({ merlin: false }, 5);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a 7-player setup without Merlin but with Oberon (Standard) and the Lunatic', () => {
      const result = validateRoleConfig({ merlin: false, oberon: 'standard', lunatic: true }, 7);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('gives the Assassin\'s seat to another evil role without Merlin', () => {
      // 7 players have 3 evil seats: with Merlin the Assassin takes one of them
      const roles: RoleConfig = { merlin: false, oberon: 'standard', lunatic: true, brute: true };
      expect(validateRoleConfig(roles, 7).valid).toBe(true);
      expect(validateRoleConfig({ ...roles, merlin: true }, 7).errors).toContain(
        'Too many Evil special roles (4) for 7-player game (max 3 Evil).'
      );
    });

    it.each(needsMerlin)('refuses $name without Merlin, naming both', ({ name, options }) => {
      const result = validateRoleConfig({ merlin: false, ...options }, 7);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].startsWith(`${name} `)).toBe(true);
      expect(result.errors[0]).toContain('requires Merlin');
    });

    it.each(needsMerlin)('accepts $name with Merlin', ({ options }) => {
      expect(validateRoleConfig({ merlin: true, ...options }, 7).valid).toBe(true);
    });
  });
});

describe('isDefaultConfig', () => {
  it('reads a setup with only Merlin as the default', () => {
    expect(isDefaultConfig(getDefaultConfig())).toBe(true);
    expect(isDefaultConfig({ merlin: true })).toBe(true);
  });

  it('reads options that are present but off as the default', () => {
    expect(isDefaultConfig({ merlin: true, percival: false, merlin_decoy_enabled: undefined })).toBe(true);
  });

  it('does not read a setup without Merlin as the default', () => {
    expect(isDefaultConfig({ merlin: false })).toBe(false);
  });

  it('does not read a setup with any other option on as the default', () => {
    expect(isDefaultConfig({ merlin: true, oberon: 'standard' })).toBe(false);
    expect(isDefaultConfig({ merlin: true, ladyOfLake: true })).toBe(false);
    expect(isDefaultConfig({ merlin: true, evil_ring_visibility_enabled: true })).toBe(false);
  });
});

describe('setMerlin', () => {
  it('switching Merlin off clears Percival, Mordred, Morgana, Oberon (Chaos) and Split Intel', () => {
    const config: RoleConfig = {
      merlin: true,
      percival: true,
      mordred: true,
      morgana: true,
      oberon: 'chaos',
      merlin_split_intel_enabled: true,
    };
    expect(setMerlin(config, false)).toEqual({ merlin: false });
  });

  it.each(needsMerlin)('switching Merlin off clears $name, leaving a valid setup', ({ options }) => {
    const off = setMerlin({ merlin: true, ...options }, false);
    expect(off.merlin).toBe(false);
    expect(validateRoleConfig(off, 7).valid).toBe(true);
  });

  it('switching Merlin off clears each intel mode', () => {
    expect(setMerlin({ merlin: true, merlin_decoy_enabled: true }, false)).toEqual({ merlin: false });
    expect(setMerlin({ merlin: true, merlin_split_intel_enabled: true }, false)).toEqual({ merlin: false });
    expect(
      setMerlin({ merlin: true, oberon: 'standard', oberon_split_intel_enabled: true }, false)
    ).toEqual({ merlin: false, oberon: 'standard' });
  });

  it('switching Merlin off keeps Oberon (Standard), the Lunatic, the Brute and the game options', () => {
    const kept = {
      oberon: 'standard',
      lunatic: true,
      brute: true,
      ladyOfLake: true,
      evil_ring_visibility_enabled: true,
    } as const;
    expect(setMerlin({ merlin: true, ...kept }, false)).toEqual({ merlin: false, ...kept });
  });

  it('switching Merlin on keeps the rest of the setup', () => {
    expect(setMerlin({ merlin: false, oberon: 'standard', lunatic: true }, true)).toEqual({
      merlin: true,
      oberon: 'standard',
      lunatic: true,
    });
  });

  it('does not change the setup it is given', () => {
    const config: RoleConfig = { merlin: true, percival: true, oberon: 'chaos' };
    setMerlin(config, false);
    expect(config).toEqual({ merlin: true, percival: true, oberon: 'chaos' });
  });
});

describe('configForPlayerCount', () => {
  it('keeps a setup that is still valid at the new count', () => {
    const config: RoleConfig = { merlin: false, oberon: 'standard' };
    expect(configForPlayerCount(config, 5)).toBe(config);
  });

  it('resets an invalid setup to the default, keeping Merlin off', () => {
    expect(configForPlayerCount({ merlin: false, lunatic: true }, 5)).toEqual({ merlin: false });
  });

  it('resets an invalid setup to the default, keeping Merlin on', () => {
    expect(configForPlayerCount({ merlin: true, percival: true, lunatic: true }, 5)).toEqual({
      merlin: true,
    });
  });
});

describe('computeRolesInPlay', () => {
  it('includes Merlin and the Assassin with Merlin', () => {
    const roles = computeRolesInPlay({ merlin: true });
    expect(roles).toContain('Merlin');
    expect(roles).toContain('Assassin');
  });

  it('includes Percival when configured', () => {
    const roles = computeRolesInPlay({ merlin: true, percival: true });
    expect(roles).toContain('Percival');
  });

  it('includes Morgana when configured', () => {
    const roles = computeRolesInPlay({ merlin: true, morgana: true });
    expect(roles).toContain('Morgana');
  });

  it('includes Mordred when configured', () => {
    const roles = computeRolesInPlay({ merlin: true, mordred: true });
    expect(roles).toContain('Mordred');
  });

  it('includes Oberon for standard mode', () => {
    const roles = computeRolesInPlay({ merlin: true, oberon: 'standard' });
    expect(roles).toContain('Oberon');
    expect(roles).not.toContain('Oberon (Chaos)');
  });

  it('includes Oberon (Chaos) for chaos mode', () => {
    const roles = computeRolesInPlay({ merlin: true, oberon: 'chaos' });
    expect(roles).toContain('Oberon (Chaos)');
    expect(roles).not.toContain('Oberon');
  });

  it('does not include servant/minion (filler roles)', () => {
    const roles = computeRolesInPlay({ merlin: true });
    expect(roles).not.toContain('Servant');
    expect(roles).not.toContain('Loyal Servant');
    expect(roles).not.toContain('Minion');
  });

  it('includes neither Merlin nor the Assassin without Merlin', () => {
    expect(computeRolesInPlay({ merlin: false })).toEqual([]);
    expect(computeRolesInPlay({ merlin: false, oberon: 'standard', lunatic: true })).toEqual([
      'Oberon',
      'Lunatic',
    ]);
  });

  it('includes the Lunatic and the Brute when configured', () => {
    const roles = computeRolesInPlay({ merlin: true, lunatic: true, brute: true });
    expect(roles).toContain('Lunatic');
    expect(roles).toContain('Brute');
  });
});

describe('getRoleDetails', () => {
  it('returns correct counts for 5-player default config', () => {
    const details = getRoleDetails({ merlin: true }, 5);
    expect(details.goodCount).toBe(3);
    expect(details.evilCount).toBe(2);
    expect(details.goodSpecialCount).toBe(1); // Merlin only
    expect(details.evilSpecialCount).toBe(1); // Assassin only
    expect(details.servantCount).toBe(2);
    expect(details.minionCount).toBe(1);
  });

  it('returns correct counts with Percival + Morgana', () => {
    const details = getRoleDetails({ merlin: true, percival: true, morgana: true }, 5);
    expect(details.goodSpecialCount).toBe(2); // Merlin + Percival
    expect(details.evilSpecialCount).toBe(2); // Assassin + Morgana
    expect(details.servantCount).toBe(1);
    expect(details.minionCount).toBe(0);
  });

  it('returns correct counts for 10-player full config', () => {
    const details = getRoleDetails(
      { merlin: true, percival: true, morgana: true, mordred: true, oberon: 'standard' },
      10
    );
    expect(details.goodCount).toBe(6);
    expect(details.evilCount).toBe(4);
    expect(details.goodSpecialCount).toBe(2); // Merlin + Percival
    expect(details.evilSpecialCount).toBe(4); // Assassin + Morgana + Mordred + Oberon
    expect(details.servantCount).toBe(4);
    expect(details.minionCount).toBe(0);
  });

  it('counts the Lunatic and the Brute as special evil', () => {
    const details = getRoleDetails({ merlin: true, lunatic: true, brute: true }, 8);
    expect(details.evilSpecialCount).toBe(3); // Assassin + Lunatic + Brute
    expect(details.minionCount).toBe(0);
  });

  it('returns correct counts for 5 players without Merlin', () => {
    const details = getRoleDetails({ merlin: false }, 5);
    expect(details.goodSpecialCount).toBe(0);
    expect(details.evilSpecialCount).toBe(0);
    expect(details.servantCount).toBe(3);
    expect(details.minionCount).toBe(2);
  });

  it('counts 7 players without Merlin, with Oberon (Standard) and the Lunatic', () => {
    const details = getRoleDetails({ merlin: false, oberon: 'standard', lunatic: true }, 7);
    expect(details.goodSpecialCount).toBe(0);
    expect(details.servantCount).toBe(4);
    expect(details.evilSpecialCount).toBe(2); // Oberon + Lunatic
    expect(details.minionCount).toBe(1);
  });
});

describe('designateLadyOfLakeHolder', () => {
  it('returns player after manager in order', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const holder = designateLadyOfLakeHolder(players, 'p1');
    expect(holder).toBe('p2'); // Next after p1
  });

  it('wraps around to first player if manager is last', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const holder = designateLadyOfLakeHolder(players, 'p5');
    expect(holder).toBe('p1'); // Wraps to first
  });

  it('returns first player if manager not in list', () => {
    const players = ['p1', 'p2', 'p3'];
    const holder = designateLadyOfLakeHolder(players, 'unknown');
    expect(holder).toBe('p1');
  });

  it('throws if player list is empty', () => {
    expect(() => designateLadyOfLakeHolder([], 'p1')).toThrow();
  });

  it('handles manager in middle of list', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const holder = designateLadyOfLakeHolder(players, 'p3');
    expect(holder).toBe('p4');
  });
});


describe('pickRoleConfig', () => {
  it('keeps the public options and drops distribution keys and unknown keys', () => {
    const sent = {
      merlin: true,
      percival: true,
      oberon: 'standard',
      merlin_decoy_enabled: true,
      _merlin_decoy_player_id: 'p1',
      _evil_ring_assignments: { a: 'b' },
      junk: 'x',
    } as unknown as RoleConfig;
    expect(pickRoleConfig(sent)).toEqual({
      merlin: true,
      percival: true,
      oberon: 'standard',
      merlin_decoy_enabled: true,
    });
  });

  it('keeps merlin: false', () => {
    expect(pickRoleConfig({ merlin: false })).toEqual({ merlin: false });
  });
});
