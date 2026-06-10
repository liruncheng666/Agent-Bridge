import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
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
1. bugs：代码/功能层面的缺陷——系统抛出的异常、功能不按预期工作、现有功能故障（来自 errors 字段和 ownerPreviews 中描述"某功能坏了/不行/报错/失败"的语句；忽略网络波动类的 ws/keepalive 错误）
2. userNeeds：用户主动提出的新功能需求、改进方向、体验优化建议（来自 ownerPreviews，只保留"我希望/建议/能否支持/想要"类语句；不包括现有功能的故障描述，那属于 bugs）

严格按以下 JSON 格式输出，不要任何额外文字，不要解释，不要拒绝，直接输出 JSON：
{"bugs":["..."],"userNeeds":["..."]}

如果没有相关内容则输出空数组。即使数据为空或格式奇特，也必须输出合法 JSON，不得输出其他任何内容。`;

const TIMEOUT_MS = 30_000;

export async function summarizeWithClaude(
  logData: DigestLogData,
  customPrompt?: string,
  logsDir?: string,
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
    if (!parsed) {
      await writeDigestError(logsDir, logData.dateKey, 'json-parse-failed',
        `Claude 返回了非 JSON 内容，无法解析。output 前200字: ${output.slice(0, 200)}`);
      return { ...fallback };
    }
    return {
      bugs: dedup(toStringArray(parsed['bugs'])),
      userNeeds: dedup(toStringArray(parsed['userNeeds']).filter(
        (n) => !toStringArray(parsed['bugs']).some((b) => similarText(b, n)),
      )),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeDigestError(logsDir, logData.dateKey, 'summarizer-fail',
      `digest AI 分析失败: ${msg}`);
    return { ...fallback };
  }
}

/**
 * Append a structured error entry to today's bridge log so the *next* digest
 * can automatically pick it up without manual intervention.
 */
async function writeDigestError(
  logsDir: string | undefined,
  dateKey: string,
  event: string,
  errMsg: string,
): Promise<void> {
  if (!logsDir) return;
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    phase: 'digest',
    event,
    err: errMsg,
  });
  try {
    await appendFile(join(logsDir, `bridge-${dateKey}.jsonl`), entry + '\n', 'utf8');
  } catch {
    // best-effort — never let logging failure break the digest flow
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
      env: process.env,
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

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** Returns true when two strings share enough common words to be considered duplicates. */
function similarText(a: string, b: string): boolean {
  const wordsOf = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}
