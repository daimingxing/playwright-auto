import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkVendorBrowser,
  getChromePath,
  getVendorEnv,
  getVendorRegistryPath,
  prepareVendorBrowser,
  vendorBrowserList
} from '../../server/src/services/vendor-browser';

let root = '';

/**
 * 在临时目录中创建测试专用的 vendor 根目录。
 */
beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), 'playwright-auto-vendor-')), 'vendor');
});

/**
 * 清理测试过程中创建的临时目录。
 */
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('vendor 浏览器依赖', () => {
  it('缺少文件时返回明确的缺失依赖', async () => {
    const result = await checkVendorBrowser(root);

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(vendorBrowserList.map((item) => item.label));
  });

  it('依赖齐全时返回真实解压目录和 registry 目录', async () => {
    await createVendorFiles(root);

    const result = await checkVendorBrowser(root);
    const env = getVendorEnv(root);

    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(getChromePath(root)).toBe(join(root, 'chrome-win64', 'chrome.exe'));
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(getVendorRegistryPath(root));
  });

  it('准备 vendor 时创建 Playwright 可识别的 registry 映射', async () => {
    await createVendorFiles(root);

    await prepareVendorBrowser(root);

    await access(join(root, '.registry', 'ffmpeg-1011', 'ffmpeg-win64.exe'));
    await access(join(root, '.registry', 'winldd-1007', 'PrintDeps.exe'));
  });
});

/**
 * 创建 Playwright 在 Windows 下需要的浏览器和视频录制依赖。
 */
async function createVendorFiles(rootPath: string) {
  for (const item of vendorBrowserList) {
    const filePath = join(rootPath, item.file);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '');
  }
}
