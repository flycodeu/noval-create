# NovelForge 高复杂函数拆分设计

更新时间：2026-08-09

## 1. 目标与范围

本设计按以下固定顺序拆分当前最高风险的四个高复杂区域：

1. 章节生成流水线；
2. 发布检查；
3. 质量看板；
4. Writing 页面。

本阶段只调整代码组织、依赖方向和测试边界，不改变现有业务规则、数据库结构、IPC 契约、任务快照格式或用户可见流程。

当前复杂度基线：

| 区域 | 主函数 | 函数长度 | 圈复杂度 |
| --- | --- | ---: | ---: |
| 章节生成流水线 | `generateChapterContentInternal` | 2690 | 约 266 |
| 发布检查 | `runChapterPublishCheck` | 939 | 约 313 |
| 质量看板 | `getQualityDashboardData` | 2308 | 约 360 |
| Writing 页面 | `Writing` | 2618 | 约 345 |

仓库整体复杂度基线为 257 条告警，其中 173 条圈复杂度告警、84 条函数长度告警。

## 2. 拆分原则

### 2.1 固定原则

- 先锁定行为测试，再移动代码。
- 每个提交只迁移一个阶段、一个指标域或一个 UI 控制域。
- 编排函数只表达顺序、分支和错误边界，不直接拼大型 prompt、SQL 或 JSX。
- 数据读取集中在 loader/runtime 层，纯计算模块不接受数据库实例。
- 已有模块和类型优先复用，不复制同一套解析、评分或 gate 语义。
- 第一轮拆分不修改数据库 schema，不引入新的 IPC 方法。
- 第一轮拆分不顺带重命名用户可见文案、任务类型、状态值和 JSON 字段。

### 2.2 复杂度目标

每一阶段完成后满足：

- 单函数不超过 250 行；
- 圈复杂度不超过 25；
- façade 不直接执行大段 SQL、prompt 拼装或 JSX 分支；
- 新模块公开接口数量保持最小；
- `npm run audit:complexity` 的总告警数只能下降，不能高于当前 257 条基线。

最终目标不是一次性运行严格模式归零，而是让四个目标函数退出复杂度榜首，并为后续持续归零建立稳定边界。

## 3. 当前依赖图

```text
Writing/index.tsx
  -> window.electron.chapter.generateContent/resumeContent/cancel
  -> window.electron.chapter.runPublishCheck
  -> window.electron.quality.getDashboard
  -> window.electron.chapter.update/list/get/listVersions/restoreVersion
  -> timeline/item/thread/foreshadow/storyFact/structure RPC

chapter.service.ts
  generateChapterContentInternal
    -> context collection/budget/runtime resolution
    -> task + workflow node + lease + snapshot
    -> Planner
    -> Writer
    -> Critic + semantic gate
    -> Enforcer/guardrails
    -> Rewriter/repair loop
    -> runChapterPublishCheck
    -> Canonizer
    -> Finalize/writeback/memory refresh

context-impact.service.ts
  runChapterPublishCheck
    -> chapter/novel/contracts/review/recall/thread/volume/arc reads
    -> dialogue/narrative/contract analysis
    -> getQualityDashboardData
       -> storyPacingAlerts
    -> checklist/score/rewrite plan
    -> revision task synchronization
    -> gate run persistence

quality-dashboard.service.ts
  getQualityDashboardData
    -> novel/chapter/volume/gate/task/writeback/checkpoint reads
    -> dialogue/story arc/foreshadow/endgame/world state/recall snapshots
    -> chapter metrics
    -> volume metrics
    -> repair risks/actions
    -> production readiness
    -> million-word runtime observability
    -> agent quality artifacts
```

### 3.1 当前最需要消除的依赖

`runChapterPublishCheck -> getQualityDashboardData -> 全书质量聚合` 是错误的依赖方向。

发布检查只使用当前章节对应的 `storyPacingAlerts`，却触发整个质量看板的全书读取和聚合。目标结构中，发布检查与质量看板共同消费独立的故事动态读模型；质量看板不得成为发布检查的证据来源。

## 4. 目标依赖图

```text
chapter-pipeline-orchestrator
  -> chapter-pipeline-runtime
  -> chapter-pipeline-context
  -> chapter-pipeline-planner
  -> chapter-pipeline-writer
  -> chapter-pipeline-review
  -> chapter-pipeline-rewriter
  -> chapter-publish-check façade
  -> chapter-pipeline-finalize

chapter-publish-check façade
  -> chapter-publish-evidence
  -> chapter-publish-contract-gate
  -> chapter-publish-quality-gates
  -> chapter-publish-score
  -> chapter-publish-rewrite-plan
  -> chapter-publish-persistence

quality-dashboard façade
  -> quality-dashboard-loader
  -> chapter/volume/language/repair/runtime derive modules
  -> quality-dashboard-assembler
  -> QualityDashboardData

Writing
  -> useWritingRouteState
  -> useWritingWorkspaceData
  -> useChapterEditor
  -> useChapterGeneration
  -> useChapterReview
  -> useChapterWriteback
  -> route components + editor/command/status/inspector components
```

