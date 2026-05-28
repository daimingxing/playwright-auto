import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseImportExcel } from '../../server/src/services/import/import-excel';

describe('AI 导入 Excel 解析', () => {
  it('解析新版两表模板并返回结构化步骤', async () => {
    const buffer = await createWorkbookBuffer();
    const result = await parseImportExcel(buffer);

    expect(result).toHaveLength(1);
    expect(result[0].caseInfo).toMatchObject({
      caseNo: 'TC001',
      caseName: '新增用户',
      targetUrl: '/user/list',
      expectedResult: ''
    });
    expect(result[0].steps).toEqual([
      {
        caseNo: 'TC001',
        stepNo: 1,
        actionType: 'click',
        targetType: 'button',
        targetName: '新增',
        inputValue: '',
        actionText: '点击(click)',
        targetText: '按钮(button)',
        dataKeys: [],
        note: '打开新增窗口'
      },
      {
        caseNo: 'TC001',
        stepNo: 2,
        actionType: 'fill',
        targetType: 'input',
        targetName: '用户名称',
        inputValue: '测试用户001',
        actionText: 'fill',
        targetText: 'input',
        dataKeys: [],
        note: ''
      },
      {
        caseNo: 'TC001',
        stepNo: 3,
        actionType: 'assertText',
        targetType: 'text',
        targetName: '成功提示',
        inputValue: '添加成功',
        matchType: 'contains',
        actionText: '检查文本(assertText)',
        targetText: '文本(text)',
        dataKeys: [],
        note: ''
      }
    ]);
    expect(result[0].data).toEqual([]);
    expect(result[0].rowRefs.dataRows).toEqual([]);
    expect(result[0].steps[0]).not.toHaveProperty('matchType');
    expect(result[0].steps[1]).not.toHaveProperty('matchType');
  });

  it('支持全角括号和括号内外空格的枚举值', async () => {
    const buffer = await createWorkbookBuffer({
      actionValue: '点击（click）',
      targetValue: '按钮 ( button )',
      matchValue: '包含 ( contains )'
    });
    const result = await parseImportExcel(buffer);

    expect(result[0].steps[0]).toMatchObject({
      actionType: 'click',
      targetType: 'button'
    });
    expect(result[0].steps[2]).toMatchObject({
      matchType: 'contains'
    });
  });

  it('缺少新版两表必填列时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ omitStepColumn: '目标类型' });

    await expect(parseImportExcel(buffer)).rejects.toThrow('新版两表步骤明细缺少必填列：目标类型');
  });

  it('缺少新版两表必填值时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ blankStepValue: true });

    await expect(parseImportExcel(buffer)).rejects.toThrow('步骤明细第 2 行目标名称不能为空');
  });

  it('步骤序号不连续时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ stepNos: [1, 3, 4] });

    await expect(parseImportExcel(buffer)).rejects.toThrow('用例 TC001 的步骤序号必须从 1 连续递增');
  });

  it('未知动作类型时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ actionValue: '提交(submit)' });

    await expect(parseImportExcel(buffer)).rejects.toThrow('步骤明细第 2 行动作类型不支持：提交(submit)');
  });

  it('未知目标类型时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ targetValue: '区域(area)' });

    await expect(parseImportExcel(buffer)).rejects.toThrow('步骤明细第 2 行目标类型不支持：区域(area)');
  });

  it('未知匹配方式时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ matchValue: '前缀(prefix)' });

    await expect(parseImportExcel(buffer)).rejects.toThrow('步骤明细第 4 行匹配方式不支持：前缀(prefix)');
  });

  it('旧版三表模板仍可解析', async () => {
    const buffer = await createOldWorkbookBuffer();
    const result = await parseImportExcel(buffer);

    expect(result).toHaveLength(1);
    expect(result[0].caseInfo).toMatchObject({
      caseNo: 'TC001',
      caseName: '新增用户',
      targetUrl: '/user/list',
      expectedResult: '信息提示添加成功'
    });
    expect(result[0].steps.map((step) => step.actionText)).toEqual(['点击新增按钮，打开新增窗口', '输入用户名称']);
    expect(result[0].data[0]).toMatchObject({
      dataKey: 'username',
      dataValue: '测试用户001'
    });
  });

  it('同时存在新版步骤列和旧版测试数据表时优先按新版两表解析', async () => {
    const buffer = await createMixedWorkbookBuffer();
    const result = await parseImportExcel(buffer);

    expect(result).toHaveLength(1);
    expect(result[0].steps[0]).toMatchObject({
      actionType: 'click',
      targetType: 'button',
      targetName: '新增',
      inputValue: ''
    });
    expect(result[0].steps[0]).not.toHaveProperty('matchType');
    expect(result[0].data).toEqual([]);
    expect(result[0].rowRefs.dataRows).toEqual([]);
  });

  it('部分新版列与旧版三表混用时返回新版缺列错误', async () => {
    const buffer = await createMixedWorkbookBuffer({ omitNewColumn: '目标类型' });

    await expect(parseImportExcel(buffer)).rejects.toThrow('新版两表步骤明细缺少必填列：目标类型');
  });

  it('旧版三表数据引用不存在时返回中文错误', async () => {
    const buffer = await createOldWorkbookBuffer({ badDataKey: true });

    await expect(parseImportExcel(buffer)).rejects.toThrow('数据引用不存在');
  });

  it('旧版三表缺少预期结果时返回中文错误', async () => {
    const buffer = await createOldWorkbookBuffer({ blankExpected: true });

    await expect(parseImportExcel(buffer)).rejects.toThrow('用例清单第 2 行预期结果不能为空');
  });
});

