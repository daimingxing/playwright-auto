import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { parseJsonObject } from '../../server/src/services/ai-client';
import { buildCaseDraftInput, completeDraftSelectors, normalizeAiDraft } from '../../server/src/services/ai-case-draft';
import { assertPageAvailable, readPageSnapshot, resolveUnique, waitForPageReady } from '../../server/src/services/page-context';
import { getChromePath } from '../../server/src/services/vendor-browser';

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
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(input.user).toContain('TC001');
    expect(input.user).toContain('点击新增按钮');
    expect(input.user).toContain('用户管理');
  });

  it('系统提示词包含完整 StepType、输出模板和 selector 推理规则', () => {
    const input = buildCaseDraftInput({
      caseInfo: {
        caseNo: 'TC001',
        caseName: '进入页面',
        targetUrl: '/dashboard',
        precondition: '',
        expectedResult: '进入页面',
        note: ''
      },
      steps: [],
      data: [],
      pageContext: {
        page: { url: '/dashboard', title: '主页', headings: [] },
        elements: {
          buttons: [],
          inputs: [],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });
    const stepTypes = [
      'goto',
      'click',
      'rightClick',
      'doubleClick',
      'hover',
      'fill',
      'select',
      'wait',
      'assertText',
      'assertVisible',
      'assertValue',
      'assertUrl',
      'assertTitle'
    ];

    for (const type of stepTypes) {
      expect(input.system).toContain(type);
    }
    expect(input.system).toContain('"selector"');
    expect(input.system).toContain('"confidence":"low"');
    expect(input.system).toContain('推理 Playwright selector');
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

  it('兼容数字 id 和数字置信度，缺少 selector 时仍生成草稿', () => {
    const draft = normalizeAiDraft({
      name: '进入车辆信息页面',
      startPath: '/dashboard',
      confidence: 0.2,
      warnings: [
        '步骤1定位器可能存在歧义',
        '步骤2操作路径可能与预期不符',
        '步骤3缺少目标元素'
      ],
      missingInfo: ['步骤3缺少目标元素定位器'],
      steps: [
        {
          id: 1,
          type: 'click',
          text: '点击菜单的物流管控',
          selector: "getByText('物流管控', { exact: true })",
          confidence: 0.7,
          warnings: ["页面中找到'物流管控'导航项，但未明确是左侧菜单，可能存在歧义"]
        },
        {
          id: 2,
          type: 'click',
          text: '点击基础管理',
          selector: "getByText('基础管理', { exact: true })",
          confidence: 0.6,
          warnings: ['基础管理在页面中为顶层导航项，而非子菜单，请确认操作路径']
        },
        {
          id: 3,
          type: 'click',
          text: '点击车辆管理',
          confidence: 0,
          warnings: ["页面中未找到'车辆管理'元素，可能需要先展开子菜单或页面跳转后出现"]
        }
      ]
    });

    expect(draft).toMatchObject({
      confidence: 'low',
      steps: [
        {
          id: 'ai-1',
          confidence: 'medium',
          selector: "getByText('物流管控', { exact: true })"
        },
        {
          id: 'ai-2',
          confidence: 'medium',
          selector: "getByText('基础管理', { exact: true })"
        },
        {
          id: 'ai-3',
          confidence: 'low',
          selector: undefined
        }
      ]
    });
  });

  it('模型遗漏 selector 时根据当前页面上下文补充已有菜单定位器', () => {
    const draft = normalizeAiDraft({
      name: '进入车辆信息页面',
      startPath: '/dashboard',
      confidence: 'low',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 1,
          type: 'click',
          text: '点击菜单的物流管控',
          confidence: 'high',
          warnings: []
        },
        {
          id: 2,
          type: 'click',
          text: '点击基础管理',
          confidence: 'medium',
          warnings: []
        },
        {
          id: 3,
          type: 'click',
          text: '点击车辆管理',
          confidence: 'low',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST001',
          stepNo: 1,
          actionText: '点击菜单的物流管控',
          targetText: '左侧菜单的物流管控',
          dataKeys: [],
          note: ''
        },
        {
          caseNo: 'TEST001',
          stepNo: 2,
          actionText: '点击基础管理',
          targetText: '子菜单的基础管理',
          dataKeys: [],
          note: ''
        },
        {
          caseNo: 'TEST001',
          stepNo: 3,
          actionText: '点击车辆管理',
          targetText: '子菜单的车辆管理',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/dashboard', title: '主页', headings: [] },
        elements: {
          buttons: [],
          inputs: [],
          selects: [],
          links: [],
          navigation: [
            {
              text: '物流管控',
              locator: "getByText('物流管控', { exact: true })",
              unique: false
            },
            {
              text: '基础管理',
              locator: "getByText('基础管理', { exact: true })",
              unique: false
            }
          ],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      selector: "getByText('物流管控', { exact: true })",
      confidence: 'medium'
    });
    expect(result.steps[0].warnings).toContain('平台根据页面上下文自动补充 selector，但该定位器当前匹配不唯一，请人工确认。');
    expect(result.steps[1].selector).toBeUndefined();
    expect(result.steps[2].selector).toBeUndefined();
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

  it('等待 SPA 页面渲染出可见内容后再读取上下文', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent('<div id="app"></div><script>setTimeout(() => { document.querySelector("#app").textContent = "物流管控"; }, 50);</script>');
    await waitForPageReady(page);

    expect(await page.locator('body').innerText()).toContain('物流管控');
    await browser.close();
  }, 15000);

  it('读取 Element Plus 菜单作为导航上下文', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <aside class="sidebar">
        <ul class="el-menu">
          <li class="el-sub-menu">
            <div class="el-sub-menu__title">物流管控</div>
            <ul>
              <li class="el-menu-item">基础管理</li>
              <li role="menuitem">车辆管理</li>
            </ul>
          </li>
        </ul>
      </aside>
    `);

    const context = await readPageSnapshot(page, []);

    expect(context.elements.navigation.map((item) => item.text)).toEqual(['物流管控', '基础管理', '车辆管理']);
    expect(context.elements.navigation[0].locator).toBe("getByText('物流管控', { exact: true })");
    await browser.close();
  }, 15000);
});
