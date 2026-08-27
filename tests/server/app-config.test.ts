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
  delete process.env.PLAYWRIGHT_AUTO_AGENT_PROTOCOL;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.OPENCODE_BIN;
  delete process.env.PLAYWRIGHT_MCP_CLI;
  await rm(root, { recursive: true, force: true });
});

describe('应用配置', () => {
  it('没有配置文件时使用默认配置', async () => {
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3001,
        dataRoot: 'data',
        corsOrigins: ['http://localhost:5177', 'http://127.0.0.1:5177']
      },
      web: {
        origin: 'http://localhost:5177',
        apiBase: ''
      },
      runner: {
        headlessWorkers: 4,
        headedWorkers: 1,
        maxWorkers: 8
      },
      browser: {
        openTimeoutMs: 30000
      },
      steps: {
        timeouts: {
          navigation: 20000,
          action: 2000,
          wait: 1000
        }
      },
      agent: {
        protocol: 'chat-completions',
        provider: 'corp',
        model: 'test-agent',
        baseUrl: '',
        apiKey: '',
        opencodePath: '',
        playwrightMcpPath: '',
        timeoutMs: 180000,
        contextLimit: 0,
        outputLimit: 0,
        reasoningEffort: ''
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
      browser: {
        openTimeoutMs: 30000
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
        corsOrigins: ['http://localhost:5177', 'http://127.0.0.1:5177', 'https://ui.example', 'https://tool.example']
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
      browser: {
        openTimeoutMs: 30000
      },
      steps: {
        timeouts: {
          navigation: 30000,
          action: 3000,
          wait: 1500
        }
      },
      agent: {
        protocol: 'chat-completions',
        provider: 'corp',
        model: 'test-agent',
        baseUrl: '',
        apiKey: '',
        opencodePath: '',
        playwrightMcpPath: '',
        timeoutMs: 180000,
        contextLimit: 0,
        outputLimit: 0,
        reasoningEffort: ''
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
      },
      agent: {
        apiKey: 'file-secret'
      }
    });
    process.env.PORT = '3200';
    process.env.DATA_ROOT = 'env-data';
    process.env.PLAYWRIGHT_AUTO_HEADLESS_WORKERS = '20';
    process.env.PLAYWRIGHT_AUTO_HEADED_WORKERS = '3';
    process.env.PLAYWRIGHT_AUTO_MAX_WORKERS = '24';
    process.env.PLAYWRIGHT_AUTO_CORS_ORIGINS = 'https://env.example';
    process.env.VITE_API_BASE = 'https://env-api.example';
    process.env.PLAYWRIGHT_AUTO_AGENT_PROTOCOL = 'responses';
    process.env.AI_BASE_URL = 'https://llm.example/v1';
    process.env.AI_API_KEY = 'env-secret';
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig()).toEqual({
      server: {
        port: 3200,
        dataRoot: 'env-data',
        corsOrigins: ['http://localhost:5177', 'http://127.0.0.1:5177', 'https://env.example']
      },
      web: {
        origin: 'http://localhost:5177',
        apiBase: 'https://env-api.example'
      },
      runner: {
        headlessWorkers: 20,
        headedWorkers: 3,
        maxWorkers: 24
      },
      browser: {
        openTimeoutMs: 30000
      },
      steps: {
        timeouts: {
          navigation: 30000,
          action: 3000,
          wait: 1500
        }
      },
      agent: {
        protocol: 'responses',
        provider: 'corp',
        model: 'test-agent',
        baseUrl: 'https://llm.example/v1',
        apiKey: 'env-secret',
        opencodePath: '',
        playwrightMcpPath: '',
        timeoutMs: 180000,
        contextLimit: 0,
        outputLimit: 0,
        reasoningEffort: ''
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

  it('读取配置文件中的 API Key', async () => {
    await writeConfig({
      agent: {
        apiKey: 'file-secret',
        baseUrl: 'https://file.example/v1'
      }
    });
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().agent.apiKey).toBe('file-secret');
    expect(getAppConfig().agent.baseUrl).toBe('https://file.example/v1');
  });

  it('读取自定义模型的上下文窗口和思考档位', async () => {
    await writeConfig({
      agent: {
        model: 'grok-4.6',
        contextLimit: 500000,
        outputLimit: 500000,
        reasoningEffort: 'high'
      }
    });
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().agent.model).toBe('grok-4.6');
    expect(getAppConfig().agent.contextLimit).toBe(500000);
    expect(getAppConfig().agent.outputLimit).toBe(500000);
    expect(getAppConfig().agent.reasoningEffort).toBe('high');
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
