# NovelForge

供 Codex 等 AI 客户端调用的本地小说创作工作台。NovelForge 保存小说资料、调用你选定的模型生成与审校、记录版本，并提供简洁的阅读和编辑界面。

技术栈：Electron、React、TypeScript、SQLite。

## 安装与更新

从 [GitHub Releases](https://github.com/flycodeu/noval-create/releases/latest) 下载：

- `NovelForge-Setup-版本-x64.exe`：Windows 安装版，支持应用内更新。
- `NovelForge-Portable-版本-x64.exe`：便携版，更新时下载新的便携包。

更新前保存正文并退出旧版；如果 Codex 正连接旧版 MCP，也应先关闭该连接。安装后在“设置”核对实际运行版本，再连接 MCP。仅解压源码或打开旧快捷方式，不会替换旧的安装文件。

## 五个工作入口

| 入口 | 用途 |
| --- | --- |
| 创作台 | 描述本轮需求、选择项目模型、查看生成与评审进度 |
| 故事设计 | 阅读和编辑背景、规则、文风与章节安排 |
| 世界与人物 | 地图层级、人物关系、阵营、物品和事件；按章节查看状态 |
| 正文 | 章节阅读与编辑、章节评审、版本恢复、定向生成与修订 |
| 版本与问题 | 查看任务历史、候选、审校结果和失败恢复 |

常规使用：创建作品 → 配置模型 → 确立背景与限制 → 故事与人物设计 → 地图及关系 → 卷章大纲 → 逐章写作与评审 → 持续扩展。可以按已有资料跳过已完成阶段。

新建作品只保存你填写的故事起点与要求。未确定的人物、关系和世界规则保持待补充，后续通过模型生成候选再确定。故事设计中的字段缺失会直接显示，不用题材模板填充成既定事实。

人物和地图可以分批生成。例如先创建 10 个人物，再结合后续剧情增加 3 人；使用同一项目的稳定 ID 更新已有资料。地点可以从地域逐层展开到城镇、村庄和具体场景，关系与位置可随剧情章位变化。

## 通过 MCP 创作

1. 在“模型与搜索”保存模型，在作品的“创作台”选择本项目使用的模型。
2. 在“设置 → Codex 连接”完成配置，也可展开并复制命令。
3. 重新连接 Codex，使其加载新的工具目录。
4. 让 Codex 查询项目，然后按你的要求调用创作流程。

桌面、Web 与 MCP 共用一个本地运行时。桌面打开时也能调用 MCP；已接受的任务不会因 MCP 客户端断线而停止。后台运行可从托盘查看和退出。

核心工具：

| 工具 | 用途 |
| --- | --- |
| `novelforge.projects.list/get` | 选择项目、读取概况 |
| `novelforge.projects.create` | 根据故事起点和限制建档，支持幂等重试 |
| `novelforge.workflows.start` | 生成 → 审校 → 有限修订 → 应用；立即返回运行 ID |
| `novelforge.workflows.get/list` | 查询运行步骤和成果 |
| `novelforge.workflows.cancel/resume/apply` | 取消、恢复、应用已审校候选 |
| `novelforge.atlas.query` | 查询指定章位的人物、地点和关系 |
| `novelforge.atlas.validate/apply` | 校验和保存明确的资料更正 |
| `novelforge.assets.query` | 查询背景、章节、正文与章节安排 |
| `novelforge.chapters.review` | 按指定章节及其上下文生成独立评审报告，保留正文 |
| `novelforge.context.preview` | 检查上下文来源、省略项和预算 |

`workflows.start` 示例：

```json
{
  "novelId": 1,
  "stage": "characters",
  "request": "为首个单元补充10个人物，说明行动目标、性格和关系，保留已有角色。",
  "count": 10,
  "atChapter": 0,
  "autoApply": false,
  "idempotencyKey": "first-unit-characters-001"
}
```

支持阶段：`background`（背景）、`world_rules`（规则与限制）、`story`（故事设计）、`style`（文风）、`outline`（卷章大纲）、`characters`（人物）、`map`（地图）、`relationships`（关系）、`factions`（阵营）、`items`（物品）、`events`（事件）、`chapter`（正文）。

MCP 的 `autoApply:false` 保留候选供讨论；需要自动推进时显式指定 `autoApply:true`。界面的重要人物设计与正文默认保留候选。旧候选遇到资料版本变化会拒绝覆盖。修订时传递原任务的 `atChapter`、`count` 和候选 `sourceArtifactId`，避免错误地转去生成下一章。

模型评审与程序结构校验都通过，候选才允许应用。评审缺少结论、明确拒绝、引用不存在或结构无效都会保留问题；失败任务可查看具体原因，修正需求后重新生成。

秘密、线索和揭示安排作为故事设计的信息点记录。大纲安排哪些事实可以在本章出现；正文采用后，再根据原句证据更新人物实际获知的章位。计划揭示与已经知晓分别保存，避免人物提前知道真相或在后续章节忘记已经获得的线索。

## 数据和上下文

- 正式资料、图谱修订、草稿和审校记录保存在 SQLite，不为每次生成自动导出一批文件。
- 模型由界面配置；进行中的任务固定模型配置，下一轮使用新选择。
- 上下文按任务编译并控制预算；正文检查视角、事实可见性和章节安排。
- `context.preview` 返回实际取用及省略的来源、输入预算和输出预留；作者样文也计入预算，并按本章可见信息筛选。不要把模型的最大输出参数误认为实际每次输出长度。
- 地图提供地点层级、相对位置和通路示意，采用结构化地形、水源、生计与旅行条件，不提供测绘精度。
- 模型审校和程序校验分别记录。实际文学质量、长篇连续性仍需要真实试写与作者评判。
- 地图、人物档案、规则等资料按结构和事实审校，允许条目表达和未确定项；正文另外检查叙事效果。请求失败会说明生成、审校或修订中的具体失败环节。
- 本机运行数据、密钥、私有小说资料、临时测试输出不提交到仓库。

## 开发

```powershell
npm ci
npm run dev
```

Web 开发：`npm run dev:web`。默认前端 `http://127.0.0.1:4175`，Web 代理 `http://127.0.0.1:8787`，代理调用同一个 Electron 后台。

```powershell
npm run typecheck
npm run lint
npm test
npm run build:installer
node scripts/packaged-mcp-smoke.cjs
node scripts/verify-release-assets.cjs
```

打包脚本执行完整测试后生成安装版与便携版。发布工作流校验版本、包内 MCP、更新元数据和资产哈希，再发布 GitHub Release。

核心代码：

- `electron/main.ts`、`electron/utils/mcp-runtime.ts`：唯一运行时。
- `electron/application/creative-tools.ts`：MCP 创作接口。
- `electron/services/creative-workflow.service.ts`：持久创作流程。
- `electron/services/creative-context.service.ts`、`creative-chapter-context.ts`：上下文和正文约束。
- `electron/services/story-atlas.service.ts`：地图、人物及关系的章位修订。
- `src/pages/Novel/AuthorWorkspace/`：五入口界面。
