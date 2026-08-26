import { badRequest } from './http-error';

const projectKeyPattern = /^[a-z][a-z0-9-]{1,40}$/;
const caseKeyPattern = /^[a-z][a-z0-9-]{1,80}$/;
const runIdPattern = /^(\d{14}|\d{17})$/;
const reviewIdPattern = /^[a-z0-9-]{1,80}$/;
const workIdPattern = /^[a-f0-9-]{36}$/;
const importTaskIdPattern = /^imp-\d{8}-\d{6}-[a-f0-9]{4}$/;
const importCaseIdPattern = /^item-\d{8}-\d{6}-[a-f0-9]{4}$/;

/**
 * 校验项目标识。
 */
export function assertProjectKey(value: string) {
  assertText(value, projectKeyPattern, '项目标识不合法');
}

/**
 * 校验用例标识。
 */
export function assertCaseKey(value: string) {
  assertText(value, caseKeyPattern, '用例标识不合法');
}

/**
 * 校验运行标识。
 */
export function assertRunId(value: string) {
  assertText(value, runIdPattern, '运行标识不合法');
}

/**
 * 校验实测检查标识。
 */
export function assertReviewId(value: string) {
  assertText(value, reviewIdPattern, '实测检查标识不合法');
}

/**
 * 校验实测检查临时目录标识。
 */
export function assertWorkId(value: string) {
  assertText(value, workIdPattern, '实测检查临时目录标识不合法');
}

/**
 * 校验 AI 导入任务标识。
 */
export function assertImportTaskId(value: string) {
  assertText(value, importTaskIdPattern, '导入任务标识不合法');
}

/**
 * 校验 AI 导入任务内的用例条目标识。
 */
export function assertImportCaseId(value: string) {
  assertText(value, importCaseIdPattern, '导入用例条目标识不合法');
}

/**
 * 按正则校验路径参数。
 */
function assertText(value: string, pattern: RegExp, message: string) {
  if (!pattern.test(value)) {
    throw badRequest(message);
  }
}
