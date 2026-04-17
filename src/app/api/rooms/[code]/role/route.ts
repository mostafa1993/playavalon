/**
 * API Route: GET /api/rooms/[code]/role
 * Get current player's role with special character information
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, isPlayerInRoom } from '@/lib/supabase/rooms';
import {
  getPlayerRole,
  getEvilTeammates,
  getPlayersVisibleToMerlin,
  getPlayersVisibleToPercival,
  getRoleAssignments
} from '@/lib/supabase/roles';
import { getGameByRoomId } from '@/lib/supabase/games';
import { getRoleInfo } from '@/lib/domain/roles';
import { countHiddenEvilFromMerlin, generateDecoyWarning, getSplitIntelVisibility, getOberonSplitIntelVisibility, getEvilRingVisibility, type RoleAssignment } from '@/lib/domain/visibility';
import { shuffleArray } from '@/lib/domain/decoy-selection';
import { validateRoomCode } from '@/lib/domain/validation';
import { errors, handleError } from '@/lib/utils/errors';
import type { RoleConfig } from '@/types/role-config';
import type { SplitIntelGroups, SplitIntelVisibility, OberonSplitIntelGroups, OberonSplitIntelVisibility, EvilRingAssignments, EvilRingVisibility } from '@/types/game';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/rooms/[code]/role
 * Get current player's role with character-specific visibility
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Validate room code format
    const codeValidation = validateRoomCode(code);
    if (!codeValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_CODE', message: codeValidation.error } },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Find the room
    const room = await findRoomByCode(supabase, code);
    if (!room) {
      return errors.roomNotFound();
    }

    // Check if player is in this room
    const isMember = await isPlayerInRoom(supabase, room.id, user.id);
    if (!isMember) {
      return errors.notRoomMember();
    }

    // Check if roles have been distributed
    if (room.status === 'waiting') {
      return errors.rolesNotDistributed();
    }

    // Get player's role
    const playerRole = await getPlayerRole(supabase, room.id, user.id);
    if (!playerRole) {
      return errors.rolesNotDistributed();
    }

    // Get role config for visibility calculations
    const roleConfig: RoleConfig = room.role_config || {};

    // Get role info with special character details
    const roleInfo = getRoleInfo(playerRole.role, playerRole.special_role);

    // Get visibility information based on special role
    let knownPlayers: string[] | undefined;
    let knownPlayersLabel: string | undefined;
    let hiddenEvilCount: number | undefined;
    let abilityNote: string | undefined;
    let hasDecoy: boolean | undefined;
    let decoyWarning: string | undefined;
    let splitIntel: SplitIntelVisibility | undefined;
    let oberonSplitIntel: OberonSplitIntelVisibility | undefined;
    let evilRingVisibility: EvilRingVisibility | undefined;

    switch (playerRole.special_role) {
      case 'merlin': {
        hiddenEvilCount = countHiddenEvilFromMerlin(roleConfig);

        // Feature 018: Handle Oberon Split Intel Mode (takes precedence)
        if (roleConfig.oberon_split_intel_enabled) {
          let oberonSplitIntelGroups: OberonSplitIntelGroups | null = null;

          const rcData = roleConfig as Record<string, unknown>;
          if (rcData._oberon_split_intel_oberon_id && rcData._oberon_split_intel_mixed_good_id) {
            oberonSplitIntelGroups = {
              certainEvilIds: (rcData._oberon_split_intel_certain_evil_ids as string[]) || [],
              oberonId: rcData._oberon_split_intel_oberon_id as string,
              mixedGoodId: rcData._oberon_split_intel_mixed_good_id as string,
            };
          } else {
            const game = await getGameByRoomId(supabase, room.id);
            if (game?.oberon_split_intel_mixed_good_id) {
              const roleAssignmentsData = await getRoleAssignments(supabase, room.id);
              const oberon = roleAssignmentsData.find(a => a.special_role === 'oberon_standard');
              if (oberon) {
                oberonSplitIntelGroups = {
                  certainEvilIds: game.oberon_split_intel_certain_evil_ids || [],
                  oberonId: oberon.player_id,
                  mixedGoodId: game.oberon_split_intel_mixed_good_id,
                };
              }
            }
          }

          if (oberonSplitIntelGroups) {
            const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

            const { data: playerData } = await supabase
              .from('players')
              .select('id, display_name')
              .in('id', roleAssignmentsData.map(a => a.player_id));

            const displayNameMap = new Map(
              (playerData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
            );

            const visibilityAssignments: RoleAssignment[] = roleAssignmentsData.map(a => ({
              playerId: a.player_id,
              playerName: displayNameMap.get(a.player_id) || 'Unknown',
              role: a.role as 'good' | 'evil',
              specialRole: a.special_role,
            }));

            oberonSplitIntel = getOberonSplitIntelVisibility(visibilityAssignments, roleConfig, oberonSplitIntelGroups);

            knownPlayers = [];
            knownPlayersLabel = '';
            abilityNote = 'You see evil players divided: coordinated evil are certain, but Oberon is mixed with a good player.';

            hiddenEvilCount = roleConfig.mordred ? 1 : 0;
          }
        }
        // Feature 011: Handle Merlin Split Intel Mode
        else if (roleConfig.merlin_split_intel_enabled) {
          let splitIntelGroups: SplitIntelGroups | null = null;

          const rcData = roleConfig as Record<string, unknown>;
          if (rcData._split_intel_certain_evil_ids && rcData._split_intel_mixed_evil_id && rcData._split_intel_mixed_good_id) {
            splitIntelGroups = {
              certainEvilIds: rcData._split_intel_certain_evil_ids as string[],
              mixedEvilId: rcData._split_intel_mixed_evil_id as string,
              mixedGoodId: rcData._split_intel_mixed_good_id as string,
            };
          } else {
            const game = await getGameByRoomId(supabase, room.id);
            if (game?.split_intel_certain_evil_ids && game?.split_intel_mixed_evil_id && game?.split_intel_mixed_good_id) {
              splitIntelGroups = {
                certainEvilIds: game.split_intel_certain_evil_ids,
                mixedEvilId: game.split_intel_mixed_evil_id,
                mixedGoodId: game.split_intel_mixed_good_id,
              };
            }
          }

          if (splitIntelGroups) {
            const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

            const { data: playerData } = await supabase
              .from('players')
              .select('id, display_name')
              .in('id', roleAssignmentsData.map(a => a.player_id));

            const displayNameMap = new Map(
              (playerData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
            );

            const visibilityAssignments: RoleAssignment[] = roleAssignmentsData.map(a => ({
              playerId: a.player_id,
              playerName: displayNameMap.get(a.player_id) || 'Unknown',
              role: a.role as 'good' | 'evil',
              specialRole: a.special_role,
            }));

            splitIntel = getSplitIntelVisibility(visibilityAssignments, roleConfig, splitIntelGroups);

            knownPlayers = [];
            knownPlayersLabel = '';
            abilityNote = 'You see players divided into two groups with different certainty levels.';
          }
        }
        // Feature 009: Handle Merlin Decoy Mode
        else if (roleConfig.merlin_decoy_enabled) {
          knownPlayers = await getPlayersVisibleToMerlin(supabase, room.id);

          let decoyPlayerId: string | null = null;

          if ((roleConfig as Record<string, unknown>)._merlin_decoy_player_id) {
            decoyPlayerId = (roleConfig as Record<string, unknown>)._merlin_decoy_player_id as string;
          } else {
            const game = await getGameByRoomId(supabase, room.id);
            if (game?.merlin_decoy_player_id) {
              decoyPlayerId = game.merlin_decoy_player_id;
            }
          }

          if (decoyPlayerId) {
            const { data: decoyPlayer } = await supabase
              .from('players')
              .select('display_name')
              .eq('id', decoyPlayerId)
              .single();

            if (decoyPlayer) {
              knownPlayers = [...knownPlayers, decoyPlayer.display_name];
              knownPlayers = shuffleArray(knownPlayers);
              hasDecoy = true;
              decoyWarning = generateDecoyWarning(hiddenEvilCount || 0);
            }
          }

          if (hasDecoy) {
            knownPlayersLabel = 'Suspected Evil Players';
          } else {
            knownPlayersLabel = 'The Evil Among You';
          }

          if (!hasDecoy && hiddenEvilCount && hiddenEvilCount > 0) {
            abilityNote = `${hiddenEvilCount} evil ${hiddenEvilCount === 1 ? 'player is' : 'players are'} hidden from you!`;
          }
        }
        // Standard Merlin visibility
        else {
          knownPlayers = await getPlayersVisibleToMerlin(supabase, room.id);
          knownPlayersLabel = 'The Evil Among You';
          if (hiddenEvilCount && hiddenEvilCount > 0) {
            abilityNote = `${hiddenEvilCount} evil ${hiddenEvilCount === 1 ? 'player is' : 'players are'} hidden from you!`;
          }
        }
        break;
      }

      case 'percival':
        knownPlayers = await getPlayersVisibleToPercival(supabase, room.id);
        if (knownPlayers.length === 1) {
          knownPlayersLabel = 'This is Merlin';
          abilityNote = 'Protect Merlin at all costs!';
        } else {
          knownPlayersLabel = 'One of These is Merlin';
          abilityNote = 'Protect Merlin, but beware — Morgana appears the same to you!';
        }
        break;

      case 'morgana': {
        if (roleConfig.evil_ring_visibility_enabled) {
          let ringAssignments: EvilRingAssignments | null = null;

          const rcData = roleConfig as Record<string, unknown>;
          if (rcData._evil_ring_assignments) {
            ringAssignments = rcData._evil_ring_assignments as EvilRingAssignments;
          } else {
            const game = await getGameByRoomId(supabase, room.id);
            if (game?.evil_ring_assignments) {
              ringAssignments = game.evil_ring_assignments;
            }
          }

          if (ringAssignments && ringAssignments[user.id]) {
            const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

            const { data: playerData } = await supabase
              .from('players')
              .select('id, display_name')
              .in('id', roleAssignmentsData.map(a => a.player_id));

            const displayNameMap = new Map(
              (playerData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
            );

            const visibilityAssignments: RoleAssignment[] = roleAssignmentsData.map(a => ({
              playerId: a.player_id,
              playerName: displayNameMap.get(a.player_id) || 'Unknown',
              role: a.role as 'good' | 'evil',
              specialRole: a.special_role,
            }));

            evilRingVisibility = getEvilRingVisibility(
              user.id,
              visibilityAssignments,
              ringAssignments,
              roleConfig
            ) ?? undefined;

            if (evilRingVisibility) {
              knownPlayers = [evilRingVisibility.knownTeammate.name];
              knownPlayersLabel = 'Your Known Teammate';
              abilityNote = roleConfig.percival
                ? 'Ring Visibility: You only know one teammate. You appear as Merlin to Percival!'
                : 'Ring Visibility: You only know one teammate. Percival is not in this game.';
              break;
            }
          }
        }

        knownPlayers = await getEvilTeammates(supabase, room.id, user.id);
        knownPlayersLabel = 'Your Evil Teammates';
        if (roleConfig.percival) {
          abilityNote = 'You appear as Merlin to Percival. Use this to confuse and deceive!';
        } else {
          abilityNote = 'Percival is not in this game, so your disguise ability has no effect.';
        }
        break;
      }

      case 'mordred': {
        if (roleConfig.evil_ring_visibility_enabled) {
          let ringAssignments: EvilRingAssignments | null = null;

          const rcData = roleConfig as Record<string, unknown>;
          if (rcData._evil_ring_assignments) {
            ringAssignments = rcData._evil_ring_assignments as EvilRingAssignments;
          } else {
            const game = await getGameByRoomId(supabase, room.id);
            if (game?.evil_ring_assignments) {
              ringAssignments = game.evil_ring_assignments;
            }
          }

          if (ringAssignments && ringAssignments[user.id]) {
            const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

            const { data: playerData } = await supabase
              .from('players')
              .select('id, display_name')
              .in('id', roleAssignmentsData.map(a => a.player_id));

            const displayNameMap = new Map(
              (playerData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
            );

            const visibilityAssignments: RoleAssignment[] = roleAssignmentsData.map(a => ({
              playerId: a.player_id,
              playerName: displayNameMap.get(a.player_id) || 'Unknown',
              role: a.role as 'good' | 'evil',
              specialRole: a.special_role,
            }));

            evilRingVisibility = getEvilRingVisibility(
              user.id,
              visibilityAssignments,
              ringAssignments,
              roleConfig
            ) ?? undefined;

            if (evilRingVisibility) {
              knownPlayers = [evilRingVisibility.knownTeammate.name];
              knownPlayersLabel = 'Your Known Teammate';
              abilityNote = 'Ring Visibility: You only know one teammate. Merlin does not know you are evil!';
              break;
            }
          }
        }

        knownPlayers = await getEvilTeammates(supabase, room.id, user.id);
        knownPlayersLabel = 'Your Evil Teammates';
        abilityNote = 'Merlin does not know you are evil. Lead from the shadows!';
        break;
      }

      case 'oberon_standard':
        knownPlayers = [];
        knownPlayersLabel = undefined;
        abilityNote = "You work alone. Your teammates don't know you, and you don't know them. Merlin can see you.";
        break;

      case 'oberon_chaos':
        knownPlayers = [];
        knownPlayersLabel = undefined;
        abilityNote = 'Complete isolation! No one knows you are evil — not even Merlin!';
        break;

      case 'assassin':
      case 'minion': {
        if (roleConfig.evil_ring_visibility_enabled) {
          let ringAssignments: EvilRingAssignments | null = null;

          const rcData = roleConfig as Record<string, unknown>;
          if (rcData._evil_ring_assignments) {
            ringAssignments = rcData._evil_ring_assignments as EvilRingAssignments;
          } else {
            const game = await getGameByRoomId(supabase, room.id);
            if (game?.evil_ring_assignments) {
              ringAssignments = game.evil_ring_assignments;
            }
          }

          if (ringAssignments && ringAssignments[user.id]) {
            const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

            const { data: playerData } = await supabase
              .from('players')
              .select('id, display_name')
              .in('id', roleAssignmentsData.map(a => a.player_id));

            const displayNameMap = new Map(
              (playerData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
            );

            const visibilityAssignments: RoleAssignment[] = roleAssignmentsData.map(a => ({
              playerId: a.player_id,
              playerName: displayNameMap.get(a.player_id) || 'Unknown',
              role: a.role as 'good' | 'evil',
              specialRole: a.special_role,
            }));

            evilRingVisibility = getEvilRingVisibility(
              user.id,
              visibilityAssignments,
              ringAssignments,
              roleConfig
            ) ?? undefined;

            if (evilRingVisibility) {
              knownPlayers = [evilRingVisibility.knownTeammate.name];
              knownPlayersLabel = 'Your Known Teammate';
              abilityNote = playerRole.special_role === 'assassin'
                ? 'Ring Visibility: You only know one teammate. If the good team wins 3 quests, you have one chance to identify Merlin!'
                : 'Ring Visibility: You only know one teammate. Work in the shadows!';
              break;
            }
          }
        }

        knownPlayers = await getEvilTeammates(supabase, room.id, user.id);
        knownPlayersLabel = 'Your Evil Teammates';
        abilityNote = playerRole.special_role === 'assassin'
          ? 'If the good team wins 3 quests, you have one chance to identify Merlin!'
          : 'Work with your fellow minions to sabotage the quests!';
        break;
      }

      case 'servant':
      default:
        knownPlayers = undefined;
        knownPlayersLabel = undefined;
        abilityNote = 'Stay vigilant! Work with your fellow knights to identify the traitors.';
        break;
    }

    return NextResponse.json({
      data: {
        role: playerRole.role,
        special_role: playerRole.special_role,
        role_name: roleInfo.role_name,
        role_description: roleInfo.role_description,
        is_confirmed: playerRole.is_confirmed,
        has_lady_of_lake: playerRole.has_lady_of_lake || false,
        known_players: knownPlayers,
        known_players_label: knownPlayersLabel,
        hidden_evil_count: hiddenEvilCount,
        ability_note: abilityNote,
        has_decoy: hasDecoy,
        decoy_warning: decoyWarning,
        split_intel: splitIntel,
        oberon_split_intel: oberonSplitIntel,
        evil_ring_visibility: evilRingVisibility,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
