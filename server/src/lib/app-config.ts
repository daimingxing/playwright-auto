import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullAppConfig, StepTimeoutConfig } from '../../../shared/types';

interface FileConfig {
  server?: {
    port?: unknown;
    dataRoot?: unknown;
    corsOrigins?: unknown;
  };
  web?: {
    origin?: unknown;
    apiBase?: unknown;
  };
  runner?: {
    headlessWorkers?: unknown;
    headedWorkers?: unknown;
    maxWorkers?: unknown;
  };
  steps?: {
    timeouts?: {
      navigation?: unknown;
      action?: unknown;
      wait?: unknown;
    };
  };
  ai?: {
    enabled?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
    temperature?: unknown;
    timeoutMs?: unknown;
    maxRetries?: unknown;
    concurrency?: unknown;
    pageMap?: {
      staleDays?: unknown;
      maxActions?: unknown;
      maxDepth?: unknown;
      timeoutMs?: unknown;
      autoCreate?: unknown;
    };
  };
}

const DEFAULT_CONFIG = {
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
};

/**
 * 获取当前应用配置。
 */
export function getAppConfig(): FullAppConfig {
  const fileConfig = readFileConfig();
  const web = {
    origin: readText(undefined, fileConfig.web?.origin, DEFAULT_CONFIG.web.origin),
    apiBase: readText(process.env.VITE_API_BASE, fileConfig.web?.apiBase, DEFAULT_CONFIG.web.apiBase)
  };
  const maxWorkers = readInt(process.env.PLAYWRIGHT_AUTO_MAX_WORKERS, fileConfig.runner?.maxWorkers, DEFAULT_CONFIG.runner.maxWorkers, 1, 64);
  const headlessWorkers = readInt(
    process.env.PLAYWRIGHT_AUTO_HEADLESS_WORKERS,
    fileConfig.runner?.headlessWorkers,
    DEFAULT_CONFIG.runner.headlessWorkers,
    1,
    maxWorkers
  );
  const headedWorkers = readInt(
    process.env.PLAYWRIGHT_AUTO_HEADED_WORKERS,
    fileConfig.runner?.headedWorkers,
    DEFAULT_CONFIG.runner.headedWorkers,
    1,
    maxWorkers
  );
  const timeouts = readStepTimeouts(fileConfig);

  return {
    server: {
      port: readInt(process.env.PORT, fileConfig.server?.port, DEFAULT_CONFIG.server.port, 1, 65535),
      dataRoot: readText(process.env.DATA_ROOT, fileConfig.server?.dataRoot, DEFAULT_CONFIG.server.dataRoot),
      corsOrigins: readList(
        process.env.PLAYWRIGHT_AUTO_CORS_ORIGINS,
        fileConfig.server?.corsOrigins,
        [...DEFAULT_CONFIG.server.corsOrigins, web.origin]
      )
    },
    web,
    runner: {
      headlessWorkers,
      headedWorkers,
      maxWorkers
    },
    steps: {
      timeouts
    },
    ai: readAiConfig(fileConfig)
  };
}

/**
 * 读取 AI 导入配置。
 */
function readAiConfig(fileConfig: FileConfig) {
  return {
    enabled: readBool(undefined, fileConfig.ai?.enabled, DEFAULT_CONFIG.ai.enabled),
    baseUrl: readText(process.env.PLAYWRIGHT_AUTO_AI_BASE_URL, fileConfig.ai?.baseUrl, DEFAULT_CONFIG.ai.baseUrl),
    apiKey: readText(process.env.PLAYWRIGHT_AUTO_AI_API_KEY, fileConfig.ai?.apiKey, DEFAULT_CONFIG.ai.apiKey),
    model: readText(process.env.PLAYWRIGHT_AUTO_AI_MODEL, fileConfig.ai?.model, DEFAULT_CONFIG.ai.model),
    temperature: readFloat(process.env.PLAYWRIGHT_AUTO_AI_TEMPERATURE, fileConfig.ai?.temperature, DEFAULT_CONFIG.ai.temperature, 0, 2),
    timeoutMs: readInt(process.env.PLAYWRIGHT_AUTO_AI_TIMEOUT_MS, fileConfig.ai?.timeoutMs, DEFAULT_CONFIG.ai.timeoutMs, 1000, 300000),
    maxRetries: readInt(undefined, fileConfig.ai?.maxRetries, DEFAULT_CONFIG.ai.maxRetries, 0, 5),
    concurrency: readInt(process.env.PLAYWRIGHT_AUTO_AI_CONCURRENCY, fileConfig.ai?.concurrency, DEFAULT_CONFIG.ai.concurrency, 1, 5),
    pageMap: readPageMapConfig(fileConfig)
  };
}

/**
 * 读取页面地图配置。
 */
