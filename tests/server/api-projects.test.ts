import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { getProjectsRoot } from '../../server/src/lib/path';
import { createAuthState, getProjectAuthPath } from '../../server/src/services/auth-session';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-api-'));
  process.env.DATA_ROOT = root;
  process.env.PLAYWRIGHT_AUTO_CONFIG = join(root, 'playwright-auto.config.json');
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.PLAYWRIGHT_AUTO_CONFIG;
  delete process.env.PLAYWRIGHT_AUTO_CORS_ORIGINS;
  await rm(root, { recursive: true, force: true });
});

describe('项目接口', () => {
  it('默认拒绝非本机前端来源访问本地 API', async () => {
    const app = createApp();

    const res = await request(app).get('/api/projects').set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('请求来源不允许访问本地服务');
  });

  it('允许配置额外前端来源访问本地 API', async () => {
    process.env.PLAYWRIGHT_AUTO_CORS_ORIGINS = 'https://tool.example';
    const app = createApp();

    const res = await request(app).get('/api/projects').set('Origin', 'https://tool.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://tool.example');
  });

  it('允许尾随斜杠形式的已配置前端来源访问本地 API', async () => {
    const app = createApp();

    const res = await request(app).get('/api/projects').set('Origin', 'http://localhost:5173/');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173/');
  });

  it('可以读取全局步骤配置', async () => {
    const app = createApp();

    const res = await request(app).get('/api/app-config');

    expect(res.status).toBe(200);
    expect(res.body.steps.timeouts).toEqual({
      navigation: 20000,
      action: 2000,
      wait: 1000
    });
  });

  it('通过接口创建并读取项目', async () => {
    const app = createApp();

    const created = await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      envName: '测试环境',
      baseUrl: 'https://crm.test.local'
    });

    expect(created.status).toBe(201);
    expect(created.body.key).toBe('crm');
    expect(created.body.envs[0].name).toBe('测试环境');

    const list = await request(app).get('/api/projects');

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('CRM 系统');
  });

  it('创建项目时自动把项目标识转为小写', async () => {
    const app = createApp();

    const created = await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'CRM',
      baseUrl: 'https://crm.test.local'
    });

    expect(created.status).toBe(201);
    expect(created.body.key).toBe('crm');

    const detail = await request(app).get('/api/projects/crm');

    expect(detail.status).toBe(200);
    expect(detail.body.key).toBe('crm');
  });

  it('不存在的项目返回 404', async () => {
    const app = createApp();

    const res = await request(app).get('/api/projects/missing');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('项目不存在');
  });

  it('创建项目时未填写默认环境名称会使用默认环境', async () => {
    const app = createApp();

    const missingName = await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const blankName = await request(app).post('/api/projects').send({
      name: '商城系统',
      key: 'shop',
      envName: '   ',
      baseUrl: 'https://shop.test.local'
    });

    expect(missingName.status).toBe(201);
    expect(missingName.body.envs[0].name).toBe('默认环境');
    expect(blankName.status).toBe(201);
    expect(blankName.body.envs[0].name).toBe('默认环境');
  });

  it('创建项目参数不合法时返回可读错误消息', async () => {
    const app = createApp();

    const invalidUrl = await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'bad-url'
    });
    expect(invalidUrl.status).toBe(400);
    expect(invalidUrl.body.message.replace(/\s+/g, '')).toContain('URL不合法');

    const invalidKey = await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'CRM 系统',
      baseUrl: 'https://crm.test.local'
    });
    expect(invalidKey.status).toBe(400);
    expect(invalidKey.body.message.replace(/\s+/g, '')).toContain('标识不合法');
  });

  it('拒绝非法项目路径参数', async () => {
    const app = createApp();

    const res = await request(app).get('/api/projects/CRM');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('项目标识不合法');
  });

  it('读取项目列表时忽略 projects 目录下的占位文件', async () => {
    const app = createApp();
    await mkdir(getProjectsRoot(), { recursive: true });
    await writeFile(join(getProjectsRoot(), '.gitkeep'), '', 'utf8');
    await request(app).post('/api/projects').send({
      name: 'CCTQ',
      key: 'cctq',
      baseUrl: 'https://www.cctq.ai/'
    });

    const list = await request(app).get('/api/projects');

    expect(list.status).toBe(200);
    expect(list.body.map((item: { key: string }) => item.key)).toEqual(['cctq']);
  });

  it('可以新增、编辑和删除项目环境', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });

    const created = await request(app).post('/api/projects/crm/envs').send({
      name: '预发环境',
      key: 'pre',
      baseUrl: 'https://pre.test.local'
    });
    expect(created.status).toBe(201);
    expect(created.body.envs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '预发环境',
          key: 'pre',
          baseUrl: 'https://pre.test.local'
        })
      ])
    );

    const duplicate = await request(app).post('/api/projects/crm/envs').send({
      name: '重复环境',
      key: 'pre',
      baseUrl: 'https://dup.test.local'
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe('环境标识已存在');

    const updated = await request(app).put('/api/projects/crm/envs/pre').send({
      name: '预发二环境',
      baseUrl: 'https://pre2.test.local'
    });
    expect(updated.status).toBe(200);
    expect(updated.body.envs.find((item: { key: string }) => item.key === 'pre')).toMatchObject({
      name: '预发二环境',
      baseUrl: 'https://pre2.test.local'
    });

    const defaultEnv = await request(app).put('/api/projects/crm/default-env').send({ envKey: 'pre' });
    expect(defaultEnv.status).toBe(404);

    const removeDefault = await request(app).delete('/api/projects/crm/envs/default');
    expect(removeDefault.status).toBe(400);
    expect(removeDefault.body.message).toBe('默认环境不允许删除');

    await createAuthState('crm', { cookies: [], origins: [] }, 'pre');
    await expect(stat(getProjectAuthPath('crm', 'pre'))).resolves.toBeTruthy();

    const removed = await request(app).delete('/api/projects/crm/envs/pre');
    expect(removed.status).toBe(204);

    await expect(stat(getProjectAuthPath('crm', 'pre'))).rejects.toThrow();

    const envs = await request(app).get('/api/projects/crm/envs');
    expect(envs.status).toBe(200);
    expect(envs.body.defaultEnv).toBe('default');
    expect(envs.body.envs.map((item: { key: string }) => item.key)).toEqual(['default']);
  });

  it('可以导出项目并排除登录态文件', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await request(app).post('/api/projects/crm/cases').send({
      name: '创建订单',
      startPath: '/orders/create'
    });
    await createAuthState('crm', { cookies: [{ name: 'sid', value: 'secret' }], origins: [] });

    const res = await request(app)
      .get('/api/projects/crm/export')
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    const zipText = Buffer.from(res.body).toString('utf8');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('crm.zip');
    expect(zipText).toContain('project.json');
    expect(zipText).toContain('cases/');
    expect(zipText).not.toContain('auth/default.storageState.json');
  });

  it('可以彻底删除项目目录和所有项目数据', async () => {
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    await request(app).post('/api/projects/crm/cases').send({
      name: '创建订单',
      startPath: '/orders/create'
    });
    await mkdir(join(getProjectsRoot(), 'crm', 'trash', 'old-case'), { recursive: true });
    await mkdir(join(getProjectsRoot(), 'crm', 'reviews', 'review-1'), { recursive: true });
    await writeFile(join(getProjectsRoot(), 'crm', 'trash', 'old-case', 'case.json'), '{}', 'utf8');
    await writeFile(join(getProjectsRoot(), 'crm', 'reviews', 'review-1', 'review.json'), '{}', 'utf8');

    const removed = await request(app).delete('/api/projects/crm');
    const list = await request(app).get('/api/projects');

    expect(removed.status).toBe(204);
    await expect(stat(join(getProjectsRoot(), 'crm'))).rejects.toThrow();
    expect(list.body).toEqual([]);
  });

  it('修改环境 URL 后该环境的实测检查结果变为过期', async () => {
    process.env.NODE_ENV = 'test';
    const app = createApp();
    await request(app).post('/api/projects').send({
      name: 'CRM 系统',
      key: 'crm',
      baseUrl: 'https://crm.test.local'
    });
    const created = await request(app).post('/api/projects/crm/cases').send({
      name: '创建订单',
      startPath: '/orders/create'
    });
    await request(app)
      .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
      .send({ envKey: 'default' });

    await request(app).put('/api/projects/crm/envs/default').send({
      name: '默认环境',
      baseUrl: 'https://new.crm.test.local'
    });

    const detail = await request(app).get(`/api/projects/crm/cases/${created.body.key}`);

    expect(detail.body.practicalReview.status).toBe('expired');
  });
});
