# Graph Report - playwright-auto  (2026-05-23)

## Corpus Check
- 81 files · ~44,261 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 604 nodes · 1338 edges · 30 communities (26 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7fb730bc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]

## God Nodes (most connected - your core abstractions)
1. `requestJson()` - 37 edges
2. `getProjectPath()` - 29 edges
3. `writeJson()` - 27 edges
4. `getProject()` - 15 edges
5. `getProjectAuthPath()` - 15 edges
6. `createCase()` - 14 edges
7. `getCasePath()` - 14 edges
8. `runProject()` - 14 edges
9. `CaseMeta` - 14 edges
10. `ensureDir()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `createApp()` --calls--> `cors`  [INFERRED]
  server/src/app.ts → package.json
- `createApp()` --calls--> `express`  [INFERRED]
  server/src/app.ts → package.json
- `runBrowserReview()` --calls--> `buildStartUrl()`  [EXTRACTED]
  server/src/services/practical-review.ts → shared/url.ts
- `startRecordSession()` --calls--> `buildStartUrl()`  [EXTRACTED]
  server/src/services/record-session.ts → shared/url.ts
- `setProjectDefaultEnv()` --calls--> `writeJson()`  [EXTRACTED]
  tests/server/record-session.test.ts → server/src/lib/fs.ts

## Communities (30 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (88): reviewCase(), createCase(), CreateCaseInput, createCaseKey(), deleteCase(), ensureReview(), formatDatePart(), formatTimePart() (+80 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (28): createStep(), formatLocatorCheckPass(), formatPracticalReviewStatus(), formatStepType(), getFailedPracticalStep(), getInsertIndex(), getPracticalReviewTagType(), hasSelector() (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (51): getAuthState(), LoginInput, clearPracticalReviews(), createCase(), CreateCaseInput, deleteCase(), exportCase(), getCase() (+43 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (47): reviewStep(), reviewStepTypes, shouldReviewStep(), createReviewSummary(), formatReviewSummary(), labels, createReviewItem(), ReviewContext (+39 more)

### Community 4 - "Community 4"
Cohesion: 0.19
Nodes (15): executablePath, env, getBrowserPath(), assertVendorBrowser(), checkVendorBrowser(), getChromePath(), getVendorEnv(), getVendorRegistryPath() (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.24
Nodes (11): createReportUrl(), createRunErrorMessage(), findCaseName(), findFailedPhase(), findFailedReason(), getRunConfig(), normalizeRunOptions(), RunProjectInput (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (12): dependencies, archiver, cors, element-plus, express, pinia, vue, vue-router (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (30): devDependencies, concurrently, @playwright/test, supertest, tsx, @types/archiver, @types/cors, @types/express (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (19): code:bash (npm install), code:text (vendor/), code:text (https://cdn.playwright.dev/builds/cft/148.0.7778.96/win64/ch), code:bash (npm run dev), code:json ({), code:text (data/), code:text (cases/), code:text (data/projects/<projectKey>/auth/default.storageState.json) (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (28): RecordParams, recordRouter, result, createStepMeta(), hasRightButton(), isExpectCall(), isWaitForPopupCall(), parseAwaitStep() (+20 more)

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (15): args, code, options, resultPath, spawnMock, normalizePracticalSelector(), quote(), renderPracticalLocator() (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (17): compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, paths (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (36): getPracticalReviewPath(), getPracticalReviewsPath(), getPracticalReviewWorkPath(), assertReviewId(), cleanupPracticalReviews(), createCaseSnapshotHash(), createPracticalReviewId(), listPracticalReviewRecords() (+28 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (12): runner, headedWorkers, headlessWorkers, maxWorkers, server, dataRoot, port, steps (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.31
Nodes (9): getMissingFiles(), hasFile(), linkRegistryDir(), main(), prepareRegistry(), printMissing(), registryMap, vendorBrowserList (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (18): saveLogin(), startLogin(), removeSteps(), canBatchDown, canBatchUp, clearBatch(), clearPracticalHistory(), deleteBatch() (+10 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (11): canStartRun(), formatPracticalReviewStatus(), formatPracticalReviewTime(), getPracticalReviewTagType(), getRunButtonText(), getSelectedCases(), mergeSelectedCaseKeys(), PracticalReviewSummary (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.27
Nodes (10): DEFAULT_CONFIG, FileConfig, getAppConfig(), parseIntValue(), readFileConfig(), readInt(), readStepTimeouts(), readText() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (8): authRouter, trashRouter, projectsRouter, runsRouter, RunError, formatTooSmall(), formatZodIssue(), getFieldLabel()

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (6): filePath, getReportPath(), ProjectParams, reportPath, RunParams, runPath

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (7): canMoveSteps(), copySteps(), getStepIndexes(), moveSteps(), duplicateBatch(), setActiveSteps(), shiftBatch()

### Community 26 - "Community 26"
Cohesion: 0.47
Nodes (4): getStartPreview(), buildStartUrl(), isFullUrl(), url

### Community 27 - "Community 27"
Cohesion: 0.40
Nodes (5): copyStep(), moveStep(), duplicateStep(), setActiveStep(), shiftStep()

## Knowledge Gaps
- **180 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+175 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createApp()` connect `Community 6` to `Community 0`, `Community 22`, `Community 23`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 6` to `Community 7`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _180 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05676704742125303 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1028225806451613 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06203007518796992 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.06398730830248546 - nodes in this community are weakly interconnected._