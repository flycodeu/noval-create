# 通过 MCP 协作创作 NovelForge

本文按 2.4.42 源码及已打开的正式安装版核对。连接后先用 `novelforge.capabilities.list` 查看工具、参数和权限；升级后重新连接。客户端提供的工具还可能受单次批准策略限制。

## 连接安装版

手动打开 NovelForge，在“设置 → Codex 连接”登记当前 EXE；也可将下面路径替换成实际安装位置：

```powershell
codex mcp add novelforge -- "D:\Program Files\NovelForge\NovelForge.exe" --mcp
codex mcp get novelforge
```

登记成功只表示命令与参数匹配。重新连接后调用 `novelforge.projects.list`，确认会话可用。MCP 使用 stdio 桥接到桌面持有的本机鉴权服务，共用正式作品库；桥接进程不独立打开数据库。

桌面与 MCP 可同时使用。桌面保持打开或最小化即可；退出后需手动打开并重新连接。MCP 不自动启动后台实例，不接受临时数据目录或与登记 EXE 不匹配的实例。仓库的 `node scripts/run-novelforge-mcp.cjs` 也只连接已打开的安装版，不启动源码版或测试副本。

Windows 正式数据通常在 `%APPDATA%\NovelForge`，与 EXE 安装位置无关。顶部版本标记可查看实际程序与数据位置。遇到占用提示先检查进程，不要删除锁文件或覆盖数据库。

## 先读取项目

1. 用 `novelforge.projects.list` 按名称找项目，再用 `novelforge.projects.get` 读取项目和 `contextVersion`。
2. 用 `novelforge.assets.query` 读取背景与分页章节，传 `chapterId` 可取某章正文及合同。人物、地图与关系用 `novelforge.atlas.query`。
3. 明确本轮阶段、已有事实、可改范围及待确认项。先保留候选供作者审阅时，显式指定 `autoApply:false`。

以下 JSON 均是工具 arguments，ID 和版本是示例值，不应直接对正式作品执行。

## 生成候选、审阅与应用

当前公开 MCP 没有任意外部文本的通用草稿导入或通用草稿审校接口。旧版立项 JSON 导入流程已移除，不能仅更换工具名并沿用旧字段。外部已写好的整份立项或正文可保存为本地材料，再由作者在对应编辑页整理；资料卡和图谱更正各用其独立接口。

使用 `novelforge.workflows.start` 的 `background` 阶段生成立项候选，会调用作品配置的生成、审校模型并保存任务及工件，需要有效模型配置。先用 `novelforge.context.preview` 检查上下文；预览不调用生成模型或写正文。

<!-- mcp-tool: novelforge.context.preview -->
```json
{
  "novelId": 12,
  "stage": "background",
  "request": "只讨论边境商路小说的立项方向。主角身份、时代、交通方式待确认，不新增既定人物、地点或正文。"
}
```

作者要求生成后，调用 `novelforge.workflows.start`：

<!-- mcp-tool: novelforge.workflows.start -->
```json
{
  "novelId": 12,
  "stage": "background",
  "operation": "generate",
  "request": "只完成边境商路小说的立项候选：读者期待、主角目标方向、持续冲突和待确认问题。主角身份、时代、地点和制度不写成既有事实，不写正文。",
  "atChapter": 0,
  "autoApply": false,
  "idempotencyKey": "merchant-route-background-001"
}
```

必填字段为 `novelId`、`stage`、`request`、`idempotencyKey`，立即返回 `run.runId`。该工具不接收旧导入流程的 `assetType`、`output`、`analysis`、`parentArtifactId`、`expectedContextVersion`；服务端启动时记录项目版本，在生成和应用时检查。

用 `novelforge.workflows.get` 跟踪明确的 `runId`，避免读到另一项最近任务：

<!-- mcp-tool: novelforge.workflows.get -->
```json
{ "novelId": 12, "runId": 123 }
```

