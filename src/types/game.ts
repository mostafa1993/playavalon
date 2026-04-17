/**
 * Game types for Phase 3: Quest System
 * Defines types for game state, proposals, votes, and quest actions
 */

// ============================================
// ENUM TYPES
// ============================================

export type GamePhase =
  | 'team_building'   // Leader selecting team
  | 'voting'          // All players voting on team
  | 'quest'           // Team executing quest
  | 'quest_result'    // Showing quest result
  | 'lady_of_lake'    // Lady of the Lake investigation (after Quest 2, 3, 4)
  | 'assassin'        // Assassin guessing Merlin (Good won 3 quests)
  | 'game_over';      // Game ended

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export type VoteChoice = 'approve' | 'reject';

export type QuestActionType = 'success' | 'fail';

export type GameWinner = 'good' | 'evil';

// ============================================
// UI DISPLAY TYPES
// ============================================

/**
 * Feature 008: Center Game Messages
 * Message structure for center circle display
 */
export interface CenterMessage {
  line1: string;  // Primary text (e.g., "Quest 1", "Assassin Phase")
  line2: string;  // Secondary text (e.g., "Select 2 players", "Vote on the team")
}

// ============================================
// DATABASE ROW TYPES
// ============================================

export interface Game {
  id: string;
  room_id: string;
  player_count: number;
  phase: GamePhase;
  current_quest: number;
  current_leader_id: string;
  vote_track: number;
  quest_results: QuestResult[];
  seating_order: string[];
  leader_index: number;
  winner: GameWinner | null;
  win_reason: string | null;
  assassin_guess_id: string | null;
  lady_holder_id: string | null;
  lady_enabled: boolean;
  draft_team: string[] | null;  // Feature 007: Leader's current draft team selection
  // Feature 009: Merlin Decoy Mode
  merlin_decoy_player_id: string | null;  // Good player appearing as evil to Merlin
  // Feature 011: Merlin Split Intel Mode
  split_intel_certain_evil_ids: string[] | null;  // Array of guaranteed evil player IDs
  split_intel_mixed_evil_id: string | null;       // Evil player in mixed group
  split_intel_mixed_good_id: string | null;       // Good player in mixed group
  // Feature 018: Oberon Split Intel Mode
  oberon_split_intel_certain_evil_ids: string[] | null;  // Evil players in Certain group (excludes Oberon)
  oberon_split_intel_mixed_good_id: string | null;       // Good player in Mixed group with Oberon
  // Feature 019: Evil Ring Visibility Mode
  evil_ring_assignments: EvilRingAssignments | null;  // Maps each evil player to their one known teammate
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface GameInsert {
  id?: string;
  room_id: string;
  player_count: number;
  phase?: GamePhase;
  current_quest?: number;
  current_leader_id: string;
  vote_track?: number;
  quest_results?: QuestResult[];
  seating_order: string[];
  leader_index?: number;
  winner?: GameWinner | null;
  win_reason?: string | null;
  lady_holder_id?: string | null;
  lady_enabled?: boolean;
  merlin_decoy_player_id?: string | null;  // Feature 009
  // Feature 011: Merlin Split Intel Mode
  split_intel_certain_evil_ids?: string[] | null;
  split_intel_mixed_evil_id?: string | null;
  split_intel_mixed_good_id?: string | null;
  // Feature 018: Oberon Split Intel Mode
  oberon_split_intel_certain_evil_ids?: string[] | null;
  oberon_split_intel_mixed_good_id?: string | null;
  // Feature 019: Evil Ring Visibility Mode
  evil_ring_assignments?: EvilRingAssignments | null;
  created_at?: string;
  updated_at?: string;
  ended_at?: string | null;
}

export interface GameUpdate {
  phase?: GamePhase;
  current_quest?: number;
  current_leader_id?: string;
  vote_track?: number;
  quest_results?: QuestResult[];
  leader_index?: number;
  winner?: GameWinner | null;
  win_reason?: string | null;
  assassin_guess_id?: string | null;
  lady_holder_id?: string | null;
  lady_enabled?: boolean;
  draft_team?: string[] | null;  // Feature 007: Update draft team selection
  merlin_decoy_player_id?: string | null;  // Feature 009
  // Feature 011: Merlin Split Intel Mode
  split_intel_certain_evil_ids?: string[] | null;
  split_intel_mixed_evil_id?: string | null;
  split_intel_mixed_good_id?: string | null;
  // Feature 018: Oberon Split Intel Mode
  oberon_split_intel_certain_evil_ids?: string[] | null;
  oberon_split_intel_mixed_good_id?: string | null;
  // Feature 019: Evil Ring Visibility Mode
  evil_ring_assignments?: EvilRingAssignments | null;
  ended_at?: string | null;
}

export interface TeamProposal {
  id: string;
  game_id: string;
  quest_number: number;
  proposal_number: number;
  leader_id: string;
  team_member_ids: string[];
  status: ProposalStatus;
  approve_count: number;
  reject_count: number;
  created_at: string;
  resolved_at: string | null;
}

export interface TeamProposalInsert {
  id?: string;
  game_id: string;
  quest_number: number;
  proposal_number: number;
  leader_id: string;
  team_member_ids: string[];
  status?: ProposalStatus;
  approve_count?: number;
  reject_count?: number;
  created_at?: string;
  resolved_at?: string | null;
}

export interface Vote {
  id: string;
  proposal_id: string;
  player_id: string;
  vote: VoteChoice;
  created_at: string;
}

export interface VoteInsert {
  id?: string;
  proposal_id: string;
  player_id: string;
  vote: VoteChoice;
  created_at?: string;
}

export interface QuestAction {
  id: string;
  game_id: string;
  quest_number: number;
  player_id: string;
  action: QuestActionType;
  created_at: string;
}

export interface QuestActionInsert {
  id?: string;
  game_id: string;
  quest_number: number;
  player_id: string;
  action: QuestActionType;
  created_at?: string;
}

export interface GameEvent {
  id: string;
  game_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

export interface GameEventInsert {
  id?: string;
  game_id: string;
  event_type: string;
  event_data?: Record<string, unknown>;
  created_at?: string;
}

// ============================================
// QUEST CONFIGURATION
// ============================================

export interface QuestRequirement {
  size: number;      // Team size required
  fails: number;     // Fails needed for quest to fail (usually 1, sometimes 2)
}

export interface QuestResult {
  quest: number;           // 1-5
  result: 'success' | 'fail';
  success_count: number;   // Cards played
  fail_count: number;      // Cards played
  team_member_ids: string[];
  completed_at: string;    // ISO timestamp
}

// ============================================
// CLIENT STATE TYPES
// ============================================

/**
 * Full game state for client rendering
 */
export interface GameState {
  game: Game;
  players: GamePlayer[];
  current_proposal: TeamProposal | null;
  quest_requirement: QuestRequirement;
  // Player-specific state
  my_vote: VoteChoice | null;
  am_team_member: boolean;
  can_submit_action: boolean;
  has_submitted_action: boolean;
  // Aggregate state
  votes_submitted: number;
  total_players: number;
  actions_submitted: number;
  total_team_members: number;
  // Last vote result (for reveal animation)
  last_vote_result: LastVoteResult | null;
  // Assassin phase (when Good wins 3 quests)
  assassin_phase: AssassinPhaseState | null;
  is_assassin: boolean;
  // Lady of the Lake phase
  lady_of_lake: LadyOfLakeState | null;
  // Feature 007: Draft team selection
  draft_team: string[] | null;
  is_draft_in_progress: boolean;
}

/**
 * Last vote result for reveal animation
 */
export interface LastVoteResult {
  proposal_id: string;
  is_approved: boolean;
  approve_count: number;
  reject_count: number;
  votes: VoteInfo[];
}

/**
 * Player info for game display
 */
export interface GamePlayer {
  id: string;
  display_name: string;
  seat_position: number;    // Index in seating order (0-based)
  is_leader: boolean;
  is_on_team: boolean;      // On current proposal's team
  has_voted: boolean;       // Has voted on current proposal
  is_connected: boolean;
  // Only populated during game_over phase
  revealed_role?: 'good' | 'evil';
  revealed_special_role?: string;
  // Feature 009: Merlin Decoy indicator (only shown at game_over)
  was_decoy?: boolean;
  // Feature 011: Split Intel mixed group indicator (only shown at game_over)
  was_mixed_group?: boolean;
  // Feature 018: Oberon Split Intel mixed group indicator (only shown at game_over)
  was_mixed_group_with_oberon?: boolean;
}

/**
 * Assassin phase state
 */
export interface AssassinPhaseState {
  assassin_id: string;
  assassin_display_name: string;
  merlin_id: string; // Only known to server
  can_guess: boolean; // True if current player is assassin
}

/**
 * Lady of the Lake state
 */
export interface LadyOfLakeState {
  enabled: boolean;
  holder_id: string | null;
  holder_display_name: string | null;
  investigated_player_ids: string[];
  previous_lady_holder_ids: string[]; // Previous holders cannot be investigated
  is_holder: boolean;           // Current player is Lady holder
  can_investigate: boolean;     // In lady_of_lake phase and is holder
  last_investigation: {         // For public announcement
    investigator_display_name: string;
    target_display_name: string;
  } | null;
}

/**
 * Lady investigation record
 */
export interface LadyInvestigation {
  id: string;
  game_id: string;
  quest_number: number;
  investigator_id: string;
  target_id: string;
  result: 'good' | 'evil';
  created_at: string;
}

/**
 * Lady investigation API request
 */
export interface LadyInvestigateRequest {
  target_player_id: string;
}

/**
 * Lady investigation API response
 */
export interface LadyInvestigateResponse {
  success: boolean;
  result: 'good' | 'evil';      // Only for Lady holder
  new_holder_id: string;
  new_holder_display_name: string;
  next_quest?: number;          // The next quest number after Lady phase
}

/**
 * Vote info (after reveal)
 */
export interface VoteInfo {
  player_id: string;
  display_name: string;
  vote: VoteChoice;
}

/**
 * Quest result display (shuffled actions)
 */
export interface QuestResultDisplay {
  quest_number: number;
  team_size: number;
  success_count: number;
  fail_count: number;
  outcome: 'success' | 'fail';
  fails_required: number;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface ProposeTeamRequest {
  team_member_ids: string[];
}

export interface ProposeTeamResponse {
  proposal_id: string;
  quest_number: number;
  proposal_number: number;
  team_member_ids: string[];
  leader_id: string;
}

export interface VoteRequest {
  vote: VoteChoice;
}

export interface VoteResponse {
  recorded: boolean;
  votes_submitted: number;
  total_players: number;
}

export interface QuestActionRequest {
  action: QuestActionType;
}

export interface QuestActionResponse {
  recorded: boolean;
  actions_submitted: number;
  total_team_members: number;
}

export interface ContinueGameResponse {
  phase: GamePhase;
  current_quest: number;
  current_leader_id: string;
  winner?: GameWinner;
  win_reason?: string;
}

export interface GameHistoryResponse {
  events: GameEvent[];
  proposals: (TeamProposal & { votes: VoteInfo[] })[];
  quest_results: QuestResult[];
}

// ============================================
// FEATURE 007: DRAFT TEAM SELECTION
// ============================================

/**
 * API Request: Update draft team selection
 */
export interface UpdateDraftTeamRequest {
  team_member_ids: string[];  // Array of player database IDs (0 to quest_size)
}

/**
 * API Response: Update draft team selection
 */
export interface UpdateDraftTeamResponse {
  draft_team: string[];
  quest_number: number;
  required_size: number;
  updated_at: string;
}

/**
 * Result of validating a draft team selection
 */
export interface DraftValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================
// EVENT DATA TYPES
// ============================================

export interface GameStartedEventData {
  seating_order: string[];
  first_leader_id: string;
  player_count: number;
}

export interface TeamProposedEventData {
  quest_number: number;
  proposal_number: number;
  leader_id: string;
  team_member_ids: string[];
}

export interface VotesRevealedEventData {
  proposal_id: string;
  votes: VoteInfo[];
  result: ProposalStatus;
  approve_count: number;
  reject_count: number;
}

export interface QuestCompletedEventData {
  quest_number: number;
  result: 'success' | 'fail';
  success_count: number;
  fail_count: number;
  team_size: number;
}

export interface GameEndedEventData {
  winner: GameWinner;
  win_reason: string;
  final_score: { good: number; evil: number };
  assassin_found_merlin?: boolean;
}

// ============================================
// UTILITY TYPES
// ============================================

export type WinReason =
  | '3_quest_successes'      // Good won 3 quests (Assassin failed to find Merlin)
  | '3_quest_failures'       // Evil won 3 quests
  | '5_rejections'           // 5 consecutive team rejections
  | 'assassin_found_merlin'; // Assassin correctly identified Merlin

export interface GameScore {
  good: number;  // Successful quests
  evil: number;  // Failed quests
}

// ============================================
// FEATURE 010: MERLIN QUIZ TYPES
// ============================================

/**
 * A single quiz vote record
 */
export interface MerlinQuizVote {
  id: string;
  game_id: string;
  voter_player_id: string;
  suspected_player_id: string | null;  // null = skipped
  submitted_at: string;
}

/**
 * Insert type for creating a quiz vote
 */
export interface MerlinQuizVoteInsert {
  game_id: string;
  voter_player_id: string;
  suspected_player_id: string | null;
}

/**
 * Quiz state for client display
 */
export interface MerlinQuizState {
  quiz_enabled: boolean;          // True if Merlin was in game
  quiz_active: boolean;           // True if quiz is in progress
  quiz_complete: boolean;         // True if all voted or timeout
  my_vote: string | null;         // Current player's vote (null if not voted, 'skipped' if skipped)
  has_voted: boolean;             // Whether current player has voted
  has_skipped: boolean;           // Whether current player skipped
  votes_submitted: number;        // Count of votes submitted
  total_players: number;          // Total players in game
  connected_players: number;      // Currently connected players
  quiz_started_at: string | null; // First vote timestamp for timeout calc
  timeout_seconds: number;        // Quiz timeout (60)
}

/**
 * Quiz results for display
 */
export interface MerlinQuizResults {
  quiz_complete: boolean;
  results: MerlinQuizResultEntry[] | null;
  actual_merlin_id: string;
  actual_merlin_display_name: string;
  total_votes: number;
  skipped_count: number;
}

/**
 * Single entry in quiz results table
 */
export interface MerlinQuizResultEntry {
  player_id: string;
  display_name: string;
  vote_count: number;
  is_most_voted: boolean;
  is_actual_merlin: boolean;
}

/**
 * API request for submitting a quiz vote
 */
export interface MerlinQuizVoteRequest {
  suspected_player_id: string | null;  // null = skip
}

/**
 * API response for submitting a quiz vote
 */
export interface MerlinQuizVoteResponse {
  success: boolean;
  votes_submitted: number;
  total_players: number;
  quiz_complete: boolean;
}

// ============================================
// FEATURE 013: INLINE VOTE REVEAL TYPES
// ============================================

/**
 * Vote reveal data for inline display on player avatars
 */
export interface VoteRevealData {
  votes: VoteInfo[];
  isApproved: boolean;
  approveCount: number;
  rejectCount: number;
}

// ============================================
// FEATURE 011: MERLIN SPLIT INTEL TYPES
// ============================================

/**
 * Split Intel group assignments (server-side)
 */
export interface SplitIntelGroups {
  certainEvilIds: string[];   // 0-2 guaranteed evil players
  mixedEvilId: string;        // 1 evil player in mixed group
  mixedGoodId: string;        // 1 good player in mixed group
}

/**
 * Split Intel visibility data for Merlin's role reveal
 */
export interface SplitIntelVisibility {
  enabled: true;
  certainEvil: Array<{ id: string; name: string }>;  // Guaranteed evil
  mixedIntel: Array<{ id: string; name: string }>;   // 1 evil + 1 good (shuffled)
  hiddenCount: number;  // Mordred + Oberon Chaos count
  certainLabel: string;  // "🎯 Certain Evil"
  certainDescription: string;  // "These players are definitely evil"
  mixedLabel: string;    // "❓ Mixed Intel"
  mixedDescription: string;  // "One is evil, one is good - you don't know which"
  hiddenWarning?: string;  // "X evil player(s) hidden from you" (if applicable)
}

/**
 * Split Intel viability check result
 */
export interface SplitIntelViability {
  viable: boolean;
  visibleEvilCount: number;
  reason?: string;
}

// ============================================
// FEATURE 018: OBERON SPLIT INTEL TYPES
// ============================================

/**
 * Oberon Split Intel group assignments (server-side)
 * Oberon is ALWAYS in the mixed group
 */
export interface OberonSplitIntelGroups {
  certainEvilIds: string[];   // Other visible evil players (Morgana, Assassin - NOT Oberon)
  oberonId: string;           // Oberon's player ID (always in mixed group)
  mixedGoodId: string;        // 1 good player in mixed group (not Merlin)
}

/**
 * Oberon Split Intel visibility data for Merlin's role reveal
 */
export interface OberonSplitIntelVisibility {
  enabled: true;
  certainEvil: Array<{ id: string; name: string }>;  // Morgana, Assassin (NOT Oberon)
  mixedIntel: Array<{ id: string; name: string }>;   // Oberon + 1 good (shuffled)
  hiddenCount: number;  // Mordred count only (Oberon is visible in this mode)
  certainLabel: string;  // "🎯 Certain Evil"
  certainDescription: string;  // "These players are definitely evil"
  mixedLabel: string;    // "❓ Mixed Intel"
  mixedDescription: string;  // "One is evil (Oberon), one is good"
  hiddenWarning?: string;  // "X evil player(s) hidden from you" (if applicable)
}

/**
 * Oberon Split Intel prerequisite check result
 */
export interface OberonSplitIntelPrerequisite {
  canUse: boolean;
  reason?: string;
}

// ============================================
// FEATURE 019: EVIL RING VISIBILITY TYPES
// ============================================

/**
 * Evil Ring assignments (server-side)
 * Maps each evil player to their one known teammate in a circular chain
 */
export type EvilRingAssignments = Record<string, string>;

/**
 * Evil Ring visibility data for evil player's role reveal
 */
export interface EvilRingVisibility {
  enabled: true;
  knownTeammate: { id: string; name: string };  // Name only, no role revealed
  hiddenCount: number;  // Other ring members + Oberon (if present)
  explanation: string;  // "Ring Visibility Mode: You only know one teammate."
}

/**
 * Evil Ring prerequisite check result
 */
export interface EvilRingPrerequisite {
  canEnable: boolean;
  nonOberonEvilCount: number;
  reason?: string;
}
