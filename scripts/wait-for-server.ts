import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_PORT = 3001;
const DEFAULT_TIMEOUT_MS = 30000;
const POLL_MS = 500;

/**
 * 根据环境变量和配置文件生成健康检查地址。
 */
export function getHealthUrl(configPath = process.env.PLAYWRIGHT_AUTO_CONFIG ?? 'playwright-auto.config.json') {
  const port = readPort(configPath);

  return `http://localhost:${port}/health`;
}

/**
 * 等待本地服务健康检查通过。
 */
export async function waitForServer(url = getHealthUrl(), timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy(url)) {
      return;
    }

    await wait(POLL_MS);
  }

  throw new Error(`等待本地服务启动超时：${url}`);
}

/**
 * 读取后端服务端口。
 */
function readPort(configPath: string) {
  const envPort = parsePort(process.env.PORT);

  if (envPort) {
    return envPort;
  }

  const fileConfig = readConfig(configPath);
  const filePort = parsePort(fileConfig?.server?.port);

  return filePort ?? DEFAULT_PORT;
}

/**
 * 读取项目配置文件。
 */
function readConfig(configPath: string): { server?: { port?: unknown } } {
  const path = resolve(configPath);

  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { server?: { port?: unknown } };
  } catch {
    return {};
  }
}

/**
 * 解析合法端口。
 */
function parsePort(value: unknown) {
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

/**
 * 请求健康检查接口。
 */
async function isHealthy(url: string) {
  try {
    const res = await fetch(url);

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 等待指定毫秒数。
 */
function wait(ms: number) {
  return new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}
