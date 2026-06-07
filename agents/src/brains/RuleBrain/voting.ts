/**
 * voting — every player votes approve/reject on the current proposal.
 *
 * Rules (simple — see plan §8):
 *
 *   ALWAYS: if vote_track === 4, EVERYONE approves. The next rejection
 *   would auto-win for evil (5 rejections in a row), so good MUST
 *   approve to survive. Evil already wants to approve in that state,
 *   so this is unanimous regardless of role.
 *
 *   GOOD
 *     - Approve if the team has no known evil on it.
 *     - Reject otherwise.
 *     - Plain servant with no intel: approve (no reason to reject without
 *       evidence, and rejecting risks the vote_track running away).
 *
 *   EVIL
 *     - Approve if at least one known evil teammate is on the team.
 *     - Reject otherwise (denies good a clean run).
 *     - Oberon (no intel): approve if self is on the team (we KNOW we're
 *       evil); else approve by default to avoid raising suspicion.
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';
import { knownPlayerIds, selfId } from './heuristics.js';

const AUTO_APPROVE_VOTE_TRACK = 4;

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const game = ctx.observation.game;
  if (!game) return null;
  if (game.phase !== 'voting') return null;
  if (game.has_voted) return null;        // already voted this proposal
  if (!game.current_proposal) return null; // shouldn't happen in voting phase, but be safe

  // The "next rejection ends the game for good" rule. Even if you'd
  // normally reject this team, you must approve here.
  if (game.vote_track === AUTO_APPROVE_VOTE_TRACK) {
    ctx.logger.debug('vote_track=4 — must approve to avoid auto-loss');
    return { kind: 'vote', choice: 'approve' };
  }

  const team = new Set(game.current_proposal.team_member_ids);
  const me = selfId(ctx);
  const intel = new Set(knownPlayerIds(ctx));
  const isEvil = ctx.identity.role === 'evil';
  const special = ctx.identity.special_role;

  if (isEvil) {
    const isOberon = special === 'oberon_standard' || special === 'oberon_chaos';
    if (isOberon) {
      // No teammate intel. Approve if we're on the team (we can fail it),
      // else default-approve to look cooperative.
      return { kind: 'vote', choice: 'approve' };
    }
    // Approve if at least one known evil teammate is on the team.
    let evilOnTeam = team.has(me) ? 1 : 0;
    for (const id of intel) if (team.has(id)) evilOnTeam += 1;
    return { kind: 'vote', choice: evilOnTeam >= 1 ? 'approve' : 'reject' };
  }

  // GOOD.
  if (intel.size === 0) {
    // Plain servant with no intel — approve by default.
    return { kind: 'vote', choice: 'approve' };
  }
  // Merlin's intel = evil players; percival's = Merlin candidates.
  // For voting, only Merlin's "I see evil" matters — Percival doesn't
  // know who's evil, only who looks like Merlin. So Percival approves
  // by default (same as plain servant). Merlin rejects if any known
  // evil is on the team.
  if (special !== 'merlin') {
    return { kind: 'vote', choice: 'approve' };
  }
  for (const id of intel) {
    if (team.has(id)) {
      ctx.logger.debug('rejecting: team contains a known evil');
      return { kind: 'vote', choice: 'reject' };
    }
  }
  return { kind: 'vote', choice: 'approve' };
}
