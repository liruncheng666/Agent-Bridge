import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export interface SessionSummary {
  /** Human-readable project name derived from the encoded path */
  projectName: string;
  /**
   * CLI terminal title: the actual cwd from the JSONL system event,
   * showing just the last path segment (e.g. "prd-quality-check-rules").
   * Falls back to projectName when cwd is not available.
   */
  cliTitle: string;
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
  /** 1-based index in the sorted result list, set by scanActiveSessions */
  index: number;
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MIN = 20;
const RECENT_ACTIVITY_MIN = 5;

/**
 * Project directory name patterns to exclude from /tasks.
 * These are Claude sessions spawned BY the bridge itself (Feishu-triggered runs),
 * not the user's local terminal sessions we want to monitor.
 */
const BRIDGE_PROJECT_PATTERNS = [
  /agent-bridge-workspaces/,
  /lark-channel-workspaces/,
  /lark-ai-bridge-workspaces/,
];

/**
 * Minimum cwd path depth to be considered a real local terminal session.
 * Sessions with cwd = $HOME (depth 2: /Users/liruncheng) or shallower are
 * bridge-spawned Feishu sessions, not real terminal projects.
 * Real projects are at least /Users/xxx/Desktop/project-name (depth 4+).
 */
const MIN_CWD_DEPTH = 4;

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
      .filter((e) => !BRIDGE_PROJECT_PATTERNS.some((p) => p.test(e.name)))
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
  const sorted = summaries.sort((a, b) => {
    if (a.waitingForUser !== b.waitingForUser) return a.waitingForUser ? -1 : 1;
    return a.minutesAgo - b.minutesAgo;
  });

  // Assign 1-based index after sorting
  return sorted.map((s, i) => ({ ...s, index: i + 1 }));
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
  const cliTitle = extractCliTitle(events) ?? projectName;

  // Filter out bridge-spawned Feishu sessions: their cwd is $HOME or shallow
  const cwd = extractCwd(events);
  if (cwd) {
    const depth = cwd.split('/').filter(Boolean).length;
    if (depth < MIN_CWD_DEPTH) return null;
  }

  return { projectName, cliTitle, filePath, terminal, waitingForUser, lastMessage, minutesAgo, index: 0 };
}

function inferTerminal(
  events: Record<string, unknown>[],
  minutesAgo: number,
): SessionSummary['terminal'] {
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
      if (minutesAgo > STALE_THRESHOLD_MIN) return 'idle_timeout';
      return 'running';
    }
  }

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
  if (lastMessage.trimEnd().endsWith('？') || lastMessage.trimEnd().endsWith('?')) return true;
  if (/[123]\.|[①②③]/.test(lastMessage)) return true;
  return false;
}

export interface SessionDetail {
  /** The session summary this detail belongs to */
  summary: SessionSummary;
  /** Full text of the last assistant message (up to MAX_DETAIL_CHARS) */
  lastAssistantText: string;
  /** Whether the text was truncated */
  truncated: boolean;
  /** Pending questions extracted from the last assistant message */
  pendingQuestions: string[];
}

const MAX_DETAIL_CHARS = 1500;
const MAX_PENDING_QUESTIONS = 3;

/**
 * Read the full detail for a session by its 1-based index from scanActiveSessions.
 * Returns null if the index is out of range.
 */
export async function getSessionDetail(
  sessions: SessionSummary[],
  index: number,
): Promise<SessionDetail | null> {
  const summary = sessions.find((s) => s.index === index);
  if (!summary) return null;

  let raw: string;
  try {
    raw = await readFile(summary.filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter((l) => l.trim());
  // Read last 100 lines for detail (more than scanActiveSessions uses)
  const events: Record<string, unknown>[] = [];
  for (const line of lines.slice(-100)) {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* skip */
    }
  }

  const fullText = extractFullAssistantText(events);
  const truncated = fullText.length > MAX_DETAIL_CHARS;
  const lastAssistantText = truncated ? fullText.slice(0, MAX_DETAIL_CHARS) : fullText;
  const pendingQuestions = extractPendingQuestions(fullText);

  return { summary, lastAssistantText, truncated, pendingQuestions };
}

function extractCwd(events: Record<string, unknown>[]): string | null {
  for (const e of events) {
    if (e['type'] === 'system') {
      const cwd = e['cwd'];
      if (typeof cwd === 'string' && cwd) return cwd;
    }
  }
  return null;
}

function extractCliTitle(events: Record<string, unknown>[]): string | null {
  // Claude Code writes a 'system' event with cwd early in the session
  for (const e of events) {
    if (e['type'] === 'system') {
      const cwd = (e as Record<string, unknown>)['cwd'];
      if (typeof cwd === 'string' && cwd) {
        const segs = cwd.split('/').filter(Boolean);
        return segs[segs.length - 1] ?? null;
      }
    }
  }
  // Also check inside message.cwd for some SDK versions
  for (const e of events) {
    if (e['type'] === 'assistant') {
      const msg = e['message'] as Record<string, unknown> | undefined;
      const cwd = msg?.['cwd'];
      if (typeof cwd === 'string' && cwd) {
        const segs = cwd.split('/').filter(Boolean);
        return segs[segs.length - 1] ?? null;
      }
    }
  }
  return null;
}

function extractFullAssistantText(events: Record<string, unknown>[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e['type'] !== 'assistant') continue;
    const msg = e['message'] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const content = msg['content'];
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
        .filter((b) => b['type'] === 'text')
        .map((b) => String(b['text'] ?? ''))
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

function extractPendingQuestions(text: string): string[] {
  if (!text) return [];

  // Split on sentence-ending punctuation or newlines, then filter questions
  const sentences = text.split(/[。\n]+/);
  const questions: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 5) continue;
    if (trimmed.endsWith('？') || trimmed.endsWith('?')) {
      questions.push(trimmed);
      if (questions.length >= MAX_PENDING_QUESTIONS) break;
    }
  }
  return questions;
}

