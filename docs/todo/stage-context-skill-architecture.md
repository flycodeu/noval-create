# Stage Context / Skill Architecture 设计

## 1. 目标

本文把 NovelForge 现有的上下文组装能力，收敛成一套可以持续演进的统一架构，用来解决以下问题：

- 不再把人物、关系、世界、线程、记忆一次性全塞进 Prompt。
- 让不同阶段只拿自己真正需要的上下文。
- 把“人物 A 需要出现”与“人物 A 为什么这么做、和谁有关、过去发生过什么”拆成不同粒度的可调用能力。
- 让上下文装配变成可观测、可限流、可回退、可评审的工程系统，而不是靠超长 Prompt 硬压。
- 保持与现有 `allocator / hard constraints / preview / workflow pipeline` 兼容。

结论先行：

- 不建议一上来做外部 MCP server。
- 先在仓库内部落一条 `resolveStageContext(stage, ...) -> signals -> association -> packs -> renderer -> allocator` 主链路。
- `review / rewrite` 接入时必须先有独立 `resolveStageContext(stage, ...)` 入口，不能继续复用 legacy `rawContext` 主路径。
- `tool registry + skill profile` 只在 `ContextIntentGraph / ContextAssociationRule / StagePackMeta / StageRenderSchema` contract 稳定后再抽象。
- `writer-only orchestrator` 作为 Phase 0 保留，并升级为通用架构的第一条已验证链路。

## 2. 现状判断

仓库已经具备三块关键基础：

1. `electron/services/context.service.ts`
   - 已有统一的 `collectChapterContextRawData(...)` 与 `allocateChapterContext(...)`。
   - 已支持 `scenePlan / draft / review / rewrite` 四阶段的预算分配与硬约束注入。

2. `electron/services/chapter.service.ts`
   - 已有完整章节流水线：`planner -> writer -> critic -> rewriter -> canonizer -> finalize`。
   - `chapter:getContextPreview` 已经能展示阶段上下文与 explainability。

3. `electron/services/writer-context-orchestrator.service.ts`
   - 已验证 `draft/writer` 阶段“先按需取结构化 pack，再回填 allocator”的路径。
   - 已具备 `queryPlan / toolCalls / fallbackEvents / retrievalFingerprint / renderedContextOverrides`。

因此当前问题不是“从零做上下文系统”，而是：

- writer 已经局部工具化，但 `scenePlan / review / rewrite` 仍偏全量堆叠。
- `review / rewrite` 还没有独立 stage resolver 入口，仍容易滑回 legacy `rawContext` 主路径。
- 工具还是 writer 私有 bucket，但比起先抽象 registry，更缺的是跨阶段统一 contract。
- “人物最小包 / 深度包 / 关系包 / 风险包 / 修复差量包”尚未正式分层。
- 缺少一套显式的“关联配置”，决定什么时候只取最小信息，什么时候做深挖。
- 缺少统一的 `upstream / runtime artifacts` 输入合同，导致 `review / rewrite` 仍容易靠临时摘要或 rawContext 兜底。
- 当前 allocator 候选字段更偏 `draft` 叙述素材，尚不足以承载 `risk / proof / delta`。
- `review` 所需信号尚未统一，缺 `draft` 文本摘要、`scene plan` 摘要、合同版本摘要、`publish-gate` 风险等标准输入。

## 3. 设计原则

### 3.1 阶段隔离，而不是超级大 Prompt

四个阶段目标不同，不能共用同一种上下文策略：

- `scenePlan`：决定本章场景拆解、推进顺序、场景职责。
- `draft`：服务正文生成，强调人物当前状态、关系压力、世界限制、近期记忆。
- `review`：服务审校，强调证据、风险、合同兑现、风格问题。
- `rewrite`：服务最小必要修复，强调 delta，不重复灌入 draft 全量信息。

### 3.2 Preview / Runtime 必须同源

只要一个阶段接入新架构，必须满足：

- preview 与 runtime 共用同一 resolver
- 共用同一 planner
- 共用同一 tool registry
- 共用同一 renderer
- 共用同一 fallback policy

### 3.3 Review / Rewrite 先有独立入口，再谈 pack

`review / rewrite` 的主执行路径必须先统一到 `resolveStageContext(stage, ...)`：

- `chapter.service.ts` 不允许继续直接拼 legacy `rawContext`，再把结果冒充新架构输入。
- `review / rewrite` 没接入 resolver 之前，不视为“已接入 stage context architecture”。
- legacy `collectChapterContextRawData(...)` 只能作为 resolver 内部最后一级 fallback，并必须显式写 trace。

### 3.4 保留 allocator，但先补 stage render contract

新系统只负责：

