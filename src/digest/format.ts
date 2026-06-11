import type { DigestLogData } from './log-reader';
import type { SummaryResult } from './claude-summarizer';

/** Feishu post message content shape (zh_cn). */
export interface PostContent {
  zh_cn: {
    title: string;
    content: Array<Array<{ tag: string; text: string }>>;
  };
}

/** Feishu interactive card shape for digest messages. */
export interface DigestCard {
  schema: '2.0';
  config: { summary: { content: string } };
  body: { elements: object[] };
}

/** Build a single text row for post messages. */
const row = (t: string): Array<{ tag: string; text: string }> => [{ tag: 'text', text: t }];

/**
 * Convert a PostContent to a Feishu interactive card.
 * Cards support markdown bold/italic/color, hr, and collapsible panels —
 * post messages only support plain text, making digest output unreadable.
 */
export function toDigestCard(post: PostContent): DigestCard {
  const { title, content } = post.zh_cn;
  const elements: object[] = [
    { tag: 'markdown', content: `**${title}**` },
    { tag: 'hr' },
  ];

  for (const line of content) {
    const text = line.map((seg) => seg.text).join('');
    if (!text.trim()) continue;

    // Section headers (lines starting with emoji + space)
    if (/^[📊🐛💡📋⚠️✅]/.test(text.trim())) {
      elements.push({ tag: 'markdown', content: `**${text.trim()}**` });
    } else {
      // Bullet items — indent and display as plain markdown
      elements.push({ tag: 'markdown', content: text });
    }
  }

  return {
    schema: '2.0',
    config: { summary: { content: title } },
    body: { elements },
  };
}

export function formatDigestPost(
  logData: DigestLogData,
  summary: SummaryResult,
  profile: string,
): PostContent {
  const title = `【AI 日报】${logData.date} · ${profile}`;
  const lines: Array<Array<{ tag: string; text: string }>> = [];

  // ── 运行概览 ──
  lines.push(row(`📊 运行概览`));
  lines.push(row(`  · 活跃会话：${logData.activeScopes} 个`));
  lines.push(row(`  · 消息总量：${logData.totalMessages} 条`));
  lines.push(row(`  · 命令次数：${logData.commandCount} 次`));
  lines.push(row(`  · 错误数量：${logData.errors.length} 条`));

  // ── 产品 Bug ──
  if (summary.bugs.length > 0) {
    lines.push(row(''));
    lines.push(row(`🐛 产品问题（${summary.bugs.length} 条）`));
    for (const bug of summary.bugs) {
      lines.push(row(`  · ${bug}`));
    }
  }

  // ── 用户需求 / 反馈 ──
  if (summary.userNeeds.length > 0) {
    lines.push(row(''));
    lines.push(row(`💡 用户需求 / 待办（${summary.userNeeds.length} 条）`));
    for (const need of summary.userNeeds) {
      lines.push(row(`  · ${need}`));
    }
  }

  // ── 待办清单（自定义 prompt 扩展字段） ──
  if (summary.pendingItems && summary.pendingItems.length > 0) {
    lines.push(row(''));
    lines.push(row(`📋 待办清单（${summary.pendingItems.length} 项）`));
    for (const item of summary.pendingItems) {
      lines.push(row(`  · ${item}`));
    }
  }

  // ── Fallback ──
  if (summary.raw) {
    lines.push(row(''));
    lines.push(row(`⚠️ ${summary.raw}`));
  }

  if (
    summary.bugs.length === 0 &&
    summary.userNeeds.length === 0 &&
    !(summary.pendingItems && summary.pendingItems.length > 0) &&
    !summary.raw
  ) {
    lines.push(row(''));
    lines.push(row(`✅ 昨日运行正常，无异常记录。`));
  }

  return { zh_cn: { title, content: lines } };
}

/**
 * Basic notification format: pure statistics, no AI analysis.
 * Used when notification.type === 'basic'.
 */
export function formatBasicPost(logData: DigestLogData, profile: string): PostContent {
  const title = `【日报】${logData.date} · ${profile}`;
  const errorCount = logData.errors.length;

  const lines: Array<Array<{ tag: string; text: string }>> = [
    row(`📊 运行概览`),
    row(`  · 活跃会话：${logData.activeScopes} 个`),
    row(`  · 消息总量：${logData.totalMessages} 条`),
    row(`  · 命令次数：${logData.commandCount} 次`),
    row(`  · 错误数量：${errorCount} 条`),
  ];

  if (errorCount > 0) {
    lines.push(row(''));
    lines.push(row(`🐛 错误摘要（最近 ${Math.min(errorCount, 5)} 条）`));
    for (const err of logData.errors.slice(0, 5)) {
      lines.push(row(`  · [${err.phase}] ${err.err.slice(0, 80)}`));
    }
  } else {
    lines.push(row(''));
    lines.push(row(`✅ 昨日运行正常，无错误记录。`));
  }

  return { zh_cn: { title, content: lines } };
}
