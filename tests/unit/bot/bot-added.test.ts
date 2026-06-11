import { describe, it, expect } from 'vitest';

/**
 * Unit tests for REQ-H bot-added auto-whitelist logic.
 *
 * The full handleBotAdded function is an internal async handler in channel.ts
 * that requires a live Lark channel. These tests cover the decision logic
 * independently — owner check, idempotency guard, and autoWelcome flag.
 */

// Replicate the core decision logic inline (matches channel.ts handleBotAdded)
function shouldAutoAllow(params: {
  operatorOpenId: string;
  ownerId: string | undefined;
  alreadyAllowed: boolean;
}): 'allow' | 'skip-non-owner' | 'skip-already-allowed' {
  if (!params.ownerId || params.operatorOpenId !== params.ownerId) {
    return 'skip-non-owner';
  }
  if (params.alreadyAllowed) {
    return 'skip-already-allowed';
  }
  return 'allow';
}

function shouldSendWelcome(autoWelcome: boolean | undefined): boolean {
  return autoWelcome !== false;
}

describe('REQ-H: bot-added auto-whitelist', () => {
  const OWNER_ID = 'ou_owner123';
  const OTHER_ID = 'ou_other456';
  const CHAT_ID = 'oc_chat789';

  describe('shouldAutoAllow', () => {
    it('allows when operator is owner and chat not yet in whitelist', () => {
      expect(shouldAutoAllow({
        operatorOpenId: OWNER_ID,
        ownerId: OWNER_ID,
        alreadyAllowed: false,
      })).toBe('allow');
    });

    it('skips when operator is not the owner', () => {
      expect(shouldAutoAllow({
        operatorOpenId: OTHER_ID,
        ownerId: OWNER_ID,
        alreadyAllowed: false,
      })).toBe('skip-non-owner');
    });

    it('skips when ownerId is not yet resolved (undefined)', () => {
      expect(shouldAutoAllow({
        operatorOpenId: OWNER_ID,
        ownerId: undefined,
        alreadyAllowed: false,
      })).toBe('skip-non-owner');
    });

    it('skips when chat is already in the whitelist (idempotent)', () => {
      expect(shouldAutoAllow({
        operatorOpenId: OWNER_ID,
        ownerId: OWNER_ID,
        alreadyAllowed: true,
      })).toBe('skip-already-allowed');
    });
  });

  describe('shouldSendWelcome', () => {
    it('sends welcome by default (undefined = not configured)', () => {
      expect(shouldSendWelcome(undefined)).toBe(true);
    });

    it('sends welcome when explicitly enabled', () => {
      expect(shouldSendWelcome(true)).toBe(true);
    });

    it('suppresses welcome when disabled', () => {
      expect(shouldSendWelcome(false)).toBe(false);
    });
  });
});
