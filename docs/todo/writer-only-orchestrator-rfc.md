# Writer-Only Orchestrator RFC

## 结论

本 RFC 收敛为一个可直接进入实现的窄版方案：

- 只改 `writer` 阶段的上下文获取方式
- 不改现有多阶段流水线总体结构
- 不引入通用持久化 retrieval cache
- 不让 `story_memory_checkpoints` 或 `chapter_recall_runtime_snapshots` 承担缓存职责
- `chapter:getContextPreview` 与真实生成复用同一套 planner / orchestrator / allocator 兼容层

关键落点：

- `electron/services/chapter.service.ts`
- `electron/services/context.service.ts`
- `electron/services/story-memory.service.ts`
- `electron/services/chapter-recall-runtime.service.ts`
- `electron/services/entity-discovery.service.ts`

## MVP 范围

MVP 只覆盖 `chapter.generateContent` 的 `writer/draft` 上下文装配，不承诺：

- 改 `planner/scenePlan`
- 改 `critic/rewrite`
- 模型自主 `tool_use`
- 外部进程化 MCP server
- 通用持久化 retrieval cache

MVP 要做的是：

1. 在 `writer` 阶段引入 `writer-only orchestrator`
2. orchestrator 基于章节信号做 rule-based query planning
3. 查询结果先组织成结构化 `pack`
4. `pack` 再渲染成兼容现有 `ChapterContextParts` 的文本切片
5. 最终仍进入现有 `allocateChapterContext(...)`

## Preview / Runtime 同源

新增唯一入口：

```ts
resolveWriterOrchestratedContext(chapterId, options): Promise<WriterContextResolution>
```

此入口同时服务于：

- `chapter:getContextPreview`
- `chapter:generateContent` 的 `writer` 阶段

必须共用：

- 同一个 `signal builder`
- 同一个 `query planner`
- 同一个 `tool router`
- 同一个 `pack renderer`
- 同一个 `allocator compatibility layer`
- 同一个 `fallback policy`

允许的差异只在输出层：

- preview 返回 `plan / toolCalls / cacheStats / renderedParts / allocatedContext / observability`
- runtime 使用同一份结果构造 writer prompt，并把关键 trace 写入 `task.progressJson`

## Writer-Only Orchestrator 边界

执行顺序固定为：

1. 复用 `collectChapterContextRawData(...)` 收集基础原料
2. 从基础原料提取 writer 查询信号：
   - `chapterGoal`
   - `outline`
   - `currentArc`
   - `contract.requiredAssetRefs`
   - `dueForeshadows`
   - `continuityNotes`
   - `mentionedCharacters / mentionedItems / mentionedLocations`
   - `scenePlanJson`
3. planner 只做 rule-based 查询决策，不让模型决定：
   - `character.get_pack`
   - `item.get_pack`
   - `thread.get_pack`
   - `world_state.get_pack`
   - `timeline.get_pack`
   - `memory.get_checkpoint_pack`
   - `recall.search_fragments`
4. tool 返回结构化 `pack`
5. `pack renderer` 把 `pack` 渲染成兼容现有字段的文本覆盖项
6. 将覆盖项合并回 `rawContext.contextParts`
7. 继续走现有 `allocateChapterContext(...)`

## 与现有预算器的整合

核心约束：**不绕过 allocator**。

方案不是让 orchestrator 直接产最终 prompt，而是新增一个兼容层，例如：

```ts
buildWriterContextWithRetrieval(rawData, retrievalResolution, allocatorOptions): ChapterContext
```

职责切分：

- orchestrator 决定“查什么、取哪些 pack、如何压缩成候选文本”
- allocator 仍然决定“哪些字段进入 hard constraints、哪些字段被裁剪、哪些字段被截断、预算如何分配”

必须保留原有硬约束来源字段：

- `chapterGoal`
- `continuityNotes`
- `dueForeshadows`
- `writingContractSummary`
- `dialogueVoiceLocks`
- `previousChapterContext`
- `lastChapterEnding`

只替换最重的 soft context 来源：

- `characterStates`
- `worldStates`
- `itemSummary`
- `relationSummary`
- `timelineSummary`
- `activeThreads`
- `longTermMemory`
- `recalledMemory`

