# 项目审计报告

更新时间：2026-05-03  
角色：Agent 1（项目审计与方案设计）  
约束：本轮只审计，不修改业务代码；仅输出 `.agent/*.md`

## 1. 审计范围与方法

本次审计基于当前仓库实际代码扫描，重点覆盖以下区域：

- 主工作区路由与页面装配
  - `src/App.tsx`
  - `src/pages/Novel/index.tsx`
  - `src/shared/novel-workspace.ts`
  - `src/pages/Novel/workflow.ts`
- AI 小说主流程页面
  - 立项/概览/基础设定/主题文风/世界规则/终局
  - 角色/势力/地图/物品/词典/场景模板
  - 线程/大纲/卷设计/结构/时间轴/信息差/伏笔/成长/阻力
  - 章节合同/正文写作/章后回写/修订/质量
- 管理后台页
  - `src/pages/TemplateManager/index.tsx`
  - `src/pages/PromptManager/index.tsx`
- 状态与持久化
  - `src/stores/workspace.store.ts`
  - `src/stores/novel.store.ts`
  - `electron/preload.ts`
  - 各类 `window.electron.*` 调用链
- 风险扫描
  - `TODO` / `FIXME` / `TBD`
  - 占位页、未完成按钮、mock 依赖、整页 loading / spinner、样式混乱

使用的扫描方式：

- 全仓 `rg` 扫描 `TODO|FIXME|TBD|placeholder|mock|Spin|loading`
- 扫描小说工作区相关文件树
- 读取主路由、工作区共享定义、关键页面、模板系统、写作页和工作台页代码片段
- 交叉核对前端是否已接入 Electron 持久化桥

## 2. 总体结论

当前仓库不是“缺主流程页面”的状态，而是“主流程页面基本齐全，但存在三类结构性问题”：

1. 工作区体验已从旧版逐步迁移到新版，但仍存在新旧工作流并存、部分页面仍采用整页 loading 的问题。
2. 数据持久化大体已接通，大多数关键页面都直接调用 `window.electron.*` 保存；主要短板不在“完全没保存”，而在“刷新策略、状态回灌、页面切换体验、模块间闭环提示不统一”。
3. 模板系统、提示词系统、部分生产页的 UI/交互标准没有跟小说工作区统一，导致体验断层明显。

结论上：

- 主流程闭环基础已存在。
- P0 不应再做“从零补页面”，而应优先修“工作区切换与刷新策略、主链路页面体验一致性、模板系统交互质量”。
- P1 才是继续统一后台管理页、减少新旧页面并存、收拢状态流。
- P2 适合处理结构性重构和更深层的数据模型归一。

## 3. 扫描结果摘要

### 3.1 TODO / FIXME / TBD

显式 `TODO/FIXME/TBD` 非常少，未发现大量注释式待办堆积。说明当前技术债主要不是“留了 TODO 没做”，而是已经落地实现中存在：

- 老逻辑残留
- 页面间模式不一致
- 状态流分散
- 局部体验劣化

仅扫描到少量业务文本中的 `TBD`，不构成计划依据。

### 3.2 路由与页面接入状态

顶层路由已接入：

- `src/App.tsx`
  - `/novels`
  - `/novels/:id/*`
  - `/templates`
  - `/prompts`
  - `/tasks`
  - `/models`

小说工作区主路由已接入：

- `src/pages/Novel/index.tsx`
- `src/shared/novel-workspace.ts`

工作区模块定义完整，覆盖：

- 基础信息 / 项目立项 / 基础设定 / 主题与文风 / 世界规则 / 终局设计
- 地图 / 角色 / 势力 / 物品 / 词典 / 场景模板
- 故事线程 / 故事设计 / 大纲 / 卷级设计 / 结构 / 时间轴 / 信息差 / 伏笔 / 成长 / 阻力
- 合同 / 正文 / 回写 / 修订 / 质量 / 回滚台

审计判断：

- “未接入路由”不是当前主要问题。
- 主要问题是“已接入，但体验和实现模式不一致”。

