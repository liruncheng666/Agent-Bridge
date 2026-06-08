import type { AgentCapability } from '../agent/capability';
import {
  accessToClaudePermissionMode,
  accessToCodexSandbox,
  clampAccess,
  type AccessMode,
  type ClaudePermissionMode,
  type CodexSandboxMode,
} from '../config/permissions';
import type { ProfileConfig } from '../config/profile-schema';
import type { AccessDecision, GroupRole } from './access';
import {
  accessPolicyDigest,
  attachmentPolicyConfigDigest,
  policyFingerprint,
  resourceScopeDigest,
} from './fingerprint';

export interface ScopeContext {
  source: 'im' | 'card' | 'comment';
  chatId?: string;
  threadId?: string;
  actorId: string;
  commentScopeId?: string;
  resourceBindings?: ResourceBinding[];
}

export interface ResourceBinding {
  kind: 'doc' | 'folder';
  id: string;
  verified: boolean;
}

export interface AgentAttachment {
  kind: string;
  requiredness: 'required' | 'optional';
  decision: 'accepted' | 'rejected' | 'skipped';
  rejectionReason?: string;
  originalName?: string;
  size?: number;
  hash?: string;
  path?: string;
}

export interface RunPolicyInput {
  scope: ScopeContext;
  attachments: AgentAttachment[];
  prompt: string;
  requestedCwd: string;
  cwdRealpath: string;
  access: AccessDecision;
  capability: AgentCapability;
  profileConfig: ProfileConfig;
  now: number;
  codexHome?: string;
  inheritCodexHome?: boolean;
  ttlMs?: number;
  /**
   * IM chat type for scenario-based permission tiering (SR-1). Defaults to
   * 'p2p' when omitted (no scenario ceiling), preserving behavior for the
   * comment / catalog-identity call sites that don't set it.
   */
  chatType?: 'p2p' | 'group';
  /**
   * Resolved RBAC role for the message sender in this chat (REQ-03).
   * Replaces the old `isOwner` boolean. Defaults to 'owner' when omitted
   * so that call sites that don't set it (comments, card actions) retain
   * the same full-access behavior as before.
   */
  role?: GroupRole;
  /**
   * @deprecated Use `role` instead. Kept for backward-compatibility with
   * call sites not yet migrated to resolveRole(). When both are set, `role`
   * takes precedence.
   */
  isOwner?: boolean;
  /**
   * Per-scope access override set via `/permission` (SR-5). When provided it
   * replaces the profile default access as the *requested* level, but is
   * still clamped by both the profile/capability max AND the SR-1 scenario
   * ceiling — so it can never raise access above what the scenario allows.
   */
  accessOverride?: AccessMode;
}

export interface RunPolicyAllow {
  ok: true;
  prompt: string;
  requestedCwd: string;
  cwdRealpath: string;
  accessMode: AccessMode;
  sandbox: CodexSandboxMode;
  permissionMode: ClaudePermissionMode;
  access: AccessDecision;
  attachments: AgentAttachment[];
  policyFingerprint: string;
  expiresAt: number;
}

export interface RunPolicyReject {
  ok: false;
  rejectReason: {
    code:
      | 'access-denied'
      | 'folder-allowlist-unverified'
      | 'required-attachment-rejected';
    userVisible: string;
  };
}

