import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-config-'));
  process.env.PLAYWRIGHT_AUTO_CONFIG = join(root, 'playwright-auto.config.json');
});

afterEach(async () => {
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  delete process.env.PORT;
  delete process.env.DATA_ROOT;
  delete process.env.PLAYWRIGHT_AUTO_HEADLESS_WORKERS;
  delete process.env.PLAYWRIGHT_AUTO_HEADED_WORKERS;
  delete process.env.PLAYWRIGHT_AUTO_MAX_WORKERS;
  await rm(root, { recursive: true, force: true });
});

describe('应用配置', () => {
  it('没有配置文件时使用默认配置', async () => {
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3001,
        dataRoot: 'data'
      },
      runner: {
        headlessWorkers: 4,
        headedWorkers: 1,
        maxWorkers: 8
      },
      steps: {
        timeouts: {
          navigation: 20000,
          action: 2000,
          wait: 1000
        }
      }
    });
  });

  it('读取项目配置文件中的服务和运行配置', async () => {
    await writeConfig({
      server: {
        port: 3100,
        dataRoot: 'custom-data'
      },
      runner: {
        headlessWorkers: 12,
        headedWorkers: 2,
        maxWorkers: 16
      },
      steps: {
        timeouts: {
          navigation: 30000,
          action: 3000,
          wait: 1500
        }
      }
    });
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3100,
        dataRoot: 'custom-data'
      },
      runner: {
        headlessWorkers: 12,
        headedWorkers: 2,
        maxWorkers: 16
      },
      steps: {
        timeouts: {
          navigation: 30000,
          action: 3000,
          wait: 1500
        }
      }
    });
  });

  it('环境变量优先于配置文件', async () => {
    await writeConfig({
      server: {
        port: 3100,
        dataRoot: 'custom-data'
      },
      runner: {
        headlessWorkers: 12,
        headedWorkers: 2,
        maxWorkers: 16
      },
      steps: {
        timeouts: {
          navigation: 30000,
          action: 3000,
          wait: 1500
        }
      }
    });
    process.env.PORT = '3200';
    process.env.DATA_ROOT = 'env-data';
    process.env.PLAYWRIGHT_AUTO_HEADLESS_WORKERS = '20';
    process.env.PLAYWRIGHT_AUTO_HEADED_WORKERS = '3';
    process.env.PLAYWRIGHT_AUTO_MAX_WORKERS = '24';
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3200,
        dataRoot: 'env-data'
      },
      runner: {
        headlessWorkers: 20,
        headedWorkers: 3,
        maxWorkers: 24
      },
      steps: {
        timeouts: {
          navigation: 30000,
          action: 3000,
          wait: 1500
        }
      }
    });
  });
});

/**
 * 写入测试用配置文件。
 */
async function writeConfig(value: unknown) {
  await mkdir(root, { recursive: true });
  await writeFile(process.env.PLAYWRIGHT_AUTO_CONFIG!, JSON.stringify(value), 'utf8');
}

/**
 * 避免模块缓存影响环境变量测试。
 */
async function importFreshConfig() {
  return import('../../server/src/lib/app-config');
}
