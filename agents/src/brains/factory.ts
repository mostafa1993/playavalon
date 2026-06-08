/**
 * Brain factory — pick which Brain implementation to instantiate based
 * on the yaml `brain.type`. This is the single swap point: P5's LlmBrain
 * lands here as one new case.
 */

import type { Brain } from './Brain.js';
import { NoopBrain } from './NoopBrain.js';
import { RuleBrain } from './RuleBrain/index.js';
import type { AgentConfig } from '../config/schema.js';

export function makeBrain(brainCfg: AgentConfig['brain']): Brain {
  switch (brainCfg.type) {
    case 'rule':
      return new RuleBrain();
    case 'noop':
      return new NoopBrain();
    // Phase 5 (future):
    // case 'llm':
    //   return new LlmBrain(brainCfg.options);
  }
  // Should be unreachable — the switch above covers every discriminator.
  // The throw is defensive against future additions to AgentConfig['brain']
  // that forget to update this factory, and it also satisfies TypeScript's
  // "function may not return" check in some stricter configs.
  throw new Error(`makeBrain: unknown brain.type=${(brainCfg as { type: string }).type}`);
}
