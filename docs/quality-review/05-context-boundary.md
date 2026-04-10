# 05 Context 服务边界

主题范围：AI 上下文拼装的边界检查、溢出处理、P0-P3 分配策略。

## P1-2 Context 服务无溢出检测

**问题**：`electron/services/context.service.ts` 的 `buildChapterContext` 及其下层 `buildStageContextMap`、`allocateChapterContext` 负责按 P0/P1/P2/P3 优先级拼装章节生成所需的上下文，但没有可靠的"总体字符数/字段数预算"边界检查。当某张表（例如 storyThreads 或 characterStates）异常膨胀时，拼装结果可能把 prompt 撑到模型上限，生成阶段要么截断、要么直接 413。

**证据**：
- `electron/services/context.service.ts` L456-549 的硬约束分配函数只看分类权重和是否存在关键信号词（"必须"、"承接"、"漂移"等），没有看总字符数。
- 分配过程的 fallback 路径直接 `return []` 或 `return {}`，调用方无法区分"什么都不需要"和"被预算踢出"。

**影响**：
- 生成章节时某些场次的 P0 硬约束会被悄悄丢弃，AI 在没有硬约束的情况下自由发挥，最终章节和设定脱节。
- 出现"长篇章节越写越飘"的现象——章节越靠后，context 越膨胀，被踢出的硬约束也越多。

**修复方案**（并入任务二 2.1 / 2.4）：
1. 在 `buildChapterContext` 入口计算目标 token 上限（优先读模型配置，其次用 32k 默认）。
2. `allocateChapterContext` 的 fallback 路径改为抛出 `ContextOverflowError`，调用点 catch 后选择降级策略（先去 P3，再 P2，保留所有 P0）。
3. 增加 `contextBudgetReport`：每次拼装后把"实际使用 / 总预算 / 被踢出的字段摘要"写入 quality-dashboard 的诊断视图。
4. 当 P0 级硬约束无法全部放入 budget 时抛出更严重的 `HardConstraintOverflowError`，上游直接终止生成并要求用户减少本章范围。

**fixed-by**：任务二 2.1 做维度补强时顺带，任务二 2.4 的日志通道承担 contextBudgetReport 的 sink。

---

## 关联观察

- `context.service.ts` 的 `allocateChapterContext` 当前使用"信号关键词"启发式（"必须"、"禁止"、"承接"、"漂移"等）作为 P0 判定依据。这一启发式对中文文案敏感度不稳定——同义词经常遗漏。建议任务二 2.1 在补齐新维度（伏笔债务、微观节奏、压力范围）时，把硬约束来源改成"显式分类 + 可选关键词回退"，而不是完全依赖关键词。
- 任务二的反 AI 味运行时检测会在 review 阶段注入"疑点清单"到 review prompt，如果不先修 context 溢出问题，疑点清单有可能被踢出预算而失效。