## 5. 阶段一：章节生成流水线

### 5.1 保留的 façade

`generateChapterContentInternal` 保留在 `chapter.service.ts`，最终只负责：

1. 读取入口章节并校验输入指纹；
2. 创建运行时和准备上下文；
3. 按重试计划调用各阶段；
4. 在阶段边界更新运行状态；
5. 统一处理取消、失败、保稿和最终返回。

目标长度：150-220 行。

### 5.2 新模块

| 文件 | 职责 |
| --- | --- |
| `electron/services/chapter-pipeline-runtime.ts` | root/child task、workflow node、lease、snapshot、进度事件、失败/成功状态、滚动正文与上下文 checkpoint |
| `electron/services/chapter-pipeline-context.ts` | 一次性准备小说、章节、上下文预算、合同、节奏、叙事控制、模型路由和阶段上下文 |
| `electron/services/chapter-pipeline-planner.ts` | Planner prompt、场景计划解析、合同对齐、场景设计字段写回和 Planner 产物 |
| `electron/services/chapter-pipeline-writer.ts` | Writer prompt、断点稿处理、标题噪声处理、正文完整性校验和初稿 checkpoint |
| `electron/services/chapter-pipeline-review.ts` | Critic、语义门、Enforcer、审校结构化解析和审校证据归一化 |
| `electron/services/chapter-pipeline-rewriter.ts` | 修复循环、差异门、guardrail、候选稿选择、发布门定向修复和最终候选稿 |
| `electron/services/chapter-pipeline-finalize.ts` | 发布门通过后的 Canonizer、Finalize、摘要/记忆刷新、最终任务完成和异步派生刷新 |

继续复用：

- `chapter-pipeline-state.ts`
- workflow node/lease 服务
- `chapter-repair-loop.ts`
- `chapter-scene-plan.ts`
- `chapter-writeback.service.ts`
- context recall/runtime/planner/token budget 模块

### 5.3 接口草案

```ts
export interface ChapterPipelineRequest {
  chapterId: number
  sender?: WebContents
  options: ChapterGenerationOptions
  idempotencyKey?: string
}

export interface PreparedChapterPipelineInput {
  chapter: ChapterRow
  novel: NovelRow
  rawContext: ChapterContextRawData
  complexity: ChapterComplexity
  executionMode: AiExecutionMode
  initialInputFingerprint: string
  previousStatus: string
  narrative: {
    themeVoice: ThemeVoiceDocument
    sceneSnapshots: NarrativeSceneSnapshot[]
    characterNames: string[]
    contractSignals: NarrativeContractSignals
  }
  routes: {
    planner: AiStageRoute
    writer: AiStageRoute
    critic: AiStageRoute
  }
}

export interface ChapterPipelineRuntime {
  readonly workflowTaskId: number
  readonly chapterId: number
  readonly snapshot: ChapterPipelineSnapshot
  shouldRun(role: ChapterPipelineRole): boolean
  assertActive(): void
  startRole(input: StartPipelineRoleInput): Promise<number>
  finishRole(input: FinishPipelineRoleInput): void
  failRole(input: FailPipelineRoleInput): never
  checkpointContent(input: ChapterContentCheckpointInput): void
  checkpointContext(contextVersion: number): void
  sync(extra?: Partial<TaskInsert>): void
  complete(outputText: string): void
}

export interface PlannerStageOutput {
  scenePlan: ScenePlanStep[]
  scenePlanText: string
  contractVersion: string
  sceneDesignFieldGaps: string[]
  stepMemory: ChapterPipelineStepMemory
  taskId?: number
}

export interface WriterStageOutput {
  content: string
  titleMismatchRisk: string
  lockedParagraphContext: LockedParagraphContext
  stepMemory: ChapterPipelineStepMemory
  taskId?: number
}

export interface ReviewStageOutput {
  reviewNotes: ChapterReviewNotes
  semanticReview: SemanticGateReview | null
  semanticGateMode: SemanticGateMode
  semanticCallsUsed: number
  guardrailKnownTerms: string[]
  taskId?: number
}

export interface RewriterStageOutput {
  content: string
  reviewNotes: ChapterReviewNotes
  publishCheck: ChapterPublishCheck
  rewriteAttemptCount: number
  taskId?: number
}

export interface FinalizeStageOutput {
  chapterId: number
  canonRunId: number
  contextVersion: number
  outputText: string
}
```

接口要求：

- 阶段输出只携带后续阶段需要的稳定产物，不暴露阶段内部局部变量。
- runtime 独占 task、lease、snapshot 和恢复语义，阶段模块不得直接复制状态转换。
- prompt builder 仍使用现有函数，第一轮只移动调用和参数装配，不改 prompt 文本。
- 正文写入继续通过现有 CAS 路径，禁止阶段模块直接执行无条件 `update chapters`。

