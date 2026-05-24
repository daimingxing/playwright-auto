import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 确保目录存在。
 */
export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

/**
 * 写入格式化 JSON 文件。
 */
export async function writeJson(path: string, value: unknown) {
  await ensureDir(dirname(path));

  // 先写临时文件，再原地替换目标文件，避免直接覆盖留下半截 JSON。
  const tempPath = `${path}.tmp`;

  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
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
