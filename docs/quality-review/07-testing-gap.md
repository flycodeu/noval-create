# 07 测试缺口

主题范围：自动化测试覆盖、CI 能力、质量闭环。

## P2-1 无单元测试覆盖

**问题**：`package.json` 的 scripts 里没有标准的 test 命令（vitest / jest / mocha 都未引入）。仅有的几个测试脚本（`test:subplot`、`test:migrations`、`test:prompt-guardrails`）是手写的 node 脚本，需要开发者手动执行，没有进 CI，也没有覆盖率统计。

**证据**：
- `package.json` scripts 缺 `test` 标准入口，有的只是数据脚本。
- 仓库里没有 `*.test.ts`、`*.spec.ts`、`__tests__` 目录。
- `electron/services/` 下的核心逻辑（context.service、chapter.service、dialogue-fingerprint.service 等）完全没有断言保护。

**影响**：
- 重构 service 层时容易引入回归 bug，只能靠手工跑 dev 模式复现，反馈链条长。
- 反 AI 味、对话指纹、样式相似度等算法改动后缺少 regression 能力。
- 新成员加入时无法靠测试理解已有模块的行为边界。

**修复方案**（长期欠债，分阶段）：
1. **阶段 3 起**：引入 `vitest` 作为 renderer + electron main 共用的测试 runner。为什么选 vitest：与现有的 vite/electron-vite 构建链同构，配置最小化。
2. **优先覆盖**的模块（按收益排序）：
   - `electron/utils/json.ts` safeParseJson：三层容错有明确输入输出，最适合作为 vitest 的入门用例。
   - `electron/services/context.service.ts` allocateChapterContext：预算分配策略改动频繁，需要回归保护。
   - `electron/services/dialogue-fingerprint.service.ts` 的 n-gram 分析：纯函数，容易 mock。
   - `electron/services/style-analysis.service.ts`：任务二 2.2 会大量扩展这里的函数，必须配对测试。
3. **延迟覆盖**的模块（价值较低）：UI 组件、IPC wiring、数据库 CRUD（可以先用 migrations 的手写脚本覆盖）。
4. **CI 接入**：package-win.cjs 之前先跑 `npm test`，失败则拒绝出包。

**fixed-by**：长期欠债，阶段 3 内引入 vitest 基础设施 + 前 4 个模块覆盖，其余在后续迭代分批补。

---

## 关联观察

- 现有手写脚本 `test:prompt-guardrails` 值得保留——它跑的是真实 prompt 产出校验，属于端到端集成测试的一种，和单元测试并行存在。
- 引入 vitest 后可以把手写脚本的断言部分迁移成 vitest suite，但保留手写入口作为"快速冒烟"命令。