### 5.4 必须保持的行为

- task 类型、父子关系、`pipelineRole`、`pipelineStage` 不变；
- `ChapterPipelineSnapshot` JSON 契约不变；
- 精确节点重试计划不变；
- `contextVersion` 检查点语义不变；
- Writer 流式失败可续写；
- Critic/Rewriter/Canonizer/Finalize 失败只恢复最近完整稿，不保留半截流；
- 外部正文或上下文变化继续失败关闭；
- 发布门失败不得进入 Canonizer 或 Finalize；
- Canon 草案存在才允许 Finalize；
- 最终正文、摘要、连续性和记忆刷新顺序不变。

### 5.5 迁移批次

1. 提取 runtime，主函数仍调用原有内联阶段。
2. 提取上下文准备，保持所有字段和 prompt 参数原值。
3. 提取 Planner。
4. 提取 Writer。
5. 提取 Critic、语义门和 Enforcer。
6. 提取 Rewriter、差异门和发布门修复循环。
7. 提取 Canonizer/Finalize。
8. 收缩 façade，删除迁移后无引用的局部 helper。

每批提交都必须可以单独回滚，不允许跨批次同时改变 snapshot schema。

## 6. 阶段二：发布检查

### 6.1 保留的 façade

`runChapterPublishCheck(chapterId, options)` 保持签名和返回类型不变，最终只负责：

1. 加载并冻结证据；
2. 计算合同门和质量门；
3. 应用 pipeline/final phase 策略；
4. 生成 rewrite plan、分数和最终 gate level；
5. 同步修订任务并持久化 gate run；
6. 返回 `ChapterPublishCheck`。

目标长度：100-180 行。

### 6.2 新模块

| 文件 | 职责 |
| --- | --- |
| `electron/services/chapter-publish-evidence.ts` | 只读加载章节、小说、合同、审校、召回、线程、卷、弧线、叙事控制和故事动态证据 |
| `electron/services/chapter-publish-contract-gate.ts` | 合同审计、硬合同验证、合同 gate item |
| `electron/services/chapter-publish-quality-gates.ts` | 正文、上下文、语义、对白、POV、节奏、召回、线程、卷目标等 gate item |
| `electron/services/chapter-publish-score.ts` | blocker/warning/rewrite 计数、gate level、score breakdown、summary、top issue keys |
| `electron/services/chapter-publish-rewrite-plan.ts` | rewrite scope、目标场景、保留项和 rewrite plan |
| `electron/services/chapter-publish-persistence.ts` | contract audit 缓存、revision task 同步、gate run/history/drift 持久化 |
| `electron/services/story-dynamics-read-model.ts` | 发布检查与质量看板共享的故事动态证据读取，不依赖完整质量看板 |

### 6.3 接口草案

```ts
export interface ChapterPublishCheckOptions {
  phase?: 'pipeline' | 'final'
  semanticGateMode?: SemanticGateMode
}

export interface ChapterPublishEvidence {
  chapter: ChapterRow
  novel: NovelRow
  phase: 'pipeline' | 'final'
  semanticGate: SemanticGateEvidence
  staleReasons: string[]
  consistencyIssues: ConsistencyIssue[]
  aiScore?: number
  reviewState: ChapterPublishReviewState
  recall: ChapterRecallPublishEvidence
  contracts: ChapterContractPublishEvidence
  narrative: ChapterNarrativePublishEvidence
  storyDynamicsAlerts: StoryDynamicsAlert[]
  threads: ChapterThreadPublishEvidence
  volume: ChapterVolumePublishEvidence
  arcWarnings: string[]
}

export interface ChapterPublishEvaluation {
  checklist: ChapterPublishCheckItem[]
  contractAudit: ChapterContractAudit
  contractValidation?: ChapterContractValidationResult
  rewritePlan?: RewritePlan
  rewriteTarget?: ChapterRewriteTarget
  gateLevel: ChapterGateLevel
  ready: boolean
  blockerCount: number
  warningCount: number
  rewriteCount: number
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  summary: string
  topIssueKeys: string[]
}

export function loadChapterPublishEvidence(
  chapterId: number,
  options?: ChapterPublishCheckOptions,
): ChapterPublishEvidence

export function evaluateChapterPublishEvidence(
  evidence: Readonly<ChapterPublishEvidence>,
): ChapterPublishEvaluation

export function persistChapterPublishEvaluation(
  evidence: Readonly<ChapterPublishEvidence>,
  evaluation: Readonly<ChapterPublishEvaluation>,
): ChapterPublishPersistenceResult
```

### 6.4 依赖修正

删除：

```text
runChapterPublishCheck
  -> getQualityDashboardData
  -> storyPacingAlerts
```

改为：

