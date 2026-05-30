import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase, updateCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import { generatePracticalReviewSpec } from '../../server/src/services/practical-review/practical-review-spec';
import { renderPracticalLocator } from '../../server/src/services/practical-review/practical-review-locator';
import { runPracticalReview } from '../../server/src/services/practical-review/practical-review';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('../../server/src/services/playwright/vendor-browser', () => ({
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

  it('生成脚本时会用 selectorDraft 渲染内部 Locator', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "locator('tr').filter({ has: getByRole('button', { name: '编辑' }) })",
          selectorDraft: {
            mode: 'css',
            value: 'tr',
            has: {
              mode: 'role',
              role: 'button',
              value: '编辑'
            }
          }
        }
      ]
    });

    expect(code).toContain("page.locator('tr').filter({ has: page.getByRole('button', { name: '编辑' }) }).click()");
  });

  it('生成脚本时把手写 CSS 定位器渲染为 locator 调用', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        {
          id: 's1',
          type: 'click',
          selector: "button:has-text('新增')",
          selectorDraft: {
            mode: 'advanced',
            value: {
              kind: 'text',
              text: '',
              flags: ''
            },
            indexMode: 'none',
            advancedSelector: "button:has-text('新增')"
          }
        }
      ]
    });

    expect(code).toContain("page.locator('button:has-text(\\'新增\\')').click()");
    expect(code).not.toContain('page.button:has-text');
  });

  it('生成实测脚本时 Kendo 下拉使用点击控件和选项文本', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        {
          id: 's1',
          type: 'select',
          selector: "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')",
          value: '采购'
        }
      ]
    });

    expect(code).toContain("await recordStep({ stepId: \"s1\"");
    expect(code).toContain("page.locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist').click()");
    expect(code).toContain("page.getByRole('option', { name: \"采购\" }).or(page.getByText(\"采购\", { exact: true })).first().click()");
    expect(code).not.toContain('.selectOption(');
  });

  it('生成实测脚本时 Kendo data-role 下拉使用点击控件和选项文本', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        {
          id: 's1',
          type: 'select',
          selector: "locator('[data-role=\"combobox\"]')",
          value: '长期客户'
        }
      ]
    });

    expect(code).toContain("page.locator('[data-role=\"combobox\"]').click()");
    expect(code).toContain("page.getByRole('option', { name: \"长期客户\" }).or(page.getByText(\"长期客户\", { exact: true })).first().click()");
    expect(code).not.toContain('.selectOption(');
  });

  it('生成实测脚本时原生 select 的 combobox role 和 aria-label locator 保持 selectOption', () => {
    const code = generatePracticalReviewSpec({
      startUrl: 'https://crm.test.local/orders',
      resultPath: 'D:/tmp/review-result.json',
      screenshotDir: 'D:/tmp/screenshots',
      steps: [
        { id: 's1', type: 'select', selector: "getByRole('combobox', { name: '状态' })", value: '启用' },
        { id: 's2', type: 'select', selector: "locator('[aria-label=\"状态\"]')", value: '停用' }
      ]
    });

    expect(code).toContain("page.getByRole('combobox', { name: '状态' }).selectOption(\"启用\")");
    expect(code).toContain("page.locator('[aria-label=\"状态\"]').selectOption(\"停用\")");
    expect(code).not.toContain("getByRole('option'");
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
    expect(spawnMock.mock.calls[0][0]).toBe(process.execPath);
    expect(args[0]).toContain('@playwright');
    expect(args).toEqual(expect.arrayContaining(['test', '--config', 'playwright.config.ts']));
    expect(spawnMock.mock.calls[0][2]).toEqual(expect.objectContaining({ shell: false }));
    expect(options.env.PLAYWRIGHT_TEST_DIR).toContain('reviews\\work\\');
    expect(options.env.PLAYWRIGHT_TEST_MATCH).toBe('practical-review.spec.ts');
    expect(options.env.PLAYWRIGHT_AUTO_OUTPUT).toContain('playwright-output');
  });

  it('浏览器执行时默认使用无头运行', async () => {
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
    expect(options.env.PLAYWRIGHT_HEADLESS).toBe('true');
  });

  it('浏览器执行时可切换为可视调试', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });
    spawnMock.mockImplementation(() => createSpawnResult(1, 'Error: No tests found.'));

    await runPracticalReview('crm', item.key, { envKey: 'default', mode: 'headed' }).catch(() => undefined);

    const options = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.PLAYWRIGHT_HEADLESS).toBe('false');
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

  it('浏览器进程启动失败时返回原始错误', async () => {
    process.env.NODE_ENV = 'development';
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });
    spawnMock.mockImplementation(() => createSpawnError(new Error('spawn failed')));

    await expect(runPracticalReview('crm', item.key, { envKey: 'default' })).rejects.toThrow('spawn failed');
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

function createSpawnError(error: Error) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  setTimeout(() => {
    child.emit('error', error);
  }, 0);

  return child;
}