- 决定查什么
- 查回哪些结构化包
- 渲染成哪些候选上下文字段

最终仍由现有 `allocateChapterContext(...)` 决定：

- 硬约束保留
- 预算裁剪
- 截断顺序
- 注入顺序

但当前 allocator 常用字段主要承载 `draft` 类叙述素材，不能直接无损表达 `review / rewrite` 的 `risk / proof / delta`。因此在接 `review / rewrite` 之前，必须二选一：

- 先补一层 `stage-specific render schema`
- 或最小新增能表达阶段语义的 allocator 字段，如 `draftTextSummary / scenePlanSummary / contractVersionSummary / reviewRiskSummary / reviewProofSummary / rewriteDeltaSummary / publishGateRiskSummary`

### 3.5 先结构化，后文本化

所有工具先产出结构化包，再由 renderer 转成阶段文本。这样做有四个收益：

- 与现有 allocator 兼容
- preview 可解释
- 后续切外部 MCP transport 不用重写 contract
- 能区分“最小信息包”和“深度解释包”

### 3.6 关联必须显式，不靠模型自己脑补扩散

上下文扩张必须来自明确规则，而不是“模型可能想知道更多”：

- 章节合同引用
- 场景计划引用
- typed refs
- 线程/伏笔/时间线关联
- 人物关系图
- 物品归属
- 近期状态变更

任何二跳、三跳扩张都要有原因、预算和上限。

## 4. 核心概念

## 4.1 Tool

Tool 是最小执行单元，行为接近 MCP tool，但先做仓库内实现。

建议命名：

- `chapter.get_minimal_baseline`
- `character.get_stub_pack`
- `character.get_state_pack`
- `character.get_deep_pack`
- `relationship.get_pack`
- `item.get_pack`
- `thread.get_pack`
- `timeline.get_pack`
- `world_state.get_pack`
- `memory.get_checkpoint_pack`
- `recall.search_fragments`
- `review.get_risk_pack`
- `rewrite.get_delta_pack`

区别要点：

- `minimal_baseline`：只承载章节目标、合同、arc 骨架和必要硬约束，不再作为“把所有缺的信息都兜回去”的大口袋。
- `stub_pack`：极小包，只够“让角色出现得像本人”。
- `state_pack`：当前处境与本章相关动作约束。
- `deep_pack`：动机、矛盾、关系压力、历史因果。
- `risk_pack`：给 critic 的证据和风险摘要。
- `delta_pack`：给 rewriter 的最小修复差量。

## 4.2 Skill

Skill 不是另一个大模型代理，而是围绕某类任务的一组工具与规则。

建议把 skill 定义成：

- 工具集合
- 扩张规则
- 渲染模板
- 预算规则
- fallback 策略

示例：

- `character_presence_skill`
  - `character.get_stub_pack`
  - `relationship.get_pack`
  - `dialogue voice lock`

- `character_motivation_skill`
  - `character.get_state_pack`
  - `character.get_deep_pack`
  - `relationship.get_pack`
  - `timeline.get_pack`

- `scene_planning_skill`
  - `chapter.get_minimal_baseline`
  - `thread.get_pack`
  - `timeline.get_pack`
  - `world_state.get_pack`

- `review_verification_skill`
  - `review.get_risk_pack`
  - `timeline.get_pack`
  - `thread.get_pack`
  - `world_state.get_pack`

## 4.3 Stage Definition

每个阶段不直接点工具，而是先定义阶段画像。

```ts
type ChapterContextStage = 'scenePlan' | 'draft' | 'review' | 'rewrite'

interface StageDefinition {
  stage: ChapterContextStage
  objective: string
  allowedSkills: string[]
  allowedTools: string[]
  requiredSignals: string[]
  requiredUpstreamArtifacts?: Array<keyof UpstreamRuntimeArtifacts>
  renderTargets: string[]
  baselineFieldContract: string[]
  fallbackMode: 'strict' | 'conservative' | 'legacy'
  expansionPolicy: {
    maxDepth: number
    maxEntities: number
    maxRelationsPerEntity: number
    allowRecall: boolean
  }
}
```

## 4.4 Context Association Rule

这是本设计里最关键的新增概念，对应你说的“有一条关联的配置，可以快速进行上下文关联”。

它的作用是把“章节信号”映射成“应该拿哪些包、拿到什么深度、是否允许扩张”。