```text
runChapterPublishCheck
  -> story-dynamics-read-model
  -> 当前章节 storyPacingAlerts

getQualityDashboardData
  -> story-dynamics-read-model
  -> 全书/分卷 story dynamics snapshot
```

发布检查不得读取完整 `QualityDashboardData`。

### 6.5 副作用顺序

第一轮拆分保持当前可观察顺序：

1. 合同审计 JSON 缓存更新；
2. gate 计算；
3. revision task 同步；
4. gate run/history/drift 持久化；
5. 返回结果。

后续如需把所有写入合并为事务，应作为独立行为变更处理，不混入本轮结构重构。

### 6.6 必须保持的行为

- `phase='pipeline'` 对 summary、continuity、context 和重写前审校证据的降级规则不变；
- `phase='final'` 保持完整阻断规则；
- semantic gate `off/shadow/enforce` 和 heuristic fallback 行为不变；
- 启发式门接管后缀、gate key、中文文案和 related page 不变；
- revision task 去重身份、严重级别和 taskId 回填不变；
- gate level 优先级保持 `rewrite/blocker/warning/pass` 的现有判定；
- score breakdown、history、drift 和 top issue keys 格式不变。

### 6.7 迁移批次

1. 导出并集中 publish 类型，不改实现。
2. 提取故事动态读模型，先替换质量看板内部调用，再移除发布检查对看板的依赖。
3. 提取 evidence loader。
4. 按合同、基础完整性、审校、叙事控制、推进/卷目标分组提取纯 gate builders。
5. 提取 rewrite plan 和 scoring。
6. 提取 persistence，收缩 façade。

## 7. 阶段三：质量看板

### 7.1 保留的 façade

`getQualityDashboardData(novelId, options)` 保持签名和返回类型不变，最终只负责：

```text
load snapshot -> derive metric domains -> assemble QualityDashboardData
```

目标长度：80-150 行。

### 7.2 新模块

| 文件 | 职责 |
| --- | --- |
| `electron/services/quality-dashboard-loader.ts` | 批量 SQL、基础 row catalog、外部快照加载和查询去重 |
| `electron/services/quality-dashboard-chapter-metrics.ts` | 章节评分、gate、风格、对白、召回和章节详情 |
| `electron/services/quality-dashboard-volume-metrics.ts` | 分卷语言、节奏、功能、弧线、伏笔、终局和世界状态聚合 |
| `electron/services/quality-dashboard-language.ts` | AI 分数、语言漂移、表达复用、摘要健康和钩子连续性 |
| `electron/services/quality-dashboard-production-readiness.ts` | batch health、continuity、contract delivery、batch review 和生产就绪度 |
| `electron/services/quality-dashboard-repair-metrics.ts` | repair risks、repair actions、risk overview 和 action summary |
| `electron/services/quality-dashboard-runtime.ts` | operating mode、百万字运行压力、checkpoint、writeback 和 guardrail 观测 |
| `electron/services/quality-dashboard-agent-artifacts.ts` | agent quality artifacts 与对比记录 |
| `electron/services/quality-dashboard-assembler.ts` | 组装最终 `QualityDashboardData`，不得查询数据库 |

继续复用：

- `quality-dashboard-recall-diagnostics.ts`
- `quality-dashboard-story-dynamics.ts`
- `quality-dashboard-chapter-functions.ts`
- `chapter-gate-utils.ts`

### 7.3 接口草案

```ts
export interface QualityDashboardSnapshot {
  novelId: number
  options: Required<QualityDashboardOptions>
  meta: QualityNovelMeta
  chapters: QualityChapterRow[]
  volumes: QualityVolumeRow[]
  gateHistoryByChapterId: ReadonlyMap<number, ChapterGateHistoryEntry[]>
  revisions: RevisionTaskRow[]
  writebacks: ChapterWritebackRunRow[]
  checkpoints: StoryMemoryCheckpointRow[]
  batch: QualityBatchSnapshot
  dialogue: DialogueAnalyticsSnapshot
  storyDynamics: StoryDynamicsSnapshot
  storyArc: StoryArcProgressSnapshot
  foreshadow: ForeshadowSnapshot
  endgame: EndgameDebtSnapshot
  worldState: WorldStateLedgerSnapshot
  recallRuntimeByChapterId: ReadonlyMap<number, ChapterRecallRuntime>
  antiAi: AntiAiDashboardSummary
  feedback: FeedbackRecurrenceDashboardSummary
  typedRefs: TypedRefObservability
  structuredMemory: StructuredMemoryObservability
  agentArtifacts: QualityAgentDashboardSnapshot
}

export interface QualityDashboardDerivedMetrics {
  chapter: ChapterQualityMetrics
  volume: VolumeQualityMetricsSnapshot
  language: LanguageQualityMetrics
  production: ProductionReadinessMetrics
  repair: QualityRepairMetricsSnapshot
  runtime: QualityRuntimeMetrics
}

export function loadQualityDashboardSnapshot(
  novelId: number,
  options?: QualityDashboardOptions,
): QualityDashboardSnapshot

export function assembleQualityDashboardData(
  snapshot: Readonly<QualityDashboardSnapshot>,
  metrics: Readonly<QualityDashboardDerivedMetrics>,
): QualityDashboardData
```

