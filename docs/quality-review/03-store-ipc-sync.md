# 03 Store 与 IPC 同步

主题范围：Zustand store 与后端 IPC 的一致性、错误处理覆盖、跨页面状态同步。

## P0-4 Store 更新未触发订阅页面重渲染

**问题**：`src/stores/novel.store.ts` 等 store 在 batch 更新或通过 IPC 回调触发时，只更新了顶层字段，没有触发子对象的引用变化，导致某些订阅深层字段的组件不会重渲染。例如在 NovelList 页面异步 refresh 后进入 Novel 工作区，某些子 workspace 读到的是旧 `chapters` 数组。

**证据**：
- `src/stores/novel.store.ts` 的 `updateChapter` 直接对 `state.chapters[index]` 赋值；Zustand 检测不到数组引用变化。
- Writing 页内 `useMemo(() => chapters.find(c => c.id === currentChapterId), [chapters, currentChapterId])` 依赖数组引用，但上游只赋值不换引用，memo 不重算。

**影响**：
- 用户在多 Tab 编辑同一小说时数据会出现短暂不一致。
- AI 任务异步完成后 UI 不更新，用户要手动切换章节才能看到新内容。
- 导出/保存路径里若取错快照，会把旧内容写回磁盘。

**修复方案**：
1. 对所有 array mutation 走 `set(state => ({ chapters: state.chapters.map(...) }))` 的不可变更新模式。
2. 在 `novel.store.ts` 顶层暴露一个 `__version` 数字字段，每次 batch 更新后 `++`，让依赖整棵 store 的 selector 有稳定的"变更信号"。
3. 引入 `useSyncExternalStoreWithSelector` 的深等值检查作为兜底——但先做 1、2，性能代价更小。

**fixed-by**：独立 hotfix，阶段 2 内落地。与任务一 1.3 拆分同步，让 Writing 子路由在切换时能正确感知最新 chapters。

---

## P1-4 265 个 IPC handler 无统一错误处理

**问题**：`electron/main.ts` 注册了约 265 个 IPC handler（跨 services），每个 handler 都是"直接 await service 方法然后 return 结果"的风格。service 抛错时，Electron 默认会把 raw Error 序列化回前端，前端拿到的是形如 `SQLITE_CONSTRAINT: ... at Module._compile (...)` 的技术栈，不适合直接展示。

**证据**：
- `electron/main.ts` 里每个 `ipcMain.handle('xxx', async (_e, ...args) => service.method(...args))` 模式都没有 try/catch 包裹。
- 前端 `window.electron.xxx(...)` 的调用处主要靠 `catch (e: unknown) { message.error(e.message) }` 来处理，意味着用户会看到 SQLite 或 fs 的底层信息。

**影响**：
- 用户面看到的错误信息不友好。
- 日志里的错误无法统一抓取（没有 handler 名前缀）。
- 安全上存在小风险：把数据库路径、SQL 文本等暴露到前端。

**修复方案**：
1. 新增 `electron/utils/ipc-wrapper.ts` 提供 `wrapHandler(name, fn)`：内部捕获异常，打标 `[ipc:name]` 写日志，对外返回 `{ ok: false, code, message: 用户友好文本, detail: dev 环境才附带 }`。
2. 渐进式接入：先包一层兼容模式，返回值拆成 `{ ok, data } | { ok, error }`；前端 `window.electron.*` 检测到 `ok === false` 自动 throw 一个带 code 的 Error。
3. 关键 handler（`chapter.generate*`、`ai.score*`、数据库写入类）优先迁移。

**fixed-by**：阶段 2 内完成最高频 20 个 handler 的迁移，其余阶段 3 推进。

---

## P2-2 Tasks 表 errorMessage 前端未充分强调

**复核结论**：`src/pages/TaskCenter/index.tsx` L202-210 的 `getTaskSummary` 已经把 `task.errorMessage` 作为首选摘要返回；L729-735 的详情视图也把 errorMessage 放进了 Alert。P2-2 中关于"前端不展示"的原始诊断是**误判**。

**实际问题**：列表视图里的错误信息混在普通摘要样式里，视觉上没有和成功任务区分开。

**已在阶段 1 修复**：`src/pages/TaskCenter/index.tsx` L657 处的 summary div 在 `task.errorMessage` 存在时改为红色左边栏 + "失败原因：" 前缀的样式，让列表一眼就能识别失败任务。

**fixed-by**：阶段 1 已修。
