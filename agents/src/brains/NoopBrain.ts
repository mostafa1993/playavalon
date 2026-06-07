/**
 * NoopBrain — decides nothing, ever. Used in tests / when you want to spawn
 * an agent that joins a room but never acts (useful for "empty seat
 * placeholder" scenarios).
 */

import type { Brain } from './Brain.js';

export class NoopBrain implements Brain {
  async decide() {
    return null;
  }
}
