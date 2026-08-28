import { badRequest } from './http-error';

const projectKeyPattern = /^[a-z][a-z0-9-]{1,40}$/;
const caseKeyPattern = /^[a-z][a-z0-9-]{1,80}$/;
const runIdPattern = /^(\d{14}|\d{17})$/;
const reviewIdPattern = /^[a-z0-9-]{1,80}$/;
const workIdPattern = /^[a-f0-9-]{36}$/;
const importTaskIdPattern = /^imp-\d{8}-\d{6}-[a-f0-9]{4}$/;
const importCaseIdPattern = /^item-\d{8}-\d{6}-[a-f0-9]{4}$/;
const assetIdPattern = /^[a-f0-9]{64}$/;
const pageArchiveIdPattern = /^pag-[a-z][a-z0-9-]{1,40}-[a-f0-9]{12}$/;

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
 * 校验项目测试资产标识（内容 SHA-256 十六进制）。
 */
export function assertAssetId(value: string) {
  assertText(value, assetIdPattern, '测试资产标识不合法');
}

/**
 * 校验项目级页面档案标识。
 */
export function assertPageArchiveId(value: string) {
  assertText(value, pageArchiveIdPattern, '页面档案标识不合法');
}

/**
 * 按正则校验路径参数。
 */
function assertText(value: string, pattern: RegExp, message: string) {
  if (!pattern.test(value)) {
    throw badRequest(message);
  }
}
