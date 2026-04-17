/**
 * Votes database queries
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Vote, VoteInsert, VoteChoice, VoteInfo } from '@/types/game';

/**
 * Submit a vote on a proposal
 */
export async function submitVote(
  client: SupabaseClient,
  vote: VoteInsert
): Promise<Vote> {
  const { data, error } = await client
    .from('votes')
    .insert(vote)
    .select()
    .single();

  if (error) {
    // Check for unique constraint violation (already voted)
    if (error.code === '23505') {
      throw new Error('ALREADY_VOTED');
    }
    throw error;
  }

  return data as Vote;
}

/**
 * Get a player's vote on a proposal (if exists)
 */
export async function getPlayerVote(
  client: SupabaseClient,
  proposalId: string,
  playerId: string
): Promise<Vote | null> {
  const { data, error } = await client
    .from('votes')
    .select('*')
    .eq('proposal_id', proposalId)
    .eq('player_id', playerId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data as Vote | null;
}

/**
 * Check if player has voted on proposal
 */
export async function hasPlayerVoted(
  client: SupabaseClient,
  proposalId: string,
  playerId: string
): Promise<boolean> {
  const vote = await getPlayerVote(client, proposalId, playerId);
  return vote !== null;
}

/**
 * Count votes for a proposal
 */
export async function getVoteCount(
  client: SupabaseClient,
  proposalId: string
): Promise<number> {
  const { count, error } = await client
    .from('votes')
    .select('*', { count: 'exact', head: true })
    .eq('proposal_id', proposalId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

/**
 * Get all votes for a proposal (only after voting complete)
 * Returns with player display names for display
 */
export async function getVotesForProposal(
  client: SupabaseClient,
  proposalId: string
): Promise<VoteInfo[]> {
  const { data, error } = await client
    .from('votes')
    .select(`
      player_id,
      vote,
      players!inner (
        display_name
      )
    `)
    .eq('proposal_id', proposalId);

  if (error) {
    throw error;
  }

  return (data || []).map((v) => {
    // Handle Supabase join return type
    const players = v.players as { display_name: string } | { display_name: string }[] | null;
    const displayName = Array.isArray(players)
      ? players[0]?.display_name || 'Unknown'
      : players?.display_name || 'Unknown';

    return {
      player_id: v.player_id,
      display_name: displayName,
      vote: v.vote as VoteChoice,
    };
  });
}

/**
 * Calculate vote totals for a proposal
 */
export async function calculateVoteTotals(
  client: SupabaseClient,
  proposalId: string
): Promise<{ approve: number; reject: number }> {
  const { data, error } = await client
    .from('votes')
    .select('vote')
    .eq('proposal_id', proposalId);

  if (error) {
    throw error;
  }

  const votes = data || [];
  return {
    approve: votes.filter((v: { vote: string }) => v.vote === 'approve').length,
    reject: votes.filter((v: { vote: string }) => v.vote === 'reject').length,
  };
}

/**
 * Get list of player IDs who have voted
 */
export async function getVotedPlayerIds(
  client: SupabaseClient,
  proposalId: string
): Promise<string[]> {
  const { data, error } = await client
    .from('votes')
    .select('player_id')
    .eq('proposal_id', proposalId);

  if (error) {
    throw error;
  }

  return (data || []).map((v: { player_id: string }) => v.player_id);
}