```ts
type ContextGranularity = 'stub' | 'state' | 'deep' | 'proof'

interface ContextAssociationRule {
  id: string
  sourceType:
    | 'chapter_contract'
    | 'scene_plan'
    | 'typed_ref'
    | 'thread'
    | 'timeline'
    | 'world_state'
    | 'manual_pin'
  targetDomain:
    | 'character'
    | 'relationship'
    | 'item'
    | 'thread'
    | 'timeline'
    | 'world_state'
    | 'memory'
  matchMode: 'direct_ref' | 'typed_ref' | 'name_match' | 'semantic_hint'
  defaultGranularity: ContextGranularity
  firstHopAllowed: boolean
  escalationPolicy: {
    whenStage: ChapterContextStage[]
    whenFieldsPresent: string[]
    maxDepth: number
  }
  renderPriority: number
}
```

### 人物 A 示例

以“正文里只需要 A 人物出现”为例：

1. 若 `scenePlan.present_characters` 或 `chapter_contract.required_asset_refs` 命中 A
   - 先取 `character.get_stub_pack(A)`
   - 只给出：
     - 姓名
     - 角色定位
     - 1 到 3 个性格/话语标签
     - 当前短期目标
     - 本章禁忌或对白锁

2. 若场景里还要求“人物 A 必须做出选择 / 背叛 / 牺牲 / 犹豫”
   - 升级取 `character.get_state_pack(A)`
   - 增补：
     - 当前处境
     - 最近变化
     - 和本章目标直接冲突的因素

3. 若要解释“为什么这样做”
   - 再取 `character.get_deep_pack(A)` + `relationship.get_pack(A, related)`
   - 增补：
     - 深层动机
     - 核心恐惧
     - 关系张力
     - 导致此选择的近期事件

这样就不会把 A 的全部背景、全部关系、全部历史无差别塞进去。

额外约束：

- `semantic_hint` 不能作为首跳选取条件，只能作为已命中实体后的升级条件。
- 首跳选取应优先收敛到 `entity id / typed ref / source anchor`。
- 若首跳只能模糊命中名字，则默认不允许直接进入 `deep / proof`。

## 4.5 Pack Granularity

建议把实体包显式做成四层：

### Layer 0: Stub Pack

适用于“需要出现，但不需要解释全部动机”。

- name
- role
- voice hints
- 2 到 4 个性格标签
- current short goal
- do-not-break rules

### Layer 1: State Pack

适用于“需要执行动作并保持承接”。

- stub pack 全部信息
- latest state summary
- recent change
- current pressure
- immediate relationship tension
- allowed / forbidden action hints

### Layer 2: Deep Pack

适用于“需要解释因果、动机、心理矛盾”。

- state pack 全部信息
- deep need
- misbelief
- contradiction
- past trigger
- moral line
- unresolved promise or wound

### Layer 3: Proof Pack

适用于 review / rewrite，避免 critic 空泛化。

- deep pack 摘要
- source chapter refs
- relevant scene refs
- related contract refs
- evidence snippets

## 5. 总体架构

推荐统一成下面这条链路：

`resolveStageContext(stage, ...) -> Upstream/Runtime Artifacts -> Signal Builder -> Association Resolver + Relevance Firewall -> Query Planner -> Tool Registry -> Structured Packs -> Stage Renderer -> Existing Allocator`

## 5.1 Upstream / Runtime Artifacts 输入合同

在进入 `Signal Builder` 之前，先统一上游阶段与 runtime 能提供什么 artifact；否则 `review / rewrite` 仍会退回“先拿 rawContext 再临时拼摘要”的旧路径。

```ts
interface UpstreamRuntimeArtifacts {
  scenePlanSummary?: string
  scenePlanVersion?: string
  draftTextSummary?: string
  draftTextVersion?: string
  contractVersionSummary?: string
  publishGateRisks: string[]
  reviewNotesSummary?: string
  runtimeAssertions?: string[]
}
```

硬要求：

- `review / rewrite` 进 resolver 前，必须先补齐 `scenePlanSummary / draftTextSummary / contractVersionSummary / publishGateRisks`
- runtime 侧只传摘要、版本和 assertions，不直接把整段 legacy `rawContext` 当 artifact 透传

## 5.2 Signal Builder

从现有系统抽信号，不重新发明数据源。

主要输入来自：

- `chapters.outline`
- `chapters.scenePlanJson`
- `chapters.reviewNotesJson`
- `chapter_contracts.requiredAssetRefsJson`
- `scene_contracts`
- `story_threads`
- `timeline_events`
- `world_state_versions`
- `typed refs`
- `dialogue voice locks`
- `anti AI rules`
- `feedback recurrence`

建议输出：

