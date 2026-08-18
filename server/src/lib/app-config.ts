import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { FullAppConfig } from '../../../shared/types';

const DEFAULT_CONFIG: FullAppConfig = {
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
  }
};

/**
 * 获取当前应用配置，环境变量优先于配置文件。
 */
export function getAppConfig(): FullAppConfig {
  const file = readConfigFile();
  const maxWorkers = intField(DEFAULT_CONFIG.runner.maxWorkers, 1, 64).parse(
    envOrFile('PLAYWRIGHT_AUTO_MAX_WORKERS', getValue(file, 'runner', 'maxWorkers'))
  );
  const schema = createConfigSchema(maxWorkers);
  const config = schema.parse({
    server: {
      port: envOrFile('PORT', getValue(file, 'server', 'port')),
      dataRoot: envOrFile('DATA_ROOT', getValue(file, 'server', 'dataRoot')),
      corsOrigins: envOrFile('PLAYWRIGHT_AUTO_CORS_ORIGINS', getValue(file, 'server', 'corsOrigins'))
    },
    web: {
      origin: getValue(file, 'web', 'origin'),
      apiBase: envOrFile('VITE_API_BASE', getValue(file, 'web', 'apiBase'))
    },
    runner: {
      headlessWorkers: envOrFile('PLAYWRIGHT_AUTO_HEADLESS_WORKERS', getValue(file, 'runner', 'headlessWorkers')),
      headedWorkers: envOrFile('PLAYWRIGHT_AUTO_HEADED_WORKERS', getValue(file, 'runner', 'headedWorkers')),
      maxWorkers
    },
    browser: {
      openTimeoutMs: getValue(file, 'browser', 'openTimeoutMs')
    },
    steps: {
      timeouts: {
        navigation: getValue(file, 'steps', 'timeouts', 'navigation'),
        action: getValue(file, 'steps', 'timeouts', 'action'),
        wait: getValue(file, 'steps', 'timeouts', 'wait')
      }
    }
  });

  config.server.corsOrigins = Array.from(new Set([
    ...DEFAULT_CONFIG.server.corsOrigins,
    config.web.origin,
    ...config.server.corsOrigins
  ]));

  return config;
}

/**
 * 创建包含当前 worker 上限的配置校验规则。
 */
function createConfigSchema(maxWorkers: number) {
  return z.object({
    server: z.object({
      port: intField(DEFAULT_CONFIG.server.port, 1, 65535),
      dataRoot: textField(DEFAULT_CONFIG.server.dataRoot),
      corsOrigins: listField
    }),
    web: z.object({
      origin: textField(DEFAULT_CONFIG.web.origin),
      apiBase: textField(DEFAULT_CONFIG.web.apiBase, true)
    }),
    runner: z.object({
      headlessWorkers: intField(DEFAULT_CONFIG.runner.headlessWorkers, 1, maxWorkers),
      headedWorkers: intField(DEFAULT_CONFIG.runner.headedWorkers, 1, maxWorkers),
      maxWorkers: z.literal(maxWorkers)
    }),
    browser: z.object({
      openTimeoutMs: intField(DEFAULT_CONFIG.browser.openTimeoutMs, 1000, 300000)
    }),
    steps: z.object({
      timeouts: z.object({
        navigation: intField(DEFAULT_CONFIG.steps.timeouts.navigation, 0, 600000),
        action: intField(DEFAULT_CONFIG.steps.timeouts.action, 0, 600000),
        wait: intField(DEFAULT_CONFIG.steps.timeouts.wait, 0, 600000)
      })
    })
  });
}

/**
 * 创建整数配置规则，非法值回退到默认值。
 */
function intField(fallback: number, min: number, max: number) {
  return z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? Number(value) : value,
    z.number().int().min(min).max(max)
  ).catch(fallback);
}

/**
 * 创建文本配置规则，空文本按字段需要回退默认值或保留为空。
 */
function textField(fallback: string, allowEmpty = false) {
  return z.preprocess(
    (value) => typeof value === 'string' && (allowEmpty || value.trim()) ? value : fallback,
    z.string()
  );
}

const listField = z.preprocess(
  (value) => typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [],
  z.array(z.string()).transform((items) => items.map((item) => item.trim()).filter(Boolean))
);

/**
 * 读取配置文件并保留统一的路径错误信息。
 */
function readConfigFile(): unknown {
  const configPath = resolve(process.env.PLAYWRIGHT_AUTO_CONFIG ?? 'playwright-auto.config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'));

    if (!isRecord(value)) {
      throw new Error('配置文件必须是对象');
    }

    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`配置文件解析失败：${configPath}（${message}）`);
  }
}

/**
 * 沿对象路径读取未知配置值。
 */
function getValue(source: unknown, ...path: string[]): unknown {
  let value = source;

  for (const key of path) {
    if (!isRecord(value)) {
      return undefined;
    }

    value = value[key];
  }

  return value;
}

/**
 * 读取环境变量；空值继续使用配置文件值。
 */
function envOrFile(name: string, fileValue: unknown) {
  return process.env[name] || fileValue;
}

/**
 * 判断未知值是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