## Pack 到现有字段的映射

- `chapter.get_baseline`：不覆盖字段，只补 planner 输入与可观测性
- `character.get_pack` -> `characterStates`、`relationSummary`、`dialogueVoiceLocks`
- `item.get_pack` -> `itemSummary`
- `thread.get_pack` -> `activeThreads`、`dueForeshadows`
- `world_state.get_pack` -> `worldStates`
- `timeline.get_pack` -> `timelineSummary`
- `memory.get_checkpoint_pack` -> `longTermMemory`
- `recall.search_fragments` -> `recalledMemory`

其中：

- `story_memory_checkpoints` 只是 `memory.get_checkpoint_pack` 的 source
- `chapter_recall_runtime_snapshots` 只是 analytics / fallback source，不是 cache

## 缓存与失效

修订后明确取消“checkpoint/runtime snapshot 充当 L2 cache”的说法。

MVP 只有两类缓存：

- `RunCache`：一次章节生成内的内存缓存
- `PreviewCache`：同进程内、短生命周期预览缓存；命中条件必须与 runtime 完全一致

缓存 key 至少包含：

- `novelId`
- `chapterId`
- `stage=writer`
- `promptProfile=draft`
- `novel.contextVersion`
- `chapter.contextVersion`
- `contractVersion`
- `promptOverrideHash`
- `preserveConstraintLabels`
- `executionMode`
- `sceneSignalHash`

必须覆盖的失效边界：

- `contextVersion` 变化立即失效
- `contractVersion` 变化立即失效
- prompt override 内容变化立即失效
- `entity-discovery` 新增 draft 人物/物品后立即失效

本 RFC 不引入新的持久化 cache 表。

如果实现时发现仅靠现有 `contextVersion` 不能可靠覆盖 draft 资产变更，优先补齐 version bump 逻辑；只有必要时才补最小字段：

- `novels.entityCatalogVersion: integer`

该字段只用于 fingerprint / invalidation，不用于缓存存储。

## Fallback

fallback 只作为取数降级，不作为 cache：

1. 实时结构化 source
2. `story_memory_checkpoints` 作为 memory source
3. `chapter_recall_runtime_snapshots` 或 embedding recall 作为 fallback source
4. 回退到现有 legacy `rawContext.contextParts` 全量文本装配

关键约束：

- fallback source 不参与通用 query memoization
- fallback 命中必须在 preview / runtime 中可见，并写入 trace
- 任一步查询、渲染、分配失败，都直接回落到现有 legacy writer context

## 可观测性

MVP 不新增新表，直接扩展 preview 返回结构和 `task.progressJson`。

建议新增：

- `retrievalFingerprint`
- `queryPlan`
- `toolCalls`
- `toolResultsSummary`
- `cacheStats`
- `fallbackEvents`
- `renderedContextOverrides`
- `allocatorInputSummary`

职责边界：

- `chapterRecallRuntimeSnapshot` 继续服务于 recall analytics / quality dashboard
- `retrieval trace` 服务于 writer orchestrator 的可观测性
- 二者都不是通用 cache

## 需要新增的持久化结构

MVP 不新增任何“通用 retrieval cache”表，也不要求新增独立 `tool_call_log` 表。

建议的持久化改动只有两类：

- 扩展 `task.progressJson`，加入 writer retrieval trace
- 若 `contextVersion` 不能可靠覆盖 entity-discovery draft 资产变更，则补齐 version bump 逻辑

## 后续阶段边界

明确排除在本 RFC 外：

- `critic/rewrite` 的 delta retrieval
- 模型自主 `tool_use`
- 外部 MCP transport
- 持久化 retrieval cache
- NPC 独立存储模型

后续阶段前提是 writer-only MVP 稳定，并能证明：

- token 降幅
- preview/runtime 一致性
- fallback rate
- cache 命中率
- 生成质量无回退

## 实现条件

进入实现前必须锁定 3 条：

1. `resolveWriterOrchestratedContext(...)` 成为 preview/runtime 唯一真实入口
2. writer orchestrator 产物必须先回填到 `rawContext.contextParts`，再走现有 `allocateChapterContext(...)`
3. 任一步查询、渲染、分配失败，都要直接回落到现有 legacy writer context，并保留 trace
