import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';

const resolveModule = createRequire(import.meta.url).resolve;

interface PlaywrightTaskOptions extends SpawnOptions {
  allowedExitCodes?: number[];
  signal?: AbortSignal;
}

interface PlaywrightTaskResult {
  code: number | null;
  output: string;
}

/**
 * 使用当前 Node 进程启动本地 Playwright CLI。
 */
export function spawnPlaywrightCli(args: string[], options: SpawnOptions) {
  return spawn(process.execPath, [getPlaywrightCliPath(), ...args], {
    ...options,
    shell: false
  });
}

/**
 * 获取当前项目安装的 Playwright CLI 入口。
 */
export function getPlaywrightCliPath() {
  return resolveModule('@playwright/test/cli');
}

/**
 * 运行 Playwright CLI 并统一收集输出、错误和取消信号。
 */
export async function runPlaywrightTask(args: string[], options: PlaywrightTaskOptions): Promise<PlaywrightTaskResult> {
  const { allowedExitCodes = [0], signal, ...spawnOptions } = options;

  return new Promise<PlaywrightTaskResult>((resolve, reject) => {
    let output = '';
    const child = spawnPlaywrightCli(args, {
      ...spawnOptions,
      stdio: spawnOptions.stdio ?? ['ignore', 'pipe', 'pipe']
    });
    const abortTask = () => {
      terminatePlaywrightChild(child).catch(() => {});
      reject(new Error('Playwright 任务已取消'));
    };

    if (signal?.aborted) {
      abortTask();
      return;
    }

    signal?.addEventListener('abort', abortTask, { once: true });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      output += data.toString();
    });
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abortTask);
      reject(error);
    });
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', abortTask);

      if (allowedExitCodes.includes(code ?? -1)) {
        resolve({ code, output });
        return;
      }

      reject(new Error(output || `Playwright 进程退出：${code ?? '未知'}`));
    });
  });
}

/**
 * 尽量结束 Playwright 子进程，Windows 下优先清理进程树。
 */
export async function terminatePlaywrightChild(child: ChildProcess | undefined) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    // 运行和实测检查都可能拉起浏览器子进程树，Windows 下要连同后代一起收尾。
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore'
    });
    return;
  }

  child.kill('SIGTERM');
}
