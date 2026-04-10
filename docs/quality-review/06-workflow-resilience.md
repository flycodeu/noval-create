# 06 工作流韧性

主题范围：长耗时工作流的断点续传、状态持久化、失败恢复。

## P2-3 Timeline / Faction 自动生成 workflow 无断点续传

**问题**：`electron/services/workflow-task.service.ts` 实现了若干"一键自动生成"入口（`startTimelineAutoGenerateWorkflow`、`startFactionAutoGenerateWorkflow` 等），每个工作流串行调用若干 AI 任务。当前实现会返回 `taskId` 并把进度写入 tasks 表，但如果中途宿主进程意外退出或网络抖动，工作流会停在中间状态，且没有 resume 机制。

**证据**：
- `electron/services/workflow-task.service.ts` 顶部的 workflow 函数都是纯 async 函数，内部用 `for (const step of steps)` 串行执行；异常会 bubble 到 tasks 表的 errorMessage，但 step 之间没有 checkpoint 写入。
- `electron/database/schema.ts` 的 tasks 表有 `progressJson` 字段，但工作流的实际 step 状态不会持久化到它。

**影响**：
- 用户重启应用后看到 tasks 表里挂着一条"failed"任务，但已经完成的前 3 步的产出也无法利用，只能全部重跑。
- 长任务（10+ 分钟）失败率在网络不稳定场景下偏高，用户体验打折扣。

**修复方案**：
1. 为每个 workflow 定义 `WorkflowStepId` 枚举，step 在开始/结束时写入 `tasks.progressJson.completedSteps`。
2. 工作流入口函数接受 `resumeFromTaskId` 可选参数——resume 时跳过已完成 step，继续后续 step。
3. TaskCenter 列表对 "失败但包含已完成 steps" 的任务展示"继续"按钮（配合 P2-2 的错误样式）。
4. 工作流内部的每一步结果（例如"已生成时间线事件 id=123"）存到 progressJson，resume 时能 rehydrate 出来。

**fixed-by**：阶段 3 内补齐，紧随任务二 2.2 的高级检测 gate 之后实现，因为 resume 逻辑要尊重 gate 的强制 rewrite 结论。

---

## 关联观察

- 目前 `workflow-task.service.ts` 的错误处理已经比较细致（80+ 行错误分支），但都是"遇错中断 + 写 errorMessage"模式，没有分布式事务风格的补偿逻辑。这点在阶段 3 改为 step-level checkpoint 前是可以接受的。
- `RESUMABLE_WORKFLOW_TYPES` 常量已经在 TaskCenter 里存在，但目前只有 2-3 个 workflow 类型在其中；扩展时要同步更新。
