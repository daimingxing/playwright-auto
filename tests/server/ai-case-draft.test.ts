import { describe, expect, it } from 'vitest';
import { buildCaseDraftInput, normalizeAiDraft } from '../../server/src/services/ai-case-draft';
import { resolveUnique } from '../../server/src/services/page-context';

describe('AI 草稿生成服务', () => {
  it('构造包含模板、数据和页面上下文的模型输入', () => {
    const input = buildCaseDraftInput({
      caseInfo: {
        caseNo: 'TC001',
        caseName: '新增用户',
        targetUrl: '/user/list',
        precondition: '已登录管理员账号',
        expectedResult: '添加成功',
        note: ''
      },
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionText: '点击新增按钮，打开新增窗口',
          targetText: '新增按钮',
          dataKeys: [],
          note: ''
        }
      ],
      data: [],
      pageContext: {
        page: { url: '/user/list', title: '用户管理', headings: ['用户管理'] },
        elements: {
          buttons: [{ text: '新增', locator: "getByRole('button', { name: '新增' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(input.user).toContain('TC001');
    expect(input.user).toContain('点击新增按钮');
    expect(input.user).toContain('用户管理');
  });

  it('归一化 AI 草稿为平台步骤', () => {
    const draft = normalizeAiDraft({
      name: '新增用户',
      startPath: '/user/list',
      confidence: 'high',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'click',
          selector: "getByRole('button', { name: '新增' })",
          text: '点击新增按钮',
          confidence: 'high',
          warnings: []
        }
      ]
    });

    expect(draft.steps[0]).toMatchObject({
      type: 'click',
      selector: "getByRole('button', { name: '新增' })"
    });
  });

  it('根据现场匹配数量标记候选定位器唯一性', () => {
    const items = resolveUnique([
      { text: '新增', locator: "getByRole('button', { name: '新增' })" },
      { text: '保存', locator: "getByRole('button', { name: '保存' })" }
    ], [1, 2]);

    expect(items).toEqual([
      { text: '新增', locator: "getByRole('button', { name: '新增' })", unique: true },
      { text: '保存', locator: "getByRole('button', { name: '保存' })", unique: false }
    ]);
  });
});
