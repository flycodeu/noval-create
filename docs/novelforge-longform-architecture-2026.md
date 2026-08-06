# NovelForge 长篇与超长篇生成架构设计

## 1. 目标与边界

本设计面向几十万字、百万字和数百万字的连续小说创作。目标不是让模型一次读取整本小说，而是让系统在有限上下文中持续维护可验证的正典、阶段交接和人物/地图状态。

### 目标

- 章节生成只读取当前工作集和经过授权的历史证据。
- 事实、事件、人物状态、世界状态和角色知识边界可追溯、可重建。
- 任意 Pipeline 节点失败后，可以从该节点重试，不重复生成已经确认的上游产物。
- 章后回写先形成候选 Diff，审批后才提交正典。
- 正典提交、索引刷新、质量分析和 UI 进度彼此解耦，但状态可观察。
- 单作者桌面项目优先保持 Electron + SQLite；多人并发再迁移服务端存储。

### 非目标

- 不承诺模型可以直接生成几百万字不间断正文。
- 不把向量检索当作事实来源。
- 不让模型直接修改人物、地图或世界规则正典。
- 不为了并行而并行生成同一条正典时间线。

## 2. 核心不变量

1. **正典唯一性**：同一实体、事件和状态只能有一个当前正典投影。
2. **来源可追溯**：每个正典变化都能回到章节、场景、artifact 和证据区间。
3. **版本保护**：提交必须携带 `contextVersion`、输入哈希和合同版本；过期提交失败关闭。
4. **知识边界**：角色只能看到在其知识范围内已经揭示的事实。
5. **时间与空间可行**：事件顺序、人物移动和旅行时间必须满足确定性约束。
6. **幂等提交**：同一个节点输出重复提交不能重复消耗物品、重复推进线程或重复建立事件。
7. **候选与正典分离**：模型抽取、向量索引和质量建议都只能产生候选或投影。
8. **单小说正典串行**：同一小说的 canonical commit 使用一个有序提交器；分析任务可以并行。

## 3. 分层创作模型

```text
全书底盘与终局承诺
  -> 卷/部目标
  -> 故事弧与线程
  -> 章节窗口与阶段资产
  -> 章节合同与场景合同
  -> 固定 Context Snapshot
  -> Planner / Writer / Extractor / Validator / Review
  -> Canonical Commit
  -> Handoff / Projection / Index / Trend
```

### 3.1 全书底盘

只锁定低频变化的内容：读者承诺、题材、主角起点、世界硬规则、终局承诺、主要资源和不可违反的禁区。不要一次生成所有远期人物和地图细节。

### 3.2 阶段与窗口

阶段使用 `creative_stages`，资产使用 `creative_stage_assets`。阶段只保存范围、目标、可写资产、细化等级和交接条件，不复制人物或地图正典。

建议窗口：

- 初期：1–50 章或 1–100 章；
- 长篇：每卷或每部建立独立 handoff；
- 超长篇：完成窗口后冻结 handoff，旧窗口进入只读归档。

资产细化等级：`placeholder -> outline -> working -> canonical`。远期角色、地点和势力停留在 placeholder，不允许模型提前编造完整履历。

### 3.3 上下文层级

```text
L0 当前场景状态：地点、时间、在场人物、目标、知识、资源
L1 章节桥接：上一章结尾、当前压力、必须承接的动作
L2 故事弧/窗口：目标、开放线程、人物弧节拍、地图路线
L3 全书硬正典：世界规则、终局承诺、不可变事实
L4 定向证据：事件、伏笔、历史场景、相似状态、语言风格
```

召回优先级为硬约束、当前场景和 handoff、阶段目标、相关历史证据、风格材料。Planner、Writer、Critic、Rewriter 和 Canonizer 必须复用同一个 `RecallSnapshot`，不能各自重新召回造成上下文漂移。

## 4. 正典事件与状态账本

现有的 `timelineEvents`、`characterStateVersions`、`worldStateVersions`、`chapterFactExtracts` 和 `chapterWritebackDiffs` 保留，但需要明确职责：

- `timelineEvents`：叙事事件和因果链；
- `characterStateVersions`：人物状态投影；
- `worldStateVersions`：世界/地点/势力状态投影；
- `chapterWritebackDiffs`：待审批的候选变化；
- `storyMemoryCheckpoints`：可重建的性能缓存；
- `chapterEmbeddings`：可失效的召回索引。

长期目标是增加统一的事件/状态提交层，而不是让每个服务独立写 JSON。每个变化至少带：

```text
novelId, chapterId, segmentId, sourceArtifactId,
entityType, entityId, stateKey,
beforeValue, afterValue, deltaType,
evidenceStart, evidenceEnd, confidence,
contextVersion, approvalId, idempotencyKey
```

提交顺序：候选抽取 → 确定性校验 → 人工/策略审批 → 单事务写入事件和投影 → `contextVersion + 1` → 写入 outbox。

## 5. 章节事务流水线