### 3.3 新旧页面并存

检测到明显的新旧工作流并存：

- `src/pages/Novel/index.tsx` 同时引入：
  - `Guide`
  - `ProjectBrief`
  - `Premise`
  - `CoreSettings`
  - `Overview`
  - 新工作区模块页
- `src/pages/Novel/workflow.ts` 保留 guided workflow 逻辑
- `src/pages/Novel/GuidedStep/index.tsx`
- `src/pages/Novel/Premise/index.tsx`
- `src/pages/Novel/ProjectBrief/index.tsx`

风险：

- 用户认知上会出现“基础设定/立项/概览/引导页”职责重叠。
- 代码层面会出现同一业务被多个页面维护的情况。
- 工作区推荐下一步与实际编辑入口可能不完全一致。

结论：

- 这是 P1 级问题。
- 本轮不建议删除旧页，但应在计划里明确“以当前工作区模块为主，旧页只保留兼容入口，不继续扩张逻辑”。

## 4. 关键问题清单

## 4.1 P0 级问题

### A. 工作区仍存在局部整页 loading / 明显转圈，破坏无感切换

证据文件：

- `src/pages/Novel/Writing/index.tsx`
  - 存在 `loading` 全页分支：`{loading ? <div className="chapter-console-page__loading"><Spin ...`
- `src/pages/Novel/Contracts/index.tsx`
  - 初始 loading 与 refreshing 已区分，但仍需核实后续刷新是否完全保留内容
- `src/pages/Novel/QualityDashboard/index.tsx`
  - 已有 `loading` / `refreshing` 双态，但需统一检查
- `src/pages/Novel/Timeline/useTimelineWorkspace.ts`
  - 仍以 `setLoading(true)` 驱动核心数据刷新
- `src/pages/PromptManager/index.tsx`
  - `if (loading) return <Spin />`
- `src/pages/TemplateManager/index.tsx`
  - 仅有单一 `loading`，无“首屏加载 / 后续轻刷新”分离

影响：

- 切换章节、切换菜单、刷新数据时，用户会感知到整个界面重新加载。
- 与 `src/pages/Novel/index.tsx` 已经做的 visited page caching 目标不一致。

结论：

- 这是当前体验类最高优先级问题。

### B. 正文生产台仍是全屏式重载思路，和“工作区保活”目标冲突

证据文件：

- `src/pages/Novel/Writing/index.tsx`

问题表现：

- 正文页是核心高频页，但当前仍保留整页 `loading` 分支。
- 该页数据量大、子路由多（editor/context/review/history），一旦整页 loading，会被用户感知为“菜单切一下整个页面都没了”。

结论：

- 写作页是 P0 中的第一批治理对象。

### C. 模板系统已接入持久化，但交互和视觉标准与主工作区脱节

证据文件：

- `src/pages/TemplateManager/index.tsx`
- 路由已接：`src/App.tsx`
- 持久化已接：`window.electron.template.list/create/update/delete`

已知问题：

- 仅有单一 `loading` 状态，没有轻量刷新态。
- 内置模板“查看”与自定义模板“编辑”共用弹窗，但只读/可编辑状态切换较生硬。
- 卡片操作区虽已缩小，但整体标准仍偏后台 CRUD，与工作区风格不统一。
- 与用户之前反馈一致：模板页是视觉割裂点之一。

结论：

- 模板系统修复应纳入 P0，不应延后。

### D. “主流程闭环提示”存在，但模块间推进反馈不统一

证据文件：

- `src/shared/novel-workspace.ts`
- `src/pages/Novel/workflow.ts`
- `src/pages/Novel/Studio/index.tsx`
- `src/pages/Novel/Guide/index.tsx`

问题：

- 系统已能给出 next step、blocker、readiness，但各页面不一定都在保存后及时回灌这些状态。
- 页面间的刷新策略不同，导致 blocker 清理后，用户不一定立刻在所有相关页看到统一结果。

结论：

- 这是主流程可用性问题，属于 P0。

