/**
 * Unit tests for visibility matrix domain logic
 */

import { describe, it, expect } from 'vitest';
import {
  countHiddenEvilFromMerlin,
  generateDecoyWarning,
} from '@/lib/domain/visibility';

describe('utility functions', () => {
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

});

// ============================================
// Feature 009: Merlin Decoy Mode Tests
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
