# 修复计划

更新时间：2026-05-03  
角色：Agent 1（项目审计与方案设计）  
适用对象：Agent 2 仅按本计划编码；Agent 3 按本计划验收  
范围限定：仅覆盖 `docs/todo/41-功能缺陷与改进清单.md` 中以下 3 项：

1. `Writing` 拆分
2. 正文内容级断点恢复
3. 非章节生成链路的重试去重一致性

## 修复目标

本轮修复目标是把这 3 项从“部分基础存在但未闭环”推进到“可用、可验证、可回归”的状态：

1. `Writing` 从超大单文件降级为“容器 + 真实子视图”结构，避免后续继续堆积。
2. 章节正文在生成中断后，用户能看到保留下来的部分内容，并且可以明确选择“从断点继续”或“重新开始”。
3. 非章节生成链路在重试时具备统一的变体注入、相似度后置判重和拒绝重试策略，避免“看起来重试了，实际上还是同一结果”。

## 本轮范围

### 纳入本轮

- `src/pages/Novel/Writing` 的真实视图拆分
- 章节写作链路的内容级恢复状态、继续入口和续写数据流
- 非章节生成服务的去重一致性补齐
- 与上述功能直接相关的类型、状态、保存逻辑、错误提示和基础交互
- 必要的任务中心 / 写作页恢复提示联动

### 不纳入本轮

- `Writing` 全量架构重写
- 新增不必要的 `SettingsView`
- 模型协议级“真正断点续传”
- 所有生成服务统一抽象大重写
- 无关页面的样式或主题整改

## P0 / P1 / P2

## P0

### P0-1 `Writing` 真实拆分

要求：

- `src/pages/Novel/Writing/index.tsx` 不再承载全部视图细节
- `EditorRoute / ContextRoute / ReviewRoute / HistoryRoute` 变成真实 View，不再只是 `content` 包装器
- 主文件只保留：
  - 数据获取与派生
  - 行为函数装配
  - 路由切换
  - 共享状态下发

### P0-2 正文内容级断点恢复

要求：

- 中断后保留当前已生成正文
- 用户能明确看到“可从断点继续”
- 用户能区分：
  - 从断点继续
  - 重新开始
- 续写链路会把现有正文作为 continuation context 注入，而不是直接重跑整章

## P1

### P1-1 非章节生成链路的后置相似度判重补齐

优先补齐这些已使用 rejected digest / variation message 的服务：

- `electron/services/character.service.ts`
- `electron/services/timeline.service.ts`
- `electron/services/story-thread.service.ts`
- `electron/services/item.service.ts`
- `electron/services/faction.service.ts`

要求：

- 对最终接受候选做 `isCandidateTooSimilar()` 判定
- 相似则标记拒绝并进入下一次尝试或返回明确 warning

### P1-2 覆盖较弱链路纳入统一策略

重点核对并补齐：

- `electron/services/map.service.ts`
- `electron/services/core-settings.service.ts`
- `electron/services/world-rules.service.ts`

要求：

- 至少接入统一的 rejected digest / variation prompt / similarity post-check 中的缺失部分
- 不为此重写整套生成框架

## P2

### P2-1 `Writing` 进一步 hook 化

如果在 P0 完成后仍有余量，可继续把 `index.tsx` 中的数据装配继续抽成 hook，例如：

- `useWritingWorkspace`
- `useWritingGeneration`

但这不是本轮通过的硬条件。通过条件是“真实视图拆分完成”，不是“必须引入新 hook 名称”。

## 涉及文件

### 文档与状态判定

- `docs/todo/41-功能缺陷与改进清单.md`

### `Writing` 拆分

- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/Writing/routes/EditorRoute.tsx`
- `src/pages/Novel/Writing/routes/ContextRoute.tsx`
- `src/pages/Novel/Writing/routes/ReviewRoute.tsx`
- `src/pages/Novel/Writing/routes/HistoryRoute.tsx`
- 允许新增：
  - `src/pages/Novel/Writing/components/*`
  - `src/pages/Novel/Writing/hooks/*`
  - `src/pages/Novel/Writing/types.ts`

### 断点恢复

- `electron/services/chapter.service.ts`
- `electron/services/task.service.ts`
- `src/pages/Novel/Writing/index.tsx`
- `src/pages/TaskCenter/index.tsx`
- `src/stores/task.store.ts`
- 如有必要：
  - `src/types/index.ts`
  - `electron/preload.ts`
  - `electron/main.ts`

### 非章节去重一致性

- `electron/services/variation-control.service.ts`
- `electron/services/character.service.ts`
- `electron/services/timeline.service.ts`
- `electron/services/story-thread.service.ts`
- `electron/services/item.service.ts`
- `electron/services/faction.service.ts`
- `electron/services/map.service.ts`
- `electron/services/core-settings.service.ts`
- `electron/services/world-rules.service.ts`

## 推荐页面结构

本节只针对 `Writing`。

建议结构：

1. `index.tsx`
   - 负责加载当前小说 / 当前章节 / 当前任务 / 当前流状态
   - 负责生成行为、保存行为、恢复行为的入口函数
   - 负责把共享 props 下发给 4 个路由视图

2. `EditorRoute`
   - 章节列表
   - 合同区
   - 编辑器
   - 流式生成区
   - 继续 / 重开入口

3. `ContextRoute`
   - 上下文召回、世界事实、地点状态、角色状态、伏笔与质量约束

4. `ReviewRoute`
   - 发布前检查
   - 合同兑现
   - AI 体检
   - 修订建议

5. `HistoryRoute`
   - 版本列表
   - 版本预览
   - 恢复历史版本

要求：

- 4 个路由文件必须有真实 JSX 和明确 props
- 不允许继续把完整 JSX 拼好后当作 `content` 传入空壳 route

## 推荐数据结构

### 1. `Writing` 共享视图模型

建议最少抽出一个共享 props 类型，避免 4 个 route 各自重新从主文件闭包拿状态：

```ts
type WritingRouteSharedProps = {
  novelId: number
  currentChapter: Chapter | null
  chapters: Chapter[]
  refreshing: boolean
  currentChapterGenerating: boolean
  streamContent: string
  chapterWritability: ...
  publishCheck: ...
  reviewNotes: ...
  chapterVersions: ChapterVersion[]
  selectedVersion: ChapterVersion | null
  onRefreshChapter: (chapterId: number) => Promise<void>
  onGenerate: () => Promise<void>
  onResumeFromDraft?: () => Promise<void>
  onRestartGeneration?: () => Promise<void>
  ...
}
```

重点是“共享视图模型清晰”，不要求一次性把所有类型抽到最完美。

### 2. 章节内容级恢复状态

建议在章节流水线和前端视图之间补一个显式恢复对象：

```ts
type ChapterDraftResumeState = {
  chapterId: number
  taskId: number
  status: 'interrupted' | 'resume_available' | 'resuming' | 'unavailable'
  partialContent: string
  reason?: 'network' | 'timeout' | 'cancelled' | 'failed' | 'unknown'
  updatedAt?: string
}
```

最小实现要求：

- 能表达“当前章存在中断草稿”
- 能带出 `partialContent`
- 能区分恢复原因

### 3. 非章节生成统一判重输入

建议统一采用：

```ts
type SimilarityGuardInput = {
  candidateText: string
  rejectedDigests: string[]
  acceptedDigests?: string[]
  threshold?: number
}
```

本轮不一定要新建公共类型文件，但服务层逻辑应统一使用同一判断模式：

- 先拿 rejected digests
- 生成候选
- 质量审校
- 解析候选
- 构造候选摘要
- 用 `isCandidateTooSimilar()` 对比
- 相似则拒绝并记录

## 具体实现步骤

## 第一步：完成 `Writing` 真实拆分

建议顺序：

1. 读取 `Writing/index.tsx` 中 4 块核心 JSX
2. 为 4 个 route 设计共享 props
3. 把以下内容下沉到 route 或组件中：
   - 编辑生产区
   - 上下文区
   - 审校区
   - 历史区
4. 主文件只保留装配与状态逻辑

实施限制：

- 不做整页视觉重写
- 不改变已有业务能力
- 不引入无必要的新页面

## 第二步：实现正文内容级断点恢复

建议顺序：

1. 复用任务失败/取消时已有的 `outputText`
2. 为章节生成链路增加“中断正文草稿”的可识别状态
3. 在写作页或任务中心展示：
   - 已中断
   - 已保留多少内容
   - 继续 / 重开
4. 为“继续”实现新的 continuation 生成逻辑：
   - 原始上下文仍保留
   - 已生成正文作为“已完成部分”
   - 明确要求模型只续写后续内容，不重写已有部分
5. 为“重开”保留现有整章重跑逻辑

实施限制：

- 不要求底层模型 API 支持真正断点续传
- 只做业务级续写
- 如果当前上下文不满足续写条件，要明确提示原因

## 第三步：补齐 5 个已接入变体控制服务的相似度后置判重

服务范围：

- `character`
- `timeline`
- `story-thread`
- `item`
- `faction`

建议统一处理模式：

1. 生成原始输出
2. 通过质量审校
3. 解析为候选对象
4. 为候选生成可比较摘要
5. 与 rejected digests / 必要时 accepted candidates 比较
6. 若过近：
   - `markRejected(historyId)` 或等价拒绝处理
   - 触发下一次尝试，或返回无效变体 warning

## 第四步：补齐覆盖较弱链路

服务范围：

- `map.service.ts`
- `core-settings.service.ts`
- `world-rules.service.ts`

建议优先级：

1. 先确认每条链路是否已有重试入口
2. 缺 variation prompt 的先补 `appendVariationMessage`
3. 缺 rejected digest 的补历史拒绝摘要
4. 最后加相似度 post-check

实施限制：

- 不重写 `map` 的 JSON 修复和质量审校框架
- 不重写 `core-settings` 整个生成步骤编排
- 不扩大到无关资产服务

## 第五步：运行验证

Agent 2 完成后必须运行：

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build`

如某项失败，必须在 `.agent/implementation-report.md` 明确写明：

- 命令
- 结果
- 是否与本轮修改直接相关

## 验收标准

## A. `Writing` 拆分标准

- 4 个 route 文件不再是空壳
- `Writing/index.tsx` 不再独占全部视图逻辑
- 主文件主要承担装配职责
- 原有章节编辑、生成、审校、历史恢复能力未回归

## B. 正文内容级断点恢复标准

- 中断时保留部分正文
- 用户可见中断状态
- 用户可区分“继续”与“重开”
- “继续”确实基于已有内容续写，而不是简单整章重跑
- 网络错误、超时、取消至少在提示层可区分

## C. 非章节去重一致性标准

- 已纳入范围的 5 个服务都具备后置相似度判重
- `map / core-settings / world-rules` 中本轮锁定的生成链路完成缺口补齐
- 重试结果若与拒绝候选过近，会被自动拒绝或明确返回 warning
- 不破坏原有质量审校、JSON 解析和入库逻辑

## D. 工程标准

- 无新增 TypeScript 阻塞错误
- 无新增 lint 阻塞错误
- build 不阻塞
- 不回退无关改动

## 风险控制

### 风险 1：`Writing` 拆分扩大成重构工程

控制：

- 只拆真实视图层
- 不追求一次性完美 hook/store 架构
- 主文件降复杂度优先于“架构漂亮”

### 风险 2：内容恢复误做成整章重跑

控制：

- Agent 2 必须明确新增“继续”与“重开”两条路径
- Agent 3 必须核查 continuation prompt / data flow 确实使用了已生成正文

### 风险 3：相似度判重误伤有效候选

控制：

- 先复用现有阈值 `0.72`
- 优先比较摘要而非全量大对象
- 只在“明显过近”时拒绝

### 风险 4：服务层修改过多引发回归

控制：

- 先修已有 rejected-digest 的 5 个服务
- 再补覆盖较弱链路
- 每个服务只做最小必要修改，不做统一大抽象

### 风险 5：Todo 进度更新失真

控制：

- 只有代码、验证、验收都完成后，才允许更新 `docs/todo/41-功能缺陷与改进清单.md`
- 若只完成部分，必须使用“基础已修复”或“部分修复”，不得直接写“已完成”

## 本轮通过条件

1. `Writing` 拆分完成，空壳 route 被真实视图替换
2. 正文内容级断点恢复可用
3. 非章节去重一致性完成本计划范围内补齐
4. 主流程相关操作仍可进入、编辑、保存、继续
5. 无明显 TypeScript / lint / build 阻塞错误
6. Agent 3 评审结论为 `PASS`
7. 平均验收评分 >= 90