从 `run.artifactId` 和 `run.reviewArtifactId` 取得候选及报告 ID，再用 `novelforge.artifacts.get` 读取完整内容。参数名是 `artifactId`，不是 `id`；不要沿用旧的 `draftArtifact.id` 返回结构。

<!-- mcp-tool: novelforge.artifacts.get -->
```json
{ "artifactId": "replace-with-returned-artifact-id" }
```

`autoApply:false` 的通过候选停在等待应用状态，可见 `status:"paused"`、`step:"needs_attention"`、`reviewStatus:"passed"`；这不表示失败或作者已采纳。作者确认后调用 `novelforge.workflows.apply`：

<!-- mcp-tool: novelforge.workflows.apply -->
```json
{ "novelId": 12, "runId": 123 }
```

应用不重新调用模型，需要候选通过审校且版本仍有效。`workflows.resume` 恢复中断任务，不替代待确认候选的明确应用。相同请求重试沿用原幂等键；内容或范围改变时读取最新资料并使用新键创建任务。

支持阶段为 `background`、`world_rules`、`story`、`style`、`characters`、`relationships`、`outline`、`map`、`factions`、`items`、`events`、`chapter`。`project_brief` 是内部资产类型，不能作为 `stage`。

## 审校已有内容和生成正文

- 已有章节用 `novelforge.chapters.review`，必填 `novelId`、`chapterId`、`idempotencyKey`；调用模型生成报告，原正文保留，用 `workflows.get` 跟踪。
- 其他正式阶段可用 `workflows.start` 并指定 `operation:"review"`。大纲复核须限定 `changeScope.chapterIds`；图谱复核须明确已有实体与关系 ID 数组、`newEntityCount:0`、`allowNewRelations:false`，不带来源候选。以当前 schema 和工具描述为准。
- 仅评审报告不能用 `workflows.apply` 当作正文应用。修订另建生成任务，明确原章位、范围和来源候选。
- 正文前先用 `novelforge.chapters.readiness` 检查正整数 `atChapter`。缺合同或场景时先生成、复核并应用 `outline` 阶段，再独立启动 `chapter`；正文任务不暗中补大纲。
- `count` 是规划数量，已有对象和新增数量的硬限制用 `changeScope`。正文默认只写正文，不能默认新增或修改图谱。

## 自由创作参考卡

外部 AI 整理的短资料卡用 `novelforge.research.upsert` 保存。每条必填 `category`、`title`、`content`、`interpretation`、`novelConnection`，说明机制及代价、深层含义和本作转化。每批 1～100 条，单作品最多 200 张作者卡；稳定 `sourceKey` 便于更新。

先读最新项目版本，提交时建议始终带 `expectedContextVersion`。类别值为 `daoism`、`buddhism`、`politics`、`warfare`、`folk_life`、`strange_tales`、`humanity`、`narrative`、`other`。

<!-- mcp-tool: novelforge.research.upsert -->
```json
{
  "novelId": 12,
  "expectedContextVersion": 3,
  "entries": [{
    "sourceKey": "author:merchant:trust-001",
    "category": "humanity",
    "title": "赊账与互保的代价",
    "content": "原创机制：商队允许熟客赊账，但担保人承担违约损失。互助也可能成为熟人控制弱者的办法。",
    "interpretation": "信任能抵御风险，也会把人情变成难以退出的债。",
    "novelConnection": "待讨论方案：主角面对一份有利却会连累担保人的契约；核对本书既定制度后再决定采用。"
  }]
}
```

卡片只存为 `reference_only`，不自动成为 Canon、史实或人物知识。`research.list` 返回紧凑列表，完整内容用 `research.get` 按 `novelId`、`sourceKey` 回读。成功保存不代表模型已使用卡片；用 `context.preview` 检查入选与省略原因。2.4.42 最多选取三张短卡，极小预算仍可能省略。

真实网页检索另用 `novelforge.research.search`，需要配置搜索服务；失败不能编造出处。`research.query` 查询联网参考，与作者卡列表不同。`novelforge.research.delete` 需要单次显式批准；当前会话未提供删除工具时，不绕过批准路径。

