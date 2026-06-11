import { appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { NotificationConfig } from '../config/schema';
import type { PostContent } from './format';
import { log } from '../core/logger';

/**
 * Convert a Feishu post content object to a Markdown string for local storage.
 */
export function postToMarkdown(post: PostContent): string {
  const { title, content } = post.zh_cn;
  const body = content
    .map((line) => line.map((seg) => seg.text).join(''))
    .join('\n');
  return `# ${title}\n\n${body}\n`;
}

/**
 * Append a notification's Markdown content to a local file.
 * File: <localStoragePath>/digest-<id>-YYYYMMDD.md
 * Directory is created if it does not exist.
 * Failures are logged but never thrown — never blocks the Feishu message.
 */
export async function saveToLocal(
  notification: NotificationConfig,
  post: PostContent,
  dateKey: string,
): Promise<void> {
  const dir = notification.localStoragePath;
  if (!dir) return;

  const filename = `digest-${notification.id}-${dateKey}.md`;
  const filePath = join(dir, filename);

  try {
    await mkdir(dirname(filePath), { recursive: true });
    const markdown = postToMarkdown(post);
    // Append so multiple triggers in a day accumulate rather than overwrite
    await appendFile(filePath, markdown, 'utf8');
    log.info('digest', 'local-store-ok', { notificationId: notification.id, filePath });
  } catch (err) {
    log.warn('digest', 'local-store-failed', {
      notificationId: notification.id,
      filePath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
