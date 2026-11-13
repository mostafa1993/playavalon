/**
 * Win Conditions
 * Detect game end states
 */

import type { QuestResult, GameWinner, WinReason, GameScore } from '@/types/game';

/**
 * Win condition check result
 */
export interface WinConditionResult {
  gameOver: boolean;
  assassinPhase: boolean; // True if Good won 3 quests and Assassin gets a chance
  winner: GameWinner | null;
  reason: WinReason | null;
}

/**
 * Count quest results by outcome
 */
export function countQuestResults(
  questResults: QuestResult[]
): GameScore {
  return {
    good: questResults.filter((r) => r.result === 'success').length,
    evil: questResults.filter((r) => r.result === 'fail').length,
  };
}

/**
 * Check win conditions based on quest results
 * 
 * @param questResults Array of completed quest results
 * @param voteTrack Current consecutive rejection count
 * @param hasMerlin Whether the game has a Merlin role (enables assassin phase)
 */
export function checkWinConditions(
  questResults: QuestResult[],
  voteTrack: number,
  hasMerlin: boolean
): WinConditionResult {
  // Check 5 rejections first (immediate Evil win)
  if (voteTrack >= 5) {
    return {
      gameOver: true,
      assassinPhase: false,
      winner: 'evil',
      reason: '5_rejections',
    };
  }
  
  const score = countQuestResults(questResults);
  
  // Good wins with 3 successful quests
  // If Merlin exists, trigger assassin phase instead of immediate win
  if (score.good >= 3) {
    if (hasMerlin) {
      // Assassin gets a chance to find Merlin
      return {
        gameOver: false,
        assassinPhase: true,
        winner: null,
        reason: null,
      };
    }
    // No Merlin = immediate Good win
    return {
      gameOver: true,
      assassinPhase: false,
      winner: 'good',
      reason: '3_quest_successes',
    };
  }
  
  // Evil wins with 3 failed quests
  if (score.evil >= 3) {
    return {
      gameOver: true,
      assassinPhase: false,
      winner: 'evil',
      reason: '3_quest_failures',
    };
  }
  
  // Game continues
  return {
    gameOver: false,
    assassinPhase: false,
    winner: null,
    reason: null,
  };
}

/**
 * Check if 5 rejections has been reached
 */
export function checkFiveRejections(voteTrack: number): boolean {
  return voteTrack >= 5;
}

/**
 * Check if Good has won 3 quests
 */
export function checkGoodWins(questResults: QuestResult[]): boolean {
  const score = countQuestResults(questResults);
  return score.good >= 3;
}

/**
 * Check if Evil has won 3 quests
 */
export function checkEvilWins(questResults: QuestResult[]): boolean {
  const score = countQuestResults(questResults);
  return score.evil >= 3;
}

/**
 * Get win reason display text
 *
 * @param hasMerlin Whether a Merlin was dealt (only then was there an Assassin to fail)
 */
export function getWinReasonText(reason: WinReason, hasMerlin: boolean): string {
  switch (reason) {
    case '3_quest_successes':
      return hasMerlin
        ? 'Good completed 3 successful quests! The Assassin failed to find Merlin.'
        : 'Good completed 3 successful quests!';
    case '3_quest_failures':
      return 'Evil sabotaged 3 quests!';
    case '5_rejections':
      return '5 consecutive team rejections - chaos reigns!';
    case 'assassin_found_merlin':
      return 'The Assassin found Merlin! Evil snatches victory from defeat!';
    default:
      return 'Game over';
  }
}

/**
 * Get winner announcement text
 */
export function getWinnerAnnouncement(
  winner: GameWinner,
  reason: WinReason
): string {
  if (winner === 'good') {
    return '🎉 The Loyal Servants of Arthur have triumphed!';
  }
  
  if (reason === '5_rejections') {
    return '😈 Evil wins through chaos and indecision!';
  }
  
  if (reason === 'assassin_found_merlin') {
    return '🗡️ The Assassin found Merlin! Evil wins!';
  }
  
  return '😈 The Minions of Mordred have corrupted Camelot!';
}

/**
 * Determine final winner after Assassin's guess
 */
export function checkAssassinGuess(
  guessedPlayerId: string,
  merlinPlayerId: string
): WinConditionResult {
  const assassinFoundMerlin = guessedPlayerId === merlinPlayerId;
  
  return {
    gameOver: true,
    assassinPhase: false,
    winner: assassinFoundMerlin ? 'evil' : 'good',
    reason: assassinFoundMerlin ? 'assassin_found_merlin' : '3_quest_successes',
  };
}

/**
 * Get remaining quests needed to win
 */
export function getQuestsToWin(questResults: QuestResult[]): {
  goodNeeds: number;
  evilNeeds: number;
} {
  const score = countQuestResults(questResults);
  return {
    goodNeeds: Math.max(0, 3 - score.good),
    evilNeeds: Math.max(0, 3 - score.evil),
  };
}

