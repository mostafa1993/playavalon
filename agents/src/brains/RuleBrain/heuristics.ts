/**
 * Shared scoring + helpers used by multiple phase modules.
 *
 * Intentionally deterministic-ish — the rule brain is supposed to play
 * predictably so tests can pin down outcomes. The LLM brain (P5) is where
 * "fun, surprising" play lives.
 */

import type { BrainContext } from '../Brain.js';

/**
 * Map known_players (display names) → player IDs from the current observation.
 *
 * The role API returns display names because that's what the UI shows;
 * the propose/vote API takes player IDs. This is the bridge.
 *
 * Returns an empty array if `intel.known_players` is empty (default for
 * plain servants who have no intel) — callers should treat that as
 * "I don't know anything special" not "no players exist."
 */
export function knownPlayerIds(ctx: BrainContext): string[] {
  const intelNames = new Set(ctx.identity.role_intel.known_players);
  if (intelNames.size === 0) return [];
  const fromGame = ctx.observation.game?.players ?? ctx.observation.room.players;
  return fromGame
    .filter((p) => intelNames.has(p.display_name))
    .map((p) => p.id);
}

/** All player IDs currently seated (game.players is authoritative once game starts). */
export function allPlayerIds(ctx: BrainContext): string[] {
  return ctx.observation.game?.players.map((p) => p.id) ?? ctx.observation.room.players.map((p) => p.id);
}

export function selfId(ctx: BrainContext): string {
  return ctx.identity.user_id;
}

/**
 * Return a shuffled copy of `arr` using the brain's injectable RNG so tests
 * can pin outcomes by passing a seeded rng().
 */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i]!, out[j]!] = [out[j]!, out[i]!];
  }
  return out;
}

/** Pick N elements from `arr` (no repeats), preserving the deterministic shuffle order. */
export function sample<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  return shuffle(arr, rng).slice(0, n);
}
