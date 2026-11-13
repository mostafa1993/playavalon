/**
 * Unit tests: the review page's mapping from a summary file to its sections.
 * Every fact comes from the record the summary carries; any other format maps
 * to null ("This report is no longer available").
 */

import { describe, it, expect } from 'vitest';
import { summaryView } from '@/lib/review/summary-view';
import type { BlindReviewSummary, GodReviewSummary } from '@/types/review';

const god: GodReviewSummary = {
  format: 2,
  mode: 'god',
  language: 'en',
  gameId: 'g1',
  roomCode: 'ROOM01',
  generatedAt: '2026-01-01T11:00:00.000Z',
  narrative: 'The story.',
  quest_commentary: [
    { quest: 2, commentary: 'Quest two turned on Cy.' },
    { quest: 1, commentary: 'Quest one.' },
  ],
  performance: [
    { playerId: 'e', assessment: 'Ed read Merlin well.' },
    { playerId: 'b', assessment: 'Bo hid well.' },
    { playerId: 'zz', assessment: 'not a player' },
  ],
  record: {
    gameId: 'g1',
    mode: 'god',
    players: [
      { id: 'b', display_name: 'Bo', seat_number: 2, role: 'evil', special_role: 'assassin' },
      { id: 'a', display_name: 'Ana', seat_number: 1, role: 'good', special_role: 'merlin' },
      { id: 'c', display_name: 'Cy', seat_number: 3, role: 'good', special_role: null },
      { id: 'd', display_name: 'Di', seat_number: 4, role: 'evil', special_role: null },
      { id: 'e', display_name: 'Ed', seat_number: 5, role: 'good', special_role: 'percival' },
    ],
    proposals: [
      {
        quest: 1,
        proposalNumber: 2,
        leaderId: 'b',
        teamIds: ['b', 'c'],
        status: 'approved',
        votes: [
          { playerId: 'a', vote: 'reject' },
          { playerId: 'b', vote: 'approve' },
          { playerId: 'c', vote: 'approve' },
          { playerId: 'd', vote: 'approve' },
          { playerId: 'e', vote: 'reject' },
        ],
      },
      {
        quest: 1,
        proposalNumber: 1,
        leaderId: 'a',
        teamIds: ['a', 'b'],
        status: 'rejected',
        votes: [
          { playerId: 'a', vote: 'approve' },
          { playerId: 'b', vote: 'approve' },
          { playerId: 'c', vote: 'reject' },
          { playerId: 'd', vote: 'reject' },
          { playerId: 'e', vote: 'reject' },
        ],
      },
      { quest: 2, proposalNumber: 1, leaderId: 'c', teamIds: ['c', 'd', 'e'], status: 'pending', votes: [] },
    ],
    missions: [{ quest: 1, teamIds: ['b', 'c'], successCount: 1, failCount: 1, result: 'fail' }],
    lady: [{ quest: 1, investigatorId: 'e', targetId: 'b', result: 'evil' }],
    assassinPickId: 'a',
    outcome: { winner: 'evil', win_reason: 'assassin_found_merlin', ended_at: null },
    discussion: {
      startedAt: '2026-01-01T10:30:00.000Z',
      durationSec: 119.6,
      speakers: [
        { speakerId: 'd', transcript: 'آنا مرلین است', confidence: 0.6, low_confidence: false, durationSec: 119.6 },
        { speakerId: 'b', transcript: '  ', confidence: null, low_confidence: false, durationSec: 119.6 },
        { speakerId: 'e', transcript: 'شاید آنا', confidence: 0.32, low_confidence: true, durationSec: 119.6 },
      ],
    },
  },
};

const blind: BlindReviewSummary = {
  format: 2,
  mode: 'blind',
  language: 'fa',
  gameId: 'g1',
  roomCode: 'ROOM01',
  generatedAt: '2026-01-01T11:00:00.000Z',
  narrative: 'روایت',
  quest_commentary: [{ quest: 1, commentary: 'یک' }],
  guess_timeline: [
    {
      round: 1,
      quest: 0,
      proposal_round: 0,
      guesses: [{ player: 'Ana', guessed_role: 'Merlin', confidence: 'low', reasoning: 'r' }],
    },
  ],
  final_guesses: [{ player: 'Ana', guessed_role: 'Merlin', confidence: 'low', reasoning: 'r' }],
  record: {
    ...god.record,
    mode: 'blind',
    players: god.record.players.map(({ id, display_name, seat_number }) => ({ id, display_name, seat_number })),
    lady: [{ quest: 1, investigatorId: 'e', targetId: 'b' }],
  },
};

