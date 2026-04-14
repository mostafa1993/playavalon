/**
 * Unit tests for role distribution logic
 * Tests the pure functions in src/lib/domain/roles.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRoleRatio,
  shuffleArray,
  distributeRoles,
  getRoleInfo,
  validateRoleDistribution,
  type RoleAssignment,
} from '@/lib/domain/roles';
import { ROLE_RATIOS } from '@/lib/utils/constants';

describe('roles', () => {
  describe('getRoleRatio', () => {
    it('should return correct ratios for all valid player counts', () => {
      expect(getRoleRatio(5)).toEqual({ good: 3, evil: 2 });
      expect(getRoleRatio(6)).toEqual({ good: 4, evil: 2 });
      expect(getRoleRatio(7)).toEqual({ good: 4, evil: 3 });
      expect(getRoleRatio(8)).toEqual({ good: 5, evil: 3 });
      expect(getRoleRatio(9)).toEqual({ good: 6, evil: 3 });
      expect(getRoleRatio(10)).toEqual({ good: 6, evil: 4 });
    });

    it('should throw error for invalid player counts', () => {
      expect(() => getRoleRatio(4)).toThrow('Invalid player count: 4');
      expect(() => getRoleRatio(11)).toThrow('Invalid player count: 11');
      expect(() => getRoleRatio(0)).toThrow('Invalid player count: 0');
      expect(() => getRoleRatio(-1)).toThrow('Invalid player count: -1');
    });

    it('should match ROLE_RATIOS constant', () => {
      for (let count = 5; count <= 10; count++) {
        expect(getRoleRatio(count)).toEqual(ROLE_RATIOS[count]);
      }
    });
  });

  describe('shuffleArray', () => {
    it('should return a new array (not mutate original)', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = shuffleArray(original);
      expect(shuffled).not.toBe(original);
      expect(original).toEqual([1, 2, 3, 4, 5]);
    });

    it('should contain all original elements', () => {
      const original = ['a', 'b', 'c', 'd', 'e'];
      const shuffled = shuffleArray(original);
      expect(shuffled.sort()).toEqual(original.sort());
    });

    it('should preserve array length', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = shuffleArray(original);
      expect(shuffled.length).toBe(original.length);
    });

    it('should handle empty arrays', () => {
      const empty: number[] = [];
      const shuffled = shuffleArray(empty);
      expect(shuffled).toEqual([]);
    });

    it('should handle single-element arrays', () => {
      const single = [42];
      const shuffled = shuffleArray(single);
      expect(shuffled).toEqual([42]);
    });

    it('should produce different orderings over multiple calls (statistical)', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const results = new Set<string>();

      // Run 50 shuffles and check we get different orderings
      for (let i = 0; i < 50; i++) {
        const shuffled = shuffleArray(original);
        results.add(JSON.stringify(shuffled));
      }

      // We should get at least 10 different orderings (very conservative)
      expect(results.size).toBeGreaterThan(10);
    });
  });

  describe('distributeRoles', () => {
    it('should assign correct number of good/evil roles for 5 players', () => {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const assignments = distributeRoles(players);

      expect(assignments.length).toBe(5);
      const goodCount = assignments.filter((a) => a.role === 'good').length;
      const evilCount = assignments.filter((a) => a.role === 'evil').length;
      expect(goodCount).toBe(3);
      expect(evilCount).toBe(2);
    });

    it('should assign correct number of good/evil roles for 10 players', () => {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
      const assignments = distributeRoles(players);

      expect(assignments.length).toBe(10);
      const goodCount = assignments.filter((a) => a.role === 'good').length;
      const evilCount = assignments.filter((a) => a.role === 'evil').length;
      expect(goodCount).toBe(6);
      expect(evilCount).toBe(4);
    });

    it('should assign correct ratios for all player counts', () => {
      for (let count = 5; count <= 10; count++) {
        const players = Array.from({ length: count }, (_, i) => `player-${i}`);
        const assignments = distributeRoles(players);
        const expectedRatio = ROLE_RATIOS[count];

        const goodCount = assignments.filter((a) => a.role === 'good').length;
        const evilCount = assignments.filter((a) => a.role === 'evil').length;

        expect(goodCount).toBe(expectedRatio.good);
        expect(evilCount).toBe(expectedRatio.evil);
      }
    });

    it('should assign a role to each player exactly once', () => {
      const players = ['alice', 'bob', 'charlie', 'diana', 'eve'];
      const assignments = distributeRoles(players);

      const assignedPlayers = assignments.map((a) => a.playerId);
      const uniquePlayers = new Set(assignedPlayers);

      expect(uniquePlayers.size).toBe(players.length);
      players.forEach((p) => {
        expect(assignedPlayers).toContain(p);
      });
    });

    it('should only assign valid roles (good or evil)', () => {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const assignments = distributeRoles(players);

      assignments.forEach((a) => {
        expect(['good', 'evil']).toContain(a.role);
      });
    });

    it('should produce different role distributions over multiple calls', () => {
      const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const results = new Set<string>();

      // Run 30 distributions
      for (let i = 0; i < 30; i++) {
        const assignments = distributeRoles(players);
        // Create a signature of who got which role
        const signature = assignments
          .map((a) => `${a.playerId}:${a.role}`)
          .sort()
          .join(',');
        results.add(signature);
      }

      // We should get multiple different distributions
      expect(results.size).toBeGreaterThan(5);
    });

    it('should throw for invalid player counts', () => {
      expect(() => distributeRoles(['p1', 'p2', 'p3', 'p4'])).toThrow();
      expect(() =>
        distributeRoles(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11'])
      ).toThrow();
    });
  });

  describe('getRoleInfo', () => {
    it('should return correct info for good role', () => {
      const info = getRoleInfo('good');
      expect(info.role).toBe('good');
      expect(info.role_name).toBe('Loyal Servant of Arthur');
      expect(info.role_description).toContain('loyal servant');
    });

    it('should return correct info for evil role', () => {
      const info = getRoleInfo('evil');
      expect(info.role).toBe('evil');
      expect(info.role_name).toBe('Minion of Mordred');
      expect(info.role_description).toContain('Mordred');
    });

    it('should return descriptions that are non-empty', () => {
      expect(getRoleInfo('good').role_description.length).toBeGreaterThan(0);
      expect(getRoleInfo('evil').role_description.length).toBeGreaterThan(0);
    });
  });

  describe('validateRoleDistribution', () => {
    it('should validate correct 5-player distribution', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', role: 'good', specialRole: 'servant' },
        { playerId: 'p2', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', role: 'evil', specialRole: 'minion' },
        { playerId: 'p5', role: 'evil', specialRole: 'minion' },
      ];
      const result = validateRoleDistribution(assignments, 5);
      expect(result.valid).toBe(true);
    });

    it('should validate correct 10-player distribution', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', role: 'good', specialRole: 'servant' },
        { playerId: 'p2', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', role: 'good', specialRole: 'servant' },
        { playerId: 'p6', role: 'good', specialRole: 'servant' },
        { playerId: 'p7', role: 'evil', specialRole: 'minion' },
        { playerId: 'p8', role: 'evil', specialRole: 'minion' },
        { playerId: 'p9', role: 'evil', specialRole: 'minion' },
        { playerId: 'p10', role: 'evil', specialRole: 'minion' },
      ];
      const result = validateRoleDistribution(assignments, 10);
      expect(result.valid).toBe(true);
    });

    it('should reject wrong total count', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', role: 'good', specialRole: 'servant' },
        { playerId: 'p2', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', role: 'evil', specialRole: 'minion' },
      ];
      const result = validateRoleDistribution(assignments, 5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Expected 5');
    });

    it('should reject wrong good count', () => {
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', role: 'good', specialRole: 'servant' },
        { playerId: 'p2', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', role: 'evil', specialRole: 'minion' },
        { playerId: 'p4', role: 'evil', specialRole: 'minion' },
        { playerId: 'p5', role: 'evil', specialRole: 'minion' },
      ];
      const result = validateRoleDistribution(assignments, 5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('good');
    });

    it('should reject wrong evil count', () => {
      // 5 players should have 3 good, 2 evil
      // This has 4 good, 1 evil - validation catches wrong good count first
      const assignments: RoleAssignment[] = [
        { playerId: 'p1', role: 'good', specialRole: 'servant' },
        { playerId: 'p2', role: 'good', specialRole: 'servant' },
        { playerId: 'p3', role: 'good', specialRole: 'servant' },
        { playerId: 'p4', role: 'good', specialRole: 'servant' },
        { playerId: 'p5', role: 'evil', specialRole: 'minion' },
      ];
      const result = validateRoleDistribution(assignments, 5);
      expect(result.valid).toBe(false);
      // Validation checks good count first, so error mentions good
      expect(result.error).toContain('good');
    });

    it('should validate distributions created by distributeRoles', () => {
      for (let count = 5; count <= 10; count++) {
        const players = Array.from({ length: count }, (_, i) => `p${i}`);
        const assignments = distributeRoles(players);
        const result = validateRoleDistribution(assignments, count);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('integration: full distribution flow', () => {
    it('should handle complete distribution workflow', () => {
      // Simulate a game setup
      const players = [
        'uuid-alice-123',
        'uuid-bob-456',
        'uuid-charlie-789',
        'uuid-diana-012',
        'uuid-eve-345',
        'uuid-frank-678',
        'uuid-grace-901',
      ];

      // Distribute roles
      const assignments = distributeRoles(players);

      // Validate distribution
      const validation = validateRoleDistribution(assignments, 7);
      expect(validation.valid).toBe(true);

      // Check each player got a role
      const playerRoles = new Map(assignments.map((a) => [a.playerId, a.role]));
      players.forEach((p) => {
        expect(playerRoles.has(p)).toBe(true);
      });

      // Check role info is available for each assignment
      assignments.forEach((a) => {
        const info = getRoleInfo(a.role);
        expect(info.role_name).toBeDefined();
        expect(info.role_description).toBeDefined();
      });

      // Evil players should be able to see each other
      const evilPlayers = assignments.filter((a) => a.role === 'evil').map((a) => a.playerId);
      expect(evilPlayers.length).toBe(3); // 7 players = 4 good, 3 evil
    });
  });
});
