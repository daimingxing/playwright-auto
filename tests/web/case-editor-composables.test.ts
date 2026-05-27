import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseMeta, CaseStep, EnvMeta, PracticalReviewRecord } from '../../shared/types';
import { useCaseAuth, useCasePractical, useCaseRecord, useStepBatch } from '../../web/src/pages/case-editor-composables';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  startLogin: vi.fn(),
  saveLogin: vi.fn(),
  startRecord: vi.fn(),
  stopRecord: vi.fn(),
  getCase: vi.fn(),
  startPracticalReview: vi.fn(),
  listPracticalReviews: vi.fn(),
  clearPracticalReviews: vi.fn(),
  getPracticalReview: vi.fn(),
  setProjectEnv: vi.fn(),
  message: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  },
  confirm: vi.fn()
}));

vi.mock('../../web/src/api/auth', () => ({
  getAuthState: mocks.getAuthState,
  startLogin: mocks.startLogin,
  saveLogin: mocks.saveLogin
}));

vi.mock('../../web/src/api/cases', () => ({
  startRecord: mocks.startRecord,
  stopRecord: mocks.stopRecord,
  getCase: mocks.getCase,
  startPracticalReview: mocks.startPracticalReview,
  listPracticalReviews: mocks.listPracticalReviews,
  clearPracticalReviews: mocks.clearPracticalReviews,
  getPracticalReview: mocks.getPracticalReview
}));

vi.mock('../../web/src/state/project-env', () => ({
  setProjectEnv: mocks.setProjectEnv
}));

