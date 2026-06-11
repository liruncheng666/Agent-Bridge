import { describe, it, expect } from 'vitest';
import { formatBasicPost, formatDigestPost } from '../../../src/digest/format';
import type { DigestLogData } from '../../../src/digest/log-reader';
import type { SummaryResult } from '../../../src/digest/claude-summarizer';

const baseLogData: DigestLogData = {
  date: '2026-06-10',
  dateKey: '20260610',
  totalMessages: 23,
  activeScopes: 4,
  ownerPreviews: [],
  errors: [],
  commandCount: 8,
};

describe('formatBasicPost', () => {
  it('renders title with date and profile', () => {
    const post = formatBasicPost(baseLogData, 'claude');
    expect(post.zh_cn.title).toBe('【日报】2026-06-10 · claude');
  });

  it('renders statistics lines', () => {
    const post = formatBasicPost(baseLogData, 'claude');
    const text = post.zh_cn.content.flat().map((s) => s.text).join('\n');
    expect(text).toContain('活跃会话：4 个');
    expect(text).toContain('消息总量：23 条');
    expect(text).toContain('命令次数：8 次');
    expect(text).toContain('错误数量：0 条');
  });

  it('includes error summary when errors exist', () => {
    const logData: DigestLogData = {
      ...baseLogData,
      errors: [{ ts: '2026-06-10T10:00:00Z', phase: 'run', event: 'failed', err: 'something broke' }],
    };
    const post = formatBasicPost(logData, 'claude');
    const text = post.zh_cn.content.flat().map((s) => s.text).join('\n');
    expect(text).toContain('错误摘要');
    expect(text).toContain('something broke');
  });
});

describe('formatDigestPost', () => {
  it('renders pendingItems section when present', () => {
    const summary: SummaryResult = {
      bugs: ['bug A'],
      userNeeds: ['need B'],
      pendingItems: ['fix login', 'add export'],
    };
    const post = formatDigestPost(baseLogData, summary, 'claude');
    const text = post.zh_cn.content.flat().map((s) => s.text).join('\n');
    expect(text).toContain('📋 待办清单');
    expect(text).toContain('fix login');
    expect(text).toContain('add export');
  });

  it('omits pendingItems section when not present', () => {
    const summary: SummaryResult = { bugs: [], userNeeds: [] };
    const post = formatDigestPost(baseLogData, summary, 'claude');
    const text = post.zh_cn.content.flat().map((s) => s.text).join('\n');
    expect(text).not.toContain('📋 待办清单');
  });

  it('omits pendingItems section when array is empty', () => {
    const summary: SummaryResult = { bugs: [], userNeeds: [], pendingItems: [] };
    const post = formatDigestPost(baseLogData, summary, 'claude');
    const text = post.zh_cn.content.flat().map((s) => s.text).join('\n');
    expect(text).not.toContain('📋 待办清单');
  });
});
