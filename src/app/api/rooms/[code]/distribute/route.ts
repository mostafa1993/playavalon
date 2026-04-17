/**
 * API Route: POST /api/rooms/[code]/distribute
 * Distribute roles to all players (manager only)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, getRoomPlayerCount, updateRoomStatus, updateLadyOfLakeHolder } from '@/lib/supabase/rooms';
import { insertRoleAssignments, rolesDistributed, setLadyOfLakeForPlayer, getRoleAssignments } from '@/lib/supabase/roles';
import { distributeRoles, getRoleRatio } from '@/lib/domain/roles';
import { computeRolesInPlay, designateLadyOfLakeHolder } from '@/lib/domain/role-config';
import { selectDecoyPlayer } from '@/lib/domain/decoy-selection';
import { canUseSplitIntelMode, distributeSplitIntelGroups } from '@/lib/domain/split-intel';
import { canUseOberonSplitIntelMode, distributeOberonSplitIntelGroups } from '@/lib/domain/oberon-split-intel';
import { canEnableEvilRingVisibility, formEvilRing, getNonOberonEvilIds } from '@/lib/domain/evil-ring-visibility';
import { validateRoomCode } from '@/lib/domain/validation';
import { errors, handleError } from '@/lib/utils/errors';
import type { RoleConfig } from '@/types/role-config';
import type { RoleAssignment } from '@/lib/domain/visibility';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/rooms/[code]/distribute
 * Distribute roles (manager only)
 */
