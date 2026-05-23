# AI Novel Quality Workflow Gap Closure

## 结论

本文收敛当前 AI 小说生产链路的缺口闭环，不重写已有章节流水线、writer orchestrator、allocator 或质量看板。

当前系统已经具备章节生成、AI 体检、发布前检查、反 AI 味复现升级、样章风格锁、上下文预览、长篇记忆、召回诊断和多格式导出。需要补强的是：用户点名的强 AI 味细分规则、逐章分析/优化队列、发布平台复制、题材动态资产建议和语义级上下文压缩。

## 当前已存在能力

- 正文流水线已有 `planner -> writer -> critic -> rewriter -> canonizer -> finalize`，不是单 prompt 生成。
- `content-guardrails / language-drift / anti-ai-rule` 已覆盖口号化空词、万能起手、模板动作、模板情绪、空泛描写、对称排比、伪哲学、提示词泄露、内部 ID 泄露等问题。
- `style-analysis / style-compliance` 已支持真实样章、人工风格锁、句长、段长、对白比例和禁用表达。
- `getChapterContextPreview` 已能展示上一章先验、召回来源、硬约束注入、writer tools trace 和各阶段上下文预算。
- 顶层导出已有 TXT、Markdown、DOCX、EPUB，后端也支持 JSON。

## 已确认缺口

- 强 AI 味缺少显式规则：破折号/括号说明滥用、“不是……而是/是……”句式、双重比喻、排比堆叠、手指/指节/指腹/瞳孔/声音很轻等低价值细节、睁眼闭眼孤段。
- 正文层面的 AI 过程泄露还需拦截，例如“AI生成中”“以下是优化后的正文”“思考过程”“修订建议”。
- 逐章分析目前偏当前章触发，缺少从第 1 章到第 N 章依次体检、发布门检查、生成修订任务的队列。
- 整章优化入口不够明确；已有选段重写和流水线重写，但缺“保留剧情事实，只做整章读感优化”的候选稿流程。
- 发布平台能力不足；没有面向番茄等平台的章节标题格式、正文清洗、字数统计和一键复制。
- 人物和物品已有题材 preset，但部分 UI 仍呈现固定数量选择，没有清楚说明“为什么推荐这个数量”。
- 摘要退化修复偏确定性截取，长篇后期仍可能丢失因果、人物隐性动机、伏笔和线程层级。

## 已落地修复

- 新增强 AI 味规则 code：`dash_abuse`、`parenthetical_explanation_abuse`、`not_but_definition_pattern`、`double_metaphor_or_simile_stack`、`parallelism_overuse`、`low_value_body_detail`、`eye_open_close_standalone_paragraph`、`soft_voice_cliche`、`ai_process_leak`。
- 新增语言漂移指标：破折号密度、括号说明密度、比喻堆叠率、排比句率、手眼声音细节密度、孤立模板短段率。
- 反 AI 味复现机制已能把新增规则升级为后续章节硬约束。
- 导出菜单补齐 JSON；新增番茄/通用平台格式复制能力，复制前会清理 AI 过程残留。
- 正文页新增整章 AI 优化候选稿入口，默认只生成候选，用户确认后才写回。
- 角色和物品生成弹窗显示题材建议数量，并把推荐值标注在可选项里。

## 后续实现项

- 在批量工作台或质量看板加入“逐章分析队列”：顺序运行 `chapter.aiCheck` 和 `chapter.runPublishCheck`，只写入问题与修订任务，不自动改正文。
- 给 `review / rewrite` 阶段补独立 risk/proof/delta pack，避免继续依赖全量 writer soft context。
- 为摘要退化增加 AI 语义重压缩：章节事实摘要、人物状态摘要、伏笔/线程摘要三段式输出，并保留确定性 fallback。
- 发布平台面板继续扩展：平台选择、当前章/选中章/全书范围、敏感词风险、分卷/分批复制、平台包导出。
- 正文事实来源核验继续增强：新增实体、能力、物资、地名必须标记来源，无法追溯时进入发布前检查或修订中心。

## 验收标准

- 用户点名的 AI 味问题至少各有一个正例和一个不误杀反例。
- 新增 drift 指标能在 AI 体检、质量看板和反 AI 复现中展示。
- 整章优化不会自动覆盖正文；应用后生成章节版本快照。
- 平台复制能输出“第N章 标题 + 正文空行”格式，并清理 AI 过程残留。
- 题材不同，人物/物品默认建议数量不同，用户仍可手动覆盖。
- 任一新增 AI 能力失败时不影响原编辑器保存、章节生成和手工导出。

## 非目标

- 不直接接入番茄、起点、晋江账号发布接口。
- 不新增外部 MCP、通用持久化 retrieval cache 或 skill marketplace。
- 不重写章节流水线和 allocator。
- 不用自动优化直接覆盖用户正文。
