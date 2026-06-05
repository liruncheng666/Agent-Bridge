import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveAttachments } from '../../../src/media/archive.js';
import type { NormalizedAttachment } from '../../../src/media/attachment.js';

// ─── helpers ────────────────────────────────────────────────────────────────

let testDir: string;
let mediaDir: string;
let workspaceDir: string;

beforeEach(async () => {
  testDir = await mkTmpDir('archive-test-');
  mediaDir = join(testDir, 'media');
  workspaceDir = join(testDir, 'workspace');
  await mkdir(mediaDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function mkTmpDir(prefix: string): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), prefix));
}

function makeAttachment(
  overrides: Partial<NormalizedAttachment> & { absPath: string; hash: string },
): NormalizedAttachment {
  return {
    kind: 'file',
    size: 100,
    mime: 'text/plain',
    source: 'lark',
    sourceMessageId: 'msg-1',
    sourceFileKey: 'key-1',
    path: overrides.absPath,
    requiredness: 'optional',
    decision: 'accepted',
    ...overrides,
  };
}

async function writeMediaFile(name: string, content: string): Promise<string> {
  const p = join(mediaDir, name);
  await writeFile(p, content, 'utf8');
  return p;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('archiveAttachments', () => {
  it('copies accepted attachment into workspace/inbox/', async () => {
    const src = await writeMediaFile('abc123.txt', 'hello');
    const attachment = makeAttachment({
      absPath: src,
      hash: 'abc123',
      originalName: 'readme.txt',
    });

    const results = await archiveAttachments([attachment], workspaceDir);

    expect(results.size).toBe(1);
    const result = results.get(src);
    expect(result?.copied).toBe(true);
    expect(result?.archivePath).toContain('inbox');
    expect(result?.archivePath).toContain('readme.txt');

    const content = await readFile(result!.archivePath, 'utf8');
    expect(content).toBe('hello');
  });

  it('uses custom subdir when specified', async () => {
    const src = await writeMediaFile('hash1.pdf', 'pdf content');
    const attachment = makeAttachment({ absPath: src, hash: 'hash1', originalName: 'doc.pdf' });

    const results = await archiveAttachments([attachment], workspaceDir, { subdir: 'attachments' });

    const result = results.get(src);
    expect(result?.archivePath).toContain('attachments');
    expect(result?.archivePath).toContain('doc.pdf');
  });

  it('falls back to hash.ext when originalName is absent', async () => {
    const src = await writeMediaFile('deadbeef.png', 'img');
    const attachment = makeAttachment({ absPath: src, hash: 'deadbeef', kind: 'image', mime: 'image/png' });

    const results = await archiveAttachments([attachment], workspaceDir);

    const result = results.get(src);
    expect(result?.archivePath).toContain('deadbeef');
  });

  it('skips rejected and skipped attachments', async () => {
    const src = await writeMediaFile('rej.txt', 'data');
    const rejected = makeAttachment({ absPath: src, hash: 'rej', decision: 'rejected' });
    const skipped = makeAttachment({ absPath: src, hash: 'skip', decision: 'skipped' });

    const results = await archiveAttachments([rejected, skipped], workspaceDir);

    expect(results.size).toBe(0);
  });

  it('returns empty map when attachments list is empty', async () => {
    const results = await archiveAttachments([], workspaceDir);
    expect(results.size).toBe(0);
  });

  it('skips copy (copied=false) when file already exists with same name', async () => {
    const src = await writeMediaFile('dup.txt', 'original');
    const attachment = makeAttachment({ absPath: src, hash: 'dup', originalName: 'notes.txt' });

    // First archive
    const r1 = await archiveAttachments([attachment], workspaceDir);
    expect(r1.get(src)?.copied).toBe(true);

    // Second archive — same file, should skip
    const r2 = await archiveAttachments([attachment], workspaceDir);
    expect(r2.get(src)?.copied).toBe(false);
    expect(r2.get(src)?.archivePath).toBe(r1.get(src)?.archivePath);
  });

  it('hash-based filenames (no originalName) are idempotent', async () => {
    const src = await writeMediaFile('aabbcc.png', 'img');
    const a = makeAttachment({ absPath: src, hash: 'aabbcc', kind: 'image', mime: 'image/png' });

    const r1 = await archiveAttachments([a], workspaceDir);
    const r2 = await archiveAttachments([a], workspaceDir);

    expect(r1.get(src)?.copied).toBe(true);
    expect(r2.get(src)?.copied).toBe(false);
    expect(r1.get(src)?.archivePath).toBe(r2.get(src)?.archivePath);
  });

  it('sanitizes dangerous characters in originalName', async () => {
    const src = await writeMediaFile('safe.txt', 'content');
    const a = makeAttachment({ absPath: src, hash: 'safe', originalName: '../../../etc/passwd' });

    const results = await archiveAttachments([a], workspaceDir);
    const archivePath = results.get(src)!.archivePath;

    // Must not escape out of inbox dir
    expect(archivePath).toContain(join(workspaceDir, 'inbox'));
    expect(archivePath).not.toContain('..');
  });

  it('does not throw when source file is missing (degrades gracefully)', async () => {
    const missing = join(mediaDir, 'ghost.txt');
    const a = makeAttachment({ absPath: missing, hash: 'ghost', originalName: 'ghost.txt' });

    // Should resolve without throwing; missing source → no entry in map
    const results = await archiveAttachments([a], workspaceDir);
    expect(results.has(missing)).toBe(false);
  });

  it('creates inbox dir with mode 0o700', async () => {
    const src = await writeMediaFile('perm.txt', 'data');
    const a = makeAttachment({ absPath: src, hash: 'perm', originalName: 'perm.txt' });

    await archiveAttachments([a], workspaceDir);

    const { stat } = await import('node:fs/promises');
    const st = await stat(join(workspaceDir, 'inbox'));
    // On Unix, 0o40700 = directory + 0o700
    expect(st.mode & 0o777).toBe(0o700);
  });
});
