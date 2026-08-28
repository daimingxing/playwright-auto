import { describe, expect, it } from 'vitest';
import {
  canConfirmImportCase,
  canPublishImportCase,
  canRetryImportCase,
  canUnconfirmImportCase,
  formatImportCaseStatus,
  formatImportSummary,
  formatParseError,
  formatSourceRef,
  formatExploreWait,
  formatImportFailure,
  formatImportPublishError,
  getDeleteImportTaskConfirm,
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
    expect(
      formatParseError({
        sheet: '步骤',
        row: 7,
        caseNumber: 'TC-001',
        reason: '数据不能为空',
        cells: {
          用例编号: 'TC-001',
          步骤序号: '6',
          动作类型: '填写',
          目标: '取样人',
          数据: ''
        }
      })
    ).toBe('「步骤」第 7 行（步骤序号 6，填写「取样人」）：数据不能为空');
  });

  it('展示审阅阶段，并区分确认与重试', () => {
    expect(formatImportCaseStatus('exploring')).toEqual({ label: '探索中', type: 'warning' });
    expect(formatImportCaseStatus('generating')).toEqual({ label: '生成中', type: 'warning' });
    expect(formatImportCaseStatus('pending-review')).toEqual({ label: '待确认', type: 'warning' });
    expect(formatImportCaseStatus('publishable')).toEqual({ label: '可发布', type: 'success' });
    expect(formatImportCaseStatus('published')).toEqual({ label: '已发布', type: 'success' });
    expect(formatImportCaseStatus('failed')).toEqual({ label: '失败', type: 'danger' });
    expect(canConfirmImportCase({ status: 'pending-review', intent: { pendingItems: [] } as never })).toBe(true);
    expect(canConfirmImportCase({ status: 'pending-review', intent: { pendingItems: [{ id: 'cfm-1' }] } as never })).toBe(
      false
    );
    expect(canConfirmImportCase({ status: 'publishable' })).toBe(false);
    expect(canUnconfirmImportCase('publishable')).toBe(true);
    expect(canUnconfirmImportCase('pending-review')).toBe(false);
    expect(canRetryImportCase('failed')).toBe(true);
    expect(canRetryImportCase('exploring')).toBe(false);
    expect(canRetryImportCase('generating')).toBe(false);
    expect(canRetryImportCase('publishable')).toBe(false);
    expect(canRetryImportCase('published')).toBe(false);
    expect(canRetryImportCase('parse-failed')).toBe(false);
    expect(canPublishImportCase('publishable')).toBe(true);
    expect(canPublishImportCase('published')).toBe(false);
    expect(formatSourceRef({ sheet: '步骤', row: 3, caseNumber: 'TC-001', cells: {} })).toBe(
      '「步骤」第 3 行 · TC-001'
    );
    expect(formatImportPublishError({
      message: 'Action IR 校验未通过，不能发布',
      issues: [{ code: 'unresolved-ambiguity', message: '存在未解决的待确认项，不能生成可发布的 Action IR' }]
    })).toBe('Action IR 校验未通过，不能发布：存在未解决的待确认项，不能生成可发布的 Action IR');
  });

  it('汇总任务解析条数', () => {
    expect(formatImportSummary({ parsedCount: 2, failedCount: 1 })).toBe('已解析 2 条，解析失败 1 条');
  });

  it('删除导入任务确认文案说明不影响已发布用例', () => {
    expect(getDeleteImportTaskConfirm('orders.xlsx')).toBe(
      '确认删除导入任务「orders.xlsx」吗？这次导入记录无法恢复，已发布的正式用例不受影响。'
    );
  });

  it('探索等待文案包含已等待时间', () => {
    expect(formatExploreWait(5000)).toBe('正在后台探索页面，已等待 5 秒。离开本页不影响，完成后可回来查看结果。');
    expect(formatExploreWait(125000)).toBe('正在后台探索页面，已等待 2 分 5 秒。离开本页不影响，完成后可回来查看结果。');
  });

  it('失败说明不展示 OpenCode 过程日志', () => {
    expect(
      formatImportFailure({
        kind: 'process-failed',
        message:
          'timestamp=2026-08-27T08:33:52.262Z level=ERROR error.error="AI_APICallError: Cannot connect to API: The socket connection was closed unexpectedly."'
      })
    ).toBe('模型服务连接中断，请稍后重试');
  });

  it('从接口错误中读取结构错误列表', () => {
    const error = Object.assign(new Error('Excel 文件结构错误'), {
      errors: [{ sheet: '用例', row: 1, reason: '缺少列「起始路径」' }]
    });

    expect(getImportErrors(error).map(formatParseError)).toEqual(['「用例」第 1 行：缺少列「起始路径」']);
  });
});
