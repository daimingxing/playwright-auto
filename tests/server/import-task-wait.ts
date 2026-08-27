import request from 'supertest';
import { expect } from 'vitest';
import type { Express } from 'express';
import type { ImportTaskCase, ImportTaskDetail } from '../../shared/types';

const BUSY: ImportTaskCase['status'][] = ['parsed', 'exploring', 'generating'];

/**
 * 等待导入任务中的页面探索结束，供审阅和发布测试共用。
 */
export async function waitForImportReview(app: Express, taskId: string, timeoutMs = 4000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const res = await request(app).get(`/api/projects/crm/imports/${taskId}`);
    expect(res.status).toBe(200);
    const task = res.body as ImportTaskDetail;

    if (!task.cases.some((item) => BUSY.includes(item.status))) {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`等待导入任务 ${taskId} 探索结束超时`);
}

/**
 * 启动整单审阅并等到探索结束。
 */
export async function startImportReview(app: Express, taskId: string) {
  const started = await request(app).post(`/api/projects/crm/imports/${taskId}/review`);
  expect(started.status).toBe(200);
  return waitForImportReview(app, taskId);
}

/**
 * 启动单条重试并等到探索结束。
 */
export async function startImportRetry(app: Express, taskId: string, caseId: string) {
  const started = await request(app).post(`/api/projects/crm/imports/${taskId}/cases/${caseId}/retry`);
  expect(started.status).toBe(200);
  return waitForImportReview(app, taskId);
}
