import { describe, expect, it } from 'vitest';
import {
  applyAccessCeiling,
  scenarioMaxAccess,
  type AccessMode,
} from '../../../src/config/permissions';

describe('scenarioMaxAccess (SR-1)', () => {
  it('does not restrict private chats', () => {
    expect(scenarioMaxAccess('p2p', true)).toBe('full');
    expect(scenarioMaxAccess('p2p', false)).toBe('full');
  });

  it('caps group owner at workspace', () => {
    expect(scenarioMaxAccess('group', true)).toBe('workspace');
  });

  it('caps group non-owner at read-only', () => {
    expect(scenarioMaxAccess('group', false)).toBe('read-only');
  });
});

describe('applyAccessCeiling (SR-1)', () => {
  it('lowers access that exceeds the ceiling', () => {
    expect(applyAccessCeiling('full', 'workspace')).toBe('workspace');
    expect(applyAccessCeiling('full', 'read-only')).toBe('read-only');
    expect(applyAccessCeiling('workspace', 'read-only')).toBe('read-only');
  });

  it('never raises access below the ceiling', () => {
    expect(applyAccessCeiling('read-only', 'full')).toBe('read-only');
    expect(applyAccessCeiling('workspace', 'full')).toBe('workspace');
    expect(applyAccessCeiling('read-only', 'workspace')).toBe('read-only');
  });

  it('is idempotent when access equals the ceiling', () => {
    const modes: AccessMode[] = ['read-only', 'workspace', 'full'];
    for (const m of modes) expect(applyAccessCeiling(m, m)).toBe(m);
  });
});
