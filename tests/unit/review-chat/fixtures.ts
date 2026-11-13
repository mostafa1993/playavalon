/**
 * A small finished game for the review chat's tests: its whole record (turns
 * included), in god and blind mode, and the Persian report the players read.
 */

import type { GodReviewSummary, ReviewGameRecord } from '@/types/review';

const turn = (
  quest: number,
  round: number,
  i: number,
  speakerId: string,
  transcript: string,
  proposalNumber: number | null,
  lowConfidence = false
) => ({
  quest,
  round,
  turn: i,
  speakerId,
  transcript,
  confidence: lowConfidence ? 0.3 : 0.8,
  low_confidence: lowConfidence,
  startedAt: '2026-01-01T10:00:00.000Z',
  durationSec: 20,
  proposalNumber,
});

const facts = {
  gameId: 'game-1',
  proposals: [
    {
      quest: 1,
      proposalNumber: 1,
      leaderId: 'a',
      teamIds: ['a', 'b'],
      status: 'rejected' as const,
      votes: [
        { playerId: 'a', vote: 'approve' as const },
        { playerId: 'b', vote: 'approve' as const },
        { playerId: 'c', vote: 'reject' as const },
        { playerId: 'd', vote: 'reject' as const },
        { playerId: 'e', vote: 'reject' as const },
      ],
    },
    {
      quest: 1,
      proposalNumber: 2,
      leaderId: 'b',
      teamIds: ['b', 'c'],
      status: 'approved' as const,
      votes: [
        { playerId: 'a', vote: 'reject' as const },
        { playerId: 'b', vote: 'approve' as const },
        { playerId: 'c', vote: 'approve' as const },
        { playerId: 'd', vote: 'approve' as const },
        { playerId: 'e', vote: 'reject' as const },
      ],
    },
  ],
  missions: [{ quest: 1, teamIds: ['b', 'c'], successCount: 1, failCount: 1, result: 'fail' as const }],
  assassinPickId: 'a',
  outcome: { winner: 'evil' as const, win_reason: 'assassin_found_merlin', ended_at: null },
  discussion: {
    startedAt: '2026-01-01T10:30:00.000Z',
    durationSec: 119.6,
    speakers: [
      { speakerId: 'd', transcript: 'آنا مرلین است', confidence: 0.6, low_confidence: false, durationSec: 119.6 },
      { speakerId: 'b', transcript: '  ', confidence: null, low_confidence: false, durationSec: 119.6 },
      { speakerId: 'c', transcript: 'شاید اد', confidence: 0.2, low_confidence: true, durationSec: 119.6 },
    ],
  },
};

const turns = [
  turn(0, 0, 0, 'a', 'سلام، بازی خوبی داشته باشیم', null),
  turn(1, 0, 0, 'a', 'من به بو اعتماد دارم', 1),
  turn(1, 1, 0, 'b', 'این تیم را ببرید', 2),
  turn(1, 1, 1, 'e', '', 2),
  turn(1, 1, 2, 'c', 'کی رو ببریم', 2, true),
];

const seats = [
  { id: 'a', display_name: 'Ana', seat_number: 1 },
  { id: 'b', display_name: 'Bo', seat_number: 2 },
  { id: 'c', display_name: 'Cy', seat_number: 3 },
  { id: 'd', display_name: 'Di', seat_number: 4 },
  { id: 'e', display_name: 'Ed', seat_number: 5 },
];

const god = {
  ...facts,
  mode: 'god' as const,
  players: [
    { ...seats[0], role: 'good' as const, special_role: 'merlin' as const },
    { ...seats[1], role: 'evil' as const, special_role: 'assassin' as const },
    { ...seats[2], role: 'good' as const, special_role: null },
    { ...seats[3], role: 'evil' as const, special_role: 'morgana' as const },
    { ...seats[4], role: 'good' as const, special_role: 'percival' as const },
  ],
  lady: [{ quest: 1, investigatorId: 'e', targetId: 'b', result: 'evil' as const }],
};

export const godRecord: ReviewGameRecord = { ...god, turns };

export const blindRecord: ReviewGameRecord = {
  ...facts,
  turns,
  mode: 'blind',
  players: seats,
  lady: [{ quest: 1, investigatorId: 'e', targetId: 'b' }],
};

/** The roles of the game's role rows, as a blind game's chat is told them. */
export const roleRows = [
  { player_id: 'a', role: 'good', special_role: 'merlin' },
  { player_id: 'b', role: 'evil', special_role: 'assassin' },
  { player_id: 'c', role: 'good', special_role: 'servant' },
  { player_id: 'd', role: 'evil', special_role: 'morgana' },
  { player_id: 'e', role: 'good', special_role: 'percival' },
];

export const godReportFa: GodReviewSummary = {
  format: 2,
  mode: 'god',
  language: 'fa',
  gameId: 'game-1',
  roomCode: 'ROOM01',
  generatedAt: '2026-01-01T11:00:00.000Z',
  narrative: 'روایت بازی.',
  quest_commentary: [{ quest: 1, commentary: 'ماموریت اول با یک کارت شکست خورد.' }],
  performance: [{ playerId: 'd', assessment: 'دی خوب بازی کرد.' }],
  record: god,
};
