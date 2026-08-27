import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface OpenCodeJsonlEvent {
  type: string;
  timestamp?: number;
  sessionID?: string;
  text?: string;
  error?: { message?: string } | string;
  [key: string]: unknown;
}

export interface OpenCodeProcessResult {
  exitCode: number | null;
  sessionId?: string;
  events: OpenCodeJsonlEvent[];
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface RunOpenCodeProcessInput {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  stdoutPath: string;
  stderrPath: string;
  signal?: AbortSignal;
  timeoutMs: number;
  spawn?: SpawnFn;
}

/**
 * 以隔离子进程运行 OpenCode，解析 JSONL，并在取消/超时后清理进程树。
 */
export async function runOpenCodeProcess(input: RunOpenCodeProcessInput): Promise<OpenCodeProcessResult> {
  await mkdir(dirname(input.stdoutPath), { recursive: true });
  await mkdir(dirname(input.stderrPath), { recursive: true });

  if (input.signal?.aborted) {
    return emptyResult({ cancelled: true });
  }

  const spawnFn = input.spawn ?? spawn;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const events: OpenCodeJsonlEvent[] = [];
  let sessionId: string | undefined;
  let timedOut = false;
  let cancelled = false;

  const child = spawnFn(input.bin, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  });

  const pid = child.pid;

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    void appendFile(input.stdoutPath, chunk).catch(() => undefined);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    void appendFile(input.stderrPath, chunk).catch(() => undefined);
  });

  if (child.stdin) {
    child.stdin.end(input.stdin);
  }

  const abort = async (kind: 'timeout' | 'cancelled') => {
    if (kind === 'timeout') {
      timedOut = true;
    } else {
      cancelled = true;
    }

    if (pid) {
      await killProcessTree(pid);
    }
  };

  const timer = setTimeout(() => {
    void abort('timeout');
  }, input.timeoutMs);

  const onAbort = () => {
    void abort('cancelled');
  };

  input.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const exitCode = await waitForExit(child);
    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    const parsed = parseOpenCodeJsonl(stdout);
    events.push(...parsed.events);
    sessionId = parsed.sessionId;

    await writeFile(input.stdoutPath, stdout);
    await writeFile(input.stderrPath, stderr);

    return {
      exitCode,
      sessionId,
      events,
      stdout,
      stderr,
      timedOut,
      cancelled
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);

    if (pid && child.exitCode === null && !child.killed) {
      await killProcessTree(pid);
    }
  }
}

/**
 * 解析 OpenCode `--format json` 的逐行事件，并记下首个 sessionID。
 */
export function parseOpenCodeJsonl(stdout: string) {
  const events: OpenCodeJsonlEvent[] = [];
  let sessionId: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith('{')) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as OpenCodeJsonlEvent;

      if (!event || typeof event.type !== 'string') {
        continue;
      }

      events.push(event);

      if (!sessionId && typeof event.sessionID === 'string' && event.sessionID) {
        sessionId = event.sessionID;
      }
    } catch {
      continue;
    }
  }

  return { events, sessionId };
}

/**
 * 从 JSONL 文本事件中提取最终 JSON 候选。
 */
export function extractCandidateJson(events: OpenCodeJsonlEvent[]): unknown {
  const texts = events
    .filter((event) => event.type === 'text')
    .map((event) => readEventText(event))
    .filter(Boolean);

  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const candidate = parseJsonPayload(texts[index] ?? '');

    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * 读取 JSONL 错误事件说明。
 */
export function readJsonlError(events: OpenCodeJsonlEvent[]) {
  const event = [...events].reverse().find((item) => item.type === 'error');

  if (!event) {
    return '';
  }

  if (typeof event.error === 'string') {
    return event.error;
  }

  if (event.error && typeof event.error === 'object' && 'message' in event.error) {
    return String(event.error.message ?? '');
  }

  return readEventText(event);
}

/**
 * 终止 OpenCode 及其 MCP / 浏览器子进程，不能只杀父进程。
 */
export async function killProcessTree(pid: number) {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程可能已经退出。
    }
  }
}

/**
 * 等待子进程退出，忽略已关闭的 stdin。
 */
function waitForExit(child: ChildProcess) {
  return new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
}

/**
 * 读取 text 事件中的正文，兼容不同字段布局。
 */
function readEventText(event: OpenCodeJsonlEvent) {
  if (typeof event.text === 'string') {
    return event.text;
  }

  const part = event.part;

  if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
    return part.text;
  }

  return '';
}

/**
 * 从模型输出中取出 JSON 对象，允许包在 Markdown 代码块里。
 */
function parseJsonPayload(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = (fenced?.[1] ?? text).trim();
  const start = payload.indexOf('{');
  const end = payload.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return undefined;
  }

  try {
    return JSON.parse(payload.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * 构造未启动进程时的空结果。
 */
function emptyResult(flags: { cancelled?: boolean; timedOut?: boolean }): OpenCodeProcessResult {
  return {
    exitCode: null,
    events: [],
    stdout: '',
    stderr: '',
    timedOut: Boolean(flags.timedOut),
    cancelled: Boolean(flags.cancelled)
  };
}
