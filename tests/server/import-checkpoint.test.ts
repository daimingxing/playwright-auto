import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { readJson, writeJson } from '../../server/src/lib/fs';
import { createImportTask, readImportCheckpoint, resumeImportTask } from '../../server/src/lib/import-store';
import { createProject } from '../../server/src/lib/project-store';
import * as importExcel from '../../server/src/services/import/import-excel';

type StatusFile = {
  id: string;
  status: string;
  checkpointedAt: string;
};

let root = '';
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-checkpoint-'));
  process.env.DATA_ROOT = root;
  await createProject({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('导入任务检查点', () => {
  it('中断后恢复跳过已成功项、续做未完成项，且不重新解析 Excel', async () => {
    const created = await createImportTask('crm', {
      fileName: 'orders.xlsx',
      buffer: await buildTwoCaseWorkbook()
    });
    const taskDir = join(root, 'projects', 'crm', 'imports', created.id);
    const first = created.cases[0];
    const second = created.cases[1];
    const firstStatusPath = join(taskDir, 'cases', first.id, 'status.json');
    const firstStatus = await readJson<StatusFile>(firstStatusPath);

    await rm(join(taskDir, 'cases', second.id), { recursive: true, force: true });
    await writeJson(join(taskDir, 'checkpoint.json'), {
      stage: 'items',
      updatedAt: new Date().toISOString(),
      items: [{ id: first.id, status: first.status }]
    });
    const parseSpy = vi.spyOn(importExcel, 'parseImportExcel');

    const resumed = await resumeImportTask('crm', created.id);

    expect(parseSpy).not.toHaveBeenCalled();
    expect(resumed.skippedItemIds).toEqual([first.id]);
    expect(resumed.processedItemIds).toEqual([second.id]);
    expect((await readJson<StatusFile>(firstStatusPath)).checkpointedAt).toBe(firstStatus.checkpointedAt);
    expect((await readImportCheckpoint('crm', created.id)).stage).toBe('completed');
    expect(resumed.input.assetId).toBe(created.assetId);
  });

  it('半截检查点临时文件不会毁掉上一份可读检查点', async () => {
    const created = await createImportTask('crm', {
      fileName: 'orders.xlsx',
      buffer: await buildTwoCaseWorkbook()
    });
    const taskDir = join(root, 'projects', 'crm', 'imports', created.id);
    const before = await readFile(join(taskDir, 'checkpoint.json'), 'utf8');
    await writeFile(join(taskDir, 'checkpoint.json.tmp'), '{not-json');

    const checkpoint = await readImportCheckpoint('crm', created.id);

    expect(checkpoint.stage).toBe('completed');
    expect(await readFile(join(taskDir, 'checkpoint.json'), 'utf8')).toBe(before);
  });
});

/**
 * 创建包含两条有效用例的双表 Excel。
 */
function buildTwoCaseWorkbook() {
  return buildXlsx({
    用例: [
      CASE_HEADER,
      ['TC-001', '创建订单', '/orders/create', '', '', ''],
      ['TC-002', '查询订单', '/orders', '', '', '']
    ],
    步骤: [
      STEP_HEADER,
      ['TC-001', 1, '点击', '提交', '', ''],
      ['TC-002', 1, '打开页面', '/orders', '', '']
    ]
  });
}

/**
 * 按工作表名和行列值现场创建 xlsx 缓冲区。
 */
async function buildXlsx(sheets: Record<string, Array<Array<string | number>>>) {
  const workbook = new ExcelJS.Workbook();

  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);

    for (const row of rows) {
      sheet.addRow(row);
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
