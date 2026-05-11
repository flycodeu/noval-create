# 当前项目问题与增量修复计划

## 当前批次状态

| 批次 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| Batch 1 | `operatingMode` 共享推导与策略、novel 读写链路读穿接线、历史题材 alias/pack 修复、最小测试 | 已完成（当前轮） | 仅代表首批修复通过，不代表整篇计划完成；后续仍需继续 Stage 1-5、typed ref、结构化记忆与来源层 |
| Batch 2 | `story thread / timeline event / story item` 的 typed ref overlay 最小落地、生成/解析双写读穿、dashboard 只读观测、最小测试 | 已完成（当前轮） | 已通过本轮验收；2026-05-10 最小复验补齐了 `story-thread / timeline / story item` typed ref overlay 的 create/update/clear-link 回归证明，并修复了 `story item` 在 update 清链到空 overlay 时旧 `typedRefsJson` 可能残留的问题；更深的 context/writeback/consistency 链统一仍留待后续批次 |
| Batch 3 | `operatingMode` 开始接管快启章节规划、CoreSettings 估章数、context recent window，并在 dashboard 暴露只读观测 | 已完成（当前轮） | 已通过本轮验收；仅代表策略接管与只读证明已落地，后续仍需继续历史 grounding、结构化记忆与来源层 |
| Batch 4 | 历史 grounding 最小闭环：差异化约束、来源缺口保守 fallback、dashboard 只读观测 | 已完成（当前轮） | 已通过本轮验收；当前已具备历史题材分层、主链保守 fallback 与来源观测。2026-05-10 已补齐 `novels` 的 `historical/source/canon` 最小数据层，并由 `chapter-writeback.service.ts` 把章级 extract/diff 回流到 `chapter_source_usage_json / fact_provenance_json / source_ledger_json / canon_source_ledger_json / canon_fact_cards_json`；同日已修复 `runMigrations()` 对这批列的 staged validate / legacy recovery 链，避免旧库在跑到 `0038_novel_source_canon_fields` 之前被早期 `validateRequiredSchema()` 提前阻断；本轮继续把这些项目级 source/canon 信号接入 `assessHistoricalGrounding()`、`context.service.ts`、`chapter.service.ts` 与 `quality-dashboard.service.ts` 的实际消费链。更深的 profile authoring、validator 强消费与更精细 ledger 结构仍留待后续批次 |
| Batch 5 | 结构化记忆与长篇稳定性增强：checkpoint card 双写、context 优先消费结构化状态块、长周期稳定性观测 | 已完成（当前轮） | 已通过本轮验收；当前已具备 structured-first 入口、context 消费证明与长篇稳定性观测，结果型指标与更深 gate 化仍留待后续批次 |
| Batch 6 | 百万字运行时优化：长篇批处理/预计算/主进程压力与稳定性收敛 | 已完成（当前轮） | 已通过本轮验收；当前已具备正文串行、story-memory 后台预计算、回写顺序护栏与运行时观测，完整 worker 化与更广泛长窗 gate 化仍可在后续独立批次继续深化 |
| Batch 7 | 质量闭环扩展最小闭环：`typed ref 缺口 / 来源缺口 / operatingMode 违规` 接入 review notes、publish gate、dashboard 主链 | 已完成（当前轮） | 已通过本轮验收；2026-05-10 最小复验再次确认 `chapter-pipeline policy` 对三类 finding 进入 rewrite-priority 与 `max_coverage` 重写策略的回归证明有效；当前三类 finding 已不再停留于只读观测，而是进入审校、章节验收门、repair metrics 与 provenance 阻断统计，阈值调优与更细粒度扫描仍留待后续批次 |
| Batch 8 | 长窗 anti-AI / humanization 指标主链化：`题材语域漂移 / 解释密度 / 累积同质化 / 对白可分离度` 接入 `review / rewrite / dashboard / publish gate` | 已完成（当前轮） | 已通过本轮验收；2026-05-10 最小复验再次确认长窗 finding 在 `rewrite_required` 与非 `rewrite_required` 场景下都先于普通语言润色进入 rewrite-priority，并触发 `max_coverage` 策略的回归证明有效；当前四类长窗指标已进入 review、rewrite 后复审、publish gate 与 dashboard 主链。`source/canon` 最小项目级 JSON 数据层与 writeback 回流已落地，但更深的 schema 规范化、context/validator 强消费与独立 source ledger 重构仍留待后续独立批次 |

## 当前已实现功能状态（按文件）

下面这张表只标记“本轮已落地且已有代码/测试证明”的文件级功能状态，不把文档中的后续规划误写成已完成。

| 文件 | 已实现功能 | 当前状态 | 证明/备注 |
| --- | --- | --- | --- |
| `electron/database/schema.ts` + `electron/database/db.ts` + `scripts/migration-safety.test.cjs` | `novels` 的 `historical/source/canon` 8 个项目级 JSON 字段、`0038_novel_source_canon_fields` 增量迁移、staged validate / legacy recovery | 已实现并复验 | 已覆盖 fresh / partial / legacy resume 三类迁移恢复链，`npm run test:migrations` 通过 |
| `electron/services/novel.service.ts` + `src/types/index.ts` + `electron/services/novel.service.test.ts` | novel 读写链已支持 `historical/source/canon` 字段的 create / update / get 与类型声明读穿 | 已实现并复验 | `novel.service.test.ts` 已验证 schema / migration source 声明与 create-update-get 回归 |
| `electron/services/chapter-writeback.service.ts` + `electron/services/chapter-writeback.service.test.ts` | 章后 extract/diff 已可回流到 novel 级 `sourceLedger / chapterSourceUsage / factProvenance / canonSourceLedger / canonFactCards`，且 `extracts-only` 场景不再漏回流 | 已实现并复验 | 已覆盖 applied diff 与 extracts-only 两条路径；迁移后 `test:unit` 与定向 writeback 回归通过 |
| `src/shared/genre-system.ts` + `src/shared/genre-system.test.ts` + `electron/services/context.service.ts` + `electron/services/context.service.test.ts` | historical grounding 已开始强消费项目级 `historicalProfile / projectCanonProfile / canonConstraintSet / sourceLedger / canonFactCards`，并把其摘要编入 `worldRulesSummary` 主上下文 | 已实现并复验 | 已验证 project-level source/canon 信号会提升 grounding coverage，且 `buildStoryProfile()` 会把这些摘要编进 story profile / world rules |
| `electron/services/story-thread.service.ts` + `electron/services/story-thread.service.test.ts` | story thread typed ref overlay 的 create / update / clear-link / 保留 unrelated update | 已实现并复验 | 已验证重建 overlay、显式清空旧指针、只更新目标行 |
| `electron/services/timeline.service.ts` + `electron/services/timeline.service.test.ts` | timeline event typed ref overlay 的 create / update / clear-link / 保留 unrelated update | 已实现并复验 | 已验证显式重建与清空 stale pointer，不再只靠旧文本链 |
| `electron/services/item.service.ts` + `electron/services/item.service.test.ts` | story item typed ref overlay 的 create / update / clear-link，修复清链到空 overlay 时旧 `typedRefsJson` 残留 | 已实现并复验 | 已验证创建、更新重建、显式清空后写回 `null` |
| `electron/services/chapter-pipeline-policy.service.ts` + `electron/services/chapter-pipeline-policy.service.test.ts` | `typed_ref / source_grounding / operating_mode / long_window_humanization / dialogue_separability` finding 已接入 rewrite priority、`max_coverage` 与 mini review 阈值主链 | 已实现并复验 | 已验证新 finding 优先级先于 generic polish，并覆盖 `0.86 / 0.80` 边界阈值 |

