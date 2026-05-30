# Kendo Page Map Field Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先不处理 Semi，优先把 Kendo 页面地图字段语义、AI selector 补全、自定义下拉执行和页面地图缓存展示闭环跑通。

**Architecture:** 页面地图继续以多状态 snapshot 为缓存边界，`snapshot.fields` 是字段语义索引的唯一来源，不新增独立存储表。Kendo 识别只使用官方 Kendo class 和 `data-role` 信号，AI 生成优先使用 `fields`，执行层只在 selector 自带 Kendo 证据时把 `select` 渲染为“点击控件 + 点击选项”。

**Tech Stack:** TypeScript、Playwright、Vitest、Supertest、Express、Vue 3、现有 `PageContext/PageMap/AiCaseDraft` 链路。

---

## Scope

- 本计划只处理 Kendo 与平台通用链路。
- 暂不新增 Semi 字段扫描、Semi 下拉执行识别或 Semi 页面地图展示规则。
- 暂不做完整 UI Adapter 架构拆分，仅把 Kendo 识别边界收紧到可验证范围。
- 暂不新增“无页面地图但页面可访问”的单页轻量字段扫描；本轮只保证页面地图状态里的字段语义可缓存、可复用。

## File Structure

- `server/src/services/ai/page-context.ts`
  - 负责读取页面 snapshot、Kendo 字段语义、Kendo 下拉摘要、页面探索时的 select 动作。
- `server/src/services/ai/ai-case-draft.ts`
  - 负责把 `pageContext.fields` 和 `pageMap.states[].fields` 转成 selector 候选，并处理低置信兜底。
- `server/src/prompts/ai-case-draft-prompt.ts`
  - 负责告诉模型字段名、当前值、Kendo select 执行语义和 selector 优先级。
- `server/src/services/case/case-step-render.ts`
  - 负责判断 selector 是否明确指向 Kendo 自定义下拉。
- `server/src/services/case/case-generator.ts`
  - 负责最终用例代码中 `select` 步骤的渲染。
- `server/src/services/practical-review/practical-review-spec.ts`
  - 负责实测检查脚本中 `select` 步骤的渲染。
- `server/src/routes/page-maps.ts`
  - 负责详情接口从 snapshot 展开 `fields`。
- `tests/server/ai-case-draft.test.ts`
  - 覆盖 Kendo fields 采集、selector 补全、页面地图多状态字段来源。
- `tests/server/case-step-render.test.ts`
  - 覆盖 Kendo 自定义下拉识别边界。
- `tests/server/case-generator.test.ts`
  - 覆盖最终用例代码生成。
- `tests/server/practical-review-service.test.ts`
  - 覆盖实测脚本生成。
- `tests/server/api-page-maps.test.ts`
  - 覆盖页面地图详情字段语义展开。
- `docs/problem-record.md`
  - 记录本次确认的边界：Kendo 先行，Semi 暂缓。

---

## Task 1: 收紧 Kendo DOM 识别边界

**Files:**
- Modify: `tests/server/ai-case-draft.test.ts`
- Modify: `server/src/services/ai/page-context.ts`

- [ ] **Step 1: Write the failing tests**

在 `tests/server/ai-case-draft.test.ts` 的页面快照测试区域新增两个用例。

第一个用例锁定 Kendo fields 必须来自官方 Kendo 结构，并缓存字段名和值：

```ts
it('auto 模式只按 Kendo 结构采集 Kendo 字段语义并区分字段名和值', async () => {
  const browser = await chromium.launch({ executablePath: getChromePath() });
  const page = await browser.newPage();

  await page.setContent(`
    <div class="k-form-field">
      <label for="sampleKind"><span class="i-input-required">*</span>取样类别</label>
      <span class="k-picker k-dropdownlist k-picker-solid k-picker-md" role="combobox" aria-controls="sampleKind_listbox">
        <span class="k-input-inner"><span class="k-input-value-text">---请选择---</span></span>
        <input id="sampleKind" name="sampleKind" data-role="dropdownlist" required style="display: none;">
      </span>
    </div>
  `);

  const context = await readPageSnapshot(page, [], 'auto');
  const field = context.fields?.find((item) => item.name === '取样类别');

  expect(field).toMatchObject({
    name: '取样类别',
    type: 'select',
    ui: 'kendo-dropdownlist',
    value: '---请选择---',
    required: true,
    source: 'label-container',
    confidence: 'high',
    attrs: {
      inputId: 'sampleKind',
      inputName: 'sampleKind',
      ariaControls: 'sampleKind_listbox',
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
```

第二个用例锁定普通 `role=combobox` 不能被 Kendo 摘要误识别：

