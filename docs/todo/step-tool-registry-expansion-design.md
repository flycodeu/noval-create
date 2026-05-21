# Step / Tool Registry 演进设计补充

## 1. 目的

本文作为 [writer-only-orchestrator-rfc.md](/D:/FlyLabs/noval-create/docs/todo/writer-only-orchestrator-rfc.md) 的后续补充，回答以下问题：

- 如何从 `writer-only orchestrator MVP` 演进为通用 `step -> tools / MCP / skills` 风格的按需检索架构
- 如何在不破坏现有 allocator / hard constraints / preview 机制的前提下，将 `scenePlan`、`review`、`rewrite` 逐步接入
- 如何定义通用 `tool registry`、`tool contract`、`fallback` 与 `preview/runtime` 同源策略
- 如何把仓库内“结构化检索能力”映射到类似 `MCP tools` 与 `skills` 的概念

本文不要求立即改造为外部 MCP server，也不要求模型自主 tool use。本文聚焦于**仓库内的统一工具注册与阶段编排层**。

## 2. 当前状态与差距

当前仓库已完成的内容：

- `writer/draft` 阶段已具备 `writer-only orchestrator`
- preview 与 runtime 在 `writer` 阶段已复用同一套 resolution path
- orchestrator 只生成 `renderedContextOverrides`，最终仍由现有 allocator 决定实际注入内容
- 已具备 `queryPlan`、`toolCalls`、`fallbackEvents`、`structuredPack`、`retrievalFingerprint` 等可观测性基础

距离总目标仍有明显差距：

1. 现阶段只有 `draft/writer` 接入，`scenePlan`、`review`、`rewrite` 仍然主要依赖一次性堆叠上下文。
2. 现阶段的“工具”仍是 writer 内部约定的 bucket，不是跨阶段统一 registry。
3. 现阶段 `structured pack -> overrides` 的模式只服务于 writer，尚未抽象为通用 step contract。
4. 现阶段还没有“阶段需求 -> 工具候选 -> 渲染产物 -> allocator 输入”的统一接口。
5. 现阶段还没有把“skills”沉淀为可复用的编排元数据，只是概念上接近。

因此，后续演进重点不应是继续扩 writer 的特例逻辑，而应是**把 writer MVP 中已经证明可行的调度路径抽象成通用 step/tool registry**。

## 3. 总体结论

推荐的演进方向不是“让每个阶段都直接自主调用模型工具”，而是建立一个统一的本地编排层：

`Stage Resolver -> Query Planner -> Tool Registry -> Structured Pack Renderer -> Existing Allocator`

其中：

- `Stage Resolver` 负责定义某个阶段真正需要哪些知识，而不是把所有资料直接塞进 prompt。
- `Query Planner` 负责把阶段需求转换为可执行的工具查询计划。
- `Tool Registry` 负责把“角色信息、故事线、时间线、世界状态、记忆召回”等能力统一注册。
- `Structured Pack Renderer` 负责把结构化结果压缩成当前 allocator 能消费的上下文片段。
- `Existing Allocator` 继续负责预算裁剪、硬约束保留、注入排序与最终 prompt 上下文构造。

这意味着：

- **不绕过 allocator**
- **不要求一次性引入外部 MCP**
- **不要求立即重写所有阶段**
- **先统一 contract，再逐阶段替换 context assembly**

## 4. 演进原则

### 4.1 Preview / Runtime 必须同源

任何阶段一旦接入 step/tool registry，必须满足：

- preview 与 runtime 共用同一 `stage resolver`
- 共用同一 `query planner`
- 共用同一 `tool registry`
- 共用同一 `pack renderer`
- 共用同一 `fallback policy`

允许不同的只有输出侧：

- preview 返回完整 trace 与渲染结果
- runtime 消费相同 resolution，并将关键 trace 写入任务进度或日志

### 4.2 保持阶段边界，不做“大统一 prompt”

