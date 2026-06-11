import { describe, it, expect } from 'vitest';
import { decodeProjectName } from '../../../src/tasks/session-scanner';

// Helper: build a fake filePath as if it were under ~/.claude/projects/<encoded>/session.jsonl
function fakeFilePath(encoded: string): string {
  return `/Users/liruncheng/.claude/projects/${encoded}/session.jsonl`;
}

describe('decodeProjectName', () => {
  it('decodes a simple Desktop project with spaces in dir name', () => {
    // /Users/liruncheng/Desktop/Agent Bridge/lark-coding-agent-bridge-main
    const encoded = '-Users-liruncheng-Desktop-Agent-Bridge-lark-coding-agent-bridge-main';
    const result = decodeProjectName(fakeFilePath(encoded));
    // Should resolve to real path and return last 2 segments
    expect(result).toBe('Agent Bridge/lark-coding-agent-bridge-main');
  });

  it('decodes dotfile workspace directory (double-dash = hyphen in original name)', () => {
    // /Users/liruncheng/.agent-bridge-workspaces/claude/default
    const encoded = '-Users-liruncheng--agent-bridge-workspaces-claude-default';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('claude/default');
  });

  it('decodes group workspace path', () => {
    // /Users/liruncheng/.agent-bridge-workspaces/claude/groups/oc_<id>
    // encoded as: oc-<id> (underscore → hyphen in encoding)
    const encoded = '-Users-liruncheng--agent-bridge-workspaces-claude-groups-oc-0d2419ac3fa15ea23a993ab77bfe275e';
    const result = decodeProjectName(fakeFilePath(encoded));
    // Last 2 segments: groups/oc_0d2419ac3fa15ea23a993ab77bfe275e
    expect(result).toBe('groups/oc_0d2419ac3fa15ea23a993ab77bfe275e');
  });

  it('decodes lark-channel workspace', () => {
    const encoded = '-Users-liruncheng--lark-channel-workspaces-claude-default';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('claude/default');
  });

  it('decodes shallow home-only path with single segment', () => {
    // /Users/liruncheng — shallow, show only last segment
    const encoded = '-Users-liruncheng';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toBe('liruncheng');
  });

  it('returns fallback for unresolvable path (no crash)', () => {
    const encoded = '-nonexistent-path-that-does-not-exist-on-this-machine';
    const result = decodeProjectName(fakeFilePath(encoded));
    // Should not throw, return some non-empty string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns basename fallback when no projects segment in path', () => {
    const result = decodeProjectName('/some/other/path/session.jsonl');
    expect(result).toBe('session');
  });
});
