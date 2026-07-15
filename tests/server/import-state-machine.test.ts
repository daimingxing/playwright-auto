import { describe, expect, it } from 'vitest';
import {
  bindGroup,
  completeWithDraft,
  failItem,
  failMap,
  startGenerating
} from '../../server/src/services/import/import-state-machine';
import type { CaseReview } from '../../shared/types';

describe('导入状态机', () => {
  it('统一生成中、完成和失败状态字段', () => {
    expect(startGenerating({ mode: 'batch', fallbackReason: '分组失败', retryCount: 1 })).toEqual({
      status: 'generating',
      errorMessage: undefined,
      genMode: 'batch',
      fallbackReason: '分组失败',
      retryCount: 1
    });

    const review = createReview();
    expect(
      completeWithDraft({
        draft: {
          name: '新增用户',
          startPath: '/users',
          confidence: 'high',
          warnings: [],
          missingInfo: [],
          steps: []
        },
        aiDebug: undefined,
        review,
        mode: 'single',
        fallbackReason: '小批失败'
      })
    ).toMatchObject({
      status: 'pendingReview',
      genMode: 'single',
      fallbackReason: '小批失败',
      retryCount: 0,
      review
    });

    expect(
      failItem({
        message: 'AI 未返回可用草稿',
        mode: 'group',
        retryCount: 2,
        clearDraft: true
      })
    ).toEqual({
      status: 'failed',
      errorMessage: 'AI 未返回可用草稿',
      genMode: 'group',
      fallbackReason: undefined,
      retryCount: 2,
      draft: undefined,
      aiDebug: undefined,
      review: undefined
    });
  });

  it('页面地图失败时清空可复用地图标识', () => {
    expect(
      failMap({
        groupId: 'pm-group',
        groupIndex: 1,
        message: '页面地图生成失败：不可访问'
      })
    ).toEqual({
      status: 'failed',
      groupId: 'pm-group',
      groupIndex: 1,
      pageMapId: undefined,
      errorMessage: '页面地图生成失败：不可访问',
      genMode: 'group',
      fallbackReason: undefined,
      retryCount: 0
    });
  });

  it('绑定分组元信息不改变主状态', () => {
    expect(
      bindGroup({
        groupId: 'pm-group',
        groupIndex: 0,
        pageMapId: 'pm-map'
      })
    ).toEqual({
      groupId: 'pm-group',
      groupIndex: 0,
      pageMapId: 'pm-map'
    });
  });
});

/**
 * 创建测试用基础检查结果。
 */
function createReview(): CaseReview {
  return {
    summary: {
      level: 'pass',
      error: 0,
      danger: 0,
      warning: 0,
      info: 0
    },
    items: [],
    updatedAt: '2026-05-29T00:00:00.000Z'
  };
}