1. 读取阶段、合同、handoff 和当前正典，生成输入快照和哈希。
2. Planner 只输出结构化场景计划、前置条件、必须变化、禁止变化和出口压力。
3. Writer 生成场景 artifact，不写正典。
4. Extractor 从正文提取事件、事实、状态变化和证据区间。
5. Validator 检查时间、地点、人物状态、物品消耗、知识边界、线程和合同。
6. Critic/Rewriter 只针对失败节点或失败场景生成新 artifact。
7. Review 页面展示正文和 Canon Diff，用户确认或拒绝。
8. Canonical Commit 在一个事务内写正文版本、事件、状态投影、handoff 草稿和版本号。
9. Outbox 异步刷新摘要、向量、趋势和推荐。

## 6. 持久化任务状态机

每个节点必须产生不可变 artifact，并记录 `inputHash`、`upstreamArtifactId`、`contextVersion` 和 `attempt`。建议状态：

```text
pending -> leased -> running -> produced -> validated -> approved -> committed
```

失败分类：

- `retryable`：网络、限流、超时；
- `validation_failed`：结构化输出或硬约束失败；
- `stale_context`：输入版本过期；
- `human_review`：需要用户决策；
- `permanent_failed`：不可恢复错误。

租约必须包含过期时间和 fencing token。旧 Worker 即使晚到，也不能覆盖新 attempt 的结果。

## 7. 混合检索设计

向量条目按场景、事件、状态卡、handoff、伏笔和事实切片，而不是只存章节摘要。索引元数据必须包括：

```text
sourceHash, embeddingProfile, modelId, dimensions,
stageId, chapterRange, entityIds, visibility,
validFrom, validTo, contextVersion
```

检索采用：结构化过滤 → FTS5 专名/数字召回 → 向量召回 → 因果/时间/实体重排。不同 embedding profile 不能混用；索引失败时使用结构化和关键词召回，并明确显示索引过期状态。

## 8. 人物与地图

### 人物

- 稳定 ID、别名、称谓、身份变更和合并候选；
- 每章/每场景保存位置、目标、知识、伤势、资源、立场、心理和关系温度；
- 区分计划弧、正文观察弧和已确认弧；
- 记录角色知道某事实的来源和揭示章节；
- 当前窗口只加载 active cast，远期角色保留 latent 占位。

### 地图

- 保留层级树和关系图；
- 增加区域/坐标、路线、距离、耗时、交通方式和开放区间；
- 记录人物当前位置和地点控制权的时间版本；
- Planner 输出移动计划，确定性校验器检查是否瞬移、时间不足或路线封锁；
- UI 默认只显示当前阶段和一跳关系，所有节点可跳回章节证据。

## 9. 性能与部署

### 单作者桌面

SQLite WAL 继续作为正典和元数据存储。章节正文、历史版本和大型 artifact 应逐步采用内容寻址文件或压缩归档，SQLite 保存哈希和元数据。禁止每章全量读取全书。

### Worker

事实抽取、实体解析、趋势统计和嵌入放到 Worker。Worker 只读取固定快照并返回候选结果；主进程或专用写入器负责唯一的正典事务提交，避免多个 Worker 直接竞争 SQLite 写入。

### 多人/多机

当需要多项目、多用户和跨机器 Worker 时，再迁移到 PostgreSQL、对象存储、向量索引和持久化队列。不要先拆微服务再定义正典契约。

## 10. 分阶段实施

### P0：正确性和可观察性

- 分离 pipeline、quality、canonical、index 四种状态；
- 建立 20/50/100 章连续性样本；
- 记录每个节点输入哈希、上下文版本、耗时、模型和失败分类。

### P1：正典提交层

- 统一候选 Diff、事件、状态投影和审批；
- 为章节、状态和写回增加幂等键；
- 让 checkpoint 可从事件重建。

### P2：增量上下文和混合检索

- 当前窗口查询替代全量加载；
- FTS5 与向量索引加入 profile、来源哈希和可见性过滤；
- 增加 outbox 和失效重建。

### P3：持久化节点队列

- 节点 artifact、租约、fencing、重试策略和崩溃恢复；
- 支持“重试该节点”，不重新执行上游。

### P4：人物地图和交接

- 别名/实体消歧、角色知识边界、地图旅行验证；
- 阶段 handoff 审批和窗口归档。

### P5：规模迁移

- 用 500 章、数万事件和大规模索引做基准；
- 只有达到 SQLite 的单写入或存储边界后才迁移服务端。

## 11. 验收门槛

- 100 章连续生成无硬性时间、地点、伤势、物品和知识边界矛盾；
- 每个窗口都有已确认 handoff；
- 节点失败可精确重试，重复提交不重复改变正典；
- 过期 `contextVersion` 的写入必定失败关闭；
- 上下文组装时间和内存不随全书正文线性增长；
- 向量模型、维度和来源空间不混用；
- `pipelineStatus=complete` 不得直接代表交付成功，必须同时满足质量门禁和正典提交状态。
