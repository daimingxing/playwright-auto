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
 */
export async function writeFileAtomic(path: string, data: Buffer | string) {
  await ensureDir(dirname(path));

  const tempPath = `${path}.tmp`;

  try {
    await writeFile(tempPath, data);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
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
