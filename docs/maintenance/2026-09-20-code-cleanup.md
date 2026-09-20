# Repository dead-code cleanup

## Approved plan and boundaries

Remove verified unused helpers, obsolete internal wrappers, test-only legacy
modules and retired canvas algorithms. Preserve public HTTP routes, historical
session decoding, provider contracts, Native binaries/protocol/configuration,
Skill content, saved assets, final responses, and the existing uncommitted Skill
recovery fixes. Do not change dependencies or introduce a replacement framework.

Before deletion, verify bindings against current source (the CodeGraph index is
stale), check runtime/dynamic/framework/manual CLI entrypoints and declarations,
and lock relevant current behavior with regression tests. Move safety assertions
onto live paths; do not reintroduce retired approval, Planner or pinned-task APIs
merely to preserve tests. Retire tests of deliberately removed algorithms.

## Passes

1. Record the existing dirty-worktree baseline and rerun tests.
2. Remove duplicate request helpers, unused service/thread/clarification wrappers
   and retired keyword-based Skill routing.
3. Move useful orphan-module safety tests to current confirmation, context and
   image-reference paths, then remove the five orphan modules and stale types.
4. Remove old canvas damping/geometry/quality fallback helpers and their tests;
   preserve current direct interactions and asset delivery.
5. Remove verified unused JS bindings; widen existing lint coverage and add a
   read-only source reference audit using the installed TypeScript parser.
6. Run targeted regressions, full tests, lint, typecheck, build, diff checks and
   independent review. Record removed/retained code, test-count changes and gaps.

## Baseline

- Planning validation: 1,207 tests passed, no failures or skipped tests.
- Existing lint and TypeScript checks passed.
- Broader JS unused-binding scan found six omissions outside the Agent rule.
- 25 modified tracked files plus one untracked Skill recovery regression existed
  before this cleanup; those changes belong to the user and must remain.

## Results

### 删除清单

以下都是源码引用、文件内依赖、框架/脚本入口和独立审查共同确认的
无生产消费者代码。并非按名称或 CodeGraph 的旧索引直接删除。

整文件删除（5 个实现、4 个专属测试、1 个声明）：

- `app/lib/agent/approval-state.mjs`、`approval-state.test.mjs`
- `app/lib/agent/context-replay.mjs`、`context-window.mjs`、`context-replay-window.test.mjs`
- `app/lib/agent/multimodal-reference-context.mjs`、`multimodal-reference-context.test.mjs`
- `app/lib/agent/original-asset.mjs`、`original-asset.mjs.d.ts`、`original-asset.test.mjs`

活跃模块中删除的入口（路径相对于 `app/lib/`；存在的声明同步清理）：

