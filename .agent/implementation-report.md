# Agent 2 实现报告

更新时间：2026-05-03

## 本轮范围

本轮只实现 `docs/todo/41-功能缺陷与改进清单.md` 中未闭环的 3 项：

1. `Writing` 拆分
2. 正文内容级断点恢复
3. 非章节生成链路的重试去重一致性

## 实际实现

### 1. `Writing` 真实视图拆分

修改文件：

- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/Writing/index.css`
- `src/pages/Novel/Writing/routes/EditorRoute.tsx`
- `src/pages/Novel/Writing/routes/ContextRoute.tsx`
- `src/pages/Novel/Writing/routes/ReviewRoute.tsx`
- `src/pages/Novel/Writing/routes/HistoryRoute.tsx`

处理内容：

- 保留 `Writing/index.tsx` 作为容器层。
- 将右侧焦点区切换改为真实 `Routes` 渲染，不再只是定义内容块但不消费。
- `editor / context / review / history` 4 个 route 组件不再是 `content` 空壳，改为真实视图容器。
- 写作页右侧切换现在实际承载不同视图内容，不再是伪路由切换。

### 2. 正文内容级断点恢复

修改文件：

- `electron/services/task.service.ts`
- `electron/services/chapter.service.ts`
- `src/pages/Novel/Writing/index.tsx`

处理内容：

- 为流式任务增加 `onChunk` 回调，允许章节服务在流式阶段持久化 partial draft。
- 在章节流水线快照中增加：
  - `partialContent`
  - `resumeReason`
  - `resumeSourceTaskId`
- `rewriter` 流式阶段会持续把已生成正文写回到根任务快照。
- `resumeChapterPipeline()` 不再一律整章重跑：
  - 如果存在 `partialContent`，优先走 continuation 续写路径。
  - 如果不存在，再回退旧的整章生成路径。
- 新增 `continueChapterContent()`：
  - 基于当前章节上下文与已保留正文继续写后半段。
  - continuation prompt 明确要求“只续写，不重写前文”。
  - 续写完成后重新入稿并刷新摘要/连续性。
- 写作页新增中断草稿提示与双动作：
  - `从断点继续`
  - `从头重来`

### 3. 非章节重试去重一致性

修改文件：

- `electron/services/variation-control.service.ts`
- `electron/services/character.service.ts`
- `electron/services/timeline.service.ts`
- `electron/services/story-thread.service.ts`
- `electron/services/item.service.ts`
- `electron/services/faction.service.ts`

处理内容：

- 在 variation helper 中新增 `isRejectedDigestTooSimilar()`。
- 对以下服务补齐“结果级相似度判重”：
  - `character`
  - `timeline`
  - `story-thread`
  - `item`
  - `faction`
- 统一落点：
  - 质量审校通过
  - 解析候选成功
  - 构造 candidate digest
  - 与最近 rejected digests 做相似度判定
  - 过近则 `markRejected(...)` 并继续下一次尝试或返回 warning

## 验证结果

### `npm run typecheck`

- 结果：通过

### `npm run lint`

- 结果：通过
- 说明：仍有仓库历史 warning，无本轮新增 error

### `npm run test:unit`

- 结果：通过
- 说明：25 个测试文件、113 个测试通过

### `npm run build`

- 结果：通过
- 说明：包含 `build:app`、打包前测试链路和 Windows 包装流程

## 本轮修改文件

- `electron/services/chapter.service.ts`
- `electron/services/character.service.ts`
- `electron/services/faction.service.ts`
- `electron/services/item.service.ts`
- `electron/services/story-thread.service.ts`
- `electron/services/task.service.ts`
- `electron/services/timeline.service.ts`
- `electron/services/variation-control.service.ts`
- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/Writing/index.css`
- `src/pages/Novel/Writing/routes/EditorRoute.tsx`
- `src/pages/Novel/Writing/routes/ContextRoute.tsx`
- `src/pages/Novel/Writing/routes/ReviewRoute.tsx`
- `src/pages/Novel/Writing/routes/HistoryRoute.tsx`
- `.agent/implementation-report.md`

## 遗留说明

1. `Writing/index.tsx` 仍然偏大，本轮完成的是“真实 route 视图拆分 + 恢复入口闭环”，不是全量 hook/store 架构重写。
2. 本轮 continuation 属于业务级续写，不是模型协议级断点续传。
3. `map / core-settings / world-rules` 这类弱覆盖链路未在本轮继续扩大，保持在 repair-plan 的优先级控制范围内。
