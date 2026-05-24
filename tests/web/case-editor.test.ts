import { describe, expect, it } from 'vitest';
import type { CaseMeta, CaseStep, PracticalReviewSummary } from '../../shared/types';
import {
  canMoveSteps,
  copyStep,
  copySteps,
  createStep,
  formatCaseStatus,
  formatCaseCreatedTime,
  formatCheckStatus,
  formatLocatorCheckPass,
  formatStepReviewState,
  formatPracticalReviewStatus,
  formatStepType,
  getFailedPracticalStep,
  getInsertIndex,
  getPracticalReviewTagType,
  getStepIndexLabel,
  getStartPreview,
  mergeStepReviewState,
  hasSelector,
  hasTimeout,
  hasValue,
  insertStep,
  moveStep,
  moveSteps,
  removeStep,
  removeSteps,
  stepGroups,
  stepLabels,
  stepTypes
} from '../../web/src/pages/case-editor';

/**
 * 创建一条测试用步骤。
 */
function makeStep(id: string, type: CaseStep['type'] = 'click'): CaseStep {
  return {
    id,
    type,
    selector: '#target',
    value: 'value',
    timeout: 1000
  };
}

/**
 * 创建实测检查摘要测试数据。
 */
function makePracticalSummary(status: PracticalReviewSummary['status']): PracticalReviewSummary {
  return {
    status,
    envKey: 'default',
    envBaseUrl: 'https://crm.test.local',
    caseSnapshotHash: 'hash-a',
    stepCount: 1,
    reviewId: status === 'expired' ? undefined : 'review-1',
    checkedAt: status === 'expired' ? undefined : '2026-05-22T00:00:00.000Z',
    failedStepId: status === 'failed' ? 's1' : undefined,
    failedStepIndex: status === 'failed' ? 0 : undefined,
    failureMessage: status === 'failed' ? '未找到目标元素' : undefined
  };
}

