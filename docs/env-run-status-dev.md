# 多环境与运行状态开发文档

## 背景

当前项目在创建时会填写一个 URL，并自动生成 `default` 环境。项目卡片也直接展示这个 URL，这会让用户误以为“项目”本身只对应一个固定地址。实际数据结构已经支持多环境：

```ts
export interface EnvMeta {
  name: string;
  key: string;
  baseUrl: string;
}

export interface ProjectMeta {
  name: string;
  key: string;
  envs: EnvMeta[];
  defaultEnv: string;
  createdAt: string;
  updatedAt: string;
}
```

运行报告也已经保存 `envKey`，但运行中心目前没有环境选择入口。登录态当前按项目保存，无法支持不同环境使用不同账号密码。运行状态类型已经预留 `passed` 和 `failed`，但当前运行结束后没有更新状态，报告列表基本只显示 `created`。

## 目标

- 在项目管理页提供环境配置入口。
- 支持新增、编辑、删除环境。
- `default` 环境不允许删除。
- `default` 是固定默认环境，不提供“设为默认”操作。
- 运行中心支持选择运行环境。
- 登录态按环境保存。
- 报告列表通过项目配置把 `envKey` 映射成环境名称，找不到时显示原始 `envKey`。
- 运行结束后把报告状态更新为 `passed` 或 `failed`。

## 非目标

- 不支持修改环境 `key`。环境 `key` 关联登录态文件和历史报告，编辑时只允许改名称和 URL。
- 不迁移历史报告中的 `envKey`。
- 不阻止删除已有历史报告引用过的环境。
- 不做账号密码管理，只保存用户手动登录后的浏览器登录态。
- 暂不实现环境级权限或密钥管理。

## 数据结构

### 项目环境

继续使用现有 `ProjectMeta.envs` 和 `ProjectMeta.defaultEnv`。其中 `defaultEnv` 仅作为历史兼容字段保留，固定为 `default`，业务上不再提供修改入口。

环境示例：

```json
{
  "name": "西昌测试",
  "key": "xcmpmstest",
  "envs": [
    {
      "name": "默认环境",
      "key": "default",
      "baseUrl": "http://xcmpmstest.baowuresources.info"
    },
    {
      "name": "预发环境",
      "key": "pre",
      "baseUrl": "https://pre.example.com"
    }
  ],
  "defaultEnv": "default",
  "createdAt": "2026-05-20T08:03:48.994Z",
  "updatedAt": "2026-05-20T08:03:48.994Z"
}
```

### 按环境保存登录态

登录态路径改为按环境区分：

```text
data/projects/<projectKey>/auth/<envKey>.storageState.json
```

现有路径：

```text
data/projects/<projectKey>/auth/default.storageState.json
```

可以继续作为 `default` 环境登录态，无需迁移。

### 运行报告

`RunMeta.envKey` 保持不变。运行时选择哪个环境，就把对应 `envKey` 写入 `run.json`。

状态字段继续使用：

```ts
status: 'created' | 'running' | 'passed' | 'failed';
```

第一版状态更新规则：

- 创建运行记录：`created`
- Playwright 执行成功：`passed`
- Playwright 执行失败：`failed`
- `running` 保留类型，暂不作为主要展示状态。

## 接口设计

### 项目环境接口

建议新增环境路由，挂载在项目路由下：

```text
GET    /api/projects/:projectKey/envs
POST   /api/projects/:projectKey/envs
PUT    /api/projects/:projectKey/envs/:envKey
DELETE /api/projects/:projectKey/envs/:envKey
```

### GET /api/projects/:projectKey/envs

返回项目环境列表和固定默认环境：

```json
{
  "envs": [
    {
      "name": "默认环境",
      "key": "default",
      "baseUrl": "https://test.example.com"
    }
  ],
  "defaultEnv": "default"
}
```

### POST /api/projects/:projectKey/envs

请求：

```json
{
  "name": "预发环境",
  "key": "pre",
  "baseUrl": "https://pre.example.com"
}
```

校验规则：

- `name` 必填，长度 1 到 80。
- `key` 必须匹配 `^[a-z][a-z0-9-]{1,40}$`。
- `baseUrl` 必须是合法 URL。
- 同项目内 `key` 不允许重复。

返回更新后的项目配置。

### PUT /api/projects/:projectKey/envs/:envKey

请求：

```json
{
  "name": "预发环境",
  "baseUrl": "https://pre-new.example.com"
}
```

规则：

