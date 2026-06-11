import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getResolvedNotifications } from '../config/schema';
import type { NotificationConfig } from '../config/schema';
import { readDayLogs } from './log-reader';
import { summarizeWithClaude } from './claude-summarizer';
import { formatDigestPost, formatBasicPost } from './format';
import { saveToLocal } from './local-store';
import { appendToFeishuDoc } from './feishu-doc-writer';
import { yesterdayKey, getDailyDigestAt, isDailyDigestEnabled } from '../bot/scheduler';
import type { ScheduledTask, TaskContext } from '../bot/scheduler';
import { log } from '../core/logger';

/** Max days to look back for catch-up digests on startup. */
const CATCHUP_MAX_DAYS = 3;

/**
 * Sent-record file. Now stores a map of notificationId → dateKey[].
 * Legacy format (plain string array) is auto-migrated on first read.
 */
const SENT_RECORD_FILE = 'digest-sent.json';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create one ScheduledTask per notification in the config.
 * Replaces the old createDailyDigestTask() single-task factory.
 */
export function createNotificationTasks(notifications: NotificationConfig[]): ScheduledTask[] {
  return notifications.map((n) => createTaskForNotification(n));
}

/** Legacy single-task factory kept for call-sites not yet migrated. */
export function createDailyDigestTask(): ScheduledTask {
  return createTaskForNotification({
    id: 'daily-digest',
    name: '每日运行日报',
    type: 'basic',
    at: '08:00',
    enabled: true,
  });
}

/**
 * Called once on bridge startup (after ownerOpenId is resolved).
 * Checks the last CATCHUP_MAX_DAYS days for each notification and sends missed ones.
 */
export async function catchUpMissedDigests(ctx: TaskContext): Promise<void> {
  if (!ctx.ownerOpenId) {
    log.warn('digest', 'catchup-skip-no-owner');
    return;
  }

  const notifications = getResolvedNotifications(ctx.cfg);
  // Only catch up enabled notifications
  const enabled = notifications.filter((n) => n.enabled !== false);
  if (enabled.length === 0) return;

  const sentMap = await loadSentMap(ctx.logsDir);

  const toCheck: string[] = [];
  for (let i = 1; i <= CATCHUP_MAX_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    toCheck.push(toDateKey(d));
  }

  for (const notification of enabled) {
    const sent = sentMap.get(notification.id) ?? new Set<string>();
    for (const dateKey of toCheck) {
      if (sent.has(dateKey)) continue;

      const logData = await readDayLogs(ctx.logsDir, dateKey, ctx.ownerOpenId);
      if (!logData) continue;

      log.info('digest', 'catchup-send', { notificationId: notification.id, dateKey });
      try {
        await runNotificationForDate(ctx, notification, dateKey, logData);
        sent.add(dateKey);
        sentMap.set(notification.id, sent);
        await saveSentMap(ctx.logsDir, sentMap);
      } catch (err) {
        log.fail('digest', err, { step: 'catchup', notificationId: notification.id, dateKey });
      }
    }
  }
}

// ── Task factory ───────────────────────────────────────────────────────────

function createTaskForNotification(notification: NotificationConfig): ScheduledTask {
  return {
    id: notification.id,
    getDailyAt: (cfg) => {
      // Re-read from config so runtime edits via /config take effect without restart
      const resolved = getResolvedNotifications(cfg);
      const n = resolved.find((x) => x.id === notification.id);
      const at = n?.at ?? notification.at;
      return (at && isValidHHMM(at)) ? at : '08:00';
    },
    isEnabled: (cfg) => {
      const resolved = getResolvedNotifications(cfg);
      const n = resolved.find((x) => x.id === notification.id);
      return (n?.enabled ?? notification.enabled) !== false;
    },
    handler: (ctx) => runScheduledNotification(ctx, notification.id),
  };
}

async function runScheduledNotification(ctx: TaskContext, notificationId: string): Promise<void> {
  const notifications = getResolvedNotifications(ctx.cfg);
  const notification = notifications.find((n) => n.id === notificationId);
  if (!notification) return;

  const dateKey = yesterdayKey();
  const sentMap = await loadSentMap(ctx.logsDir);
  const sent = sentMap.get(notificationId) ?? new Set<string>();

  if (sent.has(dateKey)) {
    log.info('digest', 'skip-already-sent', { notificationId, dateKey });
    return;
  }

  const logData = await readDayLogs(ctx.logsDir, dateKey, ctx.ownerOpenId);

  if (!logData) {
    // No log data — send a minimal notice. No local/doc storage for empty reports.
    await sendRawMessage(ctx, {
      zh_cn: {
        title: `【日报】${fmtDate(dateKey)} · ${ctx.profile}`,
        content: [[{ tag: 'text', text: '昨日无运行日志。' }]],
      },
    });
    sent.add(dateKey);
    sentMap.set(notificationId, sent);
    await saveSentMap(ctx.logsDir, sentMap);
    return;
  }

  await runNotificationForDate(ctx, notification, dateKey, logData);
  sent.add(dateKey);
  sentMap.set(notificationId, sent);
  await saveSentMap(ctx.logsDir, sentMap);
}