### 7.4 数据读取规则

- loader 负责所有数据库读取和服务级 snapshot 调用。
- derive 模块不得调用 `getDb()`。
- derive 模块不得再次按章节或分卷查询数据。
- 章节、卷、gate history、revision task、writeback、checkpoint 必须批量读取。
- 看板只消费已有 `chapterGateRuns` 历史，不得为展示重新运行发布检查。
- `includeDialogueInsights=false` 时不得调度对白指纹刷新。
- 需要异步预计算的能力只返回现有状态，不在纯计算模块中触发后台任务。

### 7.5 迁移批次

1. 提取 loader，但暂时返回原函数当前需要的全部数据。
2. 提取 chapter metrics。
3. 提取 language metrics。
4. 提取 volume metrics。
5. 提取 production readiness 和 runtime observability。
6. 提取 repair metrics/actions。
7. 提取 agent artifacts。
8. 添加 assembler，收缩 façade。

## 8. 阶段四：Writing 页面

### 8.1 目标组件结构

```text
Writing/index.tsx
  -> useWritingRouteState
  -> useWritingWorkspaceData
  -> useChapterEditor
  -> useChapterGeneration
  -> useChapterReview
  -> useChapterWriteback
  -> WritingWorkspaceLayout
       -> ChapterNavigator
       -> WritingCommandBar
       -> WritingEditorPane
       -> WritingStatusBar
       -> WritingInspector
            -> EditorRoute
            -> ContextRoute
            -> ReviewRoute
            -> HistoryRoute
```

`Writing/index.tsx` 最终只组合 hooks、命令对象和布局，目标长度 150-220 行。

### 8.2 Hooks

| Hook | 状态与命令所有权 |
| --- | --- |
| `useWritingRouteState.ts` | `chapterId`、`stageId`、active route、路由预加载和导航 |
| `useWritingWorkspaceData.ts` | 章节列表、当前章节、章节选择和 request race guards |
| `useWritingWorkspaceRefreshController.ts` | workspace metadata、上下文/质量快照、章节关联资产、空工作区与章节加载刷新编排 |
| `useChapterEditor.ts` | contentEditable ref、正文、字数、选区和 bounded undo/redo history |
| `useWritingEditorLifecycle.ts` | 编辑器输入、自动/立即保存、快捷键、保存注册和卸载 flush；`writing-editor-lifecycle.ts` 固定持久化副作用顺序 |
| `useWritingHistoryLifecycle.ts` | 版本列表请求、旧响应失效、选择回退、history route 触发和 modal/route Escape 优先级 |
| `useWritingPresentationModel.ts` | continuity/scene/review 解析、章节关联资产、insight items 与 publish sections/scores/drift/history；纯规则位于 `writing-presentation-model.ts` |
| `useWritingWorkspaceActionController.ts` | 默认 AI 模式保存、章节编译和带当前章节 guard 的 context preview 触发；副作用顺序位于 `writing-workspace-actions.ts` |
| `useWritingRuntimePresentation.ts` | live/persisted pipeline 选择、当前章节 generation、伏笔到期摘要、writeback/prompt override 与 editor advisory 派生 |
| `useChapterGeneration.ts` | 生成、恢复、重启、取消、任务订阅、live/persisted snapshot、错误恢复和生成基线 |
| `useChapterReview.ts` | AI 体检、发布检查、状态切换、局部重写、整章优化、候选应用和版本恢复 |
| `useChapterWriteback.ts` | 信息揭示约束、伏笔新增/修改/删除和工作区 mutation 通知 |
| `useWritingPipelineItems.ts` | 七角色流水线展示状态、旧快照回退和重试动作绑定 |
| `useWritingInspector.ts` | chapter/memory/review/history 四路稳定 view model 与 actions 组合 |
| `useWritingChapterController.ts` | 章节头部、可写性、生成前置检查、验收反馈和流水线元数据 |
| `useWritingContractSections.ts` | chapter/scene contract 的稳定展示 section 组合 |
| `useWritingCommandBindings.ts` | 章节导航、状态栏、命令栏及编辑器恢复/建议动作装配 |
| `useWritingChapterCrudController.ts` | 章节新增、选择、删除确认和删除前保存队列协调 |

### 8.3 组件

