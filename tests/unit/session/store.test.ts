import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../../../src/session/store';

const dirs: string[] = [];
const stores: SessionStore[] = [];

afterEach(async () => {
  // Flush pending async writes before deleting temp dirs — on Windows an
  // in-flight write keeps a handle open and rmdir fails with ENOTEMPTY.
  await Promise.all(stores.splice(0).map((s) => s.flush()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function freshStore(): Promise<{ store: SessionStore; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-session-store-'));
  dirs.push(dir);
  const path = join(dir, 'sessions.json');
  const store = new SessionStore(path);
  stores.push(store);
  return { store, path };
}

describe('SessionStore per-scope preferences (SR-4 model / SR-5 access)', () => {
  it('stores and reads a per-scope model override', async () => {
    const { store } = await freshStore();
    expect(store.getModel('chat-1')).toBeUndefined();
    store.setModel('chat-1', 'claude-opus-4-8');
    expect(store.getModel('chat-1')).toBe('claude-opus-4-8');
    expect(store.clearModel('chat-1')).toBe(true);
    expect(store.getModel('chat-1')).toBeUndefined();
    expect(store.clearModel('chat-1')).toBe(false);
  });

  it('stores and reads a per-scope access override', async () => {
    const { store } = await freshStore();
    expect(store.getAccessOverride('chat-1')).toBeUndefined();
    store.setAccessOverride('chat-1', 'read-only');
    expect(store.getAccessOverride('chat-1')).toBe('read-only');
    expect(store.clearAccessOverride('chat-1')).toBe(true);
    expect(store.getAccessOverride('chat-1')).toBeUndefined();
  });

  it('preserves model + access overrides across session set and clear (like /new)', async () => {
    const { store } = await freshStore();
    store.setModel('chat-1', 'claude-sonnet-4-6');
    store.setAccessOverride('chat-1', 'workspace');

    // A run records a session id; preferences must survive.
    store.set('chat-1', 'sess-1', '/repo');
    expect(store.getModel('chat-1')).toBe('claude-sonnet-4-6');
    expect(store.getAccessOverride('chat-1')).toBe('workspace');
    expect(store.resumeFor('chat-1', '/repo')).toBe('sess-1');

    // /new clears the resume pair but keeps the scope preferences.
    store.clear('chat-1');
    expect(store.resumeFor('chat-1', '/repo')).toBeUndefined();
    expect(store.getModel('chat-1')).toBe('claude-sonnet-4-6');
    expect(store.getAccessOverride('chat-1')).toBe('workspace');
  });

  it('round-trips overrides through load() even without a session pair', async () => {
    const { store, path } = await freshStore();
    store.setModel('chat-1', 'claude-haiku-4-5-20251001');
    store.setAccessOverride('chat-1', 'full');
    await store.flush();

    const reloaded = new SessionStore(path);
    await reloaded.load();
    expect(reloaded.getModel('chat-1')).toBe('claude-haiku-4-5-20251001');
    expect(reloaded.getAccessOverride('chat-1')).toBe('full');
  });

  it('ignores an invalid persisted accessOverride on load', async () => {
    const { store, path } = await freshStore();
    store.setModel('chat-1', 'claude-opus-4-8');
    store.setAccessOverride('chat-1', 'workspace');
    await store.flush();

    // Corrupt the access value on disk.
    const { readFile, writeFile } = await import('node:fs/promises');
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, Record<string, unknown>>;
    raw['chat-1']!.accessOverride = 'root';
    await writeFile(path, JSON.stringify(raw));

    const reloaded = new SessionStore(path);
    await reloaded.load();
    expect(reloaded.getAccessOverride('chat-1')).toBeUndefined();
    // The valid model field still survives.
    expect(reloaded.getModel('chat-1')).toBe('claude-opus-4-8');
  });
});