不同阶段的目标不同，应保留独立上下文策略：

- `scenePlan` 关注章节目标、节奏、伏笔兑现、场景拆分、剧情推进顺序
- `draft` 关注正文写作所需角色/物品/记忆/世界状态
- `review` 关注合同兑现、逻辑一致性、风格/风险扫描、遗漏项
- `rewrite` 关注“基于 review delta 的最小必要补充上下文”，而不是重新装配全量上下文

通用化的是检索与编排方式，不是把四个阶段做成同一个 prompt 模板。

### 4.3 工具输出先结构化，再渲染文本

统一要求：

- tool 原生返回结构化结果
- renderer 负责将结构化结果转为阶段可消费的文本片段
- allocator 仍然只消费文本片段与硬约束摘要

这样做的原因：

- 保持与现有上下文分配器兼容
- 让 preview 可展示结构化来源与渲染摘要
- 后续切换到真正 MCP transport 时，contract 不必大改

### 4.4 Fallback 是降级策略，不是缓存替代

继续保持已有 RFC 的约束：

- `story_memory_checkpoints` 是 source，不是 retrieval cache
- `chapter_recall_runtime_snapshots` 是 analytics / fallback source，不是 retrieval cache
- fallback 命中必须出现在 trace 中
- 任一步失败都必须能回退到当前 legacy context assembly

## 5. 目标架构

推荐新增的概念层次如下：

### 5.1 Stage Definition

每个阶段先定义自己的“检索画像”：

- `stageKey`: `scenePlan` | `draft` | `review` | `rewrite`
- `objective`: 当前阶段的主要任务
- `requiredSignals`: 规划检索必须依赖的输入信号
- `toolScopes`: 该阶段允许使用哪些工具
- `renderTargets`: 工具结果允许落入哪些上下文字段
- `fallbackMode`: 当前阶段失败后的回退策略

### 5.2 Tool Registry

Registry 是对具体数据源与服务的统一封装，核心不是“工具越多越好”，而是**让阶段不直接依赖底层服务拼装细节**。

推荐结构：

```ts
interface StageToolRegistry {
  getTool(toolName: string): RegisteredStageTool | undefined
  listToolsByStage(stage: ChapterContextStage): RegisteredStageTool[]
}
```

```ts
interface RegisteredStageTool {
  toolName: string
  version: string
  scopes: StageToolScope[]
  supportsStages: ChapterContextStage[]
  inputSchemaVersion: string
  outputSchemaVersion: string
  execute(input: StageToolExecutionInput): Promise<StageToolExecutionResult>
}
```

### 5.3 Structured Pack Layer

每个工具只关心自己产出的结构化结果，例如：

- `character.pack`
- `thread.pack`
- `world-state.pack`
- `timeline.pack`
- `memory.pack`
- `review-risk.pack`
- `rewrite-delta.pack`

阶段 resolver 不直接处理底层数据表，而是处理 pack。

### 5.4 Renderer Layer

renderer 负责：

- 把 pack 渲染为阶段文本片段
- 输出当前 allocator 兼容字段
- 统计字符量、条目量、来源摘要

writer 已有的 `renderedContextOverrides` 只是第一种 renderer 产物。后续需要将这一模式推广到多阶段。

## 6. 通用 Tool Registry 设计

## 6.1 Tool 分类

建议先按“能力域”而不是“实现服务名”建 registry：

- `chapter-baseline`
- `story-memory`
- `character`
- `item`
- `timeline`
- `thread`
- `world-state`
- `recall`
- `review-signal`
- `rewrite-delta`

这样可以避免未来因底层 service 重构而频繁改阶段配置。

## 6.2 Tool 命名建议

推荐使用接近 MCP 的 `namespace.action` 形式：

- `chapter.get_baseline`
- `story_memory.get_pack`
- `character.get_pack`
- `item.get_pack`
- `timeline.get_pack`
- `thread.get_pack`
- `world_state.get_pack`
- `recall.search_fragments`
- `review.get_risk_pack`
- `rewrite.get_delta_pack`