| 组件 | 职责 |
| --- | --- |
| `components/WritingEditorPane.tsx` | contentEditable、分段章节只读态、选区事件和正文空态 |
| `components/WritingCommandBar.tsx` | 生成、取消、恢复、审校、优化、保存、撤销/重做和状态命令 |
| `components/WritingStatusBar.tsx` | 字数、保存/生成状态、上下文版本和当前流水线阶段 |
| `components/WritingInspector.tsx` | route tabs、移动端抽屉、桌面侧栏和 route outlet |
| `components/WritingChapterHeader.tsx` | 当前章节 hero、版本/卷/字数元数据和可写性卡片 |
| `components/WritingFooter.tsx` | 流水线执行元数据和版本时间线 |
| `components/WritingModals.tsx` | 选区重写、整章优化和并行生成弹窗容器 |
| `components/WritingAcceptanceSummary.tsx` | 当前章轻量验收卡和质量问题摘要 |
| `components/WritingWorkspaceLayout.tsx` | loading、pipeline、hero、导航、编辑器、inspector 与 footer 页面结构 |
| `routes/EditorRoute.tsx` | 本章合同、场景、约束、承接与发布摘要 |
| `routes/ContextRoute.tsx` | 记忆、召回、时间轴、物品、人物、伏笔与信息差 |
| `routes/ReviewRoute.tsx` | AI 体检、审校意见、发布门、优化候选和质量风险 |
| `routes/HistoryRoute.tsx` | 版本列表、预览、恢复命令 |

现有四个 route 不再只接收 `children` 做薄包装，而是接收各自稳定 view model。

### 8.4 接口草案

```ts
export interface WritingWorkspaceController {
  route: WritingRouteController
  data: WritingWorkspaceDataController
  editor: ChapterEditorController
  generation: ChapterGenerationController
  review: ChapterReviewController
  writeback: ChapterWritebackController
}

export interface ChapterEditorController {
  editorRef: RefObject<HTMLDivElement>
  content: string
  wordCount: number
  selectedSnippet: TextSelectionSnapshot | null
  readOnly: boolean
  onInput(event: FormEvent<HTMLDivElement>): void
  syncSelection(): void
  applyContent(text: string, source?: ChapterVersionSource): void
  undo(): void
  redo(): void
  saveNow(): Promise<void>
  flush(chapterId?: number): Promise<void>
}

export interface ChapterGenerationController {
  active: WritingGenerationState
  pipelineSnapshot: WritingPipelineSnapshot | null
  resumablePartialContent: string
  canResume: boolean
  generate(): Promise<void>
  resume(): Promise<void>
  restart(): Promise<void>
  cancel(): Promise<void>
}

export interface ChapterReviewController {
  aiResult: AiCheckPayload | null
  publishCheck: ChapterPublishCheck | null
  optimizationResult: ChapterOptimizeResult | null
  runAiCheck(): Promise<void>
  runPublishCheck(): Promise<ChapterPublishCheck>
  changeStatus(status: Chapter['status']): Promise<void>
  rewriteSelection(requirements: string): Promise<void>
  optimize(requirements: string): Promise<void>
  applyOptimization(): Promise<void>
  restoreVersion(versionId: number): Promise<void>
}
```

### 8.5 竞态与保存约束

- `chapter-save-coordinator.ts` 保持单一保存协调器，不在多个 hook 中创建实例。
- 切换章节前取消定时保存并等待当前章节写入完成。
- 所有异步刷新继续使用 request id 或 `isCurrent()` 防止旧章节结果覆盖新章节。
- 流水线事件按 chapterId 和已知章节集合过滤。
- live snapshot 优先于 persisted snapshot，但必须属于当前章节。
- 生成完成后的正文是否变化继续与 generation baseline 对比。
- route 切换不得重新创建编辑器状态或丢失待保存正文。
- `final` 状态仍必须先运行发布检查，并保留 warning 二次确认。

### 8.6 迁移批次

1. 提取 publish check 展示 helper 和稳定 view model。
2. 提取 `useWritingRouteState`。
3. 提取 `useChapterEditor`，锁定保存、切章、undo/redo 和选区行为。
4. 提取 `useChapterGeneration`，锁定事件订阅、恢复和取消行为。
5. 提取 `useWritingWorkspaceData`，集中 request race guards。
6. 提取 `useChapterReview`。
7. 提取 `useChapterWriteback`。
8. 提取 editor/command/status/inspector 组件。
9. 将四个 route 改为真实内容承载组件。
10. 收缩 `Writing/index.tsx`。

## 9. 两章测试门禁

用户指定采用两章测试。本轮每个阶段至少使用同一小说下第 1、2 章的确定性夹具，不扩展为大规模真实模型测试。

### 9.1 两章夹具

第 1 章：

- 有完整大纲、合同、场景计划、正文、摘要和连续性状态；
- 固定 POV；
- 一个已推进线程；
- 一个可通过或仅 warning 的发布门结果；
- 作为第 2 章的前文承接来源。

第 2 章：

- 读取第 1 章摘要、结尾、连续性和上下文版本；
- 至少包含一个可定向定位的合同/场景问题；
- 可切换为 blocker、rewrite、recall degraded 或上下文冲突场景；
- 用于验证失败保稿、精确重试和旧请求不覆盖当前章节。

