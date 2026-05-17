# UI 审计报告

## 范围

- 顶层页面：`/novels`、`/models`、`/templates`、`/tasks`、`/prompts`
- `Novel` 工作台模块页：`guide`、`overview`、`project-brief`、`core-settings`、`theme-voice`、`world-rules`、`endgame`、`map`、`factions`、`characters`、`arc-center`、`resistance`、`items`、`glossary`、`scene-templates`、`threads`、`story-design`、`outline`、`volume-design`、`structure`、`timeline`、`info-gap-board`、`foreshadow-ledger`、`growth-system`、`contracts`、`writing`、`writeback`、`revision`、`quality`、`batch-workbench`
- 二级可切换视图：
  - `Writing`：`editor` / `context` / `review` / `history`
  - `CoreSettings`：`anchors` / `rhythm` / `subplots`
  - `WorldRules`：`overview` / `power` / `species` / `ecology` / `map` / `dynamics` / `timeline` / `language`
  - `ItemsWorkspace`：`overview` / `details` / `connections`
  - `QualityDashboard`：`overview` / `language` / `structure` / `stability`
  - `TemplateManager`：`style` / `world` / `writing_step`
  - `ForeshadowLedger`：`board` / `table`
  - `StoryThreads`：`board` / `foreshadow`
  - `Resistance`：`characters` / `factions` / `environment` / `institution`
  - `MapExplorer`：主画布、图谱、检索与编辑抽屉、批量生成弹窗

## 结论

- 乱码：`npm run check:encoding` 通过，未发现编码乱码。
- 逻辑问题：存在，且有 1 个确定性问题和多处 Hook/状态稳定性风险。
- 无效代码：存在明显的未接入目录 `src/pages/Novel/GuidedStep`，属于遗留页面。
- 重复备注：存在多处“这里会显示/汇总/展开”式说明文案，属于可压缩的重复备注风格。

## 已确认问题

### 高优先
- `src/components/novel/layout/ProjectSidebar.tsx`
  - 问题：在 `useEffect` 中同步 `setOpenGroups`，会触发 React lint 错误并造成状态派生不必要的二次渲染。
  - 风险：侧栏展开状态与当前模块切换耦合过强，容易出现额外渲染和状态漂移。

### 中优先
- `src/pages/Novel/index.tsx`
  - 问题：工作台重置 effect 引用了 `currentPage`，但依赖项不完整。
- `src/pages/Novel/Guide/index.tsx`
  - 问题：`steps` 作为内联数组参与后续 `useMemo` 依赖，导致依赖不稳定。
- `src/pages/Novel/CharacterArcCenter/index.tsx`
  - 问题：`refresh` 未稳定化，且 `characters` / `relations` 直接用逻辑表达式生成新数组。
- `src/pages/Novel/Contracts/index.tsx`
  - 问题：`refreshAll` / `loadChapterData` 作为 effect 依赖不稳定。
- `src/pages/Novel/CoreSettings/index.tsx`
  - 问题：`applyStoryDesignDraft`、`clearStoryDesign` 依赖不稳定。
- `src/pages/Novel/Endgame/index.tsx`
  - 问题：`handleClear` 使用 `useMemo` 包裹函数，语义不清且依赖不稳定。
- `src/pages/Novel/GrowthSystem/index.tsx`
  - 问题：保存轨道/资源池/回写事件的快捷注册依赖不稳定。
- `src/pages/Novel/Overview/index.tsx`
  - 问题：`applyOverviewDraft` 未稳定化。
- `src/pages/Novel/Premise/index.tsx`
  - 问题：`handleClear` 依赖注册不稳定。
- `src/pages/Novel/ProjectBrief/index.tsx`
  - 问题：`applyProjectBriefDraft`、`handleClear` 依赖不稳定。
- `src/pages/Novel/Resistance/index.tsx`
  - 问题：`refresh` 和多个下游数组依赖不稳定。
- `src/pages/Novel/ThemeVoice/index.tsx`
  - 问题：`applyThemeVoiceDraft`、`handleClear` 依赖不稳定。
- `src/pages/Novel/Timeline/index.tsx`、`src/pages/Novel/Timeline/useTimelineWorkspace.ts`
  - 问题：workspace / clear 相关 effect 依赖不稳定。
- `src/pages/Novel/VolumeDesign/index.tsx`
  - 问题：`loadData` effect 依赖不稳定。
- `src/pages/Novel/Factions/index.tsx`
  - 问题：`refresh` 受 `keyword` 影响且会同步驱动图谱刷新，属于高频输入场景。
- `src/pages/Novel/Glossary/index.tsx`
  - 问题：`refresh` 受 `keyword` 与 `canonicalFilter` 影响，过滤切换会触发整页重载。
- `src/pages/Novel/SceneTemplates/index.tsx`
  - 问题：`refresh` 受 `keyword` 与 `scope` 影响，属于同类刷新依赖问题。
- `src/pages/Novel/MapExplorer/MapExplorerPage.tsx`
  - 问题：`refreshVisible`、`refreshGeneratedContent`、`loadRoots`、`loadGraph`、`resetBatchForm` 等 effect/回调链较长，稳定性风险最高。

