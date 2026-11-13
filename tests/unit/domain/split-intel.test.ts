/**
 * Unit tests for Split Intel Mode domain logic
 * Feature 011: Merlin Split Intel Mode
 */

import { describe, it, expect } from 'vitest';
import {
  canUseSplitIntelMode,
  distributeSplitIntelGroups,
  getVisibleEvilPlayers,
  getEligibleGoodPlayers,
  validateSplitIntelGroups,
} from '@/lib/domain/split-intel';
import type { RoleAssignment } from '@/lib/domain/visibility';
import type { RoleConfig } from '@/types/role-config';

// Helper to create mock role assignments
function createMockAssignments(
  players: Array<{ id: string; name: string; role: 'good' | 'evil'; specialRole: string }>
): RoleAssignment[] {
  return players.map((p) => ({
    playerId: p.id,
    playerName: p.name,
    role: p.role,
    specialRole: p.specialRole as RoleAssignment['specialRole'],
  }));
}

describe('canUseSplitIntelMode', () => {
  it('returns viable for 3+ visible evil players', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Servant3', role: 'good', specialRole: 'servant' },
      { id: '5', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '6', name: 'Morgana', role: 'evil', specialRole: 'morgana' },
      { id: '7', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const result = canUseSplitIntelMode(assignments, { merlin: true });
    expect(result.viable).toBe(true);
    expect(result.visibleEvilCount).toBe(3);
  });

  it('returns viable for 2 visible evil players', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '5', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const result = canUseSplitIntelMode(assignments, { merlin: true });
    expect(result.viable).toBe(true);
    expect(result.visibleEvilCount).toBe(2);
  });

  it('returns viable for 1 visible evil player', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '5', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
    ]);

    const result = canUseSplitIntelMode(assignments, { merlin: true, mordred: true });
    expect(result.viable).toBe(true);
    expect(result.visibleEvilCount).toBe(1);
  });

  it('returns not viable for 0 visible evil (Mordred + Oberon Chaos)', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
      { id: '5', name: 'OberonChaos', role: 'evil', specialRole: 'oberon_chaos' },
    ]);

    const result = canUseSplitIntelMode(assignments, { merlin: true, mordred: true, oberon: 'chaos' });
    expect(result.viable).toBe(false);
    expect(result.visibleEvilCount).toBe(0);
    expect(result.reason).toContain('Cannot use Split Intel Mode');
  });

  it('excludes Mordred from visible evil count', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Servant3', role: 'good', specialRole: 'servant' },
      { id: '5', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '6', name: 'Morgana', role: 'evil', specialRole: 'morgana' },
      { id: '7', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
    ]);

    const result = canUseSplitIntelMode(assignments, { merlin: true, mordred: true });
    expect(result.viable).toBe(true);
    expect(result.visibleEvilCount).toBe(2); // Assassin + Morgana (Mordred excluded)
  });

  it('excludes Oberon Chaos from visible evil count', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Servant3', role: 'good', specialRole: 'servant' },
      { id: '5', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '6', name: 'Morgana', role: 'evil', specialRole: 'morgana' },
      { id: '7', name: 'OberonChaos', role: 'evil', specialRole: 'oberon_chaos' },
    ]);

    const result = canUseSplitIntelMode(assignments, { merlin: true, oberon: 'chaos' });
    expect(result.viable).toBe(true);
    expect(result.visibleEvilCount).toBe(2); // Assassin + Morgana (Oberon Chaos excluded)
  });
});

describe('distributeSplitIntelGroups', () => {
  it('returns null for 0 visible evil', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
      { id: '5', name: 'OberonChaos', role: 'evil', specialRole: 'oberon_chaos' },
    ]);

    const result = distributeSplitIntelGroups(assignments, { merlin: true, mordred: true, oberon: 'chaos' });
    expect(result).toBeNull();
  });

  it('assigns 2 to Certain + 1 to Mixed for 3+ visible evil', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Servant3', role: 'good', specialRole: 'servant' },
      { id: '5', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '6', name: 'Morgana', role: 'evil', specialRole: 'morgana' },
      { id: '7', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const result = distributeSplitIntelGroups(assignments, { merlin: true });
    expect(result).not.toBeNull();
    expect(result!.certainEvilIds.length).toBe(2);
    expect(result!.mixedEvilId).toBeDefined();
    expect(result!.mixedGoodId).toBeDefined();
    // All evil in groups should be from visible evil
    const allEvilInGroups = [...result!.certainEvilIds, result!.mixedEvilId];
    expect(allEvilInGroups.every((id) => ['5', '6', '7'].includes(id))).toBe(true);
    // Mixed good should not be Merlin
    expect(result!.mixedGoodId).not.toBe('1');
  });

  it('assigns 1 to Certain + 1 to Mixed for 2 visible evil', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '5', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const result = distributeSplitIntelGroups(assignments, { merlin: true });
    expect(result).not.toBeNull();
    expect(result!.certainEvilIds.length).toBe(1);
    expect(result!.mixedEvilId).toBeDefined();
    expect(result!.mixedGoodId).toBeDefined();
    // All evil in groups should be from visible evil
    const allEvilInGroups = [...result!.certainEvilIds, result!.mixedEvilId];
    expect(allEvilInGroups.every((id) => ['4', '5'].includes(id))).toBe(true);
  });

  it('assigns 0 to Certain + 1 to Mixed for 1 visible evil', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '5', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
    ]);

    const result = distributeSplitIntelGroups(assignments, { merlin: true, mordred: true });
    expect(result).not.toBeNull();
    expect(result!.certainEvilIds.length).toBe(0);
    expect(result!.mixedEvilId).toBe('4'); // Only visible evil is Assassin
    expect(result!.mixedGoodId).toBeDefined();
    expect(['2', '3']).toContain(result!.mixedGoodId); // Should be Servant1 or Servant2
  });

  it('excludes Merlin from eligible good players', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '5', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    // Run multiple times to check randomness never picks Merlin
    for (let i = 0; i < 10; i++) {
      const result = distributeSplitIntelGroups(assignments, { merlin: true });
      expect(result).not.toBeNull();
      expect(result!.mixedGoodId).not.toBe('1'); // Merlin ID
    }
  });
});

