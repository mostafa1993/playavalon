import type { Game, PublicGame } from '@/types/game';

/**
 * A game without its hidden columns (the Merlin decoy, the Split Intel groups,
 * the Evil Ring links), for any response a player or watcher receives. Each
 * player learns their own part of that through the role route.
 */
export function publicGame(game: Game): PublicGame {
  const {
    merlin_decoy_player_id: _decoy,
    split_intel_certain_evil_ids: _certain,
    split_intel_mixed_evil_id: _mixedEvil,
    split_intel_mixed_good_id: _mixedGood,
    oberon_split_intel_certain_evil_ids: _oberonCertain,
    oberon_split_intel_mixed_good_id: _oberonMixedGood,
    evil_ring_assignments: _ring,
    ...rest
  } = game;
  return rest;
}
