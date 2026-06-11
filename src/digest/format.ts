import type { DigestLogData } from './log-reader';
import type { SummaryResult } from './claude-summarizer';

/** Feishu post message content shape (zh_cn). */
export interface PostContent {
  zh_cn: {
    title: string;
    content: Array<Array<{ tag: string; text: string }>>;
  };
}

export function formatDigestPost(
  logData: DigestLogData,
  summary: SummaryResult,
  profile: string,
): PostContent {
  const title = `【日报】${logData.date} · ${profile}`;
  const lines: Array<Array<{ tag: string; text: string }>> = [];

  const text = (t: string) => [{ tag: 'text', text: t }];

  // ── 产品 Bug ──
  if (summary.bugs.length > 0) {
    lines.push(text(`产品 Bug（${summary.bugs.length} 条）`));
    for (const bug of summary.bugs) {
      lines.push(text(`  · ${bug}`));
    }
  }

  // ── 用户需求 / 反馈 ──
  if (summary.userNeeds.length > 0) {
    if (lines.length > 0) lines.push(text(''));
    lines.push(text(`用户需求 / 反馈（${summary.userNeeds.length} 条）`));
    for (const need of summary.userNeeds) {
      lines.push(text(`  · ${need}`));
    }
  }

  // ── 待办清单（可选扩展字段，由自定义 prompt 输出） ──
  if (summary.pendingItems && summary.pendingItems.length > 0) {
    if (lines.length > 0) lines.push(text(''));
    lines.push(text(`📋 待办清单（${summary.pendingItems.length} 项）`));
    for (const item of summary.pendingItems) {
      lines.push(text(`  · ${item}`));
    }
  }

  // ── Fallback notice ──
  if (summary.raw) {
    if (lines.length > 0) lines.push(text(''));
    lines.push(text(`⚠️ ${summary.raw}`));
  }

  // ── 无内容 ──
  if (summary.bugs.length === 0 && summary.userNeeds.length === 0 && !summary.raw) {
    lines.push(text('昨日无错误，无用户需求记录。'));
  }

  // ── 统计 ──
  lines.push(text(''));
  lines.push(
    text(
      `统计  活跃会话 ${logData.activeScopes} 个 · 消息 ${logData.totalMessages} 条 · 命令 ${logData.commandCount} 次`,
    ),
  );

  return {
    zh_cn: {
      title,
      content: lines,
    },
  };
}

/**
 * Basic notification format: pure statistics, no AI analysis required.
 * Used when notification.type === 'basic'.
 */
export function formatBasicPost(logData: DigestLogData, profile: string): PostContent {
  const title = `【日报】${logData.date} · ${profile}`;
  const text = (t: string) => [{ tag: 'text', text: t }];

  const errorCount = logData.errors.length;
  const lines = [
    text('运行统计'),
    text(`  · 活跃会话：${logData.activeScopes} 个`),
    text(`  · 消息总量：${logData.totalMessages} 条`),
    text(`  · 命令次数：${logData.commandCount} 次`),
    text(`  · 错误数量：${errorCount} 条`),
  ];

  if (errorCount > 0) {
    lines.push(text(''));
    lines.push(text(`错误摘要（最近 ${Math.min(errorCount, 5)} 条）`));
    for (const err of logData.errors.slice(0, 5)) {
      lines.push(text(`  · [${err.phase}] ${err.err.slice(0, 80)}`));
    }
  }

  return { zh_cn: { title, content: lines } };
}
