/**
 * LLMBrain — `mode: smart`. The LLM decides the strategic moves; the RuleBrain
 * stays in the loop as gate + fallback.
 *
 * Design (zero duplicated gating):
 *   1. Ask RuleBrain what it would do right now.
 *   2. null / mechanical action (noop, consent, confirm, continue) → pass through.
 *   3. Strategic action (propose, vote, quest, lady, assassin, quiz) → ask the
 *      LLM for the same decision; validate; on ANY failure return RuleBrain's
 *      choice. The game can never stall on the LLM.
 *
 * Hard rules are enforced outside the LLM (mirroring RuleBrain/the server):
 *   - vote_track === 4 → approve (never even ask).
 *   - quest: good always succeeds; lunatic always fails; brute can only fail
 *     Q1-Q3 — the LLM is only consulted when a genuine choice exists.
 *
 * Phase 2 scope: decisions from the API observation + role intel only.
 * Phase 3 adds the STT discussion memory; Phase 4 adds speaking.
 */

import type { LLMClient } from '@avalon/shared';
import { createBotLLM } from '../../llm/client.js';
import type { Action } from '../../types/Action.js';
import type { Brain, BrainContext } from '../Brain.js';
import type { GameObservation } from '../../types/Observation.js';
import { RuleBrain } from '../RuleBrain/index.js';

const AUTO_APPROVE_VOTE_TRACK = 4;

export class LLMBrain implements Brain {
  private readonly fallback = new RuleBrain();
  private llm: LLMClient | null = null;
  private llmUnavailable = false;
  // Mechanics tracking — observation deltas become memory events the prompts see.
  private lastProposalId: string | null = null;
  private lastVoteTrack: number | null = null;
  private lastQuest: number | null = null;
  private lastPhase: string | null = null;

  async decide(ctx: BrainContext): Promise<Action | null> {
    this.trackMechanics(ctx);
    const ruleAction = await this.fallback.decide(ctx);
    if (!ruleAction) return null;

    switch (ruleAction.kind) {
      case 'propose':
        return this.withFallback(ctx, ruleAction, () => this.decidePropose(ctx));
      case 'vote':
        // Hard rule: a 5th rejection auto-loses the game — never consult the LLM.
        if (ctx.observation.game?.vote_track === AUTO_APPROVE_VOTE_TRACK) return ruleAction;
        return this.withFallback(ctx, ruleAction, () => this.decideVote(ctx));
      case 'quest_action':
        // Forced cards (good→success, lunatic→fail, brute Q4+→success) are not
        // decisions — keep the rule action silently; only real choices hit the LLM.
        if (this.questCardForced(ctx)) return ruleAction;
        return this.withFallback(ctx, ruleAction, () => this.decideQuest(ctx));
      case 'lady_investigate':
        return this.withFallback(ctx, ruleAction, () => this.decideLady(ctx));
      case 'assassin_guess':
        return this.withFallback(ctx, ruleAction, () => this.decideAssassin(ctx));
      case 'merlin_quiz':
        return this.withFallback(ctx, ruleAction, () => this.decideMerlinQuiz(ctx));
      default:
        // Mechanical (noop / consent_ai / confirm_role / continue) — no LLM value.
        return ruleAction;
    }
  }

  /** Run an LLM decision; any failure (or null) falls back to the rule action. */
  private async withFallback(
    ctx: BrainContext,
    ruleAction: Action,
    llmDecision: () => Promise<Action | null>
  ): Promise<Action> {
    if (!this.getLLM(ctx)) return ruleAction;
    try {
      const action = await llmDecision();
      if (action) {
        ctx.logger.info(`[smart] LLM decided: ${JSON.stringify(action)}`);
        return action;
      }
      ctx.logger.warn(`[smart] LLM produced no valid ${ruleAction.kind}; using rule fallback`);
      return ruleAction;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.warn(`[smart] LLM ${ruleAction.kind} failed (${msg}); using rule fallback`);
      return ruleAction;
    }
  }

