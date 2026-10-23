import type { AgentToolDescriptor, AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CREATIVE_STAGES, CREATIVE_CHANGE_SCOPE_SCHEMA, CREATIVE_CHAPTER_REVISION_SCHEMA } from '../../src/shared/creative-workflow'
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
import * as research from '../services/creative-research.service'
import type { CreativeResearchDraft } from '../../src/shared/creative-research'
import { resolveInspirationSource } from '../services/inspiration.service'
import type { InspirationSource } from '../../src/shared/inspiration'
import { inspectCreativeChapterPrerequisites } from '../services/creative-chapter-context'
import { chapterRevisionParagraphs } from '../../src/shared/chapter-revision'
import { registerChapterIndexTools } from './chapter-index-tools'
import { registerAtlasJourneyTools } from './atlas-journey-tools'

const number: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
const string: AgentToolJsonSchema = { type: 'string', minLength: 1 }
const requestFields: Record<string, AgentToolJsonSchema> = { novelId: number, stage: { enum: [...CREATIVE_STAGES] }, operation: { enum: ['generate', 'review'] }, request: { type: 'string', minLength: 1, maxLength: 12000 }, count: { type: 'integer', minimum: 1, maximum: 50 }, atChapter: { type: 'integer', minimum: 0 }, autoApply: { type: 'boolean' }, changeScope: CREATIVE_CHANGE_SCOPE_SCHEMA, chapterRevision: CREATIVE_CHAPTER_REVISION_SCHEMA, revisionIssueIds: { type: 'array', maxItems: 50, items: number }, sourceArtifactId: string, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 } }
export function registerCreativeTools(registry: AgentToolRegistry): AgentToolRegistry {
  function add(id: string, title: string, description: string, properties: Record<string, AgentToolJsonSchema>, required: string[], effect: AgentToolDescriptor['effect'], handler: (input: Record<string, unknown>) => unknown | Promise<unknown>, options: { scopes?: string[]; approval?: AgentToolDescriptor['approval'] } = {}): void {
    registry.register({ descriptor: { id: `novelforge.${id}`, version: '2.0.0', domain: id.split('.')[0], title, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: true }, effect, approval: options.approval || 'policy', scopes: options.scopes || (effect === 'read' ? [AGENT_TOOL_SCOPES.novelRead] : [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.canonWrite]), idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: ['creative-workspace'] }, handler: async input => {
      try { return await handler(input) } catch (error) {
        if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new AgentToolInvocationError(error.code, error.message)
        throw error
      }
    } })
  }
  add('projects.create', '新建小说', '根据作者提供的书名、故事种子和限制创建空项目；不套用题材规则或自动造人物章节。需求来源单独保留。随后使用workflows.start逐步生成。', {
    title: { type: 'string', minLength: 1, maxLength: 200 }, background: { type: 'string', maxLength: 12000 }, constraints: { type: 'string', maxLength: 12000 },
    synopsis: { type: 'string', maxLength: 4000 },
    inspiration: { type: 'object', properties: { draftId: { type: 'string', minLength: 8, maxLength: 100 }, seed: { type: 'string', maxLength: 6000 }, directionTaskId: number, directionId: string, packagingTaskId: number, packagingId: string }, required: ['draftId', 'seed'], additionalProperties: false },
    genreId: number, modelConfigId: number, targetWords: { type: 'integer', minimum: 1, maximum: 10000000 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
  }, ['title', 'idempotencyKey'], 'canonical_write', input => {
    if (!String(input.title).trim()) throw new Error('书名不能为空。')
    const fingerprint = hashArtifactContent(input)
    return getSqlite().transaction(() => {
      const existing = getSqlite().prepare("SELECT id,settings_json FROM novels WHERE json_valid(settings_json) AND json_extract(settings_json,'$.mcpCreation.idempotencyKey')=?").get(input.idempotencyKey) as { id: number; settings_json: string } | undefined
      if (existing) {
        if (JSON.parse(existing.settings_json).mcpCreation.fingerprint !== fingerprint) throw new Error('幂等键已用于另一份开书需求。')
        return { project: getNovel(existing.id), source: JSON.parse(existing.settings_json).mcpCreation, idempotentReplay: true }
      }
      if (input.modelConfigId) getModelConfigRecord(Number(input.modelConfigId))
      if (input.genreId && !getSqlite().prepare('SELECT id FROM genres WHERE id=?').get(input.genreId)) throw new Error('题材不存在。')
      const source = { kind: 'user_request', title: input.title, background: input.background || '', constraints: input.constraints || '', idempotencyKey: input.idempotencyKey, fingerprint, createdAt: new Date().toISOString(),
        ...(input.inspiration ? { inspiration: resolveInspirationSource(input.inspiration as unknown as InspirationSource, String(input.constraints || ''), String(input.background || '')) } : {}) }
      const settings = buildStorySettingsPayload({ premise: { constraints: String(input.constraints || '') } })
      const id = createNovel({ title: String(input.title).trim(), ...(input.synopsis !== undefined ? { synopsis: String(input.synopsis) } : {}), userBackground: String(input.background || ''), genreId: input.genreId as number | undefined,
        modelConfigId: input.modelConfigId as number | undefined, targetWords: input.targetWords as number | undefined, settingsJson: JSON.stringify({ ...settings, mcpCreation: source }) })
      updateNovel(id, { worldRulesJson: JSON.stringify(createEmptyWorldRules()) })
      return { project: getNovel(id), source, idempotentReplay: false }
    }).immediate()
  })
  const researchCategory = { enum: ['daoism', 'buddhism', 'politics', 'warfare', 'folk_life', 'strange_tales', 'humanity', 'narrative', 'other'] }
  const researchEntry = {
    type: 'object',
    properties: {
      sourceKey: { type: 'string', minLength: 1, maxLength: 160, pattern: '^author:[A-Za-z0-9._:-]+$' },
      category: researchCategory,
      title: { type: 'string', minLength: 1, maxLength: 120 },
      sourceTitle: { type: 'string', maxLength: 160 },
      sourceUrl: { type: 'string', maxLength: 500 },
      tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 30 } },
      content: { type: 'string', minLength: 1, maxLength: 4000 },
      interpretation: { type: 'string', maxLength: 1200 },
      novelConnection: { type: 'string', maxLength: 1200 },
    },
    required: ['category', 'title', 'content', 'interpretation', 'novelConnection'],
    additionalProperties: false,
  } satisfies AgentToolJsonSchema
  add('research.list', '列出作者创作资料', '紧凑列出项目中的作者自建创作参考卡，可按关键词、分类筛选；需要完整正文时再调用 research.get。卡片保持 reference_only，不当作已确认设定。', {
    novelId: number, query: { type: 'string', maxLength: 200 }, category: researchCategory, limit: { type: 'integer', minimum: 1, maximum: 200 },
  }, ['novelId'], 'read', input => {
    const entries = research.listCreativeResearch(Number(input.novelId), {
      query: typeof input.query === 'string' ? input.query : undefined,
      category: typeof input.category === 'string' ? input.category : undefined,
      limit: typeof input.limit === 'number' ? input.limit : 40,
    })
    return { count: entries.length, entries: entries.map(entry => ({
      sourceKey: entry.sourceKey, title: entry.title, category: entry.category, sourceTitle: entry.sourceTitle,
      tags: entry.tags, preview: entry.content.slice(0, 180), updatedAt: entry.updatedAt,
    })) }
  })
  add('research.get', '读取完整创作资料', '根据 sourceKey 读取一条作者自建资料卡的核心内容、深层含义和本作转化方向。', {
    novelId: number, sourceKey: { type: 'string', minLength: 1, maxLength: 160, pattern: '^author:[A-Za-z0-9._:-]+$' },
  }, ['novelId', 'sourceKey'], 'read', input => ({ entry: research.getCreativeResearch(Number(input.novelId), String(input.sourceKey)) }))
  add('research.upsert', '创作或批量导入资料卡', '按 1 到 100 条批量新建或更新自由创作资料。每条都要写清概念/机制及代价、深层含义、与当前小说背景的原创转化；纯名词清单不符合要求。可补参考出处和标签。只保存为创作启发，不修改 Canon。省略 sourceKey 时按标题、分类和出处生成稳定编号，重复导入会更新同一卡。', {
    novelId: number, entries: { type: 'array', minItems: 1, maxItems: 100, items: researchEntry },
  }, ['novelId', 'entries'], 'draft_write', input => {
    const entries = research.upsertCreativeResearch(Number(input.novelId), input.entries as CreativeResearchDraft[])
    return { count: entries.length, entries: entries.map(entry => ({ sourceKey: entry.sourceKey, title: entry.title, category: entry.category, updatedAt: entry.updatedAt, canonDecision: entry.canonDecision })) }
  }, { scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.draftCreate], approval: 'never' })
  add('research.delete', '删除作者创作资料卡', '删除一条作者自建创作参考卡；不能删除联网来源或其他来源账本记录。', {
    novelId: number, sourceKey: { type: 'string', minLength: 1, maxLength: 160, pattern: '^author:[A-Za-z0-9._:-]+$' },
  }, ['novelId', 'sourceKey'], 'draft_write', input => {
    research.deleteCreativeResearch(Number(input.novelId), String(input.sourceKey))
    return { deleted: true, sourceKey: input.sourceKey }
  }, { scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.draftCreate], approval: 'never' })
  add('workflows.start', '启动创作阶段', '用界面配置的模型生成、独立评审、有限修订并应用；立即返回持久runId。count是规划数量；硬限制使用changeScope的newEntityCount、existingEntityIds、existingRelationIds、allowNewRelations，空ID列表禁止修改已有对象。chapter默认只写正文，禁止新增或修改图谱；changeScope为{}仍沿用该限制，要修改图谱必须显式允许对应对象或数量。chapterRevision可局部修订：target:summary只输出摘要；target:paragraphs用1起paragraphIndexes指定待改段落，编号与assets.query返回的revisionParagraphs一致；target:scene用sceneId，场景须能唯一对应已存正文，否则需明确paragraphIndexes。服务端锁定其它字段与未选段落，模型只输出补丁；sourceArtifactId可使用未采纳候选，来源候选的局部修订始终autoApply=false，复核后再显式apply。大纲用chapterIds限定已有章节并禁止修改卷单元；仅补章节安排时设置preserveChapterFields:["title","outline","volumeId","partId","targetWords","allowedFactIds","revealedFactIds"]锁定章名、大纲、卷章位置与信息揭示。正文前先用chapters.readiness检查；如缺章节合同或场景，先以outline阶段生成并复核本章安排，重要剧情建议autoApply=false并检查候选，再应用后独立启动chapter阶段，正文任务不会暗中保存大纲。默认自动应用通过审校的结果；失败保留候选。operation=review支持复核各阶段的正式资料，不改写；大纲复核必须用changeScope.chapterIds指定已有章节。图谱复核须给两个已有ID数组（可一个为空）、newEntityCount=0、allowNewRelations=false，不能带sourceArtifactId。修订问题须保持最新候选和原保存范围；未保存候选不能用正式复核关闭。随后调用workflows.get查询。', requestFields, ['novelId', 'stage', 'request', 'idempotencyKey'], 'canonical_write', async input => ({ run: await workflow.startCreativeWorkflow(input as unknown as CreativeWorkflowInput) }))
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
  add('workflows.resume', '继续创作', '中断任务在资料与模型未变化时复用已完成响应，继续未完成步骤；未通过候选有限重试。等待确认的候选保持暂停。应用须调用workflows.apply。输入变化请新建任务。', { novelId: number, runId: number }, ['novelId', 'runId'], 'canonical_write', input => ({ run: workflow.resumeCreativeWorkflow(Number(input.novelId), Number(input.runId)) }))
  add('workflows.apply', '应用已审校版本', '应用本任务通过审校的候选，不再调用模型；重复调用返回已完成结果。', { novelId: number, runId: number }, ['novelId', 'runId'], 'canonical_write', input => {
    const run = workflow.getCreativeRun(Number(input.novelId), Number(input.runId))
    if (run?.operation === 'review') throw new Error('仅评审报告不能作为正文应用。请根据报告另开修订任务。')
    if (run?.reviewStatus !== 'passed') throw new Error('候选尚未通过审校。')
    return { run: workflow.resumeCreativeWorkflow(Number(input.novelId), Number(input.runId), { applyReviewedCandidate: true }) }
  })
  add('context.preview', '预览上下文', '读取本次取用的事实、来源、省略项和预算，与创作共用编译器。', requestFields, ['novelId', 'stage', 'request'], 'read', async input => ({ context: await compileCreativeContext(input as unknown as CreativeWorkflowInput) }))
  add('atlas.query', '故事地图与人物关系', '按章位查询区域层级、人物特征、路线、关系、阵营、物品和事件。locationParentId用于下钻，默认排除未来计划。boundary:start只读章初；明确采纳的章初修订在attributes.stateTiming指定chapter_start，省略表示章内或章末变更，不提前进入正文。稳定ID用于增量扩展。', { novelId: number, atChapter: { type: 'integer', minimum: 0 }, boundary: { enum: ['start', 'end'] }, locationParentId: { type: ['string', 'null'] }, focusEntityId: string, includePlanned: { type: 'boolean' } }, ['novelId'], 'read', input => ({ atlas: atlas.queryStoryAtlas(input as unknown as StoryAtlasQuery) }))
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
      return { chapter, chapterContract: getChapterContract(chapter.id), scenes: listSceneContracts(chapter.id), revisionParagraphs: chapterRevisionParagraphs(chapter.content || '') }
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
  registerChapterIndexTools(registry)
  registerAtlasJourneyTools(registry)
  return registry
}
