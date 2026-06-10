import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getScheduleConfig } from '../config/schema';
import { readDayLogs } from './log-reader';
import { summarizeWithClaude } from './claude-summarizer';
import { formatDigestPost } from './format';
import { yesterdayKey, getDailyDigestAt, isDailyDigestEnabled } from '../bot/scheduler';
import type { ScheduledTask, TaskContext } from '../bot/scheduler';
import { log } from '../core/logger';

const TASK_ID = 'daily-digest';

/** Max days to look back for catch-up digests on startup. */
const CATCHUP_MAX_DAYS = 3;

/** Filename storing the set of dateKeys for which a digest was successfully sent. */
const SENT_RECORD_FILE = 'digest-sent.json';

export function createDailyDigestTask(): ScheduledTask {
  return {
    id: TASK_ID,
    getDailyAt: getDailyDigestAt,
    isEnabled: isDailyDigestEnabled,
    handler: runDailyDigest,
  };
}

/**
 * Called once on bridge startup (after ownerOpenId is resolved).
 * Checks the last CATCHUP_MAX_DAYS days and sends any missed digests.
 */
export async function catchUpMissedDigests(ctx: TaskContext): Promise<void> {
  if (!isDailyDigestEnabled(ctx.cfg)) return;

  const sent = await loadSentRecord(ctx.logsDir);
  const today = todayKey();

  // Build list of dateKeys to check: yesterday, day-before-yesterday, etc.
  const toCheck: string[] = [];
  for (let i = 1; i <= CATCHUP_MAX_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    toCheck.push(toDateKey(d));
  }

  // Only send for days that have log data and haven't been sent yet.
  for (const dateKey of toCheck) {
    if (sent.has(dateKey)) continue;

    const logData = await readDayLogs(ctx.logsDir, dateKey, ctx.ownerOpenId);
    if (!logData) continue; // no log = nothing to report, skip silently

    log.info('digest', 'catchup-send', { dateKey });
    try {
      await sendDigestForDate(ctx, dateKey, logData);
      sent.add(dateKey);
      await saveSentRecord(ctx.logsDir, sent);
    } catch (err) {
      log.fail('digest', err, { step: 'catchup', dateKey });
    }
  }
}

async function runDailyDigest(ctx: TaskContext): Promise<void> {
  const dateKey = yesterdayKey();
  const sent = await loadSentRecord(ctx.logsDir);

  if (sent.has(dateKey)) {
    log.info('digest', 'skip-already-sent', { dateKey });
    return;
  }

  const logData = await readDayLogs(ctx.logsDir, dateKey, ctx.ownerOpenId);

  if (!logData) {
    await sendMessage(ctx, {
      zh_cn: {
        title: `【日报】${fmtDate(dateKey)} · ${ctx.profile}`,
        content: [[{ tag: 'text', text: '昨日无运行日志。' }]],
      },
    });
    sent.add(dateKey);
    await saveSentRecord(ctx.logsDir, sent);
    return;
  }

  await sendDigestForDate(ctx, dateKey, logData);
  sent.add(dateKey);
  await saveSentRecord(ctx.logsDir, sent);
}

async function sendDigestForDate(
  ctx: TaskContext,
  dateKey: string,
  logData: Awaited<ReturnType<typeof readDayLogs>> & object,
): Promise<void> {
  const customPrompt = getScheduleConfig(ctx.cfg).dailyDigestPrompt;
  const summary = await summarizeWithClaude(logData, customPrompt, ctx.logsDir);
  const post = formatDigestPost(logData, summary, ctx.profile);

  // Prefix title with catch-up label when not yesterday
  const yesterday = yesterdayKey();
  if (dateKey !== yesterday) {
    post.zh_cn.title = `【补发日报】${fmtDate(dateKey)} · ${ctx.profile}`;
  }

  await sendMessage(ctx, post);
}

// ── Sent-record helpers ────────────────────────────────────────────────────

async function loadSentRecord(logsDir: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(logsDir, SENT_RECORD_FILE), 'utf8');
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function saveSentRecord(logsDir: string, sent: Set<string>): Promise<void> {
  // Keep only the last 30 days to prevent unbounded growth.
  const sorted = [...sent].sort().slice(-30);
  await writeFile(join(logsDir, SENT_RECORD_FILE), JSON.stringify(sorted), 'utf8');
}

// ── Date helpers ───────────────────────────────────────────────────────────

function todayKey(): string {
  return toDateKey(new Date());
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(dateKey: string): string {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

async function sendMessage(
  ctx: TaskContext,
  postContent: { zh_cn: { title: string; content: unknown } },
): Promise<void> {
  try {
    await ctx.rawClient.im.v1.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: ctx.ownerOpenId,
        msg_type: 'post',
        content: JSON.stringify(postContent),
      },
    });
    log.info('digest', 'send-ok', { title: postContent.zh_cn.title });
  } catch (err) {
    log.fail('digest', err, { step: 'send-message', title: postContent.zh_cn.title });
    throw err;
  }
}