### 9.2 阶段测试矩阵

| 阶段 | 第 1 章 | 第 2 章 |
| --- | --- | --- |
| 流水线 | Planner -> Writer -> Critic -> Rewriter -> Gate -> Canonizer -> Finalize 成功 | 验证 Writer 续写、Rewriter/Finalize 失败仅恢复完整稿、contextVersion/CAS 冲突失败关闭 |
| 发布检查 | pass/warning，score/history/taskId 稳定 | blocker/rewrite，pipeline phase 降级与 final phase 阻断稳定 |
| 质量看板 | 最新 gate snapshot、章节指标、卷聚合正确 | gate drift、召回/合同/节奏风险和 repair action 定位正确 |
| Writing | 首次加载、编辑、自动保存、生成完成刷新 | 快速切章、旧请求丢弃、恢复、取消、发布确认和版本恢复 |

### 9.3 需要新增或扩展的测试

- `chapter-pipeline-runtime.test.ts`
- `chapter-pipeline-orchestrator.test.ts`
- `chapter-publish-evidence.test.ts`
- `chapter-publish-quality-gates.test.ts`
- `chapter-publish-persistence.test.ts`
- `quality-dashboard-loader.test.ts`
- `quality-dashboard-assembler.test.ts`
- `useChapterEditor.test.tsx`
- `useChapterGeneration.test.tsx`
- `Writing.test.tsx`

继续运行现有：

- `context-impact.service.test.ts`
- `chapter-pipeline-state.test.ts`
- `chapter-repair-loop.test.ts`
- `chapter-scene-plan.test.ts`
- `chapter-writeback.service.test.ts`
- `chapter-integrity.test.cjs`
- 三个现有 `quality-dashboard-*.test.ts`
- `chapter-save-coordinator.test.ts`
- `writingView.store.test.ts`
- `workspace-routing.test.cjs`

两章测试只证明拆分前后行为一致，不用于宣称百万字、100/300/500 章质量或性能已经验证。

## 10. 每批验证命令

窄范围提交：

```powershell
npx vitest run <相关测试文件>
npm run typecheck
npm run lint
npm run audit:complexity
```

阶段完成：

```powershell
npm run test:unit
npm run test:chapter-integrity
npm run test:workflow-resilience
npm run test:workspace-routing
npm run test:interface-contracts
npm run typecheck
npm run lint
npm run audit:complexity
```

四阶段全部完成后：

```powershell
npm test
npm run audit:complexity
```

`npm run audit:complexity:strict` 作为长期归零门禁，不要求在单次拆分中立即通过。

## 11. 禁止行为变化清单

本轮拆分禁止：

- 修改 Electron IPC channel、参数或返回结构；
- 修改 `ChapterPublishCheck`、`QualityDashboardData` 和流水线 snapshot 的序列化字段；
- 修改 task type、task 状态、pipeline role/stage 和恢复提示语义；
- 修改 gate key、gate 优先级、score 权重和 revision task 去重逻辑；
- 修改现有 prompt 文本、模型路由、重试次数和语义门预算；
- 修改 CAS 正文写回和 contextVersion 冲突处理；
- 修改 Writer 与后续阶段的保稿差异；
- 让发布失败路径进入 Canonizer/Finalize；
- 让质量看板重新运行发布检查；
- 让 Writing 页面因 route 切换丢失正文或重复保存；
- 在拆分提交中顺带修改 schema、索引、安装包或视觉设计。

## 12. 提交与回滚边界

建议提交顺序：

1. `refactor(pipeline): extract workflow runtime`
2. `refactor(pipeline): extract context preparation`
3. `refactor(pipeline): extract planner and writer stages`
4. `refactor(pipeline): extract review and rewrite stages`
5. `refactor(pipeline): extract finalize stage`
6. `refactor(publish): introduce immutable evidence`
7. `refactor(publish): extract gates scoring and persistence`
8. `refactor(quality): extract dashboard loader`
9. `refactor(quality): extract metric domains and assembler`
10. `refactor(writing): extract route editor and generation hooks`
11. `refactor(writing): extract review writeback and route views`

每个提交要求：

- 不依赖后续提交才能编译；
- 相关两章测试独立通过；
- 可通过单次 revert 恢复；
- 不包含无关格式化、文件移动或文案调整；
- 复杂度告警不增加。

## 13. 完成定义

四阶段全部完成时：

- 四个原始高复杂函数均低于 250 行和复杂度 25；
- 发布检查不再依赖完整质量看板；
- 质量看板只消费发布门历史，不重跑发布检查；
- 流水线 task/snapshot/CAS/恢复契约由 runtime 集中维护；
- Writing 的保存、生成、审校、回写和 route 状态由独立 hooks 管理；
- 两章行为回归测试、现有单测、smoke、typecheck、lint 全部通过；
- `npm run audit:complexity` 告警总数低于当前 257 条基线。

