import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';

const resolveModule = createRequire(import.meta.url).resolve;

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
