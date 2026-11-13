/**
 * The AI game report as the review page shows it: a pure mapping from the
 * summary file the reviewer wrote to the page's sections, with names in place
 * of ids and labels in the report's language.
 *
 * Every fact on the page — who had which role, each proposal's leader, team
 * and votes, each mission, Lady of the Lake, the assassin's pick — comes from
 * the record the summary carries; the model's words are only the narrative,
 * each quest's commentary and the performance notes. A summary in any other
 * format maps to null, and the page says the report is no longer available.
 */

import { SPECIAL_ROLES } from '@/lib/utils/constants';
import type { SpecialRole } from '@/types/database';
import {
  REVIEW_SUMMARY_FORMAT,
  type GodReviewRecordPlayer,
  type ReviewGuessRound,
  type ReviewRoleGuess,
  type ReviewSummary,
} from '@/types/review';

export type ReviewLanguage = 'fa' | 'en';

export interface ReviewRoleLine {
  seat: number;
  name: string;
  /** The role's name in the report's language. */
  role: string;
}

export interface ReviewProposalView {
  number: number;
  leader: string;
  team: string[];
  approvals: string[];
  rejections: string[];
  status: 'pending' | 'approved' | 'rejected';
}

export interface ReviewQuestView {
  quest: number;
  /** In proposal order, each with its own leader. */
  proposals: ReviewProposalView[];
  mission: null | {
    team: string[];
    successCount: number;
    failCount: number;
    result: 'success' | 'fail';
  };
  /** Lady of the Lake after this quest; `result` only in god mode. */
  lady: Array<{ investigator: string; target: string; result: 'good' | 'evil' | null }>;
  commentary: string | null;
}

export interface ReviewAssassinPhaseView {
  /** God mode: who the Assassin was. */
  assassin: string | null;
  /** Who the Assassin named as Merlin. */
  pick: string | null;
  durationSec: number | null;
  /** Each speaker's transcript, as the record holds it; silent speakers left
   *  out. `lowConfidence`: speech-to-text was unsure of it, and the page marks
   *  it as unreliable. */
  speakers: Array<{
    name: string;
    transcript: string;
    durationSec: number;
    lowConfidence: boolean;
  }>;
}

export interface ReviewView {
  mode: 'god' | 'blind';
  language: ReviewLanguage;
  roomCode: string;
  generatedAt: string;
  outcome: { winner: 'good' | 'evil' | null; reason: string | null };
  /** God mode: who had which role, by seat, each side apart. */
  roles: { good: ReviewRoleLine[]; evil: ReviewRoleLine[] } | null;
  narrative: string;
  /** God mode, in seat order. */
  performance: Array<{ name: string; role: string; assessment: string }>;
  /** Blind mode: the detective's guesses. */
  detective: { finalGuesses: ReviewRoleGuess[]; timeline: ReviewGuessRound[] } | null;
  quests: ReviewQuestView[];
  /** When the game had an assassin-phase discussion or pick. */
  assassinPhase: ReviewAssassinPhaseView | null;
}

const ROLE_FA: Record<SpecialRole, string> = {
  merlin: 'مرلین',
  percival: 'پرسیوال',
  servant: 'خدمتگزار وفادار',
  assassin: 'آدمکش',
  morgana: 'مورگانا',
  mordred: 'موردرد',
  oberon_standard: 'اوبرون',
  oberon_chaos: 'اوبرون (آشوب)',
  minion: 'یار موردرد',
  lunatic: 'دیوانه',
  brute: 'بی‌رحم',
};

const WIN_REASON: Record<string, Record<ReviewLanguage, string>> = {
  '3_quest_successes': { fa: 'سه ماموریت موفق شد', en: 'Three quests succeeded' },
  '3_quest_failures': { fa: 'سه ماموریت شکست خورد', en: 'Three quests failed' },
  '5_rejections': { fa: 'پنج پیشنهاد پشت سر هم رد شد', en: 'Five proposals in a row were rejected' },
  assassin_found_merlin: { fa: 'آدمکش مرلین را پیدا کرد', en: 'The Assassin found Merlin' },
};

