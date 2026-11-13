/**
 * Unit tests for visibility matrix domain logic
 * T017: Tests for getVisibilityForRole and related visibility functions
 */

import { describe, it, expect } from 'vitest';
import {
  getVisibilityForRole,
  getMerlinVisibility,
  getPercivalVisibility,
  getEvilVisibility,
  getOberonVisibility,
  getPlayersVisibleToMerlin,
  getMerlinCandidates,
  getEvilTeammatesExcludingOberon,
  countHiddenEvilFromMerlin,
  canSeeEvilTeammates,
  isVisibleToMerlin,
  appearsAsMerlinToPercival,
  generateDecoyWarning,
  type RoleAssignment,
} from '@/lib/domain/visibility';
import type { RoleConfig } from '@/types/role-config';

// Test data factory
function createAssignments(): RoleAssignment[] {
  return [
    { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
    { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
    { playerId: 'p3', playerName: 'Carol', role: 'good', specialRole: 'servant' },
    { playerId: 'p4', playerName: 'Dave', role: 'evil', specialRole: 'assassin' },
    { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'morgana' },
  ];
}

function createFullAssignments(): RoleAssignment[] {
  return [
    { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
    { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
    { playerId: 'p3', playerName: 'Carol', role: 'good', specialRole: 'servant' },
    { playerId: 'p4', playerName: 'Dave', role: 'good', specialRole: 'servant' },
    { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
    { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'morgana' },
    { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'mordred' },
  ];
}

describe('getMerlinVisibility', () => {
  it('sees all evil except Mordred', () => {
    const assignments = createFullAssignments();
    const config: RoleConfig = { merlin: true, percival: true, morgana: true, mordred: true };

    const result = getMerlinVisibility(assignments, config);

    expect(result.knownPlayers.map(p => p.name)).toContain('Eve'); // Assassin
    expect(result.knownPlayers.map(p => p.name)).toContain('Frank'); // Morgana
    expect(result.knownPlayers.map(p => p.name)).not.toContain('Grace'); // Mordred - hidden!
  });

  it('sees all evil except Oberon Chaos', () => {
    const assignments: RoleAssignment[] = [
      { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
      { playerId: 'p2', playerName: 'Bob', role: 'evil', specialRole: 'assassin' },
      { playerId: 'p3', playerName: 'Carol', role: 'evil', specialRole: 'oberon_chaos' },
    ];
    const config: RoleConfig = { merlin: true, oberon: 'chaos' };

    const result = getMerlinVisibility(assignments, config);

    expect(result.knownPlayers.map(p => p.name)).toContain('Bob'); // Assassin visible
    expect(result.knownPlayers.map(p => p.name)).not.toContain('Carol'); // Oberon Chaos hidden
  });

  it('sees Oberon Standard', () => {
    const assignments: RoleAssignment[] = [
      { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
      { playerId: 'p2', playerName: 'Bob', role: 'evil', specialRole: 'assassin' },
      { playerId: 'p3', playerName: 'Carol', role: 'evil', specialRole: 'oberon_standard' },
    ];
    const config: RoleConfig = { merlin: true, oberon: 'standard' };

    const result = getMerlinVisibility(assignments, config);

    expect(result.knownPlayers.map(p => p.name)).toContain('Carol'); // Oberon Standard visible
  });

  it('counts hidden evil correctly', () => {
    const config: RoleConfig = { merlin: true, mordred: true, oberon: 'chaos' };
    const result = getMerlinVisibility([], config);

    expect(result.hiddenEvilCount).toBe(2);
    expect(result.abilityNote).toContain('2 evil players are hidden');
  });

  it('has correct label', () => {
    const result = getMerlinVisibility([], { merlin: true });
    expect(result.knownPlayersLabel).toBe('Evil Players Known to You');
  });
});

describe('getPercivalVisibility', () => {
  it('sees both Merlin and Morgana', () => {
    const assignments = createAssignments();
    const config: RoleConfig = { merlin: true, percival: true, morgana: true };

    const result = getPercivalVisibility(assignments, config);

    expect(result.knownPlayers).toHaveLength(2);
    expect(result.knownPlayers.map(p => p.name)).toContain('Alice'); // Merlin
    expect(result.knownPlayers.map(p => p.name)).toContain('Eve'); // Morgana
  });

  it('sees only Merlin when no Morgana', () => {
    const assignments: RoleAssignment[] = [
      { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
      { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
      { playerId: 'p3', playerName: 'Carol', role: 'evil', specialRole: 'assassin' },
    ];
    const config: RoleConfig = { merlin: true, percival: true };

    const result = getPercivalVisibility(assignments, config);

    expect(result.knownPlayers).toHaveLength(1);
    expect(result.knownPlayers[0].name).toBe('Alice');
    expect(result.knownPlayersLabel).toBe('Merlin');
  });

  it('shows ambiguous label when multiple candidates', () => {
    const assignments = createAssignments();
    const config: RoleConfig = { merlin: true, percival: true, morgana: true };

    const result = getPercivalVisibility(assignments, config);

    expect(result.knownPlayersLabel).toBe('One of These is Merlin');
  });

  it('warns about Morgana when present', () => {
    const assignments = createAssignments();
    const config: RoleConfig = { merlin: true, morgana: true };

    const result = getPercivalVisibility(assignments, config);

    expect(result.abilityNote).toContain('Morgana appears the same');
  });
});

describe('getEvilVisibility', () => {
  it('assassin sees other evil except Oberon', () => {
    const assignments: RoleAssignment[] = [
      { playerId: 'p1', playerName: 'Alice', role: 'evil', specialRole: 'assassin' },
      { playerId: 'p2', playerName: 'Bob', role: 'evil', specialRole: 'morgana' },
      { playerId: 'p3', playerName: 'Carol', role: 'evil', specialRole: 'oberon_standard' },
    ];
    const config: RoleConfig = { merlin: true };

    const result = getEvilVisibility('p1', 'assassin', assignments, config);

    expect(result.knownPlayers).toHaveLength(1); // Only Morgana
    expect(result.knownPlayers[0].name).toBe('Bob');
    expect(result.knownPlayers.map(p => p.name)).not.toContain('Carol'); // Oberon hidden
  });

  it('morgana shows disguise ability note when Percival present', () => {
    const config: RoleConfig = { merlin: true, percival: true, morgana: true };

    const result = getEvilVisibility('p1', 'morgana', [], config);

    expect(result.abilityNote).toContain('appear as Merlin to Percival');
  });

  it('morgana shows no effect note when no Percival', () => {
    const config: RoleConfig = { merlin: true, morgana: true };

    const result = getEvilVisibility('p1', 'morgana', [], config);

    expect(result.abilityNote).toContain('no effect');
  });

  it('mordred shows hidden from Merlin note', () => {
    const config: RoleConfig = { merlin: true, mordred: true };

    const result = getEvilVisibility('p1', 'mordred', [], config);

    expect(result.abilityNote).toContain('Merlin does not know you are evil');
  });

  it('assassin shows assassination ability note', () => {
    const result = getEvilVisibility('p1', 'assassin', [], { merlin: true });

    expect(result.abilityNote).toContain('identify Merlin');
  });
});

describe('getOberonVisibility', () => {
  it('standard mode shows Merlin can see you', () => {
    const result = getOberonVisibility('standard', { merlin: true });

    expect(result.knownPlayers).toHaveLength(0);
    expect(result.abilityNote).toContain('Merlin can see you');
  });

  it('chaos mode shows complete isolation', () => {
    const result = getOberonVisibility('chaos', { merlin: true });

    expect(result.knownPlayers).toHaveLength(0);
    expect(result.abilityNote).toContain('not even Merlin');
  });
});

describe('getVisibilityForRole', () => {
  it('returns correct visibility for each role type', () => {
    const assignments = createAssignments();
    const config: RoleConfig = { merlin: true, percival: true, morgana: true };

    // Test Merlin
    const merlinResult = getVisibilityForRole('p1', 'merlin', assignments, config);
    expect(merlinResult.knownPlayersLabel).toBe('Evil Players Known to You');

    // Test Percival
    const percivalResult = getVisibilityForRole('p2', 'percival', assignments, config);
    expect(percivalResult.knownPlayersLabel).toBe('One of These is Merlin');

    // Test Servant
    const servantResult = getVisibilityForRole('p3', 'servant', assignments, config);
    expect(servantResult.knownPlayers).toHaveLength(0);

    // Test Assassin
    const assassinResult = getVisibilityForRole('p4', 'assassin', assignments, config);
    expect(assassinResult.knownPlayersLabel).toBe('Your Evil Teammates');
  });
});

describe('utility functions', () => {
  describe('getPlayersVisibleToMerlin', () => {
    it('excludes Mordred and Oberon Chaos', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'A', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p2', playerName: 'B', role: 'evil', specialRole: 'mordred' },
        { playerId: 'p3', playerName: 'C', role: 'evil', specialRole: 'oberon_chaos' },
        { playerId: 'p4', playerName: 'D', role: 'evil', specialRole: 'oberon_standard' },
      ];

      const visible = getPlayersVisibleToMerlin(assignments);

      expect(visible.map(p => p.name)).toEqual(['A', 'D']);
    });
  });

  describe('getMerlinCandidates', () => {
    it('returns Merlin and Morgana only', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', playerName: 'Carol', role: 'evil', specialRole: 'morgana' },
        { playerId: 'p4', playerName: 'Dave', role: 'evil', specialRole: 'assassin' },
      ];

      const candidates = getMerlinCandidates(assignments);

      expect(candidates.map(p => p.name)).toEqual(['Alice', 'Carol']);
    });
  });

  describe('getEvilTeammatesExcludingOberon', () => {
    it('excludes self and Oberon variants', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'A', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p2', playerName: 'B', role: 'evil', specialRole: 'morgana' },
        { playerId: 'p3', playerName: 'C', role: 'evil', specialRole: 'oberon_standard' },
        { playerId: 'p4', playerName: 'D', role: 'evil', specialRole: 'minion' },
      ];

      const teammates = getEvilTeammatesExcludingOberon(assignments, 'p1');

      expect(teammates.map(p => p.name)).toEqual(['B', 'D']);
    });
  });

  describe('countHiddenEvilFromMerlin', () => {
    it('counts Mordred as hidden', () => {
      expect(countHiddenEvilFromMerlin({ merlin: true, mordred: true })).toBe(1);
    });

    it('counts Oberon Chaos as hidden', () => {
      expect(countHiddenEvilFromMerlin({ merlin: true, oberon: 'chaos' })).toBe(1);
    });

    it('does not count Oberon Standard', () => {
      expect(countHiddenEvilFromMerlin({ merlin: true, oberon: 'standard' })).toBe(0);
    });

    it('counts both Mordred and Oberon Chaos', () => {
      expect(countHiddenEvilFromMerlin({ merlin: true, mordred: true, oberon: 'chaos' })).toBe(2);
    });
  });

  describe('canSeeEvilTeammates', () => {
    it('returns true for standard evil roles', () => {
      expect(canSeeEvilTeammates('assassin')).toBe(true);
      expect(canSeeEvilTeammates('morgana')).toBe(true);
      expect(canSeeEvilTeammates('mordred')).toBe(true);
      expect(canSeeEvilTeammates('minion')).toBe(true);
    });

    it('returns false for Oberon and good roles', () => {
      expect(canSeeEvilTeammates('oberon_standard')).toBe(false);
      expect(canSeeEvilTeammates('oberon_chaos')).toBe(false);
      expect(canSeeEvilTeammates('merlin')).toBe(false);
      expect(canSeeEvilTeammates('percival')).toBe(false);
      expect(canSeeEvilTeammates('servant')).toBe(false);
    });
  });

  describe('isVisibleToMerlin', () => {
    it('returns true for most evil roles', () => {
      expect(isVisibleToMerlin('assassin')).toBe(true);
      expect(isVisibleToMerlin('morgana')).toBe(true);
      expect(isVisibleToMerlin('oberon_standard')).toBe(true);
      expect(isVisibleToMerlin('minion')).toBe(true);
    });

    it('returns false for Mordred and Oberon Chaos', () => {
      expect(isVisibleToMerlin('mordred')).toBe(false);
      expect(isVisibleToMerlin('oberon_chaos')).toBe(false);
    });
  });

  describe('appearsAsMerlinToPercival', () => {
    it('returns true for Merlin and Morgana', () => {
      expect(appearsAsMerlinToPercival('merlin')).toBe(true);
      expect(appearsAsMerlinToPercival('morgana')).toBe(true);
    });

    it('returns false for other roles', () => {
      expect(appearsAsMerlinToPercival('percival')).toBe(false);
      expect(appearsAsMerlinToPercival('servant')).toBe(false);
      expect(appearsAsMerlinToPercival('assassin')).toBe(false);
      expect(appearsAsMerlinToPercival('mordred')).toBe(false);
    });
  });
});

// ============================================
// Feature 009: Merlin Decoy Mode Tests
// T017, T052-T055: Visibility combinations with decoy
// ============================================

describe('generateDecoyWarning', () => {
  it('returns base warning when no hidden evil', () => {
    const warning = generateDecoyWarning(0);
    expect(warning).toBe('⚠️ One of these players is actually good!');
  });

  it('includes 1 hidden evil message', () => {
    const warning = generateDecoyWarning(1);
    expect(warning).toContain('One of these players is actually good');
    expect(warning).toContain('1 evil player is hidden');
  });

  it('includes 2 hidden evil message', () => {
    const warning = generateDecoyWarning(2);
    expect(warning).toContain('One of these players is actually good');
    expect(warning).toContain('2 evil players are hidden');
  });
});

describe('Merlin Decoy Mode Visibility Combinations', () => {
  // Test data: 7-player game (4 good, 3 evil)
  const createDecoyTestAssignments = (): RoleAssignment[] => [
    { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
    { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
    { playerId: 'p3', playerName: 'Charlie', role: 'good', specialRole: 'servant' },
    { playerId: 'p4', playerName: 'Diana', role: 'good', specialRole: 'servant' },
    { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
    { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'morgana' },
    { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
  ];

  // T052: Combination 1 - Decoy only (no hidden roles)
  describe('Combination 1: Decoy Only (No Hidden Roles)', () => {
    it('Merlin sees all evil + 1 decoy = 4 players', () => {
      const assignments = createDecoyTestAssignments();
      const config: RoleConfig = { merlin: true, merlin_decoy_enabled: true };
      const decoyPlayerId = 'p2'; // Bob (Percival)

      const result = getMerlinVisibility(assignments, config, decoyPlayerId);

      // Should see 3 evil + 1 decoy = 4 players
      expect(result.knownPlayers).toHaveLength(4);
      expect(result.knownPlayers.map(p => p.id)).toContain('p2'); // Decoy (Bob)
      expect(result.knownPlayers.map(p => p.id)).toContain('p5'); // Eve
      expect(result.knownPlayers.map(p => p.id)).toContain('p6'); // Frank
      expect(result.knownPlayers.map(p => p.id)).toContain('p7'); // Grace
    });

    it('shows correct warning for 0 hidden', () => {
      const assignments = createDecoyTestAssignments();
      const config: RoleConfig = { merlin: true, merlin_decoy_enabled: true };

      const result = getMerlinVisibility(assignments, config, 'p2');

      expect(result.hasDecoy).toBe(true);
      expect(result.decoyWarning).toBe('⚠️ One of these players is actually good!');
      expect(result.hiddenEvilCount).toBe(0);
    });
  });

  // T053: Combination 2 - Decoy + Mordred
  describe('Combination 2: Decoy + Mordred', () => {
    it('Merlin sees (evil - Mordred) + decoy = 3 players', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
        { playerId: 'p3', playerName: 'Charlie', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', playerName: 'Diana', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'mordred' },
        { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
      ];
      const config: RoleConfig = { merlin: true, mordred: true, merlin_decoy_enabled: true };
      const decoyPlayerId = 'p2'; // Bob

      const result = getMerlinVisibility(assignments, config, decoyPlayerId);

      // Should see 2 evil (Assassin, Minion) + 1 decoy = 3 players
      // Mordred (Frank) is hidden
      expect(result.knownPlayers).toHaveLength(3);
      expect(result.knownPlayers.map(p => p.id)).not.toContain('p6'); // Mordred hidden
      expect(result.knownPlayers.map(p => p.id)).toContain('p2'); // Decoy
      expect(result.hiddenEvilCount).toBe(1);
    });

    it('shows correct warning for 1 hidden', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p4', playerName: 'Frank', role: 'evil', specialRole: 'mordred' },
      ];
      const config: RoleConfig = { merlin: true, mordred: true, merlin_decoy_enabled: true };

      const result = getMerlinVisibility(assignments, config, 'p2');

      expect(result.decoyWarning).toContain('1 evil player is hidden');
    });
  });

  // Combination 3 - Decoy + Oberon Standard (Oberon visible to Merlin)
  describe('Combination 3: Decoy + Oberon Standard', () => {
    it('Merlin sees all evil (including Oberon Standard) + decoy = 4 players', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
        { playerId: 'p3', playerName: 'Charlie', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', playerName: 'Diana', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'oberon_standard' },
        { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
      ];
      const config: RoleConfig = { merlin: true, oberon: 'standard', merlin_decoy_enabled: true };
      const decoyPlayerId = 'p2'; // Bob

      const result = getMerlinVisibility(assignments, config, decoyPlayerId);

      // Oberon Standard is visible to Merlin
      // Should see 3 evil + 1 decoy = 4 players
      expect(result.knownPlayers).toHaveLength(4);
      expect(result.knownPlayers.map(p => p.id)).toContain('p6'); // Oberon Standard visible
      expect(result.knownPlayers.map(p => p.id)).toContain('p2'); // Decoy
      expect(result.hiddenEvilCount).toBe(0);
      expect(result.decoyWarning).toBe('⚠️ One of these players is actually good!');
    });
  });

  // T054: Combination 4 - Decoy + Oberon Chaos
  describe('Combination 4: Decoy + Oberon Chaos', () => {
    it('Merlin sees (evil - Oberon Chaos) + decoy = 3 players', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
        { playerId: 'p3', playerName: 'Charlie', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', playerName: 'Diana', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'oberon_chaos' },
        { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
      ];
      const config: RoleConfig = { merlin: true, oberon: 'chaos', merlin_decoy_enabled: true };
      const decoyPlayerId = 'p2'; // Bob

      const result = getMerlinVisibility(assignments, config, decoyPlayerId);

      // Oberon Chaos is hidden from Merlin
      // Should see 2 evil (Assassin, Minion) + 1 decoy = 3 players
      expect(result.knownPlayers).toHaveLength(3);
      expect(result.knownPlayers.map(p => p.id)).not.toContain('p6'); // Oberon Chaos hidden
      expect(result.knownPlayers.map(p => p.id)).toContain('p2'); // Decoy
      expect(result.hiddenEvilCount).toBe(1);
    });

    it('shows correct warning for 1 hidden (Oberon Chaos)', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', playerName: 'Eve', role: 'evil', specialRole: 'assassin' },
        { playerId: 'p4', playerName: 'Frank', role: 'evil', specialRole: 'oberon_chaos' },
      ];
      const config: RoleConfig = { merlin: true, oberon: 'chaos', merlin_decoy_enabled: true };

      const result = getMerlinVisibility(assignments, config, 'p2');

      expect(result.decoyWarning).toContain('1 evil player is hidden');
    });
  });

  // Combination 5 - Decoy + Mordred + Oberon Standard
  describe('Combination 5: Decoy + Mordred + Oberon Standard', () => {
    it('Merlin sees (evil - Mordred + Oberon Standard) + decoy = 3 players', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
        { playerId: 'p3', playerName: 'Charlie', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', playerName: 'Diana', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'mordred' },
        { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'oberon_standard' },
        { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
      ];
      const config: RoleConfig = { merlin: true, mordred: true, oberon: 'standard', merlin_decoy_enabled: true };
      const decoyPlayerId = 'p2'; // Bob

      const result = getMerlinVisibility(assignments, config, decoyPlayerId);

      // Mordred hidden, Oberon Standard visible
      // Should see 2 evil (Oberon Standard, Minion) + 1 decoy = 3 players
      expect(result.knownPlayers).toHaveLength(3);
      expect(result.knownPlayers.map(p => p.id)).not.toContain('p5'); // Mordred hidden
      expect(result.knownPlayers.map(p => p.id)).toContain('p6'); // Oberon Standard visible
      expect(result.knownPlayers.map(p => p.id)).toContain('p2'); // Decoy
      expect(result.hiddenEvilCount).toBe(1);
      expect(result.decoyWarning).toContain('1 evil player is hidden');
    });
  });

  // T055: Combination 6 - Decoy + Mordred + Oberon Chaos (Maximum Hidden)
  describe('Combination 6: Decoy + Mordred + Oberon Chaos (Maximum Hidden)', () => {
    it('Merlin sees (evil - Mordred - Oberon Chaos) + decoy = 2 players', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'percival' },
        { playerId: 'p3', playerName: 'Charlie', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', playerName: 'Diana', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', playerName: 'Eve', role: 'evil', specialRole: 'mordred' },
        { playerId: 'p6', playerName: 'Frank', role: 'evil', specialRole: 'oberon_chaos' },
        { playerId: 'p7', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
      ];
      const config: RoleConfig = { merlin: true, mordred: true, oberon: 'chaos', merlin_decoy_enabled: true };
      const decoyPlayerId = 'p2'; // Bob

      const result = getMerlinVisibility(assignments, config, decoyPlayerId);

      // Both Mordred and Oberon Chaos hidden
      // Should see 1 evil (Minion) + 1 decoy = 2 players
      expect(result.knownPlayers).toHaveLength(2);
      expect(result.knownPlayers.map(p => p.id)).not.toContain('p5'); // Mordred hidden
      expect(result.knownPlayers.map(p => p.id)).not.toContain('p6'); // Oberon Chaos hidden
      expect(result.knownPlayers.map(p => p.id)).toContain('p7'); // Minion visible
      expect(result.knownPlayers.map(p => p.id)).toContain('p2'); // Decoy
      expect(result.hiddenEvilCount).toBe(2);
    });

    it('shows correct warning for 2 hidden', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', playerName: 'Alice', role: 'good', specialRole: 'merlin' },
        { playerId: 'p2', playerName: 'Bob', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', playerName: 'Eve', role: 'evil', specialRole: 'mordred' },
        { playerId: 'p4', playerName: 'Frank', role: 'evil', specialRole: 'oberon_chaos' },
        { playerId: 'p5', playerName: 'Grace', role: 'evil', specialRole: 'minion' },
      ];
      const config: RoleConfig = { merlin: true, mordred: true, oberon: 'chaos', merlin_decoy_enabled: true };

      const result = getMerlinVisibility(assignments, config, 'p2');

      expect(result.decoyWarning).toContain('2 evil players are hidden');
    });
  });

  describe('Decoy mode edge cases', () => {
    it('does not add decoy if decoy mode disabled', () => {
      const assignments = createDecoyTestAssignments();
      const config: RoleConfig = { merlin: true, merlin_decoy_enabled: false };

      const result = getMerlinVisibility(assignments, config, 'p2');

      // Should only see 3 evil (no decoy)
      expect(result.knownPlayers).toHaveLength(3);
      expect(result.hasDecoy).toBeFalsy();
      expect(result.decoyWarning).toBeUndefined();
    });

    it('does not add decoy if decoyPlayerId is null', () => {
      const assignments = createDecoyTestAssignments();
      const config: RoleConfig = { merlin: true, merlin_decoy_enabled: true };

      const result = getMerlinVisibility(assignments, config, null);

      expect(result.knownPlayers).toHaveLength(3);
      expect(result.hasDecoy).toBe(false);
    });

    it('does not add decoy if decoyPlayerId not found', () => {
      const assignments = createDecoyTestAssignments();
      const config: RoleConfig = { merlin: true, merlin_decoy_enabled: true };

      const result = getMerlinVisibility(assignments, config, 'unknown-player');

      // Decoy player not found, so they won't be added
      expect(result.knownPlayers).toHaveLength(3);
    });

    it('shuffles the player list when decoy is added', () => {
      const assignments = createDecoyTestAssignments();
      const config: RoleConfig = { merlin: true, merlin_decoy_enabled: true };

      // Run multiple times and check for different orderings
      const orderings = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = getMerlinVisibility(assignments, config, 'p2');
        orderings.add(result.knownPlayers.map(p => p.id).join(','));
      }

      // Should have multiple orderings due to shuffling
      // (Very unlikely to get same ordering 50 times in a row)
      expect(orderings.size).toBeGreaterThan(1);
    });
  });
});