/**
 * Decode a Claude projects encoded directory name to a readable display name.
 *
 * Claude encodes working directory paths by:
 *   - Replacing '/' with '-'
 *   - Replacing '.' at the start of a dir name with '-' (merges with path separator = '--')
 *   - Replacing ' ' with '-' (same as path separator — ambiguous)
 *   - Replacing '_' with '-' (same as path separator — ambiguous)
 *   - Literal '-' inside dir names is also '-' (no escaping)
 *
 * Decoding strategy: greedy DFS over raw tokens (split on '-', keep empty strings
 * that mark '--' boundaries / dotfile prefixes), trying all combinations of
 * '-', ' ', and '_' as joiners. Candidate paths are verified with existsSync.
 *
 * Falls back to a best-effort string heuristic when no real path is found.
 */
export function decodeProjectName(filePath: string): string {
  const parts = filePath.split('/');
  const projectsIdx = parts.lastIndexOf('projects');
  if (projectsIdx < 0) return basename(filePath, '.jsonl');

  const encoded = parts[projectsIdx + 1] ?? '';
  if (!encoded) return basename(filePath, '.jsonl');

  const realPath = resolveEncodedPath(encoded);
  if (realPath) {
    const segs = realPath.split('/').filter(Boolean);
    // Shallow paths (e.g. /Users/foo) — show only the last segment
    if (segs.length <= 2) return segs[segs.length - 1] ?? encoded;
    return segs.slice(-2).join('/');
  }

  // Fallback: replace '--' with hyphen, single '-' with '/', take last 2 segments
  const s = encoded
    .replace(/^-/, '')
    .replace(/--/g, '\x00')
    .replace(/-/g, '/')
    .replace(/\x00/g, '-');
  const segs = s.split('/').filter(Boolean);
  return segs.slice(-2).join('/') || encoded;
}

/**
 * Attempt to reconstruct the real filesystem path from a Claude projects encoded
 * directory name using greedy DFS with existsSync verification.
 *
 * Encoding rules:
 *   - '/' → '-' (path separator)
 *   - leading '.' → '-' (merges with preceding separator = '--')
 *   - ' ', '_', '-' inside dir names → '-' (all ambiguous with separator)
 *
 * We split the encoded string on '-' keeping empty strings (which mark '--'
 * boundaries indicating a dotfile dir follows), then try consuming 1..N tokens
 * per path segment with combinations of '-', ' ', and '_' as joiners.
 */
function resolveEncodedPath(encoded: string): string | null {
  // Split on '-', keeping empty strings — they mark '--' (dotfile prefix)
  const rawTokens = encoded.replace(/^-/, '').split('-');

  // Build candidate dir names from a slice of non-empty tokens.
  // Tries all combinations of '-', ' ', '_' as joiners (capped at 60).
  function buildCandidates(toks: string[], dotPrefix: boolean): string[] {
    if (toks.length === 0) return [];
    const JOINERS = ['-', ' ', '_'] as const;
    let variants: string[] = [toks[0]!];
    for (let i = 1; i < toks.length; i++) {
      const next: string[] = [];
      for (const v of variants) {
        for (const j of JOINERS) {
          next.push(v + j + toks[i]!);
        }
      }
      variants = next.slice(0, 60); // cap combinatorial explosion
    }
    const dotted = dotPrefix ? variants.map((v) => '.' + v) : [];
    return [...variants, ...dotted];
  }

  function dfs(idx: number, currentPath: string): string | null {
    if (idx === rawTokens.length) return currentPath;

    // A '--' boundary: the next real token follows a dotfile prefix marker.
    // Skip empty tokens at the very start (from the leading '-' we already stripped,
    // but keep track of whether we're right after an empty = dotfile context).
    const dotPrefix = idx > 0 && rawTokens[idx - 1] === '';

    // Accumulate non-empty tokens to form a path segment candidate.
    const accumToks: string[] = [];
    for (let i = idx; i < rawTokens.length; i++) {
      const tok = rawTokens[i]!;
      if (tok === '') break; // '--' boundary — stop, next segment starts after
      accumToks.push(tok);

      const candidates = buildCandidates(accumToks, dotPrefix);
      for (const candidate of [...new Set(candidates)]) {
        const nextPath = join(currentPath, candidate);
        if (existsSync(nextPath)) {
          // Advance past consumed tokens; skip trailing empty token if present
          let nextIdx = idx + accumToks.length;
          if (nextIdx < rawTokens.length && rawTokens[nextIdx] === '') nextIdx++;
          const result = dfs(nextIdx, nextPath);
          if (result !== null) return result;
        }
      }
    }
    return null;
  }

  // Handle the case where encoded starts with '--' (dotfile at root level)
  const startIdx = rawTokens[0] === '' ? 1 : 0;
  return dfs(startIdx, '/');
}
