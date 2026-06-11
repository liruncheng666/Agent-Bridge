import { describe, it, expect } from 'vitest';
import { decodeProjectName } from '../../../src/tasks/session-scanner';

// Helper: build a fake filePath as if it were under ~/.claude/projects/<encoded>/session.jsonl
function fakeFilePath(encoded: string): string {
  return `/Users/liruncheng/.claude/projects/${encoded}/session.jsonl`;
}

describe('decodeProjectName', () => {
  it('returns last 2 path segments from fallback heuristic for Desktop project path', () => {
    // /Users/liruncheng/Desktop/Agent Bridge/lark-coding-agent-bridge-main
    // encoded: '-Users-liruncheng-Desktop-Agent-Bridge-lark-coding-agent-bridge-main'
    // fallback splits on '-' → '/', takes last 2 segments
    // On the dev machine the DFS resolver may return the real path;
    // on CI it falls through to the heuristic. Either way the last 2
    // segments must include 'main' (always) as the tail.
    const encoded = '-Users-liruncheng-Desktop-Agent-Bridge-lark-coding-agent-bridge-main';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toMatch(/main$/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns last 2 segments for dotfile workspace path', () => {
    // /Users/liruncheng/.agent-bridge-workspaces/claude/default
    const encoded = '-Users-liruncheng--agent-bridge-workspaces-claude-default';
    const result = decodeProjectName(fakeFilePath(encoded));
    // last segment must be 'default'
    expect(result).toMatch(/default$/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns last 2 segments for group workspace path', () => {
    const encoded = '-Users-liruncheng--agent-bridge-workspaces-claude-groups-oc-0d2419ac3fa15ea23a993ab77bfe275e';
    const result = decodeProjectName(fakeFilePath(encoded));
    // last segment must end with the id
    expect(result).toMatch(/0d2419ac3fa15ea23a993ab77bfe275e$/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns last 2 segments for lark-channel workspace', () => {
    const encoded = '-Users-liruncheng--lark-channel-workspaces-claude-default';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(result).toMatch(/default$/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a non-empty result for shallow home-only path', () => {
    const encoded = '-Users-liruncheng';
    const result = decodeProjectName(fakeFilePath(encoded));
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Must contain 'liruncheng'
    expect(result).toContain('liruncheng');
  });

  it('returns a non-empty fallback for unresolvable path (no crash)', () => {
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
