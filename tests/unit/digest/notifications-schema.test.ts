import { describe, it, expect } from 'vitest';
import { getResolvedNotifications, DEFAULT_NOTIFICATION } from '../../../src/config/schema';
import type { AppConfig, ScheduleConfig } from '../../../src/config/schema';

function makeCfg(schedule: ScheduleConfig | undefined): AppConfig {
  return {
    accounts: { app: { id: 'app1', secret: 'secret', tenant: 'feishu' } },
    preferences: { schedule },
  };
}

describe('getResolvedNotifications', () => {
  it('returns default notification when no schedule configured', () => {
    const cfg = makeCfg(undefined);
    const notifications = getResolvedNotifications(cfg);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.id).toBe('daily-digest');
    expect(notifications[0]!.type).toBe('basic');
    expect(notifications[0]!.enabled).toBe(true);
  });

  it('uses notifications array when present', () => {
    const cfg = makeCfg({
      notifications: [
        { id: 'custom-1', name: '自定义', type: 'ai', at: '09:00', enabled: true },
      ],
    });
    const notifications = getResolvedNotifications(cfg);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.id).toBe('custom-1');
    expect(notifications[0]!.type).toBe('ai');
  });

  it('migrates legacy dailyDigestEnabled=false to disabled notification', () => {
    const cfg = makeCfg({ dailyDigestEnabled: false });
    const notifications = getResolvedNotifications(cfg);
    expect(notifications[0]!.enabled).toBe(false);
  });

  it('migrates legacy dailyDigestAt to notification at field', () => {
    const cfg = makeCfg({ dailyDigestAt: '09:30' });
    const notifications = getResolvedNotifications(cfg);
    expect(notifications[0]!.at).toBe('09:30');
  });

  it('migrates legacy dailyDigestPrompt to ai type notification', () => {
    const cfg = makeCfg({ dailyDigestPrompt: 'custom prompt {LOG_DATA}' });
    const notifications = getResolvedNotifications(cfg);
    expect(notifications[0]!.type).toBe('ai');
    expect(notifications[0]!.prompt).toBe('custom prompt {LOG_DATA}');
  });

  it('falls back to default when notifications array is empty', () => {
    const cfg = makeCfg({ notifications: [] });
    const notifications = getResolvedNotifications(cfg);
    expect(notifications[0]!.id).toBe(DEFAULT_NOTIFICATION.id);
  });
});
