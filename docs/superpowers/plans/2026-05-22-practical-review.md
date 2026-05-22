# 实测检查与失败分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为用例增加“实测检查”和“失败分析”，让用户能在真实环境中预检用例步骤、在步骤列表看到失败步骤、在用例管理和运行中心看到最新实测状态，并自动清理实测检查历史记录。

**Architecture:** 保留现有静态规则能力，但在 UI 中改名为“定位检查”，只在用例编辑页步骤表展示。新增“实测检查”作为独立运行和独立产物，成功只保存 JSON 摘要，失败保存 JSON、截图和失败分析；用例列表读取 `case.practicalReview` 最新摘要，不扫描历史目录。实测检查记录存放在 `projects/<projectKey>/reviews/<reviewId>/`，并按 7 天且最多 20 条自动清理。

**Tech Stack:** TypeScript、Express、Vue 3、Element Plus、Vitest、Playwright、Node fs/path/crypto。

---

## Terminology

- `定位检查`：现有静态审查，在用例保存、读取历史用例、录制导入后生成，仍保存在 `CaseMeta.review`。
- `实测检查`：新增真实环境预检，手动触发，结果保存在 `CaseMeta.practicalReview` 和 `reviews/<reviewId>/review.json`。
- `失败分析`：实测检查失败时对失败步骤生成的解释，随实测检查记录保存并在抽屉里展示。
- `过期`：最近一次实测检查对应的用例版本或环境 URL 已不等于当前值。登录态重新保存不导致过期。

## File Structure

**Shared types**
- Modify: `shared/types.ts`
  - Add `PracticalReviewStatus`、`PracticalReviewRecord`、`PracticalReviewSummary`、`PracticalStepReview`、`PracticalFailureAnalysis`、`PracticalReviewArtifact`。

**Backend storage and execution**
- Modify: `server/src/lib/path.ts`
  - Add review root/path helpers.
- Create: `server/src/lib/practical-review-store.ts`
  - Persist review records, compute case snapshot hash, update `case.practicalReview`, list/read/delete/cleanup records.
- Create: `server/src/services/practical-review.ts`
  - Run Playwright-based real environment checks and failure probes.
- Create: `server/src/services/practical-review-locator.ts`
  - Render a stored selector string into executable Playwright locator code for generated review specs.
- Modify: `server/src/lib/case-store.ts`
  - Preserve static review behavior; ensure and expire practical review summaries on reads/updates.
- Modify: `server/src/lib/project-store.ts`
  - Expire practical review summaries when an environment `baseUrl` changes.
- Modify: `server/src/routes/cases.ts`
  - Add practical review endpoints under `/cases/:caseKey/practical-reviews`.

**Frontend API and UI**
- Modify: `web/src/api/cases.ts`
  - Add practical review API methods.
- Modify: `web/src/pages/case-editor.ts`
  - Add display helpers for `定位检查` and `实测检查` labels/statuses.
- Modify: `web/src/pages/CaseEditor.vue`
  - Add right-side `实测检查` panel next to metadata; show auth status, run progress, latest status, failure step, failure analysis drawer/history drawer/cleanup button; mark failed step in table.
- Modify: `web/src/pages/ProjectDetail.vue`
  - Replace static review table column with practical review status and last review time.
- Modify: `web/src/pages/run-center.ts`
  - Add practical review display helpers for the case selection table.
- Modify: `web/src/pages/RunCenter.vue`
  - Add practical review status and last review time columns in the case selection list.

**Tests**
- Create: `tests/server/practical-review-store.test.ts`
- Create: `tests/server/practical-review-service.test.ts`
- Modify: `tests/server/api-cases.test.ts`
- Modify: `tests/server/api-projects.test.ts`
- Modify: `tests/web/case-editor.test.ts`
- Modify: `tests/web/run-center.test.ts`

---

### Task 1: Shared Type Model

**Files:**
- Modify: `shared/types.ts`
- Test: `tests/web/case-editor.test.ts`
- Test: `tests/web/run-center.test.ts`

- [ ] **Step 1: Write failing display helper tests**

Append these tests to `tests/web/case-editor.test.ts`:

```ts
import type { PracticalReviewSummary } from '../../shared/types';
import { formatPracticalReviewStatus, getPracticalReviewTagType } from '../../web/src/pages/case-editor';

describe('实测检查展示工具', () => {
  it('会显示未审查、通过、失败和过期状态', () => {
    expect(formatPracticalReviewStatus(undefined)).toBe('未审查');
    expect(formatPracticalReviewStatus(makePracticalSummary('passed'))).toBe('通过');
    expect(formatPracticalReviewStatus(makePracticalSummary('failed'))).toBe('失败');
    expect(formatPracticalReviewStatus(makePracticalSummary('expired'))).toBe('过期');
  });

  it('会为实测检查状态选择标签类型', () => {
    expect(getPracticalReviewTagType(undefined)).toBe('info');
    expect(getPracticalReviewTagType(makePracticalSummary('passed'))).toBe('success');
    expect(getPracticalReviewTagType(makePracticalSummary('failed'))).toBe('danger');
    expect(getPracticalReviewTagType(makePracticalSummary('expired'))).toBe('warning');
  });
});

function makePracticalSummary(status: PracticalReviewSummary['status']): PracticalReviewSummary {
  return {
    status,
    envKey: 'default',
    envBaseUrl: 'https://crm.test.local',
    caseSnapshotHash: 'hash-a',
    stepCount: 1,
    reviewId: status === 'expired' ? undefined : 'review-1',
    checkedAt: status === 'expired' ? undefined : '2026-05-22T00:00:00.000Z',
    failedStepId: status === 'failed' ? 's1' : undefined,
    failedStepIndex: status === 'failed' ? 0 : undefined,
    failureMessage: status === 'failed' ? '未找到目标元素' : undefined
  };
}
```

Append this test to `tests/web/run-center.test.ts`:

```ts
import type { PracticalReviewSummary } from '../../shared/types';
import { formatPracticalReviewTime } from '../../web/src/pages/run-center';

describe('运行中心实测检查展示工具', () => {
  it('最后检查时间只显示实测检查时间', () => {
    expect(formatPracticalReviewTime(undefined)).toBe('-');
    expect(formatPracticalReviewTime(makeRunCenterSummary('passed'))).toBe('2026-05-22T00:00:00.000Z');
    expect(formatPracticalReviewTime(makeRunCenterSummary('expired'))).toBe('-');
  });
});

function makeRunCenterSummary(status: PracticalReviewSummary['status']): PracticalReviewSummary {
  return {
    status,
    envKey: 'default',
    envBaseUrl: 'https://crm.test.local',
    caseSnapshotHash: 'hash-a',
    stepCount: 1,
    reviewId: status === 'expired' ? undefined : 'review-1',
    checkedAt: status === 'expired' ? undefined : '2026-05-22T00:00:00.000Z'
  };
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/web/case-editor.test.ts tests/web/run-center.test.ts
```

Expected: FAIL because `PracticalReviewSummary` and helper exports do not exist.

- [ ] **Step 3: Add shared practical review types**

In `shared/types.ts`, add these types after `CaseReview` and add `practicalReview?: PracticalReviewSummary;` to `CaseMeta`:

