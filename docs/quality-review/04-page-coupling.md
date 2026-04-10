# 04 超大页面与前端耦合

主题范围：单文件过大、信息层级混乱、Hook 依赖、组件复用粗糙、全局错误边界。

## P1-1 Writing / ItemsWorkspace / QualityDashboard 超大组件

**问题**：几个核心工作区页面把 CRUD、列表、编辑器、AI 控制台、校验面板等若干职责塞进同一个 .tsx 文件：

| 文件 | 行数 | 主要职责 |
|---|---|---|
| `src/pages/Novel/Writing/index.tsx` | 1986 | 章节列表 + 编辑器 + 场景规划 + 审校 + 锁段 + 历史 |
| `src/pages/Novel/QualityDashboard/index.tsx` | 1746 | 热力图 + 对话指纹 + 伏笔债务 + 节奏压力 + 翻译对比 |
| `src/pages/Novel/ItemsWorkspace/index.tsx` | 1335 | 物品列表 + 装备 + 获取消耗事件 + 库存 |
| `src/pages/Novel/CoreSettings/index.tsx` | 945 | 主角 + 配角 + 故事线 + 主题冲突 |

**证据**：行数统计来自 `wc -l`；每个文件内都存在超过 15 个 useState 和多组互相依赖的 useEffect。

**影响**：
- 增删改查任一分支失败时整个页面卡顿或短暂白屏。
- 代码难以 review，重构成本极高。
- store 订阅粒度过粗，一个字段变化触发整页重渲染。

**修复方案**：并入**任务一 1.3**。Writing 用嵌套子路由拆为 `editor / context / review / history`，其余用 antd Tabs 就地拆分。拆分时把每个 Tab 子组件放在同目录 `./tabs/` 下，并通过 `React.lazy` 异步加载。

**fixed-by**：任务一 1.3，阶段 3 内完成全部拆分。

---

## P1-3 QualityDashboard 加载状态缺失

**问题**：`src/pages/Novel/QualityDashboard/index.tsx` 初始进入时会并发加载若干指标（热力图、漂移告警、AI 评分历史），但页面顶层没有统一的 Skeleton / Spin，空数据和加载中视觉上无法区分——页面会短暂展示"空"。

**证据**：组件顶部只有 `setLoading(true)` 变量，但渲染分支只在子卡片各自内部做 `loading && <Spin />`，父级没有 aggregate 的 Skeleton。

**影响**：用户会误以为小说还没有评分数据，从而手动重新触发评分任务（浪费 token）。

**修复方案**：拆分（任务一 1.3）后在 `QualityDashboard/tabs/Overview.tsx` 入口包一层 `<Suspense fallback={<Skeleton active />}>`，并把子 Tab 统一改为 lazy component。

**fixed-by**：任务一 1.3。

---

## P0-5 Layout 缺全局错误边界（已修）

**问题**：`src/components/Layout/index.tsx` 直接把 `{children}` 塞进 `<Content>`，任何子页面抛错都会让整个应用白屏。只有 `src/pages/Novel/index.tsx` 内部通过 `WorkspaceErrorBoundary` 保护 Novel 子页面，其余路由（NovelList / Models / Templates / Prompts / TaskCenter）没有保护。

**已在阶段 1 修复**：新建 `src/components/Layout/AppErrorBoundary.tsx`，在 `AppLayout` 的 Content 容器内包一层，使用 `location.pathname` 作为 resetKey，跨路由切换时自动清除错误状态。

**fixed-by**：阶段 1 已修。

---

## P0-6 AIScorePanel / ai-result.store 类型 unknown（已修）

**问题**：`src/stores/ai-result.store.ts` 的 `PendingAiResult<T = unknown>` 使用 unknown 默认值，Premise 页在消费时通过 `as PendingAiResult<PremiseGenerationResultWithMeta>` 手工 cast，绕开了 TS 的类型安全。未来添加第二个 `AiResultTaskType` 时，两种 result 类型会在同一张 map 里混存，没有编译期保护。

**已在阶段 1 修复**：`src/stores/ai-result.store.ts` 重写为 discriminated union——`PendingAiResult = { taskType: 'premise_generate'; result: PremiseGenerationResultWithMeta } & PendingAiResultBase`；未来新增 taskType 时通过 `|` 并联。`src/pages/Novel/Premise/index.tsx` 去掉手工 cast。

**fixed-by**：阶段 1 已修。

---

## P2-4 Guide / Outline / Overview Hook 依赖数组不完整

**问题**：这几个页面内大量 `useCallback` / `useEffect` 的依赖数组漏掉了当前 `novelId`，导致切换小说时仍然使用上一次的 id 触发行为（尤其是"开始写作"类按钮）。

**证据**：ESLint `react-hooks/exhaustive-deps` 目前在 `.eslintrc` 里是 warn 级别，控制台大量黄色警告。

**影响**：偶发的"跨小说写入"类 bug，用户投诉难以复现。

**修复方案**：
1. 先把 `react-hooks/exhaustive-deps` 升级为 error，修掉所有现存告警。
2. 拆分页面（任务一 1.3）时统一把 `novelId` 作为顶层 prop 传入，内部只依赖 prop，不再从 URL 解析。

**fixed-by**：任务一 1.3 同步完成。