```ts
interface StageSignalBundle {
  novelId: number
  chapterId: number
  chapterNum: number
  stage: ChapterContextStage
  chapterGoal: string
  currentArc: string
  upstreamArtifacts: UpstreamRuntimeArtifacts
  sceneSignals: {
    presentCharacters: string[]
    keyItems: string[]
    locations: string[]
    mustCover: string[]
  }
  contractSignals: {
    requiredAssetRefs: string[]
    forbiddenActions: string[]
    requiredForeshadows: string[]
  }
  reviewSignals?: {
    criticalFixes: string[]
    coherenceRisks: string[]
    languageRisks: string[]
    publishGateRisks: string[]
    requiredProofTargets: string[]
  }
}
```

对 `review / rewrite` 有两个硬要求：

- 进入 resolver 前，必须先补齐 `upstreamArtifacts.scenePlanSummary / draftTextSummary / contractVersionSummary`。
- `publishGateRisks` 必须作为统一风险源进入 `upstreamArtifacts` 与 `reviewSignals`，不能散落在后处理逻辑里。

## 5.3 Association Resolver + Relevance Firewall

Association Resolver 是整套系统的真正中枢。

职责：

- 读取 `StageSignalBundle`
- 应用 `ContextAssociationRule`
- 在生成图之前执行 `relevance firewall`
- 产出“本阶段应该取哪些实体、哪些域、什么深度、允许扩到几跳”

输出不是文本，而是 `ContextIntentGraph`。

```ts
interface ContextIntentNode {
  domain: 'character' | 'relationship' | 'item' | 'thread' | 'timeline' | 'world_state' | 'memory'
  refKey: string
  granularity: 'stub' | 'state' | 'deep' | 'proof'
  whySelected: string
  sourceSignals: string[]
  priority: number
  relevanceScore: number
  stageAllowed: ChapterContextStage[]
  dropIfBudgetTight: boolean
  semanticRole: 'narrative' | 'risk' | 'proof' | 'delta'
  proofRefs?: string[]
  riskLabels?: string[]
  deltaScope?: string[]
}

interface ContextIntentEdge {
  fromRefKey: string
  toRefKey: string
  edgeType: 'owns' | 'relates_to' | 'depends_on' | 'caused_by' | 'must_verify'
  expansionCost: number
}

interface ContextIntentGraph {
  stage: ChapterContextStage
  nodes: ContextIntentNode[]
  edges: ContextIntentEdge[]
  maxDepth: number
  totalBudgetHint: number
}
```

`ContextIntentGraph` 与 `ContextAssociationRule` 不是 registry 之后再补的装饰件，而是 Phase 1 必须先固化的主 contract。

硬规则：

- 没过 `relevance firewall` 的 node 不准进入 `ContextIntentGraph`
- `review / rewrite` 阶段的 risk/proof/delta 语义必须从 graph node 上就已经显式化，不能等 renderer 再猜
- graph metadata 直接向下透传成 `StagePackMeta`，不再在 pack 阶段二次发明相关性规则

## 5.4 Query Planner

Planner 仍建议 rule-based，不让模型自己选工具。

理由：

- 当前仓库已有强约束与强工作流。
- preview/runtime 同源要求高。
- 让模型自选工具会放大不确定性和“乱扩上下文”风险。

Planner 基于 `ContextIntentGraph` 决定：

- 调哪些 tool
- 每个 tool 的 granularity
- resultLimit
- 是否允许二跳扩张
- 预算不够时优先保谁

## 5.5 Tool Registry

建议从 writer 私有 registry 升级为通用 stage registry，但 registry 不是第一阶段起点。

必须先有：

- `resolveStageContext(stage, ...)` 统一入口
- `StageSignalBundle`
- `ContextAssociationRule`
- `ContextIntentGraph`
- `StagePackMeta`
- `StageRenderSchema` 或最小新增 allocator 字段

然后再把 writer 现有能力整理成可复用 registry 元数据。

```ts
interface RegisteredStageTool {
  toolName: string
  domain: string
  description: string
  supportsStages: ChapterContextStage[]
  supportsGranularity: Array<'stub' | 'state' | 'deep' | 'proof'>
  inputSchemaVersion: string
  outputSchemaVersion: string
  costClass: 'cheap' | 'moderate' | 'expensive'
  latencyClass: 'sync-fast' | 'sync-medium' | 'sync-heavy'
  determinism: 'deterministic' | 'semi_deterministic'
  fallbackMode: 'none' | 'conservative' | 'legacy'
  renderTargets: string[]
  execute(input: StageToolExecutionInput): Promise<StageToolExecutionResult>
}
```

