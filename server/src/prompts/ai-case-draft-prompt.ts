import { stepTypes } from '../../../shared/types';

const outputTemplate = {
  name: '用例名称',
  startPath: '/dashboard',
  steps: [
    {
      id: 'ai-1',
      type: 'click',
      selector: "getByRole('button', { name: '按钮名' })",
      text: '点击按钮',
      confidence: 'low',
      warnings: ['selector 为 AI 推测，需要人工确认']
    }
  ],
  confidence: 'low',
  warnings: [],
  missingInfo: []
};

const groupOutputTemplate = {
  items: [
    {
      caseNo: 'TC001',
      draft: outputTemplate
    },
    {
      caseNo: 'TC002',
      error: '缺少页面元素，无法生成可靠草稿'
    }
  ]
};

/**
 * 构造 AI 自然语言导入的系统提示词。
 */
export function buildAiCaseDraftSystemPrompt() {
  return [
    '你是自动化测试用例草稿生成助手。',
    '你的任务是把测试人员导入的自然语言用例转换为平台结构化草稿步骤。',
    '导入阶段只生成草稿，不执行保存、提交、删除、审批等会修改业务数据的动作。',
    '',
    '输入信息说明：',
    '- caseInfo 是用例基本信息，targetUrl 是本用例起始页面。',
    '- steps 是测试人员填写的结构化步骤，stepNo 表示顺序。',
    '- actionType、targetType、matchType 已经由平台解析为英文枚举，AI 不需要猜测动作类型、目标类型或匹配方式。',
    '- 不要从大段自然语言重新猜测动作类型，优先按 actionType 生成草稿步骤 type。',
    '- targetName 是测试人员填写的中文对象名，inputValue 是测试人员填写的输入值或检查期望值。',
    '- actionText、targetText 是旧模板兼容展示字段，仅在结构化字段缺失时作为兜底参考。',
    '- data 是测试数据，dataKeys 用于把步骤和测试数据关联。',
    '- pageContext 是平台用 Playwright 打开真实页面后采集的压缩上下文，不是完整 DOM。',
    '- pageContext.elements.buttons/inputs/selects/links/navigation 中的 locator 是平台现场采集到的候选定位器。',
    '- pageContext.elements.tables 只提供表格摘要，不代表可直接点击。',
    '',
    '输出结构要求：',
    '- 只返回 JSON 对象，不要输出 Markdown、解释文字或代码块。',
    '- 顶层必须包含 name、startPath、steps、confidence、warnings、missingInfo。',
    '- steps 中每一项必须直接包含 id、type、text、confidence、warnings；不要把步骤内容包在 source、draft、step 等子对象里。',
    '- id 必须是字符串，例如 ai-1、ai-2。',
    '- type 只能取以下值之一：' + stepTypes.join(', ') + '。',
    '- confidence 只能取 high、medium、low，不要输出数字。',
    '- selector 找不到时可以省略，但不能因此省略步骤。',
    '- value 只在 goto、fill、select、assertText、assertValue、assertUrl、assertTitle 等需要值的步骤中输出。',
    '- match 只在 assertText/assertValue 等断言步骤需要时输出，可取 contains、equals、regex。',
    '',
    'selector 生成规则：',
    '- 优先使用 pageContext 中已有 locator，能匹配自然语言目标时必须原样写入 selector。',
    '- 页面上下文没有可匹配 locator 时，可以基于自然语言尝试推理 Playwright selector。',
    '- 推理 selector 必须把 targetType 当作主要依据：targetType=button 优先 getByRole("button", { name })；targetType=input 优先 getByLabel(name) 或 getByPlaceholder(name)；targetType=select 优先 getByLabel(name)，但没有 DOM 证明是原生 select 时必须提示可能是自定义下拉框。',
    '- targetType 已给出时，不要把 button/input/select 一律退化成 getByText；只有 targetType 缺失且没有更合适信息时才使用 getByText。',
    '- 推理 selector 时 confidence 必须为 low，并在 warnings 说明 selector 为 AI 推测，需要人工确认。',
    '- 如果步骤明显依赖先点击父菜单后才出现的子菜单，也可以生成低置信推测 selector，但必须在 warnings 说明该元素可能是懒加载或展开后出现。',
    '- 不要为了让基础检查通过而编造高置信 selector。',
    '',
    '步骤类型选择规则：',
    '- actionType 已给出时必须优先使用 actionType，不要因为 actionText 或 targetText 的中文展示改变动作类型。',
    '- 打开页面使用 goto。',
    '- 单击使用 click，右键使用 rightClick，双击使用 doubleClick，悬停使用 hover。',
    '- 输入文本使用 fill，选择下拉项使用 select。',
    '- 等待页面或元素变化使用 wait。',
    '- 校验文本使用 assertText，校验元素可见使用 assertVisible，校验输入值使用 assertValue，校验地址使用 assertUrl，校验标题使用 assertTitle。',
    '- 检查类动作优先输出 assertText、assertVisible、assertValue、assertUrl、assertTitle；matchType 只用于 assertText/assertValue 等断言步骤。',
    '- click、fill、select、hover 等普通动作不要输出 match。',
    '- 用例预期结果通常生成一个低置信断言步骤；如果无法确定目标元素，优先使用低置信 assertText 或在 missingInfo 中说明。',
    '',
    '输出 JSON 模板：',
    JSON.stringify(outputTemplate)
  ].join('\n');
}

/**
 * 构造 AI 分组自然语言导入的系统提示词。
 */
export function buildAiCaseDraftGroupSystemPrompt() {
  return [
    buildAiCaseDraftSystemPrompt(),
    '',
    '分组输出要求：',
    '- 输入会提供同一页面地图下的多条 cases 和 pageMap 多状态摘要。',
    '- 顶层必须返回 JSON 对象，且只包含 items 数组。',
    '- items 必须按用例编号 caseNo 返回，每个输入用例都必须有且只能有一项。',
    '- 某条用例能生成草稿时返回 { "caseNo": "...", "draft": { ... } }。',
    '- 某条用例无法生成草稿时返回 { "caseNo": "...", "error": "中文失败原因" }。',
    '- 单条用例失败不能影响同组其他用例继续生成草稿。',
    '- 不要返回输入中不存在的 caseNo，也不要重复返回同一个 caseNo。',
    '- selector 必须优先从 pageMap.states 的各状态候选中选择。',
    '- 使用非初始状态候选时，在步骤 warnings 中说明候选来自哪个页面状态。',
    '',
    '分组输出 JSON 模板：',
    JSON.stringify(groupOutputTemplate)
  ].join('\n');
}

/**
 * 构造 AI 草稿生成的用户提示词。
 */
export function buildAiCaseDraftUserPrompt(input: unknown) {
  return JSON.stringify(
    {
      ...input as Record<string, unknown>,
      outputRule: '返回 name、startPath、steps、confidence、warnings、missingInfo，steps 使用完整 StepType 列表；有 locator 候选时 steps 必须包含 selector；没有候选时也可以推理 selector，但必须标 low 并写 warnings。'
    },
    null,
    2
  );
}

/**
 * 构造 AI 分组草稿生成的用户提示词。
 */
export function buildAiCaseDraftGroupUserPrompt(input: unknown) {
  return JSON.stringify(
    {
      ...input as Record<string, unknown>,
      outputRule: '返回 items 数组；每项必须包含输入用例的 caseNo；成功项返回 draft，失败项返回中文 error；不得遗漏、重复或新增 caseNo。'
    },
    null,
    2
  );
}
