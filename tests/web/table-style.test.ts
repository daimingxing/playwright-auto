import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageFiles = [
  'web/src/pages/case-editor/CaseEditor.vue',
  'web/src/pages/project-detail/ProjectDetail.vue',
  'web/src/pages/project-list/ProjectList.vue',
  'web/src/pages/run-center/RunCenter.vue'
];

describe('表格展示样式约束', () => {
  it('所有 Element Plus 表格都启用隔行底色', () => {
    for (const file of pageFiles) {
      const content = readFileSync(file, 'utf8');
      const tables = content.match(/<el-table(?!-column)\b[^>]*>/g) ?? [];

      expect(tables.length, `${file} 应至少包含一个表格`).toBeGreaterThan(0);

      for (const table of tables) {
        expect(table, `${file} 的表格缺少 stripe：${table}`).toContain('stripe');
      }
    }
  });

  it('表格状态色区分隔行、悬停和步骤选中', () => {
    const content = readFileSync('web/src/styles/table.css', 'utf8');
    const caseEditor = readFileSync('web/src/pages/case-editor/CaseEditor.vue', 'utf8');
    const stripeRule = '.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell';
    const hoverRule = '.el-table__body tr.hover-row > td.el-table__cell';
    const nativeHoverRule = '.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell';

    expect(content).toContain(stripeRule);
    expect(content).toContain(hoverRule);
    expect(content).toContain(nativeHoverRule);
    expect(content.indexOf(hoverRule)).toBeGreaterThan(content.indexOf(stripeRule));
    expect(content.indexOf(nativeHoverRule)).toBeGreaterThan(content.indexOf(stripeRule));
    expect(content).toContain('--el-table-row-hover-bg-color: #e8f2ff');
    expect(content).toContain('background: #f7f9fc');
    expect(caseEditor).toContain('background: #dbeafe');
  });
});