本文档面向当前仓库实现，目标不是推翻现有长篇能力，而是在现有 `workflow / context / writeback / dashboard / recurrence` 基础上，增量把系统修到三个可稳定运行的目标区间：

1. 短篇/中短篇可快速起稿、少步骤、少资产、低摩擦。
2. 标准长篇可持续维持人物/线程/伏笔/设定一致性。
3. 史诗长篇与百万字级项目可在多卷、多阶段、多批次生成下保持可恢复、可追踪、可校验。

## 1. 先说清楚：当前已上线基础，不应被误判为“没有长篇能力”

当前仓库已经有一套可工作的长篇底座，问题主要不在“完全没有”，而在“关键能力还没有成为一等约束或一等数据层”。

### 1.1 已上线并且应保留的基础

- `electron/services/context.service.ts:86-113` 已按 `targetWords / chapterCount` 放大近期上下文窗口，最高可到 `40` 章，不是固定短窗。
- `electron/services/context.service.ts:2148-2160` 已在 `>= 350000` 字或 `>= 80` 章时提升长期记忆优先级。这里要纠正旧说法：这不是“降低长期记忆优先级”，而是把它提升到更高优先级。
- `electron/services/context.service.ts:3294-3432` 已拼装长期记忆、章节合约、伏笔/承诺、关系摘要、世界规则快照、对话声线锁等上下文块。
- `electron/services/context.service.ts:3699-3712` 已有硬约束溢出与软溢出保护，超出时会阻断或降级，而不是无边界塞上下文。
- `electron/services/story-memory.service.ts:183-247` 已按 `standard / longform / epic / mega` 分档记忆模式。
- `electron/services/story-memory.service.ts:505-613` 已持续刷新 `novel / volume / part` 级 checkpoint，并在超长项目中锁定已完成卷的记忆快照。
- `electron/services/chapter-writeback.service.ts:1134-1176` 与 `1329-1345` 已有“先生成、后回写、版本校验、冲突阻断”的安全带。
- `electron/services/batch-workflow.service.ts:1094-1103` 已在章节批处理里等待章后回写完成，说明系统已经把“生成后状态回流”视为必要步骤。
- `electron/services/chapter.service.ts` 已把审稿、反 AI、对话、风格、合约校验、改写策略、mini review verdict 串成闭环，而不是裸生成。
- `electron/services/quality-dashboard.service.ts` 已汇总合约交付、回写状态、反 AI、表达复用、hook 连续性、反馈复发等质量指标。
- `src/pages/Novel/workflow.ts:86-515` 已有引导式步骤顺序、推荐步骤、阻塞条件，不是纯自由文本工作台。

### 1.2 当前真正的边界

当前问题不是“系统完全靠 heuristic 硬拼”，而是下面几件事还没有落成强约束数据层：

- 题材约束仍以 prompt 文本为主，尤其历史题材会回退到 generic。
- 上游资产与下游章节仍大量通过名称/摘要/章节号关联，缺少稳定 typed ref 图层。
- `launchMode` 仍主要是入口差异，不是全链路 operating mode。
- 百万字级项目已有长篇基础，但还缺少模式化的记忆分层、来源分层、预计算分层与运行时隔离策略。

## 2. 现状问题与证据

### 2.1 历史题材当前会落回 generic

- `electron/database/db.ts` 已内置 `历史正剧`、`架空历史` 等题材种子。
- 但 `src/shared/genre-system.ts:1890-1908` 的 alias/pack 解析没有给 `历史正剧 / 架空历史` 提供独立 capability pack，未命中时会回退到 `generic`。

这意味着当前 UI 可以选历史题材，但底层提示、约束、校验、资料链仍可能按通用小说处理。这是历史题材“看起来支持、实际上未真正落地”的核心缺口。

### 2.2 上下游步骤是连着的，但还没连成稳定状态图

- `electron/services/story-thread.service.ts:512-539` 里线程生成后的 `relatedIds` 仍可能落成空数组。
- `electron/services/timeline.service.ts:569-607` 仍按章节号、名称去匹配人物、物品、地点、事件。
- `electron/services/item.service.ts:893-919` 仍按名称解析模板、持有者、地点、事件。

这说明仓库已经有“线程/时间线/物品/人物/章节”的分步结构，但跨步链接还偏文本匹配。问题不在有没有步骤，而在“状态主键”还不稳。

### 2.3 长期记忆已存在，但结构化记忆仍不足

- `electron/services/story-memory.service.ts:746-780` 现在输出的是章节/分卷/全书摘要、人物卡、关系卡、时间卡、线程卡等文本化 checkpoint。
- `electron/services/embedding.service.ts:103-129` 章节嵌入索引仍主要围绕 `summary / continuity / nextChapterSeed`。
- `electron/services/embedding.service.ts:241-300` 在无向量时会退回关键词检索。
- `electron/services/summary-decay.service.ts:12-63` 目前仍以摘要健康和摘要重压缩为主，而不是稳定 fact card 主导。