## 4.2 P1 级问题

### E. 工作区状态管理过薄，页面级状态过重

证据文件：

- `src/stores/workspace.store.ts`

现状：

- store 只保存 `mode`
- 大量工作区关键状态分散在页面内部：
  - loading / refreshing
  - 当前选中实体
  - 局部筛选
  - 路由参数映射
  - 刷新 token / mutation token

风险：

- 切页保活与局部刷新逻辑难统一
- 各页面各写一套 loading 模式
- 需要依赖局部 `useEffect` 重取，进一步放大闪烁

结论：

- 是重要结构问题，但本轮不应大规模改 Zustand 架构。
- 应先用“统一页面加载规范 + 统一 mutation 回调”止血。

### F. 旧页与新页职责重叠，后续维护成本高

主要涉及：

- `Premise`
- `ProjectBrief`
- `Guide`
- `GuidedStep`
- `Overview`
- `CoreSettings`

问题：

- 不是功能不可用，而是职责边界不干净。
- 新人维护容易误把逻辑加到旧页里。

结论：

- P1 需要明确页面职责、入口优先级和兼容策略。

### G. 提示词系统也是独立后台页，体验未对齐

证据文件：

- `src/pages/PromptManager/index.tsx`

问题：

- 与模板系统一样，仍是独立后台风格。
- `if (loading)` 整页 loading。
- 与小说工作区上下文关系弱，难形成“提示词配置 -> 正文生产”直达链路感知。

结论：

- P1 处理，与模板系统保持同一整改方向。

### H. 样式层存在主题/全局覆盖历史负担

证据文件：

- `src/styles/global.css`

现状：

- 全局样式体量较大，含大量主题覆盖、Novel 专项覆盖和 loading 样式。
- 历史样式较多，局部修复容易继续叠补丁。

结论：

- 当前应谨慎局部修，不应本轮大拆。
- 作为 P1/P2 风险点记录。

## 4.3 P2 级问题

### I. 数据模型有逐步完善痕迹，但跨模块共享结构尚未完全归一

证据：

- `src/shared/novel-workspace.ts`
- `src/shared/workspace-types.ts`
- `src/shared/story-settings.ts`
- `src/shared/world-rules-draft.ts`
- 多页面直接拼接页面内 view model

表现：

- 统一领域模型已有雏形
- 但大量页面仍用本地 `useMemo` 组装自己的 UI 数据

结论：

- 适合后续做 view-model 层收敛，不列入本轮必须完成项。

### J. 业务合理性层面仍可继续加强自动联动

例如：

- 世界规则变化后，是否主动提示角色/势力/地图重检
- 章节合同变化后，是否自动刷新正文写作可写性
- 回写完成后，是否自动刷新时间轴/角色弧/伏笔账本摘要

目前已有部分联动，但不完全统一。此项作为 P2 延后。

## 5. 页面与流程审计

### 5.1 已基本接通的主流程

以下主流程页面大多数已接入持久化，且不是空壳：

- 立项与概览
  - `src/pages/Novel/Overview/index.tsx`
  - `src/pages/Novel/ProjectBrief/index.tsx`
  - `src/pages/Novel/Premise/index.tsx`
  - `src/pages/Novel/CoreSettings/index.tsx`
  - `src/pages/Novel/ThemeVoice/index.tsx`
  - `src/pages/Novel/WorldRules/index.tsx`
  - `src/pages/Novel/Endgame/index.tsx`
- 世界资产
  - `Characters`
  - `Factions`
  - `MapExplorer`
  - `ItemsWorkspace`
  - `Glossary`
  - `SceneTemplates`
- 结构规划
  - `StoryThreads`
  - `Outline`
  - `VolumeDesign`
  - `Structure`
  - `Timeline`
  - `InfoGapBoard`
  - `ForeshadowLedger`
  - `GrowthSystem`
  - `CharacterArcCenter`
  - `Resistance`
- 章节生产
  - `Contracts`
  - `Writing`
  - `WritebackCenter`
