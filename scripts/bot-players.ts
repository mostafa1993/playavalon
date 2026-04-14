/**
 * Dev script: Bot players that automatically take actions in the game
 * Usage: npx tsx scripts/bot-players.ts <ROOM_CODE>
 *
 * Bots will:
 * - Confirm their roles
 * - Propose random teams (when leader)
 * - Vote randomly (approve/reject)
 * - Submit quest actions based on role (good=success, evil=fail)
 * - Assassin guesses randomly
 * - Continue past quest results
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envFile = readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

const BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL = 2000; // 2 seconds

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BotPlayer {
  playerId: string; // localStorage UUID
  dbId: string;     // database row ID
  nickname: string;
}

// Track what actions each bot has already taken to avoid duplicates
const confirmedRoles = new Set<string>();
const votedProposals = new Map<string, Set<string>>(); // proposalId -> set of playerIds
const questActionsSubmitted = new Set<string>(); // `${gameId}-${quest}-${playerId}`
const continuedQuests = new Set<string>(); // `${gameId}-${quest}-${playerId}`

async function api(path: string, playerId: string, method = 'GET', body?: unknown) {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Player-ID': playerId,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  if (!res.ok) {
    return { error: data.error?.message || 'Unknown error', status: res.status };
  }
  return { data: data.data || data, status: res.status };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const roomCode = process.argv[2]?.toUpperCase();
  if (!roomCode) {
    console.error('Usage: npx tsx scripts/bot-players.ts <ROOM_CODE>');
    process.exit(1);
  }

  // Find all bot players (everyone except the human who created the room)
  const { data: room } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', roomCode)
    .single();

  if (!room) {
    console.error('Room not found:', roomCode);
    process.exit(1);
  }

  const { data: roomPlayers } = await supabase
    .from('room_players')
    .select('player_id')
    .eq('room_id', room.id);

  if (!roomPlayers || roomPlayers.length < 2) {
    console.error(`Only ${roomPlayers?.length || 0} player(s) in room. Run add-fake-players.ts first:`);
    console.error(`  npx tsx scripts/add-fake-players.ts ${roomCode}`);
    process.exit(1);
  }

  const { data: allPlayers } = await supabase
    .from('players')
    .select('*')
    .in('id', roomPlayers.map(rp => rp.player_id));

  // The manager is the human — everyone else is a bot
  const bots: BotPlayer[] = allPlayers!
    .filter(p => p.id !== room.manager_id)
    .map(p => ({
      playerId: p.player_id,
      dbId: p.id,
      nickname: p.nickname,
    }));

  console.log(`🤖 Starting bots for room ${roomCode}`);
  console.log(`   Bots: ${bots.map(b => b.nickname).join(', ')}`);
  console.log(`   Polling every ${POLL_INTERVAL / 1000}s...\n`);

  // Main loop
  let gameId: string | null = null;

  while (true) {
    try {
      // Check room status
      const { data: currentRoom } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', room.id)
        .single();

      if (!currentRoom) break;

      // Phase: Roles distributed — confirm roles
      if (currentRoom.status === 'roles_distributed') {
        for (const bot of bots) {
          if (!confirmedRoles.has(bot.playerId)) {
            const res = await api(`/api/rooms/${roomCode}/confirm`, bot.playerId, 'POST');
            if (!res.error) {
              console.log(`✅ ${bot.nickname} confirmed role`);
              confirmedRoles.add(bot.playerId);
            }
          }
        }
      }

      // Phase: Game started — find the game ID
      if (currentRoom.status === 'started' && !gameId) {
        const { data: game } = await supabase
          .from('games')
          .select('id')
          .eq('room_id', room.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (game) {
          gameId = game.id;
          console.log(`🎮 Game started: ${gameId}`);
        }
      }

      // Game actions
      if (gameId) {
        // Get game state from any bot's perspective
        const stateRes = await api(`/api/games/${gameId}`, bots[0].playerId);
        if (stateRes.error) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        const state = stateRes.data;
        const phase = state.game?.phase;
        console.log(`   Phase: ${phase}`);

        // Team Building — if a bot is leader, propose a random team
        if (phase === 'team_building') {
          const leader = state.players?.find((p: any) => p.is_leader);
          console.log(`   Leader: ${leader?.nickname} (${leader?.id})`);
          console.log(`   Bot IDs: ${bots.map(b => `${b.nickname}=${b.dbId}`).join(', ')}`);

          const leaderBot = bots.find(b => b.dbId === leader?.id);

          if (leaderBot) {
            const teamSize = state.quest_requirement?.size;
            console.log(`   Team size needed: ${teamSize}`);
            if (teamSize) {
              const playerIds = state.players.map((p: any) => p.id);
              const team = shuffle(playerIds).slice(0, teamSize);
              console.log(`   Proposing team: ${team}`);
              const res = await api(`/api/games/${gameId}/propose`, leaderBot.playerId, 'POST', {
                team_member_ids: team,
              });
              if (res.error) {
                console.log(`   ❌ Propose failed: ${res.error}`);
              } else {
                console.log(`👑 ${leaderBot.nickname} proposed team of ${teamSize}`);
              }
            }
          } else {
            console.log(`   Leader is not a bot (human's turn)`);
          }
        }

        // Voting — bots vote randomly
        if (phase === 'voting' && state.current_proposal) {
          const proposalId = state.current_proposal.id;
          if (!votedProposals.has(proposalId)) {
            votedProposals.set(proposalId, new Set());
          }
          const voted = votedProposals.get(proposalId)!;

          for (const bot of bots) {
            if (!voted.has(bot.playerId)) {
              const vote = Math.random() > 0.4 ? 'approve' : 'reject';
              const res = await api(`/api/games/${gameId}/vote`, bot.playerId, 'POST', { vote });
              if (!res.error) {
                console.log(`🗳️  ${bot.nickname} voted ${vote.toUpperCase()}`);
                voted.add(bot.playerId);
              }
            }
          }
        }

        // Quest — team members submit actions based on role
        if (phase === 'quest' && state.current_proposal) {
          const questKey = `${gameId}-${state.game.current_quest}`;

          for (const bot of bots) {
            const actionKey = `${questKey}-${bot.playerId}`;
            if (questActionsSubmitted.has(actionKey)) continue;

            // Check if this bot is on the team
            const isOnTeam = state.current_proposal.team_member_ids?.includes(bot.dbId);

            if (isOnTeam) {
              // Get bot's role
              const { data: role } = await supabase
                .from('player_roles')
                .select('role')
                .eq('room_id', room.id)
                .eq('player_id', bot.dbId)
                .single();

              const action = role?.role === 'evil' ? 'fail' : 'success';
              const res = await api(`/api/games/${gameId}/quest/action`, bot.playerId, 'POST', { action });
              if (!res.error) {
                console.log(`⚔️  ${bot.nickname} submitted ${action}`);
                questActionsSubmitted.add(actionKey);
              }
            }
          }
        }

        // Quest Result — continue to next phase
        if (phase === 'quest_result') {
          const questKey = `${gameId}-${state.game.current_quest}`;
          for (const bot of bots) {
            const contKey = `${questKey}-continue-${bot.playerId}`;
            if (!continuedQuests.has(contKey)) {
              const res = await api(`/api/games/${gameId}/continue`, bot.playerId, 'POST');
              if (!res.error) {
                console.log(`▶️  ${bot.nickname} continued`);
                continuedQuests.add(contKey);
              }
            }
          }
        }

        // Assassin phase — if a bot is the assassin, guess randomly
        if (phase === 'assassin') {
          console.log(`   Assassin phase — assassin_id: ${state.assassin_phase?.assassin_id}`);
          const assassinBot = bots.find(b => state.assassin_phase?.assassin_id === b.dbId);

          if (assassinBot) {
            const targets = state.players?.filter((p: any) => p.id !== assassinBot.dbId);
            const target = pick(targets);
            if (target) {
              console.log(`   ${assassinBot.nickname} guessing ${target.nickname} (${target.id})`);
              const res = await api(`/api/games/${gameId}/assassin-guess`, assassinBot.playerId, 'POST', {
                player_id: assassinBot.dbId,
                guessed_player_id: target.id,
              });
              if (res.error) {
                console.log(`   ❌ Assassin guess failed: ${res.error}`);
              } else {
                console.log(`🗡️  ${assassinBot.nickname} guessed ${target.nickname} as Merlin`);
              }
            }
          } else {
            console.log(`   Assassin is not a bot (human's turn)`);
          }
        }

        // Merlin Quiz — everyone guesses who Merlin is (after game over)
        if (phase === 'game_over') {
          let allVoted = true;
          for (const bot of bots) {
            const quizKey = `${gameId}-quiz-${bot.playerId}`;
            if (questActionsSubmitted.has(quizKey)) continue;
            allVoted = false;

            // Pick a random other player as the guess
            const others = state.players?.filter((p: any) => p.id !== bot.dbId);
            const guess = pick(others);
            if (guess) {
              const res = await api(`/api/games/${gameId}/merlin-quiz`, bot.playerId, 'POST', {
                suspected_player_id: guess.id,
              });
              if (res.error) {
                // Already voted or quiz not available — skip
                questActionsSubmitted.add(quizKey);
              } else {
                console.log(`🔮 ${bot.nickname} guessed ${guess.nickname} as Merlin`);
                questActionsSubmitted.add(quizKey);
              }
            }
          }

          if (allVoted) {
            console.log(`\n🏁 Game over! Winner: ${state.game.winner}`);
            process.exit(0);
          }
        }
      }
    } catch (err: any) {
      // Silently continue on errors
    }

    await sleep(POLL_INTERVAL);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
