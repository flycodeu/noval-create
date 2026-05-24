# Longform Soak Acceptance

本文档记录 `scripts/longform-soak.cjs` 的长篇 soak 验收口径。该验收用于确认 120 万字、480 章量级的长篇工程在中后段章节仍能保留上下文、现实约束、资源账本、人物状态、时间线和开放伏笔。

## 运行模式

### Dry-run

默认命令：

```bash
npm run test:longform-soak
```

dry-run 不调用真实模型，只在本地构造固定长篇 fixture 和 prompt suite，然后执行断言检查。通过时输出每个 `PASS` 项，并以 `longform soak dry-run passed` 收尾。

dry-run 适合放入常规 smoke 或 PR 验证，因为它只验证提示词、护栏和续跑检查点的结构是否还在，不依赖外部模型、网络或人工审校。

### Real-mode

命令：

```bash
npm run test:longform-soak -- --real
```

也可以用环境变量开启：

```bash
LONGFORM_SOAK_REAL=1 npm run test:longform-soak
NOVAL_LONGFORM_SOAK_REAL=1 npm run test:longform-soak
```

real-mode 当前不会直接调用真实模型。它会打印一份“长篇真实/半真实验收提示”，包含正文生成 Prompt、审校 Prompt、连续性提取 Prompt，以及 JSON 报告。外部执行器或人工评审可以把这些 prompt 接入真实模型，按脚本中写明的验收失败条件做一次正文生成、一次审校、一次连续性提取。

只需要机器可读报告时可运行：

```bash
npm run test:longform-soak -- --json
LONGFORM_SOAK_JSON=1 npm run test:longform-soak
```

`--json` 会输出 JSON 报告；与 `--real` 组合时可避免只依赖人工阅读终端文本。

## 指标

脚本报告中的核心指标来自 `buildReport()`：

- `mode`：`dry-run` 或 `real-prompt`，标识当前运行模式。
- `realModelCalled`：当前固定为 `false`，表示脚本本身没有调用真实模型。
- `fixture.totalWords`：长篇规模，当前为 `1200000` 字。
- `fixture.totalChapters`：章节规模，当前为 `480` 章。
- `fixture.targetChapterNum`：目标章节，当前为第 `317` 章。
- `fixture.targetWords`：目标正文长度，当前为 `6500` 字。
- `promptLengths`：`arcPrompt`、`outlinePrompt`、`scenePrompt`、`writingPrompt`、`reviewPrompt`、`continuityPrompt` 的字符长度，用于观察 prompt 是否意外缩水或膨胀。
- `checks`：dry-run 已通过的结构化检查名称列表。
- `acceptance.failureSignals`：real-mode 或人工验收时应判定失败的信号列表。

dry-run 的断言覆盖以下验收面：

- 故事弧 prompt 保留长篇写实要求和成长/代价账本。
- 大纲 prompt 携带章节窗口内的连续性、开放伏笔和账本上下文。
- 场景 prompt 包含目标章节、长期记忆、时间线和硬约束。
- 正文 prompt 保留高字数输出要求、当前任务焦点、伤病恢复和补给分配约束。
- 审校 prompt 暴露长篇验收所需的上下文漂移、真实度风险和重写要求字段。
- 连续性提取 prompt 仍保持 JSON 输出形态，并覆盖角色状态与开放伏笔。
- 质量护栏能识别无代价解决等长篇真实度回归。
- 暂停的长篇工作流 checkpoint 能被识别为可续跑。

## 失败阈值

dry-run 采用硬失败阈值：任一断言失败即进程退出非零。失败包括但不限于：

- prompt 中缺少上下文护栏、真实度护栏、长期记忆、时间线、开放伏笔或资源约束。
- 成长账本、代价账本、风险 schema、`rewrite_required` 等字段丢失。
- 质量护栏无法识别 `zero_cost_resolution`，或不能触发强制修复。
- 批量生成 checkpoint 不能被识别为可续跑。

real-mode 的失败阈值以脚本输出的 `acceptance.failureSignals` 和验收提示为准。出现以下任一情况应判定失败：

- 上下文护栏缺失。
- 真实度护栏缺失。
- 长期记忆未进入正文或审校提示。
- 资源、路线、伤病或投票约束被无代价解决。
- 恢复检查点无法识别为可续跑。
- 目标章节中突然多出油料或路线。
- 周衡发热记录失效或不再影响收容投票。
- 冷链箱危机被无代价解决。
- 儿童与药箱的选择被口号化处理，没有说明风险承担人与后果。

## 如何运行

常规本地验收：

```bash
npm run test:longform-soak
```

查看 JSON 指标：

```bash
npm run test:longform-soak -- --json
```

生成真实模型/人工验收材料：

```bash
npm run test:longform-soak -- --real
```

生成 real-mode JSON 报告：

```bash
npm run test:longform-soak -- --real --json
```

