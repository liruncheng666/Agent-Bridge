import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export interface SessionSummary {
  /** Human-readable project name derived from the encoded path */
  projectName: string;
  /** Absolute path to the .jsonl file */
  filePath: string;
  /** Inferred terminal state */
  terminal: 'running' | 'done' | 'error' | 'interrupted' | 'idle_timeout' | 'unknown';
  /** Whether the last assistant message seems to be waiting for user input */
  waitingForUser: boolean;
  /** Last assistant message snippet (≤100 chars) */
  lastMessage: string;
  /** Minutes since last file modification */
  minutesAgo: number;
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MIN = 20;
const RECENT_ACTIVITY_MIN = 5;

/**
 * Scan ~/.claude/projects for sessions active in the last `windowMinutes` minutes.
 */
export async function scanActiveSessions(
  windowMinutes = 60,
): Promise<SessionSummary[]> {
  let projectDirs: string[];
  try {
    const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    projectDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(CLAUDE_PROJECTS_DIR, e.name));
  } catch {
    return [];
  }

  const now = Date.now();
  const cutoff = now - windowMinutes * 60 * 1000;
  const summaries: SessionSummary[] = [];

  for (const dir of projectDirs) {
    let files: string[];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl') && !e.name.includes('subagent'))
        .map((e) => join(dir, e.name));
    } catch {
      continue;
    }

    for (const filePath of files) {
      try {
        const s = await stat(filePath);
        const mtime = s.mtimeMs;
        if (mtime < cutoff) continue;

        const minutesAgo = Math.round((now - mtime) / 60_000);
        const summary = await parseSession(filePath, minutesAgo);
        if (summary) summaries.push(summary);
      } catch {
        continue;
      }
    }
  }

  // Sort: waiting-for-user first, then by recency
  return summaries.sort((a, b) => {
    if (a.waitingForUser !== b.waitingForUser) return a.waitingForUser ? -1 : 1;
    return a.minutesAgo - b.minutesAgo;
  });
}

async function parseSession(
  filePath: string,
  minutesAgo: number,
): Promise<SessionSummary | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return null;

  // Parse last 50 events
  const events: Record<string, unknown>[] = [];
  for (const line of lines.slice(-50)) {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* skip malformed lines */
    }
  }

  const terminal = inferTerminal(events, minutesAgo);
  const lastMessage = extractLastAssistantMessage(events);
  const waitingForUser = isWaitingForUser(terminal, lastMessage);
  const projectName = decodeProjectName(filePath);

  return { projectName, filePath, terminal, waitingForUser, lastMessage, minutesAgo };
}

function inferTerminal(
  events: Record<string, unknown>[],
  minutesAgo: number,
): SessionSummary['terminal'] {
  // Walk backwards to find the most recent run/completed or run/started
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e['phase'] !== 'run') continue;

    if (e['event'] === 'completed') {
      const result = e['result'] as string | undefined;
      if (result === 'error') return 'error';
      if (result === 'interrupted') return 'interrupted';
      return 'done';
    }

    if (e['event'] === 'started') {
      // Run started but no completed event found — still running or stuck
      if (minutesAgo > STALE_THRESHOLD_MIN) return 'idle_timeout';
      return 'running';
    }
  }

  // No run events — check if there's recent assistant activity
  const hasRecentActivity = minutesAgo <= RECENT_ACTIVITY_MIN;
  return hasRecentActivity ? 'running' : 'unknown';
}

function extractLastAssistantMessage(events: Record<string, unknown>[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e['type'] !== 'assistant') continue;
    const msg = e['message'] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const content = msg['content'];
    if (typeof content === 'string' && content.trim()) {
      return content.trim().slice(0, 100);
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
        .filter((b) => b['type'] === 'text')
        .map((b) => String(b['text'] ?? ''))
        .join(' ')
        .trim();
      if (text) return text.slice(0, 100);
    }
  }
  return '';
}

function isWaitingForUser(terminal: SessionSummary['terminal'], lastMessage: string): boolean {
  if (terminal !== 'done' && terminal !== 'idle_timeout') return false;
  if (!lastMessage) return false;
  // Ends with question mark
  if (lastMessage.trimEnd().endsWith('？') || lastMessage.trimEnd().endsWith('?')) return true;
  // Contains numbered options (1. / 2. pattern)
  if (/[123]\.|[①②③]/.test(lastMessage)) return true;
  return false;
}

/**
 * Decode the encoded path segment back to a readable project name.
 * ~/.claude/projects/-Users-foo-Desktop-my-project/  →  my-project
 *
 * Claude encodes paths by replacing '/' with '-'. To avoid splitting
 * on legitimate hyphens inside directory names, we recover the full
 * decoded path and return the last two non-empty segments joined with
 * '/' so names like "Desktop/my-project" stay readable.
 */
function decodeProjectName(filePath: string): string {
  const parts = filePath.split('/');
  const projectsIdx = parts.lastIndexOf('projects');
  if (projectsIdx < 0) return basename(filePath, '.jsonl');

  const encoded = parts[projectsIdx + 1] ?? '';
  // The encoding is: leading '/' → leading '-', then each '/' → '-'.
  // We recover by splitting on '-' runs that correspond to path separators.
  // Since each original path component may itself contain hyphens, we use
  // the known HOME prefix anchor: strip leading '-', split by '-', and
  // return the last 2 segments to give context (parent/project).
  const withoutLeadingDash = encoded.replace(/^-/, '');
  const segments = withoutLeadingDash.split('-').filter(Boolean);
  if (segments.length === 0) return encoded;
  // Return last 2 segments for readability: "Desktop/my-project-name" would
  // show as "my/project/name" which is imperfect, but good enough for display.
  // For single-segment projects just return that segment.
  return segments.slice(-2).join('-');
}
