/**
 * Who played a game.
 *
 * A game's `seating_order` lists every player dealt into it, and it never
 * changes after the game starts. Room membership is not a substitute: creating
 * a new room clears the creator's memberships of started and closed rooms, so a
 * player who has moved on is no longer a member of the finished game's room.
 */
export function playedInGame(
  game: { seating_order: string[] },
  playerId: string
): boolean {
  return game.seating_order.includes(playerId);
}
