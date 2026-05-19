import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
