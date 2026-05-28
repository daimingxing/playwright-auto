import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { parseJsonObject } from '../../server/src/services/ai/ai-client';
import { buildCaseDraftGroupInput, buildCaseDraftInput, completeDraftSelectors, normalizeAiDraft, normalizeAiDraftGroup } from '../../server/src/services/ai/ai-case-draft';
import type { DraftGroupInput } from '../../server/src/services/ai/ai-case-draft';
import { assertPageAvailable, readPageSnapshot, resolveUnique, waitForPageReady } from '../../server/src/services/ai/page-context';
import { getChromePath } from '../../server/src/services/playwright/vendor-browser';

describe('AI 草稿生成服务', () => {
  it('分组 prompt 包含页面地图摘要和多条用例', () => {
    const input = buildCaseDraftGroupInput({
      pageMap: {
        mapId: 'pm-test',
        targetUrl: '/user/list',
        states: [
          {
            stateId: 'state-initial',
            name: '初始页面',
            context: {
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
          },
          {
            stateId: 'state-dialog',
            name: '新增弹窗',
            actionName: '新增',
            context: {
              page: { url: '/user/list', title: '新增用户', headings: ['新增用户'] },
              elements: {
                buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
                inputs: [{ label: '用户名称', locator: "getByLabel('用户名称')", unique: true }],
                selects: [],
                links: [],
                navigation: [],
                tables: []
              },
              warnings: []
            }
          }
        ],
        warnings: []
      },
      cases: [
        {
          caseInfo: {
            caseNo: 'TC001',
            caseName: '新增用户',
            targetUrl: '/user/list',
            precondition: '',
            expectedResult: '新增成功',
            note: ''
          },
          steps: [
            {
              caseNo: 'TC001',
              stepNo: 1,
              actionType: 'click',
              targetType: 'button',
              targetName: '新增',
              actionText: '点击新增',
              targetText: '新增按钮',
              dataKeys: [],
              note: ''
            }
          ],
          data: []
        },
        {
          caseInfo: {
            caseNo: 'TC002',
            caseName: '填写用户',
            targetUrl: '/user/list',
            precondition: '',
            expectedResult: '',
            note: ''
          },
          steps: [
            {
              caseNo: 'TC002',
              stepNo: 1,
              actionType: 'fill',
              targetType: 'input',
              targetName: '用户名称',
              inputValue: '张三',
              actionText: '填写用户名称',
              targetText: '用户名称输入框',
              dataKeys: [],
              note: ''
            }
          ],
          data: []
        }
      ]
    });

    expect(input.system).toContain('items');
    expect(input.system).toContain('caseNo');
    expect(input.user).toContain('"pageMap"');
    expect(input.user).toContain('"state-dialog"');
    expect(input.user).toContain('"cases"');
    expect(input.user).toContain('"TC001"');
    expect(input.user).toContain('"TC002"');
  });

  it('模型返回部分失败时成功项进入待确认，失败项保留错误信息', () => {
    const result = normalizeAiDraftGroup({
      items: [
        {
          caseNo: 'TC001',
          draft: {
            name: '新增用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击新增',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        },
        {
          caseNo: 'TC002',
          error: '缺少页面元素'
        }
      ]
    }, createGroupNormalizeInput());

    expect(result.items[0]).toMatchObject({
      caseNo: 'TC001',
      draft: {
        steps: [
          {
            selector: "getByRole('button', { name: '新增' })"
          }
        ]
      }
    });
    expect(result.items[0].error).toBeUndefined();
    expect(result.items[1]).toMatchObject({
      caseNo: 'TC002',
      error: '缺少页面元素'
    });
    expect(result.items[1].draft).toBeUndefined();
  });

  it('未返回某个 caseNo 时该用例失败且不影响其他用例', () => {
    const result = normalizeAiDraftGroup({
      items: [
        {
          caseNo: 'TC001',
          draft: {
            name: '新增用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击新增',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        }
      ]
    }, createGroupNormalizeInput());

    expect(result.items[0].draft?.steps[0].selector).toBe("getByRole('button', { name: '新增' })");
    expect(result.items[1]).toMatchObject({
      caseNo: 'TC002',
      error: 'AI 未返回该用例结果：TC002'
    });
  });

  it('初始状态 selector 补全不会说明候选来自页面状态', () => {
    const input = createGroupNormalizeInput();

    input.cases[0].steps[0].targetName = '新增';
    input.cases[0].steps[0].targetText = '新增按钮';
    input.cases[0].steps[0].actionText = '点击新增';

    const result = normalizeAiDraftGroup({
      items: [
        {
          caseNo: 'TC001',
          draft: {
            name: '新增用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击新增',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        },
        {
          caseNo: 'TC002',
          error: '本条不处理'
        }
      ]
    }, input);

    expect(result.items[0].draft?.steps[0]).toMatchObject({
      selector: "getByRole('button', { name: '新增' })"
    });
    expect(result.items[0].draft?.steps[0].warnings).not.toContain('selector 候选来自页面状态：初始页面。');
  });

  it('非初始状态 selector 补全会说明候选来自哪个页面状态', () => {
    const result = normalizeAiDraftGroup({
      items: [
        {
          caseNo: 'TC001',
          draft: {
            name: '新增用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击保存',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        },
        {
          caseNo: 'TC002',
          error: '本条不处理'
        }
      ]
    }, createGroupNormalizeInput());

    expect(result.items[0].draft?.steps[0]).toMatchObject({
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.items[0].draft?.steps[0].warnings).toContain('selector 候选来自页面状态：新增弹窗。');
  });

  it('缺少 caseNo 和未知 caseNo 进入组级错误且不生成空编号结果', () => {
    const input = createGroupNormalizeInput();
    const result = normalizeAiDraftGroup({
      items: [
        { draft: {} },
        { caseNo: 'TC999', draft: {} },
        {
          caseNo: 'TC001',
          draft: {
            name: '新增用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击保存',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        }
      ]
    }, input);

    expect(result.groupErrors).toEqual([
      'AI 返回项缺少 caseNo（第 1 项）',
      'AI 返回未知用例编号：TC999'
    ]);
    expect(result.items.some((item) => item.caseNo === '')).toBe(false);
    expect(result.items[0].draft?.steps[0].selector).toBe("getByRole('button', { name: '保存' })");
    expect(result.items[1]).toMatchObject({
      caseNo: 'TC002',
      error: 'AI 未返回该用例结果：TC002'
    });
  });

  it('重复 caseNo 和草稿结构不合法进入对应用例错误', () => {
    const input = createGroupNormalizeInput();

    expect(normalizeAiDraftGroup({ items: [{ caseNo: 'TC001', draft: { name: '坏结构' } }] }, input).items[0].error).toContain('AI 返回草稿结构不合法');
    expect(normalizeAiDraftGroup({ items: [{ caseNo: 'TC001', draft: {} }, { caseNo: 'TC001', draft: {} }] }, input).items[0].error).toContain('AI 返回重复用例编号');
  });

  it('重复 caseNo 有成功草稿时仍返回重复编号中文错误', () => {
    const result = normalizeAiDraftGroup({
      items: [
        {
          caseNo: 'TC001',
          draft: {
            name: '新增用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击保存',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        },
        {
          caseNo: 'TC001',
          draft: {
            name: '重复用户',
            startPath: '/user/list',
            confidence: 'high',
            warnings: [],
            missingInfo: [],
            steps: [
              {
                id: 'ai-1',
                type: 'click',
                text: '点击新增',
                confidence: 'high',
                warnings: []
              }
            ]
          }
        }
      ]
    }, createGroupNormalizeInput());

    expect(result.items[0]).toMatchObject({
      caseNo: 'TC001',
      error: 'AI 返回重复用例编号：TC001'
    });
    expect(result.items[0].draft).toBeUndefined();
  });

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

  it('系统提示词包含结构化字段说明和 selector 推理规则', () => {
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
    expect(input.system).toContain('actionType、targetType、matchType 已经由平台解析为英文枚举');
    expect(input.system).toContain('不要从大段自然语言重新猜测动作类型');
    expect(input.system).toContain('targetName 是测试人员填写的中文对象名');
  });

  it('模型输入展示结构化目标名和输入期望值', () => {
    const input = buildCaseDraftInput({
      caseInfo: {
        caseNo: 'TC002',
        caseName: '填写用户名称',
        targetUrl: '/user/add',
        precondition: '',
        expectedResult: '',
        note: ''
      },
      steps: [
        {
          caseNo: 'TC002',
          stepNo: 1,
          actionType: 'fill',
          targetType: 'input',
          targetName: '用户名称输入框',
          inputValue: '张三',
          actionText: '填写(fill)',
          targetText: '输入框(input)',
          dataKeys: [],
          note: ''
        }
      ],
      data: [],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [],
          inputs: [{ label: '用户名称', placeholder: '请输入用户名称', locator: "getByLabel('用户名称')", unique: true }],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(input.user).toContain('"targetName": "用户名称输入框"');
    expect(input.user).toContain('"inputValue": "张三"');
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

  it('selector 补全按结构化 fill 动作修正类型并选择输入框候选', () => {
    const draft = normalizeAiDraft({
      name: '填写用户名称',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'click',
          text: '点击用户名称',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST002',
          stepNo: 1,
          actionType: 'fill',
          targetType: 'input',
          targetName: '用户名称',
          inputValue: '张三',
          actionText: '填写(fill)',
          targetText: '输入框(input)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '用户名称', locator: "getByRole('button', { name: '用户名称' })", unique: true }],
          inputs: [{ label: '用户名称', placeholder: '请输入用户名称', locator: "getByLabel('用户名称')", unique: true }],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'fill',
      selector: "getByLabel('用户名称')"
    });
    expect(result.steps[0].warnings).toContain('平台按模板动作类型修正 AI 返回步骤类型，请确认草稿步骤。');
  });

  it('assertVisible 按结构化目标类型选择输入框候选', () => {
    const draft = normalizeAiDraft({
      name: '检查用户名称可见',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'assertVisible',
          text: '检查用户名称可见',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST003',
          stepNo: 1,
          actionType: 'assertVisible',
          targetType: 'input',
          targetName: '用户名称',
          actionText: '检查可见(assertVisible)',
          targetText: '输入框(input)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '用户名称', locator: "getByRole('button', { name: '用户名称' })", unique: true }],
          inputs: [{ label: '用户名称', placeholder: '请输入用户名称', locator: "getByLabel('用户名称')", unique: true }],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'assertVisible',
      selector: "getByLabel('用户名称')"
    });
  });

  it('按结构化普通动作修正类型时清理模型误写的 match', () => {
    const draft = normalizeAiDraft({
      name: '点击保存',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'assertText',
          selector: undefined,
          value: '保存成功',
          match: 'contains',
          text: '检查保存按钮',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST004',
          stepNo: 1,
          actionType: 'click',
          targetType: 'button',
          targetName: '保存',
          inputValue: '保存成功',
          matchType: 'contains',
          actionText: '点击(click)',
          targetText: '按钮(button)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'click',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.steps[0].match).toBeUndefined();
    expect(result.steps[0].value).toBeUndefined();
    expect(result.steps[0].warnings).toContain('平台按模板动作类型修正 AI 返回步骤类型，请确认草稿步骤。');
  });

  it('类型修正后丢弃模型基于错误类型返回的 selector 并重新补全', () => {
    const draft = normalizeAiDraft({
      name: '点击保存',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'fill',
          selector: "getByLabel('用户名称')",
          value: '张三',
          text: '填写用户名称',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST005',
          stepNo: 1,
          actionType: 'click',
          targetType: 'button',
          targetName: '保存',
          actionText: '点击(click)',
          targetText: '按钮(button)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
          inputs: [{ label: '用户名称', placeholder: '请输入用户名称', locator: "getByLabel('用户名称')", unique: true }],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'click',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.steps[0].selector).not.toBe("getByLabel('用户名称')");
    expect(result.steps[0].value).toBeUndefined();
    expect(result.steps[0].warnings).toContain('平台按模板动作类型修正 AI 返回步骤类型，请确认草稿步骤。');
  });

  it('修正为可见和地址断言时清理模型误写的 match', () => {
    const draft = normalizeAiDraft({
      name: '检查状态',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'assertText',
          selector: 'body',
          value: '保存',
          match: 'contains',
          text: '检查保存按钮可见',
          confidence: 'medium',
          warnings: []
        },
        {
          id: 'ai-2',
          type: 'assertText',
          selector: 'body',
          value: '/user/add',
          match: 'equals',
          text: '检查页面地址',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST006',
          stepNo: 1,
          actionType: 'assertVisible',
          targetType: 'button',
          targetName: '保存',
          actionText: '检查可见(assertVisible)',
          targetText: '按钮(button)',
          dataKeys: [],
          note: ''
        },
        {
          caseNo: 'TEST006',
          stepNo: 2,
          actionType: 'assertUrl',
          targetType: 'page',
          targetName: '当前地址',
          inputValue: '/user/add',
          matchType: 'equals',
          actionText: '检查地址(assertUrl)',
          targetText: '页面(page)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'assertVisible',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.steps[0].match).toBeUndefined();
    expect(result.steps[1]).toMatchObject({
      type: 'assertUrl',
      value: '/user/add'
    });
    expect(result.steps[1].match).toBeUndefined();
  });

  it('同类型结构化可见断言会清理模型误写的 match', () => {
    const draft = normalizeAiDraft({
      name: '检查保存按钮',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'assertVisible',
          selector: "getByRole('button', { name: '保存' })",
          match: 'contains',
          text: '检查保存按钮可见',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST007',
          stepNo: 1,
          actionType: 'assertVisible',
          targetType: 'button',
          targetName: '保存',
          matchType: 'contains',
          actionText: '检查可见(assertVisible)',
          targetText: '按钮(button)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'assertVisible',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.steps[0].match).toBeUndefined();
  });

  it('同类型结构化点击动作会清理模型误写的 value 和 match', () => {
    const draft = normalizeAiDraft({
      name: '点击保存',
      startPath: '/user/add',
      confidence: 'medium',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'click',
          selector: "getByRole('button', { name: '保存' })",
          value: '保存成功',
          match: 'contains',
          text: '点击保存按钮',
          confidence: 'medium',
          warnings: []
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST008',
          stepNo: 1,
          actionType: 'click',
          targetType: 'button',
          targetName: '保存',
          inputValue: '保存成功',
          matchType: 'contains',
          actionText: '点击(click)',
          targetText: '按钮(button)',
          dataKeys: [],
          note: ''
        }
      ],
      pageContext: {
        page: { url: '/user/add', title: '新增用户', headings: [] },
        elements: {
          buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
          inputs: [],
          selects: [],
          links: [],
          navigation: [],
          tables: []
        },
        warnings: []
      }
    });

    expect(result.steps[0]).toMatchObject({
      type: 'click',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.steps[0].value).toBeUndefined();
    expect(result.steps[0].match).toBeUndefined();
  });

  it('结构化 fill 步骤把输入期望值映射到草稿 value', async () => {
    const result = await import('../../server/src/services/ai/ai-case-draft').then(({ generateCaseDraft }) =>
      generateCaseDraft({
        caseInfo: {
          caseNo: 'TC003',
          caseName: '填写用户名称',
          targetUrl: '/user/add',
          precondition: '',
          expectedResult: '',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC003',
            stepNo: 1,
            actionType: 'fill',
            targetType: 'input',
            targetName: '用户名称',
            inputValue: '张三',
            actionText: '填写(fill)',
            targetText: '输入框(input)',
            dataKeys: [],
            note: ''
          }
        ],
        data: [],
        pageContext: {
          page: { url: '/user/add', title: '新增用户', headings: [] },
          elements: {
            buttons: [],
            inputs: [{ label: '用户名称', placeholder: '请输入用户名称', locator: "getByLabel('用户名称')", unique: true }],
            selects: [],
            links: [],
            navigation: [],
            tables: []
          },
          warnings: []
        }
      })
    );

    expect(result.draft.steps[0]).toMatchObject({
      type: 'fill',
      selector: "getByLabel('用户名称')",
      value: '张三',
      text: '填写 用户名称'
    });
  });

  it('结构化检查步骤把匹配方式映射到草稿 match', async () => {
    const result = await import('../../server/src/services/ai/ai-case-draft').then(({ generateCaseDraft }) =>
      generateCaseDraft({
        caseInfo: {
          caseNo: 'TC004',
          caseName: '检查保存结果',
          targetUrl: '/user/add',
          precondition: '',
          expectedResult: '',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC004',
            stepNo: 1,
            actionType: 'assertText',
            targetType: 'text',
            targetName: '保存提示',
            inputValue: '保存成功',
            matchType: 'equals',
            actionText: '检查文本(assertText)',
            targetText: '文本(text)',
            dataKeys: [],
            note: ''
          }
        ],
        data: [],
        pageContext: {
          page: { url: '/user/add', title: '新增用户', headings: [] },
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
      })
    );

    expect(result.draft.steps[0]).toMatchObject({
      type: 'assertText',
      selector: 'body',
      value: '保存成功',
      match: 'equals',
      text: '检查 保存提示'
    });
  });

  it('结构化可见和标题断言不写入 match', async () => {
    const result = await import('../../server/src/services/ai/ai-case-draft').then(({ generateCaseDraft }) =>
      generateCaseDraft({
        caseInfo: {
          caseNo: 'TC007',
          caseName: '检查页面状态',
          targetUrl: '/user/add',
          precondition: '',
          expectedResult: '',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC007',
            stepNo: 1,
            actionType: 'assertVisible',
            targetType: 'button',
            targetName: '保存',
            matchType: 'contains',
            actionText: '检查可见(assertVisible)',
            targetText: '按钮(button)',
            dataKeys: [],
            note: ''
          },
          {
            caseNo: 'TC007',
            stepNo: 2,
            actionType: 'assertTitle',
            targetType: 'page',
            targetName: '页面标题',
            inputValue: '新增用户',
            matchType: 'equals',
            actionText: '检查标题(assertTitle)',
            targetText: '页面(page)',
            dataKeys: [],
            note: ''
          }
        ],
        data: [],
        pageContext: {
          page: { url: '/user/add', title: '新增用户', headings: [] },
          elements: {
            buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
            inputs: [],
            selects: [],
            links: [],
            navigation: [],
            tables: []
          },
          warnings: []
        }
      })
    );

    expect(result.draft.steps[0]).toMatchObject({
      type: 'assertVisible',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.draft.steps[0].match).toBeUndefined();
    expect(result.draft.steps[1]).toMatchObject({
      type: 'assertTitle',
      value: '新增用户'
    });
    expect(result.draft.steps[1].match).toBeUndefined();
  });

  it('普通动作不会误用结构化匹配方式', async () => {
    const result = await import('../../server/src/services/ai/ai-case-draft').then(({ generateCaseDraft }) =>
      generateCaseDraft({
        caseInfo: {
          caseNo: 'TC005',
          caseName: '点击保存',
          targetUrl: '/user/add',
          precondition: '',
          expectedResult: '',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC005',
            stepNo: 1,
            actionType: 'click',
            targetType: 'button',
            targetName: '保存按钮',
            inputValue: '保存成功',
            matchType: 'contains',
            actionText: '点击(click)',
            targetText: '按钮(button)',
            dataKeys: [],
            note: ''
          }
        ],
        data: [],
        pageContext: {
          page: { url: '/user/add', title: '新增用户', headings: [] },
          elements: {
            buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
            inputs: [],
            selects: [],
            links: [],
            navigation: [],
            tables: []
          },
          warnings: []
        }
      })
    );

    expect(result.draft.steps[0]).toMatchObject({
      type: 'click',
      selector: "getByRole('button', { name: '保存' })"
    });
    expect(result.draft.steps[0].match).toBeUndefined();
    expect(result.draft.steps[0].value).toBeUndefined();
  });

  it('旧字段输入仍能生成测试环境固定草稿', async () => {
    const result = await import('../../server/src/services/ai/ai-case-draft').then(({ generateCaseDraft }) =>
      generateCaseDraft({
        caseInfo: {
          caseNo: 'TC006',
          caseName: '旧模板新增用户',
          targetUrl: '/user/list',
          precondition: '',
          expectedResult: '新增成功',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC006',
            stepNo: 1,
            actionText: '点击新增按钮',
            targetText: '新增按钮',
            dataKeys: [],
            note: ''
          }
        ],
        data: [],
        pageContext: {
          page: { url: '/user/list', title: '用户管理', headings: [] },
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
      })
    );

    expect(result.draft).toMatchObject({
      name: '旧模板新增用户',
      startPath: '/user/list',
      steps: [
        {
          type: 'click',
          selector: "getByRole('button', { name: '新增' })",
          text: '点击新增按钮'
        },
        {
          type: 'assertText',
          selector: 'body',
          value: '新增成功',
          match: 'contains'
        }
      ]
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

/**
 * 创建分组归一化测试输入。
 */
function createGroupNormalizeInput(): DraftGroupInput {
  return {
    pageMap: {
      mapId: 'pm-test',
      targetUrl: '/user/list',
      states: [
        {
          stateId: 'state-initial',
          name: '初始页面',
          context: {
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
        },
        {
          stateId: 'state-dialog',
          name: '新增弹窗',
          actionName: '新增',
          context: {
            page: { url: '/user/list', title: '新增用户', headings: ['新增用户'] },
            elements: {
              buttons: [{ text: '保存', locator: "getByRole('button', { name: '保存' })", unique: true }],
              inputs: [{ label: '用户名称', locator: "getByLabel('用户名称')", unique: true }],
              selects: [],
              links: [],
              navigation: [],
              tables: []
            },
            warnings: []
          }
        }
      ],
      warnings: []
    },
    cases: [
      {
        caseInfo: {
          caseNo: 'TC001',
          caseName: '新增用户',
          targetUrl: '/user/list',
          precondition: '',
          expectedResult: '',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC001',
            stepNo: 1,
            actionType: 'click',
            targetType: 'button',
            targetName: '保存',
            actionText: '点击保存',
            targetText: '保存按钮',
            dataKeys: [],
            note: ''
          }
        ],
        data: []
      },
      {
        caseInfo: {
          caseNo: 'TC002',
          caseName: '填写用户',
          targetUrl: '/user/list',
          precondition: '',
          expectedResult: '',
          note: ''
        },
        steps: [
          {
            caseNo: 'TC002',
            stepNo: 1,
            actionType: 'fill',
            targetType: 'input',
            targetName: '用户名称',
            inputValue: '张三',
            actionText: '填写用户名称',
            targetText: '用户名称输入框',
            dataKeys: [],
            note: ''
          }
        ],
        data: []
      }
    ]
  };
}
