import { describe, expect, it } from 'vitest';
import { getErrorIssues, getErrorMessage } from '../../web/src/utils/error';

describe('错误消息', () => {
  it('从 Error 对象中读取可展示消息', () => {
    expect(getErrorMessage(new Error('项目未配置登录选择器'))).toBe('项目未配置登录选择器');
  });

  it('未知错误返回兜底消息', () => {
    expect(getErrorMessage('bad')).toBe('操作失败，请查看服务状态或稍后重试');
  });

  it('可以读取后端返回的基础检查问题', () => {
    const error = Object.assign(new Error('基础检查不通过'), {
      issues: [
        {
          stepIndex: 0,
          message: '步骤缺少元素选择器。',
          suggestion: '请补充可稳定定位目标元素的 selector。'
        }
      ]
    });

    expect(getErrorIssues(error)).toEqual([
      '第 1 步：步骤缺少元素选择器。请补充可稳定定位目标元素的 selector。'
    ]);
  });
});
