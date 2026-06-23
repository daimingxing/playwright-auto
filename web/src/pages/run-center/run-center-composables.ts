import { ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { CaseMeta, EnvMeta, RunMeta, RunMode } from '../../../../shared/types';
import { deleteRun, exportRun, listRuns, runProject } from '../../api/runs';
import { useProjectAuth } from '../../composables/project-auth';
import { getErrorMessage } from '../../utils/error';
import { getReportUrl } from './run-center';

const REFRESH_DELAY_MS = 480;

interface RunAuthOptions {
  projectKey: string;
  envs: Ref<EnvMeta[]>;
  activeEnv: Ref<EnvMeta | null>;
  selectedEnv: Ref<string>;
  reloadReports: () => Promise<void>;
}

/**
 * 管理运行中心登录态和环境切换。
 */
export function useRunAuth(options: RunAuthOptions) {
  const auth = useProjectAuth({
    projectKey: options.projectKey,
    envs: options.envs,
    activeEnv: options.activeEnv,
    selectedEnv: options.selectedEnv,
    savedMessage: '登录态已保存，后续运行测试会自动复用'
  });

  /**
   * 加载当前环境登录态，并同步刷新报告列表。
   */
  async function loadAuthState() {
    await Promise.all([auth.loadAuthState(), options.reloadReports()]);
  }

  /**
   * 切换运行环境并重载登录态。
   */
  async function changeEnv() {
    await auth.changeEnv();
    await options.reloadReports();
  }

  return {
    loading: auth.loading,
    saving: auth.saving,
    authPath: auth.authPath,
    hasAuth: auth.hasAuth,
    sessionId: auth.sessionId,
    loadAuthState,
    changeEnv,
    openLogin: auth.openLogin,
    saveAuth: auth.saveAuth
  };
}

interface RunReportsOptions {
  projectKey: string;
  openTab?: (url: string) => void;
  delay?: (ms: number) => void;
}

/**
 * 管理运行中心报告列表和报告操作。
 */
export function useRunReports(options: RunReportsOptions) {
  const reports = ref<RunMeta[]>([]);
  const refreshingReports = ref(false);
  const openTab = options.openTab ?? ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'));
  const delay = options.delay ?? ((ms: number) => window.setTimeout(() => {
    refreshingReports.value = false;
  }, ms));

  /**
   * 加载项目测试报告列表。
   */
  async function loadReports() {
    reports.value = await listRuns(options.projectKey);
  }

  /**
   * 刷新项目测试报告列表。
   */
  async function refreshReports() {
    if (refreshingReports.value) {
      return;
    }

    refreshingReports.value = true;

    try {
      await loadReports();
    } finally {
      // 保留短暂旋转状态，避免刷新过快时按钮视觉闪烁。
      delay(REFRESH_DELAY_MS);
    }
  }

  /**
   * 打开指定报告地址。
   */
  function openReportUrl(url: string) {
    if (!url) {
      return;
    }

    openTab(getReportUrl(url));
  }

  /**
   * 打开报告列表中的测试报告。
   */
  function openRunReport(item: RunMeta) {
    openReportUrl(item.reportUrl ?? '');
  }

  /**
   * 导出报告列表中的测试报告。
   */
  async function exportReport(item: RunMeta) {
    try {
      await exportRun(options.projectKey, item.id);
      ElMessage.success('已开始下载测试报告');
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    }
  }

  /**
   * 删除报告列表中的测试报告。
   */
  async function removeReport(item: RunMeta) {
    const confirmed = await ElMessageBox.confirm(`确认删除测试报告「${item.id}」吗？删除后不可恢复。`, '删除测试报告', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    }).catch(() => false);

    if (!confirmed) {
      return;
    }

    try {
      await deleteRun(options.projectKey, item.id);
      await loadReports();
      ElMessage.success('已删除测试报告');
    } catch (error) {
      ElMessage.error(getErrorMessage(error));
    }
  }

  return {
    reports,
    refreshingReports,
    loadReports,
    refreshReports,
    openReportUrl,
    openRunReport,
    exportReport,
    removeReport
  };
}

interface RunStartOptions {
  projectKey: string;
  selectedEnv: Ref<string>;
  runMode: Ref<RunMode>;
  workers: Ref<number>;
  selectedCaseKeys: Ref<string[]>;
  hasAuth: Ref<boolean>;
  loadReports: () => Promise<void>;
  openReportUrl: (url: string) => void;
}

/**
 * 管理运行中心启动运行和结果展示状态。
 */
export function useRunStart(options: RunStartOptions) {
  const running = ref(false);
  const reportPath = ref('');
  const reportUrl = ref('');
  const runError = ref('');

  /**
   * 启动项目测试运行。
   */
  async function startRun() {
    if (options.selectedCaseKeys.value.length === 0) {
      ElMessage.warning('请选择至少一条测试用例');
      return;
    }

    if (!options.hasAuth.value) {
      ElMessage.warning('当前环境没有保存登录态，将直接运行测试');
    }

    running.value = true;
    reportPath.value = '';
    reportUrl.value = '';
    runError.value = '';

    try {
      const run = await runProject(options.projectKey, {
        envKey: options.selectedEnv.value,
        mode: options.runMode.value,
        workers: options.workers.value,
        caseKeys: options.selectedCaseKeys.value
      });
      reportPath.value = run.reportPath;
      reportUrl.value = run.reportUrl ?? '';
      await options.loadReports();
      ElMessage.success('测试运行完成');
      options.openReportUrl(reportUrl.value);
    } catch (error) {
      runError.value = getErrorMessage(error);
      reportPath.value = getErrorInfo(error, 'reportPath');
      reportUrl.value = getErrorInfo(error, 'reportUrl');
      await options.loadReports();
      options.openReportUrl(reportUrl.value);
      ElMessage.error(runError.value);
    } finally {
      running.value = false;
    }
  }

  return {
    running,
    reportPath,
    reportUrl,
    runError,
    startRun
  };
}

/**
 * 从接口错误中读取附加字段。
 */
function getErrorInfo(error: unknown, key: 'reportPath' | 'reportUrl') {
  if (error && typeof error === 'object' && key in error) {
    const value = error[key as keyof typeof error];

    return typeof value === 'string' ? value : '';
  }

  return '';
}
