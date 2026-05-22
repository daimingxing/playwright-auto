import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase, updateCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import { generatePracticalReviewSpec } from '../../server/src/services/practical-review-spec';
import { renderPracticalLocator } from '../../server/src/services/practical-review-locator';
import { runPracticalReview } from '../../server/src/services/practical-review';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('../../server/src/services/vendor-browser', () => ({
  assertVendorBrowser: vi.fn(),
  getVendorEnv: vi.fn(() => ({}))
}));

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-practical-review-service-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('实测检查服务', () => {
  it('会把存储的定位表达式渲染成当前页面 locator', () => {
    expect(renderPracticalLocator("getByRole('button', { name: '保存' })", 'page')).toBe("page.getByRole('button', { name: '保存' })");
    expect(renderPracticalLocator('#save', 'page')).toBe('page.locator("#save")');
    expect(renderPracticalLocator("page1.getByText('保存成功')", 'page')).toBe("page.getByText('保存成功')");
  });

  it('测试环境下实测通过时生成 passed 记录并更新摘要', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });

    const record = await runPracticalReview('crm', item.key, { envKey: 'default' });

    expect(record.status).toBe('passed');
    expect(record.summary.status).toBe('passed');
    expect(record.steps[0]).toMatchObject({
      stepId: 's1',
      status: 'passed'
    });
  });

  it('测试环境下定位失败时生成失败分析', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '不存在' })" }]
    });

    const record = await runPracticalReview('crm', item.key, {
      envKey: 'default',
      testFailure: {
        stepId: 's1',
        code: 'no-match',
        message: '未找到目标元素',
        suggestion: '请确认按钮文案是否变化'
      }
    });

    expect(record.status).toBe('failed');
    expect(record.summary).toMatchObject({
      status: 'failed',
      failedStepId: 's1',
      failureMessage: '未找到目标元素'
    });
    expect(record.steps[0].analysis).toMatchObject({
      code: 'no-match',
      message: '未找到目标元素'
    });
  });

  it('生成带步骤探针的实测检查脚本', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        { id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" },
        { id: 's2', type: 'assertVisible', selector: "getByText('保存成功')" }
      ]
    });

    expect(code).toContain('await page.goto("https://crm.test.local/orders")');
    expect(code).toContain("page.getByRole('button', { name: '保存' })");
    expect(code).toContain('await writeReviewResult');
    expect(code).toContain('stepId: "s1"');
  });

  it('生成脚本时会安全转义带单引号的选择器元数据', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "locator('div').filter({ hasText: /^能源管控$/ }).nth(2)"
        }
      ]
    });
    expect(code).toContain("\"locator('div').filter({ hasText: /^能源管控$/ }).nth(2)\"");
    expect(code).not.toContain("selector: 'locator('div')");
  });

  it('浏览器执行未生成结果文件时返回清晰错误', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });
    spawnMock.mockImplementation(() => createSpawnResult(1, 'Error: No tests found.'));

    const error = await runPracticalReview('crm', item.key, { envKey: 'default' }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('实测检查未生成结果文件');
    expect((error as Error).message).not.toContain('ENOENT');
  });

  it('浏览器执行生成损坏结果文件时返回清晰错误', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });
    spawnMock.mockImplementation((_command: string, _args: string[], options: { env: Record<string, string> }) => {
      const resultPath = join(options.env.PLAYWRIGHT_TEST_DIR, '..', 'review-result.json');
      return createSpawnResult(0, '', async () => {
        await writeFile(resultPath, '{bad-json', 'utf8');
      });
    });

    const error = await runPracticalReview('crm', item.key, { envKey: 'default' }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('实测检查结果文件格式错误');
    expect((error as Error).message).not.toContain('Unexpected token');
  });

  it('浏览器执行时使用临时 testDir 发现实测脚本', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });
    spawnMock.mockImplementation(() => createSpawnResult(1, 'Error: No tests found.'));

    await runPracticalReview('crm', item.key, { envKey: 'default' }).catch(() => undefined);

    const args = spawnMock.mock.calls[0][1] as string[];
    const options = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(args).toEqual(['playwright', 'test', '--config', 'playwright.config.ts']);
    expect(options.env.PLAYWRIGHT_TEST_DIR).toContain('reviews\\work\\');
    expect(options.env.PLAYWRIGHT_TEST_MATCH).toBe('practical-review.spec.ts');
    expect(options.env.PLAYWRIGHT_AUTO_OUTPUT).toContain('playwright-output');
  });

  it('未保存登录态时不会传递空的 storageState 路径', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });
    spawnMock.mockImplementation(() => createSpawnResult(1, 'Error: No tests found.'));

    await runPracticalReview('crm', item.key, { envKey: 'default' }).catch(() => undefined);

    const options = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env).not.toHaveProperty('PLAYWRIGHT_STORAGE_STATE');
  });
});

function createSpawnResult(code: number, output: string, beforeExit?: () => Promise<void>) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setTimeout(async () => {
    await beforeExit?.();
    child.stderr.emit('data', Buffer.from(output));
    child.emit('exit', code);
  }, 0);

  return child;
}
