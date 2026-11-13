import { PUBLIC_GAME_FIELDS, type Game, type PublicGame } from '@/types/game';

/**
 * A game as players and watchers receive it: only the fields named in
 * PUBLIC_GAME_FIELDS. Each player learns their own part of the hidden columns
 * (the decoy, the Split Intel groups, the Evil Ring) through the role route.
 */
export function publicGame(game: Game): PublicGame {
  return Object.fromEntries(PUBLIC_GAME_FIELDS.map((field) => [field, game[field]])) as PublicGame;
}