```ts
export type PracticalReviewStatus = 'untested' | 'running' | 'passed' | 'failed' | 'expired';

export type PracticalStepReviewStatus = 'passed' | 'failed' | 'skipped';

export type PracticalFailureCode =
  | 'navigation-failed'
  | 'auth-required'
  | 'selector-invalid'
  | 'no-match'
  | 'multiple-match'
  | 'hidden'
  | 'disabled'
  | 'not-editable'
  | 'covered'
  | 'assertion-mismatch'
  | 'timeout'
  | 'unknown';

export interface PracticalReviewArtifact {
  type: 'screenshot' | 'dom' | 'trace';
  path: string;
  url: string;
}

export interface PracticalFailureAnalysis {
  code: PracticalFailureCode;
  message: string;
  suggestion: string;
  currentUrl?: string;
  selector?: string;
  matchCount?: number;
  nearbyText?: string[];
  blockingSelector?: string;
  artifacts?: PracticalReviewArtifact[];
}

export interface PracticalStepReview {
  stepId: string;
  stepIndex: number;
  stepType: StepType;
  status: PracticalStepReviewStatus;
  selector?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  analysis?: PracticalFailureAnalysis;
}

export interface PracticalReviewSummary {
  status: PracticalReviewStatus;
  envKey: string;
  envBaseUrl: string;
  caseSnapshotHash: string;
  stepCount: number;
  reviewId?: string;
  checkedAt?: string;
  failedStepId?: string;
  failedStepIndex?: number;
  failureMessage?: string;
}

export interface PracticalReviewRecord {
  id: string;
  projectKey: string;
  caseKey: string;
  envKey: string;
  envBaseUrl: string;
  status: Exclude<PracticalReviewStatus, 'untested' | 'expired' | 'running'>;
  caseSnapshotHash: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: PracticalStepReview[];
  summary: PracticalReviewSummary;
  artifacts: PracticalReviewArtifact[];
}

export interface CaseMeta {
  name: string;
  key: string;
  startPath: string;
  steps: CaseStep[];
  review?: CaseReview;
  practicalReview?: PracticalReviewSummary;
  createdAt: string;
  updatedAt: string;
}
```

Keep the existing `CaseMeta` properties and only add `practicalReview?: PracticalReviewSummary`.

- [ ] **Step 4: Add frontend helper implementations**

In `web/src/pages/case-editor.ts`, add:

```ts
import type { CaseMeta, CaseStep, EnvMeta, PracticalReviewSummary, StepTimeoutConfig, StepType } from '../../../shared/types';

export function formatPracticalReviewStatus(summary: PracticalReviewSummary | undefined) {
  if (!summary || summary.status === 'untested') {
    return '未审查';
  }

  const labels: Record<PracticalReviewSummary['status'], string> = {
    untested: '未审查',
    running: '检查中',
    passed: '通过',
    failed: '失败',
    expired: '过期'
  };

  return labels[summary.status];
}

export function getPracticalReviewTagType(summary: PracticalReviewSummary | undefined) {
  if (!summary) {
    return 'info';
  }

  const types: Record<PracticalReviewSummary['status'], 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
    untested: 'info',
    running: 'primary',
    passed: 'success',
    failed: 'danger',
    expired: 'warning'
  };

  return types[summary.status];
}

export function getFailedPracticalStep(summary: PracticalReviewSummary | undefined, step: CaseStep) {
  return summary?.status === 'failed' && summary.failedStepId === step.id;
}
```

Update the existing import line in `web/src/pages/case-editor.ts` so it imports `PracticalReviewSummary`.

In `web/src/pages/run-center.ts`, add:

```ts
import type { CaseMeta, PracticalReviewSummary } from '../../../shared/types';

export function formatPracticalReviewTime(summary: PracticalReviewSummary | undefined) {
  return summary?.checkedAt ?? '-';
}
```

Update the existing import line in `web/src/pages/run-center.ts` so it imports `PracticalReviewSummary`.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk npm run test -- tests/web/case-editor.test.ts tests/web/run-center.test.ts
```

Expected: PASS.

---

### Task 2: Practical Review Storage

**Files:**
- Modify: `server/src/lib/path.ts`
- Create: `server/src/lib/practical-review-store.ts`
- Modify: `server/src/lib/case-store.ts`
- Test: `tests/server/practical-review-store.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `tests/server/practical-review-store.test.ts`:

```ts
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCase, getCase, updateCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import {
  cleanupPracticalReviews,
  createCaseSnapshotHash,
  listPracticalReviewRecords,
  readPracticalReviewRecord,
  savePracticalReviewRecord,
  updateLatestPracticalReview
} from '../../server/src/lib/practical-review-store';
import type { PracticalReviewRecord } from '../../shared/types';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-practical-review-store-'));
  process.env.DATA_ROOT = root;
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe('实测检查存储', () => {
  it('保存实测检查记录并更新用例最新摘要', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    const hash = createCaseSnapshotHash(item, 'default', 'https://crm.test.local');
    const record = makeRecord(item.key, hash, 'passed');

    await savePracticalReviewRecord('crm', record);
    await updateLatestPracticalReview('crm', item.key, record.summary);

    const saved = await getCase('crm', item.key);
    const loaded = await readPracticalReviewRecord('crm', record.id);

    expect(saved.practicalReview).toMatchObject({
      status: 'passed',
      envKey: 'default',
      caseSnapshotHash: hash
    });
    expect(loaded.id).toBe(record.id);
  });

  it('用例步骤变化后最近实测检查显示过期', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    const hash = createCaseSnapshotHash(item, 'default', 'https://crm.test.local');
    const record = makeRecord(item.key, hash, 'passed');

    await savePracticalReviewRecord('crm', record);
    await updateLatestPracticalReview('crm', item.key, record.summary);
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: '#save' }]
    });

    const saved = await getCase('crm', item.key);
    expect(saved.practicalReview?.status).toBe('expired');
    expect(saved.practicalReview?.reviewId).toBe(record.id);
  });

  it('清理 7 天前和超过 20 条的实测检查记录', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    const hash = createCaseSnapshotHash(item, 'default', 'https://crm.test.local');

    for (let index = 0; index < 25; index += 1) {
      await savePracticalReviewRecord(
        'crm',
        makeRecord(item.key, hash, 'passed', `review-${String(index).padStart(2, '0')}`, `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
      );
    }

    await cleanupPracticalReviews('crm', {
      now: new Date('2026-05-30T00:00:00.000Z'),
      maxAgeDays: 7,
      maxRecords: 20
    });

    const records = await listPracticalReviewRecords('crm', item.key);
    expect(records).toHaveLength(8);
    expect(records[0].id).toBe('review-24');
    await expect(stat(join(root, 'projects', 'crm', 'reviews', 'review-00'))).rejects.toThrow();
  });
});

function makeRecord(
  caseKey: string,
  hash: string,
  status: PracticalReviewRecord['status'],
  id = 'review-1',
  startedAt = '2026-05-22T00:00:00.000Z'
): PracticalReviewRecord {
  return {
    id,
    projectKey: 'crm',
    caseKey,
    envKey: 'default',
    envBaseUrl: 'https://crm.test.local',
    status,
    caseSnapshotHash: hash,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    steps: [],
    artifacts: [],
    summary: {
      status,
      envKey: 'default',
      envBaseUrl: 'https://crm.test.local',
      caseSnapshotHash: hash,
      stepCount: 0,
      reviewId: id,
      checkedAt: startedAt
    }
  };
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/server/practical-review-store.test.ts
```

Expected: FAIL because `practical-review-store.ts` and path helpers do not exist.

- [ ] **Step 3: Add review path helpers**

In `server/src/lib/path.ts`, add:

```ts
export function getPracticalReviewsPath(projectKey: string) {
  return resolve(getProjectPath(projectKey), 'reviews');
}

export function getPracticalReviewPath(projectKey: string, reviewId: string) {
  return resolve(getPracticalReviewsPath(projectKey), reviewId);
}
```

- [ ] **Step 4: Implement practical review store**

Create `server/src/lib/practical-review-store.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMeta, PracticalReviewRecord, PracticalReviewSummary } from '../../../shared/types';
import { ensureDir, readJson, writeJson } from './fs';
import { getCasePath, getPracticalReviewPath, getPracticalReviewsPath } from './path';