/**
 * 创建覆盖新版两表导入结构的测试工作簿。
 */
async function createWorkbookBuffer(
  options: {
    actionValue?: string;
    targetValue?: string;
    matchValue?: string;
    omitStepColumn?: string;
    blankStepValue?: boolean;
    stepNos?: number[];
  } = {}
) {
  const workbook = new ExcelJS.Workbook();
  const cases = workbook.addWorksheet('用例清单');
  cases.addRow(['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注']);
  cases.addRow(['TC001', '新增用户', '/user/list', '已登录管理员账号', '', '']);

  const headers = ['用例编号', '步骤序号', '动作类型', '目标类型', '目标名称', '输入/期望值', '匹配方式', '备注'];
  const steps = workbook.addWorksheet('步骤明细');
  steps.addRow(headers.filter((header) => header !== options.omitStepColumn));

  addStepRow(steps, headers, options, [
    'TC001',
    options.stepNos?.[0] ?? 1,
    options.actionValue ?? '点击(click)',
    options.targetValue ?? '按钮(button)',
    options.blankStepValue ? '' : '新增',
    '',
    '',
    '打开新增窗口'
  ]);
  addStepRow(steps, headers, options, [
    'TC001',
    options.stepNos?.[1] ?? 2,
    'fill',
    'input',
    '用户名称',
    '测试用户001',
    '',
    ''
  ]);
  addStepRow(steps, headers, options, [
    'TC001',
    options.stepNos?.[2] ?? 3,
    '检查文本(assertText)',
    '文本(text)',
    '成功提示',
    '添加成功',
    options.matchValue ?? '包含(contains)',
    ''
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * 按当前表头写入步骤行，便于模拟缺列场景。
 */
function addStepRow(steps: ExcelJS.Worksheet, headers: string[], options: { omitStepColumn?: string }, values: unknown[]) {
  steps.addRow(values.filter((_, index) => headers[index] !== options.omitStepColumn));
}

/**
 * 创建覆盖旧版三表导入结构的测试工作簿。
 */
async function createOldWorkbookBuffer(options: { badDataKey?: boolean; blankExpected?: boolean } = {}) {
  const workbook = new ExcelJS.Workbook();
  const cases = workbook.addWorksheet('用例清单');
  cases.addRow(['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注']);
  cases.addRow(['TC001', '新增用户', '/user/list', '已登录管理员账号', options.blankExpected ? '' : '信息提示添加成功', '']);

  const steps = workbook.addWorksheet('步骤明细');
  steps.addRow(['用例编号', '步骤序号', '操作描述', '目标对象', '数据引用', '备注']);
  steps.addRow(['TC001', 1, '点击新增按钮，打开新增窗口', '新增按钮', '', '']);
  steps.addRow(['TC001', 2, '输入用户名称', '用户名称输入框', options.badDataKey ? 'missing' : 'username', '']);

  const data = workbook.addWorksheet('测试数据');
  data.addRow(['用例编号', '数据标识', '数据名称', '数据值', '说明']);
  data.addRow(['TC001', 'username', '用户名称', '测试用户001', '输入用户名']);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * 创建同时包含新版步骤列和旧版三表遗留列的测试工作簿。
 */
async function createMixedWorkbookBuffer(options: { omitNewColumn?: string } = {}) {
  const workbook = new ExcelJS.Workbook();
  const cases = workbook.addWorksheet('用例清单');
  cases.addRow(['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注']);
  cases.addRow(['TC001', '新增用户', '/user/list', '已登录管理员账号', '', '']);

  const steps = workbook.addWorksheet('步骤明细');
  const headers = [
    '用例编号',
    '步骤序号',
    '动作类型',
    '目标类型',
    '目标名称',
    '输入/期望值',
    '匹配方式',
    '备注',
    '操作描述',
    '目标对象',
    '数据引用'
  ];
  steps.addRow(headers.filter((header) => header !== options.omitNewColumn));
  steps.addRow(
    ['TC001', 1, '点击(click)', '按钮(button)', '新增', '', '', '打开新增窗口', '旧版点击新增', '旧版新增按钮', 'username'].filter(
      (_, index) => headers[index] !== options.omitNewColumn
    )
  );

  const data = workbook.addWorksheet('测试数据');
  data.addRow(['用例编号', '数据标识', '数据名称', '数据值', '说明']);
  data.addRow(['TC001', 'username', '用户名称', '旧版测试用户', '旧版数据']);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