function roleLabel(player: GodReviewRecordPlayer, language: ReviewLanguage): string {
  const role: SpecialRole = player.special_role ?? (player.role === 'evil' ? 'minion' : 'servant');
  const label = language === 'fa' ? ROLE_FA[role] : SPECIAL_ROLES[role]?.name;
  return label ?? role;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** Only the current format: the record and the model's parts it needs. */
function isCurrentSummary(v: unknown): v is ReviewSummary {
  if (!isObject(v) || v.format !== REVIEW_SUMMARY_FORMAT) return false;
  if (v.language !== 'fa' && v.language !== 'en') return false;
  if (typeof v.narrative !== 'string' || !Array.isArray(v.quest_commentary)) return false;
  const r = v.record;
  if (!isObject(r) || r.mode !== v.mode) return false;
  if (![r.players, r.proposals, r.missions, r.lady].every(Array.isArray)) return false;
  if (v.mode === 'god') return Array.isArray(v.performance);
  if (v.mode === 'blind') return Array.isArray(v.guess_timeline) && Array.isArray(v.final_guesses);
  return false;
}

/** The page's sections for a summary; null for a summary in another format. */
export function summaryView(summary: unknown): ReviewView | null {
  if (!isCurrentSummary(summary)) return null;
  const { record, language } = summary;
  const nameById = new Map<string, string>(record.players.map((p) => [p.id, p.display_name]));
  const name = (id: string) => nameById.get(id) ?? '?';

  // What the investigator saw is shown in god mode only.
  const ladyUses =
    summary.mode === 'god'
      ? summary.record.lady.map((l) => ({ ...l, result: l.result }))
      : summary.record.lady.map((l) => ({ ...l, result: null }));

  const questNumbers = [
    ...new Set([...record.proposals.map((p) => p.quest), ...record.missions.map((m) => m.quest)]),
  ]
    .filter((q) => q > 0)
    .sort((a, b) => a - b);

  const quests: ReviewQuestView[] = questNumbers.map((quest) => {
    const mission = record.missions.find((m) => m.quest === quest);
    return {
      quest,
      proposals: record.proposals
        .filter((p) => p.quest === quest)
        .sort((a, b) => a.proposalNumber - b.proposalNumber)
        .map((p) => ({
          number: p.proposalNumber,
          leader: name(p.leaderId),
          team: p.teamIds.map(name),
          approvals: p.votes.filter((v) => v.vote === 'approve').map((v) => name(v.playerId)),
          rejections: p.votes.filter((v) => v.vote === 'reject').map((v) => name(v.playerId)),
          status: p.status,
        })),
      mission: mission
        ? {
            team: mission.teamIds.map(name),
            successCount: mission.successCount,
            failCount: mission.failCount,
            result: mission.result,
          }
        : null,
      lady: ladyUses
        .filter((l) => l.quest === quest)
        .map((l) => ({ investigator: name(l.investigatorId), target: name(l.targetId), result: l.result })),
      commentary: summary.quest_commentary.find((c) => c.quest === quest)?.commentary ?? null,
    };
  });

  const discussion = record.discussion;
  const assassin =
    summary.mode === 'god'
      ? summary.record.players.find((p) => p.special_role === 'assassin') ?? null
      : null;
  const assassinPhase: ReviewAssassinPhaseView | null =
    discussion || record.assassinPickId
      ? {
          assassin: assassin ? assassin.display_name : null,
          pick: record.assassinPickId ? name(record.assassinPickId) : null,
          durationSec: discussion ? discussion.durationSec : null,
          speakers: (discussion?.speakers ?? [])
            .filter((s) => s.transcript.trim().length > 0)
            .map((s) => ({
              name: name(s.speakerId),
              transcript: s.transcript,
              durationSec: s.durationSec,
              lowConfidence: s.low_confidence,
            })),
        }
      : null;

  const reason = record.outcome?.win_reason ?? null;
  const base = {
    mode: summary.mode,
    language,
    roomCode: summary.roomCode,
    generatedAt: summary.generatedAt,
    outcome: {
      winner: record.outcome?.winner ?? null,
      reason: reason === null ? null : (WIN_REASON[reason]?.[language] ?? reason),
    },
    narrative: summary.narrative,
    quests,
    assassinPhase,
  };

  if (summary.mode === 'god') {
    const players = [...summary.record.players].sort((a, b) => a.seat_number - b.seat_number);
    const line = (p: GodReviewRecordPlayer): ReviewRoleLine => ({
      seat: p.seat_number,
      name: p.display_name,
      role: roleLabel(p, language),
    });
    const byId = new Map(players.map((p) => [p.id, p]));
    return {
      ...base,
      roles: {
        good: players.filter((p) => p.role === 'good').map(line),
        evil: players.filter((p) => p.role === 'evil').map(line),
      },
      performance: summary.performance.flatMap((note) => {
        const p = byId.get(note.playerId);
        return p ? [{ name: p.display_name, role: roleLabel(p, language), assessment: note.assessment }] : [];
      }),
      detective: null,
    };
  }

  return {
    ...base,
    roles: null,
    performance: [],
    detective: { finalGuesses: summary.final_guesses, timeline: summary.guess_timeline },
  };
}
