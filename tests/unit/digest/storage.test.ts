import { describe, it, expect } from 'vitest';
import { postToMarkdown } from '../../../src/digest/local-store';
import type { PostContent } from '../../../src/digest/format';

describe('postToMarkdown', () => {
  it('renders title as H1', () => {
    const post: PostContent = {
      zh_cn: {
        title: '【日报】2026-06-10 · claude',
        content: [[{ tag: 'text', text: '运行统计' }]],
      },
    };
    const md = postToMarkdown(post);
    expect(md).toContain('# 【日报】2026-06-10 · claude');
  });

  it('renders content lines as plain text', () => {
    const post: PostContent = {
      zh_cn: {
        title: '日报',
        content: [
          [{ tag: 'text', text: '  · 活跃会话：4 个' }],
          [{ tag: 'text', text: '  · 消息总量：23 条' }],
        ],
      },
    };
    const md = postToMarkdown(post);
    expect(md).toContain('活跃会话：4 个');
    expect(md).toContain('消息总量：23 条');
  });

  it('ends with newline', () => {
    const post: PostContent = {
      zh_cn: { title: 'test', content: [[{ tag: 'text', text: 'body' }]] },
    };
    expect(postToMarkdown(post).endsWith('\n')).toBe(true);
  });
});

describe('extractDocToken', () => {
  // Test the token extraction logic inline (matches feishu-doc-writer.ts)
  function extractDocToken(input: string): string | null {
    if (!input.includes('/')) return input || null;
    const match = /\/(?:docx|doc|wiki)\/([A-Za-z0-9_-]+)/.exec(input);
    return match?.[1] ?? null;
  }

  it('extracts token from docx URL', () => {
    expect(extractDocToken('https://company.feishu.cn/docx/AbCdEfGh123')).toBe('AbCdEfGh123');
  });

  it('extracts token from doc URL', () => {
    expect(extractDocToken('https://company.feishu.cn/doc/AbCdEfGh123')).toBe('AbCdEfGh123');
  });

  it('returns bare token unchanged', () => {
    expect(extractDocToken('AbCdEfGh123')).toBe('AbCdEfGh123');
  });

  it('returns null for empty string', () => {
    expect(extractDocToken('')).toBeNull();
  });

  it('returns null for unrecognized URL pattern', () => {
    expect(extractDocToken('https://company.feishu.cn/unknown/token')).toBeNull();
  });
});