- 只允许修改 `name` 和 `baseUrl`。
- 不允许修改 `key`。
- `envKey` 不存在时报错。

返回更新后的项目配置。

### DELETE /api/projects/:projectKey/envs/:envKey

规则：

- `default` 环境不允许删除。
- 其他环境允许删除。
- 删除环境不删除历史报告。
- 删除环境时同步删除对应登录态文件，避免以后重建同 key 环境时误用旧账号。

返回 204。

## 后端实现设计

### project-store

在 `server/src/lib/project-store.ts` 中新增函数：

```ts
export async function listProjectEnvs(projectKey: string)
export async function addProjectEnv(projectKey: string, input: EnvInput)
export async function updateProjectEnv(projectKey: string, envKey: string, input: EnvUpdateInput)
export async function deleteProjectEnv(projectKey: string, envKey: string)
```

所有函数都通过读取和重写 `project.json` 完成。

### schema

在 `server/src/lib/schema.ts` 增加：

```ts
export const envKeySchema = projectKeySchema;

export const createEnvSchema = z.object({
  name: z.string().min(1).max(80),
  key: envKeySchema,
  baseUrl: urlSchema
});

export const updateEnvSchema = z.object({
  name: z.string().min(1).max(80),
  baseUrl: urlSchema
});
```

### projects route

在 `server/src/routes/projects.ts` 增加环境接口。接口可以直接挂在现有 `projectsRouter` 上，避免新增 app 级挂载：

```ts
projectsRouter.get('/:projectKey/envs', ...)
projectsRouter.post('/:projectKey/envs', ...)
projectsRouter.put('/:projectKey/envs/:envKey', ...)
projectsRouter.delete('/:projectKey/envs/:envKey', ...)
```

### auth-session

登录态服务增加 `envKey` 参数。

现有能力：

```ts
startLoginSession(projectKey)
saveLoginSession(projectKey, sessionId)
hasProjectAuth(projectKey)
getProjectAuthPath(projectKey)
```

目标能力：

```ts
startLoginSession(projectKey, envKey)
saveLoginSession(projectKey, envKey, sessionId)
hasProjectAuth(projectKey, envKey)
getProjectAuthPath(projectKey, envKey)
```

行为：

- 打开浏览器登录时使用选中环境的 `baseUrl`。
- 保存登录态时写入 `auth/<envKey>.storageState.json`。
- 检查登录态时只检查当前环境对应文件。

兼容：

- 没有传 `envKey` 时默认使用固定 `default` 环境。
- 历史 `auth/default.storageState.json` 继续作为 `default` 环境登录态。

### runner

`runProject(projectKey, input)` 已支持 `envKey` 参数，继续沿用。

需要补充：

```ts
updateRun(projectKey, runId, {
  status: 'passed' | 'failed',
  updatedAt: new Date().toISOString()
})
```

运行流程：

1. `createRun(projectKey, envKey)` 创建 `created` 记录。
2. Playwright 成功退出后更新为 `passed`。
3. Playwright 失败后先更新为 `failed`，再抛 `RunError`。
4. 无论成功失败，报告列表都可以显示真实结果。

失败场景注意：

- 如果 Playwright 失败但 HTML 报告生成成功，仍然显示 `failed` 并允许打开报告。
- 如果 Playwright 在生成报告前异常，也标记 `failed`，打开报告时仍可能提示“测试报告尚未生成”。

### run-store

新增：

```ts
export async function updateRun(projectKey: string, runId: string, input: Partial<Pick<RunMeta, 'status' | 'reportPath' | 'reportUrl'>>)
```

函数必须校验 `runId`，避免异常路径进入文件系统操作。

## 前端实现设计

### ProjectList.vue

项目卡片调整展示：

```text
项目名
默认环境：默认环境（default）
默认地址：https://test.example.com
环境数：2
[进入项目] [环境配置]
```

新增“环境配置”按钮，打开弹窗或抽屉。

环境配置弹窗内容：

- 环境名称。
- 环境标识。
- URL。
- 操作：编辑、删除。

新增环境表单：

- 名称。
- 标识。
- URL。

编辑环境表单：

- 名称。
- URL。
- 标识只读展示。

删除规则提示：

- `default` 环境删除按钮禁用。

### RunCenter.vue

新增运行环境下拉框：

```text
运行环境：[默认环境（default） v]
```

加载运行中心时：

1. 获取项目配置。
2. 默认选择固定 `default` 环境。
3. 加载所选环境的登录态状态。
4. 加载报告列表。

切换环境时：

