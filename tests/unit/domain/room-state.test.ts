/**
 * Unit tests for room state transition logic
 * Tests the pure functions in src/lib/domain/room-state.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  getValidNextStates,
  isTerminalState,
  canTransitionToRolesDistributed,
  canTransitionToStarted,
  getStatusLabel,
  getStatusColor,
  canPlayersJoin,
  canPlayersLeave,
  needsRoleConfirmation,
  RoomStateMachine,
  createRoomStateMachine,
  ROOM_STATUSES,
} from '@/lib/domain/room-state';
import type { RoomStatus } from '@/types/database';

describe('room-state', () => {
  describe('ROOM_STATUSES', () => {
    it('should contain all valid statuses', () => {
      expect(ROOM_STATUSES).toContain('waiting');
      expect(ROOM_STATUSES).toContain('roles_distributed');
      expect(ROOM_STATUSES).toContain('started');
      expect(ROOM_STATUSES).toContain('closed');
      expect(ROOM_STATUSES.length).toBe(4);
    });
  });

  describe('isValidTransition', () => {
    it('should allow waiting → roles_distributed', () => {
      expect(isValidTransition('waiting', 'roles_distributed')).toBe(true);
    });

    it('should allow roles_distributed → started', () => {
      expect(isValidTransition('roles_distributed', 'started')).toBe(true);
    });

    it('should NOT allow waiting → started (skip)', () => {
      expect(isValidTransition('waiting', 'started')).toBe(false);
    });

    it('should NOT allow backwards transitions', () => {
      expect(isValidTransition('roles_distributed', 'waiting')).toBe(false);
      expect(isValidTransition('started', 'roles_distributed')).toBe(false);
      expect(isValidTransition('started', 'waiting')).toBe(false);
    });

    it('should NOT allow self-transitions', () => {
      expect(isValidTransition('waiting', 'waiting')).toBe(false);
      expect(isValidTransition('roles_distributed', 'roles_distributed')).toBe(false);
      expect(isValidTransition('started', 'started')).toBe(false);
    });

    it('should allow started → closed only', () => {
      ROOM_STATUSES.forEach((status) => {
        expect(isValidTransition('started', status)).toBe(status === 'closed');
      });
    });

    it('should NOT allow any transitions from closed (terminal)', () => {
      ROOM_STATUSES.forEach((status) => {
        expect(isValidTransition('closed', status)).toBe(false);
      });
    });
  });

  describe('getValidNextStates', () => {
    it('should return [roles_distributed] for waiting', () => {
      expect(getValidNextStates('waiting')).toEqual(['roles_distributed']);
    });

    it('should return [started] for roles_distributed', () => {
      expect(getValidNextStates('roles_distributed')).toEqual(['started']);
    });

    it('should return [closed] for started', () => {
      expect(getValidNextStates('started')).toEqual(['closed']);
    });

    it('should return empty array for closed (terminal)', () => {
      expect(getValidNextStates('closed')).toEqual([]);
    });
  });

  describe('isTerminalState', () => {
    it('should return false for waiting', () => {
      expect(isTerminalState('waiting')).toBe(false);
    });

    it('should return false for roles_distributed', () => {
      expect(isTerminalState('roles_distributed')).toBe(false);
    });

    it('should return false for started', () => {
      expect(isTerminalState('started')).toBe(false);
    });

    it('should return true for closed', () => {
      expect(isTerminalState('closed')).toBe(true);
    });
  });

  describe('canTransitionToRolesDistributed', () => {
    it('should allow manager to distribute when room is full and waiting', () => {
      const result = canTransitionToRolesDistributed('waiting', 5, 5, true);
      expect(result.valid).toBe(true);
    });

    it('should allow with more players than expected', () => {
      const result = canTransitionToRolesDistributed('waiting', 6, 5, true);
      expect(result.valid).toBe(true);
    });

    it('should NOT allow from roles_distributed state', () => {
      const result = canTransitionToRolesDistributed('roles_distributed', 5, 5, true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('roles_distributed');
    });

    it('should NOT allow from started state', () => {
      const result = canTransitionToRolesDistributed('started', 5, 5, true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('started');
    });

    it('should NOT allow non-manager to distribute', () => {
      const result = canTransitionToRolesDistributed('waiting', 5, 5, false);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('manager');
    });

    it('should NOT allow when room is not full', () => {
      const result = canTransitionToRolesDistributed('waiting', 3, 5, true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not full');
      expect(result.error).toContain('5');
      expect(result.error).toContain('3');
    });

    it('should NOT allow when room is empty', () => {
      const result = canTransitionToRolesDistributed('waiting', 0, 5, true);
      expect(result.valid).toBe(false);
    });
  });

  describe('canTransitionToStarted', () => {
    it('should allow manager to start when all confirmed from roles_distributed', () => {
      const result = canTransitionToStarted('roles_distributed', true, true);
      expect(result.valid).toBe(true);
    });

    it('should NOT allow from waiting state', () => {
      const result = canTransitionToStarted('waiting', true, true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('waiting');
    });

    it('should NOT allow from started state', () => {
      const result = canTransitionToStarted('started', true, true);
      expect(result.valid).toBe(false);
    });

    it('should NOT allow non-manager to start', () => {
      const result = canTransitionToStarted('roles_distributed', true, false);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('manager');
    });

    it('should NOT allow when not all confirmed', () => {
      const result = canTransitionToStarted('roles_distributed', false, true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('confirmed');
    });
  });

  describe('getStatusLabel', () => {
    it('should return readable labels for all statuses', () => {
      expect(getStatusLabel('waiting')).toBe('Waiting for players');
      expect(getStatusLabel('roles_distributed')).toBe('Roles distributed');
      expect(getStatusLabel('started')).toBe('Game in progress');
    });

    it('should return Unknown for invalid status', () => {
      expect(getStatusLabel('invalid' as RoomStatus)).toBe('Unknown');
    });
  });

  describe('getStatusColor', () => {
    it('should return color classes for all statuses', () => {
      expect(getStatusColor('waiting')).toContain('yellow');
      expect(getStatusColor('roles_distributed')).toContain('blue');
      expect(getStatusColor('started')).toContain('green');
    });

    it('should return gray for invalid status', () => {
      expect(getStatusColor('invalid' as RoomStatus)).toContain('gray');
    });
  });

  describe('canPlayersJoin', () => {
    it('should allow joining in waiting state', () => {
      expect(canPlayersJoin('waiting')).toBe(true);
    });

    it('should NOT allow joining after roles distributed', () => {
      expect(canPlayersJoin('roles_distributed')).toBe(false);
    });

    it('should NOT allow joining after game started', () => {
      expect(canPlayersJoin('started')).toBe(false);
    });
  });

  describe('canPlayersLeave', () => {
    it('should allow leaving in waiting state', () => {
      expect(canPlayersLeave('waiting')).toBe(true);
    });

    it('should NOT allow leaving after roles distributed', () => {
      expect(canPlayersLeave('roles_distributed')).toBe(false);
    });

    it('should NOT allow leaving after game started', () => {
      expect(canPlayersLeave('started')).toBe(false);
    });
  });

  describe('needsRoleConfirmation', () => {
    it('should NOT need confirmation in waiting state', () => {
      expect(needsRoleConfirmation('waiting')).toBe(false);
    });

    it('should need confirmation in roles_distributed state', () => {
      expect(needsRoleConfirmation('roles_distributed')).toBe(true);
    });

    it('should NOT need confirmation after game started', () => {
      expect(needsRoleConfirmation('started')).toBe(false);
    });
  });

  describe('RoomStateMachine', () => {
    describe('initialization', () => {
      it('should initialize with given status', () => {
        const machine = new RoomStateMachine('waiting');
        expect(machine.currentStatus).toBe('waiting');
      });

      it('should provide correct boolean flags for waiting', () => {
        const machine = new RoomStateMachine('waiting');
        expect(machine.isWaiting).toBe(true);
        expect(machine.isRolesDistributed).toBe(false);
        expect(machine.isStarted).toBe(false);
        expect(machine.isTerminal).toBe(false);
      });

      it('should provide correct boolean flags for roles_distributed', () => {
        const machine = new RoomStateMachine('roles_distributed');
        expect(machine.isWaiting).toBe(false);
        expect(machine.isRolesDistributed).toBe(true);
        expect(machine.isStarted).toBe(false);
        expect(machine.isTerminal).toBe(false);
      });

      it('should provide correct boolean flags for started', () => {
        const machine = new RoomStateMachine('started');
        expect(machine.isWaiting).toBe(false);
        expect(machine.isRolesDistributed).toBe(false);
        expect(machine.isStarted).toBe(true);
        expect(machine.isTerminal).toBe(false);
      });

      it('should provide correct boolean flags for closed', () => {
        const machine = new RoomStateMachine('closed');
        expect(machine.isStarted).toBe(false);
        expect(machine.isClosed).toBe(true);
        expect(machine.isTerminal).toBe(true);
      });
    });

    describe('label and colorClass', () => {
      it('should return correct label', () => {
        expect(new RoomStateMachine('waiting').label).toBe('Waiting for players');
        expect(new RoomStateMachine('started').label).toBe('Game in progress');
      });

      it('should return correct color class', () => {
        expect(new RoomStateMachine('waiting').colorClass).toContain('yellow');
        expect(new RoomStateMachine('started').colorClass).toContain('green');
      });
    });

    describe('canTransitionTo', () => {
      it('should correctly check valid transitions', () => {
        const machine = new RoomStateMachine('waiting');
        expect(machine.canTransitionTo('roles_distributed')).toBe(true);
        expect(machine.canTransitionTo('started')).toBe(false);
      });
    });

    describe('getNextStates', () => {
      it('should return valid next states', () => {
        const machine = new RoomStateMachine('waiting');
        expect(machine.getNextStates()).toEqual(['roles_distributed']);
      });
    });

    describe('transitionTo', () => {
      it('should successfully transition to valid state', () => {
        const machine = new RoomStateMachine('waiting');
        const result = machine.transitionTo('roles_distributed');
        expect(result).toBe('roles_distributed');
        expect(machine.currentStatus).toBe('roles_distributed');
      });

      it('should allow chained transitions', () => {
        const machine = new RoomStateMachine('waiting');
        machine.transitionTo('roles_distributed');
        machine.transitionTo('started');
        expect(machine.currentStatus).toBe('started');
      });

      it('should throw on invalid transition', () => {
        const machine = new RoomStateMachine('waiting');
        expect(() => machine.transitionTo('started')).toThrow('Invalid state transition');
      });

      it('should throw on backwards transition', () => {
        const machine = new RoomStateMachine('roles_distributed');
        expect(() => machine.transitionTo('waiting')).toThrow('Invalid state transition');
      });

      it('should throw from terminal state', () => {
        const machine = new RoomStateMachine('started');
        expect(() => machine.transitionTo('waiting')).toThrow('Invalid state transition');
      });
    });
  });

  describe('createRoomStateMachine', () => {
    it('should create a machine with given status', () => {
      const machine = createRoomStateMachine('roles_distributed');
      expect(machine.currentStatus).toBe('roles_distributed');
      expect(machine.isRolesDistributed).toBe(true);
    });
  });

  describe('integration: full state lifecycle', () => {
    it('should support complete room lifecycle', () => {
      const machine = createRoomStateMachine('waiting');

      // Room starts in waiting
      expect(machine.isWaiting).toBe(true);
      expect(machine.label).toBe('Waiting for players');

      // Roles get distributed
      machine.transitionTo('roles_distributed');
      expect(machine.isRolesDistributed).toBe(true);
      expect(machine.label).toBe('Roles distributed');

      // Game starts
      machine.transitionTo('started');
      expect(machine.isStarted).toBe(true);
      expect(machine.isTerminal).toBe(false);
      expect(machine.label).toBe('Game in progress');

      // Game ends: the room is closed (archived)
      machine.transitionTo('closed');
      expect(machine.isClosed).toBe(true);
      expect(machine.isTerminal).toBe(true);
      expect(machine.label).toBe('Archived');

      // No further transitions possible
      expect(machine.getNextStates()).toEqual([]);
    });
  });
});