export async function POST(request: Request, { params }: RouteParams) {
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

    // Check if player is manager
    if (room.manager_id !== user.id) {
      return errors.notRoomManager();
    }

    // Check if roles already distributed
    if (room.status !== 'waiting') {
      return errors.rolesAlreadyDistributed();
    }

    const alreadyDistributed = await rolesDistributed(supabase, room.id);
    if (alreadyDistributed) {
      return errors.rolesAlreadyDistributed();
    }

    // Check if room is full
    const playerCount = await getRoomPlayerCount(supabase, room.id);
    if (playerCount !== room.expected_players) {
      return errors.roomNotFull();
    }

    // Get all player IDs in the room (ordered by join time for Lady of Lake)
    const { data: roomPlayers, error: rpError } = await supabase
      .from('room_players')
      .select('player_id')
      .eq('room_id', room.id)
      .order('joined_at', { ascending: true });

    if (rpError) {
      throw rpError;
    }

    const playerIds = (roomPlayers || []).map((rp: { player_id: string }) => rp.player_id);

    // Get role configuration from room
    const roleConfig: RoleConfig = room.role_config || {};

    // Distribute roles using role configuration
    const assignments = distributeRoles(playerIds, roleConfig);

    // Insert role assignments
    await insertRoleAssignments(supabase, room.id, assignments);

    // Handle Lady of the Lake designation
    let ladyOfLakeHolderId: string | null = null;
    if (roleConfig.ladyOfLake || room.lady_of_lake_enabled) {
      // Designate holder (player to the left of manager)
      ladyOfLakeHolderId = designateLadyOfLakeHolder(playerIds, room.manager_id);

      // Update room with holder
      await updateLadyOfLakeHolder(supabase, room.id, ladyOfLakeHolderId);

      // Update player_roles to mark holder
      await setLadyOfLakeForPlayer(supabase, room.id, ladyOfLakeHolderId, true);
    }

    // Feature 009: Handle Merlin Decoy selection during distribution
    if (roleConfig.merlin_decoy_enabled) {
      // Get role assignments for decoy selection
      const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

      // Get player display names for the role assignments
      const { data: playerData } = await supabase
        .from('players')
        .select('id, display_name')
        .in('id', roleAssignmentsData.map(a => a.player_id));

      const displayNameMap = new Map(
        (playerData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
      );

      // Convert to RoleAssignment format for decoy selection
      const visibilityAssignments: RoleAssignment[] = roleAssignmentsData.map(a => ({
        playerId: a.player_id,
        playerName: displayNameMap.get(a.player_id) || 'Unknown',
        role: a.role as 'good' | 'evil',
        specialRole: a.special_role,
      }));

      // Select decoy player
      const decoyResult = selectDecoyPlayer(visibilityAssignments);

      // Store decoy player ID in role_config for the /role API to use
      const updatedRoleConfig = {
        ...roleConfig,
        _merlin_decoy_player_id: decoyResult.playerId,
      };

      await supabase
        .from('rooms')
        .update({ role_config: updatedRoleConfig })
        .eq('id', room.id);
    }

    // Feature 011: Handle Merlin Split Intel selection during distribution
    if (roleConfig.merlin_split_intel_enabled) {
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

      const viability = canUseSplitIntelMode(visibilityAssignments, roleConfig);

      if (!viability.viable) {
        return NextResponse.json(
          {
            error: {
              code: 'SPLIT_INTEL_BLOCKED',
              message: viability.reason || 'Cannot use Split Intel Mode with current role configuration.',
            },
          },
          { status: 400 }
        );
      }

      const splitIntelGroups = distributeSplitIntelGroups(visibilityAssignments, roleConfig);

      if (splitIntelGroups) {
        const updatedRoleConfig = {
          ...room.role_config,
          _split_intel_certain_evil_ids: splitIntelGroups.certainEvilIds,
          _split_intel_mixed_evil_id: splitIntelGroups.mixedEvilId,
          _split_intel_mixed_good_id: splitIntelGroups.mixedGoodId,
        };

        await supabase
          .from('rooms')
          .update({ role_config: updatedRoleConfig })
          .eq('id', room.id);
      }
    }

    // Feature 018: Handle Oberon Split Intel selection during distribution
    if (roleConfig.oberon_split_intel_enabled) {
      const prerequisite = canUseOberonSplitIntelMode(roleConfig);
      if (!prerequisite.canUse) {
        return NextResponse.json(
          {
            error: {
              code: 'OBERON_SPLIT_INTEL_BLOCKED',
              message: prerequisite.reason || 'Cannot use Oberon Split Intel Mode with current role configuration.',
            },
          },
          { status: 400 }
        );
      }

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

      const oberonSplitIntelGroups = distributeOberonSplitIntelGroups(visibilityAssignments, roleConfig);

      const updatedRoleConfig = {
        ...room.role_config,
        _oberon_split_intel_certain_evil_ids: oberonSplitIntelGroups.certainEvilIds,
        _oberon_split_intel_oberon_id: oberonSplitIntelGroups.oberonId,
        _oberon_split_intel_mixed_good_id: oberonSplitIntelGroups.mixedGoodId,
      };

      await supabase
        .from('rooms')
        .update({ role_config: updatedRoleConfig })
        .eq('id', room.id);
    }

    // Feature 019: Handle Evil Ring Visibility during distribution
    if (roleConfig.evil_ring_visibility_enabled) {
      const ringPrereq = canEnableEvilRingVisibility(playerCount, roleConfig.oberon);
      if (!ringPrereq.canEnable) {
        return NextResponse.json(
          {
            error: {
              code: 'EVIL_RING_BLOCKED',
              message: ringPrereq.reason || 'Cannot use Evil Ring Visibility Mode with current configuration.',
            },
          },
          { status: 400 }
        );
      }

      const roleAssignmentsData = await getRoleAssignments(supabase, room.id);

      const evilPlayerIds = roleAssignmentsData
        .filter(a => a.role === 'evil')
        .map(a => a.player_id);

      const oberonAssignment = roleAssignmentsData.find(
        a => a.special_role === 'oberon_standard' || a.special_role === 'oberon_chaos'
      );
      const oberonId = oberonAssignment?.player_id || null;

      const nonOberonEvilIds = getNonOberonEvilIds(evilPlayerIds, oberonId);

      const ringAssignments = formEvilRing(nonOberonEvilIds);

      const currentRoleConfig = (
        await supabase
          .from('rooms')
          .select('role_config')
          .eq('id', room.id)
          .single()
      ).data?.role_config || {};

      const updatedRoleConfig = {
        ...currentRoleConfig,
        _evil_ring_assignments: ringAssignments,
      };

      await supabase
        .from('rooms')
        .update({ role_config: updatedRoleConfig })
        .eq('id', room.id);
    }

    // Update room status
    await updateRoomStatus(supabase, room.id, 'roles_distributed');

    // Get role counts and roles in play
    const ratio = getRoleRatio(playerCount);
    const rolesInPlay = computeRolesInPlay(roleConfig);

    return NextResponse.json({
      data: {
        distributed: true,
        player_count: playerCount,
        good_count: ratio.good,
        evil_count: ratio.evil,
        roles_in_play: rolesInPlay,
        lady_of_lake_holder_id: ladyOfLakeHolderId,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