```ts
interface StageToolExecutionInput {
  novelId: number
  chapterId?: number
  chapterNum: number
  stage: ChapterContextStage
  objective: string
  signals: StageSignalBundle
  limits?: {
    maxEntities?: number
    maxItems?: number
    maxEvents?: number
    maxHits?: number
    tokenCeiling?: number
  }
  invalidation?: {
    novelContextVersion?: number
    chapterContextVersion?: number
    assetFingerprint?: string
    promptOverrideHash?: string
    cacheSalt?: string
  }
}

interface StageToolExecutionResult {
  toolName: string
  status: 'success' | 'empty' | 'failed'
  structuredPayload?: unknown
  summary: string
  itemCount: number
  charCount: number
  fallbackUsed?: boolean
  fallbackDetail?: string
}
```

这组 contract 必须与当前 writer orchestrator 已有的 runtime ceiling、fingerprint、preview/runtime cache key 保持一致，不能只抽高层元数据。

## 5.6 Stage Renderer

Renderer 不负责决定查什么，只负责把 pack 渲染成阶段上下文候选字段。

这里必须承认一个现实：当前 allocator 常用候选字段不足以承载 `risk / proof / delta` 语义，不能靠把所有内容硬塞进 `continuityNotes / writingContractSummary / openLoops` 混过去。

建议新增一层显式 render contract：

```ts
type AllocatorFieldKey =
  | 'characterStates'
  | 'dialogueVoiceLocks'
  | 'relationSummary'
  | 'activeThreads'
  | 'dueForeshadows'
  | 'continuityNotes'
  | 'writingContractSummary'
  | 'scenePlanSummary'
  | 'draftTextSummary'
  | 'contractVersionSummary'
  | 'reviewRiskSummary'
  | 'reviewProofSummary'
  | 'rewriteDeltaSummary'
  | 'publishGateRiskSummary'

interface StageRenderSchema {
  stage: ChapterContextStage
  requiredAllocatorFields: AllocatorFieldKey[]
  optionalAllocatorFields: AllocatorFieldKey[]
}
```

如果不想一开始完整重做 allocator，也至少要先补最小新增字段，让 `review / rewrite` 不再语义错位。

示例：

- `character.get_stub_pack` -> `characterStates` / `dialogueVoiceLocks`
- `relationship.get_pack` -> `relationSummary`
- `thread.get_pack` -> `activeThreads` / `dueForeshadows`
- `review.get_risk_pack` -> `reviewRiskSummary` / `reviewProofSummary` / `publishGateRiskSummary`
- `rewrite.get_delta_pack` -> `rewriteDeltaSummary`

## 6. 阶段策略

## 6.1 ScenePlan

目标：

- 拆场景
- 定义场景职责
- 决定该章必须承接/兑现什么

允许技能：

- `scene_planning_skill`
- `character_presence_skill`

首批工具：

- `chapter.get_minimal_baseline`
- `thread.get_pack`
- `timeline.get_pack`
- `world_state.get_pack`
- 有条件地用 `character.get_stub_pack`

禁止：

- 大规模 recall
- deep character pack
- rewrite delta pack

## 6.2 Draft

目标：

- 生成正文
- 尽量少给，但保证足够

允许技能：

- `character_presence_skill`
- `character_motivation_skill`
- `thread_progress_skill`
- `world_state_skill`

关键规则：

- 默认只给 `stub/state`，不要默认 deep
- 只有当场景要求“解释行为动机”时，才升级到 `deep`
- recall 只允许补历史片段，不允许替代事实包

## 6.3 Review

目标：

- 判断文本是否兑现合同、是否跑偏、是否有 AI 味、是否逻辑断裂

允许技能：

- `review_verification_skill`
- `risk_evidence_skill`

关键规则：

- review 不是再拿一遍 writer 的所有素材
- review 必须拿“证据包”，不是“写作素材包”
- review 主路径只能通过 `resolveStageContext('review', ...)`
- review 不允许继续直接复用 legacy `rawContext`

统一必需信号：

- `draftTextSummary`
- `scenePlanSummary`
- `contractVersionSummary`
- `publishGateRisks`
- `criticalFixes / coherenceRisks / languageRisks`

首批工具：

- `chapter.get_minimal_baseline`
- `review.get_risk_pack`
- `thread.get_pack`
- `timeline.get_pack`
- `world_state.get_pack`
- 条件性 `recall.search_fragments`

## 6.4 Rewrite

目标：

- 基于 review 结果做最小必要修复

关键规则：

- rewrite 不再重新拿 writer 全量上下文
- 只拿 `delta pack`
- 严格围绕 critic 的高优先级问题
- rewrite 主路径只能通过 `resolveStageContext('rewrite', ...)`
- rewrite 读取的是统一 review 信号、proof 结果与 delta scope，不再回退成 `draft` 写作素材拼盘

首批工具：

- `chapter.get_minimal_baseline`
- `review.get_risk_pack`
- `rewrite.get_delta_pack`
- 必要时少量 `character.get_state_pack`
- 必要时少量 `relationship.get_pack`

