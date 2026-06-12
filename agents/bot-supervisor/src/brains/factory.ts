/**
 * Brain factory — pick which Brain implementation to instantiate.
 *
 * The top-level `mode` flag decides smart (LLMBrain) vs stupid (whatever
 * `brain.type` says — today's rule/noop behavior, untouched).
 */

import type { Brain } from './Brain.js';
import { NoopBrain } from './NoopBrain.js';
import { RuleBrain } from './RuleBrain/index.js';
import { LLMBrain } from './LLMBrain/index.js';
import type { AgentConfig } from '../config/schema.js';

export function makeBrain(config: Pick<AgentConfig, 'mode' | 'brain'>): Brain {
  if (config.mode === 'smart') {
    return new LLMBrain();
  }
  const brainCfg = config.brain;
  switch (brainCfg.type) {
    case 'rule':
      return new RuleBrain();
    case 'noop':
      return new NoopBrain();
  }
  // Should be unreachable — the switch above covers every discriminator.
  // The throw is defensive against future additions to AgentConfig['brain']
  // that forget to update this factory, and it also satisfies TypeScript's
  // "function may not return" check in some stricter configs.
  throw new Error(`makeBrain: unknown brain.type=${(brainCfg as { type: string }).type}`);
}