| 文件 | 删除的符号 |
| --- | --- |
| `agent/agent-request-validation.mjs` | `summarizePromptQuality`、`hasOnlyImageOperationAmbiguity`、`sanitizeAgentResponseContent`、`mergeTopicMemory`、`generatedAssetsFromResult`、`positiveInteger`、`enrichGeneratedAssetEvents`、`parseClarifiedImageCount` 及独占导入/常量 |
| `agent/agent-context-preparation-service.mjs` | `createContextPreparationService` |
| `agent/agent-image-execution-flow.mjs` | `executeAgentImageFlow` |
| `agent/agent-image-pipeline-service.mjs` | `normalizeImagePipelineRequest`、`executeImagePipeline`、`createImagePipelineService` |
| `agent/agent-request-context-flow.mjs` | `prepareAgentRequestContext` |
| `agent/agent-turn-execution-service.mjs` | `runAgentTurnExecution`、`runNativeResponsesTurn`、`runMainAgentOnce` |
| `agent/thread-turn-service.mjs` | `validateThreadRequest`、`createOrResumeThread`、`providerFingerprint`、`persistNativeThread`、`startTurn`、`resumeTurn`、`startThread`、`steerTurn`、`interruptTurn`、`completeTurn`、`failTurn`；保留真实调用的 `loadTurnState`、`resolveContinuationTurn` |
| `agent/clarification-state.mjs` | `applyClarificationResponse`、`resolveAgentClarification`、`shouldAskClarification` |
| `agent/skill-registry.mjs` | `selectSkillForPrompt`、`findDirectSkillMatches`、`hasDirectSkillExecutionIntent`、`shouldInjectActiveSkill`；显式选择/加载/hash/恢复不变 |
| `agent/confirmation-continuation.mjs` | `resolveConfirmationImageIdentity`、`resolveRemainingConfirmationTaskIdentities` |
| `agent/context-events.mjs` | `estimateEventTokens`、`migrateMessagesToContextEvents` 旧别名、`compactContextAsync` 未接线扩展、`replayContextEvents`、`buildResponseItems`、`replayResponseItems`、`replayContext`；真实事件解码/构建/同步压缩保留 |
| `agent/context-reference.mjs` | `parseAgentProposalBlock`、`AGENT_PROPOSAL_MARKERS`、专用 `normalizeProposalOption`/标记常量；结构化 `agentProposal` 历史读取和 UI 保留 |
| `agent/image-delivery-utils.mjs` | `resolveImageBatchMode`；保留 `resolveImageDeliveryPlan` |
| `agent/image-options.mjs` | 旧数量协调器 `resolveAgentImageCountDecision`、旧补批队列 `resolveAgentImageBatchContinuation`；不增加自动补生成 |
| `agent/preload-generated-assets.mjs` | `preloadGeneratedAssets`；保留实际使用的单图加载器和有界交付队列 |
| `agent/session-visual-assets.mjs` | `normalizeSessionVisualAssets` 多余重导出；真实 metadata normalizer 保留，测试直接导入它 |
| `agent/native-codex-host.mjs` | `invalidateNativeCodexHostScope`；真实 `invalidateNativeCodexHost(host)`、配置、协议和二进制不变 |
| `agent/codex-main-snapshot.mjs` | `isCodexMainSnapshot`；完整 Native 快照常量不变 |
| `agent/agent-analysis.mjs`、`agent/todo-tools.mjs`、`agent/event-contract.mjs`、`agent/thread-journal.mjs` | 未使用别名/包装 `MAX_AGENT_ANALYSIS_CHECKPOINTS`、`TODO_ITEM_STATUSES`、`CODEX_LIFECYCLE_EVENT_TYPES`、`isCodexLifecycleEvent`、`sanitizeJournalValue` |
| `agent/agent-request-runtime.ts` | lib 内无效的 `runtime`/`dynamic` 导出；真实 API route 的 Next 配置保留 |
| `canvas-viewport-motion.mjs` | `applyCanvasWheelDelta`、`dampCanvasViewport`、`isCanvasViewportSettled`、`getCanvasPanTargetViewport`、`dampCanvasPanViewport`、`isCanvasPanSettled`、`getCanvasSceneTransform` 及专属常量 |
| `canvas-direct-interaction.mjs` | `applyDirectItemDrag`；保留当前拖动事务 |
| `canvas-interaction.mjs` | `projectScreenRectToCanvas`、`isRectIntersecting`、`getRotatedRectAabb`、`ownsCanvasItemVisualHandoff` |
| `workspace-session-view.mjs` | `getImageCardQualitySummary`、`resolveRequestedResolutionTier`、`isOutputResolutionSufficient`、`getResolutionFailureReason`、`getImageCardResolutionStatus`、`resolveImageGenerationFallbackSizes`、`buildCanvasImageGenerationFailureMessage` 及专属分辨率判断/常量；原 Skill recovery 改动保留 |
| `api-client.ts` | 重复 `ASPECT_RATIOS`；真实 `aspect-ratios.ts` 不变 |
| `generate-request-flow.mjs` | `resolveGenerateImageModel`、`resolveGenerateImageModelFromAllowedModels`；实际 provider/model 选择不变 |
| `generated-image-history.mjs` | `mergeGeneratedHistoryReferences`；历史归一化、来源身份和当前选择路径不变 |
| `provider-model-selection.mjs` | `listAlternativeProviderModelSelections`；真实 resolver 保留，不新增自动换模型 |
| `image-model-capabilities.mjs` | `normalizeImageModelCapabilityId`、`imageModelSupportsAspectRatioUi`、`supportsImageModelRequestedSize`、`supportsImageModelExactSize`、`supportsImageModelImageSizeConfig`、`getImageSizeLabel`、未用 `gcd` |
| `production-timeouts.mjs`、`provider-config.mjs`、`session-persistence.mjs` | `productionTimeoutMs()`、`providerKeyEnv`、未用 `normalizedTopics`；真实常量和行为保留 |

另外删除 `safeNextWidth`、测试中的 `topicUpdateSource`、未用
`resolveImageCardSize` import。同步清理专属测试、声明、导入和过时注释。

### 安全回归迁移

- 旧 approval 语义迁移至真实 confirmation envelope/claim：参数 hash、操作/用户身份、过期、拒绝、重复消费，不恢复旧 approval 数据模型。
- 旧 replay/window 测试迁移至 `requestMessagesToContextEvents`、`buildReplayableContext`、`compactContext`：事件/资产身份、base64 过滤、有界窗口、摘要及审计历史。未接线 Chat Completions serializer 不是历史会话读取合同。
- 新 `image-reference-safety.test.mjs` 使用真实 runtime handler + 引用 resolver，验证原图缺失/仅预览时供应商零调用，禁止替换为最新图；覆盖引用去重、pending region/evidence 隔离。
- 旧批量预加载测试改为真实 `runGeneratedAssetPreloadQueue` + `preloadGeneratedAsset` 组合测试，保留成功资产并隔离加载失败。
- 退役旧缓动/几何/质量降级专属测试；保留当前平移缩放、拖动事务、框选、取消、交付去重、任务终态、Skill 恢复、commentary、null 参数和未知供应商结果安全回归。

### 明确保留的兼容与审计出口