## 7. 重点能力设计

## 7.1 Character / Relationship 分层检索

现有仓库里人物相关信息已经足够丰富：

- `characters`
- `characterRelations`
- `character_state_versions`
- `dialogue_fingerprint.service`
- `character-arc.service`

因此不需要新增“人物知识库系统”，只需要新增分层读取接口。

建议新工具：

- `character.get_stub_pack`
- `character.get_state_pack`
- `character.get_deep_pack`
- `relationship.get_pack`

其中：

- `stub` 从 `characters + dialogue hints` 取最小必要形象
- `state` 叠加 `character_state_versions + current pressure`
- `deep` 叠加 `innerConflict / deepNeed / contradiction / coreFear / recent event cause`
- `relationship` 独立返回，不强绑在人物包里，避免无关时把关系全塞进去

## 7.2 Relevance Firewall

为解决“无法限制 AI 内容无关”问题，必须加一道显式防线。

真正的 `relevance firewall` 已经前置在 `ContextIntentGraph` 生成阶段；这里的 pack metadata 只负责继承和透传，不再重新判定相关性。

每个 pack 都必须带上：

- `fromNodeRef`
- `whySelected`
- `sourceSignals`
- `relevanceScore`
- `stageAllowed`
- `dropIfBudgetTight`

```ts
interface StagePackMeta {
  fromNodeRef: string
  whySelected: string
  sourceSignals: string[]
  relevanceScore: number
  stageAllowed: ChapterContextStage[]
  dropIfBudgetTight: boolean
  semanticRole: 'narrative' | 'risk' | 'proof' | 'delta'
  proofRefs?: string[]
  riskLabels?: string[]
  deltaScope?: string[]
}
```

`StagePackMeta` 也是 Phase 1 的硬前提，不是 registry 跑起来后再回填的 trace 优化项。

硬规则：

- 没有 `fromNodeRef` 或 `whySelected` 的包不准进 renderer
- 相关性分数低于阈值的二跳包直接丢弃
- 一个场景默认最多放 3 个人物 state pack
- 一个角色默认最多扩 2 条关系
- `review/rewrite` 禁止拿与当前风险无关的 deep pack

## 7.3 Anti AI Flavor 控制

用户提到的“AI 味太重”，在当前仓库里已经有现成基础能力，不应该另起炉灶。

应直接接入：

- `anti-ai-rule.service.ts`
- `workspace-quality.service.ts`
- `dialogue-fingerprint.service.ts`
- `expression-dedup.service.ts`
- `style-compliance.service.ts`
- `narrative-control.service.ts`

设计要求：

1. `review.get_risk_pack` 必须纳入：
   - AI 味风险
   - 口吻漂移
   - 叙述模板化
   - 过度解释
   - 情绪空喊
   - 逻辑跳接
   - `draftTextSummary`
   - `scenePlanSummary`
   - `contractVersionSummary`
   - `publishGateRisks`
   - 对应 proof targets 与证据 refs

2. `rewrite.get_delta_pack` 只注入：
   - 必修问题
   - 相关角色/关系/世界差量事实
   - 对应的 anti-AI 修复指导

3. 不允许把“风格要求”写成大而空的修辞说明，必须尽量是约束语句：
   - 要什么
   - 不要什么
   - 违反会出现什么问题

## 7.4 Context Coherence Guard

为解决“上下文不连贯”，建议在 resolver 层引入一致性检查：

- 若某角色只命中 deep pack，没命中 state pack，自动降级或补 state
- 若某风险需要证据，但没有 proof refs，review pack 标记低可信
- 若某场景命中了角色，却没有匹配 scene presence / contract / thread 任何来源，判定为弱关联

输出到 trace：

- `weakAssociationCount`
- `forcedDeepPackCount`
- `missingProofCount`
- `crossStageMismatchCount`

## 8. 数据与持久化设计

原则：优先复用现有表，最小化新增持久化结构。

## 8.1 当前不强制新增持久化字段

当前阶段优先把 association、metadata、invalidation 做成运行时 contract，不先为它们新增表字段。

### `chapters.contextIntentJson`

- 降级为 preview / runtime trace 输出，不作为 Phase 1-3 的必需持久化字段。
- 只有当 trace 无法满足排障与复现时，再评估是否需要落库。

### `entityCatalogVersion`

- 降级为 runtime invalidation fingerprint，而不是先加数据库字段。
- 先通过角色 / 道具 / 关系 / timeline / world-state 的变更摘要参与 fingerprint。

### 项目级 `contextPolicy` 配置块

- 优先作为现有 `settingsJson` 的子配置块，不新增平行字段。
- 只有确认现有 `settingsJson` 无法稳定承载时，再评估是否需要独立 schema。