章节流水线级 dry-run：

```bash
npm run test:chapter-soak
```

`test:chapter-soak` 不调用真实模型，但会检查真实章节流水线代码是否仍包含 Planner、Writer、Critic、Rewriter、Canonizer、Finalize 六段，是否接入章节门、Canon 草案、摘要/连续性/记忆刷新、批量章节子任务等待、召回降级保护，以及人物/物品/地点/势力别名和场景合同感知的上下文检索。它会把机器可读报告写入 `.tmp-tests/chapter-soak-report.json`。

验证真实运行导出的指标：

```bash
npm run test:chapter-soak -- --report path/to/real-run-report.json
```

真实报告至少应包含 `realModelCalled: true`、模型来源信息 `provenance.provider` / `provenance.model` / `provenance.modelConfigId` 或 `provenance.runId`，以及 `metrics` 字段：`requestedChapters`、`completedChapters`、`failedChapters`、`p95ChapterDurationMs`、`consecutiveRecallFallbackChapters`、`minWordRatio`、`contextHitRate`、`aliasHitRate`、`contractAssetHitRate`、`recallFallbackRate`、`publishGateFailures`、`blockedWritebacks`、`pipelineRolesCovered`。脚本会按阈值判定是否通过。

从本地 Electron SQLite 数据库导出真实运行报告：

```bash
npm run soak:export-chapter-report -- --db path/to/novelforge.db --novelId 1 --out .tmp-tests/real-chapter-soak-report.json
npm run test:chapter-soak -- --report .tmp-tests/real-chapter-soak-report.json
```

也可以用 `--taskId` 限定到某次 `chapter_batch_generate` 或单章 `chapter_write` 任务；导出脚本会只读汇总章节流水线任务、章节字数、召回降级、writer 上下文命中和模型配置来源。

从本地章节批量任务导出真实运行报告：

```bash
npm run soak:export-chapter-report -- --db "C:\Users\<you>\AppData\Roaming\NovelForge\novelforge.db" --task-id 123 --out .tmp-tests/real-chapter-soak-report.json
npm run test:chapter-soak -- --report .tmp-tests/real-chapter-soak-report.json
```

导出脚本只读本地 SQLite 或输入 JSON，不会调用真实模型。它会汇总 `chapter_batch_generate` 任务、子章节流水线、章节门、章后回写、合同资产、实体别名线索和召回降级情况，输出 `chapter-soak` 可验证的报告。常用参数：

- `--db <path>`：显式指定 `novelforge.db`。不传时会尝试常见 `NovelForge` userData 路径，也可用 `NOVELFORGE_DB_PATH`。
- `--task-id <id>`：指定章节批量任务；不传时可用 `--novel-id <id>` 读取该作品最近一次章节批量任务。
- `--input <json>`：从已有运行快照/报告 JSON 归一化导出，适合没有本机 SQLite native runtime 的环境。
- `--provider`、`--model`、`--model-config-id`、`--run-id`：补齐或覆盖 provenance。DB 中存在 `model_configs` 时会自动读取 provider/model。
- `--real-model-called`：当报告来自已经完成的真实模型运行但 DB 证据不足时显式标记；脚本本身不会发起模型调用。

真实模型运行前置检查：

```bash
NOVELFORGE_SOAK_PROVIDER=...
NOVELFORGE_SOAK_MODEL=...
NOVELFORGE_SOAK_API_KEY=...
npm run test:chapter-soak -- --real-model
```

`--real-model` 当前只检查环境变量并输出 manifest，不会直接发起模型调用。真实章节批量生成仍应通过应用/Electron 侧执行，然后导出指标 JSON 交给 `--report` 验证。

建议在修改以下范围后至少运行 dry-run：

- `src/shared/prompt-library.ts`
- `src/shared/genre-system.ts`
- `src/shared/content-guardrails.ts`
- `src/shared/workflow-resilience.ts`
- `scripts/longform-soak.cjs`
- `scripts/chapter-soak.cjs`
- `scripts/export-chapter-soak-report.cjs`

## 当前限制

- 脚本当前不调用真实模型，`realModelCalled` 固定为 `false`。
- real-mode 只生成验收 prompt 和 JSON 报告，真实正文质量仍需要外部执行器或人工评审确认。
- fixture 是固定的末世题材案例，不能覆盖所有体裁、章节位置和叙事结构。
- `promptLengths` 只能发现 prompt 长度异常，不能单独证明语义质量。
- dry-run 断言偏向结构和关键字存在性，无法替代端到端生成结果评审。
- `test:chapter-soak --report` 可以验证真实运行指标，但当前还不负责自动启动完整真实模型章节批量任务。
- `soak:export-chapter-report` 只做本地运行状态汇总，不负责判定正文审美质量；缺少模型配置或运行任务证据时需要用参数补齐 provenance。
