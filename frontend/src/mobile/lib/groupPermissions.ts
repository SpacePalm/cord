// Port of cord-ios CordCore GroupPermissions — mirrors backend groups.py permission tiers:
//  • view channels/members — any member;
//  • channels (create/update/delete) and invites — editor+ (owner | editor | global admin);
//  • rename/avatar/delete server, kick, change roles — owner/admin only (editor excluded);
//  • global admin (user.role === 'admin') ⩾ owner in every group.
// Personal group ("Saved") and DMs are not servers: no rename/delete/invites; no channels in DMs.
import type { Group, User } from '../../types';

export interface GroupPermissions {
  /** Acts as owner (group owner or global admin). */
  isOwner: boolean;
  /** May create / edit / delete channels. */
  canManageChannels: boolean;
  /** May rename, change avatar, delete the server, kick members, change roles. */
  canManageGroup: boolean;
  /** May create invite links. */
  canInvite: boolean;
}

/**
 * @param myRole — my member role from /groups/{id}/members (`owner|editor|member`), or null/undefined.
 */
export function groupPermissions(
  group: Pick<Group, 'owner_id' | 'is_dm' | 'is_personal'>,
  me: Pick<User, 'id' | 'role'> | null | undefined,
  myRole: string | null | undefined,
): GroupPermissions {
  const isAdmin = me?.role === 'admin';
  const owner = isAdmin || (!!me && group.owner_id === me.id);
  const editorPlus = owner || myRole === 'editor';
  const serverLike = !group.is_dm && !group.is_personal;
  return {
    isOwner: owner,
    canManageChannels: editorPlus && !group.is_dm,
    canManageGroup: owner && serverLike,
    canInvite: editorPlus && serverLike,
  };
}