典型内容：

- 默认角色包深度
- 每阶段最大人物数
- 每角色最大关系扩张数
- 是否允许 recall 兜底
- review/rewrite 风险阈值

## 8.2 暂不新增

当前阶段不建议新增：

- 通用 retrieval cache 表
- 外部 MCP call log 表
- 独立 skill marketplace 持久化
- `chapters.contextIntentJson` 持久化
- `entityCatalogVersion` 独立字段

理由：

- 当前系统本地服务为主
- cache 复杂度高，收益尚未证明
- 现在瓶颈是阶段抽象，而不是工具分发渠道

## 9. 缓存、失效与回退

## 9.1 缓存

保留现有策略：

- 运行期内存缓存
- 同进程 preview 短生命周期缓存

新增 fingerprint 输入：

- `stage`
- `upstreamArtifactHash`
- `sceneSignalHash`
- `contextPolicyHash`
- `entityInvalidationDigest`
- `promptOverrideHash`
- `novel.contextVersion`
- `chapter.contextVersion`

## 9.2 失效

以下变化必须直接失效：

- upstream artifact 摘要或版本变化
- 章节合同变化
- 场景计划变化
- prompt override 变化
- 角色/物品/关系新增或删改
- world state / timeline / thread 影响当前章节的变动
- AI 风格规则库变化

## 9.3 Fallback

统一三层回退：

1. 同域结构化保守源
2. recall / story memory / runtime snapshot 辅助源
3. resolver 内部受控的 legacy `collectChapterContextRawData(...)` 全量文本装配
4. `allocator_apply_fallback`：结构化 pack 已产出，但因预算、字段兼容或硬约束冲突，只能回退到 allocator-compatible 的更保守上下文

硬要求：

- fallback 不得伪装主路径命中
- fallback 必须写 trace
- 某工具失败不应导致整阶段崩溃
- `review / rewrite` 不允许把 legacy `rawContext` 当成常态主路径
- allocator 应用失败必须单独记为 fallback 类型，不能和“检索命中为空”混在一起

## 10. 可观测性

preview 和 runtime 应统一输出：

- `queryPlan`
- `toolCalls`
- `toolResultsSummary`
- `structuredPacksSummary`
- `fallbackEvents`
- `renderedOverrides`
- `allocatorInputSummary`
- `contextIntentGraphSummary`
- `relevanceDrops`
- `weakAssociations`

建议新增统一结果类型：

```ts
interface StageContextResolution {
  stage: ChapterContextStage
  cacheKey: string
  cacheHit: boolean
  queryPlan: StageQueryPlanStep[]
  toolCalls: StageToolCall[]
  fallbackEvents: StageFallbackEvent[]
  intentGraph: ContextIntentGraph
  structuredPacks: Record<string, unknown>
  renderedOverrides: Partial<Record<string, string>>
  effectiveRawContext: Record<string, unknown>
  allocatorCompatibleContextParts: Record<string, unknown>
  allocatorInputSummary: Record<string, unknown>
}
```

## 11. 工程落点

## 11.1 新增文件建议

- `electron/services/stage-context-resolver.service.ts`
- `electron/services/stage-signal-builder.service.ts`
- `electron/services/stage-tool-registry.service.ts`
- `electron/services/stage-skill-profile.service.ts`
- `electron/services/context-association.service.ts`
- `electron/services/stage-render-schema.service.ts`
- `electron/services/review-context-pack.service.ts`
- `electron/services/rewrite-delta-pack.service.ts`
- `electron/services/character-context-pack.service.ts`
- `electron/services/relationship-context-pack.service.ts`

## 11.2 现有文件改造重点

- `electron/services/writer-context-orchestrator.service.ts`
  - 从 writer 私有 bucket 升级为 `resolveStageContext('draft', ...)` 的 draft 特化实现。

- `electron/services/chapter.service.ts`
  - 把 `scenePlan / review / rewrite` 接到 `resolveStageContext(stage, ...)`。
  - 去掉 `review / rewrite` 对 legacy `rawContext` 主路径的直接依赖。

- `electron/services/context.service.ts`
  - 保持 allocator 主体不变。
  - 增加 `StageRenderSchema` 或最小新增 allocator 字段，承接 `risk / proof / delta`。
  - 增加 stage-compatible renderer 接口。

- `src/types/index.ts`
  - 增加通用 `StageContextResolution / SkillProfile / AssociationRule / PackGranularity / StageRenderSchema / UpstreamRuntimeArtifacts` 类型。

- `electron/database/schema.ts`
  - 当前不强制新增 `entityCatalogVersion / contextIntentJson`。
  - 项目级 `contextPolicy` 优先并入现有 `settingsJson`。

