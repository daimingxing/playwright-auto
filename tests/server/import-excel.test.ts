import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseImportExcel } from '../../server/src/services/import/import-excel';

const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];
const VALID_CASE = ['TC-001', '创建订单', '/orders/create', '已登录', '创建成功', ''];
const VALID_STEPS: Array<Array<string | number>> = [
  ['TC-001', 1, '打开页面', '/orders/create', '', ''],
  ['TC-001', 2, '填写', '订单名称', '测试订单', ''],
  ['TC-001', 3, '点击', '提交', '', '']
];

describe('AI 导入 Excel 解析', () => {
  it('解析合法双表并保留来源行', async () => {
    const buffer = await buildXlsx({
      用例: [CASE_HEADER, VALID_CASE],
      步骤: [STEP_HEADER, ...VALID_STEPS]
    });

    const result = await parseImportExcel(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.status).toBe('parsed');
    expect(result.cases[0]?.caseNumber).toBe('TC-001');
    expect(result.cases[0]?.startPath).toBe('/orders/create');
    expect(result.cases[0]?.source).toMatchObject({
      sheet: '用例',
      row: 2,
      caseNumber: 'TC-001'
    });
    expect(result.cases[0]?.source.cells['用例名称']).toBe('创建订单');
    expect(result.cases[0]?.steps.map((item) => item.action)).toEqual(['打开页面', '填写', '点击']);
    expect(result.cases[0]?.steps[1]?.source).toMatchObject({
      sheet: '步骤',
      row: 3,
      caseNumber: 'TC-001'
    });
    expect(result.cases[0]).not.toHaveProperty('id');
  });

  it('缺少工作表时整批失败并返回工作表和原因', async () => {
    const buffer = await buildXlsx({
      用例清单: [CASE_HEADER, VALID_CASE],
      步骤明细: [STEP_HEADER, ...VALID_STEPS]
    });

    const result = await parseImportExcel(buffer);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: '用例', row: 0, reason: '缺少工作表「用例」' }),
        expect.objectContaining({ sheet: '步骤', row: 0, reason: '缺少工作表「步骤」' })
      ])
    );
  });

  it('缺少列或重复列时整批失败并定位到表头行', async () => {
    const missing = await parseImportExcel(
      await buildXlsx({
        用例: [['用例编号', '用例名称'], VALID_CASE],
        步骤: [STEP_HEADER, ...VALID_STEPS]
      })
    );
    const duplicated = await parseImportExcel(
      await buildXlsx({
        用例: [['用例编号', '用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'], VALID_CASE],
        步骤: [STEP_HEADER, ...VALID_STEPS]
      })
    );

    expect(missing.ok).toBe(false);
    expect(duplicated.ok).toBe(false);
    if (missing.ok || duplicated.ok) {
      return;
    }

    expect(missing.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: '用例', row: 1, reason: '缺少列「起始路径」' })
      ])
    );
    expect(duplicated.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: '用例', row: 1, reason: '列「用例编号」重复' })
      ])
    );
  });

  it('非法动作类型、空必填和行关联错误隔离到单条用例', async () => {
    const buffer = await buildXlsx({
      用例: [
        CASE_HEADER,
        VALID_CASE,
        ['TC-002', '查询订单', '/orders', '', '', ''],
        ['TC-003', '', 'https://crm.test.local/orders', '', '', '']
      ],
      步骤: [
        STEP_HEADER,
        ...VALID_STEPS,
        ['TC-002', 1, 'hover', '查询', '', ''],
        ['TC-004', 1, '点击', '导出', '', '']
      ]
    });

    const result = await parseImportExcel(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const byNumber = Object.fromEntries(result.cases.map((item) => [item.caseNumber, item]));
    expect(byNumber['TC-001']?.status).toBe('parsed');
    expect(byNumber['TC-002']?.status).toBe('parse-failed');
    expect(byNumber['TC-002']?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheet: '步骤',
          row: 5,
          reason: '动作类型必须是：打开页面、填写、选择、点击、检查可见、检查文本'
        })
      ])
    );
    expect(byNumber['TC-003']?.status).toBe('parse-failed');
    expect(byNumber['TC-003']?.errors.map((item) => item.reason)).toEqual(
      expect.arrayContaining(['用例名称不能为空', '起始路径必须是相对路径，不能填写环境地址', '没有关联步骤'])
    );
    expect(byNumber['TC-004']?.status).toBe('parse-failed');
    expect(byNumber['TC-004']?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: '步骤', reason: '用例表中不存在该用例编号' })
      ])
    );
  });

  it('填写缺数据和目标为空只失败对应用例', async () => {
    const buffer = await buildXlsx({
      用例: [
        CASE_HEADER,
        VALID_CASE,
        ['TC-010', '选择商品', '/goods', '', '', '']
      ],
      步骤: [
        STEP_HEADER,
        ...VALID_STEPS,
        ['TC-010', 1, '填写', '数量', '', ''],
        ['TC-010', 2, '点击', '', '', '']
      ]
    });

    const result = await parseImportExcel(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const byNumber = Object.fromEntries(result.cases.map((item) => [item.caseNumber, item]));
    expect(byNumber['TC-001']?.status).toBe('parsed');
    expect(byNumber['TC-010']?.status).toBe('parse-failed');
    expect(byNumber['TC-010']?.errors.map((item) => item.reason)).toEqual(
      expect.arrayContaining(['数据不能为空', '目标不能为空'])
    );
  });

  it('用例编号重复只失败重复项，且不把 Playwright 步骤类型当作动作', async () => {
    const buffer = await buildXlsx({
      用例: [
        CASE_HEADER,
        VALID_CASE,
        ['TC-001', '重复编号', '/orders', '', '', ''],
        ['TC-020', '检查库存', '/stock', '', '', '']
      ],
      步骤: [
        STEP_HEADER,
        ...VALID_STEPS,
        ['TC-001', 1, '点击', '确认', '', ''],
        ['TC-020', 1, 'click', '库存', '', '']
      ]
    });

    const result = await parseImportExcel(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const duplicates = result.cases.filter((item) => item.caseNumber === 'TC-001');
    const stock = result.cases.find((item) => item.caseNumber === 'TC-020');

    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((item) => item.status === 'parse-failed')).toBe(true);
    expect(duplicates[0]?.errors.map((item) => item.reason)).toContain('用例编号在文件内重复');
    expect(stock?.status).toBe('parse-failed');
    expect(stock?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: '动作类型必须是：打开页面、填写、选择、点击、检查可见、检查文本'
        })
      ])
    );
  });

  it('接受全部业务动作类型并按序号排序', async () => {
    const buffer = await buildXlsx({
      用例: [CASE_HEADER, ['TC-030', '筛选订单', '/orders', '', '列表可见', '']],
      步骤: [
        STEP_HEADER,
        ['TC-030', 3, '选择', '状态', '已提交', ''],
        ['TC-030', 1, '打开页面', '/orders', '', ''],
        ['TC-030', 5, '检查文本', '标题', '订单', ''],
        ['TC-030', 2, '填写', '关键字', 'A-1', ''],
        ['TC-030', 4, '点击', '查询', '', ''],
        ['TC-030', 6, '检查可见', '结果表', '', '']
      ]
    });

    const result = await parseImportExcel(buffer);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.cases[0]?.status).toBe('parsed');
    expect(result.cases[0]?.steps.map((item) => item.action)).toEqual([
      '打开页面',
      '填写',
      '选择',
      '点击',
      '检查文本',
      '检查可见'
    ]);
  });

  it('结构错误时不返回任何用例', async () => {
    const result = await parseImportExcel(
      await buildXlsx({
        用例: [CASE_HEADER, VALID_CASE]
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.errors[0]).toMatchObject({ sheet: '步骤', row: 0, reason: '缺少工作表「步骤」' });
    expect('cases' in result).toBe(false);
  });
});

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
