import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestLogData } from './log-reader';

export interface SummaryResult {
  bugs: string[];
  userNeeds: string[];
  /**
   * Optional pending action items. Populated when the user's custom prompt
   * instructs Claude to output a `pendingItems` field. Not present in the
   * default prompt output — callers must handle undefined gracefully.
   */
  pendingItems?: string[];
  /** Set when Claude call failed — raw fallback text for display. */
  raw?: string;
}

const DEFAULT_PROMPT = `你是一个 bot 运行助手，负责根据昨日运行日志生成简明的每日摘要推送。

以下是昨天的日志摘要（JSON 格式）：

{LOG_DATA}

请完成以下两项任务：

1. bugs：列出昨日出现的异常或功能故障（来自 errors 字段）。忽略网络抖动、ws 重连等瞬态错误，只保留影响正常使用的问题。
2. userNeeds：从 ownerPreviews（bot owner 的对话消息）中提取明确的待办事项和行动项。只保留具体可执行的内容（如"需要做 X""记得处理 Y"），过滤掉普通对话和已完成事项。

严格按以下 JSON 格式输出，不要任何额外文字：
{"bugs":["..."],"userNeeds":["..."]}

如果没有相关内容则输出空数组。必须输出合法 JSON，不得输出其他任何内容。`;

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
      ...(parsed['pendingItems'] !== undefined
        ? { pendingItems: dedup(toStringArray(parsed['pendingItems'])) }
        : {}),
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
  const seen = new Set<string>();
  return arr.filter((s) => {
    const key = s.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Returns true when two strings share enough common words/characters to be considered duplicates. */
function similarText(a: string, b: string): boolean {
  const hasCJK = (s: string): boolean => /[一-鿿]/.test(s);

  if (hasCJK(a) || hasCJK(b)) {
    const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
    const na = normalize(a);
    const nb = normalize(b);
    if (na.length === 0 || nb.length === 0) return false;
    // Substring containment = obvious duplicate
    if (na.includes(nb) || nb.includes(na)) return true;
    // Character trigram Jaccard similarity
    const trigrams = (s: string): Set<string> => {
      const t = new Set<string>();
      for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3));
      return t;
    };
    const ta = trigrams(na);
    const tb = trigrams(nb);
    if (ta.size === 0 || tb.size === 0) return false;
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    return shared / Math.min(ta.size, tb.size) >= 0.5;
  }

  // Non-CJK: word-level overlap
  const wordsOf = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}