## 12. 实施顺序

## Phase 0

当前已完成：

- `writer-only orchestrator`
- preview/runtime 同源
- draft 阶段结构化 pack 回填 allocator

## Phase 1

- 固化 `resolveStageContext(stage, ...)` 统一入口，并让 `draft` 先走这条入口
- 固化 `UpstreamRuntimeArtifacts / StageSignalBundle / ContextAssociationRule / ContextIntentGraph / StageRenderSchema`
- 把 `relevance firewall` 前置到 intent graph 生成阶段
- 明确 `review / rewrite` 统一输入：`draftTextSummary / scenePlanSummary / contractVersionSummary / publishGateRisks`
- 补齐 stage-specific render schema，避免 `risk / proof / delta` 无处落位

## Phase 2

- 实现 `context-association.service` 与 resolver 内部 planner
- 落地 `StagePackMeta`，并让 metadata 从 intent graph 直通 pack / renderer / trace
- 先完成 invalidation：`upstreamArtifactHash / entityInvalidationDigest / sceneSignalHash`
- 落地人物/关系分层包

## Phase 3

- 再抽 `stage-tool-registry / skill profile`，复用已落地 association / metadata / invalidation contract，而不是先做空壳

## Phase 4

- 让 `scenePlan` 接入通用 resolver
- preview 显示 `intentGraph` 与关联原因

## Phase 5

- 实现 `review.get_risk_pack`
- 接入 AI 味、对白、逻辑、合同兑现、`publish-gate` 风险
- review 正式切到独立 resolver 主路径，不再复用 legacy `rawContext`

## Phase 6

- 实现 `rewrite.get_delta_pack`
- rewrite 仅拿最小差量上下文
- rewrite 正式切到独立 resolver 主路径，只消费 risk/proof/delta 结果

## Phase 7

- 完善项目级 `contextPolicy` 配置块
- 支持按小说类型调整默认深度和预算

## Phase 8

- 评估是否需要外部 MCP transport
- 只有内部 contract 稳定后再考虑开放化

## 13. 风险与控制

## 13.1 风险：概念过重，像“AI 中台”

控制：

- 先不做外部 server
- 先不做技能市场
- 先只做仓库内 registry + resolver + association rules

## 13.2 风险：阶段抽象后逻辑更复杂

控制：

- writer 作为已验证路径，先抽象不改行为
- 每阶段单独接入
- 保留 legacy fallback

## 13.3 风险：为了“少传”导致信息不够

控制：

- pack 做层级化而不是单一瘦身
- 明确升级条件
- preview 可查看“本次为什么升级到 deep pack”

## 13.4 风险：review/rewrite 又退回大杂烩

控制：

- `review` 只用 risk/proof pack
- `rewrite` 只用 delta pack
- 在 `StageRenderSchema + StagePackMeta` 里限制阶段可用 granularity 与语义字段
- `review / rewrite` 必须先走 resolver 入口，不能绕回 legacy `rawContext`

## 14. 最终判断

这套方案最重要的不是“把 MCP / Skill 词汇搬进来”，而是把你要的核心能力工程化：

- 信息按域拆开
- 关联规则显式化
- 上下文按阶段按需取
- 同一角色支持最小包与深度包
- 无关信息能被主动限制
- AI 味和逻辑问题能进入 review/rewrite 的风险闭环

对当前仓库的最优路线不是重写整套上下文系统，而是：

1. 以 `writer-only orchestrator` 为 Phase 0 继续扩展。
2. 先固化 `resolveStageContext(stage, ...)`、`UpstreamRuntimeArtifacts`、`ContextAssociationRule / ContextIntentGraph` 和 stage-specific render schema。
3. 先把 metadata 与 invalidation 走通，再抽 `registry / skill profile`。
4. 然后接 `scenePlan`，再接 `review`，最后接 `rewrite`。
5. 始终复用现有 allocator、hard constraints、preview/runtime 和章节流水线。

如果按工程优先级排序，最值得先做的是三件事：

1. 固化 `resolveStageContext(stage, ...)`、`UpstreamRuntimeArtifacts`、`ContextAssociationRule / ContextIntentGraph` 和 `StageRenderSchema`，让 `review / rewrite` 先脱离 legacy `rawContext` 主路径。
2. 先把 `relevance firewall + StagePackMeta + invalidation digest` 走通，再把人物/关系做成 `stub/state/deep/proof` 四层包。
3. 最后接 `review.get_risk_pack` 与 `rewrite.get_delta_pack`，把 AI 味、逻辑、合同兑现、`publish-gate` 风险和 proof/delta 输入纳入统一闭环。
