import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';

const ACTION_TYPES = ['打开页面', '填写', '选择', '点击', '检查可见', '检查文本'];
const CASE_HEADER = ['用例编号', '用例名称', '起始路径', '前置条件', '预期结果', '备注'];
const STEP_HEADER = ['用例编号', '步骤序号', '动作类型', '目标', '数据', '补充说明'];
const EMPTY_CASE_ROWS = 8;
const EMPTY_STEP_ROWS = 40;

const workbook = new ExcelJS.Workbook();
workbook.creator = 'playwright-auto';

const cases = workbook.addWorksheet('用例');
const steps = workbook.addWorksheet('步骤');

styleHeader(cases.addRow(CASE_HEADER));
styleHeader(steps.addRow(STEP_HEADER));

cases.addRow([
  'TC-001',
  '打开首页并查看关键入口',
  '/',
  '已进入项目所选环境对应站点',
  '页面打开，关键入口可见',
  '起始路径只写相对路径，不要填环境地址'
]);

for (let index = 0; index < EMPTY_CASE_ROWS; index += 1) {
  cases.addRow(['', '', '', '', '', '']);
}

steps.addRow(['TC-001', 1, '打开页面', '/', '', '与用例起始路径一致']);
steps.addRow(['TC-001', 2, '检查可见', '登录', '', '改成页面上真实可见的文案']);
steps.addRow(['TC-001', 3, '点击', '登录', '', '改成要点的真实按钮']);

for (let index = 0; index < EMPTY_STEP_ROWS; index += 1) {
  steps.addRow(['', '', '', '', '', '']);
}

const lastStepRow = 1 + 3 + EMPTY_STEP_ROWS;
// 选项很少，用单元格内列表即可，避免多一张用户看不到用途的工作表。
steps.dataValidations.add(`C2:C${lastStepRow}`, {
  type: 'list',
  allowBlank: true,
  formulae: [`"${ACTION_TYPES.join(',')}"`],
  showErrorMessage: true,
  errorStyle: 'error',
  errorTitle: '动作类型无效',
  error: `只能选择：${ACTION_TYPES.join('、')}`,
  showInputMessage: true,
  promptTitle: '动作类型',
  prompt: '请从下拉列表选择，不要手写 Playwright 步骤类型。'
});

CASE_HEADER.forEach((header, index) => {
  cases.getColumn(index + 1).width = Math.max(12, header.length * 2 + 4);
});
STEP_HEADER.forEach((header, index) => {
  steps.getColumn(index + 1).width = Math.max(12, header.length * 2 + 4);
});
cases.views = [{ state: 'frozen', ySplit: 1 }];
steps.views = [{ state: 'frozen', ySplit: 1 }];

await mkdir('docs/templates', { recursive: true });
const outputPath = 'docs/templates/ai-import-template.xlsx';
try {
  await workbook.xlsx.writeFile(outputPath);
  console.log(`wrote ${outputPath}`);
} catch (error) {
  const fallbackPath = 'docs/templates/ai-import-template.new.xlsx';
  await workbook.xlsx.writeFile(fallbackPath);
  console.error(`无法覆盖 ${outputPath}（文件可能正在被 Excel 打开），已写到 ${fallbackPath}`);
  process.exitCode = 2;
}

/**
 * 表头加粗，提示这是固定列名。
 */
function styleHeader(row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EEF7' }
    };
  });
}
