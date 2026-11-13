/**
 * Who is in a room (pure functions).
 *
 * Bots hold seats but never leave through the leave route: their processes
 * exit when their game ends or their room closes, and their memberships stay.
 * So "is anyone left" and "who manages now" are questions about humans.
 */

export interface RoomMember {
  player_id: string;
  joined_at: string;
  is_bot: boolean;
}

/**
 * How many members are human
 */
export function countHumans(members: RoomMember[]): number {
  return members.filter((m) => !m.is_bot).length;
}

/**
 * The human who joined first, or null when only bots are left. A bot never
 * manages: nobody could deal a room a bot manages.
 */
export function longestPresentHuman(members: RoomMember[]): string | null {
  let first: RoomMember | null = null;
  for (const member of members) {
    if (member.is_bot) continue;
    if (!first || new Date(member.joined_at).getTime() < new Date(first.joined_at).getTime()) {
      first = member;
    }
  }
  return first?.player_id ?? null;
}
