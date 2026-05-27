import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseImportExcel } from '../../server/src/services/import/import-excel';

describe('AI 导入 Excel 解析', () => {
  it('解析用例清单、步骤明细和测试数据', async () => {
    const buffer = await createWorkbookBuffer();
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

  it('数据引用不存在时返回中文错误', async () => {
    const buffer = await createWorkbookBuffer({ badDataKey: true });

    await expect(parseImportExcel(buffer)).rejects.toThrow('数据引用不存在');
  });
});

/**
 * 创建覆盖三张导入工作表的测试工作簿。
 */
async function createWorkbookBuffer(options: { badDataKey?: boolean } = {}) {
  const workbook = new ExcelJS.Workbook();
  const cases = workbook.addWorksheet('用例清单');
  cases.addRow(['用例编号', '用例名称', '目标页面URL', '前置条件', '预期结果', '备注']);
  cases.addRow(['TC001', '新增用户', '/user/list', '已登录管理员账号', '信息提示添加成功', '']);

  const steps = workbook.addWorksheet('步骤明细');
  steps.addRow(['用例编号', '步骤序号', '操作描述', '目标对象', '数据引用', '备注']);
  steps.addRow(['TC001', 1, '点击新增按钮，打开新增窗口', '新增按钮', '', '']);
  steps.addRow(['TC001', 2, '输入用户名称', '用户名称输入框', options.badDataKey ? 'missing' : 'username', '']);

  const data = workbook.addWorksheet('测试数据');
  data.addRow(['用例编号', '数据标识', '数据名称', '数据值', '说明']);
  data.addRow(['TC001', 'username', '用户名称', '测试用户001', '输入用户名']);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
