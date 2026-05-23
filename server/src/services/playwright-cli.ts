import { spawn, type SpawnOptions } from 'node:child_process';
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
