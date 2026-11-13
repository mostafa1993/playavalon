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
import { isValidRoleConfig } from '@/types/role-config';
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
    if (!isValidRoleConfig(room.role_config)) {
      return errors.internalError('Room has an invalid role setup');
    }
    const roleConfig = room.role_config;
    // The setup plus the keys distribution adds to it (_merlin_decoy_player_id, _split_intel_*, ...)
    const rcData: Record<string, unknown> = { ...roleConfig };

    // Get role info with special character details
    const roleInfo = getRoleInfo(playerRole.role, roleConfig.merlin, playerRole.special_role);

    // Get visibility information based on special role
    let knownPlayers: string[] | undefined;
    let knownPlayersLabel: string | undefined;
    let hiddenEvilCount: number | undefined;
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

            hiddenEvilCount = roleConfig.mordred ? 1 : 0;
          }
        }
        // Feature 011: Handle Merlin Split Intel Mode
        else if (roleConfig.merlin_split_intel_enabled) {
          let splitIntelGroups: SplitIntelGroups | null = null;

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
          }
        }
        // Feature 009: Handle Merlin Decoy Mode
        else if (roleConfig.merlin_decoy_enabled) {
          knownPlayers = await getPlayersVisibleToMerlin(supabase, room.id);

          let decoyPlayerId: string | null = null;

          if (rcData._merlin_decoy_player_id) {
            decoyPlayerId = rcData._merlin_decoy_player_id as string;
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
        }
        // Standard Merlin visibility
        else {
          knownPlayers = await getPlayersVisibleToMerlin(supabase, room.id);
          knownPlayersLabel = 'The Evil Among You';
        }
        break;
      }

      case 'percival':
        knownPlayers = await getPlayersVisibleToPercival(supabase, room.id);
        knownPlayersLabel = knownPlayers.length === 1 ? 'This is Merlin' : 'One of These is Merlin';
        break;

      case 'morgana': {
        if (roleConfig.evil_ring_visibility_enabled) {
          let ringAssignments: EvilRingAssignments | null = null;

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
              break;
            }
          }
        }

        knownPlayers = await getEvilTeammates(supabase, room.id, user.id);
        knownPlayersLabel = 'Your Evil Teammates';
        break;
      }

      case 'mordred': {
        if (roleConfig.evil_ring_visibility_enabled) {
          let ringAssignments: EvilRingAssignments | null = null;

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
              break;
            }
          }
        }

        knownPlayers = await getEvilTeammates(supabase, room.id, user.id);
        knownPlayersLabel = 'Your Evil Teammates';
        break;
      }

      case 'oberon_standard':
      case 'oberon_chaos':
        knownPlayers = [];
        knownPlayersLabel = undefined;
        break;

      case 'assassin':
      case 'minion': {
        if (roleConfig.evil_ring_visibility_enabled) {
          let ringAssignments: EvilRingAssignments | null = null;

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
              break;
            }
          }
        }

        knownPlayers = await getEvilTeammates(supabase, room.id, user.id);
        knownPlayersLabel = 'Your Evil Teammates';
        break;
      }

      case 'servant':
      default:
        knownPlayers = undefined;
        knownPlayersLabel = undefined;
        break;
    }

    return NextResponse.json({
      data: {
        role: playerRole.role,
        special_role: playerRole.special_role,
        role_name: roleInfo.role_name,
        role_description: roleInfo.role_description,
        merlin_in_play: roleConfig.merlin,
        is_confirmed: playerRole.is_confirmed,
        has_lady_of_lake: playerRole.has_lady_of_lake || false,
        known_players: knownPlayers,
        known_players_label: knownPlayersLabel,
        hidden_evil_count: hiddenEvilCount,
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
