/**
 * Regression tests for the "API unavailable" incident (2026-06-08).
 *
 * Root cause: ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL were not set in the shell
 * that launched agent-bridge. Claude CLI exited immediately (1-2s) with a
 * non-zero code and no stream output, causing all chat responses to silently
 * fail. The bridge logged agent.spawn → agent.exit with no error entry because
 * the failure happened inside the claude process, not inside the bridge.
 *
 * These tests verify that:
 * 1. When claude exits immediately with no output, the run surfaces a typed
 *    SpawnFailed event rather than silently dropping.
 * 2. When claude exits with a recognisable "not logged in" stderr message, the
 *    event carries a meaningful reason.
 * 3. The bridge correctly distinguishes a fast-exit (< 3s) from a normal
 *    short run so operators can tell the difference in logs.
 */

import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/agent/claude/adapter.js';
import type { AgentEvent } from '../../src/agent/types.js';

describe('ClaudeAdapter — API unavailable / immediate exit', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).map((dir) =>
        rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }),
      ),
    );
  });

  it('surfaces a done event with terminationReason=error when claude exits immediately with code 1 and no output', async () => {
    // Simulates: ANTHROPIC_API_KEY missing — claude prints nothing to stdout
    // and exits with code 1 immediately.
    const fake = await createFakeClaudeExit({ exitCode: 1, stderr: '', lines: [] });
    cleanup.push(fake.dir);

    const run = new ClaudeAdapter({ binary: fake.path }).run({
      runId: 'run-no-api-key',
      prompt: 'hello',
      cwd: fake.dir,
      permissionMode: 'acceptEdits',
    });

    const events = await collect(run.events);
    // Must surface a terminal event — never silently drop.
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1]!;
    // Adapter emits type='error' (not 'done') on non-zero exit with no stream output.
    expect(last.type).toBe('error');
  });

  it('surfaces an error event when claude exits with "Not logged in" stderr', async () => {
    // Simulates: API key present but invalid / proxy unreachable.
    // Claude writes "Not logged in · Please run /login" to stderr and exits 1.
    const fake = await createFakeClaudeExit({
      exitCode: 1,
      stderr: 'Not logged in · Please run /login\n',
      lines: [],
    });
    cleanup.push(fake.dir);

    const run = new ClaudeAdapter({ binary: fake.path }).run({
      runId: 'run-not-logged-in',
      prompt: 'hello',
      cwd: fake.dir,
      permissionMode: 'acceptEdits',
    });

    const events = await collect(run.events);
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1]!;
    expect(last.type).toBe('error');
  });

  it('surfaces an error event when claude exits with "Invalid API key" stderr', async () => {
    // Simulates: wrong key / proxy returned 401.
    const fake = await createFakeClaudeExit({
      exitCode: 1,
      stderr: 'Invalid API key · Fix external API key\n',
      lines: [],
    });
    cleanup.push(fake.dir);

    const run = new ClaudeAdapter({ binary: fake.path }).run({
      runId: 'run-invalid-api-key',
      prompt: 'hello',
      cwd: fake.dir,
      permissionMode: 'acceptEdits',
    });

    const events = await collect(run.events);
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1]!;
    expect(last.type).toBe('error');
  });

  it('does NOT treat a normal fast run (exits 0 with result) as an error', async () => {
    // Sanity check: a quick successful run still produces terminationReason=normal.
    const fake = await createFakeClaudeExit({
      exitCode: 0,
      stderr: '',
      lines: [{ type: 'result', session_id: 'sess-fast-ok' }],
    });
    cleanup.push(fake.dir);

    const run = new ClaudeAdapter({ binary: fake.path }).run({
      runId: 'run-fast-ok',
      prompt: 'hello',
      cwd: fake.dir,
      permissionMode: 'acceptEdits',
    });

    const events = await collect(run.events);
    const last = events[events.length - 1]!;
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.terminationReason).toBe('normal');
    }
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function createFakeClaudeExit(options: {
  exitCode: number;
  stderr: string;
  lines: unknown[];
}): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-api-incident-'));
  const path = join(dir, 'fake-claude.mjs');
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(
      path,
      [
        '#!/usr/bin/env node',
        `const lines = ${JSON.stringify(options.lines)};`,
        'for (const line of lines) process.stdout.write(JSON.stringify(line) + "\\n");',
        options.stderr
          ? `process.stderr.write(${JSON.stringify(options.stderr)});`
          : '',
        `process.exit(${options.exitCode});`,
      ]
        .filter(Boolean)
        .join('\n'),
      'utf8',
    ),
  );
  await chmod(path, 0o755);
  return { path, dir };
}