明确的图谱更正先用 `novelforge.atlas.validate`，再用 `novelforge.atlas.apply`，携带版本、生效章位与来源。此路径直接保存明确变更，不调用模型审校，不是通用草稿导入。

`attributes` 的增量更新保留嵌套对象中未提交的字段；`attributeMode:replace` 仍只替换明确提交的顶层字段。对同一生效章位做局部更正时，省略 `stateTiming` 保留该记录原时序；新增记录或推进到新章时默认 `chapter_end`。同章实际新发生的变化应显式提交 `chapter_end`，避免覆盖为章初事实。

## 错误与回读

- `VALIDATION_FAILED`：字段或类型不符，重新查看 schema。
- `CONTEXT_VERSION_CONFLICT`：读取并比较最新资料，确认合并后再提交，不盲目重放。
- `CREATIVE_RESEARCH_DUPLICATE_KEY`、`CREATIVE_RESEARCH_KEY_CONFLICT`：检查批内编号和编号对应关系。
- `CREATIVE_RESEARCH_LIMIT_EXCEEDED`、`CREATIVE_RESEARCH_LEDGER_INVALID`：检查容量或账本完整性，保留原数据。
- `CHAPTER_PREREQUISITES_REQUIRED`：先补齐合同和场景，是正文生成前提检查。

成功写入后按稳定 ID 回读。2.4.42 相同作者卡重放不更新版本、资料时间或变更审计；过期 CAS 仍拒绝。纯参考变更不使旧章失效，未知或混合 Canon 变更保守处理。外部写入会通知桌面与 Web 补读；未保存草稿保留原编辑版本，冲突时重新核对。


## 选段提炼和局部修订

`research.extract_preview` 检查所选文本与项目模型的预算；`research.extract` 使用同样的输入生成资料卡候选并返回 `run.taskId`。输入为 `novelId`、`text`（不超过 20000 字符）、`sourceTitle`、可选 `sourceLabel`、`request` 与 `idempotencyKey`。通过 `assist.get` 查询任务，`assist.cancel` 停止，`assist.list` 按 `reference_extraction` 或 `selection_revision` 查询最近记录。任务失败后保留输入，不自动调用模型重跑。

成功后用 `artifacts.get` 读取 `run.artifactId`，核对每张卡的 `draft`、`quote`、`start/end`。有 `error` 的卡片不可采用。`research.adopt` 接受 `novelId`、`artifactId`、`expectedContextVersion`、`idempotencyKey` 和 `entries:[{candidateId,draft}]`；稳定来源编号由服务生成。卡片保持 `reference_only`，记录原文来源；重复采用不会新增或覆盖后续人工编辑。

`chapters.review_view` 读取指定 `novelId/chapterId` 的审校对照，可带 `reportId`。它不调用模型，也不放松现有审校门槛。无逐项结论的旧报告显示未评估；正文、合同或上下文版本变化后报告保持可读，定位与修订应基于新报告。

局部修订先保存正文，再用 `chapters.selection_preview` 提交 `novelId/chapterId/start/end/original`，取得正文哈希和上下文版本。`chapters.rewrite_selection` 追加 `sourceContentHash/contextVersion/request/idempotencyKey` 后生成候选。位置采用 JS UTF-16 索引，必须对应原文，单次选区最多 6000 字符；章节仍需具备可执行的合同与明确视角。

需要编辑候选时使用 `chapters.edit_selection`，传入 `novelId/artifactId/replacement/idempotencyKey`，得到新候选工件 ID。`chapters.apply_selection` 使用 `novelId/chapterId/artifactId/expectedContentHash/expectedContextVersion/idempotencyKey` 采用候选。服务在事务中核对原文与版本、替换选区并保存正文历史；已过期的候选保留但拒绝覆盖。采用局部候选不表示整章审校已经通过。

针对性回归：`npm run test:author-assist`。可选真实模型验证：设置 `NOVELFORGE_REAL_MODEL_SOURCE` 指向已配置模型的库，再执行 `electron scripts/author-assist-real-smoke.cjs`。该脚本仅从来源库读取默认模型配置，生成与采用发生在隔离作品中。

