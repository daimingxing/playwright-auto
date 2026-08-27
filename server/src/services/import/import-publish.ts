import type { ImportTaskDetail } from '../../../../shared/types';
import { createOfficialCase } from '../../lib/case-store';
import { persistImportCaseIntent, getImportTask, updateImportCaseStatus } from '../../lib/import-store';
import { badRequest, notFound } from '../../lib/http-error';
import { compileIntentToActions } from './intent-compile';

/**
 * 显式发布一条已确认用例：校验 Action IR 后原子写入正式 case.json 与 case.spec.ts。
 * 不是确认的副作用；未解决歧义、校验失败或未验证定位器时拒绝发布。
 */
export async function publishImportCase(
  projectKey: string,
  taskId: string,
  caseId: string
): Promise<ImportTaskDetail> {
  const task = await getImportTask(projectKey, taskId);
  const item = task.cases.find((entry) => entry.id === caseId);

  if (!item) {
    throw notFound('导入用例不存在');
  }

  if (item.status === 'published') {
    throw badRequest('该用例已发布');
  }

  if (item.status !== 'publishable') {
    throw badRequest('只有已确认的用例可以发布');
  }

  if (!item.intent) {
    throw badRequest('缺少可发布的测试意图');
  }

  const compiled = compileIntentToActions(item.intent);

  if (!compiled.ok) {
    throw badRequest('Action IR 校验未通过，不能发布', { issues: compiled.issues });
  }

  const official = await createOfficialCase(projectKey, {
    name: item.intent.name,
    startPath: item.intent.startPath,
    steps: compiled.steps
  });

  await persistImportCaseIntent(projectKey, taskId, item.id, item.intent);
  await updateImportCaseStatus(projectKey, taskId, item, 'published', {
    publishedCaseKey: official.key
  });

  return getImportTask(projectKey, taskId);
}
