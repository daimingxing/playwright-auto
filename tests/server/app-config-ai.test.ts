import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-ai-config-'));
  process.env.PLAYWRIGHT_AUTO_CONFIG = join(root, 'playwright-auto.config.json');
});

afterEach(async () => {
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  delete process.env.PLAYWRIGHT_AUTO_AI_BASE_URL;
  delete process.env.PLAYWRIGHT_AUTO_AI_API_KEY;
  delete process.env.PLAYWRIGHT_AUTO_AI_MODEL;
  delete process.env.PLAYWRIGHT_AUTO_AI_TEMPERATURE;
  delete process.env.PLAYWRIGHT_AUTO_AI_TIMEOUT_MS;
  delete process.env.PLAYWRIGHT_AUTO_AI_CONCURRENCY;
  await rm(root, { recursive: true, force: true });
});

describe('AI 配置', () => {
  it('默认关闭 AI 导入能力', async () => {
    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().ai).toEqual({
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
        autoCreate: true
      }
    });
    expect(getAppConfig().browser).toEqual({
      openTimeoutMs: 30000
    });
  });

  it('读取配置文件和环境变量中的 AI 配置', async () => {
    await writeConfig({
      ai: {
        enabled: true,
        baseUrl: 'http://local-model/v1',
        apiKey: 'file-key',
        model: 'file-model',
        temperature: 0.3,
        timeoutMs: 30000,
        maxRetries: 2,
        concurrency: 2,
        pageMap: {
          staleDays: 7,
          maxActions: 8,
          maxDepth: 3,
          autoCreate: false
        }
      },
      browser: {
        openTimeoutMs: 45000
      }
    });
    process.env.PLAYWRIGHT_AUTO_AI_API_KEY = 'env-key';
    process.env.PLAYWRIGHT_AUTO_AI_MODEL = 'env-model';

    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().ai).toMatchObject({
      enabled: true,
      baseUrl: 'http://local-model/v1',
      apiKey: 'env-key',
      model: 'env-model',
      temperature: 0.3,
      timeoutMs: 30000,
      maxRetries: 2,
      concurrency: 2,
      pageMap: {
        staleDays: 7,
        maxActions: 8,
        maxDepth: 3,
        autoCreate: false
      }
    });
    expect(getAppConfig().browser.openTimeoutMs).toBe(45000);
  });

  it('公开配置不泄露 AI 密钥并包含浏览器打开配置', async () => {
    await writeConfig({
      ai: {
        enabled: true,
        baseUrl: 'http://local-model/v1',
        apiKey: 'file-key',
        model: 'file-model',
        pageMap: {
          staleDays: 10,
          maxActions: 6,
          maxDepth: 2,
          autoCreate: true
        }
      },
      browser: {
        openTimeoutMs: 45000
      }
    });
    const { createApp } = await importFreshApp();
    const request = (await import('supertest')).default;

    const res = await request(createApp()).get('/api/app-config');

    expect(res.status).toBe(200);
    expect(res.body.ai.apiKey).toBeUndefined();
    expect(res.body.ai.pageMap).toEqual({
      staleDays: 10,
      maxActions: 6,
      maxDepth: 2,
      autoCreate: true
    });
    expect(res.body.browser).toEqual({
      openTimeoutMs: 45000
    });
  }, 10000);

  it('页面地图配置不再暴露打开等待字段', async () => {
    await writeConfig({
      ai: {
        pageMap: {
          staleDays: 10,
          maxActions: 6,
          maxDepth: 2,
          autoCreate: true
        }
      }
    });

    const { getAppConfig } = await importFreshConfig();

    expect(getAppConfig().ai.pageMap).toEqual({
      staleDays: 10,
      maxActions: 6,
      maxDepth: 2,
      autoCreate: true
    });
    expect(getAppConfig().browser.openTimeoutMs).toBe(30000);
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
 * 避免模块缓存影响配置读取。
 */
async function importFreshConfig() {
  vi.resetModules();
  return import('../../server/src/lib/app-config');
}

/**
 * 避免模块缓存影响公开配置接口。
 */
async function importFreshApp() {
  vi.resetModules();
  return import('../../server/src/app');
}
