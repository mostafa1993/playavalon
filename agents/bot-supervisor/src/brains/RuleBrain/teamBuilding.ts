/**
 * teamBuilding — the leader of the current quest picks a team of
 * `quest_requirement.size` players to propose. Non-leaders return null.
 *
 * Rules (deliberately simple — see plan §8):
 *
 *   GOOD LEADER
 *     - Always include self (Merlin/Percival/servant trust themselves).
 *     - If Merlin or Percival, include as many of their `known_players`
 *       as possible (Merlin sees evil; Percival sees Merlin candidates;
 *       plain servants have no intel and pick the rest at random).
 *     - For Merlin: known_players means EVIL — EXCLUDE those, not include.
 *       (Percival's known_players are Merlin candidates — INCLUDE.)
 *
 *   EVIL LEADER
 *     - Include 1 evil teammate (self + one other evil = enough to fail
 *       a typical quest). Oberon has no intel about teammates — picks
 *       the rest at random and hopes for the best.
 *     - Fill the remaining slots with non-evil players to look plausible.
 *
 * Tie-breaking is via the brain's injectable RNG so RuleBrain stays
 * reproducible under a seeded rng().
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';
import { allPlayerIds, knownPlayerIds, sample, selfId } from './heuristics.js';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const game = ctx.observation.game;
  if (!game) return null;
  if (game.phase !== 'team_building') return null;
  if (game.in_intro_phase) return null;             // intro round — leader doesn't propose
  if (!ctx.observation.self.is_leader) return null; // only the leader proposes
  if (game.current_proposal) return null;           // already proposed; awaiting voting transition

  const teamSize = game.quest_requirement.size;
  if (teamSize <= 0) {
    ctx.logger.warn('team_building with size=0; skipping');
    return null;
  }

  const me = selfId(ctx);
  const all = allPlayerIds(ctx);
  const others = all.filter((id) => id !== me);
  const intel = knownPlayerIds(ctx); // player IDs derived from role_intel.known_players
  const isEvil = ctx.identity.role === 'evil';
  const special = ctx.identity.special_role;

  const team = new Set<string>();
  team.add(me); // always include self — leader is on the team they propose

  if (isEvil) {
    // Include one known evil teammate if we have intel.
    // Oberon variants have no intel — they fall through to the random fill.
    if (special !== 'oberon_standard' && special !== 'oberon_chaos' && intel.length > 0) {
      const teammate = sample(intel, 1, ctx.rng)[0];
      if (teammate && teammate !== me) team.add(teammate);
    }
    // Fill remaining slots randomly from non-team players. We avoid including
    // a second known evil — easier for good to spot if 2 evil show up together.
    const candidates = others.filter((id) => !team.has(id) && !intel.includes(id));
    for (const id of sample(candidates, teamSize - team.size, ctx.rng)) {
      team.add(id);
      if (team.size >= teamSize) break;
    }
  } else {
    // Good leader. Treat intel based on role:
    //   - merlin's known_players = EVIL → exclude
    //   - percival's known_players = Merlin candidates → INCLUDE
    //   - plain servant has no intel → pick at random
    const isMerlin = special === 'merlin';
    const isPercival = special === 'percival';

    if (isPercival && intel.length > 0) {
      // Include as many Merlin candidates as we have room for, up to all of them.
      // (With Morgana enabled, intel has 2 entries — one real Merlin, one Morgana.
      // We can't distinguish, so we include both if there's room.)
      for (const id of sample(intel, Math.min(intel.length, teamSize - team.size), ctx.rng)) {
        team.add(id);
        if (team.size >= teamSize) break;
      }
    }

    // Fill with players we don't suspect.
    const knownEvil = isMerlin ? new Set(intel) : new Set<string>();
    const candidates = others.filter((id) => !team.has(id) && !knownEvil.has(id));
    for (const id of sample(candidates, teamSize - team.size, ctx.rng)) {
      team.add(id);
      if (team.size >= teamSize) break;
    }

    // Edge case: if we're forced (not enough non-suspect candidates), fall back
    // to any remaining player so we always produce a valid team.
    if (team.size < teamSize) {
      const fallback = others.filter((id) => !team.has(id));
      for (const id of sample(fallback, teamSize - team.size, ctx.rng)) {
        team.add(id);
        if (team.size >= teamSize) break;
      }
    }
  }

  if (team.size !== teamSize) {
    ctx.logger.warn(`teamBuilding produced ${team.size}/${teamSize} players; skipping (will retry)`);
    return null;
  }

  const proposed = Array.from(team);
  ctx.logger.debug(`intend: propose team of ${proposed.length}`, {
    role: ctx.identity.role,
    special: ctx.identity.special_role,
    quest: game.current_quest,
  });
  return { kind: 'propose', team: proposed };
}
