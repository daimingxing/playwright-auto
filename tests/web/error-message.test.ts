import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../../web/src/utils/error';

describe('错误消息', () => {
  it('从 Error 对象中读取可展示消息', () => {
    expect(getErrorMessage(new Error('项目未配置登录选择器'))).toBe('项目未配置登录选择器');
  });

  it('未知错误返回兜底消息', () => {
    expect(getErrorMessage('bad')).toBe('操作失败，请查看服务状态或稍后重试');
  });
});