以下 6 项已写入 `scripts/audit-code-references.mjs` 的带理由例外表，
不声称它们都被当前生产代码调用：

| 保留出口 | 原因 |
| --- | --- |
| `api-client.ts#AVAILABLE_MODELS` | 源码明确标注旧消费者兼容合同 |
| `image-model-capabilities.mjs#IMAGE_MODEL_CAPABILITIES` | 源码明确标注兼容 shape；真实能力解析使用 provider registry |
| `api-security.mjs#resolvePublicAssetDataUrl` | 历史 public 图片读取和路径安全边界，本轮要求保留 |
| `local-assets.mjs#resolveLocalAssetDataUrl` | runtime/legacy public 图片读取兼容层，本轮要求保留 |
| `compatibility-gate.mjs#assertCurrentContract` | 迁移拒绝合同；目前测试消费，本轮明确保护迁移拦截 |
| `agent/native-business-ledger.mjs#readNativeBusinessOperation` | 持久账本只读审计入口；exactly-once/unknown-outcome 安全测试使用 |

公开 HTTP API（包含 `/api/settings/provider`）、Native 协议快照、手动构建和诊断
脚本、Skill 内容、现用 SVG、依赖与锁文件均保留。没有删除历史会话、图片、
日志、凭证、journal 或运行目录。删除的代码均可从 Git 历史恢复。

### 引用检查和保留边界

- 扩展现有 JS 未使用变量规则至 `app/**/*.mjs`、`scripts/**/*.mjs`，`npm run lint` 检查两处。
- 新增 `npm run check:references`：使用已安装 TypeScript AST，无新依赖、只读、不自动删除。
- 检查命名/别名导入、重导出、namespace、字面量动态加载、文件内依赖、Next 约定入口与手动脚本。新未审查孤立模块/导出或不透明动态 import 会让回归失败。
- 独立审查发现的解构默认值依赖、Next metadata/proxy 入口误报已修复并加回归。
- 自动扫描不替代人工判断：namespace、动态加载和标识符同名会保守保留；生成协议与 `.d.ts` 不按运行时图判死代码，声明由类型检查和符号搜索核对；无法证明仓库外消费者或任意反射用法不存在。

### 原有改动保护

开始时记录了 26 个已有修改文件的 SHA256 和原始 diff。21 个文件保持逐字节不变。
仅 5 个文件与本轮清理重叠：`agent-request-context-flow.mjs`、
`agent-request-runtime.ts`、`agent-runtime-boundaries.test.mjs`、
`workspace-session-view.mjs` 及其测试。逐文件比对确认原 diff 新增行全部仍在，
没有回滚原 Skill recovery 修改；原未跟踪恢复测试也保持原样。

### 最终验证

测试数量以本轮开始时的实际工作区为基线，不以 HEAD 代替基线（HEAD 尚未
包含用户之前新增的 Skill 恢复测试）：

| 项目 | 数量 |
| --- | ---: |
| 开始时全部通过 | 1,207 |
| 退役孤立模块旧测试 | -12 |
| 退役后端旧包装/Skill 猜测/数量协调测试 | -11 |
| 退役前端旧算法/质量降级/历史合并/候选模型测试 | -36 |
| 退役未接线 proposal 文本解析测试 | -1 |
| 新增当前确认/上下文/图片引用安全回归 | +8 |
| 新增引用审查回归 | +9 |
| 最终通过 | **1,164** |

前端 36 项细分：viewport 15、direct drag 1、interaction 5、workspace 12、
history 2、provider selection 1。旧测试中的有效安全语义迁移到实际路径，
不是为减少失败而删除测试。

- `npm test`：1,164 通过，0 失败、取消或跳过。
- `npm run check:references`：扫描 311 个源码文件（含测试和根配置，排除生成协议及声明），未审查孤立文件 0、未审查导出 0、不透明生产动态 import 0；6 个明确例外如上。此口径不同于初检包含声明/生成文件的 441 个代码文件。
- `npm run lint`：通过；保留已有 Babel 对 `page.tsx` 超过 500KB 的提示。
- `npm run typecheck`：通过。
- `npm run build`：通过；Turbopack 有 21 条 runtime/public 动态文件范围过宽的构建警告。没有为消除警告修改路径/构建配置或删除运行数据。
- `git diff --check`：通过。
- 独立审查：作者/审查者分离；针对上下文、引用、预加载、Native 边界等另运行 76 项回归通过；最后后端批次、结构及引用检查另有 39 项通过。两轮均未发现阻断性回退，审查者未修改文件。

首次全量运行唯一失败为质量脚本测试写死旧 `eslint app`，已同步到获准的新
`eslint app scripts`，并增加引用审查命令和 lint 范围断言；随后完整重跑通过。
没有发起付费供应商出图请求；本次结论来自本地回归、集成测试、静态审查和构建，
不把它表述为一次真实付费供应商端到端验收。本报告记录提交前的验证结果，
Git 提交与推送状态以对应提交记录为准。
