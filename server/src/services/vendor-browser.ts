import { access, copyFile, mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const vendorRoot = join(process.cwd(), 'vendor', 'playwright');

const registryDir = '.registry';

export const vendorBrowserList = [
  {
    label: 'Chromium 1223',
    file: join('chrome-win64', 'chrome.exe')
  },
  {
    label: 'Chromium Headless Shell 1223',
    file: join('chrome-headless-shell-win64', 'chrome-headless-shell.exe')
  },
  {
    label: 'FFmpeg 1011',
    file: join('ffmpeg-win64', 'ffmpeg-win64.exe')
  },
  {
    label: 'Winldd 1007',
    file: join('winldd-win64', 'PrintDeps.exe')
  }
] as const;

const registryMap = [
  {
    name: 'Chromium 1223',
    source: 'chrome-win64',
    target: join('chromium-1223', 'chrome-win64'),
    files: ['chrome.exe']
  },
  {
    name: 'Chromium Headless Shell 1223',
    source: 'chrome-headless-shell-win64',
    target: join('chromium_headless_shell-1223', 'chrome-headless-shell-win64'),
    files: ['chrome-headless-shell.exe']
  },
  {
    name: 'FFmpeg 1011',
    source: 'ffmpeg-win64',
    target: 'ffmpeg-1011',
    files: ['ffmpeg-win64.exe']
  },
  {
    name: 'Winldd 1007',
    source: 'winldd-win64',
    target: 'winldd-1007',
    files: ['PrintDeps.exe']
  }
] as const;

export interface VendorCheckResult {
  ready: boolean;
  missing: string[];
}

/**
 * 检查 vendor 目录中的 Playwright 二进制依赖是否齐全。
 */
export async function checkVendorBrowser(rootPath = vendorRoot): Promise<VendorCheckResult> {
  const missing: string[] = [];

  for (const item of vendorBrowserList) {
    if (!(await hasFile(join(rootPath, item.file)))) {
      missing.push(item.label);
    }
  }

  return {
    ready: missing.length === 0,
    missing
  };
}

/**
 * 准备 Playwright 可识别的 registry 映射目录。
 */
export async function prepareVendorBrowser(rootPath = vendorRoot) {
  const result = await checkVendorBrowser(rootPath);

  if (!result.ready) {
    throw new Error(`缺少 Playwright vendor 依赖：${result.missing.join('、')}`);
  }

  for (const item of registryMap) {
    await linkRegistryDir(rootPath, item.source, item.target, item.files);
  }
}

/**
 * 生成所有子进程共享的 Playwright vendor 环境变量。
 */
export function getVendorEnv(rootPath = vendorRoot) {
  return {
    PLAYWRIGHT_BROWSERS_PATH: getVendorRegistryPath(rootPath)
  };
}

/**
 * 获取 Playwright registry 映射目录路径。
 */
export function getVendorRegistryPath(rootPath = vendorRoot) {
  return join(rootPath, registryDir);
}

/**
 * 获取 vendor 目录内的 Chromium 可执行文件路径。
 */
export function getChromePath(rootPath = vendorRoot) {
  return join(rootPath, 'chrome-win64', 'chrome.exe');
}

/**
 * 在启动浏览器前确认 vendor 依赖齐全并准备映射目录。
 */
export async function assertVendorBrowser(rootPath = vendorRoot) {
  await prepareVendorBrowser(rootPath);
}

/**
 * 创建 registry 目录映射；如果系统不允许目录链接，则复制必要的小文件。
 */
async function linkRegistryDir(rootPath: string, sourceDir: string, targetDir: string, files: readonly string[]) {
  const sourcePath = join(rootPath, sourceDir);
  const targetPath = join(getVendorRegistryPath(rootPath), targetDir);
  const shouldLinkDir = files.every((file) => !file.includes('\\') && !file.includes('/'));

  await rm(targetPath, { recursive: true, force: true });
  await mkdir(dirname(targetPath), { recursive: true });

  if (shouldLinkDir) {
    try {
      await symlink(sourcePath, targetPath, 'junction');
      return;
    } catch {
      await mkdir(targetPath, { recursive: true });
    }
  }

  for (const file of files) {
    const fileName = file.split(/[\\/]/).at(-1) ?? file;
    const targetFile = join(targetPath, file);

    await mkdir(dirname(targetFile), { recursive: true });
    await copyFile(join(sourcePath, fileName), targetFile);
  }
}

/**
 * 判断文件是否存在且当前进程可以访问。
 */
async function hasFile(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
