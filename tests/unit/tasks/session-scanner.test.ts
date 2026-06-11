import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decodeProjectName } from '../../../src/tasks/session-scanner';

// Helper: build a fake filePath as if it were under ~/.claude/projects/<encoded>/session.jsonl
function fakeFilePath(encoded: string): string {
  return `/Users/liruncheng/.claude/projects/${encoded}/session.jsonl`;
}

// Mock existsSync so tests work on any machine / CI environment.
// We declare which paths "exist" per test case.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: unknown) => mockPaths.has(String(p))),
  };
});

const mockPaths = new Set<string>();

beforeEach(() => mockPaths.clear());
afterEach(() => mockPaths.clear());

describe('decodeProjectName', () => {
  it('decodes a simple Desktop project with spaces in dir name', () => {
    // /Users/liruncheng/Desktop/Agent Bridge/lark-coding-agent-bridge-main
    mockPaths.add('/Users');
    mockPaths.add('/Users/liruncheng');
    mockPaths.add('/Users/liruncheng/Desktop');
    mockPaths.add('/Users/liruncheng/Desktop/Agent Bridge');
    mockPaths.add('/Users/liruncheng/Desktop/Agent Bridge/lark-coding-agent-bridge-main');

    const encoded = '-Users-liruncheng-Desktop-Agent-Bridge-lark-coding-agent-bridge-main';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('Agent Bridge/lark-coding-agent-bridge-main');
  });

  it('decodes dotfile workspace directory (double-dash = hyphen in original name)', () => {
    // /Users/liruncheng/.agent-bridge-workspaces/claude/default
    mockPaths.add('/Users');
    mockPaths.add('/Users/liruncheng');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces/claude');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces/claude/default');

    const encoded = '-Users-liruncheng--agent-bridge-workspaces-claude-default';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('claude/default');
  });

  it('decodes group workspace path', () => {
    // /Users/liruncheng/.agent-bridge-workspaces/claude/groups/oc_<id>
    mockPaths.add('/Users');
    mockPaths.add('/Users/liruncheng');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces/claude');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces/claude/groups');
    mockPaths.add('/Users/liruncheng/.agent-bridge-workspaces/claude/groups/oc_0d2419ac3fa15ea23a993ab77bfe275e');

    const encoded = '-Users-liruncheng--agent-bridge-workspaces-claude-groups-oc-0d2419ac3fa15ea23a993ab77bfe275e';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('groups/oc_0d2419ac3fa15ea23a993ab77bfe275e');
  });

  it('decodes lark-channel workspace', () => {
    mockPaths.add('/Users');
    mockPaths.add('/Users/liruncheng');
    mockPaths.add('/Users/liruncheng/.lark-channel-workspaces');
    mockPaths.add('/Users/liruncheng/.lark-channel-workspaces/claude');
    mockPaths.add('/Users/liruncheng/.lark-channel-workspaces/claude/default');

    const encoded = '-Users-liruncheng--lark-channel-workspaces-claude-default';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('claude/default');
  });

  it('decodes shallow home-only path with single segment', () => {
    // /Users/liruncheng — shallow, show only last segment
    mockPaths.add('/Users');
    mockPaths.add('/Users/liruncheng');

    const encoded = '-Users-liruncheng';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('liruncheng');
  });

  it('returns fallback for unresolvable path (no crash)', () => {
    // mockPaths is empty — existsSync always returns false
    const encoded = '-nonexistent-path-that-does-not-exist-on-this-machine';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns basename fallback when no projects segment in path', () => {
    const result = decodeProjectName('/some/other/path/session.jsonl');
    expect(result).toBe('session');
  });
});
