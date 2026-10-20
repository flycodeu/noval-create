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

## 错误与回读

- `VALIDATION_FAILED`：字段或类型不符，重新查看 schema。
- `CONTEXT_VERSION_CONFLICT`：读取并比较最新资料，确认合并后再提交，不盲目重放。
- `CREATIVE_RESEARCH_DUPLICATE_KEY`、`CREATIVE_RESEARCH_KEY_CONFLICT`：检查批内编号和编号对应关系。
- `CREATIVE_RESEARCH_LIMIT_EXCEEDED`、`CREATIVE_RESEARCH_LEDGER_INVALID`：检查容量或账本完整性，保留原数据。
- `CHAPTER_PREREQUISITES_REQUIRED`：先补齐合同和场景，是正文生成前提检查。

成功写入后按稳定 ID 回读。2.4.42 相同作者卡重放不更新版本、资料时间或变更审计；过期 CAS 仍拒绝。纯参考变更不使旧章失效，未知或混合 Canon 变更保守处理。外部写入会通知桌面与 Web 补读；未保存草稿保留原编辑版本，冲突时重新核对。
