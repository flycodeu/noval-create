# 01 AI 生成反馈缺失

主题范围：AI 生成、评分、校验、重写等流程的用户反馈是否完整可见。

## P0-1 Writing 页 AI 生成缺少完整反馈

**问题**：`src/pages/Novel/Writing/index.tsx`（1986 行）承载了章节生成、连续性检查、发布前校验、锁段保护、对话指纹等多条异步流程，但单一组件内既是编辑器又是任务控制台，缺乏统一的三态（loading / error / empty）表达。用户点击"生成下一章"后，若网络或模型临时不可用，画面没有明显提示，只会在 `onError` 分支里弹一个 `message.error` 随即消失；如果用户已经滚动到其他章节，这条提示就被错过了。

**证据**：
- `src/pages/Novel/Writing/index.tsx` 内多次 `try { ... } catch (e) { message.error(...) }` 的模式，没有写入组件状态，也没有在对应章节卡片上打失败标记。
- 生成中途离开页面，返回时也无法区分"刚生成完"和"正在生成"——stream 状态只存在 `streams[taskId]` 的临时字典里。

**影响**：用户容易重复触发生成（浪费 token 配额），也容易错失失败信号。AI 任务失败被静默吞掉还会导致章节状态和 tasks 表短暂不一致。

**修复方案**：并入**任务一 1.3**（Writing 子路由化）。拆分出 `writing/editor` 子路由后，把生成状态抽到 `src/stores/writingView.store.ts` 的 `activeGeneration: { chapterId, stage, status, error }` 切片。editor 子路由订阅该切片展示 loading / error；`writing/history` 子路由订阅 task 变更流，展示失败历史。

**fixed-by**：任务一 1.3 拆分时一并落地。

---

## P0-3 AIGenerateButton 无失败重试机制

**问题**：`src/components/AIGenerateButton/index.tsx` 当前 `runGeneration` 接口在网络抖动或单次输出不合规时直接抛错，调用方只能自己 try/catch + 再次点击。没有可配置的自动重试（即使一次）。对"按检测结果修复"这种已经花了上一次评分 token 的场景，重试代价可控却完全手动。

**证据**：
- `src/components/AIGenerateButton/index.tsx` 中 `handleGenerate` 只 await 一次 runGeneration，失败即把按钮状态置回 idle。
- `src/components/AIScorePanel/index.tsx` 的"按检测结果修复"入口也直接复用同一按钮，没有重试包装。

**影响**：长链路操作（评分 → 修复 → 应用）任何一环失败都要手动从头再来；用户在不稳定网络环境下体验非常差，而且容易累积成功率统计的噪音。

**修复方案**：在 AIGenerateButton 的 props 上加 `retry?: { max: number; backoffMs?: number }`，默认在 "repair" intent 下启用 `max: 2, backoffMs: 600`。核心 runGeneration 循环里捕获到错误时按指数退避重试；UI 层在重试进行中展示"重试中 (1/2)"的小提示。

**fixed-by**：独立 hotfix，阶段 2 内落地。不依赖 1.3 拆分。

---

## 关联风险

- Writing 的生成流程最终会接入**任务二 2.2** 的样式相似度 gate 和情感标签化检测，这些检测可能触发额外的 rewrite 尝试。反馈缺失问题不修复，多一层 gate 只会让用户更迷茫。
- AIGenerateButton 重试如果实现错误，可能同时触发 embeddings 生成的副作用，需要配合**任务二 2.3**的 JSON 容错日志来判断每一层命中率。
