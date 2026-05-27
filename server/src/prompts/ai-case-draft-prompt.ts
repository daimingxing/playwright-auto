import { stepTypes } from '../../../shared/types';

const outputTemplate = {
  name: '用例名称',
  startPath: '/dashboard',
  steps: [
    {
      id: 'ai-1',
      type: 'click',
      selector: "getByText('按钮名')",
      text: '点击按钮',
      confidence: 'low',
      warnings: ['selector 为 AI 推测，需要人工确认']
    }
  ],
  confidence: 'low',
  warnings: [],
  missingInfo: []
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
    '- steps 是测试人员填写的自然语言步骤，stepNo 表示顺序，targetText 是测试人员描述的目标对象。',
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
    '- 推理 selector 时 confidence 必须为 low，并在 warnings 说明 selector 为 AI 推测，需要人工确认。',
    '- 如果步骤明显依赖先点击父菜单后才出现的子菜单，也可以生成低置信推测 selector，但必须在 warnings 说明该元素可能是懒加载或展开后出现。',
    '- 不要为了让基础检查通过而编造高置信 selector。',
    '',
    '步骤类型选择规则：',
    '- 打开页面使用 goto。',
    '- 单击使用 click，右键使用 rightClick，双击使用 doubleClick，悬停使用 hover。',
    '- 输入文本使用 fill，选择下拉项使用 select。',
    '- 等待页面或元素变化使用 wait。',
    '- 校验文本使用 assertText，校验元素可见使用 assertVisible，校验输入值使用 assertValue，校验地址使用 assertUrl，校验标题使用 assertTitle。',
    '- 用例预期结果通常生成一个低置信断言步骤；如果无法确定目标元素，优先使用低置信 assertText 或在 missingInfo 中说明。',
    '',
    '输出 JSON 模板：',
    JSON.stringify(outputTemplate)
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
