import { describe, expect, it, vi } from 'vitest';
import { ResourceStash } from '../../../src/bot/channel.js';
import type { ResourceRequest } from '../../../src/media/cache.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeItems(count: number, prefix = 'msg'): ResourceRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    messageId: `${prefix}-${i}`,
    resource: { type: 'file' as const, fileKey: `fk-${prefix}-${i}` },
  }));
}

// ─── BUG-02: ResourceStash ──────────────────────────────────────────────────

describe('ResourceStash (BUG-02 fix)', () => {
  it('stores and returns items for a scope', () => {
    const stash = new ResourceStash(60_000);
    const items = makeItems(2, 'scope1');

    stash.put('scope1', items);
    const consumed = stash.consume('scope1');

    expect(consumed).toHaveLength(2);
    expect(consumed[0]?.messageId).toBe('scope1-0');
    expect(consumed[1]?.messageId).toBe('scope1-1');
  });

  it('merges multiple puts into the same scope', () => {
    const stash = new ResourceStash(60_000);

    stash.put('scope1', makeItems(1, 'a'));
    stash.put('scope1', makeItems(2, 'b'));
    const consumed = stash.consume('scope1');

    expect(consumed).toHaveLength(3);
  });

  it('consume removes the entry so a second consume returns empty', () => {
    const stash = new ResourceStash(60_000);
    stash.put('scope1', makeItems(1));

    stash.consume('scope1');
    const second = stash.consume('scope1');

    expect(second).toEqual([]);
  });

  it('returns empty when scope has no entry', () => {
    const stash = new ResourceStash(60_000);
    expect(stash.consume('unknown')).toEqual([]);
  });

  it('scopes are independent — consume one does not affect others', () => {
    const stash = new ResourceStash(60_000);
    stash.put('scope-a', makeItems(1, 'a'));
    stash.put('scope-b', makeItems(2, 'b'));

    stash.consume('scope-a');

    expect(stash.consume('scope-b')).toHaveLength(2);
  });

  it('returns empty when TTL has expired', () => {
    const stash = new ResourceStash(1); // 1ms TTL
    stash.put('scope1', makeItems(1));

    // Advance time by mocking Date.now()
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 1000);

    try {
      const consumed = stash.consume('scope1');
      expect(consumed).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('returns items when TTL has not yet expired', () => {
    const stash = new ResourceStash(10_000);
    stash.put('scope1', makeItems(1));

    // Advance time but still within TTL
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 5_000);

    try {
      const consumed = stash.consume('scope1');
      expect(consumed).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('size() reflects current number of scopes with stashed items', () => {
    const stash = new ResourceStash(60_000);
    expect(stash.size()).toBe(0);

    stash.put('scope-a', makeItems(1));
    stash.put('scope-b', makeItems(1));
    expect(stash.size()).toBe(2);

    stash.consume('scope-a');
    expect(stash.size()).toBe(1);
  });
});
