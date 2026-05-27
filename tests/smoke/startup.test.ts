import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';

describe('启动冒烟测试', () => {
  it('健康检查接口返回正常', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('Playwright 配置可以加载目录迁移后的本地浏览器依赖', async () => {
    await expect(import('../../playwright.config')).resolves.toBeDefined();
  });
});
