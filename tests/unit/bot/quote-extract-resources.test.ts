import { describe, expect, it } from 'vitest';
import { extractResources } from '../../../src/bot/quote.js';
import type { ApiMessageItem } from '@larksuiteoapi/node-sdk';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeItem(
  msg_type: string,
  content: Record<string, unknown>,
  extra: Partial<ApiMessageItem> = {},
): ApiMessageItem {
  return {
    message_id: 'om_test',
    msg_type,
    body: { content: JSON.stringify(content) },
    ...extra,
  } as ApiMessageItem;
}

// ─── BUG-01: extractResources ────────────────────────────────────────────────

describe('extractResources (BUG-01 fix)', () => {
  it('extracts file resource from file message', () => {
    const item = makeItem('file', { file_key: 'fk_abc', file_name: 'report.pdf' });
    const resources = extractResources(item);

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ type: 'file', fileKey: 'fk_abc' });
  });

  it('extracts image resource from image message', () => {
    const item = makeItem('image', { image_key: 'img_xyz' });
    const resources = extractResources(item);

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ type: 'image', fileKey: 'img_xyz' });
  });

  it('returns empty array for text message', () => {
    const item = makeItem('text', { text: 'hello' });
    expect(extractResources(item)).toEqual([]);
  });

  it('returns empty array when body content is absent', () => {
    const item = { message_id: 'om_1', msg_type: 'file' } as ApiMessageItem;
    expect(extractResources(item)).toEqual([]);
  });

  it('returns empty array when file_key is missing from file message', () => {
    const item = makeItem('file', { file_name: 'only_name.pdf' });
    expect(extractResources(item)).toEqual([]);
  });

  it('returns empty array when image_key is missing from image message', () => {
    const item = makeItem('image', { width: 100 });
    expect(extractResources(item)).toEqual([]);
  });

  it('returns empty array for non-parseable body content', () => {
    const item = {
      message_id: 'om_2',
      msg_type: 'file',
      body: { content: 'not json' },
    } as ApiMessageItem;
    expect(extractResources(item)).toEqual([]);
  });

  it('returns empty array for interactive/post message types', () => {
    expect(extractResources(makeItem('interactive', { card: {} }))).toEqual([]);
    expect(extractResources(makeItem('post', { title: 'hello' }))).toEqual([]);
  });
});