说明：

- `get_pack` 表示返回结构化压缩包
- `search_fragments` 表示召回型工具
- `get_delta_pack` 表示针对上游阶段结果做差异补充，而不是重新拉全量内容

## 6.3 Tool Registry 元数据

每个工具建议至少包含以下元数据：

- `toolName`
- `description`
- `supportsStages`
- `inputSchemaVersion`
- `outputSchemaVersion`
- `costClass`
- `latencyClass`
- `determinism`
- `fallbackPolicy`
- `renderTargets`
- `observabilityLabels`

其中：

- `costClass`: `cheap` | `moderate` | `expensive`
- `latencyClass`: `sync-fast` | `sync-medium` | `sync-heavy`
- `determinism`: `deterministic` | `semi_deterministic`

这些元数据不是装饰项，而是给 planner 做“预算内选择”和给 preview 做“可解释展示”。

## 7. 通用 Tool Contract

推荐定义统一 contract，而不是让每个阶段直接拼接 service 参数。

### 7.1 输入契约

```ts
interface StageToolExecutionInput {
  novelId: number
  chapterId?: number
  chapterNum: number
  stage: ChapterContextStage
  objective: string
  signals: Record<string, unknown>
  limits?: {
    maxEntities?: number
    maxItems?: number
    maxEvents?: number
    maxHits?: number
  }
  invalidation?: {
    novelContextVersion?: number
    chapterContextVersion?: number
    assetFingerprint?: string
    cacheSalt?: string
  }
}
```

关键要求：

- `signals` 必须来自当前阶段 resolver，而不是任意拼装
- `limits` 必须可控，避免工具无限扩张输出
- `invalidation` 必须保留，确保 preview/runtime 命中条件一致

### 7.2 输出契约

