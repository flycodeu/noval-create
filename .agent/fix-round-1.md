# Fix Round 1

更新时间：2026-05-03

结论：本轮验收失败，Agent 2 需要按以下返工单修复后重新提交。

## S0 阻塞项

### 1. `Writing` 拆分未落地

严重级别：`S0`

未达标项：

- `EditorRoute / ContextRoute / ReviewRoute / HistoryRoute` 仍是空壳包装
- `src/pages/Novel/Writing/index.tsx` 仍为超大单文件，当前实测 `3982` 行
- 没有可验证的真实视图拆分与状态收口

复现路径：

1. 打开 `src/pages/Novel/Writing/routes/EditorRoute.tsx`
2. 打开 `src/pages/Novel/Writing/routes/ContextRoute.tsx`
3. 打开 `src/pages/Novel/Writing/routes/ReviewRoute.tsx`
4. 打开 `src/pages/Novel/Writing/routes/HistoryRoute.tsx`
5. 确认 4 个文件都只做 `return <>{content}</>`
6. 查看 `src/pages/Novel/Writing/index.tsx` 行数与主体逻辑规模

建议修复点：

- 保留 `index.tsx` 作为容器，但必须把 4 个主视图的真实 JSX 和交互逻辑迁出
- 至少补齐：
  - `EditorView`
  - `ContextView`
  - `ReviewView`
  - `HistoryView`
- 将页面控制、数据加载、生成态管理收口到可复用 hook 或 store 层
- 确保路由文件真正承载视图，而不是继续透传 `content`

阻塞原因：

- 当前结构不满足 `docs/todo/41-功能缺陷与改进清单.md` 对 `2.2 Writing 页面复杂度失控` 的整改要求
- 无法判定“拆分已完成”

### 2. 正文内容级断点恢复未实现

严重级别：`S0`

未达标项：

- 当前只有任务级 `resume`
- 没有“从已生成内容继续”业务闭环
- 没有显式 partial draft 持久化与恢复入口

复现路径：

1. 查看 `electron/services/chapter.service.ts:4531`
2. 检查 `resumeChapterPipeline(taskId, sender)` 的恢复逻辑
3. 可见其最终仍调用 `generateChapterContent(rootTask.relatedEntityId, sender)`
4. 检查写作页与任务中心，未发现“继续已有正文草稿”与“从头重来”的清晰分流

建议修复点：

- 为章节流式正文建立可持久化的 partial content 缓存
- 在失败 / 超时 / 用户取消后保留该 partial content
- 在 `TaskCenter` 或 `Writing` 中提供明确动作：
  - 从断点继续
  - 从头重试
- continuation 时必须将已有正文内容作为续写上下文显式注入，而不是简单重跑整章
- 若无法继续，要给出可见原因

阻塞原因：

- 当前实现不满足“内容级断点恢复”定义
- 用户仍可能在流式中断后丢失正文连续性

### 3. 非章节生成链路的重试去重一致性未形成闭环

严重级别：`S0`

未达标项：

- 多个非章节服务只有 `appendVariationMessage`，没有结果级 `isCandidateTooSimilar()` 校验
- 未实现“生成结果过近时自动切换变体 / 重试”的一致性策略

复现路径：

1. 搜索以下文件中的 `appendVariationMessage`
2. 抽查：
   - `electron/services/faction.service.ts:803`
   - `electron/services/item.service.ts:1706`
   - `electron/services/item.service.ts:1910`
   - `electron/services/item.service.ts:2048`
   - `electron/services/story-thread.service.ts:1063`
   - `electron/services/story-thread.service.ts:1245`
   - `electron/services/story-thread.service.ts:1390`
   - `electron/services/timeline.service.ts:1212`
   - `electron/services/timeline.service.ts:1411`
   - `electron/services/timeline.service.ts:1547`
3. 再搜索这些服务内是否有对应 `isCandidateTooSimilar()` 验重落点
4. 当前抽查结果显示没有形成章节链路那样的完整闭环

建议修复点：

- 先补齐已接入 `rejectedDigests` 的服务：
  - `character.service.ts`
  - `timeline.service.ts`
  - `story-thread.service.ts`
  - `item.service.ts`
  - `faction.service.ts`
- 在生成结果入库前统一做：
  - recent rejected digests 规避
  - candidate similarity 判定
  - 过近时自动换变体或明确失败原因
- 如范围允许，再补 `map / world-rules / core-settings subplot` 等尚未完全接入链路

阻塞原因：

- 当前不满足“非章节生成链路的一致性”要求
- 用户会继续遇到“重试了但结果几乎没变”的问题

## S1 重要缺口

### 4. `.agent/implementation-report.md` 未对齐本轮任务

严重级别：`S1`

未达标项：

- 当前实现报告内容仍是上一轮“工作区切换、模板系统、PromptManager”等范围
- 没有记录本轮 3 个目标项的修改、验证与遗留问题

复现路径：

1. 打开 `.agent/implementation-report.md`
2. 核对标题和修改范围
3. 可见与本轮 3 个目标项不匹配

建议修复点：

- Agent 2 完成本轮返工后，必须重写 `.agent/implementation-report.md`
- 至少写清：
  - `Writing` 拆分内容
  - 内容级断点恢复实现点
  - 非章节链路去重一致性覆盖范围
  - typecheck / lint / test / build 结果

阻塞原因：

- 无法用当前报告支撑重新验收

## 返工完成标准

Agent 2 完成返工后，至少需要满足以下条件：

1. `Writing` 四个主视图已真实拆分，不再是空壳 route。
2. `Writing/index.tsx` 不再承担全部大块视图逻辑。
3. 流式正文中断后，用户能看到 partial content，并能明确选择“继续”或“重来”。
4. continuation 续写逻辑明确使用已有正文作为上下文，而非直接重跑整章。
5. 非章节服务至少在 `character / timeline / story-thread / item / faction` 完成结果级相似度去重闭环。
6. `.agent/implementation-report.md` 更新为本轮真实实现内容。
7. 重新运行并记录：
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test:unit`
   - `npm run build:app`
