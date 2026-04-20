/**
 * Role reveal renderer — runs once per language at game end.
 * Takes the player roster + their revealed roles (from meta.json / DB)
 * and produces 2–4 prose paragraphs describing who was who.
 */

import type { LLMClient } from './llm.js';
import type { GameMetaSnapshot } from '../types.js';

function buildRoster(meta: GameMetaSnapshot): string {
  // Stable ordering: good players first by seat, then evil by seat.
  const sorted = [...meta.players].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'good' ? -1 : 1;
    return (a.seat_number ?? 0) - (b.seat_number ?? 0);
  });
  return sorted
    .map((p) => {
      const seat = p.seat_number !== null ? `seat ${p.seat_number}` : 'no seat';
      const special = p.special_role ? `, special: ${p.special_role}` : '';
      return `- ${p.display_name} (${seat}) — ${p.role}${special}`;
    })
    .join('\n');
}

export async function renderRoleReveal(
  llm: LLMClient,
  meta: GameMetaSnapshot,
  language: 'fa' | 'en'
): Promise<string> {
  const promptFile = language === 'fa' ? 'role-reveal-fa.yml' : 'role-reveal-en.yml';
  return llm.runText(promptFile, { roster: buildRoster(meta) });
}