## 本机个人资料、作者账本与样稿

以下操作复用同一工具注册表、SQLite 和现有模型服务。资料副本始终为 `reference_only`，不自动写入本作事实。

| 操作 | 输入与行为 |
| --- | --- |
| `research.personal_list` | 可选 `query/category/includeArchived`；最多返回 200 条匹配卡 |
| `research.publish` | `novelId/sourceKey`；复制通用内容及出处引文，排除本作转化说明；同一源卡重复发布返回已有个人卡 |
| `research.personal_update` | `cardId/expectedRevision/content/archived`；保存新版或归档，不更新作品副本 |
| `research.reference` | `novelId/cardId/expectedRevision/expectedContextVersion/novelConnection`；显式创建或更新作品副本；已有转化说明保留 |
| `ledger.get` | `novelId`；读取既有伏笔、重复提示、人物属性及保护元数据 |
| `ledger.merge_preview` | `novelId/keepId/sourceIds`；选择保留项和 1–20 个其他项，返回字段差异、引用迁移、关联冲突、上下文版本和预览指纹 |
| `ledger.merge_clues` | 同一选择追加 `expectedContextVersion/previewFingerprint/reason/idempotencyKey`；事务确认合并，保留源项快照并迁移明确引用；同一编号原样重放只返回原结果 |
| `ledger.correct_clue` | `novelId/expectedContextVersion/id/title/detail/status/sourceChapterId/targetPayoffChapter/actualPayoffChapterId/requiredEvidence`；更正现有伏笔；已回收必须有实际章节和依据 |
| `ledger.correct_character` | `novelId/entityId/expectedContextVersion/effectiveFromChapter/name/origin/abilityLimits/protectedFields/note/idempotencyKey`；作者明确更正及调整保护 |
| `style.list/get` | `list` 带 `novelId`；`get` 带 `fingerprintId`，返回正文、分析和程序统计 |
| `style.analyze` | `novelId/name` 和 `text` 或 `chapterIds`；使用本作模型分析并保存候选，不自动认可；总样稿最多 48000 字符，章节最多 20 个 |
| `style.copy_sample` | `novelId/sourceId`；复制明确选择的样稿文本及分析，不带原作品章位关系，也不自动认可 |
| `style.approve` | `novelId/fingerprintId/expectedContextVersion`；明确认可本作样稿；`fingerprintId:null` 撤销；章节来源已变则拒绝重新认可旧文本 |
| `style.trial` | `novelId/fingerprintId/sceneBrief`；同场景两份试写，不修改正文，不注入旧版句长配额或禁词规则 |
| `style.approve_trial` | `novelId/text/expectedContextVersion`；明确保存并认可选中的试写原文，不再调用模型 |

人物保护白名单为 `name`、`attributes.origin`、`attributes.abilityLimits`。普通 `atlas.validate/apply` 以及流程应用遇到改动受保护字段时报告 `AUTHOR_PROTECTED_FIELD`；即使来源名称写成 `author_correction` 也不能绕过。解除或修改保护走明确更正入口。位置、伤势、归属继续按章节修订。

个人资料、伏笔更正、合并和样稿认可的业务冲突会返回 `AUTHOR_LIBRARY_INVALID` 及可读原因，资料格式错误返回 `CREATIVE_RESEARCH_INVALID`。不直接重放过期写入，先读取新版本并保留作者编辑。

线索合并由作者选择并确认，不按标题自动判断同一事实。保留项的正文、状态与回收记录继续生效，缺少的故事线/结局承诺/卷关联可从源项补齐；多项具有不同的非空关联时阻止合并。迁移章合同、场景合同、章合同显式资产引用、未完成修订和待处理影响中的编号；其他人物编号、自然语言、已完成任务和历史事件保留。原项转为历史，`ledger.get` 的 `mergedClues` 保留源内容及 `mergeInfoJson`，旧编号读取和后续合同写入解析到当前保留项。连续合并保留最初合并记录，不删除历史；过期预览或损坏引用拒绝写入。当前保留项与历史项不经普通删除入口删除，可调整其内容或状态；删除整部作品的原有行为保持一致。

