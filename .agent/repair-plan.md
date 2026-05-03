# 修复计划

更新时间：2026-05-03  
角色：Agent 1（项目审计与方案设计）  
适用对象：Agent 2 仅按本计划编码；Agent 3 按本计划验收

## 修复目标

本轮修复目标不是新增一套新系统，而是在现有 AI 小说工作台基础上，完成以下结果：

1. 消除小说主工作区高频页面的“整页切换 / 整页转圈 / 明显重载感”。
2. 统一主流程页面的加载与刷新模式，确保首屏加载一次、后续刷新尽量局部进行。
3. 修复模板系统等后台页的布局、操作区、颜色与交互，使其与当前工作区视觉和行为标准一致。
4. 保证 AI 小说核心闭环可连续使用：
   - 立项
   - 世界观 / 角色 / 势力 / 地图 / 物品 / 线程 / 结构
   - 章节合同
   - 正文生成 / 编辑
   - 章后回写
   - 修订
   - 质量检查
5. 保持现有持久化链路可用，不因局部修复破坏已有功能。

## 本轮范围

### 纳入本轮

- 小说主工作区高频页面体验修复
- 模板系统体验修复
- 提示词系统基础体验对齐
- 主流程状态回灌与页面刷新模式统一
- 必要的类型、错误处理、基础交互补齐

### 不纳入本轮

- 删除旧 guided 页面
- 大规模替换 Zustand 方案
- 大范围数据库 schema 重构
- 全局样式系统重建
- 所有页面全面视觉重做

## P0 / P1 / P2 优先级

## P0

### P0-1 工作区高频页去整页 loading

目标页面：

- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/Contracts/index.tsx`
- `src/pages/Novel/Studio/index.tsx`
- `src/pages/Novel/QualityDashboard/index.tsx`
- `src/pages/Novel/WritebackCenter/index.tsx`
- `src/pages/Novel/Timeline/useTimelineWorkspace.ts`

要求：

- 首屏无数据时允许显示整页 loading
- 页面已有内容时，刷新、保存后回拉、切换子页签时不得清空整页
- 使用轻量刷新提示、局部 loading 或按钮 loading 替代整页 spinner

### P0-2 模板系统修复

目标页面：

- `src/pages/TemplateManager/index.tsx`

要求：

- 统一卡片布局、按钮尺寸、只读态与编辑态表现
- 首屏加载与后续刷新分离
- 内置模板查看与自定义模板编辑体验更清晰
- 样式不得再出现浅色文字难辨认、按钮突兀、卡片区密度失衡

### P0-3 主流程保存后状态回灌一致性

重点页面：

- `Overview`
- `ProjectBrief`
- `Premise`
- `CoreSettings`
- `ThemeVoice`
- `WorldRules`
- `Endgame`
- `Contracts`
- `Writing`
- `WritebackCenter`
- `RevisionCenter`
- `QualityDashboard`

要求：

- 保存成功后刷新当前页面必要数据
- 触发工作区 mutation / stats / blocker / next step 所需回灌
- 不允许保存成功但工作区顶部/工作台仍显示旧 blocker

## P1

### P1-1 提示词系统体验对齐

目标页面：

- `src/pages/PromptManager/index.tsx`

要求：

- 移除纯整页 loading
- 对齐模板系统的布局标准
- 明确只读 / 编辑 / 删除 / 保存反馈

### P1-2 新旧页面职责收口

涉及：

- `src/pages/Novel/index.tsx`
- `src/pages/Novel/workflow.ts`
- `src/shared/novel-workspace.ts`
- `src/pages/Novel/Guide/index.tsx`
- `src/pages/Novel/ProjectBrief/index.tsx`
- `src/pages/Novel/Premise/index.tsx`
- `src/pages/Novel/CoreSettings/index.tsx`

要求：

- 不删除旧页，但明确当前主入口顺序
- 避免继续在旧兼容页上叠加新逻辑
- 保证 next step、导航、推荐入口都以当前工作区模块为主

### P1-3 工作区公共刷新规范

涉及：

- `src/pages/Novel/index.tsx`
- `src/pages/Novel/workspace-shortcuts.tsx`
- `src/pages/Novel/workspace-quality-context.tsx`
- 页面级 `notifyWorkspaceMutation` 接入点

要求：

- 形成统一规则：
  - 首屏加载
  - 轻刷新
  - 保存后回灌
  - 错误回退

## P2

### P2-1 状态层归一化预留

涉及：

- `src/stores/workspace.store.ts`
- 若干页面内部状态

本轮只允许小幅补强，不做大重构。

### P2-2 领域模型和跨模块联动增强

涉及：

- `src/shared/*`
- `electron/services/*`

本轮只记录，不作为通过条件。

## 涉及文件

### 核心工作区与路由

- `src/App.tsx`
- `src/pages/Novel/index.tsx`
- `src/shared/novel-workspace.ts`
- `src/pages/Novel/workflow.ts`
- `src/stores/workspace.store.ts`

### P0 页面

- `src/pages/Novel/Studio/index.tsx`
- `src/pages/Novel/Writing/index.tsx`
- `src/pages/Novel/Contracts/index.tsx`
- `src/pages/Novel/QualityDashboard/index.tsx`
- `src/pages/Novel/WritebackCenter/index.tsx`
- `src/pages/Novel/Timeline/useTimelineWorkspace.ts`
- `src/pages/TemplateManager/index.tsx`

### 可能需要同步调整的样式 / 公共组件

- `src/styles/global.css`
- `src/pages/Novel/Writing/index.css`
- `src/components/novel/cards/cards.css`
- `src/components/novel/common/ActionBar.tsx`
- `src/components/novel/common/SectionHeader.tsx`
- `src/pages/Novel/components/WorkspaceShell.tsx`

### P1 页面

- `src/pages/PromptManager/index.tsx`
- `src/pages/Novel/Guide/index.tsx`
- `src/pages/Novel/Overview/index.tsx`
- `src/pages/Novel/ProjectBrief/index.tsx`
- `src/pages/Novel/Premise/index.tsx`
- `src/pages/Novel/CoreSettings/index.tsx`
- `src/pages/Novel/ThemeVoice/index.tsx`
- `src/pages/Novel/WorldRules/index.tsx`
- `src/pages/Novel/Endgame/index.tsx`

## 推荐页面结构

### 1. 工作区页面统一结构

适用于高频工作区页：

1. 顶部工具栏 / 标题区
2. 顶部轻刷新提示区
3. 主内容区域
4. 局部操作区
5. 错误/空态区

统一规则：

- 首屏无数据时允许全页 loading
- 一旦页面已有内容，刷新只更新局部数据，不得把整个主内容替换为 spinner
- 按钮 loading 只作用于对应动作，不扩大到整页

### 2. 管理后台页统一结构

适用于模板系统、提示词系统：

1. `WorkspacePage`
2. 统计 metrics
3. 主列表/卡片区
4. 详情或编辑弹窗/侧栏
5. 顶部轻刷新状态

统一规则：

- 分类切换不重新整页 loading
- 新建/编辑/删除后列表轻刷新
- 内置资源与自定义资源在视觉上明显区分

## 推荐数据结构

### 1. 页面加载状态规范

建议每个高频页统一采用：

```ts
type PageLoadState = {
  loading: boolean
  refreshing: boolean
  saving: boolean
  loadedOnce: boolean
  error?: string | null
}
```

最小要求：

- `loading`: 只用于首次且页面无内容
- `refreshing`: 用于后续数据同步
- `saving`: 用于提交动作
- `loadedOnce`: 判断是否允许继续显示旧内容

### 2. 工作区回灌触发

建议统一遵循：

```ts
save -> local state update / refetch current page
     -> notifyWorkspaceMutation()
     -> refresh workflow stats / blocker snapshot if needed
```

不要求新增全局 store，但要求行为一致。

### 3. 模板/提示词后台页列表模型

建议最少拆分：

```ts
type ResourceListState<T> = {
  rows: T[]
  loading: boolean
  refreshing: boolean
  saving: boolean
  activeType: string
  selectedId?: number | string | null
}
```

## 具体实现步骤

## 第一步：统一工作区加载策略

执行顺序：

1. 以 `Studio` 现有实现为基线，抽取可复用模式
2. 修 `Writing`
3. 修 `Contracts`
4. 修 `QualityDashboard`
5. 修 `WritebackCenter`
6. 修 `Timeline` 工作区 hook

具体要求：

- 将“首次加载”和“后续刷新”分开
- 删除或收敛以下模式：
  - `if (loading) return <Spin />`
  - `setLoading(true)` 直接覆盖已有内容的刷新逻辑
- 保留现有页面内容，在顶部或局部显示：
  - “正在同步...”
  - 对应按钮 loading

## 第二步：修复正文生产链路体验

目标：

- `Contracts -> Writing -> WritebackCenter -> QualityDashboard`

要求：

- 从合同页进入正文页，不应感知整页重建
- 正文页切章节、回看历史、做 AI 检查、保存后，不应反复整页清空
- 回写执行后，应回灌当前运行状态和下一章可写性提示
- 质量页刷新不应丢失当前面板上下文

## 第三步：模板系统整改

目标页面：

- `src/pages/TemplateManager/index.tsx`

具体要求：

1. 增加 `refreshing`
2. 分类切换不触发整页 loading
3. 新建、编辑、删除后列表轻刷新
4. 查看按钮、编辑按钮、删除按钮统一尺寸与视觉层级
5. 内置模板只读态清晰
6. 内容预览区文字颜色、对比度、间距统一
7. 弹窗中只读模板不应给人“像能编辑但又写不进去”的混乱感

## 第四步：提示词系统基础对齐

目标页面：

- `src/pages/PromptManager/index.tsx`

要求：

- 采用和模板页同类的加载/刷新策略
- 保持现有持久化接口不变
- 清理明显的整页 loading 体验

## 第五步：主流程状态回灌补齐

重点：

- 所有会影响 blocker / next step / readiness 的页面，在保存成功后都必须：
  - 刷新本页关键数据
  - 调用工作区 mutation 通知
  - 让 `Studio` / `Guide` / 顶部推荐下一步尽快看到新状态

优先页面：

- `Overview`
- `ProjectBrief`
- `Premise`
- `CoreSettings`
- `ThemeVoice`
- `WorldRules`
- `Endgame`
- `Contracts`
- `Writing`
- `WritebackCenter`

## 第六步：验证与回归

Agent 2 完成后必须运行：

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build:app`

如其中某项因为仓库现有历史问题失败，必须在 `implementation-report.md` 中写清：

- 失败命令
- 失败原因
- 是否与本轮修改直接相关

## 验收标准

### 功能标准

- 主工作区页面能正常进入
- 主流程核心页可编辑、可保存、可返回、可继续操作
- 模板系统可查看、创建、编辑、删除
- 提示词系统基本可用且无明显整页转圈

### 体验标准

- 切换小说工作区主菜单时，不应出现频繁整页 spinner
- 页面已有内容时，刷新不得清空整页
- 顶部刷新提示、按钮 loading、局部同步提示要清晰但不过度打断
- 模板系统布局、按钮尺寸、文案颜色协调

### 业务标准

- 小说核心链路可走通：
  - 设定
  - 结构
  - 合同
  - 正文
  - 回写
  - 修订/质量
- 保存后 blocker / next step 有同步更新能力

### 工程标准

- TypeScript 无新增阻塞错误
- lint 无新增阻塞错误
- build 无阻塞错误
- 不回退无关文件改动

## 风险控制

### 风险 1：并行代理或主线程同时改业务文件

控制：

- Agent 2 修改前先读取目标文件当前状态
- 不回退他人改动
- 仅做最小必要编辑

### 风险 2：正文页/时间轴页过大，改 loading 容易引入回归

控制：

- 只改加载态与刷新态，不改核心业务分支
- 保留原有 API 调用与保存逻辑
- 先让旧内容保活，再逐步局部刷新

### 风险 3：模板/提示词页样式调整影响全局

控制：

- 尽量使用页面级 class
- 避免继续向 `global.css` 堆无边界覆盖

### 风险 4：工作区状态回灌引起重复请求

控制：

- 使用已有 `notifyWorkspaceMutation` 与明确依赖
- 避免把 `location.pathname` 重新放回重刷依赖中

### 风险 5：为了追求统一而扩大重构范围

控制：

- 严格只做本计划内范围
- P0 完成优先于 P1、P2
- 不新增无必要抽象层

## 本轮通过条件

1. P0 全部完成
2. P1 无重大缺口
3. 小说主流程核心链路可用
4. 页面能正常进入、编辑、保存、返回、继续操作
5. 无明显 TypeScript / lint / build 阻塞错误
6. Agent 3 评审结论为 PASS
7. 平均验收评分 >= 90