describe('summaryView', () => {
  it('shows each proposal with its own leader, team and votes, from the record', () => {
    const view = summaryView(god)!;
    expect(view.quests.map((q) => q.quest)).toEqual([1, 2]);
    const [q1, q2] = view.quests;
    expect(q1!.proposals).toEqual([
      {
        number: 1,
        leader: 'Ana',
        team: ['Ana', 'Bo'],
        approvals: ['Ana', 'Bo'],
        rejections: ['Cy', 'Di', 'Ed'],
        status: 'rejected',
      },
      {
        number: 2,
        leader: 'Bo',
        team: ['Bo', 'Cy'],
        approvals: ['Bo', 'Cy', 'Di'],
        rejections: ['Ana', 'Ed'],
        status: 'approved',
      },
    ]);
    expect(q1!.mission).toEqual({ team: ['Bo', 'Cy'], successCount: 1, failCount: 1, result: 'fail' });
    expect(q1!.lady).toEqual([{ investigator: 'Ed', target: 'Bo', result: 'evil' }]);
    expect(q1!.commentary).toBe('Quest one.');
    expect(q2!.proposals).toEqual([
      { number: 1, leader: 'Cy', team: ['Cy', 'Di', 'Ed'], approvals: [], rejections: [], status: 'pending' },
    ]);
    expect(q2!.mission).toBeNull();
    expect(q2!.commentary).toBe('Quest two turned on Cy.');
  });

  it('renders the role reveal and performance from the record, in seat order', () => {
    const view = summaryView(god)!;
    expect(view.roles).toEqual({
      good: [
        { seat: 1, name: 'Ana', role: 'Merlin' },
        { seat: 3, name: 'Cy', role: 'Loyal Servant' },
        { seat: 5, name: 'Ed', role: 'Percival' },
      ],
      evil: [
        { seat: 2, name: 'Bo', role: 'Assassin' },
        { seat: 4, name: 'Di', role: 'Minion' },
      ],
    });
    expect(view.performance).toEqual([
      { name: 'Ed', role: 'Percival', assessment: 'Ed read Merlin well.' },
      { name: 'Bo', role: 'Assassin', assessment: 'Bo hid well.' },
    ]);
    expect(view.detective).toBeNull();
    expect(summaryView({ ...god, language: 'fa' })!.roles!.evil).toEqual([
      { seat: 2, name: 'Bo', role: 'آدمکش' },
      { seat: 4, name: 'Di', role: 'یار موردرد' },
    ]);
  });

  it('shows the assassin phase: the assassin, the pick and each speaker\'s transcript', () => {
    const view = summaryView(god)!;
    expect(view.assassinPhase).toEqual({
      assassin: 'Bo',
      pick: 'Ana',
      durationSec: 119.6,
      // Silent speakers left out; the unsure transcript kept, and marked.
      speakers: [
        { name: 'Di', transcript: 'آنا مرلین است', durationSec: 119.6, lowConfidence: false },
        { name: 'Ed', transcript: 'شاید آنا', durationSec: 119.6, lowConfidence: true },
      ],
    });
    expect(view.outcome).toEqual({ winner: 'evil', reason: 'The Assassin found Merlin' });
    expect(view.narrative).toBe('The story.');
  });

  it('shows a blind report with no role, no Lady result and no assassin', () => {
    const view = summaryView(blind)!;
    expect(view.mode).toBe('blind');
    expect(view.roles).toBeNull();
    expect(view.performance).toEqual([]);
    expect(view.detective).toEqual({ finalGuesses: blind.final_guesses, timeline: blind.guess_timeline });
    expect(view.quests[0]!.lady).toEqual([{ investigator: 'Ed', target: 'Bo', result: null }]);
    expect(view.assassinPhase!.assassin).toBeNull();
    expect(view.assassinPhase!.pick).toBe('Ana');
    expect(view.outcome.reason).toBe('آدمکش مرلین را پیدا کرد');

    // A stray result in a blind record is never shown.
    const leaky = { ...blind, record: { ...blind.record, lady: [{ ...blind.record.lady[0]!, result: 'evil' }] } };
    expect(summaryView(leaky)!.quests[0]!.lady[0]!.result).toBeNull();
  });

  it('shows no assassin phase without a discussion or a pick, and an unknown reason as it is', () => {
    const view = summaryView({
      ...god,
      record: {
        ...god.record,
        discussion: null,
        assassinPickId: null,
        outcome: { winner: 'good', win_reason: 'something_new', ended_at: null },
      },
    })!;
    expect(view.assassinPhase).toBeNull();
    expect(view.outcome).toEqual({ winner: 'good', reason: 'something_new' });
  });

  it('maps any other format to null', () => {
    const oldGod = {
      mode: 'god',
      language: 'fa',
      role_reveal: 'نقش‌ها',
      narrative: 'روایت',
      performance: [{ player: 'Ana', role: 'merlin', assessment: 'خوب' }],
      quests: [{ quest_number: 1, leader_display_name: 'Ana', proposals: [] }],
      discussion: null,
    };
    const oldBlind = { mode: 'blind', language: 'fa', final_summary: 's', final_guesses: [], guess_timeline: [], quests: [] };
    const noMode = { language: 'fa', role_reveal: 'r', narrative: 'n', quests: [] };
    for (const summary of [
      oldGod,
      oldBlind,
      noMode,
      { ...god, format: 1 },
      { ...god, record: { ...god.record, mode: 'blind' } },
      { ...god, record: undefined },
      { ...god, performance: undefined },
      { ...blind, final_guesses: undefined },
      null,
      'summary',
    ]) {
      expect(summaryView(summary)).toBeNull();
    }
  });
});
