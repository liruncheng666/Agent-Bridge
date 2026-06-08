import { getScheduleConfig } from '../config/schema';
import { readDayLogs } from './log-reader';
import { summarizeWithClaude } from './claude-summarizer';
import { formatDigestPost } from './format';
import { yesterdayKey, getDailyDigestAt, isDailyDigestEnabled } from '../bot/scheduler';
import type { ScheduledTask, TaskContext } from '../bot/scheduler';

const TASK_ID = 'daily-digest';

export function createDailyDigestTask(): ScheduledTask {
  return {
    id: TASK_ID,
    getDailyAt: getDailyDigestAt,
    isEnabled: isDailyDigestEnabled,
    handler: runDailyDigest,
  };
}

async function runDailyDigest(ctx: TaskContext): Promise<void> {
  const dateKey = yesterdayKey();
  const logData = await readDayLogs(ctx.logsDir, dateKey, ctx.ownerOpenId);

  if (!logData) {
    // No log file for yesterday — send a brief notice.
    await sendMessage(ctx, {
      zh_cn: {
        title: `【日报】${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)} · ${ctx.profile}`,
        content: [[{ tag: 'text', text: '昨日无运行日志。' }]],
      },
    });
    return;
  }

  const customPrompt = getScheduleConfig(ctx.cfg).dailyDigestPrompt;
  const summary = await summarizeWithClaude(logData, customPrompt);
  const post = formatDigestPost(logData, summary, ctx.profile);
  await sendMessage(ctx, post);
}

async function sendMessage(
  ctx: TaskContext,
  postContent: { zh_cn: { title: string; content: unknown } },
): Promise<void> {
  await ctx.rawClient.im.v1.message.create({
    params: { receive_id_type: 'open_id' },
    data: {
      receive_id: ctx.ownerOpenId,
      msg_type: 'post',
      content: JSON.stringify(postContent),
    },
  });
}
