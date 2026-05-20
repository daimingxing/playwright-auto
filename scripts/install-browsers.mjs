import { access, copyFile, mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const vendorRoot = join(process.cwd(), 'vendor', 'playwright');

const vendorBrowserList = [
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
];

const registryMap = [
  {
    source: 'ffmpeg-win64',
    target: 'ffmpeg-1011',
    files: ['ffmpeg-win64.exe']
  },
  {
    source: 'winldd-win64',
    target: 'winldd-1007',
    files: ['PrintDeps.exe']
  }
];

/**
 * 检查项目内置的 Playwright 浏览器依赖是否齐全。
 */
async function main() {
  const missing = await getMissingFiles();

  if (missing.length > 0) {
    printMissing(missing);
    process.exit(1);
  }

  await prepareRegistry();
  console.log(`已检测到 vendor 浏览器依赖：${vendorRoot}`);
}

/**
 * 收集当前 vendor 目录缺失的依赖名称。
 */
async function getMissingFiles() {
  const missing = [];

  for (const item of vendorBrowserList) {
    if (!(await hasFile(join(vendorRoot, item.file)))) {
      missing.push(item.label);
    }
  }

  return missing;
}

/**
 * 准备 Playwright 可识别的 registry 映射目录。
 */
async function prepareRegistry() {
  for (const item of registryMap) {
    await linkRegistryDir(item.source, item.target, item.files);
  }
}

/**
 * 创建 registry 目录映射；如果系统不允许目录链接，则复制必要的小文件。
 */
async function linkRegistryDir(sourceDir, targetDir, files) {
  const sourcePath = join(vendorRoot, sourceDir);
  const targetPath = join(vendorRoot, '.registry', targetDir);

  await rm(targetPath, { recursive: true, force: true });
  await mkdir(dirname(targetPath), { recursive: true });

  try {
    await symlink(sourcePath, targetPath, 'junction');
    return;
  } catch {
    await mkdir(targetPath, { recursive: true });
  }

  for (const file of files) {
    await copyFile(join(sourcePath, file), join(targetPath, file));
  }
}

/**
 * 输出缺失依赖和完整依赖清单。
 */
function printMissing(missing) {
  console.error(`缺少 Playwright 浏览器依赖，请补齐目录：${vendorRoot}`);
  console.error('');
  console.error('缺失项：');
  for (const label of missing) {
    console.error(`- ${label}`);
  }
  console.error('');
  console.error('完整依赖清单：');
  for (const item of vendorBrowserList) {
    console.error(`- ${item.label}: ${item.file}`);
  }
}

/**
 * 判断文件是否存在且当前进程可以访问。
 */
async function hasFile(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

await main();
