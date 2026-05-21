import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FileConfig {
  server?: {
    port?: unknown;
    dataRoot?: unknown;
  };
  runner?: {
    headlessWorkers?: unknown;
    headedWorkers?: unknown;
    maxWorkers?: unknown;
  };
}

const DEFAULT_CONFIG = {
  server: {
    port: 3001,
    dataRoot: 'data'
  },
  runner: {
    headlessWorkers: 4,
    headedWorkers: 1,
    maxWorkers: 8
  }
};

/**
 * 获取当前应用配置。
 */
export function getAppConfig() {
  const fileConfig = readFileConfig();
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

  return {
    server: {
      port: readInt(process.env.PORT, fileConfig.server?.port, DEFAULT_CONFIG.server.port, 1, 65535),
      dataRoot: readText(process.env.DATA_ROOT, fileConfig.server?.dataRoot, DEFAULT_CONFIG.server.dataRoot)
    },
    runner: {
      headlessWorkers,
      headedWorkers,
      maxWorkers
    }
  };
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
    return JSON.parse(readFileSync(configPath, 'utf8')) as FileConfig;
  } catch {
    return {};
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
 * 解析整数配置值。
 */
function parseIntValue(value: unknown) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isInteger(numberValue) ? numberValue : undefined;
}
