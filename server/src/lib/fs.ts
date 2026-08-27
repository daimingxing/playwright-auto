import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 确保目录存在。
 */
export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

/**
 * 原子写入文件：先写临时文件再 rename，崩溃时不会留下半截目标文件。
 * Windows 上目标文件若正被读取，rename 可能短暂 EPERM，短暂重试后再失败。
 */
export async function writeFileAtomic(path: string, data: Buffer | string) {
  await ensureDir(dirname(path));

  const tempPath = `${path}.tmp`;

  try {
    await writeFile(tempPath, data);
    await renameWithRetry(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * 替换目标文件；文件正被读取时短暂重试。
 */
async function renameWithRetry(from: string, to: string, attempts = 5) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;

      if (!isBusyFileError(error) || attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }

  throw lastError;
}

/**
 * 判断是否为文件正被占用导致的替换失败。
 */
function isBusyFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')
  );
}

/**
 * 写入格式化 JSON 文件，经临时文件替换，避免留下半截 JSON。
 */
export async function writeJson(path: string, value: unknown) {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 读取 JSON 文件。
 */
export async function readJson<T>(path: string) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as T;
}

/**
 * 移动文件或目录。
 */
export async function movePath(from: string, to: string) {
  await ensureDir(dirname(to));
  await rename(from, to);
}
