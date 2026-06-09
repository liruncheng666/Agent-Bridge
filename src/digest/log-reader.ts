import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DigestError {
  ts: string;
  phase: string;
  event: string;
  err: string;
}

export interface DigestLogData {
  /** YYYY-MM-DD */
  date: string;
  /** Date key used for filename: YYYYMMDD */
  dateKey: string;
  /** Total intake.enter entries (user messages reaching the bot) */
  totalMessages: number;
  /** Number of distinct scopes (chat sessions) that were active */
  activeScopes: number;
  /** open_id of messages sent by the bot owner (for needs extraction) */
  ownerPreviews: string[];
  /** level=error entries */
  errors: DigestError[];
  /** Number of slash commands issued */
  commandCount: number;
}

/**
 * Read and parse a bridge-YYYYMMDD.jsonl log file.
 * Returns null when the file does not exist or is empty.
 */
export async function readDayLogs(
  logsDir: string,
  dateKey: string,
  ownerOpenId: string,
): Promise<DigestLogData | null> {
  const filePath = join(logsDir, `bridge-${dateKey}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  const date = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
  const scopes = new Set<string>();
  const ownerPreviews: string[] = [];
  const errors: DigestError[] = [];
  let totalMessages = 0;
  let commandCount = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const phase = entry['phase'] as string | undefined;
    const event = entry['event'] as string | undefined;
    const level = entry['level'] as string | undefined;

    if (phase === 'intake' && event === 'enter') {
      totalMessages++;
      const scope = entry['scope'] as string | undefined;
      if (scope) scopes.add(scope);
      // Collect previews from the bot owner for needs extraction
      const sender = entry['sender'] as string | undefined;
      const preview = entry['preview'] as string | undefined;
      if (sender === ownerOpenId && preview && preview.length > 3 && !preview.startsWith('/')) {
        ownerPreviews.push(preview.slice(0, 200));
      }
    } else if (isErrorEntry(level, phase, event, entry)) {
      const errMsg =
        (entry['err'] as string | undefined) ??
        (entry['message'] as string | undefined) ??
        (entry['error'] as string | undefined) ??
        '';
      errors.push({
        ts: (entry['ts'] as string | undefined) ?? '',
        phase: phase ?? '',
        event: event ?? '',
        err: errMsg,
      });
    } else if (phase === 'command') {
      commandCount++;
    }
  }

  return {
    date,
    dateKey,
    totalMessages,
    activeScopes: scopes.size,
    ownerPreviews,
    errors,
    commandCount,
  };
}

/**
 * Determine whether a log entry should be collected as an error for the digest.
 * Covers two cases:
 *   1. level === 'error'  (explicit error level)
 *   2. Known high-signal error events that the Lark SDK logs at info level
 *      but represent real failures (ws-stuck, chats-fetch-failed, agent.fail,
 *      command.fail, digest failures, run failures with non-normal result).
 */
function isErrorEntry(
  level: string | undefined,
  phase: string | undefined,
  event: string | undefined,
  entry: Record<string, unknown>,
): boolean {
  if (level === 'error') return true;

  // High-signal error events logged at info level
  const HIGH_SIGNAL_EVENTS: ReadonlySet<string> = new Set([
    'ws-stuck',
    'chats-fetch-failed',
    'agent-fail',
    'agent.fail',
    'command.fail',
    'summarizer-fail',
    'summarizer-no-env',
    'summarizer-wrong-classification',
  ]);
  if (event && HIGH_SIGNAL_EVENTS.has(event)) return true;

  // run/completed with non-normal result
  if (phase === 'run' && event === 'completed') {
    const result = entry['result'] as string | undefined;
    if (result && result !== 'normal') return true;
  }

  return false;
}