describe('getVisibleEvilPlayers', () => {
  it('returns all evil players when no hidden roles', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '3', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const result = getVisibleEvilPlayers(assignments);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.playerId)).toContain('2');
    expect(result.map((r) => r.playerId)).toContain('3');
  });

  it('excludes Mordred', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '3', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
    ]);

    const result = getVisibleEvilPlayers(assignments);
    expect(result.length).toBe(1);
    expect(result[0].playerId).toBe('2');
  });

  it('excludes Oberon Chaos', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '3', name: 'OberonChaos', role: 'evil', specialRole: 'oberon_chaos' },
    ]);

    const result = getVisibleEvilPlayers(assignments);
    expect(result.length).toBe(1);
    expect(result[0].playerId).toBe('2');
  });

  it('includes Oberon Standard (visible to Merlin)', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '3', name: 'OberonStandard', role: 'evil', specialRole: 'oberon_standard' },
    ]);

    const result = getVisibleEvilPlayers(assignments);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.playerId)).toContain('2');
    expect(result.map((r) => r.playerId)).toContain('3');
  });
});

describe('getEligibleGoodPlayers', () => {
  it('returns good players except Merlin', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Percival', role: 'good', specialRole: 'percival' },
      { id: '3', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
    ]);

    const result = getEligibleGoodPlayers(assignments);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.playerId)).toContain('2');
    expect(result.map((r) => r.playerId)).toContain('3');
    expect(result.map((r) => r.playerId)).not.toContain('1');
  });

  it('excludes evil players', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
    ]);

    const result = getEligibleGoodPlayers(assignments);
    expect(result.length).toBe(1);
    expect(result[0].playerId).toBe('2');
  });
});

describe('validateSplitIntelGroups', () => {
  it('validates correct groups', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '4', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const groups = {
      certainEvilIds: ['3'],
      mixedEvilId: '4',
      mixedGoodId: '2',
    };

    expect(validateSplitIntelGroups(groups, assignments)).toBe(true);
  });

  it('rejects groups with Mordred in certain evil', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
      { id: '4', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const groups = {
      certainEvilIds: ['3'], // Mordred - invalid!
      mixedEvilId: '4',
      mixedGoodId: '2',
    };

    expect(validateSplitIntelGroups(groups, assignments)).toBe(false);
  });

  it('rejects groups with Merlin in mixed good', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '4', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const groups = {
      certainEvilIds: ['3'],
      mixedEvilId: '4',
      mixedGoodId: '1', // Merlin - invalid!
    };

    expect(validateSplitIntelGroups(groups, assignments)).toBe(false);
  });

  it('rejects groups with good player in mixed evil', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '4', name: 'Minion', role: 'evil', specialRole: 'minion' },
    ]);

    const groups = {
      certainEvilIds: ['3'],
      mixedEvilId: '2', // Good player - invalid!
      mixedGoodId: '2',
    };

    expect(validateSplitIntelGroups(groups, assignments)).toBe(false);
  });
});

describe('edge cases', () => {
  it('handles 5-player game with Mordred (only 1 visible evil)', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '5', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
    ]);

    const viability = canUseSplitIntelMode(assignments, { merlin: true, mordred: true });
    expect(viability.viable).toBe(true);
    expect(viability.visibleEvilCount).toBe(1);

    const result = distributeSplitIntelGroups(assignments, { merlin: true, mordred: true });
    expect(result).not.toBeNull();
    expect(result!.certainEvilIds.length).toBe(0); // 0 in certain for 1 visible
    expect(result!.mixedEvilId).toBe('4'); // Only Assassin is visible
    expect(['2', '3']).toContain(result!.mixedGoodId);
  });

  it('handles 7-player game with Mordred + Oberon Chaos (1 visible evil)', () => {
    const assignments = createMockAssignments([
      { id: '1', name: 'Merlin', role: 'good', specialRole: 'merlin' },
      { id: '2', name: 'Servant1', role: 'good', specialRole: 'servant' },
      { id: '3', name: 'Servant2', role: 'good', specialRole: 'servant' },
      { id: '4', name: 'Servant3', role: 'good', specialRole: 'servant' },
      { id: '5', name: 'Assassin', role: 'evil', specialRole: 'assassin' },
      { id: '6', name: 'Mordred', role: 'evil', specialRole: 'mordred' },
      { id: '7', name: 'OberonChaos', role: 'evil', specialRole: 'oberon_chaos' },
    ]);

    const viability = canUseSplitIntelMode(assignments, { merlin: true, mordred: true, oberon: 'chaos' });
    expect(viability.viable).toBe(true);
    expect(viability.visibleEvilCount).toBe(1);

    const result = distributeSplitIntelGroups(assignments, { merlin: true, mordred: true, oberon: 'chaos' });
    expect(result).not.toBeNull();
    expect(result!.certainEvilIds.length).toBe(0);
    expect(result!.mixedEvilId).toBe('5'); // Only Assassin is visible
    expect(['2', '3', '4']).toContain(result!.mixedGoodId);
  });
});

