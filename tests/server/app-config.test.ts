import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  delete process.env.PLAYWRIGHT_AUTO_CORS_ORIGINS;
  delete process.env.VITE_API_BASE;
  await rm(root, { recursive: true, force: true });
});

describe('应用配置', () => {
  it('没有配置文件时使用默认配置', async () => {
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3001,
        dataRoot: 'data',
        corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173']
      },
      web: {
        origin: 'http://localhost:5173',
        apiBase: ''
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
      },
      ai: {
        enabled: false,
        baseUrl: '',
        apiKey: '',
        model: '',
        temperature: 0.1,
        timeoutMs: 60000,
        maxRetries: 1,
        concurrency: 1,
        pageMap: {
          staleDays: 30,
          maxActions: 20,
          maxDepth: 2,
          timeoutMs: 30000,
          autoCreate: true
        }
      }
    });
  });

  it('读取项目配置文件中的服务和运行配置', async () => {
    await writeConfig({
      server: {
        port: 3100,
        dataRoot: 'custom-data',
        corsOrigins: ['https://tool.example']
      },
      web: {
        origin: 'https://ui.example',
        apiBase: 'https://api.example'
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
        dataRoot: 'custom-data',
        corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://ui.example', 'https://tool.example']
      },
      web: {
        origin: 'https://ui.example',
        apiBase: 'https://api.example'
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
      },
      ai: {
        enabled: false,
        baseUrl: '',
        apiKey: '',
        model: '',
        temperature: 0.1,
        timeoutMs: 60000,
        maxRetries: 1,
        concurrency: 1,
        pageMap: {
          staleDays: 30,
          maxActions: 20,
          maxDepth: 2,
          timeoutMs: 30000,
          autoCreate: true
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
    process.env.PLAYWRIGHT_AUTO_CORS_ORIGINS = 'https://env.example';
    process.env.VITE_API_BASE = 'https://env-api.example';
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3200,
        dataRoot: 'env-data',
        corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://env.example']
      },
      web: {
        origin: 'http://localhost:5173',
        apiBase: 'https://env-api.example'
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
      },
      ai: {
        enabled: false,
        baseUrl: '',
        apiKey: '',
        model: '',
        temperature: 0.1,
        timeoutMs: 60000,
        maxRetries: 1,
        concurrency: 1,
        pageMap: {
          staleDays: 30,
          maxActions: 20,
          maxDepth: 2,
          timeoutMs: 30000,
          autoCreate: true
        }
      }
    });
  });

  it('配置文件损坏时会直接报错并暴露路径', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(process.env.PLAYWRIGHT_AUTO_CONFIG!, '{bad json', 'utf8');

    const { getAppConfig } = await importFreshConfig();

    expect(() => getAppConfig()).toThrow('配置文件解析失败');
    expect(() => getAppConfig()).toThrow('playwright-auto.config.json');
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
  vi.resetModules();
  return import('../../server/src/lib/app-config');
}
