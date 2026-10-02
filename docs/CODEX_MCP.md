# 在本机用 Codex 创建 NovelForge 草稿

NovelForge 提供本地 stdio MCP。Codex 可以读取项目上下文，把指定阶段的分析和候选内容保存成可追溯草稿。导入不会调用 NovelForge 配置的模型，也不会修改正式设定或正文。

## 连接安装版

在 Windows 安装版或便携版中，也可以打开“应用设置 → Codex MCP 连接”：检查本机 Codex 配置，一键登记当前 NovelForge 可执行文件，或复制页面生成的 PowerShell 命令。若 Codex CLI 不在默认位置，可填入 `codex.exe` 的绝对路径。页面显示“已登记”只表示配置文件中的命令和参数匹配；完全退出 NovelForge、重启 Codex 后，还要实际调用 `novelforge.projects.list` 等工具确认 MCP 会话可用。

先在 NovelForge 建立项目，记住项目名称。完全退出桌面程序后，在 PowerShell 中运行；把路径替换成安装时选择的 `NovelForge.exe` 位置：

```powershell
codex mcp add novelforge -- "D:\Apps\NovelForge\NovelForge.exe" --mcp
codex mcp get novelforge
```

也可直接编辑 Codex MCP 配置，`command` 填安装版 EXE 的绝对路径，`args` 填 `['--mcp']`。本入口只使用本机 stdio，不开网络端口。开发仓库可用 `node D:\FlyLabs\noval-create\scripts\run-novelforge-mcp.cjs`，但开发脚本依赖当前仓库和 `node_modules`；安装版用上面的 EXE 入口。

桌面和 MCP 对同一个 SQLite 数据库互斥。**最小化不等于退出**：先在桌面程序选择“退出”，再启动 Codex 的 MCP 会话；导入结束后关闭使用 MCP 的 Codex 会话，再打开桌面程序审查。若看到“另一个 NovelForge 实例正在使用该数据库”，不要复制数据库或手工删除锁文件，先检查并退出占用实例。

## 一次只做指定阶段

可对 Codex 这样说：

> 我想写一部以边境商路为背景的小说。先读取 NovelForge 中的“商路”项目，只完成“立项”阶段：分析读者期待、主角目标的候选方向、可能的持续冲突和缺失信息。未确认的身份、时代、地名、制度和人物经历都列为待确认，不要写成既有设定。把候选立项以 JSON 草稿导入 NovelForge，给我工件 ID 和待确认问题；不要修改正式设定或写正文。

Codex 应按以下顺序调用：

1. `novelforge.projects.list` 找项目；`novelforge.projects.get` 读取 `novelId` 和 `contextVersion`。
2. 向用户说明本轮范围、依据、推断与待确认项，再生成候选内容。
3. 调用 `novelforge.assets.import_draft`。必填字段为 `novelId`、`expectedContextVersion`、`assetType`、`title`、`userRequest`、`analysis`、`stageScope`、`output` 和 `idempotencyKey`。`idempotencyKey` 在重试时保持不变；修改内容时用新键，必要时传 `parentArtifactId` 创建子版本。
4. 用 `novelforge.artifacts.get` 核对返回的 `draftArtifact.id`、正文及原始需求。若项目配置了模型，可调用 `novelforge.assets.review_draft` 发起单独审校；审校会产生报告和可能的修订工件，仍需作者确认。
5. 回到 NovelForge 的对应页面审查差异并手动应用。当前“项目立项”页面可读取 `project_brief` 类型的导入草稿；其他通用资产仍可通过 `artifacts.list/get` 查询，但暂没有统一的界面应用入口。

立项导入示例（`output` 是 JSON 字符串，不要把推断写成项目既有事实）：

```json
{
  "novelId": 12,
  "expectedContextVersion": 3,
  "assetType": "project_brief",
  "title": "商路小说立项候选一",
  "userRequest": "边境商路背景小说，先完成立项",
  "analysis": "目前只有边境商路这一背景。主角身份、目标、阻力来源和读者定位都需要作者确认，不应先写成既定事实。",
  "stageScope": "只完成项目立项，不写世界规则和正文",
  "unresolvedQuestions": ["主角身份与具体目标是什么？", "时代、交通方式和主要阻力是什么？", "面向哪类读者？"],
  "outputFormat": "json",
  "output": "{\"readerPromise\":\"围绕边境商路展开有明确选择与后果的故事；主角身份和阻力来源待作者确认。\"}",
  "idempotencyKey": "merchant-route-brief-v1"
}
```

`project_brief` 可回填字段为 `platformMode`、`targetAudience`、`targetReader`、`readerPromise`、`sellingPoints`、`compTitles`、`tabooRules` 和 `deliveryRhythm`。只写有依据的字段；未知信息放进 `unresolvedQuestions`。项目上下文变化后，旧 `expectedContextVersion` 会被拒绝，需要重新读取项目并生成新草稿。

导入结果存在本机 NovelForge 数据库的 `generic_draft` 工件中，状态为 `draft`，`reviewArtifactId` 和 `taskId` 为空。`content.externalSource` 保存原始需求、分析、阶段范围与待确认问题；`content.output` 保存完整候选内容。它不是一次 NovelForge 模型调用，因此不会伪造模型任务或模型输出日志。