结论不是“没有长期记忆”，而是“长期记忆仍以摘要载荷为主，typed fact/ref 载荷还不够强”。

### 2.4 运行模式还不是真正的全链路策略

- `src/types/index.ts` 当前只有 `launchMode: 'professional_longform' | 'fast_launch'`。
- `src/pages/NovelList/index.tsx` 默认 `professional_longform`，默认目标字数 `200000`。
- `src/pages/NovelList/fast-launch.ts:199` 当前快启模式把章节目标字数近似为 `max(2500, targetWords / 80)`。
- `electron/main.ts:783`、`src/pages/Novel/CoreSettings/index.tsx:159-160` 又都默认按 `targetWords / 3000` 估算章节数。

这说明系统已经有“快启”和“专业长篇”两个入口，但章节粒度、记忆粒度、质检阈值、批处理策略、来源约束，并没有跟入口模式形成一套稳定联动。

### 2.5 百万字可做，但当前运行时还不够稳

- `electron/database/db.ts` 仍以同步 `better-sqlite3` 为主。
- 很多服务直接挂在 `electron/main.ts` 主进程。
- `electron/services/batch-workflow.service.ts:240-250` 当前批处理会把 `batchSize` 归一到 `1`。

这不是说“不能做长篇”，而是说百万字要稳，就不能只靠单章串行 + 主进程重服务 + 摘要压缩。现阶段更适合做“串行写作、并行预计算”，而不是贸然把正文生成并行化。

## 3. 运行模式矩阵：从现有 `launchMode` 演进到全链路 `operatingMode`

### 3.1 演进原则

- 保留当前 `launchMode` 字段与 UI 入口，不破坏现有项目。
- 新增 `operatingMode` 叠加层，由 `launchMode + targetWords + chapterCount + manualLock` 推导。
- 老代码继续可读 `launchMode`，新代码优先读 `operatingMode`；未命中时读穿回旧逻辑。

建议新增：

- `shortform`
- `standard_longform`
- `epic_longform`
- `million_longform`

其中产品层至少展示三档：

- 短篇
- 标准长篇
- 史诗/百万字长篇

内部再细分 `epic_longform` 与 `million_longform`，以便对齐已上线的 `story-memory` 阈值。

### 3.2 模式矩阵

| 模式 | 精确阈值 | 当前入口如何映射 | 规划粒度 | 章节默认 | 场景默认 | 上下文预算包络（新叠加层） | 近期窗口与记忆策略 | 批处理策略 | 质量阈值 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `shortform` | `targetWords < 120000` 且未手动锁定长篇 | `fast_launch` 默认优先落这里；`professional_longform` 也可落这里 | 全书 -> 核心剧情线 -> 章节；场景可选 | `2200-2800` 字/章；总章数默认 `targetWords / 2500`，不低于 `12` | `2-4` 场/章 | `scenePlan=900`，`draft=1400`，`review=1500`，`rewrite=2200` | 近期窗口按现实现状 `8`；默认只强制 `novel` 级 checkpoint，章节记忆以近窗 + 合约为主 | 正文生成 `1` 章串行；预计算最多 `2` 章 | 发布前 `hard-block=0`，反 AI 红灯 `0`，合约交付 `>=93%`，待回写 `0` |
| `standard_longform` | `120000 <= targetWords < 350000` | `professional_longform` 默认落这里 | 全书 -> 卷 -> 章节 -> 场景 | `2800-3500` 字/章；默认估算沿用现有 `targetWords / 3000` | `4-6` 场/章 | `scenePlan=1100`，`draft=1700`，`review=1900`，`rewrite=2800` | `targetWords < 150000` 时近窗 `8`，`>=150000` 时近窗 `10`；启用 `novel + volume` checkpoint | 正文仍 `1` 章串行；允许卷级预计算 `3` 章 | 发布前 `hard-block=0`，反 AI 红灯 `0`，合约交付 `>=95%`，关键人物/线程缺失 `0` |
| `epic_longform` | `350000 <= targetWords < 800000` 或 `chapterCount >= 80` | `professional_longform` 超长篇自动升级；也可手动锁定 | 全书 -> 部/卷 -> 章节 -> 场景 | `2600-3200` 字/章；每 `20-30` 章必须生成一次阶段计划复核 | `3-5` 场/章 | `scenePlan=1300`，`draft=2100`，`review=2400`，`rewrite=3200` | 近窗按现实现状分档：`15`(`>=350k`)、`22`(`>=500k`)；强制 `novel + volume + part` checkpoint；长期记忆优先级提升 | 正文仍 `1` 章串行；预计算与校验可 `3-5` 章并行 | 发布前 `hard-block=0`，反 AI 红灯 `0`，合约交付 `>=97%`，未解析 typed ref `<2%` |
| `million_longform` | `targetWords >= 800000`；`>=1500000` 或 `chapterCount >= 400` 时再加 `mega` 内部标志 | 属于“史诗/百万字长篇”产品档 | 全书 -> 部 -> 卷 -> 章群 -> 章节 -> 场景 | `2200-3000` 字/章；每 `12-20` 章一组，组后强制 checkpoint 与质检汇总 | `3-5` 场/章 | `scenePlan=1500`，`draft=2400`，`review=2800`，`rewrite=3400` | 近窗按现实现状分档：`28`(`>=800k`)、`35`(`>=1M`)、`40`(`>=1.5M`)；`mega` 时锁定已完成卷 checkpoint | 正文仍 `1` 章串行；并行只用于 embedding、source digest、quality precompute；禁止多章同时正文写入 | 发布前 `hard-block=0`，反 AI 红灯 `0`，合约交付 `>=98%`，未解析 typed ref `<1%`，来源缺口阻断项 `0` |

### 3.3 当前字段如何演进

- `launchMode` 保留：
  - `fast_launch` 继续代表“少步骤起稿入口”。
  - `professional_longform` 继续代表“完整流程入口”。
- 新增 `operatingMode`：
  - 作为全链路策略字段，驱动上下文预算、记忆写法、阶段规划、批处理、质检阈值。
