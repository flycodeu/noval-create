import type { AgentToolDescriptor, AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CREATIVE_STAGES } from '../../src/shared/creative-workflow'
import type { CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasApplyInput, StoryAtlasQuery } from '../../src/shared/story-atlas'
import { AgentToolRegistry, AgentToolInvocationError } from './tool-registry'
import * as workflow from '../services/creative-workflow.service'
import { compileCreativeContext } from '../services/creative-context.service'
import * as atlas from '../services/story-atlas.service'
import { getNovel } from '../services/novel.service'
import { getChapter, listChapters } from '../services/chapter.service'
import { getChapterContract, listSceneContracts } from '../services/endgame-asset.service'

const number: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
const string: AgentToolJsonSchema = { type: 'string', minLength: 1 }
const requestFields: Record<string, AgentToolJsonSchema> = { novelId: number, stage: { enum: [...CREATIVE_STAGES] }, request: { type: 'string', minLength: 1, maxLength: 12000 }, count: { type: 'integer', minimum: 1, maximum: 50 }, atChapter: { type: 'integer', minimum: 0 }, autoApply: { type: 'boolean' }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 } }
export function registerCreativeTools(registry: AgentToolRegistry): AgentToolRegistry {
  function add(id: string, title: string, description: string, properties: Record<string, AgentToolJsonSchema>, required: string[], effect: AgentToolDescriptor['effect'], handler: (input: Record<string, unknown>) => unknown | Promise<unknown>): void {
    registry.register({ descriptor: { id: `novelforge.${id}`, version: '2.0.0', domain: id.split('.')[0], title, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: true }, effect, approval: 'policy', scopes: effect === 'read' ? [AGENT_TOOL_SCOPES.novelRead] : [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.canonWrite], idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: ['creative-workspace'] }, handler: async input => {
      try { return await handler(input) } catch (error) {
        if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new AgentToolInvocationError(error.code, error.message)
        throw error
      }
    } })
  }
  add('workflows.start', '启动创作阶段', '用界面配置的模型生成、独立评审、有限修订并应用；立即返回持久runId。各阶段均可增量扩展。默认自动应用通过审校的结果；失败保留候选。随后调用workflows.get查询。', requestFields, ['novelId', 'stage', 'request', 'idempotencyKey'], 'canonical_write', async input => ({ run: await workflow.startCreativeWorkflow(input as unknown as CreativeWorkflowInput) }))
  add('workflows.get', '读取创作进度', '返回步骤、模型ID、阶段事件、候选和评审引用、应用结果；省略runId返回最近任务。MCP断开不会停止任务。', { novelId: number, runId: number }, ['novelId'], 'read', input => ({ run: workflow.getCreativeRun(Number(input.novelId), input.runId as number | undefined) }))
  add('workflows.list', '创作历史', '最近30次创作任务。草稿与历史存数据库，不自动导出文件。', { novelId: number }, ['novelId'], 'read', input => ({ runs: workflow.listCreativeRuns(Number(input.novelId)) }))
  add('workflows.cancel', '取消创作', '取消模型请求和后续应用，保留已保存成果。', { novelId: number, runId: number }, ['novelId', 'runId'], 'draft_write', input => ({ run: workflow.cancelCreativeWorkflow(Number(input.novelId), Number(input.runId)) }))
  add('workflows.resume', '继续创作', '通过审校的候选直接应用；失败任务在资料未变化时有限重试。输入变化请新建任务。', { novelId: number, runId: number }, ['novelId', 'runId'], 'canonical_write', input => ({ run: workflow.resumeCreativeWorkflow(Number(input.novelId), Number(input.runId)) }))
  add('workflows.apply', '应用已审校版本', '应用本任务通过审校的候选，不再调用模型；重复调用返回已完成结果。', { novelId: number, runId: number }, ['novelId', 'runId'], 'canonical_write', input => {
    if (workflow.getCreativeRun(Number(input.novelId), Number(input.runId))?.reviewStatus !== 'passed') throw new Error('候选尚未通过审校。')
    return { run: workflow.resumeCreativeWorkflow(Number(input.novelId), Number(input.runId)) }
  })
  add('context.preview', '预览上下文', '读取本次取用的事实、来源、省略项和预算，与创作共用编译器。', requestFields, ['novelId', 'stage', 'request'], 'read', async input => ({ context: await compileCreativeContext(input as unknown as CreativeWorkflowInput) }))
  add('atlas.query', '故事地图与人物关系', '按章位查询区域层级、人物特征、路线、关系、阵营、物品和事件。locationParentId用于下钻，默认排除未来计划。稳定ID用于增量扩展。', { novelId: number, atChapter: { type: 'integer', minimum: 0 }, locationParentId: { type: ['string', 'null'] }, focusEntityId: string, includePlanned: { type: 'boolean' } }, ['novelId'], 'read', input => ({ atlas: atlas.queryStoryAtlas(input as unknown as StoryAtlasQuery) }))
  const changeSchema: AgentToolJsonSchema = { anyOf: [
    { type: 'object', properties: { op: { const: 'upsert_entity' }, id: string, clientId: string, kind: { enum: ['character', 'location', 'faction', 'item', 'event'] }, name: string, summary: { type: 'string' }, parentId: { type: ['string', 'null'] }, attributes: { type: 'object', additionalProperties: true }, status: { enum: ['confirmed', 'planned'] } }, required: ['op', 'kind', 'name'], additionalProperties: false },
    { type: 'object', properties: { op: { const: 'upsert_relation' }, id: string, clientId: string, kind: { enum: ['relationship', 'route', 'presence', 'ownership', 'membership', 'participation'] }, fromId: string, toId: string, label: { type: 'string' }, attributes: { type: 'object', additionalProperties: true }, status: { enum: ['confirmed', 'planned'] } }, required: ['op', 'kind', 'fromId', 'toId'], additionalProperties: false },
    { type: 'object', properties: { op: { const: 'retire' }, id: string }, required: ['op', 'id'], additionalProperties: false },
  ] }
  const fields: Record<string, AgentToolJsonSchema> = { novelId: number, expectedContextVersion: number, idempotencyKey: string, effectiveFromChapter: { type: 'integer', minimum: 0 }, source: { type: 'object', properties: { kind: string, id: string, note: string }, required: ['kind'], additionalProperties: false }, changes: { type: 'array', minItems: 1, maxItems: 100, items: changeSchema } }
  const required = ['novelId', 'expectedContextVersion', 'idempotencyKey', 'effectiveFromChapter', 'source', 'changes']
  add('atlas.validate', '检查图谱变更', '只校验，不写入。检查引用、循环、层级和路线。批次使用clientId互相引用。changes用upsert_entity、upsert_relation或retire。', fields, required, 'read', input => ({ validation: atlas.validateStoryAtlasChanges(input as unknown as StoryAtlasApplyInput) }))
  add('atlas.apply', '应用明确资料变更', '保存明确设计或已讨论更正，记录来源与生效章位。不调用模型审校；模型生成请用workflows.start。已有实体带id，新实体用clientId。人物关系/路线/归属用upsert_relation。重复幂等键不重复创建。', fields, required, 'canonical_write', input => ({ result: atlas.applyStoryAtlasChanges(input as unknown as StoryAtlasApplyInput) }))
  add('assets.query', '查询背景与章节', '读取背景、规则、文风和分页章节目录；chapterId可取正文及合同。人物地图用atlas.query。', { novelId: number, chapterId: number, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['novelId'], 'read', input => {
    const novel = getNovel(Number(input.novelId))
    if (!novel) throw new Error('项目不存在。')
    if (input.chapterId) {
      const chapter = getChapter(Number(input.chapterId))
      if (!chapter || chapter.novelId !== novel.id) throw new Error('章节不属于当前项目。')
      return { chapter, chapterContract: getChapterContract(chapter.id), scenes: listSceneContracts(chapter.id) }
    }
    const rows = listChapters(novel.id), offset = Number(input.offset || 0), limit = Number(input.limit || 20)
    return { novelId: novel.id, contextVersion: novel.contextVersion, modelConfigId: novel.modelConfigId, background: novel.userBackground, expandedBackground: novel.expandedBackground, worldRules: novel.worldRulesJson, voice: novel.themeVoiceJson, chapterCount: rows.length, chapters: rows.slice(offset, offset + limit).map(row => ({ id: row.id, chapterNum: row.chapterNum, title: row.title, outline: row.outline, summary: row.summary, status: row.status, wordCount: row.wordCount })), nextOffset: offset + limit < rows.length ? offset + limit : null }
  })
  return registry
}