async function runNotificationForDate(
  ctx: TaskContext,
  notification: NotificationConfig,
  dateKey: string,
  logData: Awaited<ReturnType<typeof readDayLogs>> & object,
): Promise<void> {
  const yesterday = yesterdayKey();
  const isCatchup = dateKey !== yesterday;

  let post: { zh_cn: { title: string; content: unknown } };

  if (notification.type === 'ai') {
    const summary = await summarizeWithClaude(logData, notification.prompt, ctx.logsDir);
    post = formatDigestPost(logData, summary, ctx.profile);
  } else {
    post = formatBasicPost(logData, ctx.profile);
  }

  if (isCatchup) {
    post.zh_cn.title = `【补发日报】${fmtDate(dateKey)} · ${ctx.profile}`;
  }

  await sendAndStore(ctx, notification, post, dateKey);
}

// ── Sent-record helpers (multi-notification) ───────────────────────────────

type SentMap = Map<string, Set<string>>;

async function loadSentMap(logsDir: string): Promise<SentMap> {
  try {
    const raw = await readFile(join(logsDir, SENT_RECORD_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    // Legacy format: plain string array → migrate to map under 'daily-digest'
    if (Array.isArray(parsed)) {
      const map = new Map<string, Set<string>>();
      map.set('daily-digest', new Set(parsed as string[]));
      return map;
    }

    // New format: Record<string, string[]>
    if (parsed && typeof parsed === 'object') {
      const map = new Map<string, Set<string>>();
      for (const [id, dates] of Object.entries(parsed as Record<string, string[]>)) {
        if (Array.isArray(dates)) {
          map.set(id, new Set(dates));
        }
      }
      return map;
    }
  } catch {
    // File missing or corrupt — start fresh
  }
  return new Map();
}

async function saveSentMap(logsDir: string, map: SentMap): Promise<void> {
  const obj: Record<string, string[]> = {};
  for (const [id, dates] of map.entries()) {
    // Keep only the last 30 days per notification to prevent unbounded growth
    obj[id] = [...dates].sort().slice(-30);
  }
  await writeFile(join(logsDir, SENT_RECORD_FILE), JSON.stringify(obj), 'utf8');
}

// ── Date helpers ───────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(dateKey: string): string {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

function isValidHHMM(s: string | undefined): boolean {
  if (!s) return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// ── Message sending + storage ──────────────────────────────────────────────

async function sendAndStore(
  ctx: TaskContext,
  notification: NotificationConfig,
  postContent: { zh_cn: { title: string; content: unknown } },
  dateKey: string,
): Promise<void> {
  // 1. Send Feishu message (primary, must succeed)
  await sendRawMessage(ctx, postContent);

  // 2. Local storage (best-effort, non-blocking)
  if (notification.localStoragePath) {
    await saveToLocal(notification, postContent as import('./format').PostContent, dateKey);
  }

  // 3. Feishu doc storage (best-effort, non-blocking)
  if (notification.feishuDocUrl) {
    await appendToFeishuDoc(
      notification,
      postContent as import('./format').PostContent,
      dateKey,
      ctx.rawClient,
      ctx.ownerOpenId,
    );
  }
}

/** Send a Feishu post message to the bot owner. Throws on failure. */
async function sendRawMessage(
  ctx: TaskContext,
  postContent: { zh_cn: { title: string; content: unknown } },
): Promise<void> {
  try {
    const resp = await ctx.rawClient.im.v1.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: ctx.ownerOpenId,
        msg_type: 'post',
        content: JSON.stringify(postContent),
      },
    });
    const respCode = (resp as { code?: number } | undefined)?.code;
    if (respCode != null && respCode !== 0) {
      const respMsg = (resp as { msg?: string } | undefined)?.msg ?? '';
      throw new Error(`Feishu API error ${respCode}: ${respMsg}`);
    }
    log.info('digest', 'send-ok', { title: postContent.zh_cn.title });
  } catch (err) {
    log.fail('digest', err, { step: 'send-message', title: postContent.zh_cn.title });
    throw err;
  }
}