function readPageMapConfig(fileConfig: FileConfig) {
  const fileMap = fileConfig.ai?.pageMap;

  return {
    staleDays: readInt(undefined, fileMap?.staleDays, DEFAULT_CONFIG.ai.pageMap.staleDays, 1, 365),
    // 限制探索动作数，避免页面地图采集阶段误把大页面跑成长期任务。
    maxActions: readInt(undefined, fileMap?.maxActions, DEFAULT_CONFIG.ai.pageMap.maxActions, 0, 200),
    // 限制动作深度，避免菜单、弹窗和树形控件组合产生指数级探索。
    maxDepth: readInt(undefined, fileMap?.maxDepth, DEFAULT_CONFIG.ai.pageMap.maxDepth, 0, 10),
    // 单次页面地图采集超时单独配置，避免复用 AI 请求超时导致浏览器任务等待过久。
    timeoutMs: readInt(undefined, fileMap?.timeoutMs, DEFAULT_CONFIG.ai.pageMap.timeoutMs, 1000, 300000),
    autoCreate: readBool(undefined, fileMap?.autoCreate, DEFAULT_CONFIG.ai.pageMap.autoCreate)
  };
}

/**
 * 读取逗号分隔或数组形式的字符串列表。
 */
function readList(envValue: unknown, fileValue: unknown, defaultValue: string[]) {
  const envList = parseListValue(envValue);

  if (envList.length > 0) {
    return uniqueList([...defaultValue, ...envList]);
  }

  const fileList = parseListValue(fileValue);

  if (fileList.length > 0) {
    return uniqueList([...defaultValue, ...fileList]);
  }

  return uniqueList(defaultValue);
}

/**
 * 解析字符串列表配置值。
 */
function parseListValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  }

  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

/**
 * 按首次出现顺序去重字符串列表。
 */
function uniqueList(values: string[]) {
  return Array.from(new Set(values));
}

/**
 * 读取项目根目录中的配置文件。
 */
function readFileConfig(): FileConfig {
  const configPath = resolve(process.env.PLAYWRIGHT_AUTO_CONFIG ?? 'playwright-auto.config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('配置文件必须是对象');
    }

    return parsed as FileConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`配置文件解析失败：${configPath}（${message}）`);
  }
}

/**
 * 按环境变量、配置文件、默认值顺序读取整数。
 */
function readInt(envValue: unknown, fileValue: unknown, defaultValue: number, min: number, max: number) {
  const envNumber = parseIntValue(envValue);

  if (envNumber !== undefined && envNumber >= min && envNumber <= max) {
    return envNumber;
  }

  const fileNumber = parseIntValue(fileValue);

  if (fileNumber !== undefined && fileNumber >= min && fileNumber <= max) {
    return fileNumber;
  }

  return defaultValue;
}

/**
 * 读取字符串配置。
 */
function readText(envValue: unknown, fileValue: unknown, defaultValue: string) {
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue;
  }

  if (typeof fileValue === 'string' && fileValue.trim()) {
    return fileValue;
  }

  return defaultValue;
}

/**
 * 读取布尔配置。
 */
function readBool(envValue: unknown, fileValue: unknown, defaultValue: boolean) {
  const envBool = parseBoolValue(envValue);

  if (envBool !== undefined) {
    return envBool;
  }

  const fileBool = parseBoolValue(fileValue);

  return fileBool ?? defaultValue;
}

/**
 * 读取小数配置。
 */
function readFloat(envValue: unknown, fileValue: unknown, defaultValue: number, min: number, max: number) {
  const envNumber = parseFloatValue(envValue);

  if (envNumber !== undefined && envNumber >= min && envNumber <= max) {
    return envNumber;
  }

  const fileNumber = parseFloatValue(fileValue);

  if (fileNumber !== undefined && fileNumber >= min && fileNumber <= max) {
    return fileNumber;
  }

  return defaultValue;
}

/**
 * 读取步骤默认等待时间配置。
 */
function readStepTimeouts(fileConfig: FileConfig): StepTimeoutConfig {
  const fileTimeouts = fileConfig.steps?.timeouts;

  return {
    navigation: readInt(undefined, fileTimeouts?.navigation, DEFAULT_CONFIG.steps.timeouts.navigation, 0, 600000),
    action: readInt(undefined, fileTimeouts?.action, DEFAULT_CONFIG.steps.timeouts.action, 0, 600000),
    wait: readInt(undefined, fileTimeouts?.wait, DEFAULT_CONFIG.steps.timeouts.wait, 0, 600000)
  };
}

/**
 * 解析整数配置值。
 */
function parseIntValue(value: unknown) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isInteger(numberValue) ? numberValue : undefined;
}

/**
 * 解析布尔配置值。
 */
function parseBoolValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();

    if (text === 'true') {
      return true;
    }

    if (text === 'false') {
      return false;
    }
  }

  return undefined;
}

/**
 * 解析小数配置值。
 */
function parseFloatValue(value: unknown) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isFinite(numberValue) ? numberValue : undefined;
}
