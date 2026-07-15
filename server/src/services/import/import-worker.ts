import {
  listImportJobs,
  recoverImportItems
} from '../../lib/import-store';
import { listProjects } from '../../lib/project-store';
import { executeImportItem, executeImportJob } from './import-orchestrator';
import { drainImportQueue, enqueueImportTask, setImportTaskRunner } from './import-scheduler';

setImportTaskRunner(async (task) => {
  await executeImportItem(task.projectKey, task.importId, task.itemId, task.pageMapId);
});

/**
 * 恢复服务启动前未完成的导入任务。
 */
export async function recoverImportJobs() {
  const projects = await listProjects();

  for (const project of projects) {
    const jobs = await listImportJobs(project.key);

    for (const job of jobs) {
      await recoverImportItems(project.key, job.importId);
      await enqueueImportJob(project.key, job.importId);
    }
  }
}

/**
 * 把导入任务中的待处理项加入本地后台队列。
 */
export async function enqueueImportJob(projectKey: string, importId: string) {
  await executeImportJob(projectKey, importId);
  drainImportQueue();
}

/**
 * 把单个导入项加入本地后台队列。
 */
export function enqueueImportItem(projectKey: string, importId: string, itemId: string) {
  enqueueImportTask({ projectKey, importId, itemId });
}

/**
 * 处理单个导入项。
 */
export async function processImportItem(projectKey: string, importId: string, itemId: string, pageMapId?: string): Promise<void> {
  await executeImportItem(projectKey, importId, itemId, pageMapId);
}
