import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCapability } from '../../../src/agent/capability';
import { ActiveRuns } from '../../../src/bot/active-runs';
import { startRunFlow } from '../../../src/bot/run-flow';
import { ProcessPool } from '../../../src/bot/process-pool';
import { createDefaultProfileConfig } from '../../../src/config/profile-schema';
import { RunExecutor } from '../../../src/runtime/run-executor';
import { SessionStore } from '../../../src/session/store';
import { WorkspaceStore } from '../../../src/workspace/store';
import { FakeAgentAdapter } from '../../helpers/fake-agent';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('IM run flow', () => {
  it('rejects missing cwd without falling back to the user home', async () => {
    const h = await createHarness();

    const result = await startRunFlow({
      scopeId: 'chat-1',
      scope: { source: 'im', chatId: 'chat-1', actorId: 'ou_user' },
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-user' },
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
    });

    expect(result).toMatchObject({
      ok: false,
      rejectReason: {
        code: 'empty-requested-cwd',
      },
    });
    expect(h.agent.runOptions).toEqual([]);
  });

  it('submits cwd through RunExecutor and resumes matching sessions', async () => {
    const h = await createHarness();
    const workspaceRealpath = await realpath(h.tmp.workspace);
    h.workspaces.setCwd('chat-1', h.tmp.workspace);
    h.sessions.set('chat-1', 'sess-1', workspaceRealpath);

    const result = await startRunFlow({
      scopeId: 'chat-1',
      scope: { source: 'im', chatId: 'chat-1', actorId: 'ou_user' },
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-user' },
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected run flow to start');
    expect(result.cwdRealpath).toBe(workspaceRealpath);
    expect(result.resumeFrom).toBe('sess-1');
    expect(h.agent.runOptions[0]).toMatchObject({
      runId: 'run-1',
      cwd: workspaceRealpath,
      sessionId: 'sess-1',
    });
  });

  it('uses the profile default workspace when a scope has no explicit binding', async () => {
    const h = await createHarness({ defaultWorkspace: true });
    const workspaceRealpath = await realpath(h.tmp.workspace);

    const result = await startRunFlow({
      scopeId: 'chat-1',
      scope: { source: 'im', chatId: 'chat-1', actorId: 'ou_user' },
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-user' },
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected run flow to start');
    expect(result.cwdRealpath).toBe(workspaceRealpath);
    expect(h.agent.runOptions[0]?.cwd).toBe(workspaceRealpath);
  });

  // SR-2: per-group workspace isolation.
  it('auto-binds an isolated workspace for a group chat with no explicit cwd', async () => {
    const h = await createHarness({ defaultWorkspace: true });
    const base = join(h.tmp.root, 'groups');
    const defaultRealpath = await realpath(h.tmp.workspace);

    const result = await startRunFlow({
      scopeId: 'oc_groupA',
      scope: { source: 'im', chatId: 'oc_groupA', actorId: 'ou_user' },
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-chat' },
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
      chatType: 'group',
      isOwner: false,
      autoGroupWorkspaceBase: base,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected run flow to start');
    // Lands in its own dir, NOT the shared default workspace.
    expect(result.cwdRealpath).not.toBe(defaultRealpath);
    expect(result.cwdRealpath).toBe(await realpath(join(base, 'oc_groupA')));
    // Binding is persisted so the next run resolves it directly.
    expect(h.workspaces.cwdFor('oc_groupA')).toBe(result.cwdRealpath);
  });

  it('gives two different groups two different workspaces', async () => {
    const h = await createHarness({ defaultWorkspace: true });
    const base = join(h.tmp.root, 'groups');
    const common = {
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-chat' } as const,
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
      chatType: 'group' as const,
      isOwner: false,
      autoGroupWorkspaceBase: base,
    };

    const a = await startRunFlow({
      ...common,
      scopeId: 'oc_groupA',
      scope: { source: 'im', chatId: 'oc_groupA', actorId: 'ou_user' },
    });
    // Drain the first run so it releases the (size-1) pool slot before the next.
    if (a.ok) {
      for await (const _ of a.execution.subscribe()) {
        /* consume to completion */
      }
    }
    const b = await startRunFlow({
      ...common,
      scopeId: 'oc_groupB',
      scope: { source: 'im', chatId: 'oc_groupB', actorId: 'ou_user' },
    });

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('expected both flows to start');
    expect(a.cwdRealpath).not.toBe(b.cwdRealpath);
  });

  it('lets an explicit /cd binding win over auto group isolation', async () => {
    const h = await createHarness({ defaultWorkspace: true });
    const base = join(h.tmp.root, 'groups');
    const explicit = await realpath(h.tmp.workspace);
    h.workspaces.setCwd('oc_groupA', explicit);

    const result = await startRunFlow({
      scopeId: 'oc_groupA',
      scope: { source: 'im', chatId: 'oc_groupA', actorId: 'ou_user' },
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-chat' },
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
      chatType: 'group',
      isOwner: false,
      autoGroupWorkspaceBase: base,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected run flow to start');
    expect(result.cwdRealpath).toBe(explicit);
  });

  it('sanitizes the topic scope separator into a single safe path segment', async () => {
    const h = await createHarness({ defaultWorkspace: true });
    const base = join(h.tmp.root, 'groups');

    const result = await startRunFlow({
      scopeId: 'oc_groupA:omThread9',
      scope: {
        source: 'im',
        chatId: 'oc_groupA',
        threadId: 'omThread9',
        actorId: 'ou_user',
      },
      prompt: 'hello',
      attachments: [],
      access: { ok: true, reason: 'allowed-chat' },
      capability: claudeCapability(h.profileConfig),
      profileConfig: h.profileConfig,
      sessions: h.sessions,
      workspaces: h.workspaces,
      executor: h.executor,
      now: 1000,
      chatType: 'group',
      isOwner: false,
      autoGroupWorkspaceBase: base,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected run flow to start');
    expect(result.cwdRealpath).toBe(await realpath(join(base, 'oc_groupA_omThread9')));
  });

});

async function createHarness(options: { defaultWorkspace?: boolean } = {}): Promise<{
  tmp: TmpProfile;
  agent: FakeAgentAdapter;
  executor: RunExecutor;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  profileConfig: ReturnType<typeof createDefaultProfileConfig>;
}> {
  const tmp = await createTmpProfile('bridge-im-run-flow-');
  const agent = new FakeAgentAdapter({
    events: [{ type: 'done', terminationReason: 'normal' }],
  });
  const executor = new RunExecutor({
    agent,
    pool: new ProcessPool(() => 1),
    activeRuns: new ActiveRuns(),
    createRunId: () => 'run-1',
    now: () => 1000,
  });
  const profileConfig = createDefaultProfileConfig({
    agentKind: 'claude',
    accounts: {
      app: {
        id: 'cli_test',
        secret: '${APP_SECRET}',
        tenant: 'feishu',
      },
    },
  });
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json'));
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json'));
  cleanups.push(async () => {
    await Promise.all([sessions.flush(), workspaces.flush()]);
    await tmp.cleanup();
  });
  return {
    tmp,
    agent,
    executor,
    sessions,
    workspaces,
    profileConfig: {
      ...profileConfig,
      workspaces: {
        ...profileConfig.workspaces,
        ...(options.defaultWorkspace ? { default: tmp.workspace } : {}),
      },
    },
  };
}
