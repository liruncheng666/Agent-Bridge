import { log } from '../core/logger';
import type { AppConfig } from '../config/schema';
import { getScheduleConfig } from '../config/schema';

export interface ScheduledTask {
  id: string;
  /**
   * Local "HH:MM" (24-hour) at which this task fires once per day.
   * Read fresh from config on every tick so `/digest at` takes effect without restart.
   */
  getDailyAt: (cfg: AppConfig) => string;
  isEnabled: (cfg: AppConfig) => boolean;
  /** In-memory guard: set to today's YYYYMMDD string after a successful fire. */
  lastFiredDate?: string;
  handler: (ctx: TaskContext) => Promise<void>;
}

export interface TaskContext {
  rawClient: import('@larksuiteoapi/node-sdk').Client;
  ownerOpenId: string;
  logsDir: string;
  profile: string;
  cfg: AppConfig;
}

export interface SchedulerDeps {
  tasks: ScheduledTask[];
  /** Returns undefined when ownerOpenId is not yet resolved (pre-startup). */
  getContext: () => TaskContext | undefined;
}

export interface SchedulerHandle {
  stop(): void;
  /** Immediately invoke a task by id, bypassing schedule and lastFiredDate.
   *  Returns 'ok' | 'no-context' | 'not-found'. */
  triggerNow(taskId: string): Promise<'ok' | 'no-context' | 'not-found'>;
}

const TICK_INTERVAL_MS = 60_000;

export function startScheduler(deps: SchedulerDeps): SchedulerHandle {
  const { tasks, getContext } = deps;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateKey = toDateKey(now);

    for (const task of tasks) {
      const ctx = getContext();
      if (!ctx) continue;
      if (!task.isEnabled(ctx.cfg)) continue;
      if (task.getDailyAt(ctx.cfg) !== hhmm) continue;
      if (task.lastFiredDate === dateKey) continue;

      task.lastFiredDate = dateKey;
      log.info('scheduler', 'fire', { taskId: task.id, at: hhmm });
      try {
        await task.handler(ctx);
      } catch (err) {
        log.fail('scheduler', err, { taskId: task.id });
      }
    }
  };

  const timer = setInterval(() => {
    void tick().catch((err) => log.fail('scheduler', err, { step: 'tick' }));
  }, TICK_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    async triggerNow(taskId: string): Promise<'ok' | 'no-context' | 'not-found'> {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return 'not-found';
      const ctx = getContext();
      if (!ctx) return 'no-context';
      log.info('scheduler', 'trigger-now', { taskId });
      try {
        await task.handler(ctx);
      } catch (err) {
        log.fail('scheduler', err, { taskId, step: 'trigger-now' });
      }
      return 'ok';
    },
  };
}

/** Returns "YYYYMMDD" for a given Date in local time. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns yesterday's date key ("YYYYMMDD") in local time. */
export function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateKey(d);
}

/** Returns today's date key ("YYYYMMDD") in local time. */
export function todayKey(): string {
  return toDateKey(new Date());
}

/** Helper: read dailyDigestAt from config via getScheduleConfig. */
export function getDailyDigestAt(cfg: AppConfig): string {
  return getScheduleConfig(cfg).dailyDigestAt;
}

/** Helper: read dailyDigestEnabled from config via getScheduleConfig. */
export function isDailyDigestEnabled(cfg: AppConfig): boolean {
  return getScheduleConfig(cfg).dailyDigestEnabled;
}