## 14. 实施进度（2026-08-16）

当前代码已经完成以下结构迁移：

- 章节流水线已提取 runtime、context、planner、writer、review、rewriter、finalize、session 和 observability 边界；`generateChapterContentInternal` 已退出复杂度审计榜首。
- 发布检查已提取 evidence、contract gate、quality gates、score、rewrite plan、persistence 和共享故事动态读模型；发布检查不再通过完整质量看板获取当前章节节奏证据。
- 质量看板已提取 loader、gate metrics、最终 assembler，以及 chapter/language/volume/repair/runtime 纯计算边界；语言趋势、卷级风险排序、修复摘要和运行时压力/闸门不再内联在 façade 中，production 与其余聚合上下文仍待继续迁移。
- Writing 已提取 route state、workspace data/request race guards、editor state/history、generation controller、review/optimization、publication/version 和 chapter writeback 边界；`WritingStatusBar`、`WritingCommandBar`、`WritingEditorPane`、`WritingInspector` 已完成组件化，chapter/memory/review/history 四路 inspector 也已改为基于稳定 view model 与独立 actions 的真实内容组件。后续批次又提取七角色 pipeline item 纯派生模型、inspector 组合 hook、章节头部/可写性/生成前置检查控制器、验收与流水线元数据模型，以及独立 `WritingChapterHeader`。chapter/scene contract 投影、章节导航/编辑器命令绑定、footer、modal、轻量验收反馈和 `WritingWorkspaceLayout` 也已完成收口，章节 CRUD 交给独立 controller。workspace refresh/editor/history lifecycle、continuity/publish presentation、默认 AI 模式保存、章节编译、context preview trigger，以及 live/persisted pipeline、伏笔到期和 editor advisory 均已完成。本批进一步把 writeback/due foreshadow/readiness/preflight 前移到 generation hook 之前，`useChapterGeneration` 改为直接消费同轮派生值，彻底移除 render 期间写 ref 的 bridge；review/gate/rewrite/optimization/modal 状态进入独立 controller，inspector 四域与 layout/editor/footer/modal props 进入独立 composition 边界。原有 IPC→刷新顺序、章节 guard、角色顺序、gate 自动展开和提示计数规则保持不变。

本轮验证证据：

- `npm run test:unit`：166 个测试文件、972 项通过；其中新增 chapter/language/volume/repair/runtime 五个质量指标域的 13 项确定性测试、inspector/pipeline/contract/CRUD/editor/history/presentation 回归、默认 AI 模式与编译顺序的 2 项、pipeline/generation/伏笔/advisory runtime presentation 的 5 项，以及 review gate reducer 的 3 项测试；
- `npm run typecheck`、`npm run lint` 通过；
- `npm run test:smoke` 完整复跑全链通过，覆盖 prompt guardrails、workflow resilience、workspace/interface/layout 契约、章节完整性、写回幂等、Web RPC、MCP、迁移与 agent workflow；首次运行曾在写回幂等用例出现一次 `failed`/`applied` 瞬态差异，单项复跑及完整复跑均通过，本批未修改 Electron 写回链路；
- `npm run audit:complexity`：245 条告警（165 条圈复杂度、80 条函数长度），低于 257 条基线；
- `Writing` 文件从本轮开始时的 1931 行下降到 646 行（本批总起点约 2203 行），主函数有效行降至 563；四路 inspector 批次先从 1818 行、复杂度 302 降到 1472 行、复杂度 101，后续已将复杂度降到审计阈值 25 以下。contract/command/modal/footer 批次降至 1111 行，acceptance/layout/CRUD 降至 1060 行，workspace refresh/editor lifecycle 降至 826 行，history/presentation 降至 696 行，workspace actions/runtime presentation 降至 651 行，本批 readiness/review/view composition 在增加显式依赖分层的同时继续净减 5 行；新文件均无长度或复杂度告警，主函数仍仅剩函数长度告警。`quality-dashboard.service.ts` 已下降到 3876 行，仍是待持续收缩的 façade。

下一批固定顺序：

1. 收口 Writing metadata/context/assets 状态簇与 workspace refresh 输入装配，减少主函数剩余的 setter plumbing；
2. 合并 generation/review/writeback command orchestration 的依赖装配，让主函数进一步接近纯页面组合层；
3. 继续迁移 quality production、continuity、batch 和 language artifacts 聚合域，并压低剩余 façade 复杂度；
4. 补齐 workspace refresh、publish persistence、quality assembler 和 Writing 运行态组件测试；
5. 完成两章 Writing 交互矩阵后，再以完整 `npm test`、真实已填充页面验收和复杂度审计收口四阶段目标。

上述证据只证明静态、单元和确定性 Electron 测试路径；真实模型生成、已填充 Writing 页面浏览器交互和人工发布确认仍未在本轮验证。