const reviewIdPattern = /^[a-z0-9-]{1,80}$/;

export function createPracticalReviewId() {
  const now = new Date();
  return `review-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createCaseSnapshotHash(item: CaseMeta, envKey: string, envBaseUrl: string) {
  return createHash('sha256')
    .update(JSON.stringify({
      envKey,
      envBaseUrl,
      name: item.name,
      startPath: item.startPath,
      steps: item.steps
    }))
    .digest('hex');
}

export async function savePracticalReviewRecord(projectKey: string, record: PracticalReviewRecord) {
  assertReviewId(record.id);
  const dir = getPracticalReviewPath(projectKey, record.id);
  await ensureDir(dir);
  await writeJson(join(dir, 'review.json'), record);
  return record;
}

export async function readPracticalReviewRecord(projectKey: string, reviewId: string) {
  assertReviewId(reviewId);
  return readJson<PracticalReviewRecord>(join(getPracticalReviewPath(projectKey, reviewId), 'review.json'));
}

export async function listPracticalReviewRecords(projectKey: string, caseKey?: string) {
  const root = getPracticalReviewsPath(projectKey);
  if (!existsSync(root)) {
    return [];
  }

  const names = await readdir(root);
  const records = await Promise.all(
    names.map(async (name) => {
      try {
        const record = await readPracticalReviewRecord(projectKey, name);
        return caseKey && record.caseKey !== caseKey ? null : record;
      } catch {
        return null;
      }
    })
  );

  return records
    .filter((item): item is PracticalReviewRecord => Boolean(item))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id));
}

export async function updateLatestPracticalReview(projectKey: string, caseKey: string, summary: PracticalReviewSummary) {
  const item = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json'));
  const nextItem: CaseMeta = {
    ...item,
    practicalReview: summary
  };

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), nextItem);
  return nextItem;
}

export async function expirePracticalReviewIfNeeded(projectKey: string, item: CaseMeta, envBaseUrl?: string) {
  const summary = item.practicalReview;
  if (!summary || summary.status === 'untested' || summary.status === 'expired') {
    return item;
  }

  const currentHash = createCaseSnapshotHash(item, summary.envKey, envBaseUrl ?? summary.envBaseUrl);
  if (currentHash === summary.caseSnapshotHash) {
    return item;
  }

  const nextItem: CaseMeta = {
    ...item,
    practicalReview: {
      ...summary,
      status: 'expired'
    }
  };

  await writeJson(join(getCasePath(projectKey, item.key), 'case.json'), nextItem);
  return nextItem;
}

export async function cleanupPracticalReviews(
  projectKey: string,
  options: { now?: Date; maxAgeDays?: number; maxRecords?: number } = {}
) {
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? 7;
  const maxRecords = options.maxRecords ?? 20;
  const records = await listPracticalReviewRecords(projectKey);
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const keepIds = new Set(records.slice(0, maxRecords).map((record) => record.id));

  await Promise.all(
    records.map(async (record) => {
      const tooOld = new Date(record.startedAt).getTime() < cutoff;
      const tooMany = !keepIds.has(record.id);

      if (tooOld || tooMany) {
        await rm(getPracticalReviewPath(projectKey, record.id), { recursive: true, force: true });
      }
    })
  );
}

function assertReviewId(reviewId: string) {
  if (!reviewIdPattern.test(reviewId)) {
    throw new Error('实测检查编号不合法');
  }
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
```

- [ ] **Step 5: Integrate expiration in case store**

In `server/src/lib/case-store.ts`, import:

```ts
import { expirePracticalReviewIfNeeded } from './practical-review-store';
```

Update `ensureReview` to preserve static review and apply practical review expiration:

```ts
async function ensureReview(projectKey: string, item: CaseMeta) {
  const withStaticReview = item.review
    ? item
    : {
        ...item,
        review: reviewCase(item)
      };

  if (!item.review) {
    await writeJson(join(getCasePath(projectKey, item.key), 'case.json'), withStaticReview);
  }

  return expirePracticalReviewIfNeeded(projectKey, withStaticReview);
}
```

Update `updateCase` so it expires previous practical review after save:

```ts
export async function updateCase(projectKey: string, caseKey: string, input: CaseMeta) {
  const previous = await readJson<CaseMeta>(join(getCasePath(projectKey, caseKey), 'case.json')).catch(() => undefined);
  const item: CaseMeta = {
    ...input,
    key: caseKey,
    practicalReview: previous?.practicalReview,
    updatedAt: new Date().toISOString()
  };
  item.review = reviewCase(item);

  await writeJson(join(getCasePath(projectKey, caseKey), 'case.json'), item);
  const nextItem = await expirePracticalReviewIfNeeded(projectKey, item);
  await writeSpec(projectKey, nextItem);

  return nextItem;
}
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
rtk npm run test -- tests/server/practical-review-store.test.ts tests/server/api-cases.test.ts
```

Expected: PASS.

---

### Task 3: Practical Review Service and Failure Analysis

**Files:**
- Create: `server/src/services/practical-review-locator.ts`
- Create: `server/src/services/practical-review.ts`
- Test: `tests/server/practical-review-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/server/practical-review-service.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase, updateCase } from '../../server/src/lib/case-store';
import { createProject } from '../../server/src/lib/project-store';
import { renderPracticalLocator } from '../../server/src/services/practical-review-locator';
import { runPracticalReview } from '../../server/src/services/practical-review';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playwright-auto-practical-review-service-'));
  process.env.DATA_ROOT = root;
  process.env.NODE_ENV = 'test';
  spawnMock.mockReset();
});

afterEach(async () => {
  delete process.env.DATA_ROOT;
  delete process.env.NODE_ENV;
  await rm(root, { recursive: true, force: true });
});

describe('实测检查服务', () => {
  it('会把存储的定位表达式渲染成当前页面 locator', () => {
    expect(renderPracticalLocator("getByRole('button', { name: '保存' })", 'page')).toBe("page.getByRole('button', { name: '保存' })");
    expect(renderPracticalLocator('#save', 'page')).toBe("page.locator('#save')");
    expect(renderPracticalLocator("page1.getByText('保存成功')", 'page')).toBe("page.getByText('保存成功')");
  });

  it('测试环境下实测通过时生成 passed 记录并更新摘要', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" }]
    });

    const record = await runPracticalReview('crm', item.key, { envKey: 'default' });

    expect(record.status).toBe('passed');
    expect(record.summary.status).toBe('passed');
    expect(record.steps[0]).toMatchObject({
      stepId: 's1',
      status: 'passed'
    });
  });

  it('测试环境下定位失败时生成失败分析', async () => {
    await createProject({ name: 'CRM', key: 'crm', baseUrl: 'https://crm.test.local' });
    const item = await createCase('crm', { name: '创建订单', startPath: '/orders/create' });
    await updateCase('crm', item.key, {
      ...item,
      steps: [{ id: 's1', type: 'click', selector: "getByRole('button', { name: '不存在' })" }]
    });

    const record = await runPracticalReview('crm', item.key, {
      envKey: 'default',
      testFailure: {
        stepId: 's1',
        code: 'no-match',
        message: '未找到目标元素',
        suggestion: '请确认按钮文案是否变化'
      }
    });

    expect(record.status).toBe('failed');
    expect(record.summary).toMatchObject({
      status: 'failed',
      failedStepId: 's1',
      failureMessage: '未找到目标元素'
    });
    expect(record.steps[0].analysis).toMatchObject({
      code: 'no-match',
      message: '未找到目标元素'
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/server/practical-review-service.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Implement locator rendering**

Create `server/src/services/practical-review-locator.ts`:

```ts
function quote(value: string) {
  return JSON.stringify(value).replace(/^"|"$/g, "'");
}

export function normalizePracticalSelector(selector: string) {
  return selector.replace(/^page\d+\./, '');
}

export function renderPracticalLocator(selector: string | undefined, pageName = 'page') {
  if (!selector) {
    throw new Error('定位不能为空');
  }

  const value = normalizePracticalSelector(selector);
  if (/^(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|frameLocator)\(/.test(value)) {
    return `${pageName}.${value}`;
  }

  return `${pageName}.locator(${quote(value)})`;
}
```

- [ ] **Step 4: Implement practical review service skeleton**

Create `server/src/services/practical-review.ts`:

```ts
import type {
  CaseMeta,
  CaseStep,
  PracticalFailureAnalysis,
  PracticalReviewRecord,
  PracticalStepReview
} from '../../../shared/types';
import { getCase } from '../lib/case-store';
import { getProject } from '../lib/project-store';
import {
  cleanupPracticalReviews,
  createCaseSnapshotHash,
  createPracticalReviewId,
  savePracticalReviewRecord,
  updateLatestPracticalReview
} from '../lib/practical-review-store';
import { buildStartUrl } from '../../../shared/url';

interface PracticalReviewInput {
  envKey?: string;
  testFailure?: {
    stepId: string;
    code: PracticalFailureAnalysis['code'];
    message: string;
    suggestion: string;
  };
}

export async function runPracticalReview(projectKey: string, caseKey: string, input: PracticalReviewInput = {}) {
  const project = await getProject(projectKey);
  const item = await getCase(projectKey, caseKey);
  const envKey = input.envKey ?? project.defaultEnv;
  const env = project.envs.find((row) => row.key === envKey);

  if (!env) {
    throw new Error('实测检查环境不存在');
  }

  const startedAt = new Date().toISOString();
  const hash = createCaseSnapshotHash(item, envKey, env.baseUrl);
  const steps = process.env.NODE_ENV === 'test'
    ? createTestStepResults(item, input.testFailure)
    : await runBrowserReview(item, env.baseUrl);
  const failedStep = steps.find((step) => step.status === 'failed');
  const finishedAt = new Date().toISOString();
  const status = failedStep ? 'failed' : 'passed';
  const reviewId = createPracticalReviewId();
  const record: PracticalReviewRecord = {
    id: reviewId,
    projectKey,
    caseKey,
    envKey,
    envBaseUrl: env.baseUrl,
    status,
    caseSnapshotHash: hash,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    steps,
    artifacts: failedStep?.analysis?.artifacts ?? [],
    summary: {
      status,
      envKey,
      envBaseUrl: env.baseUrl,
      caseSnapshotHash: hash,
      stepCount: item.steps.length,
      reviewId,
      checkedAt: finishedAt,
      failedStepId: failedStep?.stepId,
      failedStepIndex: failedStep?.stepIndex,
      failureMessage: failedStep?.analysis?.message
    }
  };

  await savePracticalReviewRecord(projectKey, record);
  await updateLatestPracticalReview(projectKey, caseKey, record.summary);
  await cleanupPracticalReviews(projectKey);

  return record;
}

function createTestStepResults(
  item: CaseMeta,
  failure: PracticalReviewInput['testFailure']
): PracticalStepReview[] {
  return item.steps.map((step, index) => {
    const startedAt = new Date().toISOString();
    const isFailed = failure?.stepId === step.id;
    const finishedAt = new Date().toISOString();

    return {
      stepId: step.id,
      stepIndex: index,
      stepType: step.type,
      selector: step.selector,
      status: isFailed ? 'failed' : failure ? 'skipped' : 'passed',
      startedAt,
      finishedAt,
      durationMs: 0,
      analysis: isFailed
        ? {
            code: failure.code,
            message: failure.message,
            suggestion: failure.suggestion,
            selector: step.selector,
            matchCount: failure.code === 'no-match' ? 0 : undefined
          }
        : undefined
    };
  });
}

async function runBrowserReview(item: CaseMeta, envBaseUrl: string): Promise<PracticalStepReview[]> {
  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();

  return [
    {
      stepId: 'navigation',
      stepIndex: -1,
      stepType: 'goto',
      status: 'failed',
      selector: buildStartUrl(envBaseUrl, item.startPath),
      startedAt,
      finishedAt,
      durationMs: 0,
      analysis: {
        code: 'unknown',
        message: '实测检查浏览器执行器未启用',
        suggestion: '请先完成浏览器实测执行任务，再在非测试环境触发实测检查。'
      }
    }
  ];
}
```

This task intentionally returns a failure record for non-test execution. Task 4 replaces it with a real Playwright review spec.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk npm run test -- tests/server/practical-review-service.test.ts tests/server/practical-review-store.test.ts
```

Expected: PASS.

---

### Task 4: Browser-Based Practical Review Execution

**Files:**
- Modify: `server/src/services/practical-review.ts`
- Create: `server/src/services/practical-review-spec.ts`
- Test: `tests/server/practical-review-service.test.ts`

- [ ] **Step 1: Add failing generated spec test**

Append this test to `tests/server/practical-review-service.test.ts`:

```ts
import { generatePracticalReviewSpec } from '../../server/src/services/practical-review-spec';

it('生成带步骤探针的实测检查脚本', () => {
  const code = generatePracticalReviewSpec({
    startUrl: 'https://crm.test.local/orders',
    resultPath: 'D:/tmp/review-result.json',
    screenshotDir: 'D:/tmp/screenshots',
    steps: [
      { id: 's1', type: 'click', selector: "getByRole('button', { name: '保存' })" },
      { id: 's2', type: 'assertVisible', selector: "getByText('保存成功')" }
    ]
  });

  expect(code).toContain("await page.goto('https://crm.test.local/orders')");
  expect(code).toContain("page.getByRole('button', { name: '保存' })");
  expect(code).toContain("await writeReviewResult");
  expect(code).toContain("stepId: 's1'");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/server/practical-review-service.test.ts
```

Expected: FAIL because `practical-review-spec.ts` does not exist.

- [ ] **Step 3: Implement review spec generator**

Create `server/src/services/practical-review-spec.ts`:

```ts
import type { CaseStep } from '../../../shared/types';
import { renderPracticalLocator } from './practical-review-locator';

interface GenerateInput {
  startUrl: string;
  resultPath: string;
  screenshotDir: string;
  steps: CaseStep[];
}

function quote(value: string) {
  return JSON.stringify(value).replace(/^"|"$/g, "'");
}

export function generatePracticalReviewSpec(input: GenerateInput) {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "import { mkdir, writeFile } from 'node:fs/promises';",
    '',
    'const results = [];',
    '',
    'async function writeReviewResult() {',
    `  await writeFile(${quote(input.resultPath)}, JSON.stringify({ steps: results }, null, 2), 'utf8');`,
    '}',
    '',
    'async function recordStep(step, action) {',
    '  const startedAt = new Date().toISOString();',
    '  try {',
    '    await action();',
    '    const finishedAt = new Date().toISOString();',
    "    results.push({ ...step, status: 'passed', startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt) });",
    '  } catch (error) {',
    '    const finishedAt = new Date().toISOString();',
    '    const message = error instanceof Error ? error.message : String(error);',
    `    await mkdir(${quote(input.screenshotDir)}, { recursive: true });`,
    `    const screenshotPath = ${quote(input.screenshotDir)} + '/' + step.stepId + '.png';`,
    '    await step.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);',
    '    results.push({',
    '      ...step,',
    "      status: 'failed',",
    '      startedAt,',
    '      finishedAt,',
    '      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),',
    '      analysis: buildFailureAnalysis(message, step.selector, screenshotPath, step.page.url())',
    '    });',
    '    await writeReviewResult();',
    '    throw error;',
    '  }',
    '}',
    '',
    'function buildFailureAnalysis(message, selector, screenshotPath, currentUrl) {',
    "  const code = message.includes('strict mode violation') ? 'multiple-match' : message.includes('Timeout') ? 'timeout' : 'unknown';",
    '  return {',
    '    code,',
    "    message: code === 'multiple-match' ? '定位匹配到多个元素' : code === 'timeout' ? '等待目标元素超时' : '步骤执行失败',",
    "    suggestion: code === 'multiple-match' ? '请补充更具体的可访问名称、文本或父级范围。' : '请检查页面状态、定位表达式和等待时间。',",
    '    currentUrl,',
    '    selector,',
    "    artifacts: [{ type: 'screenshot', path: screenshotPath, url: screenshotPath }]",
    '  };',
    '}',
    '',
    "test('实测检查', async ({ page }) => {",
    `  await page.goto(${quote(input.startUrl)});`
  ];

  for (const [index, step] of input.steps.entries()) {
    lines.push(...renderStep(step, index));
  }

  lines.push('  await writeReviewResult();', '});', '');
  return lines.join('\n');
}

function renderStep(step: CaseStep, index: number) {
  const meta = `{ stepId: ${quote(step.id)}, stepIndex: ${index}, stepType: ${quote(step.type)}, selector: ${quote(step.selector ?? '')}, page }`;

  switch (step.type) {
    case 'click':
      return [`  await recordStep(${meta}, async () => ${renderPracticalLocator(step.selector)}.click(${renderTimeoutArg(step)}));`];
    case 'rightClick':
      return [`  await recordStep(${meta}, async () => ${renderPracticalLocator(step.selector)}.click(${renderRightClickArg(step)}));`];
    case 'doubleClick':
      return [`  await recordStep(${meta}, async () => ${renderPracticalLocator(step.selector)}.dblclick(${renderTimeoutArg(step)}));`];
    case 'hover':
      return [`  await recordStep(${meta}, async () => ${renderPracticalLocator(step.selector)}.hover(${renderTimeoutArg(step)}));`];
    case 'fill':
      return [`  await recordStep(${meta}, async () => ${renderPracticalLocator(step.selector)}.fill(${quote(step.value ?? '')}${renderTimeoutOption(step)}));`];
    case 'select':
      return [`  await recordStep(${meta}, async () => ${renderPracticalLocator(step.selector)}.selectOption(${quote(step.value ?? '')}${renderTimeoutOption(step)}));`];
    case 'assertVisible':
      return [`  await recordStep(${meta}, async () => expect(${renderPracticalLocator(step.selector)}).toBeVisible());`];
    case 'assertText':
      return [`  await recordStep(${meta}, async () => expect(${renderPracticalLocator(step.selector)}).toContainText(${quote(step.value ?? '')}));`];
    case 'assertValue':
      return [`  await recordStep(${meta}, async () => expect(${renderPracticalLocator(step.selector)}).toHaveValue(${quote(step.value ?? '')}));`];
    case 'goto':
      return [`  await recordStep(${meta}, async () => page.goto(${quote(step.value ?? '/')}${renderTimeoutOption(step)}));`];
    case 'wait':
      return [`  await recordStep(${meta}, async () => page.waitForTimeout(${step.timeout ?? 1000}));`];
    case 'assertUrl':
      return [`  await recordStep(${meta}, async () => expect(page).toHaveURL(${quote(step.value ?? '')}));`];
    case 'assertTitle':
      return [`  await recordStep(${meta}, async () => expect(page).toHaveTitle(${quote(step.value ?? '')}));`];
    default:
      return [`  await recordStep(${meta}, async () => undefined);`];
  }
}

function renderTimeoutArg(step: CaseStep) {
  return step.timeout === undefined ? '' : `{ timeout: ${step.timeout} }`;
}

function renderRightClickArg(step: CaseStep) {
  return step.timeout === undefined ? `{ button: 'right' }` : `{ button: 'right', timeout: ${step.timeout} }`;
}

function renderTimeoutOption(step: CaseStep) {
  return step.timeout === undefined ? '' : `, { timeout: ${step.timeout} }`;
}
```

- [ ] **Step 4: Replace browser execution stub**

In `server/src/services/practical-review.ts`, replace `runBrowserReview` with:

```ts
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PracticalStepReview } from '../../../shared/types';
import { getProjectAuthPath, hasProjectAuth } from './auth-session';
import { assertVendorBrowser, getVendorEnv } from './vendor-browser';
import { generatePracticalReviewSpec } from './practical-review-spec';

async function runBrowserReview(projectKey: string, item: CaseMeta, envKey: string, envBaseUrl: string): Promise<PracticalStepReview[]> {
  await assertVendorBrowser();

  const tempDir = await mkdtemp(join(tmpdir(), 'playwright-auto-practical-review-'));
  const specPath = join(tempDir, 'practical-review.spec.ts');
  const resultPath = join(tempDir, 'review-result.json');
  const screenshotDir = join(tempDir, 'screenshots');
  const startUrl = buildStartUrl(envBaseUrl, item.startPath);

  await mkdir(screenshotDir, { recursive: true });
  await writeFile(specPath, generatePracticalReviewSpec({
    startUrl,
    resultPath,
    screenshotDir,
    steps: item.steps
  }), 'utf8');

  const storageState = (await hasProjectAuth(projectKey, envKey)) ? getProjectAuthPath(projectKey, envKey) : '';

  await new Promise<void>((resolve, reject) => {
    let output = '';
    const child = spawn('npx', ['playwright', 'test', '--config', 'playwright.config.ts', specPath], {
      cwd: process.cwd(),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...getVendorEnv(),
        PLAYWRIGHT_STORAGE_STATE: storageState,
        PLAYWRIGHT_HEADLESS: 'true'
      }
    });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      output += data.toString();
    });
    child.on('exit', (code) => {
      if (code === 0 || code === 1) {
        resolve();
        return;
      }

      reject(new Error(output || `实测检查进程退出：${code}`));
    });
  });

  const data = JSON.parse(await readFile(resultPath, 'utf8')) as { steps: PracticalStepReview[] };
  return data.steps;
}
```

Also update the call site in `runPracticalReview`:

```ts
const steps = process.env.NODE_ENV === 'test'
  ? createTestStepResults(item, input.testFailure)
  : await runBrowserReview(projectKey, item, envKey, env.baseUrl);
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk npm run test -- tests/server/practical-review-service.test.ts
```

Expected: PASS.

---

### Task 5: Practical Review API

**Files:**
- Modify: `server/src/routes/cases.ts`
- Modify: `web/src/api/cases.ts`
- Test: `tests/server/api-cases.test.ts`

- [ ] **Step 1: Write failing API tests**

Append these tests to `tests/server/api-cases.test.ts`:

```ts
it('可以触发用例实测检查并读取历史记录和详情', async () => {
  process.env.NODE_ENV = 'test';
  const app = createApp();
  await request(app).post('/api/projects').send({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
  const created = await request(app).post('/api/projects/crm/cases').send({
    name: '创建订单',
    startPath: '/orders/create'
  });

  const started = await request(app)
    .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
    .send({ envKey: 'default' });
  const list = await request(app).get(`/api/projects/crm/cases/${created.body.key}/practical-reviews`);
  const detail = await request(app).get(`/api/projects/crm/cases/${created.body.key}/practical-reviews/${started.body.id}`);

  expect(started.status).toBe(201);
  expect(started.body.status).toBe('passed');
  expect(list.body).toHaveLength(1);
  expect(detail.body.id).toBe(started.body.id);
});

it('可以清理用例实测检查历史', async () => {
  process.env.NODE_ENV = 'test';
  const app = createApp();
  await request(app).post('/api/projects').send({
    name: 'CRM 系统',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
  const created = await request(app).post('/api/projects/crm/cases').send({
    name: '创建订单',
    startPath: '/orders/create'
  });
  await request(app)
    .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
    .send({ envKey: 'default' });

  const removed = await request(app).delete(`/api/projects/crm/cases/${created.body.key}/practical-reviews`);
  const list = await request(app).get(`/api/projects/crm/cases/${created.body.key}/practical-reviews`);

  expect(removed.status).toBe(204);
  expect(list.body).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/server/api-cases.test.ts
```

Expected: FAIL because practical review routes do not exist.

- [ ] **Step 3: Add backend routes**

In `server/src/routes/cases.ts`, import:

```ts
import { rm } from 'node:fs/promises';
import { getPracticalReviewsPath } from '../lib/path';
import { listPracticalReviewRecords, readPracticalReviewRecord } from '../lib/practical-review-store';
import { runPracticalReview } from '../services/practical-review';
```

Add these routes before `casesRouter.get<CaseParams>('/:caseKey', ...)`:

```ts
casesRouter.get<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    await getCase(req.params.projectKey, req.params.caseKey);
    res.json(await listPracticalReviewRecords(req.params.projectKey, req.params.caseKey));
  } catch (error) {
    next(error);
  }
});

casesRouter.post<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    res.status(201).json(await runPracticalReview(req.params.projectKey, req.params.caseKey, req.body));
  } catch (error) {
    next(error);
  }
});

casesRouter.get<CaseParams & { reviewId: string }>('/:caseKey/practical-reviews/:reviewId', async (req, res, next) => {
  try {
    const record = await readPracticalReviewRecord(req.params.projectKey, req.params.reviewId);
    if (record.caseKey !== req.params.caseKey) {
      throw new Error('实测检查记录不存在');
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

casesRouter.delete<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    const records = await listPracticalReviewRecords(req.params.projectKey, req.params.caseKey);
    await Promise.all(records.map((record) => rm(getPracticalReviewsPath(req.params.projectKey) + '/' + record.id, { recursive: true, force: true })));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Add frontend API methods**

In `web/src/api/cases.ts`, import the new types:

```ts
import type { CaseMeta, PracticalReviewRecord } from '../../../shared/types';
```

Add:

```ts
export interface PracticalReviewInput {
  envKey?: string;
}

export function startPracticalReview(projectKey: string, caseKey: string, input: PracticalReviewInput = {}) {
  return requestJson<PracticalReviewRecord>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function listPracticalReviews(projectKey: string, caseKey: string) {
  return requestJson<PracticalReviewRecord[]>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews`);
}

export function getPracticalReview(projectKey: string, caseKey: string, reviewId: string) {
  return requestJson<PracticalReviewRecord>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews/${reviewId}`);
}

export function clearPracticalReviews(projectKey: string, caseKey: string) {
  return requestJson<void>(`/api/projects/${projectKey}/cases/${caseKey}/practical-reviews`, {
    method: 'DELETE'
  });
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk npm run test -- tests/server/api-cases.test.ts
```

Expected: PASS.

---

### Task 6: Expire Practical Review on Environment URL Change

**Files:**
- Modify: `server/src/lib/project-store.ts`
- Test: `tests/server/api-projects.test.ts`

- [ ] **Step 1: Write failing expiration test**

Append this test to `tests/server/api-projects.test.ts`:

```ts
it('修改环境 URL 后该环境的实测检查结果变为过期', async () => {
  process.env.NODE_ENV = 'test';
  const app = createApp();
  await request(app).post('/api/projects').send({
    name: 'CRM',
    key: 'crm',
    baseUrl: 'https://crm.test.local'
  });
  const created = await request(app).post('/api/projects/crm/cases').send({
    name: '创建订单',
    startPath: '/orders/create'
  });
  await request(app)
    .post(`/api/projects/crm/cases/${created.body.key}/practical-reviews`)
    .send({ envKey: 'default' });

  await request(app).put('/api/projects/crm/envs/default').send({
    name: '默认环境',
    baseUrl: 'https://new.crm.test.local'
  });

  const detail = await request(app).get(`/api/projects/crm/cases/${created.body.key}`);
  expect(detail.body.practicalReview.status).toBe('expired');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/server/api-projects.test.ts
```

Expected: FAIL because environment URL changes do not expire practical review summaries.

- [ ] **Step 3: Expire related cases in project store**

In `server/src/lib/project-store.ts`, import:

```ts
import type { CaseMeta, EnvMeta, ProjectMeta } from '../../../shared/types';
import { readJson } from './fs';
import { expirePracticalReviewIfNeeded } from './practical-review-store';
```

Add helper:

```ts
async function expirePracticalReviewsForEnv(projectKey: string, envKey: string, baseUrl: string) {
  const casesPath = join(getProjectPath(projectKey), 'cases');
  if (!existsSync(casesPath)) {
    return;
  }

  const names = await readdir(casesPath);
  await Promise.all(
    names.map(async (name) => {
      const item = await readJson<CaseMeta>(join(casesPath, name, 'case.json'));
      if (item.practicalReview?.envKey === envKey) {
        await expirePracticalReviewIfNeeded(projectKey, item, baseUrl);
      }
    })
  );
}
```

In `updateProjectEnv`, after `await writeProject(...)`, call expiration if `baseUrl` changed:

```ts
const nextProject = await writeProject({
  ...project,
  envs
});

if (project.envs[index].baseUrl !== value.baseUrl) {
  await expirePracticalReviewsForEnv(projectKey, envKey, value.baseUrl);
}

return nextProject;
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
rtk npm run test -- tests/server/api-projects.test.ts tests/server/practical-review-store.test.ts
```

Expected: PASS.

---

### Task 7: Project Detail and Run Center Columns

**Files:**
- Modify: `web/src/pages/ProjectDetail.vue`
- Modify: `web/src/pages/RunCenter.vue`
- Modify: `web/src/pages/run-center.ts`
- Test: `tests/web/run-center.test.ts`

- [ ] **Step 1: Add run-center helper tests**

Append this test to `tests/web/run-center.test.ts`:

```ts
import { formatPracticalReviewStatus, getPracticalReviewTagType } from '../../web/src/pages/run-center';

it('运行中心显示实测检查状态', () => {
  expect(formatPracticalReviewStatus(undefined)).toBe('未审查');
  expect(formatPracticalReviewStatus(makeRunCenterSummary('passed'))).toBe('通过');
  expect(getPracticalReviewTagType(makeRunCenterSummary('failed'))).toBe('danger');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk npm run test -- tests/web/run-center.test.ts
```

Expected: FAIL because helpers are not exported.

- [ ] **Step 3: Add run-center practical status helpers**

In `web/src/pages/run-center.ts`, add:

```ts
export function formatPracticalReviewStatus(summary: PracticalReviewSummary | undefined) {
  if (!summary || summary.status === 'untested') {
    return '未审查';
  }

  const labels: Record<PracticalReviewSummary['status'], string> = {
    untested: '未审查',
    running: '检查中',
    passed: '通过',
    failed: '失败',
    expired: '过期'
  };

  return labels[summary.status];
}

export function getPracticalReviewTagType(summary: PracticalReviewSummary | undefined) {
  if (!summary) {
    return 'info';
  }

  const types: Record<PracticalReviewSummary['status'], 'info' | 'primary' | 'success' | 'danger' | 'warning'> = {
    untested: 'info',
    running: 'primary',
    passed: 'success',
    failed: 'danger',
    expired: 'warning'
  };

  return types[summary.status];
}
```

- [ ] **Step 4: Update ProjectDetail table**

In `web/src/pages/ProjectDetail.vue`, remove `reviewLabels`、`reviewTypes`、`formatReview`、`getReviewType`.

Import helpers:

```ts
import { formatPracticalReviewStatus, formatPracticalReviewTime, getPracticalReviewTagType } from './run-center';
```

Replace the existing `审查状态` column with:

```vue
<el-table-column label="实测检查" min-width="140">
  <template #default="{ row }">
    <el-tag :type="getPracticalReviewTagType(row.practicalReview)" effect="light">
      {{ formatPracticalReviewStatus(row.practicalReview) }}
    </el-tag>
  </template>
</el-table-column>
<el-table-column label="最后检查时间" min-width="190" show-overflow-tooltip>
  <template #default="{ row }">
    {{ formatPracticalReviewTime(row.practicalReview) }}
  </template>
</el-table-column>
```

- [ ] **Step 5: Update RunCenter case selection table**

In `web/src/pages/RunCenter.vue`, update the import from `./run-center`:

```ts
import {
  canStartRun,
  formatPracticalReviewStatus,
  formatPracticalReviewTime,
  getPracticalReviewTagType,
  getRunButtonText,
  mergeSelectedCaseKeys
} from './run-center';
```

Replace the case table `更新时间` column with:

```vue
<el-table-column label="实测检查" min-width="120">
  <template #default="{ row }">
    <el-tag :type="getPracticalReviewTagType(row.practicalReview)" effect="light">
      {{ formatPracticalReviewStatus(row.practicalReview) }}
    </el-tag>
  </template>
</el-table-column>
<el-table-column label="最后检查时间" min-width="180" show-overflow-tooltip>
  <template #default="{ row }">
    {{ formatPracticalReviewTime(row.practicalReview) }}
  </template>
</el-table-column>
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
rtk npm run test -- tests/web/run-center.test.ts
rtk npm run typecheck
```

Expected: PASS.

---

### Task 8: Case Editor Practical Review Panel and Failure Analysis Drawer

**Files:**
- Modify: `web/src/pages/CaseEditor.vue`
- Modify: `web/src/pages/case-editor.ts`
- Modify: `web/src/api/cases.ts`
- Test: `tests/web/case-editor.test.ts`

- [ ] **Step 1: Add helper test for failed step marker**

Append this test to `tests/web/case-editor.test.ts`:

```ts
import { getFailedPracticalStep } from '../../web/src/pages/case-editor';

it('能判断实测失败步骤', () => {
  const step = makeStep('s1');
  expect(getFailedPracticalStep(makePracticalSummary('failed'), step)).toBe(true);
  expect(getFailedPracticalStep(makePracticalSummary('passed'), step)).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify pass or failure**

Run:

```bash
rtk npm run test -- tests/web/case-editor.test.ts
```

Expected: PASS if Task 1 helper already exists; otherwise FAIL and implement Task 1 helper first.

- [ ] **Step 3: Import APIs and state in CaseEditor**

In `web/src/pages/CaseEditor.vue`, extend imports:

```ts
import type { CaseMeta, CaseStep, EnvMeta, PracticalReviewRecord, StepType } from '../../../shared/types';
import { clearPracticalReviews, getCase, listPracticalReviews, startPracticalReview, startRecord, stopRecord, updateCase } from '../api/cases';
import { getAuthState } from '../api/auth';
import {
  formatPracticalReviewStatus,
  getFailedPracticalStep,
  getPracticalReviewTagType,
  ...
} from './case-editor';
```

Add state:

```ts
const practicalReviewing = ref(false);
const practicalHistoryOpen = ref(false);
const failureDrawerOpen = ref(false);
const practicalHistory = ref<PracticalReviewRecord[]>([]);
const activePracticalRecord = ref<PracticalReviewRecord | null>(null);
const hasAuth = ref(false);
const authPath = ref('');
```

- [ ] **Step 4: Add practical review actions**

Add functions in `CaseEditor.vue`:

```ts
async function loadAuthState() {
  if (!activeEnv.value) {
    hasAuth.value = false;
    authPath.value = '';
    return;
  }

  const state = await getAuthState(projectKey, activeEnv.value.key);
  hasAuth.value = state.exists;
  authPath.value = state.path;
}

async function runPracticalCheck() {
  if (!activeEnv.value) {
    ElMessage.warning('请先配置项目环境');
    return;
  }

  practicalReviewing.value = true;
  try {
    const record = await startPracticalReview(projectKey, caseKey, { envKey: activeEnv.value.key });
    activePracticalRecord.value = record;
    item.value = await getCase(projectKey, caseKey);
    if (record.status === 'failed') {
      failureDrawerOpen.value = true;
      ElMessage.error(record.summary.failureMessage ?? '实测检查失败');
    } else {
      ElMessage.success('实测检查通过');
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    practicalReviewing.value = false;
  }
}

async function openPracticalHistory() {
  practicalHistory.value = await listPracticalReviews(projectKey, caseKey);
  practicalHistoryOpen.value = true;
}

async function clearPracticalHistory() {
  const confirmed = await ElMessageBox.confirm('确认清理当前用例的实测检查历史吗？', '清理历史', {
    confirmButtonText: '清理',
    cancelButtonText: '取消',
    type: 'warning'
  }).catch(() => false);

  if (!confirmed) {
    return;
  }

  await clearPracticalReviews(projectKey, caseKey);
  practicalHistory.value = [];
  ElMessage.success('实测检查历史已清理');
}

function openFailureAnalysis(record: PracticalReviewRecord) {
  activePracticalRecord.value = record;
  failureDrawerOpen.value = true;
}

function getStepPracticalFailure(step: CaseStep) {
  return activePracticalRecord.value?.steps.find((result) => result.stepId === step.id && result.status === 'failed');
}
```

In `loadCase`, call `await loadAuthState();` after `activeEnv.value` is set.

- [ ] **Step 5: Update metadata area layout**

In `CaseEditor.vue`, change `.meta` template from a single form to a two-column layout:

```vue
<div class="meta-grid">
  <el-form label-width="90px">
    <el-form-item label="用例名称">
      <el-input v-model="item.name" />
    </el-form-item>
    <el-form-item label="起始路径">
      <el-input v-model="item.startPath" />
    </el-form-item>
    <el-form-item label="实际地址">
      <div class="start-preview">{{ startPreview }}</div>
    </el-form-item>
  </el-form>

  <section class="practical-panel">
    <div class="panel-head">
      <strong>实测检查</strong>
      <el-tag :type="getPracticalReviewTagType(item.practicalReview)" effect="light">
        {{ formatPracticalReviewStatus(item.practicalReview) }}
      </el-tag>
    </div>
    <div class="panel-row">
      <span>登录态</span>
      <strong>{{ hasAuth ? '已保存' : '未保存' }}</strong>
    </div>
    <div class="panel-row">
      <span>最后检查时间</span>
      <strong>{{ item.practicalReview?.checkedAt ?? '-' }}</strong>
    </div>
    <p v-if="item.practicalReview?.status === 'failed'" class="failure-summary">
      第 {{ (item.practicalReview.failedStepIndex ?? 0) + 1 }} 步：{{ item.practicalReview.failureMessage }}
    </p>
    <div class="panel-actions">
      <el-button type="primary" :loading="practicalReviewing" @click="runPracticalCheck">开始实测检查</el-button>
      <el-button @click="openPracticalHistory">查看历史</el-button>
      <el-button @click="clearPracticalHistory">清理历史</el-button>
    </div>
    <el-tooltip v-if="authPath" :content="authPath" placement="top">
      <span class="auth-path">登录态路径</span>
    </el-tooltip>
  </section>
</div>
```

- [ ] **Step 6: Mark failed step in step table**

Replace the step table `审查` column label with `检查` and update its template:

```vue
<el-table-column label="检查" width="140">
  <template #default="{ row }">
    <div class="review-tags">
      <template v-if="getStepReviews(row).length > 0">
        <el-popover
          v-for="review in getStepReviews(row)"
          :key="review.id"
          placement="top"
          width="320"
          trigger="hover"
        >
          <template #reference>
            <el-tag :type="reviewTypes[review.level]" effect="light">定位风险</el-tag>
          </template>
          <div class="review-popover">
            <strong>{{ review.message }}</strong>
            <p>{{ review.suggestion }}</p>
          </div>
        </el-popover>
      </template>
      <el-tag
        v-if="item.practicalReview && getFailedPracticalStep(item.practicalReview, row)"
        type="danger"
        effect="light"
        class="clickable-tag"
        @click.stop="activePracticalRecord && openFailureAnalysis(activePracticalRecord)"
      >
        实测失败
      </el-tag>
      <span v-if="getStepReviews(row).length === 0 && !getFailedPracticalStep(item.practicalReview, row)" class="review-pass">
        通过
      </span>
    </div>
  </template>
</el-table-column>
```

- [ ] **Step 7: Add failure analysis drawer and history drawer**

Add after the table:

```vue
<el-drawer v-model="failureDrawerOpen" title="失败分析" size="420px">
  <template v-if="activePracticalRecord">
    <div v-for="step in activePracticalRecord.steps.filter((row) => row.status === 'failed')" :key="step.stepId" class="analysis-block">
      <h3>第 {{ step.stepIndex + 1 }} 步：{{ step.stepType }}</h3>
      <p class="analysis-message">{{ step.analysis?.message }}</p>
      <dl>
        <dt>目标定位</dt>
        <dd>{{ step.selector || '-' }}</dd>
        <dt>当前 URL</dt>
        <dd>{{ step.analysis?.currentUrl || '-' }}</dd>
        <dt>匹配数量</dt>
        <dd>{{ step.analysis?.matchCount ?? '-' }}</dd>
        <dt>建议</dt>
        <dd>{{ step.analysis?.suggestion || '-' }}</dd>
      </dl>
    </div>
  </template>
</el-drawer>

<el-drawer v-model="practicalHistoryOpen" title="实测检查历史" size="520px">
  <el-table :data="practicalHistory" border empty-text="暂无实测检查历史">
    <el-table-column prop="startedAt" label="开始时间" min-width="180" />
    <el-table-column prop="envKey" label="环境" width="100" />
    <el-table-column prop="status" label="结果" width="90" />
    <el-table-column label="操作" width="120">
      <template #default="{ row }">
        <el-button size="small" :disabled="row.status !== 'failed'" @click="openFailureAnalysis(row)">失败分析</el-button>
      </template>
    </el-table-column>
  </el-table>
</el-drawer>
```

- [ ] **Step 8: Add styles**

Add to scoped style:

```css
.meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 18px;
}

.practical-panel {
  border: 1px solid #d8e2ed;
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.panel-head,
.panel-row,
.panel-actions {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.panel-row {
  color: #5f7188;
  font-size: 13px;
  margin-top: 10px;
}

.panel-row strong {
  color: #1f2937;
}

.panel-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 14px;
}

.failure-summary {
  color: #d94747;
  margin: 12px 0 0;
}

.auth-path {
  color: #5f7188;
  cursor: help;
  display: inline-block;
  font-size: 12px;
  margin-top: 10px;
}

.clickable-tag {
  cursor: pointer;
}

.analysis-block h3 {
  margin: 0 0 10px;
}

.analysis-message {
  color: #d94747;
  font-weight: 600;
}

.analysis-block dt {
  color: #5f7188;
  font-size: 12px;
  margin-top: 12px;
}

.analysis-block dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

@media (max-width: 960px) {
  .meta-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 9: Run typecheck**

Run:

```bash
rtk npm run typecheck
```

Expected: PASS.

---

### Task 9: Clean History Route Safety and Full Verification

**Files:**
- Modify: `server/src/routes/cases.ts`
- Test: all test files

- [ ] **Step 1: Tighten delete route path handling**

In `server/src/routes/cases.ts`, replace the delete route cleanup body with safe path helper usage:

```ts
import { getPracticalReviewPath } from '../lib/path';

casesRouter.delete<CaseParams>('/:caseKey/practical-reviews', async (req, res, next) => {
  try {
    const records = await listPracticalReviewRecords(req.params.projectKey, req.params.caseKey);
    await Promise.all(
      records.map((record) => rm(getPracticalReviewPath(req.params.projectKey, record.id), { recursive: true, force: true }))
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Run full test suite**

Run:

```bash
rtk npm run test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
rtk npm run build
```

Expected: PASS. Vite chunk size warnings are acceptable if the command exits 0.

- [ ] **Step 5: Browser verification**

Start or reuse local services:

```bash
rtk npm run dev
```

Open the frontend and verify:

1. Project detail page shows `实测检查` and `最后检查时间`, not static review status.
2. Run center case selection table shows `实测检查` and `最后检查时间`, not static review status.
3. Case editor metadata area shows the `实测检查` panel on the right of 用例名称/起始路径/实际地址.
4. Running `开始实测检查` updates latest status to `通过` or `失败`.
5. Failed practical review adds `实测失败` to the failing step row.
6. Clicking `实测失败` or `失败分析` opens the failure analysis drawer.
7. `查看历史` opens the review history drawer.
8. `清理历史` removes current case practical review history.

---

## Self-Review

**Spec coverage**
- UI names are covered: `定位检查` stays in CaseEditor step table; `实测检查` is used in lists/panel; `失败分析` is shown in drawer.
- Timing is covered: saving remains static-only; practical review is manual from CaseEditor; failure analysis is automatic on practical review failure.
- Expiration is covered: case steps/name/start path and env URL changes can expire practical review; login state saves do not affect the hash.
- Reporting is covered: practical reviews do not use official runs or HTML reports; records live under `projects/<projectKey>/reviews/<reviewId>/`.
- Retention is covered: 7 days and max 20 records, with manual clear button.
- Run center and project detail only show practical review status/time.

**Placeholder scan**
- No `TBD`, `TODO`, `implement later`, or unspecified test steps remain.

**Type consistency**
- `CaseMeta.practicalReview`, `PracticalReviewSummary`, `PracticalReviewRecord`, `PracticalStepReview`, `PracticalFailureAnalysis`, and `PracticalReviewArtifact` are introduced in Task 1 and reused consistently.
- API method names match route names: `startPracticalReview`, `listPracticalReviews`, `getPracticalReview`, `clearPracticalReviews`.
