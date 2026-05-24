import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunMeta } from '../../shared/types';
import { useRunAuth, useRunReports, useRunStart } from '../../web/src/pages/run-center-composables';

const mocks = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  startLogin: vi.fn(),
  saveLogin: vi.fn(),
  listRuns: vi.fn(),
  runProject: vi.fn(),
  deleteRun: vi.fn(),
  exportRun: vi.fn(),
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

vi.mock('../../web/src/api/runs', () => ({
  listRuns: mocks.listRuns,
  runProject: mocks.runProject,
  deleteRun: mocks.deleteRun,
  exportRun: mocks.exportRun
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

describe('运行中心登录态组合函数', () => {
  it('加载登录态时同步刷新报告', async () => {
    const reloadReports = vi.fn().mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({ exists: true, path: 'auth/default.storageState.json' });
    const auth = useRunAuth({
      projectKey: 'crm',
      selectedEnv: ref('default'),
      reloadReports
    });

    await auth.loadAuthState();

    expect(mocks.getAuthState).toHaveBeenCalledWith('crm', 'default');
    expect(reloadReports).toHaveBeenCalledTimes(1);
    expect(auth.hasAuth.value).toBe(true);
    expect(auth.authPath.value).toBe('auth/default.storageState.json');
  });

  it('切换环境时保存环境并清空登录会话', async () => {
    const selectedEnv = ref('pre');
    const reloadReports = vi.fn().mockResolvedValue(undefined);
    mocks.getAuthState.mockResolvedValue({ exists: false, path: '' });
    const auth = useRunAuth({ projectKey: 'crm', selectedEnv, reloadReports });
    auth.sessionId.value = 'session-old';

    await auth.changeEnv();

    expect(mocks.setProjectEnv).toHaveBeenCalledWith('crm', 'pre');
    expect(auth.sessionId.value).toBe('');
    expect(auth.hasAuth.value).toBe(false);
  });
});

describe('运行中心报告组合函数', () => {
  it('刷新报告时更新列表并复位刷新状态', async () => {
    const reports = [makeRun('run-1')];
    const timers: Array<() => void> = [];
    mocks.listRuns.mockResolvedValue(reports);
    const state = useRunReports({
      projectKey: 'crm',
      delay: (_ms) => timers.push(() => {
        state.refreshingReports.value = false;
      })
    });

    await state.refreshReports();
    expect(state.reports.value).toEqual(reports);
    expect(state.refreshingReports.value).toBe(true);

    timers.forEach((run) => run());
    expect(state.refreshingReports.value).toBe(false);
  });

  it('删除报告确认后刷新报告列表', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteRun.mockResolvedValue(undefined);
    mocks.listRuns.mockResolvedValue([]);
    const state = useRunReports({ projectKey: 'crm' });

    await state.removeReport(makeRun('run-1'));

    expect(mocks.deleteRun).toHaveBeenCalledWith('crm', 'run-1');
    expect(mocks.listRuns).toHaveBeenCalledWith('crm');
    expect(mocks.message.success).toHaveBeenCalledWith('已删除测试报告');
  });
});

describe('运行中心启动组合函数', () => {
  it('无登录态时提示但仍允许运行', async () => {
    const loadReports = vi.fn().mockResolvedValue(undefined);
    const openReportUrl = vi.fn();
    mocks.runProject.mockResolvedValue({
      id: 'run-1',
      projectKey: 'crm',
      envKey: 'default',
      status: 'passed',
      reportPath: 'data/projects/crm/runs/run-1/html-report',
      reportUrl: '/api/projects/crm/runs/run-1/report/',
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z'
    });
    const state = useRunStart({
      projectKey: 'crm',
      selectedEnv: ref('default'),
      runMode: ref('headless'),
      workers: ref(4),
      selectedCaseKeys: ref(['case-a']),
      hasAuth: ref(false),
      loadReports,
      openReportUrl
    });

    await state.startRun();

    expect(mocks.message.warning).toHaveBeenCalledWith('当前环境没有保存登录态，将直接运行测试');
    expect(mocks.runProject).toHaveBeenCalledWith('crm', {
      envKey: 'default',
      mode: 'headless',
      workers: 4,
      caseKeys: ['case-a']
    });
    expect(loadReports).toHaveBeenCalledTimes(1);
    expect(openReportUrl).toHaveBeenCalledWith('/api/projects/crm/runs/run-1/report/');
    expect(state.reportPath.value).toContain('html-report');
  });

  it('运行失败时保留错误中的报告入口', async () => {
    const loadReports = vi.fn().mockResolvedValue(undefined);
    const openReportUrl = vi.fn();
    const error = new Error('测试失败') as Error & { reportPath: string; reportUrl: string };
    error.reportPath = 'data/report';
    error.reportUrl = '/api/report/';
    mocks.runProject.mockRejectedValue(error);
    const state = useRunStart({
      projectKey: 'crm',
      selectedEnv: ref('default'),
      runMode: ref('headless'),
      workers: ref(4),
      selectedCaseKeys: ref(['case-a']),
      hasAuth: ref(true),
      loadReports,
      openReportUrl
    });

    await state.startRun();

    expect(state.runError.value).toBe('测试失败');
    expect(state.reportPath.value).toBe('data/report');
    expect(openReportUrl).toHaveBeenCalledWith('/api/report/');
    expect(mocks.message.error).toHaveBeenCalledWith('测试失败');
  });
});

/**
 * 创建测试报告数据。
 */
function makeRun(id: string): RunMeta {
  return {
    id,
    projectKey: 'crm',
    envKey: 'default',
    status: 'passed',
    reportPath: `data/projects/crm/runs/${id}/html-report`,
    reportUrl: `/api/projects/crm/runs/${id}/report/`,
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z'
  };
}
