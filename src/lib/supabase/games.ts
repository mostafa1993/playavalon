/**
 * Game database queries
 * CRUD operations for games table
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Game,
  GameInsert,
  GameUpdate,
  GamePhase,
  QuestResult,
} from '@/types/game';
import { updateRoomStatus } from './rooms';

/**
 * Create a new game for a room
 */
export async function createGame(
  client: SupabaseClient,
  game: GameInsert
): Promise<Game> {
  const { data, error } = await client
    .from('games')
    .insert(game)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as Game;
}

/**
 * Get game by room ID
 */
export async function getGameByRoomId(
  client: SupabaseClient,
  roomId: string
): Promise<Game | null> {
  const { data, error } = await client
    .from('games')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data as Game | null;
}

/**
 * Get game by ID
 */
export async function getGameById(
  client: SupabaseClient,
  gameId: string
): Promise<Game | null> {
  const { data, error } = await client
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data as Game | null;
}

/**
 * Update game state
 */
export async function updateGame(
  client: SupabaseClient,
  gameId: string,
  update: GameUpdate
): Promise<Game> {
  const { data, error } = await client
    .from('games')
    .update(update)
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as Game;
}

/**
 * Update game phase
 */
export async function updateGamePhase(
  client: SupabaseClient,
  gameId: string,
  phase: GamePhase
): Promise<Game> {
  return updateGame(client, gameId, { phase });
}

/**
 * Increment vote track (on rejection)
 */
export async function incrementVoteTrack(
  client: SupabaseClient,
  gameId: string
): Promise<Game> {
  // Get current vote track
  const game = await getGameById(client, gameId);
  if (!game) {
    throw new Error('Game not found');
  }

  return updateGame(client, gameId, {
    vote_track: game.vote_track + 1,
  });
}

/**
 * Reset vote track to 0 (on team approval)
 */
export async function resetVoteTrack(
  client: SupabaseClient,
  gameId: string
): Promise<Game> {
  return updateGame(client, gameId, { vote_track: 0 });
}

/**
 * Rotate leader to next player in seating order
 */
export async function rotateLeader(
  client: SupabaseClient,
  gameId: string
): Promise<Game> {
  const game = await getGameById(client, gameId);
  if (!game) {
    throw new Error('Game not found');
  }

  const nextIndex = (game.leader_index + 1) % game.seating_order.length;
  const nextLeaderId = game.seating_order[nextIndex];

  return updateGame(client, gameId, {
    leader_index: nextIndex,
    current_leader_id: nextLeaderId,
  });
}

/**
 * Add quest result and advance to next quest
 */
export async function addQuestResult(
  client: SupabaseClient,
  gameId: string,
  result: QuestResult
): Promise<Game> {
  const game = await getGameById(client, gameId);
  if (!game) {
    throw new Error('Game not found');
  }

  const updatedResults = [...game.quest_results, result];

  return updateGame(client, gameId, {
    quest_results: updatedResults,
    current_quest: game.current_quest + 1,
    vote_track: 0, // Reset vote track after quest
  });
}

/**
 * Set game winner and end the game
 * Also closes the room to remove it from active rooms list
 */
export async function endGame(
  client: SupabaseClient,
  gameId: string,
  winner: 'good' | 'evil',
  winReason: string
): Promise<Game> {
  // First get the game to find its room_id
  const game = await getGameById(client, gameId);
  if (!game) {
    throw new Error('Game not found');
  }

  // Update the game with game_over phase
  const updatedGame = await updateGame(client, gameId, {
    phase: 'game_over',
    winner,
    win_reason: winReason,
    ended_at: new Date().toISOString(),
  });

  // Close the room so it doesn't appear in active rooms list
  // This is idempotent - closing an already-closed room is a no-op
  await updateRoomStatus(client, game.room_id, 'closed');

  return updatedGame;
}

/**
 * Check if game exists for room
 */