测试入口：`npm run test:author-library`、`npm run test:migrations`。可选真实模型验证：设置 `NOVELFORGE_REAL_MODEL_SOURCE` 后执行 `electron scripts/author-style-real-smoke.cjs`；只读来源库模型配置，全部样稿和试写写入隔离库。

## 行内补全与灵感候选

以下工具沿用统一注册表、模型预算、调用记录和权限作用域，桌面、Web 与 MCP 行为一致。行内补全属于草稿操作，不写入正式正文或持久候选；需要保存时继续使用正文原有保存入口。

| 工具 | 输入与返回 |
| --- | --- |
| `writing.complete` | `novelId/chapterId/editorId/requestId/editVersion/cursor/before/after/mode`，可选 `modelConfigId`；返回相同编辑身份及 `text/cancelled/busy` |
| `writing.cancel_completion` | `novelId/chapterId/editorId/requestId`；停止匹配请求，包括先取消后到达的请求 |
| `inspiration.generate` | `draftId/requestId/kind/seed/constraints/direction/request`，可选 `modelConfigId`；返回 `run`，其中 `kind` 为 `directions` 或 `packaging` |
| `inspiration.get` | `draftId/taskId`；返回任务状态，成功后 `run.result.directions` 或 `run.result.packages` 为 1–3 项候选 |
| `inspiration.cancel` | `draftId/taskId`；取消当前构思任务，保留任务记录及作者输入 |
| `projects.creation_status` | `idempotencyKey`（8–100 字符）；返回 `project` 或 `null`，供创建响应丢失时恢复 |

补全光标及前后文范围使用 JS UTF-16 索引，前文最多 1500 字符、后文最多 300 字符。`mode` 为 `sentence`（60 个 Unicode 字符）或 `paragraph`（220 个 Unicode 字符）；服务达到长度或句段边界即中断上游输出，20 秒到期停止。每个编辑器只保留一个在途请求，共享既有模型并发名额，忙时直接返回 `busy`，不排队或自动重试。调用方须核对返回的请求编号、编辑版本、光标和当前草稿，只在作者采用时插入，不能直接覆盖已变正文。正文合同、视角和可见事实检查继续生效。

一句补全在流式句末等待分块返回的闭引号，收到后续正文或流结束后确认句末；长度上限、取消和超时规则保持生效。

灵感输入上限：`seed` 6000、`constraints` 3000、`direction` 2400、`request` 1500 字符。生成书名简介前需有方向；手写并跳过模型时可直接创建。任务不绑定占位小说，`draftId` 隔离不同构思；重复 `requestId` 只返回原任务，修改输入应使用新请求编号。起点、限制或方向变化后须重新选择对应候选。

最终 `projects.create` 增加可选 `synopsis`（最多 4000 字符）和 `inspiration:{draftId,seed,directionTaskId?,directionId?,packagingTaskId?,packagingId?}`。来源从成功任务回读并校验，原候选与作者最终编辑分别保留。保持固定 `idempotencyKey` 和完全相同输入重试，只返回同一作品；相同编号换输入会拒绝。确认前不创建作品，也不自动扩展人物、世界或章节。原有不带这些字段的调用兼容。

专项测试：`npm run test:writing-discovery`。真实供应商检查：设置 `NOVELFORGE_REAL_MODEL_SOURCE`，运行 `electron scripts/writing-discovery-real-smoke.cjs`；只读来源库默认模型配置，生成在隔离库中执行，结果保存到 `outputs/wenlan-third-batch/real-model-smoke.json`，不输出密钥。

默认 `npm test` 的 smoke 阶段包含 `test:author-assist`、`test:author-library` 和 `test:writing-discovery`，覆盖三批业务集成回归；这些默认测试使用本地模拟模型，不调用真实供应商。