  /** Lazy LLM client from env. Missing config → log once, stay rule-based. */
  private getLLM(ctx: BrainContext): LLMClient | null {
    if (this.llm) return this.llm;
    if (this.llmUnavailable) return null;
    this.llm = createBotLLM();
    if (!this.llm) {
      this.llmUnavailable = true;
      ctx.logger.warn('[smart] GCP_PROJECT_ID not set — smart mode degraded to rule decisions');
      return null;
    }
    return this.llm;
  }

  // ── decisions ─────────────────────────────────────────────────────────────

  private async decidePropose(ctx: BrainContext): Promise<Action | null> {
    const game = ctx.observation.game!;
    const size = game.quest_requirement.size;
    const out = await this.llm!.runJson<{ team: string[] }>('decide-propose.yml', {
      ...this.baseVars(ctx, game),
      team_size: size,
    });
    const ids = this.namesToIds(game, out.team);
    if (!ids || ids.length !== size || new Set(ids).size !== size) return null;
    return { kind: 'propose', team: ids };
  }

  private async decideVote(ctx: BrainContext): Promise<Action | null> {
    const game = ctx.observation.game!;
    const proposal = game.current_proposal;
    const teamNames = proposal
      ? proposal.team_member_ids
          .map((id) => game.players.find((p) => p.id === id)?.display_name ?? id)
          .join(', ')
      : '(unknown)';
    const out = await this.llm!.runJson<{ choice: string }>('decide-vote.yml', {
      ...this.baseVars(ctx, game),
      proposed_team: teamNames,
    });
    if (out.choice !== 'approve' && out.choice !== 'reject') return null;
    return { kind: 'vote', choice: out.choice };
  }

  /** True when the quest card is dictated by role/server rules — no choice. */
  private questCardForced(ctx: BrainContext): boolean {
    const game = ctx.observation.game;
    const { identity } = ctx;
    return (
      !game ||
      identity.role !== 'evil' ||
      identity.special_role === 'lunatic' ||
      (identity.special_role === 'brute' && game.current_quest >= 4)
    );
  }

  private async decideQuest(ctx: BrainContext): Promise<Action | null> {
    const game = ctx.observation.game!;
    const out = await this.llm!.runJson<{ choice: string }>('decide-quest.yml', {
      ...this.baseVars(ctx, game),
      fails_required: game.quest_requirement.fails_required,
    });
    if (out.choice !== 'success' && out.choice !== 'fail') return null;
    return { kind: 'quest_action', choice: out.choice };
  }

  private async decideLady(ctx: BrainContext): Promise<Action | null> {
    const game = ctx.observation.game!;
    const lady = game.lady_of_lake;
    if (!lady) return null;
    const eligible = game.players.filter(
      (p) => p.id !== ctx.identity.user_id && !lady.investigated_player_ids.includes(p.id)
    );
    const out = await this.llm!.runJson<{ target: string }>('decide-lady.yml', {
      ...this.baseVars(ctx, game),
      eligible_targets: eligible.map((p) => p.display_name).join(', '),
    });
    const target = eligible.find((p) => p.display_name === out.target);
    return target ? { kind: 'lady_investigate', target_id: target.id } : null;
  }

  private async decideAssassin(ctx: BrainContext): Promise<Action | null> {
    const game = ctx.observation.game!;
    const candidates = game.players.filter((p) => p.id !== ctx.identity.user_id);
    const out = await this.llm!.runJson<{ target: string }>('decide-assassin.yml', {
      ...this.baseVars(ctx, game),
      candidates: candidates.map((p) => p.display_name).join(', '),
    });
    const target = candidates.find((p) => p.display_name === out.target);
    return target ? { kind: 'assassin_guess', target_id: target.id } : null;
  }

