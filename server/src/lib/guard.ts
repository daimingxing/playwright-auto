import { badRequest } from './http-error';

const projectKeyPattern = /^[a-z][a-z0-9-]{1,40}$/;
const caseKeyPattern = /^[a-z][a-z0-9-]{1,80}$/;
const envKeyPattern = projectKeyPattern;
const runIdPattern = /^(\d{14}|\d{17})$/;
const reviewIdPattern = /^[a-z0-9-]{1,80}$/;
const workIdPattern = /^[a-f0-9-]{36}$/;

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
 * 校验环境标识。
 */
export function assertEnvKey(value: string) {
  assertText(value, envKeyPattern, '环境标识不合法');
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
 * 按正则校验路径参数。
 */
function assertText(value: string, pattern: RegExp, message: string) {
  if (!pattern.test(value)) {
    throw badRequest(message);
  }
}