- 质量闭环
  - `RevisionCenter`
  - `QualityDashboard`

审计结论：

- “页面缺失”不是主问题。
- “页面间切换、刷新和反馈标准不统一”才是主问题。

### 5.2 小说主流程缺口

当前仍存在的闭环缺口：

1. 章节合同 -> 正文 -> 回写 -> 质量 的反馈体验不统一  
   问题不是没接口，而是刷新与回显不一致，用户难以形成稳定心智。

2. 主工作区推荐下一步已存在，但部分页面未以同样方式强化“当前阻塞 / 当前下一步 / 已保存后可继续去哪”。

3. 模板/提示词作为“生产工具后台”，与主工作区关系没有形成明显桥接体验。

## 6. 未完成按钮 / 空函数 / 占位实现审计结论

未发现大量真正的空函数或整页占位页。当前仓库大多数按钮都已接逻辑或有合理 disabled 条件。

但发现以下“软未完成态”：

- 很多页面通过 `message.warning(...)` 或 disabled 保护阻断操作，但未提供足够的下一步引导。
- 部分后台页仍是基础 CRUD 形态，功能虽接通，但体验上仍像临时管理台。
- 部分刷新逻辑仍使用整页 loading，功能可用但交互体验未达标。

## 7. 持久化与状态流审计

### 7.1 持久化情况

模板系统已接：

- `window.electron.template.list`
- `window.electron.template.create`
- `window.electron.template.update`
- `window.electron.template.delete`

提示词系统已接：

- `window.electron.prompt.list`
- `window.electron.prompt.save`
- `window.electron.prompt.delete`

小说主流程大量页面已直连 Electron：

- `novel`
- `character`
- `faction`
- `map`
- `item`
- `thread`
- `outline`
- `structure`
- `timeline`
- `writeback`
- `revision`
- `quality`

结论：

- “未完成数据持久化”只在局部体验层面存在，不是大面积未接接口。

### 7.2 状态流问题

主要问题：

- 页面级 `loading` / `refreshing` 模式未统一
- 页面之间刷新粒度不一致
- store 过薄，跨页共享状态依赖 props、路由和局部副作用

这会直接放大用户反馈中的：

- 切页转圈
- 整页刷新感
- 保存后状态更新不及时

## 8. 本轮必须修与延后项

### 本轮必须修

- 小说主工作区高频页的整页 loading / 转圈问题
- 正文写作页、章节合同页、工作台页的“首屏加载 vs 后续轻刷新”统一
- 模板系统交互与布局对齐当前工作区标准
- blocker / next step / 保存后状态回灌的一致性
- 保证主链路：立项 -> 世界观/角色/结构 -> 合同 -> 正文 -> 回写 -> 修订/质量 可连续进入、编辑、保存、继续操作

### 本轮明确延后

- 彻底移除旧 guided 流程页面
- 大规模重构 Zustand store
- 全局 CSS 体系重建
- 深层领域模型归一
- 更激进的跨模块自动联动改造

## 9. 建议给 Agent 2 的执行原则

1. 不做“大重写”，优先清 P0 的用户可感知问题。
2. 不回退已有工作区缓存切页能力，应在此基础上统一各页面刷新策略。
3. 主链路页优先级高于后台管理页，但模板系统用户已明确点名，必须纳入本轮。
4. 能用现有 Electron API 解决的问题，不新增不必要抽象。
5. 任何页面修复都必须同时补：
   - 初始加载态
   - 后续刷新态
   - 错误提示
   - 保存后回灌
   - 与工作区 blocker / next step 的联动

## 10. 审计结论

当前仓库具备成为完整 AI 小说创作闭环工作台的基础，问题集中在“体验与状态管理收口”而不是“缺业务页”。  
本轮最佳策略是：

- 先把工作区主链路页的整页 loading 和刷新抖动压下去
- 统一模板/提示词后台页和工作区的交互标准
- 用小范围、确定性的状态流修补，保障小说创作流程连续可用

这将比继续新增页面或大规模重构更符合当前仓库收益。