export async function gameExistsForRoom(
  client: SupabaseClient,
  roomId: string
): Promise<boolean> {
  const { count, error } = await client
    .from('games')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

/**
 * Update Lady of the Lake holder
 */
export async function updateLadyHolder(
  client: SupabaseClient,
  gameId: string,
  newHolderId: string
): Promise<Game> {
  return updateGame(client, gameId, {
    lady_holder_id: newHolderId,
  });
}

// ============================================
// FEATURE 007: DRAFT TEAM SELECTION
// ============================================

/**
 * Update the leader's draft team selection
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @param playerIds - Array of player database IDs (0 to quest_size)
 * @returns Updated game record
 */
export async function updateDraftTeam(
  client: SupabaseClient,
  gameId: string,
  playerIds: string[]
): Promise<Game> {
  return updateGame(client, gameId, {
    draft_team: playerIds,
  });
}

/**
 * Clear the draft team selection
 * Called when proposal is submitted or quest advances
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @returns Updated game record
 */
export async function clearDraftTeam(
  client: SupabaseClient,
  gameId: string
): Promise<Game> {
  return updateGame(client, gameId, {
    draft_team: null,
  });
}

// ============================================
// FEATURE 009: MERLIN DECOY MODE
// ============================================

/**
 * Set the Merlin Decoy player for a game
 * Called during role distribution if merlin_decoy_enabled is true
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @param playerId - Player ID selected as decoy (must be good player, not Merlin)
 * @returns Updated game record
 */
export async function setMerlinDecoyPlayer(
  client: SupabaseClient,
  gameId: string,
  playerId: string
): Promise<Game> {
  return updateGame(client, gameId, {
    merlin_decoy_player_id: playerId,
  });
}

/**
 * Get the Merlin Decoy player ID for a game
 * Returns null if decoy mode is disabled or not yet selected
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @returns Player ID or null
 */
export async function getMerlinDecoyPlayer(
  client: SupabaseClient,
  gameId: string
): Promise<string | null> {
  const game = await getGameById(client, gameId);
  return game?.merlin_decoy_player_id ?? null;
}

// ============================================
// FEATURE 011: MERLIN SPLIT INTEL MODE
// ============================================

/**
 * Set the Split Intel groups for a game
 * Called during game creation if merlin_split_intel_enabled is true
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @param certainEvilIds - Array of player IDs in Certain Evil group
 * @param mixedEvilId - Evil player ID in Mixed Intel group
 * @param mixedGoodId - Good player ID in Mixed Intel group
 * @returns Updated game record
 */
export async function setSplitIntelGroups(
  client: SupabaseClient,
  gameId: string,
  certainEvilIds: string[],
  mixedEvilId: string,
  mixedGoodId: string
): Promise<Game> {
  return updateGame(client, gameId, {
    split_intel_certain_evil_ids: certainEvilIds,
    split_intel_mixed_evil_id: mixedEvilId,
    split_intel_mixed_good_id: mixedGoodId,
  });
}

/**
 * Get the Split Intel groups for a game
 * Returns null if split intel mode is disabled or not yet configured
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @returns Split intel groups or null
 */
export async function getSplitIntelGroups(
  client: SupabaseClient,
  gameId: string
): Promise<{
  certainEvilIds: string[];
  mixedEvilId: string;
  mixedGoodId: string;
} | null> {
  const game = await getGameById(client, gameId);
  if (
    !game?.split_intel_certain_evil_ids ||
    !game?.split_intel_mixed_evil_id ||
    !game?.split_intel_mixed_good_id
  ) {
    return null;
  }
  return {
    certainEvilIds: game.split_intel_certain_evil_ids,
    mixedEvilId: game.split_intel_mixed_evil_id,
    mixedGoodId: game.split_intel_mixed_good_id,
  };
}

// ============================================
// FEATURE 018: OBERON SPLIT INTEL FUNCTIONS
// ============================================

/**
 * Store the Oberon Split Intel groups for a game
 * Oberon is always in the mixed group, so we only store:
 * - certainEvilIds: Other visible evil (Morgana, Assassin)
 * - mixedGoodId: The good player in mixed group with Oberon
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @param certainEvilIds - Array of player IDs in Certain Evil group (NOT Oberon)
 * @param mixedGoodId - Good player ID in Mixed Intel group with Oberon
 * @returns Updated game record
 */
export async function setOberonSplitIntelGroups(
  client: SupabaseClient,
  gameId: string,
  certainEvilIds: string[],
  mixedGoodId: string
): Promise<Game> {
  return updateGame(client, gameId, {
    oberon_split_intel_certain_evil_ids: certainEvilIds,
    oberon_split_intel_mixed_good_id: mixedGoodId,
  });
}

/**
 * Get the Oberon Split Intel groups for a game
 * Returns null if oberon split intel mode is disabled or not yet configured
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @returns Oberon split intel groups or null
 */
export async function getOberonSplitIntelGroups(
  client: SupabaseClient,
  gameId: string
): Promise<{
  certainEvilIds: string[];
  mixedGoodId: string;
} | null> {
  const game = await getGameById(client, gameId);
  if (!game?.oberon_split_intel_mixed_good_id) {
    return null;
  }
  return {
    certainEvilIds: game.oberon_split_intel_certain_evil_ids || [],
    mixedGoodId: game.oberon_split_intel_mixed_good_id,
  };
}

// ============================================
// FEATURE 019: EVIL RING VISIBILITY FUNCTIONS
// ============================================

import type { EvilRingAssignments } from '@/types/game';

/**
 * Store the Evil Ring assignments for a game
 * Each evil player in the ring knows exactly one other evil player
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @param ringAssignments - Map of player ID to their one known teammate ID
 * @returns Updated game record
 */
export async function setEvilRingAssignments(
  client: SupabaseClient,
  gameId: string,
  ringAssignments: EvilRingAssignments
): Promise<Game> {
  return updateGame(client, gameId, {
    evil_ring_assignments: ringAssignments,
  });
}

/**
 * Get the Evil Ring assignments for a game
 * Returns null if ring visibility mode is disabled or not yet configured
 *
 * @param client - Supabase client
 * @param gameId - Game identifier
 * @returns Evil ring assignments or null
 */
export async function getEvilRingAssignments(
  client: SupabaseClient,
  gameId: string
): Promise<EvilRingAssignments | null> {
  const game = await getGameById(client, gameId);
  return game?.evil_ring_assignments ?? null;
}

// ============================================
// PLAY AGAIN: THE NEXT ROOM
// ============================================

/**
 * How long a claim on a game's next room holds. Past it, the claimer is taken
 * to have failed without releasing, and another player may claim.
 */
export const NEXT_ROOM_CLAIM_TTL_MS = 30_000;

/**
 * Whether a claim made at `claimedAt` still holds at `now`
 */
export function isNextRoomClaimFresh(claimedAt: string | null, now: Date): boolean {
  if (!claimedAt) return false;
  return now.getTime() - new Date(claimedAt).getTime() < NEXT_ROOM_CLAIM_TTL_MS;
}

/**
 * Claim the creation of a finished game's next room. The update matches only
 * while there is no next room and no fresh claim, and the row lock makes two
 * concurrent claims wait for each other: one of them wins.
 *
 * @returns Whether this player now holds the claim
 */
export async function claimNextRoom(
  client: SupabaseClient,
  gameId: string,
  playerId: string,
  claimedAt: Date
): Promise<boolean> {
  const staleBefore = new Date(claimedAt.getTime() - NEXT_ROOM_CLAIM_TTL_MS).toISOString();
  const { data, error } = await client
    .from('games')
    .update({
      next_room_claimed_by: playerId,
      next_room_claimed_at: claimedAt.toISOString(),
    })
    .eq('id', gameId)
    .is('next_room_id', null)
    .or(`next_room_claimed_at.is.null,next_room_claimed_at.lt."${staleBefore}"`)
    .select('id');

  if (error) {
    throw error;
  }

  return (data ?? []).length === 1;
}

/**
 * Link the next room to the game, if this player's claim still holds.
 *
 * @returns Whether the link was made
 */
export async function linkNextRoom(
  client: SupabaseClient,
  gameId: string,
  roomId: string,
  playerId: string,
  claimedAt: Date
): Promise<boolean> {
  const { data, error } = await client
    .from('games')
    .update({ next_room_id: roomId })
    .eq('id', gameId)
    .is('next_room_id', null)
    .eq('next_room_claimed_by', playerId)
    .eq('next_room_claimed_at', claimedAt.toISOString())
    .select('id');

  if (error) {
    throw error;
  }

  return (data ?? []).length === 1;
}

/**
 * Release this player's claim on the next room, after creating it failed.
 * Leaves anyone else's claim, and a made link, alone.
 */
export async function releaseNextRoomClaim(
  client: SupabaseClient,
  gameId: string,
  playerId: string,
  claimedAt: Date
): Promise<void> {
  const { error } = await client
    .from('games')
    .update({ next_room_claimed_by: null, next_room_claimed_at: null })
    .eq('id', gameId)
    .is('next_room_id', null)
    .eq('next_room_claimed_by', playerId)
    .eq('next_room_claimed_at', claimedAt.toISOString());

  if (error) {
    throw error;
  }
}