- `targetWords` 继续保留为主阈值输入。
- `fast_launch` 不再直接等价“短篇”，而是“更少前置资产的入口”。如果用户在快启里填 `300000` 字，仍可落到 `standard_longform`。
- `professional_longform` 不再自动等于“长篇”，而是“完整工作流入口”。如果只写 `80000` 字，也可以走完整流程但运行在 `shortform`。

## 4. 历史题材落地设计：不是再做一个 prompt，而是补一层来源与约束

### 4.1 当前缺口

当前仓库已经能选历史题材，但还没有“历史来源层”。结果就是：

- 历史题材可能走到 `generic` 包。
- 制度、官称、器物、交通、饮食、军政结构、地理尺度，当前更多依赖模型常识。
- `历史正剧` 与 `架空历史` 没有被分成不同约束强度。

### 4.2 新增历史 grounding 叠加层

建议新增三类结构，不替换现有世界观/规则页面，只做叠加：

1. `historicalProfile`
   - `mode`: `historical_realist | alternate_history | pseudo_historical_fantasy`
   - `eraPackId`
   - `regionPackId`
   - `institutionStrictness`
   - `materialCultureStrictness`
   - `terminologyStrictness`

2. `sourceLedger`
   - 保存用户上传/导入的资料、内置资料包片段、章节使用记录、置信级别、最后验证时间。

3. `historicalConstraintSet`
   - 保存该时代允许/禁止的制度、官称、兵制、礼制、交通、建筑、器物、食物、货币、度量衡、宗教/思想流派等约束。

### 4.3 内置 capability pack

建议先做有限但实用的内置包，而不是一开始追求全历史库：

- 中国古代：
  - `先秦`
  - `秦汉`
  - `魏晋南北朝`
  - `隋唐`
  - `宋元`
  - `明清`
  - `晚清-民国`
- 通用扩展：
  - `架空王朝-中式官僚`
  - `架空王朝-军阀割据`
  - `近代转型`

每个包至少给出：

- 官制/机构清单
- 常见社会阶层
- 交通/通讯上限
- 武器/器物上限
- 建筑/服饰/饮食关键词
- 禁止跨时代术语清单
- 可安全泛化的保守表达模板

### 4.4 来源层级

历史题材的上下文与校验必须遵守固定层级：

1. 用户锁定资料
2. 项目内已确认设定
3. 内置时代包/地区包
4. 题材包通用规则
5. 保守 generic fallback

其中第 `5` 层不能再生成“貌似准确”的具体历史细节，只能退回保守写法，例如：

- 不写精确官名时，改写为“属官”“幕僚”“军中主簿一类职官”
- 不确认器物时，改写为“铜制器具”“木轮车辆”“轻便甲具”
- 不确认路线时，改写为“沿官道北上数日”

### 4.5 provenance 存储

不要另开一套孤立数据库，建议在现有项目存储上叠加：

- `historical_profile_json`
- `source_ledger_json`
- `chapter_source_usage_json`
- `fact_provenance_json`

并在 writeback 阶段把“本章新增的历史事实/用词/制度引用”回流到项目状态中。

2026-05-10 更新：`electron/database/schema.ts`、`electron/database/db.ts`、`electron/services/novel.service.ts`、`electron/services/chapter-writeback.service.ts` 已补齐这些项目级 JSON 字段的最小存储与回流接线。当前已能在 novel 读写链路中保存/读取这些字段，并在章后回写成功时把 extract/diff 汇总沉淀到 `chapter_source_usage_json / fact_provenance_json / source_ledger_json`；同日已把 `validateRequiredSchema()` 调整为分阶段校验，并在 `0038_novel_source_canon_fields` 内补最终校验，确保旧库/部分库恢复链不会在早期 validate 步骤上提前失败；更严格的历史 profile 录入、source 结构化校验与 validator 强依赖仍是后续工作。

### 4.6 validator 行为

历史 validator 不能另起第二套质量栈，应接到现有 `chapter.service.ts -> review notes -> rewrite -> writeback -> dashboard` 链里。

校验规则建议分级：

- `历史正剧`
  - 来源缺失可阻断发布。
  - 明显时代错置为 hard block。
  - 官制/器物/称谓冲突必须进 rewrite。
- `架空历史`
  - 若项目显式声明“分歧点”或“架空制度”，允许偏离真实历史。
  - 偏离必须有项目内 provenance，不能既无史实来源也无架空设定。
- `类历史奇幻`
  - 超自然元素允许，但制度/器物/社会结构仍应有时代包约束，不应退化成纯 generic 玄幻。

### 4.7 非历史题材也必须有同等级的 canon / research / source 底座

历史题材不是例外。当前仓库对所有题材都存在同一个根问题：很多“世界规律、门派规则、修炼层级、魔法代价、命名习惯、资源经济、禁忌规则”仍主要存在于 prompt 文本里，而不是项目级一等数据。

因此建议把历史 grounding 扩成全题材通用底座，项目级统一新增：

1. `projectCanonProfile`
   - 项目主世界类型、题材主包、副题材包、命名体系、叙事视角、声调、技术/超自然上限。
2. `canonConstraintSet`
   - 该项目明确允许/禁止/待考证的规则集合。
3. `canonSourceLedger`
   - 保存用户资料、内置题材包片段、项目内已确认设定、章节使用记录、置信度与版本。
4. `canonFactCards`
   - 把“已确认设定”沉淀成结构化卡片，而不是只留在长文本摘要里。

这个通用底座适用于全部题材，历史题材只是其上的一个高严格度 profile。

2026-05-10 更新：本轮先落了最小真实数据层，不是只改文档。`novels` 已新增 `project_canon_profile_json / canon_constraint_set_json / canon_source_ledger_json / canon_fact_cards_json`，且章后回写成功时会把 chapter-level extract/diff 回流到 `canon_source_ledger_json / canon_fact_cards_json`。尚未完成的部分是更细粒度 card schema、context 强消费、以及按题材包拆分的 validator 规则。

### 4.8 全题材统一的来源层级

除历史外，其余题材也必须遵守固定来源层级，避免模型自由脑补：

1. 用户锁定资料与用户手写 canon
2. 项目内已确认设定与已发布章节回写事实
3. 内置 capability pack 与 constraint set
4. 题材通用规则
5. 保守 fallback