### 低优先
- `src/pages/TaskCenter/index.tsx`
- `src/pages/PromptManager/index.tsx`
- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/QualityDashboard/index.tsx`
  - 问题：存在多处重复的说明式空态文案，例如“这里会显示/汇总/展开”，属于可压缩的备注风格。
- `src/pages/Novel/workspace-quality-context.tsx`
  - 问题：Fast Refresh 告警，文件同时导出 context、hook 和组件，属于结构性告警，不影响运行但不利于热更新体验。

## 修复建议

1. 先修 `ProjectSidebar` 和所有 Hook 稳定性问题，保证导航、保存、清空、加载流程不再依赖不稳定闭包。
2. 再压缩重复说明式文案，保留必要的空态提示，删除“功能解释型备注”。
3. 最后处理 Fast Refresh 告警和残余的无效结构。
4. 修复后重新跑 `eslint`，确保 `react-hooks/exhaustive-deps` 不再报新增问题。

## 备注

- 本次未发现乱码。
- 本次未发现明显死代码块，但部分页面存在需要进一步收敛的说明性文案和状态派生逻辑。

## AI 生成覆盖补充审计（2026-05-17）

### 审计目标

- 检查所有 `Novel` 工作台界面的“每个小块步骤”是否具备合理的 AI 生成入口。
- 重点保证 AI 生成不是孤立按钮，而是能够读取当前小说上下文，包括题材、背景、项目立项、基础设定、故事设计、主题文风、世界规则、终局设计，以及可选的人物/线程/伏笔/阻力/卷章资产。
- 对纯审计页、看板页、历史页不机械加按钮，只对“可直接回填策划数据”的编辑块补 AI。

### 新增共享能力

- 新增共享上下文组装器：`src/pages/Novel/shared/planning-context.ts`
  - 统一汇总书名、题材、一句话简介、扩展背景、项目立项、基础设定、故事设计、主题与文风、写作边界、世界规则、终局设计。
- 扩展共享草稿工具：`src/pages/Novel/shared/ai-draft.ts`
  - 新增按标题/别名匹配现有资产 ID 的工具，用于把 AI 返回的“线程标题/终局承诺标题/伏笔标题/卷标题”等安全映射回多选控件。

### 本轮已补齐的块级 AI 入口

- `ProjectBrief`
  - `赛道与读者承诺`
  - `边界与交付`
- `Premise`
  - `基础设定编辑器`
  - `语言与写作边界`
- `CoreSettings`
  - `故事锚点`
  - `当前支线`
- `ThemeVoice`
  - `主题与叙事调度`
  - `文风执行规则`
- `Endgame`
  - `终局锚点`
  - `兑现与留白`
- `VolumeDesign`
  - `卷级闭环`
  - `终局绑定与阻力清单`
- `Contracts`
  - `章节合同`
  - `场景合同（逐场景）`
- `Resistance`
  - `阻力线编辑`
  - `登记阻力推进`
- `CharacterArcCenter`
  - `当前人物弧`
  - `当前关系弧`
  - `推进节点`
- `StoryThreads`
  - `单条故事线程编辑弹窗`
- `ForeshadowLedger`
  - `单条伏笔资产编辑弹窗`
- `GrowthSystem`
  - `成长轨道编辑弹窗`
  - `资源池编辑弹窗`
  - `章节回写编辑弹窗`
- `SceneTemplates`
  - `单条场景模板编辑区`

### 已有 AI 覆盖，未重复造轮子

- `Overview`
  - 已有基础信息与包装类 AI 生成。
- `Outline`
  - 已有故事弧草稿/批量故事弧生成。
- `Structure`
  - 已有章节/场景级 AI 生成。
- `Timeline`
  - 已有事件草稿生成。
- `WorldRules`
  - 已有整页/分区 AI 生成能力。
- `Characters`
  - 已有人物草稿、主角生成、人物网络生成。
- `Factions`
  - 已有势力草稿与批量势力生成。
- `Glossary`
  - 已有术语草稿生成。
- `ItemsWorkspace`
  - 已有物品模板/实例内容与批量物品生成。
- `MapExplorer`
  - 已有节点补全与层级骨架生成。
- `RevisionCenter`
  - 已有修订任务生成。
- `Guide`
  - 已有首批初始化生成链路。

### 明确不加块级 AI 的页面

- 纯审计/结果页
  - `QualityDashboard`
  - `InfoGapBoard`
  - `WritebackCenter`
- 纯容器/导航页
  - `Novel/index`
- 纯批处理工作台
  - `BatchWorkbench`
- 明显遗留页
  - `GuidedStep`
  - 该目录仍属于未接入遗留结构，不作为当前主工作流 AI 覆盖目标。

### 结论

- 当前主工作流中，凡是“直接编辑策划资产或步骤字段”的页面，已基本补齐块级 AI 生成入口。
- 生成入口均已接入共享上下文，不再是孤立 prompt，能够读取框架、人物、世界、终局、线程、伏笔、阻力、卷章等信息。
- 多选绑定类字段已支持通过标题回填到现有资产 ID，避免 AI 生成完只能停留在纯文本层。
- 当前代码验证结果：
  - `npm run typecheck` 通过
  - `npm run lint` 通过

### Claude 复审结果

- 已调用本地 Claude CLI 对本轮 AI 覆盖改动进行复审。
- Claude 发现并已修复的问题：
  - `Premise` 的 `workspaceKey` 与 `CoreSettings` 冲突。
  - `Premise` / `Endgame` 的质量修复控制器缺少 `persistPreview`。
  - `Endgame` 使用 `useMemo` 包裹清空回调，已改为 `useCallback`。
  - `CoreSettings` 的支线生成轮询缺少卸载保护，已补充挂载状态检查。
- Claude 未发现本轮新增 AI 按钮存在明显字段映射错误或不该加按钮的页面。