- 清空当前登录会话 `sessionId`。
- 重新加载该环境登录态状态。
- 不清空报告列表。

按钮行为：

- 打开浏览器登录：传当前 `envKey`。
- 保存登录态：传当前 `envKey`。
- 运行测试：传当前 `envKey`。

报告列表环境列：

```text
envKey 找得到 -> 环境名称（envKey）
envKey 找不到 -> envKey
```

报告状态列：

```text
created -> 已创建
running -> 运行中
passed -> 通过
failed -> 失败
```

建议使用标签颜色：

- `passed`：绿色。
- `failed`：红色。
- `created`：灰色。
- `running`：蓝色或黄色。

### API 封装

`web/src/api/projects.ts` 增加：

```ts
listProjectEnvs(projectKey)
createProjectEnv(projectKey, input)
updateProjectEnv(projectKey, envKey, input)
deleteProjectEnv(projectKey, envKey)
```

`web/src/api/auth.ts` 调整：

```ts
getAuthState(projectKey, envKey)
startLogin(projectKey, envKey)
saveLogin(projectKey, envKey, sessionId)
```

`web/src/api/runs.ts` 已有运行接口，确认 `runProject(projectKey, { envKey })` 能传参。

## 用户流程

### 新建项目

1. 用户填写项目名称、项目标识、项目 URL。
2. 系统创建 `default` 环境。
3. 项目卡片展示默认环境和默认地址。

### 配置环境

1. 用户在项目卡片点击“环境配置”。
2. 用户新增 `pre` 环境。
3. 用户可编辑 `pre` 的名称和 URL。
4. 用户不能删除 `default`。
5. 删除 `pre` 时同步删除 `auth/pre.storageState.json`。

### 按环境登录

1. 用户进入运行中心。
2. 选择运行环境。
3. 如果该环境没有登录态，提示保存登录态。
4. 用户打开浏览器登录。
5. 用户保存当前环境登录态。

### 按环境运行

1. 用户选择运行环境。
2. 点击运行测试。
3. 后端使用该环境 `baseUrl` 和该环境登录态。
4. 报告保存对应 `envKey`。
5. 报告列表展示环境名称和运行状态。

## 测试计划

### 后端单元和 API 测试

新增或扩展测试：

- 创建项目后默认生成 `default` 环境。
- 新增环境成功。
- 重复环境 `key` 报错。
- 编辑环境只能修改名称和 URL。
- 删除非默认环境成功。
- 删除 `default` 环境失败。
- 删除环境时清理对应登录态文件。
- 登录态按环境保存和读取。
- 运行测试时使用指定 `envKey`。
- 成功运行后状态为 `passed`。
- 失败运行后状态为 `failed`。
- 报告列表返回历史 `envKey`。

### 前端测试和类型检查

覆盖：

- 项目卡片展示默认环境名称、key、URL 和环境数。
- 环境配置弹窗能展示、新增、编辑和删除。
- 运行中心环境下拉框默认选中 `default` 环境。
- 切换环境后刷新登录态状态。
- 运行报告环境列能映射环境名称。
- 状态列中文展示 `通过` 和 `失败`。

### 手工验证

- 新建项目后，项目卡片显示默认环境。
- 新增 `pre` 环境后，运行中心可选择 `pre`。
- 对 `default` 和 `pre` 分别保存登录态，确认文件分别落到：

```text
auth/default.storageState.json
auth/pre.storageState.json
```

- 使用不同环境运行测试，报告列表环境列显示正确。
- 制造一个失败用例，报告状态显示 `失败` 且报告可打开。

## 实施顺序

建议分三步实施：

1. 运行状态迭代。
   - 增加 `updateRun`。
   - 成功后写 `passed`。
   - 失败后写 `failed`。
   - 前端状态列中文化。

2. 项目管理页环境配置。
   - 后端环境接口。
   - 前端项目卡片和环境配置弹窗。
   - 默认环境和删除规则。

3. 运行中心按环境运行。
   - 登录态按环境保存。
   - 运行中心环境下拉框。
   - 报告环境名称映射。

这个顺序可以让每一步都有独立可验证结果，避免多环境、登录态和运行状态一次性耦合。

## 质量要求

- 所有新增代码必须包含函数级注释。
- 涉及删除环境、默认环境、按环境登录态路径时必须写清楚边界注释。
- 不允许通过字符串拼接绕过路径校验。
- 修改共享类型后必须运行类型检查。
- 修改接口后必须补 API 测试。
- 修改前端展示后必须运行构建。