第 `5` 层的原则也一样：当来源/设定覆盖不足时，不生成“看似具体、实则空泛”的 generic AI 细节，而改写为保守、低承诺的表达，并把缺口显式暴露给 review / rewrite / dashboard。

### 4.9 修仙 / 仙侠 / cultivation grounding

#### capability pack / profile 字段

建议新增 `cultivationProfile`，至少包含：

- `cosmologyModel`
  - 单界 / 多界 / 上下界 / 诸天体系
- `realmSystem`
  - 境界序列、每境界子层级、破境条件、失败代价
- `sectOrderModel`
  - 宗门/世家/王朝/散修结构、门规、戒律、师承关系
- `resourceEconomyModel`
  - 灵石、丹药、灵植、法器、阵法材料、洞天福地、秘境产出
- `combatLawModel`
  - 功法、体修/法修/剑修分支、战斗尺度、禁术代价
- `tabooRuleSet`
  - 天道禁忌、誓言约束、心魔、因果、夺舍、血祭等
- `namingConventionProfile`
  - 人名、道号、宗门名、功法名、器物名、地名的构词规则
- `toneRegisterProfile`
  - 古风程度、口语允许度、术语密度、旁白庄严度

#### constraint set 内容

`cultivationConstraintSet` 至少应是结构化数据，而不是 prompt 段落：

- `realmProgressionRules`
- `powerCeilingRules`
- `resourceScarcityRules`
- `sectLawRules`
- `tabooAndBacklashRules`
- `artifactNamingRules`
- `combatCausalityRules`
- `breakthroughPrerequisiteRules`
- `inter-realmTravelRules`

#### provenance / source 存储

建议在项目层叠加：

- `cultivation_profile_json`
- `canon_source_ledger_json`
- `chapter_canon_usage_json`
- `canon_fact_cards_json`

并由 `chapter-writeback.service.ts` 回写：

- 本章确认的新境界规则
- 本章新增的宗门法度/资源规则
- 本章首次出现且被接受的术语、功法、器物、禁忌

#### validator 行为

应接入现有 `chapter.service.ts` review/rewrite 闭环，至少检查：

- 境界顺序是否跳级或回退无因
- 资源消耗与产出是否失衡
- 宗门法度是否前后冲突
- 禁术/誓言/心魔代价是否被“说了不算”
- 命名体系是否突然现代化或杂糅失控
- 古风 register 是否明显漂移为 generic 网络说明文

#### 覆盖不足时的保守 fallback

- 未确认具体境界机制时，不写复杂数值化突破细节，只写“修为松动”“瓶颈将破未破”。
- 未确认宗门法规时，不编造具体戒律编号，改写为“门中禁例”“长老议定的规矩”。
- 未确认资源经济时，不同时出现大量低成本高收益资源。
- 未确认命名规则时，不混入现代网文随机名词与英文感术语。

#### 它如何阻止 generic AI generation

因为“境界、宗门法、资源经济、禁忌、命名”被提升为 fact card 与 constraint set 后，模型不再只靠 prompt 想象“修仙味”，而要受项目内世界法则与回写事实约束。

### 4.10 奇幻 / 西幻 / 玄幻 grounding

#### capability pack / profile 字段

建议新增 `fantasyProfile`，至少包含：

- `cosmologyType`
  - 一神/多神/无神、神祇是否直接干预
- `magicSystemType`
  - 软魔法 / 硬魔法 / 神术 / 血脉 / 契约 / 炼金
- `politicalOrderModel`
  - 王国、帝国、城邦、教团、氏族、学院体系
- `speciesEcologyModel`
  - 种族结构、寿命差、社会位置、通婚/敌对关系
- `resourceAndTradeModel`
  - 魔晶、矿产、药材、航线、税制、佣兵/公会经济
- `militaryAndTravelModel`
  - 行军速度、飞行/传送上限、通信速度
- `namingConventionProfile`
  - 人名/地名/神名/法术名/贵族名号规则
- `toneRegisterProfile`
  - 史诗感、民间感、黑暗度、叙事密度

#### constraint set 内容

`fantasyConstraintSet` 至少包含：

- `magicCostRules`
- `technologyCeilingRules`
- `divinityInterventionRules`
- `speciesBehaviorRules`
- `politicalLegitimacyRules`
- `travelAndCommunicationRules`
- `artifactAndRelicRules`
- `forbiddenKnowledgeRules`

#### provenance / source 存储

使用与通用底座一致的：

- `project_canon_profile_json`
- `canon_constraint_set_json`
- `canon_source_ledger_json`
- `canon_fact_cards_json`

差别只在 pack 类型与 validator 规则不同，不应另起孤岛。

#### validator 行为

- 魔法代价与效果是否失衡
- 世界交通/通信上限是否被随意突破
- 宗教/神祇是否前后设定不一
- 种族、王权、学院、公会规则是否自相矛盾
- 命名体系是否在西幻/玄幻/现代口语间乱跳
- 旁白是否退化成通用“设定讲解器”

#### 覆盖不足时的保守 fallback

- 不确认魔法硬规则时，不写高确定性系统说明，只写角色可感知的现象与代价。
- 不确认宗教体系时，不编造完整教阶与神谱。
- 不确认交通上限时，不让角色瞬间跨大陆而无成本。
- 不确认命名规范时，避免混用明显不同语系的名字模板。

#### 它如何阻止 generic AI generation

通过把“魔法代价、政治合法性、种族生态、交通上限、命名规则”沉淀成结构化约束，章节生成时就不再只靠“写得像西幻/玄幻”，而是必须服从本项目的世界运行边界。

### 4.11 科幻 / speculative / 自定义设定 grounding

#### capability pack / profile 字段

建议新增 `speculativeProfile`，至少包含：

- `techParadigm`
  - 近未来 / 赛博 / 太空歌剧 / 末世重建 / 生物工程 / 时间题材
- `scienceToleranceMode`
  - 硬科幻 / 软科幻 / 设定优先
- `energyAndInfrastructureModel`
  - 能源来源、算力、制造能力、交通网络、殖民/补给链
- `governanceModel`
  - 公司、联邦、军政、AI 治理、殖民政府、部落联合体
- `augmentationOrPowerModel`
  - 义体、基因改造、心灵能力、AI 接口、纳米系统
