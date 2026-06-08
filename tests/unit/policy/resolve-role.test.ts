import { describe, expect, it } from 'vitest';
import { resolveRole, roleToAccessMode } from '../../../src/policy/access.js';
import type { RuntimeControls } from '../../../src/policy/access.js';
import type { ProfileConfig } from '../../../src/config/profile-schema.js';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeControls(botOwnerId?: string): RuntimeControls {
  return {
    botOwnerId,
    ownerRefreshState: botOwnerId ? 'ok' : 'unknown',
  };
}

function makeProfile(overrides: Partial<ProfileConfig['access']> = {}): ProfileConfig {
  const base = createDefaultProfileConfig({
    agentKind: 'claude',
    accounts: { app: { id: 'app-1', secret: 'secret', tenant: 'feishu' } },
  });
  return {
    ...base,
    access: {
      ...base.access,
      ...overrides,
    },
  };
}

const CHAT_ID = 'oc_aabbccdd';
const OWNER_ID = 'ou_owner';
const COLLAB_ID = 'ou_collab';
const PART_ID = 'ou_participant';
const STRANGER_ID = 'ou_stranger';

// ─── resolveRole tests ───────────────────────────────────────────────────────

describe('resolveRole (REQ-03)', () => {
  it('owner always returns owner regardless of chat config', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile();
    expect(resolveRole(OWNER_ID, CHAT_ID, controls, profile)).toBe('owner');
  });

  it('collaborator listed in groupRoles returns collaborator', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      groupRoles: {
        [CHAT_ID]: { collaborators: [COLLAB_ID], participants: [], policy: 'strict' },
      },
    });
    expect(resolveRole(COLLAB_ID, CHAT_ID, controls, profile)).toBe('collaborator');
  });

  it('participant listed in groupRoles returns participant', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      groupRoles: {
        [CHAT_ID]: { collaborators: [], participants: [PART_ID], policy: 'strict' },
      },
    });
    expect(resolveRole(PART_ID, CHAT_ID, controls, profile)).toBe('participant');
  });

  it('collaborator takes precedence over participant if listed in both', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      groupRoles: {
        [CHAT_ID]: { collaborators: [COLLAB_ID], participants: [COLLAB_ID], policy: 'strict' },
      },
    });
    expect(resolveRole(COLLAB_ID, CHAT_ID, controls, profile)).toBe('collaborator');
  });

  it('strict policy denies unlisted users', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      groupRoles: {
        [CHAT_ID]: { collaborators: [], participants: [], policy: 'strict' },
      },
    });
    expect(resolveRole(STRANGER_ID, CHAT_ID, controls, profile)).toBe('denied');
  });

  it('open-participant policy grants participant to unlisted users', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      groupRoles: {
        [CHAT_ID]: { collaborators: [], participants: [], policy: 'open-participant' },
      },
    });
    expect(resolveRole(STRANGER_ID, CHAT_ID, controls, profile)).toBe('participant');
  });

  it('role is per-chat: different chatId returns denied (strict)', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      groupRoles: {
        [CHAT_ID]: { collaborators: [COLLAB_ID], participants: [], policy: 'strict' },
      },
    });
    expect(resolveRole(COLLAB_ID, 'oc_other_chat', controls, profile)).toBe('denied');
  });

  it('falls back to allowedChats for backward-compat when no groupRoles entry', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      allowedChats: [CHAT_ID],
      groupRoles: {},
    });
    expect(resolveRole(STRANGER_ID, CHAT_ID, controls, profile)).toBe('participant');
  });

  it('falls back to admins as collaborator for backward-compat', () => {
    const controls = makeControls(OWNER_ID);
    const profile = makeProfile({
      admins: [COLLAB_ID],
      groupRoles: {},
    });
    expect(resolveRole(COLLAB_ID, CHAT_ID, controls, profile)).toBe('collaborator');
  });

  it('owner state unknown → denies owner claim', () => {
    const controls = makeControls(undefined); // ownerRefreshState = 'unknown'
    const profile = makeProfile();
    // Even if someone sends the actual owner openid, if state is unknown, not owner
    const result = resolveRole(OWNER_ID, CHAT_ID, controls, profile);
    expect(result).not.toBe('owner');
  });
});

// ─── roleToAccessMode tests ──────────────────────────────────────────────────

describe('roleToAccessMode (REQ-03)', () => {
  it('owner → full', () => expect(roleToAccessMode('owner')).toBe('full'));
  it('collaborator → full', () => expect(roleToAccessMode('collaborator')).toBe('full'));
  it('participant → read-only', () => expect(roleToAccessMode('participant')).toBe('read-only'));
  it('denied → read-only', () => expect(roleToAccessMode('denied')).toBe('read-only'));
});
