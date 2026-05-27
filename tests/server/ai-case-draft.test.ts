import { describe, expect, it } from 'vitest';
import { parseJsonObject } from '../../server/src/services/ai-client';
import { buildCaseDraftInput, normalizeAiDraft } from '../../server/src/services/ai-case-draft';
import { assertPageAvailable, resolveUnique } from '../../server/src/services/page-context';

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

  it('兼容模型把步骤包在 source/draft 里的输出', () => {
    const draft = normalizeAiDraft({
      name: '新增用户',
      startPath: '/user/list',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          source: {
            id: 'ai-1',
            type: 'click',
            selector: "getByRole('button', { name: '新增' })",
            text: '点击新增按钮',
            confidence: 'medium',
            warnings: []
          }
        }
      ]
    });

    expect(draft.steps[0]).toMatchObject({
      id: 'ai-1',
      type: 'click',
      text: '点击新增按钮'
    });
  });

  it('为缺少平台字段的模型步骤补充草稿默认值', () => {
    const draft = normalizeAiDraft({
      name: '新增用户',
      startPath: '/user/list',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          source: {
            actionText: '点击新增按钮'
          }
        }
      ]
    });

    expect(draft.steps[0]).toMatchObject({
      id: 'ai-1',
      type: 'click',
      text: '点击新增按钮',
      confidence: 'medium',
      warnings: []
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

  it('解析兼容模型返回的 JSON 文本', () => {
    expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonObject('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseJsonObject('结果如下：{"ok":true}')).toEqual({ ok: true });
  });

  it('目标页面返回错误状态时终止页面上下文采集', () => {
    expect(() =>
      assertPageAvailable({
        url: () => 'https://crm.test.local/missing',
        status: () => 404,
        statusText: () => 'Not Found'
      }, 'https://crm.test.local/missing')
    ).toThrow('目标页面不可访问');
  });
});
