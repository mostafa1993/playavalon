/**
 * Room state transition logic (pure functions)
 * Manages room lifecycle: waiting → roles_distributed → started → closed.
 * A room no human is left in closes from any state.
 */

import type { RoomStatus } from '@/types/database';

/**
 * Valid room status values
 */
export const ROOM_STATUSES = ['waiting', 'roles_distributed', 'started', 'closed'] as const;

/**
 * State transition map - defines valid transitions
 */
const STATE_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  waiting: ['roles_distributed', 'closed'], // Closed when no human is left
  roles_distributed: ['started', 'closed'], // Closed when no human is left
  started: ['closed'], // Can transition to closed when game ends
  closed: [], // Terminal state (archived - preserves game history)
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(
  from: RoomStatus,
  to: RoomStatus
): boolean {
  const validTargets = STATE_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

/**
 * Get valid next states from current state
 */
export function getValidNextStates(current: RoomStatus): RoomStatus[] {
  return STATE_TRANSITIONS[current] ?? [];
}

/**
 * Check if room is in a terminal state
 */
export function isTerminalState(status: RoomStatus): boolean {
  return STATE_TRANSITIONS[status]?.length === 0;
}

/**
 * Validation result type
 */
export interface TransitionValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate transition to 'roles_distributed' state
 * Requirements: room is full, room is in 'waiting' state, requester is manager
 */
export function canTransitionToRolesDistributed(
  currentStatus: RoomStatus,
  currentPlayers: number,
  expectedPlayers: number,
  isManager: boolean
): TransitionValidation {
  if (currentStatus !== 'waiting') {
    return {
      valid: false,
      error: `Cannot distribute roles from '${currentStatus}' state. Room must be in 'waiting' state.`,
    };
  }

  if (!isManager) {
    return {
      valid: false,
      error: 'Only the room manager can distribute roles.',
    };
  }

  if (currentPlayers < expectedPlayers) {
    return {
      valid: false,
      error: `Room is not full. Need ${expectedPlayers} players, have ${currentPlayers}.`,
    };
  }

  return { valid: true };
}

/**
 * Validate transition to 'started' state
 * Requirements: all players confirmed, room is in 'roles_distributed' state, requester is manager
 */
export function canTransitionToStarted(
  currentStatus: RoomStatus,
  allConfirmed: boolean,
  isManager: boolean
): TransitionValidation {
  if (currentStatus !== 'roles_distributed') {
    return {
      valid: false,
      error: `Cannot start game from '${currentStatus}' state. Roles must be distributed first.`,
    };
  }

  if (!isManager) {
    return {
      valid: false,
      error: 'Only the room manager can start the game.',
    };
  }

  if (!allConfirmed) {
    return {
      valid: false,
      error: 'Cannot start game. Not all players have confirmed their roles.',
    };
  }

  return { valid: true };
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: RoomStatus): string {
  const labels: Record<RoomStatus, string> = {
    waiting: 'Waiting for players',
    roles_distributed: 'Roles distributed',
    started: 'Game in progress',
    closed: 'Archived',
  };
  return labels[status] ?? 'Unknown';
}

/**
 * Get status badge color class
 */
export function getStatusColor(status: RoomStatus): string {
  const colors: Record<RoomStatus, string> = {
    waiting: 'bg-yellow-500/20 text-yellow-400',
    roles_distributed: 'bg-blue-500/20 text-blue-400',
    started: 'bg-green-500/20 text-green-400',
    closed: 'bg-gray-500/20 text-gray-400',
  };
  return colors[status] ?? 'bg-gray-500/20 text-gray-400';
}

/**
 * Check if players can join the room
 */
export function canPlayersJoin(status: RoomStatus): boolean {
  return status === 'waiting';
}

/**
 * Check if players can leave the room
 */
export function canPlayersLeave(status: RoomStatus): boolean {
  // Players can only leave during waiting state
  // Once roles are distributed, leaving would break the game
  return status === 'waiting';
}

/**
 * Check if role confirmation is needed
 */
export function needsRoleConfirmation(status: RoomStatus): boolean {
  return status === 'roles_distributed';
}

/**
 * Room state machine - comprehensive state management
 */
export class RoomStateMachine {
  constructor(private status: RoomStatus) {}

  get currentStatus(): RoomStatus {
    return this.status;
  }

  get isWaiting(): boolean {
    return this.status === 'waiting';
  }

  get isRolesDistributed(): boolean {
    return this.status === 'roles_distributed';
  }

  get isStarted(): boolean {
    return this.status === 'started';
  }

  get isClosed(): boolean {
    return this.status === 'closed';
  }

  get isTerminal(): boolean {
    return isTerminalState(this.status);
  }

  get label(): string {
    return getStatusLabel(this.status);
  }

  get colorClass(): string {
    return getStatusColor(this.status);
  }

  canTransitionTo(target: RoomStatus): boolean {
    return isValidTransition(this.status, target);
  }

  getNextStates(): RoomStatus[] {
    return getValidNextStates(this.status);
  }

  /**
   * Attempt to transition to a new state
   * Returns new status if valid, throws if invalid
   */
  transitionTo(target: RoomStatus): RoomStatus {
    if (!this.canTransitionTo(target)) {
      throw new Error(
        `Invalid state transition: ${this.status} → ${target}. Valid targets: ${this.getNextStates().join(', ') || 'none'}`
      );
    }
    this.status = target;
    return this.status;
  }
}

/**
 * Create a room state machine from current status
 */
export function createRoomStateMachine(status: RoomStatus): RoomStateMachine {
  return new RoomStateMachine(status);
}