- `riskAndFailureModel`
  - 技术失效、伦理边界、污染、辐射、时空悖论、社会成本
- `terminologyProfile`
  - 专有名词命名规则、缩写规则、机构编号规则
- `toneRegisterProfile`
  - 技术说明密度、冷硬度、抒情度、悬疑度

#### constraint set 内容

`speculativeConstraintSet` 至少包含：

- `technologyCeilingRules`
- `travelLatencyRules`
- `communicationLatencyRules`
- `manufacturingCapacityRules`
- `augmentationCostRules`
- `informationSecurityRules`
- `aiAutonomyRules`
- `catastropheBoundaryRules`

#### provenance / source 存储

仍然走通用 `canon source ledger`，但需要额外记录：

- 现实研究资料与用户参考
- 项目内自定义术语表
- 技术路线分歧点
- 已确认不可违背的硬设定

#### validator 行为

- 技术能力是否超出已声明上限
- 物流/通信/制造是否与世界规模匹配
- 义体/改造/心灵能力代价是否被忽略
- 自定义术语是否在不同卷中漂移
- 技术说明是否膨胀成 generic AI 科普段落

#### 覆盖不足时的保守 fallback

- 没有确认技术机理时，不伪装成严密硬科幻细节。
- 没有确认社会治理结构时，不编造完整制度链条。
- 没有确认能力代价时，不允许主角无成本连续开挂。
- 没有确认术语表时，不让缩写、型号、机构命名随机漂移。

#### 它如何阻止 generic AI generation

因为 speculative 项目最容易掉进“高概念名词堆砌 + 通用解释段”的 AI 生成习惯，只有把技术上限、成本、延迟、治理结构、术语规则变成第一类数据，系统才能长期维持自洽。

## 5. 保留 / 扩展 / 替换矩阵

| 服务/流程 | 当前已上线角色 | 动作 | 迁移说明 |
| --- | --- | --- | --- |
| `electron/services/context.service.ts` | 核心上下文编排、优先级、溢出控制、记忆拼装 | 保留 + 扩展 | 继续做上下文总装器；新增 `operatingMode`、typed ref、历史来源、fact card 输入块 |
| `electron/services/chapter.service.ts` | 章节生成、review/rewrite 闭环、合约/风格/反 AI 接入点 | 保留 + 扩展 | 所有新校验都进现有 review notes 与 rewrite policy，不新建第二条质检流水线 |
| `electron/services/chapter-writeback.service.ts` | 章后回写、版本冲突保护、状态回流 | 保留 + 扩展 | 新增 typed ref diff、source usage diff、fact card diff 的回写，不改其事务地位 |
| `electron/services/quality-dashboard.service.ts` | 合约、回写、反 AI、hook、复发等质量汇总 | 保留 + 扩展 | 新增 `typed ref 覆盖率`、`来源覆盖率`、`历史题材异常`、`模式违规` 面板 |
| `electron/services/anti-ai-rule.service.ts` | 反 AI 规则与命中结果 | 保留 + 扩展 | 不替换；只把题材/模式感知规则并入现有规则集 |
| `electron/services/workspace-quality.service.ts` | 工作区级质量扫描与修复建议 | 保留 + 扩展 | 作为历史来源缺口、图谱缺口、模式切换风险的后台扫描器 |
| `electron/services/generation-integrity.service.ts` | 生成完整性、hook 连续性、声线演化 | 保留 + 扩展 | 新增 provenance 完整性、typed ref 漂移、阶段计划偏移检查 |
| `electron/services/story-memory.service.ts` | checkpoint、阶段摘要、长篇记忆模式 | 保留接口 + 扩展载荷 | 不替换入口；只逐步把文本摘要 checkpoint 扩展为“摘要 + structured fact/ref/source card” |
| Guided workflow | 分步创作、阻塞条件、推荐步骤 | 保留 + 扩展 | 新增 operating mode、历史资料、阶段复核三个可见步骤或面板 |
| Fast launch | 快速起稿入口 | 保留 + 扩展 | 保留“快启”，但让它走 `operatingMode` 适配，不再用单一章数字 heuristic 覆盖所有项目 |

## 6. 增量迁移方案：每个大改动都给出源、叠加层、双写/读穿、回填、切换、回滚

### 6.1 改动 A：把 `launchMode` 演进为真正的 operating mode

| 项目 | 内容 |
| --- | --- |
| 当前 source of truth | `launchMode`、`targetWords`、若干章节估算 heuristic，分散在 `NovelList`、`CoreSettings`、`context.service.ts`、`story-memory.service.ts` |
| 新 overlay | `operatingModePolicy`，统一产出 `shortform / standard_longform / epic_longform / million_longform` 与对应预算、规划粒度、记忆策略、质检阈值 |
| 双写/读穿 adapter | 保存 `launchMode` 不动；新增 `operatingMode` 缓存字段。新服务先读 `operatingMode`，没有就按 `launchMode + targetWords` 即时推导 |
| backfill path | 项目打开时一次性推导；后台任务为历史项目补写模式快照 |
| cutover condition | `>=95%` 已有项目在新旧模式推导下得到相同或更合理的章节规模/记忆规模，且无新增 publish regression |
| rollback condition | 关闭 `operatingMode` feature flag，恢复现有分散 heuristic |

### 6.2 改动 B：给人物/物品/线程/时间线补 typed ref 图层

| 项目 | 内容 |
| --- | --- |
| 当前 source of truth | 现有 entity 表、章节摘要、名称匹配、章节号匹配、合约对象 |
| 新 overlay | `typedRef / alias / provenance / confidence` 图层，附着在线程、时间线、物品、人物、章节事件之上 |
| 双写/读穿 adapter | 生成阶段同时写原有文本字段和 `typedRef`；读取阶段优先 typed ref，缺失时回退名称匹配 |
| backfill path | 后台扫描既有项目，按名称、上下文、合约、章节邻近关系推导 ref，并标记 `confidence` |
| cutover condition | 新生成资产 typed ref 覆盖率 `>=95%`；历史项目 typed ref 自动解析率 `>=85%`；dashboard 上 unresolved ref `<2%` |
| rollback condition | 关闭 typed ref 读取开关，继续沿用现有文本匹配；保留 overlay 但不参与生成 |

