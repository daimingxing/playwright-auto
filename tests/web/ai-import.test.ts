import { describe, expect, it } from 'vitest';
import {
  canConfirmImportCase,
  canPublishImportCase,
  canRetryImportCase,
  formatImportCaseStatus,
  formatImportSummary,
  formatParseError,
  formatSourceRef,
  getImportErrors,
  hasParsedCases
} from '../../web/src/pages/ai-import/ai-import';

describe('AI 导入展示文案', () => {
  it('只展示已解析和解析失败', () => {
    expect(formatImportCaseStatus('parsed')).toEqual({ label: '已解析', type: 'success' });
    expect(formatImportCaseStatus('parse-failed')).toEqual({ label: '解析失败', type: 'danger' });
  });

  it('把结构错误和内容错误格式化为工作表加行号', () => {
    expect(
      formatParseError({
        sheet: '用例',
        row: 0,
        reason: '缺少工作表「用例」'
      })
    ).toBe('「用例」：缺少工作表「用例」');
    expect(
      formatParseError({
        sheet: '步骤',
        row: 5,
        caseNumber: 'TC-002',
        reason: '动作类型必须是：打开页面、填写、选择、点击、检查可见、检查文本'
      })
    ).toBe('「步骤」第 5 行：动作类型必须是：打开页面、填写、选择、点击、检查可见、检查文本');
  });

  it('展示审阅阶段，并区分确认与重试', () => {
    expect(formatImportCaseStatus('exploring')).toEqual({ label: '探索中', type: 'warning' });
    expect(formatImportCaseStatus('generating')).toEqual({ label: '生成中', type: 'warning' });
    expect(formatImportCaseStatus('pending-review')).toEqual({ label: '待确认', type: 'warning' });
    expect(formatImportCaseStatus('publishable')).toEqual({ label: '可发布', type: 'success' });
    expect(formatImportCaseStatus('published')).toEqual({ label: '已发布', type: 'success' });
    expect(formatImportCaseStatus('failed')).toEqual({ label: '失败', type: 'danger' });
    expect(canConfirmImportCase('pending-review')).toBe(true);
    expect(canConfirmImportCase('publishable')).toBe(false);
    expect(canRetryImportCase('failed')).toBe(true);
    expect(canRetryImportCase('publishable')).toBe(false);
    expect(canRetryImportCase('published')).toBe(false);
    expect(canRetryImportCase('parse-failed')).toBe(false);
    expect(canPublishImportCase('publishable')).toBe(true);
    expect(canPublishImportCase('published')).toBe(false);
    expect(formatSourceRef({ sheet: '步骤', row: 3, caseNumber: 'TC-001', cells: {} })).toBe(
      '「步骤」第 3 行 · TC-001'
    );
    expect(hasParsedCases([{ status: 'parsed' } as never])).toBe(true);
  });

  it('汇总任务解析条数', () => {
    expect(formatImportSummary({ parsedCount: 2, failedCount: 1 })).toBe('已解析 2 条，解析失败 1 条');
  });

  it('从接口错误中读取结构错误列表', () => {
    const error = Object.assign(new Error('Excel 文件结构错误'), {
      errors: [{ sheet: '用例', row: 1, reason: '缺少列「起始路径」' }]
    });

    expect(getImportErrors(error).map(formatParseError)).toEqual(['「用例」第 1 行：缺少列「起始路径」']);
  });
});
