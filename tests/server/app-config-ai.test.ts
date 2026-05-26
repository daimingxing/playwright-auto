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
      concurrency: 1
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
        concurrency: 2
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
      concurrency: 2
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
 * 避免模块缓存影响配置读取。
 */
async function importFreshConfig() {
  vi.resetModules();
  return import('../../server/src/lib/app-config');
}
