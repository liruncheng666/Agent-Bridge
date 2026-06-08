import { spawn } from 'node:child_process';
import type { DigestLogData } from './log-reader';

export interface SummaryResult {
  bugs: string[];
  userNeeds: string[];
  /** Set when Claude call failed — raw fallback text for display. */
  raw?: string;
}

const DEFAULT_PROMPT = `你是一个产品助手，负责分析 agent-bridge 产品的运行日志，生成每日简报。

以下是昨天的日志摘要（JSON 格式）：

{LOG_DATA}

请从中提取两类信息：
1. bugs：产品自身的错误或异常（来自 errors 字段，忽略网络波动类的 ws/keepalive 错误）
2. userNeeds：owner 反馈的产品体验问题、诉求或改进建议（来自 ownerPreviews，忽略普通对话和命令，只保留表达问题/需求/槽点的语句）

严格按以下 JSON 格式输出，不要任何额外文字：
{"bugs":["..."],"userNeeds":["..."]}

如果没有相关内容则输出空数组。`;

const TIMEOUT_MS = 30_000;

export async function summarizeWithClaude(
  logData: DigestLogData,
  customPrompt?: string,
): Promise<SummaryResult> {
  const promptTemplate = customPrompt ?? DEFAULT_PROMPT;
  const prompt = promptTemplate.replace(
    '{LOG_DATA}',
    JSON.stringify(
      {
        date: logData.date,
        errors: logData.errors.slice(0, 20),
        ownerPreviews: logData.ownerPreviews.slice(0, 30),
      },
      null,
      2,
    ),
  );

  const fallback = makeFallback(logData);

  try {
    const output = await spawnClaude(prompt);
    const parsed = extractJson(output);
    if (!parsed) return { ...fallback };
    return {
      bugs: toStringArray(parsed['bugs']),
      userNeeds: toStringArray(parsed['userNeeds']),
    };
  } catch {
    return { ...fallback };
  }
}

function makeFallback(logData: DigestLogData): SummaryResult {
  return {
    bugs: logData.errors.map((e) => `[${e.phase}] ${e.err}`.slice(0, 120)),
    userNeeds: [],
    raw: `Claude 分析失败，原始数据：${logData.errors.length} 个错误，${logData.ownerPreviews.length} 条 owner 消息`,
  };
}

async function spawnClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['--print', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude summarizer timeout'));
    }, TIMEOUT_MS);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve(stdout);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractJson(text: string): Record<string, unknown> | null {
  // Claude sometimes wraps output in markdown code fences — strip them.
  const cleaned = text.replace(/```(?:json)?\n?/g, '').trim();
  // Find the first {...} block.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string') as string[];
}
