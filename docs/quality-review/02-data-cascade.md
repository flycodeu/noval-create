# 02 跨模块数据级联

主题范围：10 张表之间的引用一致性、删除/修改时的级联处理、世界状态版本追踪。

## P0-2 跨模块数据级联无校验

**问题**：`electron/database/schema.ts` 定义的 10 张表之间大量存在软引用（`chapters` ↔ `characters`、`storyThreads` ↔ `chapters`、`worldMap` ↔ `mapNodes`、`items` ↔ `chapters` 等）。数据库层没有声明外键约束，应用层 service 在删除或修改主表记录时也没有显式清理/更新子表。

**证据**：
- `electron/services/character.service.ts` 的 `deleteCharacter`：只删 `characters` 行，不触及 `character_relations`、`character_states`、`chapters.charactersJson` 里的引用。
- `electron/services/item.service.ts` 的 `deleteItem`：类似情况，不清理 `items_event_log`、`chapters` 的物品事件引用。
- `electron/services/chapter.service.ts` 的 `deleteChapter`：不反向清理 `story_threads.chaptersJson`、`timeline_events`、`character_states` 的章节锚点。

**影响**：
- 删除后残留的幽灵引用会导致上下文服务召回错误实体。
- 导出/导入功能会把空引用序列化出去，再次导入时 hash 不一致。
- 上下文召回时意外击穿到 "null" 或 404 数据，AI 接收到的约束条件与现实不符，产出质量下降但难以追查。

**修复方案**：
1. 第一步（阶段 2 独立 hotfix）：为三个最高频的删除操作（character / item / chapter）在 service 里实现显式级联：删除主表行 → 查找所有子表引用 → 使用事务一起删除/更新 → 写入一条 `data_cascade_log` 审计记录。
2. 第二步（阶段 3）：用 Drizzle 的外键声明补齐 schema，借助 migration 把残留孤立数据扫干净一次。
3. 第三步（长期）：为每张表加一个 `referencesTo` 元数据清单，让级联删除可以自动推导而非硬编码。

**fixed-by**：独立 hotfix，阶段 2 内先修最高频三条；schema 加外键放阶段 3。

---

## P1-5 世界状态版本追踪不完整

**问题**：`worldStateVersions` 表的设计意图是在每次"重要变更"后记录一版世界快照，但当前只有 `world-state.service.ts` 的若干显式调用点会写入。角色关系变更、物品易主、地图节点新增等操作不会自动 track，造成章节回溯时只能看到顶层世界描述的变化，看不到实体级的真实差异。

**证据**：
- `electron/services/character.service.ts` / `item.service.ts` / `map.service.ts` 均未调用 `worldStateService.trackVersion`。
- `world-state.service.ts` 的 `trackVersion` 需要手动传入 `reason` 和 `snapshot`，没有提供"自动从当前实体汇总一次"的入口。

**影响**：章节撤销/回滚流程不可靠；审计无法区分"AI 主动写入的状态变化"和"用户手改的状态变化"。

**修复方案**：
1. 在 `world-state.service.ts` 增加 `autoTrackAfterMutation(novelId, source)`，内部聚合所有实体当前快照；source 字段记录调用点（character/item/map/chapter）。
2. 在上述三个 service 的 create / update / delete 出口统一调用 `autoTrackAfterMutation`。
3. 为了避免每次小改都写一个版本，加一个节流：同一 source 在 5 秒窗口内合并写一版。

**fixed-by**：阶段 3 内补齐，在任务二 2.1 的上下文维度补强完成后进行，复用其 version 元数据。

---

## 复核结论

- 本文档的 P0-2 和 P1-5 仍有效；未发现已被修复的迹象。
- `data_cascade_log` 表尚未存在，需要在 hotfix 时通过 migration 新建。