describe('用例编辑器步骤工具', () => {
  it('会显示用例状态和检查状态', () => {
    expect(formatCaseStatus('draft')).toEqual({ label: '草稿', type: 'info' });
    expect(formatCaseStatus('ready')).toEqual({ label: '待启用', type: 'warning' });
    expect(formatCaseStatus('active')).toEqual({ label: '启用', type: 'success' });

    expect(formatCheckStatus(makeCase())).toEqual({ label: '未审查', type: 'info' });
    expect(formatCheckStatus({ ...makeCase(), review: makeReview('error') })).toEqual({
      label: '审查不通过',
      type: 'danger'
    });
    expect(formatCheckStatus({ ...makeCase(), review: makeReview('pass') })).toEqual({
      label: '待实测',
      type: 'warning'
    });
    expect(
      formatCheckStatus({
        ...makeCase(),
        review: makeReview('pass'),
        practicalReview: makePracticalSummary('passed')
      })
    ).toEqual({ label: '实测通过', type: 'success' });
  });

  it('步骤类型已经包含 goto 和 select', () => {
    expect(stepTypes).toContain('goto');
    expect(stepTypes).toContain('select');
    expect(stepLabels.goto).toBe('打开页面');
    expect(stepLabels.select).toBe('下拉选择');
    expect(stepGroups.map((group) => group.label)).toEqual(['页面', '动作', '断言']);
  });

  it('会把步骤类型展示为中文主文案和代码副标识', () => {
    expect(formatStepType('goto')).toEqual({ label: '打开页面', code: 'goto' });
    expect(formatStepType('click')).toEqual({ label: '点击', code: 'click' });
  });

  it('会把步骤下标显示为从 1 开始的序号', () => {
    expect(getStepIndexLabel(0)).toBe(1);
    expect(getStepIndexLabel(4)).toBe(5);
  });

  it('静态定位检查通过文案会避免和实测检查混淆', () => {
    expect(formatLocatorCheckPass()).toBe('定位通过');
  });

  it('编辑中的步骤会用预览基础检查状态覆盖已保存结果', () => {
    const saved = makeReview('pass').items;

    expect(formatStepReviewState(mergeStepReviewState('s1', saved, new Map([['s1', 'pending']])))).toEqual({
      label: '待检查',
      type: 'info'
    });

    expect(formatStepReviewState(mergeStepReviewState('s1', saved, new Map([['s1', []]])))).toEqual({
      label: '定位通过',
      type: 'success'
    });

    expect(
      mergeStepReviewState(
        's1',
        saved,
        new Map([
          [
            's1',
            [
              {
                id: 's1-missing-selector',
                stepId: 's1',
                stepIndex: 0,
                stepType: 'click',
                selector: '',
                level: 'error',
                group: 'integrity',
                ruleCode: 'missing-selector',
                message: '步骤缺少元素选择器。',
                suggestion: '请补充可稳定定位目标元素的 selector。'
              }
            ]
          ]
        ])
      ).reviews
    ).toHaveLength(1);
  });

  it('根据项目环境和起始路径计算实际打开地址', () => {
    const preview = getStartPreview(
      {
        name: '下拉框选择',
        key: 'case-1',
        status: 'draft',
        startPath: '/web/NGBS03',
        steps: [],
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      {
        name: '默认环境',
        key: 'default',
        baseUrl: 'http://xcmpmstest.baowuresources.info/xcmpms-imms-f'
      }
    );

    expect(preview).toBe('http://xcmpmstest.baowuresources.info/xcmpms-imms-f/web/NGBS03');
  });

  it('会根据步骤类型决定哪些字段可见', () => {
    expect(hasSelector('goto')).toBe(false);
    expect(hasValue('goto')).toBe(true);
    expect(hasTimeout('goto')).toBe(true);

    expect(hasSelector('select')).toBe(true);
    expect(hasValue('select')).toBe(true);
    expect(hasTimeout('select')).toBe(true);

    expect(hasSelector('wait')).toBe(false);
    expect(hasValue('wait')).toBe(false);
    expect(hasTimeout('wait')).toBe(true);
  });

  it('会为不同步骤生成合适的默认字段', () => {
    const goto = createStep('goto');
    const click = createStep('click');
    const wait = createStep('wait');

    expect(goto.type).toBe('goto');
    expect(goto.selector).toBeUndefined();
    expect(goto.value).toBe('');
    expect(goto.timeout).toBe(20000);

    expect(click.type).toBe('click');
    expect(click.selector).toBe('');
    expect(click.timeout).toBe(2000);

    expect(wait.type).toBe('wait');
    expect(wait.selector).toBeUndefined();
    expect(wait.value).toBeUndefined();
    expect(wait.timeout).toBe(1000);
  });

  it('创建步骤时支持传入自定义默认等待时间', () => {
    const timeouts = {
      navigation: 30000,
      action: 3000,
      wait: 1500
    };

    expect(createStep('goto', timeouts).timeout).toBe(30000);
    expect(createStep('fill', timeouts).timeout).toBe(3000);
    expect(createStep('wait', timeouts).timeout).toBe(1500);
    expect(createStep('assertVisible', timeouts).timeout).toBeUndefined();
  });

  it('可以在指定位置插入步骤', () => {
    const steps = [makeStep('a'), makeStep('b')];

    insertStep(steps, 1, 'select');

    expect(steps.map((row) => row.type)).toEqual(['click', 'select', 'click']);
  });

  it('会根据选中步骤计算新增位置，未选中时追加到末尾', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];

    expect(getInsertIndex(steps, 'b')).toBe(2);
    expect(getInsertIndex(steps, '')).toBe(3);
    expect(getInsertIndex(steps, 'missing')).toBe(3);
  });

  it('可以上下移动、复制和删除步骤', () => {
    const steps = [makeStep('a'), makeStep('b', 'fill'), makeStep('c', 'wait')];

    moveStep(steps, 1, -1);
    expect(steps.map((row) => row.id)).toEqual(['b', 'a', 'c']);

    moveStep(steps, 1, 1);
    expect(steps.map((row) => row.id)).toEqual(['b', 'c', 'a']);

    copyStep(steps, 1);
    expect(steps).toHaveLength(4);
    expect(steps[2].id).not.toBe(steps[1].id);
    expect(steps[2].type).toBe('wait');

    removeStep(steps, 2);
    expect(steps.map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });

  it('会按秒显示用例创建时间', () => {
    expect(formatCaseCreatedTime(undefined)).toBe('-');
    expect(formatCaseCreatedTime('2026-05-24T07:50:01.648Z')).toBe('2026-05-24 07:50:01');
  });

  it('复制步骤时会深拷贝 selectorDraft', () => {
    const steps = [
      {
        ...makeStep('a'),
        selectorDraft: {
          mode: 'css',
          value: 'tr',
          has: {
            mode: 'role',
            role: 'button',
            value: '编辑'
          }
        }
      } satisfies CaseStep
    ];

    const copied = copyStep(steps, 0);

    expect(copied?.selectorDraft).toEqual(steps[0].selectorDraft);
    expect(copied?.selectorDraft).not.toBe(steps[0].selectorDraft);
    copied!.selectorDraft!.has!.value = '查看';
    expect(steps[0].selectorDraft!.has!.value).toBe('编辑');
  });

  it('可以批量删除选中的步骤并保留未选中顺序', () => {
    const steps = [makeStep('a'), makeStep('b', 'fill'), makeStep('c', 'wait'), makeStep('d')];

    const removed = removeSteps(steps, ['b', 'd']);

    expect(removed.map((row) => row.id)).toEqual(['b', 'd']);
    expect(steps.map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('可以批量复制选中的步骤到选中块后方', () => {
    const steps = [
      makeStep('a'),
      {
        ...makeStep('b', 'fill'),
        selectorDraft: {
          mode: 'role',
          role: 'textbox',
          value: '用户名'
        }
      } satisfies CaseStep,
      makeStep('c', 'wait'),
      makeStep('d')
    ];

    const copied = copySteps(steps, ['b', 'd']);

    expect(copied).toHaveLength(2);
    expect(copied.map((row) => row.type)).toEqual(['fill', 'click']);
    expect(copied[0].id).not.toBe('b');
    expect(copied[1].id).not.toBe('d');
    expect(copied[0].selectorDraft).toEqual(steps[1].selectorDraft);
    expect(copied[0].selectorDraft).not.toBe(steps[1].selectorDraft);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', copied[0].id, copied[1].id]);
  });

  it('可以批量上移和下移选中的步骤并保持内部顺序', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c'), makeStep('d')];

    expect(canMoveSteps(steps, ['b', 'c'], -1)).toBe(true);
    const movedUp = moveSteps(steps, ['b', 'c'], -1);

    expect(movedUp.map((row) => row.id)).toEqual(['b', 'c']);
    expect(steps.map((row) => row.id)).toEqual(['b', 'c', 'a', 'd']);

    expect(canMoveSteps(steps, ['b', 'c'], 1)).toBe(true);
    const movedDown = moveSteps(steps, ['b', 'c'], 1);

    expect(movedDown.map((row) => row.id)).toEqual(['b', 'c']);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('批量移动非连续选择时会让每个选中块各移动一格', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c'), makeStep('d'), makeStep('e')];

    moveSteps(steps, ['b', 'd'], -1);
    expect(steps.map((row) => row.id)).toEqual(['b', 'a', 'd', 'c', 'e']);

    moveSteps(steps, ['b', 'd'], 1);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('批量移动会处理空选择和首尾边界', () => {
    const steps = [makeStep('a'), makeStep('b'), makeStep('c')];

    expect(canMoveSteps(steps, [], -1)).toBe(false);
    expect(canMoveSteps(steps, ['a'], -1)).toBe(false);
    expect(canMoveSteps(steps, ['c'], 1)).toBe(false);
    expect(moveSteps(steps, [], 1)).toEqual([]);
    expect(steps.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

/**
 * 创建测试用例数据。
 */
function makeCase(): CaseMeta {
  return {
    name: '用例',
    key: 'case-a',
    status: 'draft',
    startPath: '/',
    steps: [],
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z'
  };
}

/**
 * 创建基础检查摘要测试数据。
 */
function makeReview(level: NonNullable<CaseMeta['review']>['summary']['level']): NonNullable<CaseMeta['review']> {
  return {
    summary: {
      level,
      error: level === 'error' ? 1 : 0,
      danger: level === 'danger' ? 1 : 0,
      warning: level === 'warning' ? 1 : 0,
      info: level === 'info' ? 1 : 0
    },
    items: [],
    updatedAt: '2026-05-22T00:00:00.000Z'
  };
}

describe('实测检查展示工具', () => {
  it('会显示未审查、通过、失败和过期状态', () => {
    expect(formatPracticalReviewStatus(undefined)).toBe('未审查');
    expect(formatPracticalReviewStatus(makePracticalSummary('passed'))).toBe('通过');
    expect(formatPracticalReviewStatus(makePracticalSummary('failed'))).toBe('失败');
    expect(formatPracticalReviewStatus(makePracticalSummary('expired'))).toBe('过期');
  });

  it('会为实测检查状态选择标签类型', () => {
    expect(getPracticalReviewTagType(undefined)).toBe('info');
    expect(getPracticalReviewTagType(makePracticalSummary('passed'))).toBe('success');
    expect(getPracticalReviewTagType(makePracticalSummary('failed'))).toBe('danger');
    expect(getPracticalReviewTagType(makePracticalSummary('expired'))).toBe('warning');
  });

  it('能判断实测失败步骤', () => {
    const step = makeStep('s1');

    expect(getFailedPracticalStep(makePracticalSummary('failed'), step)).toBe(true);
    expect(getFailedPracticalStep(makePracticalSummary('passed'), step)).toBe(false);
  });
});
