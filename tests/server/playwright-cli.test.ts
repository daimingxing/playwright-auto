import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPlaywrightTask } from '../../server/src/services/playwright-cli';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

afterEach(() => {
  spawnMock.mockReset();
});

describe('Playwright CLI 辅助工具', () => {
  it('收集 stdout 和 stderr 并返回输出', async () => {
    spawnMock.mockImplementation(() => createChild({ code: 0, stdout: 'ok', stderr: 'warn' }));

    const result = await runPlaywrightTask(['test'], { cwd: process.cwd() });

    expect(result.output).toBe('okwarn');
  });

  it('允许配置可接受的退出码', async () => {
    spawnMock.mockImplementation(() => createChild({ code: 1, stderr: 'failed but parsed' }));

    const result = await runPlaywrightTask(['test'], { cwd: process.cwd(), allowedExitCodes: [0, 1] });

    expect(result.code).toBe(1);
    expect(result.output).toBe('failed but parsed');
  });

  it('启动失败时会直接抛出 error 事件', async () => {
    spawnMock.mockImplementation(() => createChild({ error: new Error('spawn failed') }));

    await expect(runPlaywrightTask(['test'], { cwd: process.cwd() })).rejects.toThrow('spawn failed');
  });

  it('收到取消信号时会结束子进程', async () => {
    const controller = new AbortController();
    const killMock = vi.fn(() => true);
    spawnMock.mockImplementation(() => createChild({ kill: killMock }));

    const task = runPlaywrightTask(['test'], { cwd: process.cwd(), signal: controller.signal });
    controller.abort();

    await expect(task).rejects.toThrow('Playwright 任务已取消');
    expect(killMock).toHaveBeenCalledWith('SIGTERM');
  });
});

interface ChildOptions {
  code?: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
  kill?: (signal?: NodeJS.Signals) => boolean;
}

/**
 * 创建可控制事件顺序的模拟子进程。
 */
function createChild(options: ChildOptions) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
    exitCode: number | null;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.kill = options.kill ?? (() => true);

  if (options.error) {
    setTimeout(() => child.emit('error', options.error), 0);
    return child;
  }

  if (options.code !== undefined) {
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(options.stdout ?? ''));
      child.stderr.emit('data', Buffer.from(options.stderr ?? ''));
      child.exitCode = options.code ?? null;
      child.emit('exit', options.code);
    }, 0);
  }

  return child;
}
