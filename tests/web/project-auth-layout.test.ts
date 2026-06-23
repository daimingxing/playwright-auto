import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('项目登录态页面布局', () => {
  it('用例管理页在列表前展示项目环境与登录态维护区', () => {
    const content = readFileSync('web/src/pages/project-detail/ProjectDetail.vue', 'utf8');

    expect(content).toContain('class="auth-strip"');
    expect(content).toContain('项目环境与登录态');
    expect(content.indexOf('class="auth-strip"')).toBeLessThan(content.indexOf('<section class="list-block">'));
    expect(content).toContain('@click="openLogin"');
    expect(content).toContain('@click="saveAuth"');
  });

  it('AI 导入页创建任务时使用当前环境但不提供登录态维护入口', () => {
    const content = readFileSync('web/src/pages/ai-import/AiImportList.vue', 'utf8');

    expect(content).toContain('createAiImport(projectKey, file.value, { envKey: selectedEnv.value, uiLibrary: uiLibrary.value })');
    expect(content).toContain('导入环境');
    expect(content).not.toContain('auth-inline');
    expect(content).not.toContain('@click="openLogin"');
    expect(content).not.toContain('@click="saveAuth"');
  });

  it('用例编辑页不提供登录态维护入口，运行中心保留登录态入口', () => {
    const editor = readFileSync('web/src/pages/case-editor/CaseEditor.vue', 'utf8');
    const runCenter = readFileSync('web/src/pages/run-center/RunCenter.vue', 'utf8');

    expect(editor).not.toContain('label="登录态"');
    expect(editor).not.toContain('@click="openLogin"');
    expect(editor).not.toContain('@click="saveAuth"');
    expect(runCenter).toContain('@click="openLogin"');
    expect(runCenter).toContain('@click="saveAuth"');
  });
});
