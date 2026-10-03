import type { AgentToolDescriptor, AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CREATIVE_STAGES, CREATIVE_CHANGE_SCOPE_SCHEMA } from '../../src/shared/creative-workflow'
import type { CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasApplyInput, StoryAtlasQuery } from '../../src/shared/story-atlas'
import { AgentToolRegistry, AgentToolInvocationError } from './tool-registry'
import * as workflow from '../services/creative-workflow.service'
import { compileCreativeContext } from '../services/creative-context.service'
import * as atlas from '../services/story-atlas.service'
import { createNovel, getNovel, updateNovel } from '../services/novel.service'
import { getSqlite } from '../database/db'
import { hashArtifactContent } from '../services/artifact.service'
import { getModelConfigRecord } from '../services/model.service'
import { createEmptyWorldRules } from '../../src/shared/world-rules-draft'
import { parseStorySettingsDocument, buildStorySettingsPayload } from '../../src/shared/story-settings'
import { queryCreativeFacts } from '../services/creative-facts'
import { getChapter, listChapters } from '../services/chapter.service'
import { getChapterContract, listSceneContracts } from '../services/endgame-asset.service'
import { inspectCreativeChapterPrerequisites } from '../services/creative-chapter-context'

const number: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
const string: AgentToolJsonSchema = { type: 'string', minLength: 1 }
const requestFields: Record<string, AgentToolJsonSchema> = { novelId: number, stage: { enum: [...CREATIVE_STAGES] }, operation: { enum: ['generate', 'review'] }, request: { type: 'string', minLength: 1, maxLength: 12000 }, count: { type: 'integer', minimum: 1, maximum: 50 }, atChapter: { type: 'integer', minimum: 0 }, autoApply: { type: 'boolean' }, changeScope: CREATIVE_CHANGE_SCOPE_SCHEMA, revisionIssueIds: { type: 'array', maxItems: 50, items: number }, sourceArtifactId: string, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 } }
export function registerCreativeTools(registry: AgentToolRegistry): AgentToolRegistry {
  function add(id: string, title: string, description: string, properties: Record<string, AgentToolJsonSchema>, required: string[], effect: AgentToolDescriptor['effect'], handler: (input: Record<string, unknown>) => unknown | Promise<unknown>): void {
    registry.register({ descriptor: { id: `novelforge.${id}`, version: '2.0.0', domain: id.split('.')[0], title, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: true }, effect, approval: 'policy', scopes: effect === 'read' ? [AGENT_TOOL_SCOPES.novelRead] : [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.canonWrite], idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: ['creative-workspace'] }, handler: async input => {
      try { return await handler(input) } catch (error) {
        if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new AgentToolInvocationError(error.code, error.message)
        throw error
      }
    } })
  }
  add('projects.create', '新建小说', '根据作者提供的书名、故事种子和限制创建空项目；不套用题材规则或自动造人物章节。需求来源单独保留。随后使用workflows.start逐步生成。', {
    title: { type: 'string', minLength: 1, maxLength: 200 }, background: { type: 'string', maxLength: 12000 }, constraints: { type: 'string', maxLength: 12000 },
    genreId: number, modelConfigId: number, targetWords: { type: 'integer', minimum: 1, maximum: 10000000 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
  }, ['title', 'idempotencyKey'], 'canonical_write', input => {
    if (!String(input.title).trim()) throw new Error('书名不能为空。')
    if (input.modelConfigId) getModelConfigRecord(Number(input.modelConfigId))
    if (input.genreId && !getSqlite().prepare('SELECT id FROM genres WHERE id=?').get(input.genreId)) throw new Error('题材不存在。')
    const fingerprint = hashArtifactContent(input)
    return getSqlite().transaction(() => {
      const existing = getSqlite().prepare("SELECT id,settings_json FROM novels WHERE json_valid(settings_json) AND json_extract(settings_json,'$.mcpCreation.idempotencyKey')=?").get(input.idempotencyKey) as { id: number; settings_json: string } | undefined
      if (existing) {
        if (JSON.parse(existing.settings_json).mcpCreation.fingerprint !== fingerprint) throw new Error('幂等键已用于另一份开书需求。')
        return { project: getNovel(existing.id), source: JSON.parse(existing.settings_json).mcpCreation, idempotentReplay: true }
      }
      const source = { kind: 'user_request', title: input.title, background: input.background || '', constraints: input.constraints || '', idempotencyKey: input.idempotencyKey, fingerprint, createdAt: new Date().toISOString() }
      const settings = buildStorySettingsPayload({ premise: { constraints: String(input.constraints || '') } })
      const id = createNovel({ title: String(input.title).trim(), userBackground: String(input.background || ''), genreId: input.genreId as number | undefined,
        modelConfigId: input.modelConfigId as number | undefined, targetWords: input.targetWords as number | undefined, settingsJson: JSON.stringify({ ...settings, mcpCreation: source }) })
      updateNovel(id, { worldRulesJson: JSON.stringify(createEmptyWorldRules()) })
      return { project: getNovel(id), source, idempotentReplay: false }
    }).immediate()
  })
  add('workflows.start', '启动创作阶段', '用界面配置的模型生成、独立评审、有限修订并应用；立即返回持久runId。count是规划数量；硬限制使用changeScope的newEntityCount、existingEntityIds、existingRelationIds、allowNewRelations，空ID列表禁止修改已有对象。大纲用chapterIds限定已有章节并禁止修改卷单元。正文前先用chapters.readiness检查；如缺章节合同或场景，先以outline阶段生成并应用本章安排，再独立启动chapter阶段，正文任务不会暗中保存大纲。默认自动应用通过审校的结果；失败保留候选。operation=review只复核正式正文或图谱资料，不改写；图谱复核须给两个已有ID数组（可一个为空）、newEntityCount=0、allowNewRelations=false，不能带sourceArtifactId。修订问题须保持最新候选和原保存范围；未保存候选不能用正式复核关闭。随后调用workflows.get查询。', requestFields, ['novelId', 'stage', 'request', 'idempotencyKey'], 'canonical_write', async input => ({ run: await workflow.startCreativeWorkflow(input as unknown as CreativeWorkflowInput) }))
  add('chapters.readiness', '检查章节能否生成正文', '只读返回目标章缺失的章节合同与场景要求。ready=false时先运行outline阶段并应用本章安排，再启动chapter；不会生成或保存内容。', {
    novelId: number, atChapter: { type: 'integer', minimum: 1 },
  }, ['novelId', 'atChapter'], 'read', input => {
    const novelId = Number(input.novelId), atChapter = Number(input.atChapter)
    if (!getNovel(novelId)) throw new Error('项目不存在。')
    const result = inspectCreativeChapterPrerequisites(novelId, atChapter)
    return { novelId, atChapter, chapterId: result.chapterId, ready: result.blockers.length === 0, blockers: result.blockers, nextStage: result.blockers.length ? 'outline' : 'chapter' }
  })
  add('chapters.review', '仅评审已有章节', '根据当前章节、合同与可见资料进行模型评审，生成持久报告工件；不改正文。立即返回run，使用workflows.get查询，result.review包含报告。需要修订时另开chapter任务并明确原章位。', {
    novelId: number, chapterId: number, request: { type: 'string', minLength: 1, maxLength: 12000 }, revisionIssueIds: requestFields.revisionIssueIds, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
  }, ['novelId', 'chapterId', 'idempotencyKey'], 'draft_write', async input => {
    const chapter = getChapter(Number(input.chapterId))
    if (!chapter || chapter.novelId !== input.novelId) throw new Error('章节不属于当前项目。')
    if (!chapter.content?.trim()) throw new Error('目标章节没有可评审的正文。')
    return { run: await workflow.startCreativeWorkflow({ novelId: chapter.novelId, stage: 'chapter', operation: 'review', atChapter: chapter.chapterNum, count: 1,
      request: String(input.request || '评审本章事实、视角、因果、人物表现和阅读效果，给出有原文依据的最小修订建议。'), revisionIssueIds: input.revisionIssueIds as number[] | undefined, idempotencyKey: String(input.idempotencyKey), autoApply: false }) }
  })
  add('workflows.get', '读取创作进度', '返回步骤、模型ID、阶段事件、候选和评审引用、应用结果；省略runId返回最近任务。MCP断开不会停止任务。', { novelId: number, runId: number }, ['novelId'], 'read', input => ({ run: workflow.getCreativeRun(Number(input.novelId), input.runId as number | undefined) }))
  add('workflows.list', '创作历史', '最近30次创作任务。草稿与历史存数据库，不自动导出文件。', { novelId: number }, ['novelId'], 'read', input => ({ runs: workflow.listCreativeRuns(Number(input.novelId)) }))
  add('workflows.cancel', '取消创作', '取消模型请求和后续应用，保留已保存成果。', { novelId: number, runId: number }, ['novelId', 'runId'], 'draft_write', input => ({ run: workflow.cancelCreativeWorkflow(Number(input.novelId), Number(input.runId)) }))
  add('workflows.resume', '继续创作', '通过审校的候选直接应用；失败任务在资料未变化时有限重试。输入变化请新建任务。', { novelId: number, runId: number }, ['novelId', 'runId'], 'canonical_write', input => ({ run: workflow.resumeCreativeWorkflow(Number(input.novelId), Number(input.runId)) }))
  add('workflows.apply', '应用已审校版本', '应用本任务通过审校的候选，不再调用模型；重复调用返回已完成结果。', { novelId: number, runId: number }, ['novelId', 'runId'], 'canonical_write', input => {
    const run = workflow.getCreativeRun(Number(input.novelId), Number(input.runId))
    if (run?.operation === 'review') throw new Error('仅评审报告不能作为正文应用。请根据报告另开修订任务。')
    if (run?.reviewStatus !== 'passed') throw new Error('候选尚未通过审校。')
    return { run: workflow.resumeCreativeWorkflow(Number(input.novelId), Number(input.runId)) }
  })
  add('context.preview', '预览上下文', '读取本次取用的事实、来源、省略项和预算，与创作共用编译器。', requestFields, ['novelId', 'stage', 'request'], 'read', async input => ({ context: await compileCreativeContext(input as unknown as CreativeWorkflowInput) }))
  add('atlas.query', '故事地图与人物关系', '按章位查询区域层级、人物特征、路线、关系、阵营、物品和事件。locationParentId用于下钻，默认排除未来计划。稳定ID用于增量扩展。', { novelId: number, atChapter: { type: 'integer', minimum: 0 }, locationParentId: { type: ['string', 'null'] }, focusEntityId: string, includePlanned: { type: 'boolean' } }, ['novelId'], 'read', input => ({ atlas: atlas.queryStoryAtlas(input as unknown as StoryAtlasQuery) }))
  const changeSchema: AgentToolJsonSchema = { anyOf: [
    { type: 'object', properties: { op: { const: 'upsert_entity' }, id: string, clientId: string, kind: { enum: ['character', 'location', 'faction', 'item', 'event'] }, name: string, summary: { type: 'string' }, parentId: { type: ['string', 'null'] }, attributes: { type: 'object', additionalProperties: true }, attributeMode: { enum: ['merge', 'replace'] }, status: { enum: ['confirmed', 'planned'] } }, required: ['op', 'kind', 'name'], additionalProperties: false },
    { type: 'object', properties: { op: { const: 'upsert_relation' }, id: string, clientId: string, kind: { enum: ['relationship', 'route', 'presence', 'ownership', 'membership', 'participation'] }, fromId: string, toId: string, label: { type: 'string' }, attributes: { type: 'object', additionalProperties: true }, attributeMode: { enum: ['merge', 'replace'] }, status: { enum: ['confirmed', 'planned'] } }, required: ['op', 'kind', 'fromId', 'toId'], additionalProperties: false },
    { type: 'object', properties: { op: { const: 'retire' }, id: string }, required: ['op', 'id'], additionalProperties: false },
  ] }
  const fields: Record<string, AgentToolJsonSchema> = { novelId: number, expectedContextVersion: number, idempotencyKey: string, effectiveFromChapter: { type: 'integer', minimum: 0 }, source: { type: 'object', properties: { kind: string, id: string, note: string }, required: ['kind'], additionalProperties: false }, changes: { type: 'array', minItems: 1, maxItems: 100, items: changeSchema } }
  const required = ['novelId', 'expectedContextVersion', 'idempotencyKey', 'effectiveFromChapter', 'source', 'changes']
  add('atlas.validate', '检查图谱变更', '只校验，不写入。检查引用、循环、层级和路线。批次使用clientId互相引用。changes用upsert_entity、upsert_relation或retire。', fields, required, 'read', input => ({ validation: atlas.validateStoryAtlasChanges(input as unknown as StoryAtlasApplyInput) }))
  add('atlas.apply', '应用明确资料变更', '保存明确设计或已讨论更正，记录来源与生效章位。不调用模型审校；模型生成请用workflows.start。已有实体带id，新实体用clientId。人物关系/路线/归属用upsert_relation。attributes默认增量merge；明确更正可用attributeMode:replace，只替换提交的顶层字段，空值删除该字段，未提交字段保留。重复幂等键不重复创建。', fields, required, 'canonical_write', input => ({ result: atlas.applyStoryAtlasChanges(input as unknown as StoryAtlasApplyInput) }))
  add('assets.query', '查询背景与章节', '读取背景、规则、文风和分页章节目录；chapterId可取正文及合同。人物地图用atlas.query。', { novelId: number, chapterId: number, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['novelId'], 'read', input => {
    const novel = getNovel(Number(input.novelId))
    if (!novel) throw new Error('项目不存在。')
    if (input.chapterId) {
      const chapter = getChapter(Number(input.chapterId))
      if (!chapter || chapter.novelId !== novel.id) throw new Error('章节不属于当前项目。')
      return { chapter, chapterContract: getChapterContract(chapter.id), scenes: listSceneContracts(chapter.id) }
    }
    const rows = listChapters(novel.id), offset = Number(input.offset || 0), limit = Number(input.limit || 20)
    return { novelId: novel.id, contextVersion: novel.contextVersion, modelConfigId: novel.modelConfigId, background: novel.userBackground, expandedBackground: novel.expandedBackground, worldRules: novel.worldRulesJson, voice: novel.themeVoiceJson,
      storySettings: parseStorySettingsDocument(novel.settingsJson), projectBrief: novel.projectBriefJson,
      source: JSON.parse(novel.settingsJson || '{}').mcpCreation || null,
      volumes: getSqlite().prepare('SELECT id,volume_number AS volumeNumber,title,summary,target_words AS targetWords FROM story_volumes WHERE novel_id=? ORDER BY volume_number,id').all(novel.id),
      parts: getSqlite().prepare('SELECT id,volume_id AS volumeId,part_number AS partNumber,title,summary,target_words AS targetWords FROM story_parts WHERE novel_id=? ORDER BY volume_id,part_number,id').all(novel.id),
      facts: queryCreativeFacts(novel.id),
      chapterCount: rows.length, chapters: rows.slice(offset, offset + limit).map(row => ({ id: row.id, chapterNum: row.chapterNum, volumeId: row.volumeId, partId: row.partId, title: row.title, outline: row.outline, summary: row.summary, status: row.status, wordCount: row.wordCount })), nextOffset: offset + limit < rows.length ? offset + limit : null }
  })
  return registry
}