```ts
it('普通 combobox 不会被 Kendo 下拉摘要误读为 Kendo 候选', async () => {
  const browser = await chromium.launch({ executablePath: getChromePath() });
  const page = await browser.newPage();

  await page.setContent(`
    <div>
      <label id="status-label">状态</label>
      <div role="combobox" aria-labelledby="status-label" aria-label="selected">请选择状态</div>
    </div>
  `);

  const context = await readPageSnapshot(page, [], 'auto');

  expect(context.elements.selects).toEqual([]);
  expect(context.fields ?? []).toEqual([]);
  await browser.close();
}, 15000);
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected:

- 第一个用例如果当前 Kendo fields 已经满足，可能直接通过。
- 第二个用例应失败，原因是当前 `readKendoSelects()` 使用了泛化 `[role="combobox"]`，会把普通 combobox 读入 `elements.selects`。

- [ ] **Step 3: Implement minimal Kendo boundary fix**

在 `server/src/services/ai/page-context.ts` 修改 `readKendoSelects()` 的 locator，只保留 Kendo 官方 class 和 `data-role` 信号。

```ts
const locator = page.locator('.k-dropdownlist,.k-combobox,.k-picker,[data-role="dropdownlist"],[data-role="combobox"]');
```

检查 `readKendoFields()` 的 locator 也不要把裸 `[role="combobox"]` 作为 Kendo 证据。裸 role 只能作为 Kendo 控件内部 predicate 的辅助条件，不能作为入口选择器。

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected:

- 新增两个用例通过。
- 既有 Kendo fields、Kendo select、native 模式相关用例保持通过。

---

## Task 2: 锁定页面地图 fields 缓存和详情复用

**Files:**
- Modify: `tests/server/page-map.test.ts`
- Modify: `tests/server/api-page-maps.test.ts`
- Modify if needed: `server/src/services/ai/page-map.ts`
- Modify if needed: `server/src/routes/page-maps.ts`

- [ ] **Step 1: Write the failing tests**

在 `tests/server/page-map.test.ts` 增加“页面地图状态 snapshot 保存 Kendo fields”的测试。测试目标是证明页面地图生成时读取的是 `readPageSnapshot()` 的 `fields`，并写入 `snapshotPath` 对应 JSON。

测试结构：

```ts
it('生成页面地图时把 Kendo 字段语义写入状态 snapshot', async () => {
  // 使用现有页面地图测试 helper 构造包含 Kendo 下拉的页面。
  // 触发 createPageMap 或对应采集入口。
  // 读取 map.states[0].snapshotPath。
  // 断言 snapshot.fields 包含 name=取样类别、ui=kendo-dropdownlist、locators[0].kind=field-container。
});
```

在 `tests/server/api-page-maps.test.ts` 已有“查看页面地图详情时展开 snapshot 中的字段语义”基础上补充 state 维度断言，确保同一 `targetUrl` 的不同状态不会混淆 fields。

```ts
it('查看页面地图详情时按状态展开字段语义而不是按 URL 合并', async () => {
  // 创建同 targetUrl 的两个 PageState。
  // state-initial snapshot.fields 为空。
  // state-dialog snapshot.fields 包含 取样类别。
  // 请求详情后断言两个 state 的 fields 各自独立。
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
rtk npm test -- tests/server/page-map.test.ts tests/server/api-page-maps.test.ts
```

Expected:

- 如果现有 snapshot 已经正确保存 `fields`，第一个测试可能直接通过。
- 第二个测试应暴露详情展开是否按状态读取 snapshot；若已满足，也可以作为回归保护。

- [ ] **Step 3: Implement only if tests expose a gap**

如果页面地图生成没有写入 `fields`，检查 `server/src/services/ai/page-map.ts` 中创建 state snapshot 的位置，确保写盘内容来自完整 `PageContext`：

```ts
const context = await readPageSnapshot(page, stateWarnings, input.uiLibrary);
await writeJson(snapshotPath, context);
```

如果详情接口混淆状态，检查 `server/src/routes/page-maps.ts` 的 `expandStateFields()`，确保按每个 `state.snapshotPath` 单独读取。

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
rtk npm test -- tests/server/page-map.test.ts tests/server/api-page-maps.test.ts
```

Expected:

- 页面地图生成和详情展开测试全部通过。

---

## Task 3: 巩固 AI selector 补全优先使用 fields

**Files:**
- Modify: `tests/server/ai-case-draft.test.ts`
- Modify if needed: `server/src/services/ai/ai-case-draft.ts`
- Modify if needed: `server/src/prompts/ai-case-draft-prompt.ts`

- [ ] **Step 1: Write the failing tests**

在 `tests/server/ai-case-draft.test.ts` 增加两个补全回归。

第一个锁定 Kendo field 高置信 selector 覆盖模型按当前值返回的 selector：

```ts
it('Kendo select 返回当前值 selector 时仍使用字段容器 selector', () => {
  const result = completeDraftSelectorsForTest(
    createSelectDraft("getByLabel('---请选择---')"),
    [createKendoFieldContext()]
  );

  expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
  expect(result.steps[0].selector).not.toBe("getByLabel('---请选择---')");
  expect(result.steps[0].warnings).toContain('平台按模板目标类型修正 AI 推测 selector，请人工确认。');
});
```

第二个锁定多状态页面地图使用非初始状态 field 时带来源提示：

```ts
it('Kendo field 来自非初始状态时 selector warning 写明状态来源', () => {
  const result = completeDraftSelectorsFromPageMapForTest(
    createSelectDraft(undefined),
    createPageMapWithInitialAndDialogFields()
  );

  expect(result.steps[0].selector).toBe("locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist')");
  expect(result.steps[0].warnings).toContain('selector 候选来自页面状态：新增弹窗。');
});
```

如果测试文件已有同类 helper，复用现有 helper；不要新增重复测试工具。

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected:

- 若当前逻辑已满足，测试会直接通过并成为回归保护。
- 若失败，应体现为 selector 没有优先使用 `fields`，或 warning 缺少状态来源。

- [ ] **Step 3: Implement minimal selector completion fix**

检查 `server/src/services/ai/ai-case-draft.ts`：

- `findSelectorCandidate()` 必须先调用 `findFieldSelectorCandidate()`。
- `findSelectorCandidateFromPageMap()` 必须先扫描 `pageMap.states[].context.fields`。
- `isValueSelector()` 必须把字段当前值 selector 识别为可丢弃 selector。
- `chooseUniqueFieldLocator()` 必须优先选择唯一且高置信 locator。

如果提示词不够明确，在 `server/src/prompts/ai-case-draft-prompt.ts` 保留或补强规则：

```ts
'- pageContext.fields 是平台从真实页面采集的字段语义，优先级高于自然语言推测和 elements 当前显示文本。'
'- fields 有 locators 时优先原样使用最高置信且唯一的候选 selector。'
'- Kendo 选择下拉项的真实执行顺序是先点击下拉控件，再点击展开面板中的选项文本，不要默认生成 selectOption()。'
```

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected:

- AI selector 补全相关测试全部通过。

---

## Task 4: 跑通 Kendo 自定义下拉执行渲染

**Files:**
- Modify: `tests/server/case-step-render.test.ts`
- Modify: `tests/server/case-generator.test.ts`
- Modify: `tests/server/practical-review-service.test.ts`
- Modify if needed: `server/src/services/case/case-step-render.ts`
- Modify if needed: `server/src/services/case/case-generator.ts`
- Modify if needed: `server/src/services/practical-review/practical-review-spec.ts`

- [ ] **Step 1: Write the failing tests**

在 `tests/server/case-step-render.test.ts` 补充 Kendo 官方 class 和裸 role 边界：

```ts
it('Kendo 官方下拉 class 和 data-role 会识别为自定义下拉', () => {
  expect(isCustomSelect({ id: 's1', type: 'select', selector: "locator('.k-picker.k-dropdownlist')", value: '采购' })).toBe(true);
  expect(isCustomSelect({ id: 's2', type: 'select', selector: "locator('.k-combobox')", value: '采购' })).toBe(true);
  expect(isCustomSelect({ id: 's3', type: 'select', selector: "locator('[data-role=\"dropdownlist\"]')", value: '采购' })).toBe(true);
});

it('裸 combobox role 不会识别为自定义下拉', () => {
  expect(isCustomSelect({ id: 's1', type: 'select', selector: "getByRole('combobox', { name: '状态' })", value: '启用' })).toBe(false);
});
```

在 `tests/server/case-generator.test.ts` 和 `tests/server/practical-review-service.test.ts` 确保 Kendo field selector 输出两步点击：

```ts
expect(code).toContain("await page.locator('.xr-fc').filter({ hasText: '取样类别' }).locator('.k-dropdownlist').click()");
expect(code).toContain("await page.getByRole('option', { name: \"采购\" }).or(page.getByText(\"采购\", { exact: true })).first().click()");
expect(code).not.toContain('.selectOption(');
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
rtk npm test -- tests/server/case-step-render.test.ts tests/server/case-generator.test.ts tests/server/practical-review-service.test.ts
```

Expected:

- 如果当前 Kendo 渲染已满足，测试直接通过。
- 若失败，应体现为 Kendo selector 被渲染成 `.selectOption()`。

- [ ] **Step 3: Implement minimal render fix**

在 `server/src/services/case/case-step-render.ts` 保持规则：只有 selector 自带 Kendo 证据才返回自定义下拉。

```ts
return /\.k-(dropdownlist|picker|combobox|multiselect|dropdowntree)\b|data-role=["']?(dropdownlist|combobox)/.test(value);
```

不要把 `getByRole('combobox', { name })` 识别为自定义下拉，因为它可能是原生 select 的可访问角色。

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
rtk npm test -- tests/server/case-step-render.test.ts tests/server/case-generator.test.ts tests/server/practical-review-service.test.ts
```

Expected:

- Kendo 自定义下拉渲染为点击控件和点击选项。
- 原生 select 仍然渲染为 `.selectOption()`。

---

## Task 5: 页面探索中的 Kendo select 动作保持可执行

**Files:**
- Modify: `tests/server/ai-case-draft.test.ts`
- Modify if needed: `server/src/services/ai/page-context.ts`

- [ ] **Step 1: Write the failing test**

复用或补强现有“执行 Kendo 下拉选择时点击控件本体后再点击选项”测试，确保页面地图探索动作与最终用例执行语义一致。

```ts
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
```

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected:

- 如果已有测试通过，这一步作为回归保护。
- 若失败，应体现为 `runPageAction()` 没有点击 Kendo trigger 或找不到 option。

- [ ] **Step 3: Implement minimal exploration select fix**

在 `server/src/services/ai/page-context.ts` 保持 `runSelectAction()` 分支：

- 原生 `select` 使用 `selectOption({ label })`。
- 非原生 Kendo 使用 `findSelectTrigger()` 点击触发器，再用 `findSelectOption()` 点击选项。

`findSelectTrigger()` 的 XPath 可以包含 Kendo class 和 `role=combobox`，但必须从动作目标名附近寻找，避免命中 label 文本本身。

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts
```

Expected:

- 页面探索 Kendo select 动作测试通过。

---

## Task 6: 记录边界和人工验证说明

**Files:**
- Modify: `docs/problem-record.md`
- Inspect: `docs/agent-code-map.md`
- Inspect: `README.md`

- [ ] **Step 1: Update problem record**

在 `docs/problem-record.md` 追加简短记录：

```md
## 2026-05-30 Kendo 页面地图字段语义边界

- 现象：Kendo 用例生成必须依赖页面地图 `fields`，不能把下拉当前值当字段名。
- 根因：字段定位需要从真实 DOM 的 label/control 关系生成，不能只靠 AI 根据自然语言推测 selector。
- 决策：本轮先跑通 Kendo，Semi 字段语义与 Semi 自定义下拉执行暂缓。
- 边界：Kendo 识别只使用 `.k-dropdownlist`、`.k-combobox`、`.k-picker`、`data-role=dropdownlist/combobox` 等明确证据，不把裸 `[role=combobox]` 当 Kendo。
```

- [ ] **Step 2: Inspect docs for required updates**

Run:

```powershell
rtk pwsh -NoProfile -Command 'Select-String -Path README.md,docs/agent-code-map.md -Pattern "页面地图|fields|Kendo|AI 导入" -Context 1,1'
```

Expected:

- 如果文档已有准确索引，不强行修改。
- 如果 `docs/agent-code-map.md` 缺少字段语义层落点，补充一条索引。

---

## Task 7: Final Verification

**Files:**
- No code edits.

- [ ] **Step 1: Run focused server tests**

Run:

```powershell
rtk npm test -- tests/server/ai-case-draft.test.ts tests/server/page-map.test.ts tests/server/api-page-maps.test.ts tests/server/case-step-render.test.ts tests/server/case-generator.test.ts tests/server/practical-review-service.test.ts
```

Expected:

- All selected tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
rtk npm run typecheck
```

Expected:

- TypeScript typecheck passes.

- [ ] **Step 3: Run wider AI import regression if core files changed**

Run:

```powershell
rtk npm test -- tests/server/import-worker.test.ts tests/server/import-state-repo.test.ts tests/server/import-gen-flow.test.ts tests/server/ai-case-draft.test.ts tests/web/ai-import.test.ts
```

Expected:

- AI 导入相关回归测试通过。

- [ ] **Step 4: Inspect git status**

Run:

```powershell
rtk git status --short
```

Expected:

- 只包含本轮计划允许的文件。
- 不回滚用户或其他任务已有改动。

---

## Manual Acceptance

完成实现后，开发者手动验证：

1. 使用一个 Kendo 表单目标页刷新页面地图。
2. 在页面地图详情中确认对应状态展示字段语义，例如 `取样类别`，且当前值只显示在 `value`。
3. 导入包含 Kendo 下拉选择的用例。
4. 确认生成 selector 使用页面地图 field locator，而不是当前值 selector。
5. 生成最终 Playwright 脚本，确认 Kendo 下拉是点击控件后点击选项，不是 `.selectOption()`。
6. 运行 practical review，确认实测脚本与最终脚本的 select 行为一致。

服务端代码变更后，如果本地服务不是 watch 模式，需要重启后端服务再重新采集页面地图。
