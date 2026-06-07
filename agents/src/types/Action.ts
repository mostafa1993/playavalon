/**
 * Action — discriminated union of every move an agent's Brain can decide to
 * make. The Engine's ActionExecutor knows how to dispatch each kind to the
 * correct API endpoint.
 *
 * Adding a new action kind = adding a new entry here + a new case in
 * ActionExecutor + (typically) a new method on ApiClient.
 *
 * Phase 0 only uses: noop, consent_ai, confirm_role.
 * The rest are listed now so the Brain interface is stable from day one
 * and later phases just need to populate them.
 */

export type Action =
  | { kind: 'noop' }
  | { kind: 'consent_ai' }
  | { kind: 'confirm_role' }
  // Phase 1+
  | { kind: 'propose'; team: string[] }
  | { kind: 'vote'; choice: 'approve' | 'reject' }
  // Phase 2+
  | { kind: 'quest_action'; choice: 'success' | 'fail' }
  | { kind: 'continue' }
  // Phase 3+
  | { kind: 'lady_investigate'; target_id: string }
  | { kind: 'assassin_guess'; target_id: string }
  | { kind: 'merlin_quiz'; target_id: string | null };
