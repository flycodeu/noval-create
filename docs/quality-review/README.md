# NovelForge 质量评审报告

生成日期：2026-04-10
评审范围：src/、electron/、schema、IPC、stores、pages 的整体产品与工程质量

本次评审是 2026 年 Q2 布局重构 + AI 质量优化推进的前置诊断。目标是把此前散落在各处的质量隐患集中列表化，按严重度分级，并与后续任务一（UI 布局）、任务二（AI 链路）的具体子项挂钩，方便并行推进和验证。

## 严重度定义

- **P0**：影响核心功能或数据安全，必须在阶段 1 内修复或验证。
- **P1**：影响日常体验，在阶段 2 前需要有明确修复计划。
- **P2**：可维护性/扩展性风险，在阶段 3 内处理，或列入长期欠债清单。

## 评审子文档

- [01 AI 生成反馈缺失](./01-ai-feedback-gaps.md) — Writing 页 AI 生成无 loading / error / empty state、AIGenerateButton 无重试
- [02 跨模块数据级联](./02-data-cascade.md) — 10 张表 CRUD 级联、世界状态版本追踪
- [03 Store 与 IPC 同步](./03-store-ipc-sync.md) — Store 更新重渲染、IPC 统一错误处理、Task 错误消费
- [04 超大页面与前端耦合](./04-page-coupling.md) — Writing / QualityDashboard / ItemsWorkspace 耦合、Layout 错误边界、Hook 依赖、AIScorePanel 类型
- [05 Context 服务边界](./05-context-boundary.md) — Context 溢出检测、P0-P3 分配边界
- [06 工作流韧性](./06-workflow-resilience.md) — 长任务断点续传、workflow task 状态持久化
- [07 测试缺口](./07-testing-gap.md) — 无自动化测试，重构易回归

## 问题总览（按严重度）

### P0

| # | 问题 | 子文档 | fixed-by |
|---|---|---|---|
| P0-1 | Writing 页 AI 生成缺少完整反馈（loading/error/empty） | 01 | 任务一 1.3（Writing 子路由化后引入统一状态机） |
| P0-2 | 跨模块数据级联无校验（删除角色未清理关联） | 02 | 独立 hotfix，阶段 2 内 |
| P0-3 | AIGenerateButton 无失败重试机制 | 01 | 独立 hotfix，阶段 2 内 |
| P0-4 | Store 更新未触发订阅页面重渲染（batch 操作场景） | 03 | 独立 hotfix，阶段 2 内 |
| P0-5 | Layout 缺全局错误边界 | 04 | **阶段 1 已修**：`src/components/Layout/AppErrorBoundary.tsx` |
| P0-6 | AIScorePanel / ai-result.store 类型 unknown | 04 | **阶段 1 已修**：`src/stores/ai-result.store.ts` discriminated union |

### P1

| # | 问题 | 子文档 | fixed-by |
|---|---|---|---|
| P1-1 | Writing / ItemsWorkspace / QualityDashboard 单文件过大 | 04 | 任务一 1.3 拆分 |
| P1-2 | Context 服务无溢出检测 | 05 | 任务二 2.1 / 2.4 |
| P1-3 | QualityDashboard 加载状态缺失 | 04 | 任务一 1.3 拆分后加 Suspense |
| P1-4 | 265 个 IPC handler 无统一错误处理 | 03 | 阶段 2 内统一 wrapper |
| P1-5 | 世界状态版本追踪不完整（关联实体变更未自动 track） | 02 | 阶段 3 内补齐 |

### P2

| # | 问题 | 子文档 | fixed-by |
|---|---|---|---|
| P2-1 | 无单元测试覆盖 | 07 | 长期欠债，阶段 3 起引入 vitest |
| P2-2 | Tasks 表 errorMessage 前端未充分强调 | 03 | **阶段 1 已修**：TaskCenter 列表卡片加红色错误样式 |
| P2-3 | Timeline / Faction 自动生成 workflow 无断点续传 | 06 | 阶段 3 内补齐 |
| P2-4 | Guide / Outline / Overview Hook 依赖数组不完整 | 04 | 任务一 1.3 拆分同步 |

## 已在阶段 1 修复的项

- **P0-5 Layout 错误边界**：新建 `src/components/Layout/AppErrorBoundary.tsx`，包裹 `AppLayout` 的 children，以 `location.pathname` 作为 resetKey，避免单个页面 crash 击穿整个应用。
- **P0-6 ai-result.store 类型**：将 `PendingAiResult<T = unknown>` 重构为 discriminated union，按 `taskType` 判别 `result` 的精确类型；Premise 页面去掉手工 `as` cast。
- **P2-2 TaskCenter 错误强调**：列表卡片在 `task.errorMessage` 存在时以红色左边栏 + "失败原因：" 前缀展示，避免错误信息混在普通摘要里被忽略。
- **布局滚动链**（任务一 1.1）：`src/components/Layout/index.tsx` Content 改为 `height: 100%; overflow: auto` 的固定高度容器；`src/styles/global.css` 末尾追加 `scroll-isolation-fix` 块，将 `.novel-route-shell` 强制为 `grid + 1fr row + overflow: hidden`，`.novel-route-shell__sidebar` 恢复 flex 列内部滚动，`.novel-route-shell__content-body` 成为唯一的右侧滚动容器。

## 推进方式

1. 阶段 1 的修复项已合并，后续每次合并本报告相关修复时，在 fixed-by 列后追加 commit hash。
2. 未修复项在阶段 2 / 3 计划里按 fixed-by 反查，避免遗漏。
3. 如果诊断结论与实际代码冲突（例如 TaskCenter errorMessage 其实已经渲染了），在对应子文档里用"复核结论"段落更新，而不是直接删除条目，保留评审痕迹。