### 6.3 改动 C：给历史题材补来源层与 capability pack

| 项目 | 内容 |
| --- | --- |
| 当前 source of truth | 题材选择、世界观文本、通用 genre pack、用户自由输入 |
| 新 overlay | `historicalProfile + sourceLedger + historicalConstraintSet` |
| 双写/读穿 adapter | 历史项目写入来源层；prompt/context 先读来源层，缺失时回退现有 genre/world rules 文本 |
| backfill path | 对已存在 `历史正剧 / 架空历史 / 类历史` 项目做一次 era inference；无法推断时提示用户补选时代包 |
| cutover condition | 历史项目来源覆盖率 `>=80%`；历史正剧发布前 `anachronism hard block = 0`；generic fallback 使用率明显下降 |
| rollback condition | 把历史 validator 从 block 降为 warning，prompt 退回当前 genre/world rules 路径 |

### 6.4 改动 D：把 story memory 从“摘要为主”扩成“摘要 + fact/ref/source card”

| 项目 | 内容 |
| --- | --- |
| 当前 source of truth | `story-memory.service.ts` 输出的文本 checkpoint 与卡片摘要 |
| 新 overlay | `structuredCheckpointCards`，包含人物状态、关系状态、线程状态、关键物品状态、世界规则状态、来源摘要 |
| 双写/读穿 adapter | 继续写当前文本摘要，同时增写结构化 card；`context.service.ts` 优先读结构化 card，不足再读文本摘要 |
| backfill path | 先回填已锁卷 checkpoint，再回填最近 `N` 章；不一次性全量重算全书 |
| cutover condition | recall reject rate 下降，且 context overflow 不上升；长篇项目的跨卷人物/线程遗漏率下降 |
| rollback condition | 停用结构化 card 读取，保留文本 checkpoint 主路径 |

### 6.5 改动 E：扩展现有质量闭环，而不是并列再造第二套

| 项目 | 内容 |
| --- | --- |
| 当前 source of truth | `chapter.service.ts` review/rewrite、`anti-ai-rule.service.ts`、`quality-dashboard.service.ts`、`workspace-quality.service.ts`、`feedback recurrence`、`writeback` |
| 新 overlay | 新增三类 finding：`typed ref 缺口`、`来源缺口`、`operatingMode 违规` |
| 双写/读穿 adapter | 新 finding 写入现有 review notes / dashboard schema；publish gate 继续走现有通道 |
| backfill path | `workspace-quality.service.ts` 对既有项目做离线扫描并生成修复任务 |
| cutover condition | 新 finding 在 dashboard 可见、可追踪、可回写，且不产生第二个发布入口 |
| rollback condition | 关闭新 finding 分类开关，不影响既有质检 |

### 6.6 改动 F：百万字运行时做“串行正文 + 并行预计算”

| 项目 | 内容 |
| --- | --- |
| 当前 source of truth | 主进程服务、同步 SQLite、`batchSize = 1` |
| 新 overlay | `precompute worker queue`，只承接 embedding、source digest、memory compaction、dashboard precompute |
| 双写/读穿 adapter | 正文生成与回写仍走主路径；只把可重算任务外移到 worker |
| backfill path | 仅对 `>=350000` 字项目启用后台预计算；旧项目打开后渐进补算 |
| cutover condition | `>=800000` 字项目批处理等待时间下降 `>=30%`，writeback 冲突率不升，主线程卡顿下降 |
| rollback condition | 关闭 worker flag，回到主进程串行执行 |

## 7. 质量方案必须建立在现有闭环之上

这里必须明确：不建议再造“第二个质量栈”。仓库已经有比较完整的闭环，正确方向是扩展它。

### 7.1 当前闭环应该被保留

当前主链路已经是：

1. 章节生成
2. review notes 聚合
3. 反 AI / 人类化 / 对话 / 风格 / 合约校验并入 review notes
4. rewrite policy 生成
5. mini review verdict
6. writeback 写回状态
7. dashboard 汇总
8. recurrence/next-step 继续约束后续章节

### 7.2 新能力怎么接入

新增能力应直接进入现有节点：

- `typed ref 缺口` -> 进入 review notes 与 dashboard
- `历史来源缺口` -> 进入 review notes、rewrite、dashboard、workspace scan
- `operatingMode 违规`
  - 例如短篇误进过深规划
  - 或百万字项目没有做阶段 checkpoint
  - 这些都应成为现有 publish gate 的输入，而不是另做一套 gate

### 7.3 新的质量指标

建议在当前 dashboard 上新增以下指标，不另建面板体系：

- `typedRefCoverage`
- `sourceCoverage`
- `historicalViolationCount`
- `modePolicyViolationCount`
- `structuredCheckpointCoverage`
- `publishBlockedByProvenance`

### 7.4 长周期人类化 / 反 AI 验收指标

下面这些指标不是替代现有 `anti-ai-rule.service.ts`、`generation-integrity.service.ts`、`quality-dashboard.service.ts`、`workspace-quality.service.ts`，而是要接在它们上面，变成可观测、可阻断、可回写的长期指标。