vi.mock('element-plus', () => ({
  ElMessage: mocks.message,
  ElMessageBox: {
    confirm: mocks.confirm
  }
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('用例编辑器登录态组合函数', () => {
  it('切换环境时保存环境并重新加载登录态', async () => {
    const activeEnv = ref<EnvMeta | null>(makeEnv('default'));
    const selectedEnv = ref('pre');
    const auth = useCaseAuth({
      projectKey: 'crm',
      envs: ref([makeEnv('default'), makeEnv('pre')]),
      activeEnv,
      selectedEnv
    });
    auth.loginId.value = 'old-session';
    mocks.getAuthState.mockResolvedValue({ exists: true, path: 'auth/pre.storageState.json' });

    await auth.changeEnv();

    expect(activeEnv.value?.key).toBe('pre');
    expect(mocks.setProjectEnv).toHaveBeenCalledWith('crm', 'pre');
    expect(mocks.getAuthState).toHaveBeenCalledWith('crm', 'pre');
    expect(auth.loginId.value).toBe('');
    expect(auth.hasAuth.value).toBe(true);
    expect(auth.authPath.value).toBe('auth/pre.storageState.json');
  });

  it('没有项目环境时阻止打开登录浏览器', async () => {
    const auth = useCaseAuth({
      projectKey: 'crm',
      envs: ref([]),
      activeEnv: ref(null),
      selectedEnv: ref('')
    });

    await auth.openLogin();

    expect(mocks.startLogin).not.toHaveBeenCalled();
    expect(mocks.message.warning).toHaveBeenCalledWith('请先配置项目环境');
  });
});

describe('用例编辑器录制组合函数', () => {
  it('开始录制时使用当前实测环境并在确认框展示环境', async () => {
    const item = ref(makeCase());
    const activeEnv = ref(makeEnv('pre'));
    const record = useCaseRecord({
      projectKey: 'crm',
      caseKey: 'case-a',
      item,
      activeEnv,
      selectedId: ref(''),
      runStepReviewPreview: vi.fn(),
      showError: vi.fn()
    });
    mocks.confirm.mockResolvedValue(true);
    mocks.startRecord.mockResolvedValue({ sessionId: 'record-pre', url: 'https://pre.example.test/' });

    await record.startRecordCase();

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining('pre环境（pre）'),
      '开始录制',
      { type: 'warning' }
    );
    expect(mocks.startRecord).toHaveBeenCalledWith('crm', 'case-a', { envKey: 'pre' });
    expect(record.recordId.value).toBe('record-pre');
    expect(record.isRecording.value).toBe(true);
  });

  it('停止录制后把录制步骤插入到选中步骤后方', async () => {
    const item = ref(makeCase([makeStep('old-a'), makeStep('old-b')]));
    const runStepReviewPreview = vi.fn();
    const record = useCaseRecord({
      projectKey: 'crm',
      caseKey: 'case-a',
      item,
      activeEnv: ref(makeEnv('default')),
      selectedId: ref('old-a'),
      runStepReviewPreview,
      showError: vi.fn()
    });
    record.recordId.value = 'record-1';
    record.isRecording.value = true;
    const steps = [makeStep('new-a'), makeStep('new-b')];
    mocks.stopRecord.mockResolvedValue({ steps });

    await record.stopRecordCase();

    expect(mocks.stopRecord).toHaveBeenCalledWith('crm', 'case-a', 'record-1');
    expect(item.value?.steps.map((step) => step.id)).toEqual(['old-a', 'new-a', 'new-b', 'old-b']);
    expect(runStepReviewPreview).toHaveBeenCalledTimes(2);
    expect(record.recordId.value).toBe('');
    expect(record.isRecording.value).toBe(false);
  });

  it('停止录制时没有选中步骤则追加到末尾', async () => {
    const item = ref(makeCase([makeStep('old-a')]));
    const record = useCaseRecord({
      projectKey: 'crm',
      caseKey: 'case-a',
      item,
      activeEnv: ref(makeEnv('default')),
      selectedId: ref(''),
      runStepReviewPreview: vi.fn(),
      showError: vi.fn()
    });
    record.recordId.value = 'record-1';
    mocks.stopRecord.mockResolvedValue({ steps: [makeStep('new-a')] });

    await record.stopRecordCase();

    expect(item.value?.steps.map((step) => step.id)).toEqual(['old-a', 'new-a']);
  });
});

describe('用例编辑器步骤批量组合函数', () => {
  it('批量复制后高亮新步骤并清空表格选择', () => {
    const item = ref(makeCase([makeStep('a'), makeStep('b'), makeStep('c')]));
    const clearSelection = vi.fn();
    const setActiveSteps = vi.fn();
    const markStepReviewPending = vi.fn();
    const stepBatch = useStepBatch({
      item,
      stepTable: ref({ clearSelection } as never),
      selectedId: ref(''),
      setActiveSteps,
      markStepReviewPending,
      clearStepReview: vi.fn(),
      showError: vi.fn()
    });
    stepBatch.updateBatch([item.value!.steps[1]]);

    stepBatch.duplicateBatch();

    expect(item.value?.steps).toHaveLength(4);
    expect(setActiveSteps).toHaveBeenCalledWith([item.value!.steps[2]]);
    expect(markStepReviewPending).toHaveBeenCalledWith(item.value!.steps[2]);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(stepBatch.batchIds.value).toEqual([]);
  });
});

describe('用例编辑器实测检查组合函数', () => {
  it('实测前先保存当前草稿再启动检查', async () => {
    const item = ref(makeCase());
    const record = makePracticalRecord('failed');
    const saveDraft = vi.fn().mockResolvedValue(true);
    mocks.startPracticalReview.mockResolvedValue(record);
    mocks.getCase.mockResolvedValue({ ...makeCase(), practicalReview: record.summary });
    const practical = useCasePractical({
      projectKey: 'crm',
      caseKey: 'case-a',
      item,
      activeEnv: ref(makeEnv('default')),
      practicalMode: ref('headless'),
      saveDraft,
      showError: vi.fn()
    });

    await practical.runPracticalCheck();

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.startPracticalReview).toHaveBeenCalledWith('crm', 'case-a', {
      envKey: 'default',
      mode: 'headless'
    });
    expect(item.value?.practicalReview?.status).toBe('failed');
    expect(practical.activePracticalRecord.value).toEqual(record);
    expect(practical.failureDrawerOpen.value).toBe(true);
    expect(mocks.message.error).toHaveBeenCalledWith('未找到目标元素');
  });

  it('草稿保存失败时不启动实测检查', async () => {
    const practical = useCasePractical({
      projectKey: 'crm',
      caseKey: 'case-a',
      item: ref(makeCase()),
      activeEnv: ref(makeEnv('default')),
      practicalMode: ref('headless'),
      saveDraft: vi.fn().mockResolvedValue(false),
      showError: vi.fn()
    });

    await practical.runPracticalCheck();

    expect(mocks.startPracticalReview).not.toHaveBeenCalled();
  });

  it('打开最近失败分析时复用已有记录', async () => {
    const record = makePracticalRecord('failed');
    const practical = useCasePractical({
      projectKey: 'crm',
      caseKey: 'case-a',
      item: ref({ ...makeCase(), practicalReview: record.summary }),
      activeEnv: ref(makeEnv('default')),
      practicalMode: ref('headless'),
      saveDraft: vi.fn().mockResolvedValue(true),
      showError: vi.fn()
    });
    practical.activePracticalRecord.value = record;

    await practical.openLatestFailureAnalysis();

    expect(mocks.getPracticalReview).not.toHaveBeenCalled();
    expect(practical.failureDrawerOpen.value).toBe(true);
  });
});

/**
 * 创建测试项目环境。
 */
function makeEnv(key: string): EnvMeta {
  return {
    name: `${key}环境`,
    key,
    baseUrl: `https://${key}.example.test`
  };
}

/**
 * 创建测试步骤。
 */
function makeStep(id: string): CaseStep {
  return {
    id,
    type: 'click',
    selector: '#target',
    timeout: 1000
  };
}

/**
 * 创建测试用例。
 */
function makeCase(steps: CaseStep[] = [makeStep('a')]): CaseMeta {
  return {
    name: '用例',
    key: 'case-a',
    status: 'draft',
    startPath: '/',
    steps,
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z'
  };
}

/**
 * 创建实测记录。
 */
function makePracticalRecord(status: PracticalReviewRecord['status']): PracticalReviewRecord {
  return {
    id: 'review-1',
    projectKey: 'crm',
    caseKey: 'case-a',
    envKey: 'default',
    envBaseUrl: 'https://default.example.test',
    status,
    caseSnapshotHash: 'hash-a',
    startedAt: '2026-05-25T00:00:00.000Z',
    finishedAt: '2026-05-25T00:00:01.000Z',
    durationMs: 1000,
    steps: [],
    summary: {
      status,
      envKey: 'default',
      envBaseUrl: 'https://default.example.test',
      caseSnapshotHash: 'hash-a',
      stepCount: 1,
      reviewId: 'review-1',
      checkedAt: '2026-05-25T00:00:01.000Z',
      failedStepId: status === 'failed' ? 'a' : undefined,
      failedStepIndex: status === 'failed' ? 0 : undefined,
      failureMessage: status === 'failed' ? '未找到目标元素' : undefined
    },
    artifacts: []
  };
}
