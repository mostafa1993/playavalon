/**
 * Zod schema for an agent's YAML config. Defaults are baked in here, so
 * config files only need to specify what they want to override.
 *
 * On load: parse the YAML, validate against this schema. On failure, fail
 * fast with the file path + zod's structured error message.
 */

import { z } from 'zod';

const RangeMs = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

// Brain-specific options. Each brain type validates its own sub-schema.
const RuleBrainOptions = z
  .object({
    evil_fail_strategy: z.enum(['minimum_to_win', 'aggressive', 'random']).default('minimum_to_win'),
    assassin_guess_strategy: z.enum(['most_proposed_good', 'random']).default('most_proposed_good'),
  })
  .partial()
  .default({});

const BrainConfig = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('rule'),
    options: RuleBrainOptions,
  }),
  z.object({
    type: z.literal('noop'),
  }),
]);

const CredentialsConfig = z
  .object({
    password_env: z.string().default('BOT_PASSWORD'),
    password: z.string().optional(),
    password_file: z.string().optional(),
  })
  .default({});

const TimingConfig = z
  .object({
    confirm_role_ms:   RangeMs.default([2000, 8000]),
    propose_team_ms:   RangeMs.default([4000, 15000]),
    vote_ms:           RangeMs.default([2000, 7000]),
    quest_action_ms:   RangeMs.default([3000, 10000]),
    continue_ms:       RangeMs.default([500, 2500]),
    lady_investigate_ms: RangeMs.default([3000, 8000]),
    assassin_guess_ms: RangeMs.default([10000, 25000]),
    merlin_quiz_vote_ms: RangeMs.default([3000, 12000]),
  })
  .default({});

const RuntimeConfig = z
  .object({
    base_url: z.string().url().default('http://localhost:3000'),
    heartbeat_interval_ms: z.number().int().positive().default(20000),
    observation_poll_ms: z.number().int().positive().default(2000),
    max_action_retries: z.number().int().nonnegative().default(3),
  })
  .default({});

export const AgentConfigSchema = z.object({
  /** Maps to Supabase Auth user `bot_<name>@playavalon.local`. */
  name: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, 'name must be lowercase alphanumeric/underscore'),
  display_name: z.string().optional(),
  /** smart = LLM decides the strategic moves (LLMBrain, falls back to the
   *  rule brain on any LLM failure); stupid = today's behavior, exactly. */
  mode: z.enum(['smart', 'stupid']).default('stupid'),
  /** Used by the Phase-4 supervisor to pick the first N agents. No-op in P0-P3. */
  order: z.number().int().nonnegative().default(99),
  credentials: CredentialsConfig,
  brain: BrainConfig,
  timing: TimingConfig,
  runtime: RuntimeConfig,
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Helper for callers that need the brain-options type for a specific brain. */
export type RuleBrainOptionsT = z.infer<typeof RuleBrainOptions>;