| 指标 | 具体定义 | 主要服务接入点 | 验收阈值 |
| --- | --- | --- | --- |
| 跨卷声线扁平化 | 比较同一 POV/旁白在跨卷 checkpoint 中的句长分布、语气词偏好、修辞密度、叙述距离；若不同卷趋同到无法区分，则记为 flattening | `generation-integrity.service.ts` 负责计算；`quality-dashboard.service.ts` 展示；`chapter.service.ts` 在 review notes 中提示 | `epic+` 项目相邻两卷主 POV 声线相似度不得长期高于 `0.92`；连续 `3` 卷超过阈值则阻断发布前复核 |
| 题材语域漂移 | 比较章节语言与题材 profile 的 register 约束，例如仙侠古风度、西幻史诗感、科幻术语密度 | `anti-ai-rule.service.ts` 增加 genre-register 规则；`chapter.service.ts` 写入 rewrite policy | 近 `20` 章滚动窗口内，题材 register 漂移率 `<5%`；历史/仙侠/硬科幻项目 `<3%` |
| 说明膨胀 / 解释密度 | 统计章节中解释句、世界设定说明段、抽象总结句的占比，相对动作/对话/场景推进比重是否过高 | `anti-ai-rule.service.ts` 与 `workspace-quality.service.ts` 共同扫描；`quality-dashboard.service.ts` 汇总 | 单章解释性句段占比 `<=18%`；连续 `5` 章滚动均值 `<=15%`；超标进入 rewrite |
| 累积同质化 / 场景语言重复 | 比较最近 `30/60/120` 章的场景开场、冲突转折、结尾钩子、感官描写模板是否反复复用 | `workspace-quality.service.ts` 做长窗扫描；`anti-ai-rule.service.ts` 记录命中；`feedback recurrence` 跟踪反复问题 | 最近 `60` 章重复场景模板命中率 `<8%`；最近 `120` 章重复开场句式 `<5%` |
| 角色对白可分离度 | 在长间隔后比较角色对白的用词、句式、敬辞、口癖、信息组织方式是否仍可区分 | `generation-integrity.service.ts` 计算角色 voice fingerprint；`context.service.ts` 消费 `dialogueVoiceLocks`；`chapter.service.ts` 生成修订建议 | 核心角色两两对白可分离度 `>=0.70`；相隔 `30` 章后回归出场仍需 `>=0.65` |

#### 指标如何接入当前闭环

- `generation-integrity.service.ts`
  - 扩展现有声线演化与 hook 连续性能力，新增 `voice fingerprint`、`register drift`、`dialogue separability` 计算。
- `anti-ai-rule.service.ts`
  - 扩展现有反 AI 规则，新增 `解释密度`、`模板复用`、`题材语域漂移` 命中项。
- `workspace-quality.service.ts`
  - 负责 `30/60/120` 章的长窗扫描，找累计同质化，而不是只看单章。
- `quality-dashboard.service.ts`
  - 展示上述指标趋势，而不是只展示一次性命中。
- `chapter.service.ts`
  - 把超阈值指标并入 review notes / rewrite policy / publish gate，不另造新 gate。

#### 为什么这些指标对“减少 AI 味”是必要的

当前很多 AI 味不是单章能看出来，而是长周期累积后出现：

- 卷与卷之间旁白变得像同一个模板
- 题材语域慢慢滑向 generic 说明文
- 章节越写越爱解释世界观，而不是让行动承载信息
- 场景开场、冲突触发、结尾钩子越写越像
- 很久没出场的角色回来后，说话方式像失忆

这些都必须通过现有服务链的“长窗观测 + 回写约束 + 发布门控”来解决。

## 8. 分阶段落地与可验收标准

### Stage 0：校准与观测

目标：

- 新增 `operatingMode` 只读推导，不改现有写作流程。
- dashboard 增加只读观测：当前项目落在哪个模式、typed ref 缺口、历史题材 generic fallback 命中率。

验收标准：

- 现有项目可无迁移阻塞打开。
- `>=95%` 项目能稳定推导出模式。
- 历史题材项目能被识别并标注是否落到 generic fallback。

### Stage 1：模式化策略接管上下文与规划

目标：

- `context.service.ts` 开始按 `operatingMode` 读取预算包络。
- Guided workflow 与 fast launch UI 显示当前模式、章节粒度、阶段复核要求。

验收标准：

- 不破坏 `launchMode` 老项目。
- 模式切换后，章节/场景建议与上下文预算可见且可解释。
- `shortform` 项目不再被迫走超深分卷流程；`epic+` 项目会出现阶段复核提示。

### Stage 2：typed ref 图层落地

目标：

- 线程、时间线、物品、关键事件开始双写 typed ref。
- dashboard 显示 ref 覆盖率与未解析项。

验收标准：

- 新生成资产 typed ref 覆盖率 `>=95%`。
- 历史项目自动回填解析率 `>=85%`。
- writeback 仍能处理版本冲突，且不新增脏写问题。

### Stage 3：历史 grounding 落地

目标：

- 历史 capability pack 上线第一批时代包。
- `历史正剧 / 架空历史 / 类历史奇幻` 使用不同强度 validator。

验收标准：

- `历史正剧` 不再走 generic pack。
- 来源缺失时会触发保守写法或阻断，而不是编造细节。
- 历史项目章节级来源覆盖率 `>=80%`。

### Stage 4：结构化记忆与长篇稳定性增强

目标：

- `story-memory.service.ts` 双写结构化 checkpoint card。
- `context.service.ts` 优先消费结构化状态块。
- `generation-integrity.service.ts` 与 `workspace-quality.service.ts` 开始输出长周期人类化指标。

验收标准：

- `>=350000` 字项目跨卷人物/线程遗漏率明显下降。
- recall reject rate 下降，context overflow 不上升。
- `>=1500000` 字项目可稳定锁定已完成卷 checkpoint。
- 跨卷声线扁平化告警可在 dashboard 中持续可见，且连续 `3` 卷超阈值会触发发布前复核。

### Stage 5：百万字运行时优化

目标：

- 引入后台 precompute worker。
- 保持正文生成单章串行与 writeback 顺序一致。
- 长窗 anti-AI / humanization 指标接入 publish gate。

验收标准：

- `>=800000` 字项目批处理等待时间下降 `>=30%`。
- writeback 冲突率不升。
- UI 主线程卡顿与 dashboard 刷新阻塞下降。
- 题材语域漂移率、解释密度、累计同质化、对白可分离度四项指标都可按 `30/60/120` 章窗口稳定计算，并进入 review / rewrite / dashboard / publish gate 主链。

## 9. 结论：这个仓库应当怎么修

结论不是“重写一套新架构”，而是：

1. 保留现有长篇基础：
   - `context`
   - `story memory`
   - `writeback`
   - `quality dashboard`
   - `anti-ai`
   - `workspace quality`
   - `generation integrity`
   - guided workflow
2. 把真正缺失的三层补出来：
   - `operatingMode` 层
   - `typed ref / structured state` 层
   - `historical/source grounding` 层
3. 百万字路线不要先并行正文，而要先把：
   - 阶段规划
   - 结构化 checkpoint
   - 来源回写
   - 预计算隔离
   做稳

如果按这个顺序推进，当前仓库不需要推倒重来，也能逐步从“有长篇功能”升级为“可控的长篇/历史/百万字生成系统”。
