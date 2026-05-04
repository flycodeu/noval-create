# 项目审计报告

更新时间：2026-05-03  
角色：Agent 1（项目审计与方案设计）  
范围限定：仅覆盖 `docs/todo/41-功能缺陷与改进清单.md` 尚未闭环的 3 个真实开发项：

1. `Writing` 拆分
2. 正文内容级断点恢复
3. 非章节生成链路的重试去重一致性

约束：本轮只审计，不修改业务代码；仅更新 `.agent/*.md`

## 1. 审计方法与覆盖文件

本轮基于当前仓库代码直接扫描以下区域：

- `docs/todo/41-功能缺陷与改进清单.md`
- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/Writing/routes/EditorRoute.tsx`
- `src/pages/Novel/Writing/routes/ContextRoute.tsx`
- `src/pages/Novel/Writing/routes/ReviewRoute.tsx`
- `src/pages/Novel/Writing/routes/HistoryRoute.tsx`
- `src/stores/task.store.ts`
- `src/pages/TaskCenter/index.tsx`
- `electron/services/chapter.service.ts`
- `electron/services/task.service.ts`
- `electron/services/variation-control.service.ts`
- `electron/services/character.service.ts`
- `electron/services/timeline.service.ts`
- `electron/services/story-thread.service.ts`
- `electron/services/item.service.ts`
- `electron/services/faction.service.ts`
- `electron/services/map.service.ts`
- `electron/services/core-settings.service.ts`
- `electron/services/world-rules.service.ts`

本次审计不讨论其它页面、不重新扩展需求，也不把“建议优化”误判为“必须本轮开发”。

## 2. 总结结论

这 3 项里，当前仓库的真实状态不是“完全没有基础”，而是：

1. `Writing` 页已经有完整业务能力，但结构失控，拆分只停留在懒加载壳文件层面。
2. 章节恢复能力现在只到“任务级/流水线级重跑”，没有做到“基于已生成正文继续写”的内容级恢复。
3. 非章节生成链路已经有部分变体控制基础，但接入程度不一致，且多个服务缺少最终输出相似度判重。

因此本轮的正确方向应是：

- 不做大架构重写。
- 在现有能力上补齐真正缺口。
- 优先打通业务闭环，再做有限度的结构收口。

## 3. 审计项一：Writing 拆分

### 3.1 当前实现现状

`src/pages/Novel/Writing/index.tsx` 目前约 4097 行，单文件承载：

- 页面数据加载
- 章节切换
- 生成状态
- 流式正文展示
- 合同 / 上下文 / 审校 / 历史四块视图内容
- 多种模态框、按钮交互、保存与生成逻辑

代码中虽已存在懒加载路由：

- `WritingEditorRoute`
- `WritingContextRoute`
- `WritingReviewRoute`
- `WritingHistoryRoute`

但对应文件目前都只是空壳包装：

- `src/pages/Novel/Writing/routes/EditorRoute.tsx`
- `src/pages/Novel/Writing/routes/ContextRoute.tsx`
- `src/pages/Novel/Writing/routes/ReviewRoute.tsx`
- `src/pages/Novel/Writing/routes/HistoryRoute.tsx`

其内容仅为：

- 接收 `content: React.ReactNode`
- 直接返回 `<>content</>`

这说明“拆分”现在只完成了路由占位，没有完成真实视图职责下沉。

### 3.2 已有可复用切分点

`Writing/index.tsx` 中已经天然形成了 4 类内容块：

- 编辑生产区
  - 章节列表
  - 合同面板
  - 编辑器
  - 生成/保存/审校/定稿入口
- 上下文区
  - `contextSections`
  - `chapterContextPreview`
  - `storyMemory`
  - `publishCheck` / `foreshadow` / `reveal` 等信息
- 审校区
  - `reviewInsightContent`
  - `acceptanceCards`
  - `qualityIssueItems`
  - `AIScorePanel`
- 历史区
  - `chapterVersions`
  - `selectedVersion`
  - 恢复版本逻辑

同时已有部分公共组件可复用：

- `ContractPanel`
- `ContextPanel`
- `PipelineBar`
- `VersionTimeline`
- `SectionHeader`
- `ActionBar`

说明本轮无需重写 UI 框架，只需把 `index.tsx` 中的视图块和状态装配拆出来。

### 3.3 真实缺口

当前缺口主要有 4 个：

1. 路由文件没有真正承载视图逻辑。
2. `index.tsx` 同时掌握数据读取、行为函数、渲染细节，维护风险极高。
3. 共享状态没有形成清晰边界，导致后续新增“恢复提示、重试、异常状态”会继续堆进主文件。
4. 现有拆分目标里提到的 `SettingsView` 在当前代码中没有实际业务必要，如果强行补会扩大范围。

### 3.4 审计判断

本项属于真实未闭环项，应作为本轮 P0。

通过标准不应是“把文件拆成很多个”，而应是：

- 路由文件变成真实 View
- 主文件降级为容器和装配层
- 四个现有视图职责清楚
- 不引入额外假页面

## 4. 审计项二：正文内容级断点恢复

### 4.1 当前实现现状

当前仓库已经具备以下基础能力：

1. 流式任务过程中，`task.service.ts` 会累计 `fullOutput`。
2. 每次流式 chunk 会通过 `task:stream-chunk` 发给前端。
3. 任务失败、取消、超限时，会把 `outputText: fullOutput || null` 写回任务记录。
4. `TaskCenter` 已能查看 `selectedTask.outputText`，也能触发 `window.electron.chapter.resumeContent(task.id)`。
5. `chapter.service.ts` 提供了 `resumeChapterPipeline(taskId, sender)`。

### 4.2 当前恢复能力的真实边界

`resumeChapterPipeline()` 当前逻辑是：

- 找到根任务
- 校验根任务必须是 `chapter_write`
- 如果未在运行中，则直接重新调用 `generateChapterContent(rootTask.relatedEntityId, sender)`

这意味着当前“恢复”本质上是：

- 重新触发整章生成流水线
- 不是从已生成正文继续写
- 没有显式区分“从断点继续”与“从头重来”

### 4.3 已保留但未闭环的基础

当前已有两块可利用基础：

1. 任务表里已有失败/取消时的 `outputText`
2. 前端写作页已有流式展示能力：
   - `activeGeneration.streamTaskId`
   - `streams[streamTaskId]?.content`

这两块能力说明：

- “已生成正文丢光”的问题不是完全无解
- 但它们还没有被组装成用户可用的“内容级续写”能力

### 4.4 真实缺口

当前缺口主要有 5 个：

1. 没有持久化的“章节断点正文快照”概念，只有任务 `outputText`。
2. 没有“这是中断草稿，可继续/重开”的业务状态展示。
3. 没有显式的“从断点继续”动作入口。
4. 没有把已生成正文作为 continuation context 注入新的写作请求。
5. 没有针对“网络错误 / 超时 / 用户取消”做不同恢复提示。

### 4.5 审计判断

本项属于真实未闭环项，应列为本轮 P0。

但本轮不应追求模型级真正“续传流”，而应实现：

- 业务级内容恢复
- 基于已生成正文继续生成后续内容
- 用户可见、可选、可回退

这是当前代码基础上最稳妥且可落地的实现边界。

## 5. 审计项三：非章节生成链路的重试去重一致性

### 5.1 当前共享能力现状

`electron/services/variation-control.service.ts` 已提供：

- `buildVariationDigest()`
- `computeCandidateSimilarity()`
- `isCandidateTooSimilar()`
- `appendVariationMessage()`

其中 `isCandidateTooSimilar(candidate, existingCandidates, threshold = 0.72)` 已是可复用的统一判重方法。

### 5.2 已部分接入、但未闭环的服务

以下服务已经使用：

- `getRecentRejectedDigests()`
- `appendVariationMessage()`

但审计中未发现它们普遍使用 `isCandidateTooSimilar()` 对最终候选结果做后置相似度判重：

- `electron/services/character.service.ts`
- `electron/services/timeline.service.ts`
- `electron/services/story-thread.service.ts`
- `electron/services/item.service.ts`
- `electron/services/faction.service.ts`

这类服务的现状是：

- 重试 prompt 已提示“要和之前不同”
- 也会携带最近拒绝摘要
- 但如果模型还是生成“结构相近、内容近似”的结果，当前多数链路不会统一拦截

### 5.3 覆盖度更弱的服务

以下链路未体现出与上述 5 个服务同等强度的变体控制覆盖：

- `electron/services/map.service.ts`
- `electron/services/core-settings.service.ts`
- `electron/services/world-rules.service.ts`

审计判断：

- `map.service.ts` 已有 JSON 修复和质量审校，但没有看到统一 rejected-digest + 相似度后置判重接入。
- `core-settings.service.ts` 的支线生成链路依赖 `generateSubplotBatch`，本轮应重点核对子链路的重试去重是否一致，而不是重写整个 Core Settings 流程。
- `world-rules.service.ts` 存在世界规则分段生成，但当前未见统一接入本套 variation-control 的证据。

### 5.4 当前章节链路的对照基线

`chapter.service.ts` 已明确使用 `isCandidateTooSimilar()`，例如重写结果与初稿过近时会直接判定并切换变体重试。

这说明：

- 统一策略已经在章节链路证明可行
- 本轮只是要把相同思路补齐到非章节链路

### 5.5 真实缺口

本项的真实缺口不是“没有任何变体机制”，而是 3 层不一致：

1. 有的服务只有 variation prompt，没有相似度后置判重。
2. 有的服务既没有 rejected digest，也没有统一变体注入。
3. 不同服务遇到“本次结果虽然合法但过近”的处理动作不统一。

### 5.6 审计判断

本项是本轮真实开发项，优先级为 P1，但其中一部分属于 P0 子任务：

- 先补齐已有 rejected-digest 服务的后置相似度判重
- 再处理 `map / subplot / world-rules` 这类覆盖度更弱的链路

原因是前者改动小、收益高、风险低，适合作为主修复面。

## 6. 结论与实施边界建议

本轮 3 项都是真实未闭环项，且都有足够现有基础支撑继续开发。

建议 Agent 2 严格按以下边界执行：

1. `Writing` 拆分：
   - 只拆现有 4 个真实视图
   - 不新增无业务必要的 `SettingsView`
   - 主文件保留容器职责

2. 正文内容级断点恢复：
   - 做业务级 continuation
   - 明确区分“从断点继续”和“重新开始”
   - 利用已存在的 `outputText` / stream 基础
   - 不做底层模型协议级断点续传幻想实现

3. 非章节去重一致性：
   - 优先补齐 5 个已接入 rejected-digest 的服务
   - 再把 `map / subplot / world-rules` 纳入统一策略
   - 不做大规模生成框架重写

如果按上述边界推进，本轮有较高概率在不扩大范围的前提下把 `docs/todo/41` 中这 3 项推进到可宣告“闭环”或“基础已修复”。