```ts
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

要求：

- 工具输出必须有 `summary`
- 必须能报告 `itemCount` / `charCount`
- `empty` 与 `failed` 必须区分
- fallback 是否触发必须可见

### 7.3 阶段解析结果契约

writer 当前已有 `WriterContextOrchestratorResolution`。后续建议推广为通用阶段解析结果：

```ts
interface StageContextResolution {
  stage: ChapterContextStage
  cacheKey: string
  cacheHit: boolean
  queryPlan: StageQueryPlanStep[]
  toolCalls: StageToolCall[]
  fallbackEvents: StageFallbackEvent[]
  structuredPacks: Record<string, unknown>
  renderedOverrides: Partial<Record<string, string>>
  allocatorInputSummary: StageAllocatorInputSummary
}
```

writer 可以继续保留已有类型，但长远建议对齐到更通用的 stage resolution 结构。

## 8. 各阶段接入边界

## 8.1 Phase 0: 已完成的 writer-only MVP

保留当前状态：

- 只在 `draft` 阶段替换 raw context 的 soft context 来源
- 继续复用现有 allocator
- 继续保留 legacy fallback

该阶段的价值是验证：

- 按需检索是否能减少上下文堆积
- preview/runtime 是否一致
- structured retrieval 是否不会破坏硬约束注入

## 8.2 Phase 1: scenePlan 接入

`scenePlan` 应是下一个接入阶段，理由：

- 它比 `review/rewrite` 更接近规划型检索
- 它对“需要哪些角色/伏笔/事件”有强结构需求
- 它可以先消费压缩后的剧情资产，而不直接碰正文改写逻辑

`scenePlan` 阶段应允许的工具：

- `chapter.get_baseline`
- `story_memory.get_pack`
- `thread.get_pack`
- `timeline.get_pack`
- `world_state.get_pack`
- 可选 `character.get_pack`

`scenePlan` 阶段不建议首批接入的内容：

- 大规模 recall search
- review 风险工具
- rewrite delta 工具

`scenePlan` 渲染目标建议集中在：

- `chapterGoal`
- `currentArc`
- `continuityNotes`
- `dueForeshadows`
- `timelineSummary`
- `activeThreads`
- `openLoops`

边界要求：

- `scenePlan` 的 resolver 只服务于“场景规划输入”，不能越权生成 writer 细节包
- 其输出仍回填到 `rawContext.contextParts` 或平行的 stage-specific context parts，再进入现有 stage allocator

## 8.3 Phase 2: review 接入

`review` 阶段的核心不是“再查一遍所有世界信息”，而是**围绕 draft 结果补足验证证据**。

`review` 阶段建议的工具范围：

- `chapter.get_baseline`
- `thread.get_pack`
- `timeline.get_pack`
- `world_state.get_pack`
- `review.get_risk_pack`
- 有条件使用 `recall.search_fragments`

推荐新增 `review.get_risk_pack` 的原因：

- review 需要的不是纯事实包，而是“合同项、线索项、设定项、风格项”的风险摘要
- 该工具更像结构化审校输入，而不是 writer 的写作素材

`review` 阶段的输入要额外包含：

- 当前 draft 文本摘要
- scene plan 摘要
- 当前合同版本摘要
- publish / gate 相关风险信号

边界要求：

- review 工具返回的是“验证证据 + 风险摘要”，不是重写建议正文
- review 仍由现有 critic prompt 负责产出审校 JSON
- review resolver 只负责缩短、聚焦 critic 所需上下文

## 8.4 Phase 3: rewrite 接入

`rewrite` 阶段必须最后接，且应采用 `delta retrieval`，不能简单复用 writer 的全量包。

`rewrite` 阶段建议工具：

- `chapter.get_baseline`
- `review.get_risk_pack`
- `rewrite.get_delta_pack`
- 必要时少量 `character.get_pack`
- 必要时少量 `thread.get_pack`

`rewrite.get_delta_pack` 应回答：

- 哪些段落或场景被 critic 判定为高优先级修复
- 为完成这些修复，需要补哪些角色状态、线索、时间线或合同限制
- 哪些上下文已在 draft 阶段充分给出，不必再次注入

边界要求：

- rewrite 不应重新拿到 writer 的最大上下文版本
- rewrite 应尽量围绕 review 结论做最小增量补充
- rewrite 仍然必须通过 allocator 进行预算控制

## 9. Planner 设计

通用 planner 建议保持 rule-based，暂不让模型直接决定要调用哪些工具。

原因：

- 当前系统已有较强的阶段控制与合同约束
- 模型自主 tool planning 会提高非确定性
- preview/runtime 同源要求下，rule-based planner 更容易保证结果一致

planner 的职责：

1. 根据 stage definition 解析信号
2. 决定启用哪些工具
3. 为每个工具生成 terms / queryText / resultLimit
4. 按成本和阶段优先级决定执行顺序
5. 在命中不足时触发 fallback route

planner 的非职责：

- 不直接访问数据库
- 不直接渲染最终 prompt
- 不做 hard constraints 裁剪

## 10. Fallback 策略

推荐统一三层回退：

1. `structured source fallback`
2. `recall / checkpoint fallback`
3. `legacy context assembly fallback`

解释如下：

- 第一层：同能力域的备用结构化 source，例如角色详情取不到时改用较保守摘要源
- 第二层：使用记忆/召回型 source 补充缺口
- 第三层：直接回退到当前阶段的 legacy 文本上下文装配

每次 fallback 必须记录：

- `stage`
- `toolName`
- `reason`
- `fallbackMode`
- `impactSummary`

禁止事项：

- 不得把 fallback 命中伪装成正常主路径命中
- 不得因为 fallback 可用就省略 invalidation
- 不得把 analytics snapshot 当作长期缓存

## 11. Preview / Runtime 同源扩展

writer 已经验证了 preview/runtime 同源的必要性。通用化后应形成统一要求：

- `getContextPreview(stage=...)` 与真实生成必须走同一个 `resolveStageContext(...)`
- preview 可以额外返回 `structuredPacks` 摘要与工具元数据
- runtime 可以只保留必要 trace，但其底层 resolution 不得换路径

建议的统一入口：

```ts
resolveStageContext(stage, chapterId, options): Promise<StageContextResolutionPayload>
```

其中 payload 至少包含：

- `effectiveRawContext`
- `stageContextResolution`
- `allocatorCompatibleContextParts`

writer 现有实现可以视作该通用入口的第一个特化版本。

## 12. 与 Skills 概念的映射

这里的 `skills` 不应理解为“另起一个完全独立的 prompt 代理系统”，而应理解为**带元数据的能力包**。

推荐映射关系：

- `tool`: 单次可执行的结构化查询能力
- `skill`: 一组围绕某类任务的工具集合与规则
- `stage`: 对 skill 的受控使用者

示例映射：

- `Writer Character Skill`
  - `character.get_pack`
  - `thread.get_pack`
  - `recall.search_fragments`

- `Scene Planning Skill`
  - `chapter.get_baseline`
  - `story_memory.get_pack`
  - `timeline.get_pack`
  - `thread.get_pack`

- `Review Verification Skill`
  - `review.get_risk_pack`
  - `world_state.get_pack`
  - `timeline.get_pack`

- `Rewrite Delta Skill`
  - `rewrite.get_delta_pack`
  - `review.get_risk_pack`
  - selective `character.get_pack`

因此，代码层优先实现的应是 `tool registry + stage definition`，而不是先实现“技能市场式”的外壳。skills 可以是 registry 元数据的上层聚合视图。

## 13. 推荐实施顺序

### Phase 1

- 抽象通用 `stage definition`
- 抽象通用 `tool registry` 元数据
- 保持 writer 现有实现可运行
- 把 writer 内部 bucket/target 命名对齐到通用 `toolName` 体系

### Phase 2

- 为 `scenePlan` 增加 resolver
- 完成 preview/runtime 同源接入
- 观察对 token、计划质量、fallback rate 的影响

### Phase 3

- 引入 `review.get_risk_pack`
- 给 `review` 阶段接入通用 resolution
- 验证审校 JSON 的质量是否保持

### Phase 4

- 引入 `rewrite.get_delta_pack`
- 让 `rewrite` 只获取最小必要增量上下文
- 验证 rewrite 的 token 成本和修复准确率

### Phase 5

- 在通用 registry 稳定后，再考虑是否暴露为真正的外部 MCP transport
- 再评估是否需要将 skill 作为可配置编排单元持久化

## 14. 非目标

本文明确不包含以下内容：

- 立即引入模型自主 tool use
- 立即引入外部独立 MCP 进程或远程 server
- 新增通用持久化 retrieval cache 表
- 重写现有 allocator
- 把所有阶段合并成单一超长上下文 prompt

## 15. 对当前实现的判断

当前实现已经完成了总目标中最关键的一步：**证明“先按需检索结构化信息，再回填到现有 allocator”是可落地的**。

但它仍然只是总目标的第一阶段，距离“通用 step -> tools / MCP / skills 风格检索架构”还差以下关键能力：

1. 缺少跨阶段统一 registry，而不是 writer 私有 bucket 集合。
2. 缺少 `scenePlan / review / rewrite` 的独立 resolver。
3. 缺少 review / rewrite 专用工具，尤其是 `risk pack` 与 `delta pack`。
4. 缺少通用 `StageContextResolution` 契约。
5. 缺少将“tool”聚合成“skill”的上层元数据视图。

结论：

- 当前实现可以视为 `Phase 0 / MVP 已完成`
- 但尚不能视为“完整完成 step/tool registry 目标”
- 后续应优先做“通用抽象 + scenePlan 接入”，而不是立即扩散到所有阶段或外部 MCP
