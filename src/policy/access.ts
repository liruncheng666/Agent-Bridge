import type { ProfileConfig } from '../config/profile-schema';
export { accessPolicyDigest } from './fingerprint';

export type OwnerRefreshState = 'ok' | 'failed' | 'unknown';

/** Role resolved for a specific user in a specific group chat (REQ-03). */
export type GroupRole = 'owner' | 'collaborator' | 'participant' | 'denied';

export interface RuntimeControls {
  botOwnerId?: string;
  ownerRefreshState: OwnerRefreshState;
  ownerRefreshedAt?: number;
  ownerRefreshError?: string;
}

export interface AccessDecision {
  ok: boolean;
  reason:
    | 'owner'
    | 'allowed-user'
    | 'allowed-admin'
    | 'allowed-chat'
    | 'comment-mention'
    | 'denied-user'
    | 'denied-chat'
    | 'denied-admin';
}

export function isCreator(controls: RuntimeControls, senderId: string): boolean {
  if (controls.ownerRefreshState === 'unknown') return false;
  return Boolean(controls.botOwnerId) && controls.botOwnerId === senderId;
}

/**
 * Resolve the RBAC role for a user in a specific group chat (REQ-03).
 *
 * Precedence:
 *  1. owner (application creator, resolved at runtime) — global, overrides all
 *  2. collaborator — listed in groupRoles[chatId].collaborators
 *  3. participant — listed in groupRoles[chatId].participants
 *  4. group policy fallback — 'open-participant' grants participant, 'strict' denies
 */
export function resolveRole(
  senderId: string,
  chatId: string,
  controls: RuntimeControls,
  profile: ProfileConfig,
): GroupRole {
  if (isCreator(controls, senderId)) return 'owner';

  const groupConfig = profile.access.groupRoles[chatId];
  if (groupConfig) {
    if (groupConfig.collaborators.includes(senderId)) return 'collaborator';
    if (groupConfig.participants.includes(senderId)) return 'participant';
    if (groupConfig.policy === 'open-participant') return 'participant';
    return 'denied';
  }

  // No group config: fall back to legacy allowedChats + allowedUsers for
  // backward-compatibility, then deny.
  if (profile.access.admins.includes(senderId)) return 'collaborator';
  if (profile.access.allowedChats.includes(chatId)) return 'participant';
  return 'denied';
}

/**
 * Map a resolved GroupRole to an AccessMode used by the permission layer.
 * owner and collaborator both get 'full' so bypassPermissions fires — this is
 * intentional: acceptEdits hangs in headless mode (verified). Security boundary
 * is enforced by REQ-04 OS sandbox, not by Claude's permission mode.
 */
export function roleToAccessMode(role: GroupRole): 'full' | 'read-only' {
  switch (role) {
    case 'owner':
    case 'collaborator':
      return 'full';
    case 'participant':
    case 'denied':
      return 'read-only';
  }
}

export function canUseDm(
  profile: ProfileConfig,
  controls: RuntimeControls,
  senderId: string,
): AccessDecision {
  if (isCreator(controls, senderId)) return allow('owner');
  if (profile.access.allowedUsers.includes(senderId)) return allow('allowed-user');
  if (profile.access.admins.includes(senderId)) return allow('allowed-admin');
  return deny('denied-user');
}

export function canUseGroup(
  profile: ProfileConfig,
  controls: RuntimeControls,
  chatId: string,
  senderId: string,
): AccessDecision {
  if (isCreator(controls, senderId)) return allow('owner');
  if (profile.access.admins.includes(senderId)) return allow('allowed-admin');
  if (profile.access.allowedChats.includes(chatId)) return allow('allowed-chat');

  // REQ-03: groupRoles-based access
  const role = resolveRole(senderId, chatId, controls, profile);
  if (role !== 'denied') return allow('allowed-chat');

  return deny('denied-chat');
}

export function canRunAdminCommand(
  profile: ProfileConfig,
  controls: RuntimeControls,
  senderId: string,
): AccessDecision {
  if (isCreator(controls, senderId)) return allow('owner');
  if (profile.access.admins.includes(senderId)) return allow('allowed-admin');
  return deny('denied-admin');
}

function allow(reason: AccessDecision['reason']): AccessDecision {
  return { ok: true, reason };
}

function deny(reason: AccessDecision['reason']): AccessDecision {
  return { ok: false, reason };
}