  private async decideMerlinQuiz(ctx: BrainContext): Promise<Action | null> {
    const game = ctx.observation.game!;
    const candidates = game.players.filter((p) => p.id !== ctx.identity.user_id);
    const out = await this.llm!.runJson<{ target: string | null }>('decide-merlin-quiz.yml', {
      ...this.baseVars(ctx, game),
      candidates: candidates.map((p) => p.display_name).join(', '),
    });
    if (out.target === null) return { kind: 'merlin_quiz', target_id: null };
    const target = candidates.find((p) => p.display_name === out.target);
    return target ? { kind: 'merlin_quiz', target_id: target.id } : null;
  }

  // ── mechanics memory ──────────────────────────────────────────────────────

  /** Turn observation deltas into memory events (proposals, votes, quests). */
  private trackMechanics(ctx: BrainContext): void {
    const game = ctx.observation.game;
    const talk = ctx.talk;
    if (!game || !talk) return;
    const nameOf = (id: string) => game.players.find((p) => p.id === id)?.display_name ?? id;

    const proposal = game.current_proposal;
    if (proposal && proposal.id !== this.lastProposalId) {
      this.lastProposalId = proposal.id;
      talk.addEvent(
        `Quest ${game.current_quest}: ${nameOf(proposal.leader_id)} proposed team [${proposal.team_member_ids.map(nameOf).join(', ')}]`
      );
    }
    if (this.lastVoteTrack !== null && game.vote_track > this.lastVoteTrack) {
      talk.addEvent(`The proposal was REJECTED (vote track now ${game.vote_track}/5)`);
    }
    this.lastVoteTrack = game.vote_track;
    if (this.lastPhase === 'voting' && game.phase === 'quest') {
      talk.addEvent('The team was APPROVED — quest in progress');
    }
    this.lastPhase = game.phase;
    if (this.lastQuest !== null && game.current_quest > this.lastQuest) {
      // The API doesn't expose the result — players' reactions (in the talk
      // transcript) usually reveal it.
      talk.addEvent(`Quest ${this.lastQuest} finished; the game moved on to quest ${game.current_quest}`);
    }
    this.lastQuest = game.current_quest;
  }

  // ── prompt context ────────────────────────────────────────────────────────

  /** Vars every decision prompt receives. */
  private baseVars(ctx: BrainContext, game: GameObservation): Record<string, string | number> {
    const { identity } = ctx;
    const intel =
      identity.role_intel.known_players.length > 0
        ? `${identity.role_intel.known_players_label}: ${identity.role_intel.known_players.join(', ')}`
        : '(no special intel)';
    const seats = [...game.players]
      .sort((a, b) => a.seat_position - b.seat_position)
      .map((p) => {
        const tags = [
          p.is_leader ? 'leader' : '',
          p.id === ctx.identity.user_id ? 'ME' : '',
          p.is_on_team ? 'on-team' : '',
        ]
          .filter(Boolean)
          .join(', ');
        return `seat ${p.seat_position}: ${p.display_name}${tags ? ` (${tags})` : ''}`;
      })
      .join('\n');
    return {
      my_name: identity.display_name,
      my_role: identity.role,
      my_special_role: identity.special_role,
      my_intel: intel,
      seat_table: seats,
      quest_number: game.current_quest,
      vote_track: game.vote_track,
      team_size: game.quest_requirement.size,
      fails_required: game.quest_requirement.fails_required,
      talk_log: ctx.talk?.render() ?? '(no transcript available — reason from the game state alone)',
    };
  }

  /** Map display names back to player ids; null if any name doesn't resolve. */
  private namesToIds(game: GameObservation, names: string[]): string[] | null {
    if (!Array.isArray(names)) return null;
    const ids: string[] = [];
    for (const name of names) {
      const p = game.players.find((pl) => pl.display_name === name);
      if (!p) return null;
      ids.push(p.id);
    }
    return ids;
  }
}