export type RunPolicyResult = RunPolicyAllow | RunPolicyReject;

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function evaluateRunPolicy(input: RunPolicyInput): RunPolicyResult {
  if (!input.access.ok) {
    return reject('access-denied', '当前用户无权发起运行。');
  }

  if (input.scope.resourceBindings?.some((binding) => binding.kind === 'folder' && !binding.verified)) {
    return reject('folder-allowlist-unverified', '暂不支持 folder allowlist，已拒绝运行。');
  }

  if (
    input.attachments.some(
      (attachment) =>
        attachment.requiredness === 'required' && attachment.decision !== 'accepted',
    )
  ) {
    return reject('required-attachment-rejected', '必需附件未通过校验，已拒绝运行。');
  }

  // The requested access starts from the profile default, or a per-scope
  // `/permission` override (SR-5) when set. clampAccess then bounds it by the
  // profile max and the agent capability max.
  const requestedAccess = input.accessOverride ?? input.profileConfig.permissions.defaultAccess;
  const baseAccess = clampAccess(
    requestedAccess,
    input.profileConfig.permissions.maxAccess,
    input.capability.permissions.maxAccess,
  );

  // REQ-03: Role-based scenario ceiling.
  // `role` (from resolveRole) drives the ceiling directly.
  // Falls back to the old isOwner-based scenarioMaxAccess for call sites
  // (comments, card actions) that haven't migrated to resolveRole yet.
  let accessMode: AccessMode;
  if (input.role !== undefined) {
    const roleCeiling = roleToScenarioCeiling(input.role, input.chatType ?? 'p2p');
    accessMode = ACCESS_ORDER[baseAccess] <= ACCESS_ORDER[roleCeiling] ? baseAccess : roleCeiling;
  } else {
    // Legacy path: SR-1 scenarioMaxAccess
    const isOwner = input.isOwner ?? false;
    const ceiling: AccessMode = input.chatType === 'group'
      ? (isOwner ? 'workspace' : 'read-only')
      : 'full';
    accessMode = ACCESS_ORDER[baseAccess] <= ACCESS_ORDER[ceiling] ? baseAccess : ceiling;
  }
  const sandbox = accessToCodexSandbox(accessMode);
  const permissionMode = accessToClaudePermissionMode(
    accessMode,
    input.profileConfig.permissions,
  );
  const resourceDigest = resourceScopeDigest({
    source: input.scope.source,
    chatId: input.scope.chatId,
    threadId: input.scope.threadId,
    commentScopeId: input.scope.commentScopeId,
    resourceBindings: input.scope.resourceBindings?.map((binding) => binding.id),
  });
  const attachmentDigest = attachmentPolicyConfigDigest(input.profileConfig.attachments);
  const accessDigest =
    input.scope.source === 'comment' && input.access.reason === 'comment-mention'
      ? 'comment-mention'
      : accessPolicyDigest(input.profileConfig.access);

  return {
    ok: true,
    prompt: input.prompt,
    requestedCwd: input.requestedCwd,
    cwdRealpath: input.cwdRealpath,
    accessMode,
    sandbox,
    permissionMode,
    access: input.access,
    attachments: input.attachments,
    expiresAt: input.now + (input.ttlMs ?? DEFAULT_TTL_MS),
    policyFingerprint: policyFingerprint({
      cwdRealpath: input.cwdRealpath,
      sandbox,
      accessPolicyDigest: accessDigest,
      resourceScopeDigest: resourceDigest,
      attachmentPolicyShapeDigest: attachmentDigest,
      codexHome: input.codexHome,
      inheritCodexHome: input.inheritCodexHome ?? false,
    }),
  };
}

const ACCESS_ORDER: Record<AccessMode, number> = {
  'read-only': 0,
  workspace: 1,
  full: 2,
};

/**
 * Map a GroupRole + chatType to the maximum AccessMode allowed in that scenario.
 * p2p is always unrestricted (owner accessing their own machine).
 * In group chats: owner/collaborator → full; participant/denied → read-only.
 */
function roleToScenarioCeiling(role: GroupRole, chatType: 'p2p' | 'group'): AccessMode {
  if (chatType === 'p2p') return 'full';
  switch (role) {
    case 'owner':
    case 'collaborator':
      return 'full';
    case 'participant':
    case 'denied':
      return 'read-only';
  }
}

function reject(
  code: RunPolicyReject['rejectReason']['code'],
  userVisible: string,
): RunPolicyReject {
  return { ok: false, rejectReason: { code, userVisible } };
}
