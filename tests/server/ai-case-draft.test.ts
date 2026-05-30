import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { parseJsonObject } from '../../server/src/services/ai/ai-client';
import { buildCaseDraftGroupInput, buildCaseDraftInput, completeDraftSelectors, completeDraftSelectorsFromPageMap, normalizeAiDraft, normalizeAiDraftGroup } from '../../server/src/services/ai/ai-case-draft';
import type { DraftGroupInput } from '../../server/src/services/ai/ai-case-draft';
import { assertPageAvailable, readPageSnapshot, resolveUnique, runPageAction, waitForPageReady } from '../../server/src/services/ai/page-context';
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

  it('单条 prompt 按控件库动态补充系统规则', () => {
    const kendoInput = buildCaseDraftInput({
      caseInfo: {
        caseNo: 'TC001',
        caseName: '选择取样类别',
        targetUrl: '/web/IMQM07',
        precondition: '',
        expectedResult: '',
        note: ''
      },
      steps: [
        {
          caseNo: 'TC001',
          stepNo: 1,
          actionType: 'select',
          targetType: 'select',
          targetName: '取样类别',
          inputValue: '采购',
          actionText: '选择',
          targetText: '下拉框',
          dataKeys: [],
          note: ''
        }
      ],
      data: [],
      pageContext: {
        page: { url: '/web/IMQM07', title: '取样规则管理', headings: [] },
        elements: { buttons: [], inputs: [], selects: [], links: [], navigation: [], tables: [] },
        fields: [
          {
            name: '取样类别',
            type: 'select',
            ui: 'kendo-dropdownlist',
            value: '---请选择---',
            locators: [
              {
                selector: "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')",
                kind: 'field-container',
                unique: true,
                confidence: 'high'
              }
            ],
            source: 'label-container',
            confidence: 'high'
          }
        ],
        warnings: []
      },
      uiLibrary: 'kendo'
    });
    const nativeInput = buildCaseDraftInput({
      caseInfo: {
        caseNo: 'TC001',
        caseName: '选择取样类别',
        targetUrl: '/web/IMQM07',
        precondition: '',
        expectedResult: '',
        note: ''
      },
      steps: [],
      data: [],
      pageContext: {
        page: { url: '/web/IMQM07', title: '取样规则管理', headings: [] },
        elements: { buttons: [], inputs: [], selects: [], links: [], navigation: [], tables: [] },
        warnings: []
      },
      uiLibrary: 'native'
    });

    expect(kendoInput.system).toContain('uiLibrary');
    expect(kendoInput.system).toContain('Kendo');
    expect(kendoInput.system).toContain('targetType=input 优先 getByRole("textbox", { name })');
    expect(kendoInput.system).toContain('targetType=select 优先 getByRole("combobox", { name })');
    expect(kendoInput.system).not.toContain('targetType=select 优先 getByLabel(name)');
    expect(kendoInput.system).toContain('先点击下拉控件');
    expect(JSON.parse(kendoInput.user).uiLibrary).toBe('kendo');
    expect(JSON.parse(kendoInput.user).pageContext.fields[0]).toMatchObject({
      name: '取样类别',
      value: '---请选择---'
    });
    expect(nativeInput.system).toContain('原生控件');
    expect(nativeInput.system).toContain('selectOption');
    expect(nativeInput.system).not.toContain('Kendo');
    expect(JSON.parse(nativeInput.user).uiLibrary).toBe('native');
  });

  it('pageMap 用户 prompt 包含 fields 且系统提示区分字段名和当前值', () => {
    const base = createGroupPromptInput();
    const input = buildCaseDraftGroupInput({
      ...base,
      pageMap: {
        ...base.pageMap,
        uiLibrary: 'kendo',
        states: [
          {
            ...base.pageMap.states[0],
            context: {
              ...base.pageMap.states[0].context,
              fields: [
                {
                  name: '取样类别',
                  type: 'select',
                  ui: 'kendo-dropdownlist',
                  value: '---请选择---',
                  locators: [
                    {
                      selector: "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')",
                      kind: 'field-container',
                      unique: true,
                      confidence: 'high'
                    }
                  ],
                  source: 'label-container',
                  confidence: 'high'
                }
              ]
            }
          }
        ]
      }
    });
    const user = JSON.parse(input.user);

    expect(user.pageMap.states[0].fields[0]).toMatchObject({
      name: '取样类别',
      value: '---请选择---'
    });
    expect(user.pageMap.states[0].elements).toBeDefined();
    expect(input.system).toContain('field.name 是测试人员可见的字段名');
    expect(input.system).toContain('field.value 是字段当前值');
    expect(input.system).toContain('不要把 field.value 当字段名');
  });

  it('分组 prompt 按页面地图控件库动态补充系统规则', () => {
    const base = createGroupPromptInput();
    const nativeInput = buildCaseDraftGroupInput({
      ...base,
      pageMap: {
        ...base.pageMap,
        uiLibrary: 'native'
      }
    });
    const kendoInput = buildCaseDraftGroupInput({
      ...base,
      pageMap: {
        ...base.pageMap,
        uiLibrary: 'kendo'
      }
    });

    expect(nativeInput.system).toContain('原生控件');
    expect(nativeInput.system).not.toContain('Kendo');
    expect(JSON.parse(nativeInput.user).pageMap.uiLibrary).toBe('native');
    expect(kendoInput.system).toContain('Kendo');
    expect(kendoInput.system).toContain('先点击下拉控件');
    expect(JSON.parse(kendoInput.user).pageMap.uiLibrary).toBe('kendo');
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

  it('selector 补全优先用 fields 匹配 targetName 且不受旧 selects 当前值干扰', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft(), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面')
    });

    expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
    expect(result.steps[0].selector).not.toBe("getByLabel('---请选择---')");
  });

  it('AI 返回 getByText 当前值时 selector 修正后仍优先使用 field locator', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft("getByText('---请选择---')"), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面')
    });

    expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
    expect(result.steps[0].selector).not.toBe("getByLabel('取样类别')");
    expect(result.steps[0].warnings).toContain('平台按模板目标类型修正 AI 推测 selector，请人工确认。');
  });

  it('AI 返回 getByLabel 当前值时 selector 修正后仍优先使用 field locator', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft("getByLabel('---请选择---')"), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面')
    });

    expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
    expect(result.steps[0].selector).not.toBe("getByLabel('---请选择---')");
    expect(result.steps[0].warnings).toContain('平台按模板目标类型修正 AI 推测 selector，请人工确认。');
  });

  it('AI 返回 button selector 时 selector 修正后仍优先使用 field locator', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft("getByRole('button', { name: '---请选择---' })"), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面')
    });

    expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
    expect(result.steps[0].selector).not.toBe("getByLabel('取样类别')");
    expect(result.steps[0].warnings).toContain('平台按模板目标类型修正 AI 推测 selector，请人工确认。');
  });

  it('使用非初始状态 field 补全 selector 时 warnings 说明来源状态', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft(), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('新增弹窗')
    });

    expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
    expect(result.steps[0].warnings).toContain('selector 候选来自页面状态：新增弹窗。');
  });

  it('fields 未命中时 selector 补全回退旧 elements 逻辑', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft(), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面', '其他字段')
    });

    expect(result.steps[0].selector).toBe("getByLabel('取样类别')");
    expect(result.steps[0].warnings).not.toContain('selector 候选来自页面状态：初始页面。');
  });

  it('disabled field 不用于 select 补全并回退唯一 elements', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft(), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面', '取样类别', { fieldState: 'disabled' })
    });

    expect(result.steps[0].selector).toBe("getByLabel('取样类别')");
    expect(result.steps[0].selector).not.toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
  });

  it('readonly field 不用于 fill 补全并回退唯一 elements', () => {
    const result = completeDraftSelectorsFromPageMap(createFillDraft(), {
      steps: [createFillStep()],
      pageMap: createInputFieldPageMap({ fieldState: 'readonly' })
    });

    expect(result.steps[0].selector).toBe("getByLabel('用户名称')");
    expect(result.steps[0].selector).not.toBe("locator('.xr-fc').filter({ hasText: '用户名称' }).locator('input')");
  });

  it('没有页面地图候选时下拉步骤按控件角色生成低置信 selector', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft(undefined, '令牌分组'), {
      steps: [createSelectStep('令牌分组')],
      pageMap: createEmptyPageMap('/token/group')
    });

    expect(result.steps[0].selector).toBe("getByRole('combobox', { name: '令牌分组' })");
    expect(result.steps[0].selector).not.toBe("getByLabel('令牌分组')");
    expect(result.steps[0].confidence).toBe('low');
  });

  it('没有页面地图候选时输入步骤按控件角色生成低置信 selector', () => {
    const result = completeDraftSelectorsFromPageMap(createFillDraft('名称'), {
      steps: [createFillStep('名称')],
      pageMap: createEmptyPageMap('/token/group')
    });

    expect(result.steps[0].selector).toBe("getByRole('textbox', { name: '名称' })");
    expect(result.steps[0].selector).not.toBe("getByLabel('名称')");
    expect(result.steps[0].confidence).toBe('low');
  });

  it('非唯一 field locator 不压过唯一 elements', () => {
    const result = completeDraftSelectorsFromPageMap(createSelectDraft(), {
      steps: [createSelectStep()],
      pageMap: createFieldPageMap('初始页面', '取样类别', { locatorUnique: false })
    });

    expect(result.steps[0].selector).toBe("getByLabel('取样类别')");
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

  it('模型按文本返回按钮 selector 时按结构化目标类型修正为按钮定位', () => {
    const draft = normalizeAiDraft({
      name: '新增用户',
      startPath: '/user/list',
      confidence: 'low',
      warnings: [],
      missingInfo: [],
      steps: [
        {
          id: 'ai-1',
          type: 'click',
          selector: "getByText('新增', { exact: true })",
          text: '点击新增按钮',
          confidence: 'low',
          warnings: ['selector 为 AI 推测，需要人工确认']
        }
      ]
    });

    const result = completeDraftSelectors(draft, {
      steps: [
        {
          caseNo: 'TEST-TYPE',
          stepNo: 1,
          actionType: 'click',
          targetType: 'button',
          targetName: '新增',
          actionText: '点击(click)',
          targetText: '按钮(button)',
          dataKeys: [],
          note: '打开新增弹窗'
        }
      ],
      pageContext: {
        page: { url: '/user/list', title: '用户管理', headings: [] },
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

    expect(result.steps[0]).toMatchObject({
      type: 'click',
      selector: "getByRole('button', { name: '新增' })",
      confidence: 'low'
    });
    expect(result.steps[0].warnings).toContain('平台按模板目标类型修正 AI 推测 selector，请人工确认。');
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

    await page.setContent('<div id="app"></div><script>setTimeout(() => { document.querySelector("#app").innerHTML = "<button>物流管控</button>"; }, 50);</script>');
    await waitForPageReady(page);

    expect(await page.locator('body').innerText()).toContain('物流管控');
    await browser.close();
  }, 15000);

  it('等待页面脱离 Vite 空壳后再认为上下文可采集', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <title>Vite App</title>
      <div id="app"><button>加载中</button></div>
      <script>
        setTimeout(() => {
          document.title = '取样规则管理(IMQM07)';
          document.querySelector('#app').innerHTML = '<button>新增</button><input placeholder="取样名称" />';
        }, 200);
      </script>
    `);

    await waitForPageReady(page);

    expect(await page.title()).toBe('取样规则管理(IMQM07)');
    expect(await page.getByRole('button', { name: '新增' }).count()).toBe(1);
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

  it('读取 Kendo 下拉作为下拉上下文', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="k-form-field">
        <span class="field-label">取样类别</span>
        <span class="k-dropdownlist k-picker" role="combobox" aria-label="取样类别">
          <span class="k-input-value-text">---请选择---</span>
          <button class="k-input-button" aria-label="select" type="button"></button>
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, []);

    expect(context.elements.selects).toContainEqual({
      label: '取样类别',
      text: '---请选择---',
      locator: "getByLabel('取样类别')",
      unique: true
    });
    await browser.close();
  }, 15000);

  it('Kendo 模式从字段容器采集下拉字段语义', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="i-col i-col-12 i-select xr-fc">
        <div class="i-row">
          <div class="i-col i-col-8 i-input-inner-left">
            <label><span class="i-input-required">*</span><span>取样类别</span></label>
          </div>
          <div class="i-col i-col-16" style="display: flex;">
            <span class="k-picker k-dropdownlist k-picker-solid k-picker-md k-rounded-md" role="combobox" aria-controls="edit-0-sampleType_listbox">
              <span class="k-input-inner"><span class="k-input-value-text">---请选择---</span></span>
              <button type="button" aria-label="select"></button>
              <input id="edit-0-sampleType" name="edit-0-sampleType" required value="" data-role="dropdownlist" style="display: none;">
            </span>
          </div>
        </div>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'kendo');
    const field = context.fields?.[0];

    expect(field).toMatchObject({
      name: '取样类别',
      type: 'select',
      ui: 'kendo-dropdownlist',
      required: true,
      value: '---请选择---',
      source: 'label-container',
      confidence: 'high',
      attrs: {
        inputId: 'edit-0-sampleType',
        inputName: 'edit-0-sampleType',
        ariaControls: 'edit-0-sampleType_listbox',
        dataRole: 'dropdownlist'
      }
    });
    expect(field?.locators[0]).toMatchObject({
      kind: 'field-container',
      unique: true,
      confidence: 'high'
    });
    expect(field?.locators[0].selector).not.toContain("getByLabel('---请选择---')");
    expect(await page.locator(field?.locators[0].selector ?? 'body').count()).toBe(1);
    await browser.close();
  }, 15000);

  it('auto 模式检测到 Kendo 特征时采集字段语义', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="xr-fc">
        <label><span class="i-input-required">*</span><span>取样类别</span></label>
        <span class="k-picker k-dropdownlist" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="edit-0-sampleType" name="edit-0-sampleType" required value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'auto');

    expect(context.fields?.map((field) => field.name)).toContain('取样类别');
    await browser.close();
  }, 15000);

  it('native 模式不主动采集 Kendo 字段语义', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="xr-fc">
        <label><span class="i-input-required">*</span><span>取样类别</span></label>
        <span class="k-picker k-dropdownlist" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="edit-0-sampleType" name="edit-0-sampleType" required value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'native');

    expect(context.fields ?? []).toEqual([]);
    await browser.close();
  }, 15000);

  it('Kendo 字段只有特殊 id 时生成可执行属性定位器', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="xr-fc">
        <label for="123:sample.type"><span>取样类别</span></label>
        <span class="k-picker k-dropdownlist" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="123:sample.type" required value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'kendo');
    const attrLocator = context.fields?.[0].locators.find((locator) => locator.kind === 'attr');

    expect(attrLocator?.selector).toBe('input[id="123:sample.type"]');
    expect(await page.locator(attrLocator?.selector ?? 'body').count()).toBe(1);
    await browser.close();
  }, 15000);

  it('只有 aria-label 的 Kendo 字段不会把空字段容器定位器排在首位', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="form-row">
        <span class="k-picker k-dropdownlist" role="combobox" aria-label="取样类别">
          <span class="k-input-value-text">---请选择---</span>
          <input id="sampleType" value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'kendo');
    const field = context.fields?.[0];

    expect(field).toMatchObject({
      name: '取样类别',
      source: 'aria'
    });
    expect(field?.locators[0].kind).not.toBe('field-container');
    expect(await page.locator(field?.locators[0].selector ?? 'body').count()).toBeGreaterThan(0);
    await browser.close();
  }, 15000);

  it('同一宽表单行内的 Kendo 字段不会串用其他字段标签和必填状态', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="form-row">
        <label><span class="i-input-required">*</span><span>供应商</span></label>
        <span class="k-picker k-dropdownlist" role="combobox">
          <span class="k-input-value-text">请选择供应商</span>
          <input id="supplier" required value="" data-role="dropdownlist" style="display: none;">
        </span>
        <label><span>取样类别</span></label>
        <span class="k-picker k-dropdownlist" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="sampleType" value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'kendo');
    const field = context.fields?.find((item) => item.attrs?.inputId === 'sampleType');

    expect(field).toMatchObject({
      name: '取样类别',
      required: false,
      value: '---请选择---'
    });
    await browser.close();
  }, 15000);

  it('Kendo 字段从外层容器和 fieldset 识别 disabled 与 readonly 状态', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <fieldset disabled>
        <div class="xr-fc">
          <label><span>取样类别</span></label>
          <span class="k-picker k-dropdownlist" role="combobox">
            <span class="k-input-value-text">---请选择---</span>
            <input id="sampleType" value="" data-role="dropdownlist" style="display: none;">
          </span>
        </div>
      </fieldset>
      <div class="xr-fc" aria-readonly="true">
        <label><span>取样日期</span></label>
        <span class="k-picker k-datepicker" role="combobox">
          <span class="k-input-value-text">2026-05-30</span>
          <input id="sampleDate" value="2026-05-30" data-role="datepicker" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'kendo');

    expect(context.fields?.find((field) => field.name === '取样类别')?.state).toBe('disabled');
    expect(context.fields?.find((field) => field.name === '取样日期')?.state).toBe('readonly');
    await browser.close();
  }, 15000);

  it('Kendo 字段从 class 和 aria 识别 disabled 与 readonly 状态', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="xr-fc">
        <label><span>禁用类别</span></label>
        <span class="k-picker k-dropdownlist k-disabled" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="disabledKind" value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
      <div class="xr-fc">
        <label><span>禁用来源</span></label>
        <span class="k-picker k-dropdownlist" role="combobox" aria-disabled="true">
          <span class="k-input-value-text">---请选择---</span>
          <input id="disabledSource" value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
      <div class="xr-fc">
        <label><span>只读类别</span></label>
        <span class="k-picker k-dropdownlist k-readonly" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="readonlyKind" value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
      <div class="xr-fc k-state-readonly">
        <label><span>只读来源</span></label>
        <span class="k-picker k-dropdownlist" role="combobox">
          <span class="k-input-value-text">---请选择---</span>
          <input id="readonlySource" value="" data-role="dropdownlist" style="display: none;">
        </span>
      </div>
    `);

    const context = await readPageSnapshot(page, [], 'kendo');

    expect(context.fields?.find((field) => field.name === '禁用类别')?.state).toBe('disabled');
    expect(context.fields?.find((field) => field.name === '禁用来源')?.state).toBe('disabled');
    expect(context.fields?.find((field) => field.name === '只读类别')?.state).toBe('readonly');
    expect(context.fields?.find((field) => field.name === '只读来源')?.state).toBe('readonly');
    await browser.close();
  }, 15000);

  it('执行 Kendo 下拉选择时点击控件本体后再点击选项', async () => {
    const browser = await chromium.launch({ executablePath: getChromePath() });
    const page = await browser.newPage();

    await page.setContent(`
      <div class="k-form-field">
        <span class="field-label">取样类别</span>
        <span id="sampleKind" class="k-dropdownlist k-picker" role="combobox" aria-label="取样类别" tabindex="0">
          <span class="k-input-value-text">---请选择---</span>
          <button class="k-input-button" aria-label="select" type="button"></button>
        </span>
      </div>
      <ul id="sampleOptions" class="k-list" role="listbox" hidden>
        <li class="k-list-item" role="option">采购</li>
        <li class="k-list-item" role="option">生产</li>
      </ul>
      <script>
        const trigger = document.querySelector('#sampleKind');
        const options = document.querySelector('#sampleOptions');
        trigger.addEventListener('click', () => {
          trigger.setAttribute('data-opened', 'true');
          options.hidden = false;
        });
        options.addEventListener('click', (event) => {
          if (event.target.matches('[role="option"]')) {
            trigger.querySelector('.k-input-value-text').textContent = event.target.textContent;
            trigger.setAttribute('data-value', event.target.textContent);
          }
        });
      </script>
    `);

    await runPageAction(page, {
      id: 'action-1',
      type: 'select',
      targetType: 'select',
      targetName: '取样类别',
      value: '采购',
      path: ['取样类别']
    });

    expect(await page.locator('#sampleKind').getAttribute('data-opened')).toBe('true');
    expect(await page.locator('#sampleKind').getAttribute('data-value')).toBe('采购');
    await browser.close();
  }, 15000);
});

/**
 * 创建分组归一化测试输入。
 */
function createGroupNormalizeInput(): DraftGroupInput {
  return createGroupPromptInput();
}

/**
 * 创建分组 prompt 测试输入。
 */
function createGroupPromptInput(): DraftGroupInput {
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

/**
 * 创建 Kendo 下拉导入步骤。
 */
function createSelectStep(targetName = '取样类别') {
  return {
    caseNo: 'TC001',
    stepNo: 1,
    actionType: 'select' as const,
    targetType: 'select' as const,
    targetName,
    inputValue: '采购',
    actionText: `选择${targetName}`,
    targetText: `${targetName}下拉框`,
    dataKeys: [],
    note: ''
  };
}

/**
 * 创建缺少 selector 的下拉草稿。
 */
function createSelectDraft(selector?: string, targetName = '取样类别') {
  return {
    name: `选择${targetName}`,
    startPath: '/web/IMQM07',
    steps: [
      {
        id: 'ai-1',
        type: 'select' as const,
        selector,
        value: '采购',
        text: `选择${targetName}`,
        confidence: 'high' as const,
        warnings: []
      }
    ],
    confidence: 'high' as const,
    warnings: [],
    missingInfo: []
  };
}

/**
 * 创建输入框导入步骤。
 */
function createFillStep(targetName = '用户名称') {
  return {
    caseNo: 'TC001',
    stepNo: 1,
    actionType: 'fill' as const,
    targetType: 'input' as const,
    targetName,
    inputValue: '张三',
    actionText: `填写${targetName}`,
    targetText: `${targetName}输入框`,
    dataKeys: [],
    note: ''
  };
}

/**
 * 创建缺少 selector 的输入草稿。
 */
function createFillDraft(targetName = '用户名称') {
  return {
    name: `填写${targetName}`,
    startPath: '/user/list',
    steps: [
      {
        id: 'ai-1',
        type: 'fill' as const,
        value: '张三',
        text: `填写${targetName}`,
        confidence: 'high' as const,
        warnings: []
      }
    ],
    confidence: 'high' as const,
    warnings: [],
    missingInfo: []
  };
}

/**
 * 创建没有任何可用候选的页面地图。
 */
function createEmptyPageMap(targetUrl: string): DraftGroupInput['pageMap'] {
  return {
    mapId: 'pm-empty',
    targetUrl,
    states: [
      {
        stateId: 'state-initial',
        name: '初始页面',
        context: {
          page: { url: targetUrl, title: '', headings: [] },
          elements: { buttons: [], inputs: [], selects: [], links: [], navigation: [], tables: [] },
          fields: [],
          warnings: []
        }
      }
    ],
    warnings: []
  };
}

/**
 * 创建包含 fields 和旧 elements 的页面地图。
 */
function createFieldPageMap(
  stateName: string,
  fieldName = '取样类别',
  options: { fieldState?: 'enabled' | 'disabled' | 'readonly'; locatorUnique?: boolean } = {}
): DraftGroupInput['pageMap'] {
  const fieldContext = {
    page: { url: '/web/IMQM07', title: stateName, headings: [] },
    elements: {
      buttons: [],
      inputs: [],
      selects: [
        {
          text: '---请选择---',
          label: '取样类别',
          locator: "getByLabel('取样类别')",
          unique: true
        }
      ],
      links: [],
      navigation: [],
      tables: []
    },
    fields: [
      {
        name: fieldName,
        type: 'select' as const,
        ui: 'kendo-dropdownlist',
        value: '---请选择---',
        locators: [
          {
            selector: "locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')",
            kind: 'field-container' as const,
            unique: options.locatorUnique ?? true,
            confidence: 'high' as const,
            reason: '字段名来自同一字段容器内的 label'
          }
        ],
        state: options.fieldState,
        source: 'label-container' as const,
        confidence: 'high' as const
      }
    ],
    warnings: []
  };

  return {
    mapId: 'pm-field',
    targetUrl: '/web/IMQM07',
    uiLibrary: 'kendo',
    states: stateName === '初始页面' ? [
      {
        stateId: 'state-initial',
        name: '初始页面',
        context: fieldContext
      }
    ] : [
      {
        stateId: 'state-initial',
        name: '初始页面',
        context: {
          page: { url: '/web/IMQM07', title: '取样规则管理', headings: [] },
          elements: { buttons: [], inputs: [], selects: [], links: [], navigation: [], tables: [] },
          fields: [],
          warnings: []
        }
      },
      {
        stateId: 'state-dialog',
        name: stateName,
        actionName: '新增',
        context: fieldContext
      }
    ],
    warnings: []
  };
}

/**
 * 创建包含输入字段和旧 elements 的页面地图。
 */
function createInputFieldPageMap(options: { fieldState?: 'enabled' | 'disabled' | 'readonly'; locatorUnique?: boolean } = {}): DraftGroupInput['pageMap'] {
  return {
    mapId: 'pm-input-field',
    targetUrl: '/user/list',
    uiLibrary: 'kendo',
    states: [
      {
        stateId: 'state-initial',
        name: '初始页面',
        context: {
          page: { url: '/user/list', title: '用户管理', headings: [] },
          elements: {
            buttons: [],
            inputs: [
              {
                label: '用户名称',
                locator: "getByLabel('用户名称')",
                unique: true
              }
            ],
            selects: [],
            links: [],
            navigation: [],
            tables: []
          },
          fields: [
            {
              name: '用户名称',
              type: 'input',
              ui: 'kendo-textbox',
              value: '',
              locators: [
                {
                  selector: "locator('.xr-fc').filter({ hasText: '用户名称' }).locator('input')",
                  kind: 'field-container',
                  unique: options.locatorUnique ?? true,
                  confidence: 'high',
                  reason: '字段名来自同一字段容器内的 label'
                }
              ],
              state: options.fieldState,
              source: 'label-container',
              confidence: 'high'
            }
          ],
          warnings: []
        }
      }
    ],
    warnings: []
  };
}
