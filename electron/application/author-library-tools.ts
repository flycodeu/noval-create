import { AGENT_TOOL_SCOPES, type AgentToolDescriptor, type AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AgentToolRegistry, AgentToolInvocationError } from './tool-registry'
import { AuthorLibraryError } from '../services/author-library-error'
import { StoryAtlasError } from '../services/story-atlas.service'
import { CreativeResearchValidationError } from '../../src/shared/creative-research'
import { listPersonalResearch, publishPersonalResearch, referencePersonalResearch, updatePersonalResearch } from '../services/personal-research.service'
import { getAuthorLedger, correctAuthorCharacter, correctAuthorClue } from '../services/author-ledger.service'
import * as authorStyle from '../services/author-style.service'
import { previewClueMerge, mergeAuthorClues } from '../services/foreshadow-merge.service'

export function registerAuthorLibraryTools(registry: AgentToolRegistry) {
  const id: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
  const text: AgentToolJsonSchema = { type: 'string', minLength: 1, maxLength: 200 }
  const add = (name: string, title: string, effect: AgentToolDescriptor['effect'], properties: Record<string, AgentToolJsonSchema>, required: string[], handler: (input: Record<string, unknown>) => unknown) => {
    registry.register({ descriptor: { id: `novelforge.${name}`, version: '1.0.0', domain: name.split('.')[0], title, description: title,
      inputSchema: { type: 'object', properties, required, additionalProperties: false }, outputSchema: { type: 'object', additionalProperties: true },
      effect, approval: 'policy', scopes: effect === 'read' ? [AGENT_TOOL_SCOPES.novelRead] : [AGENT_TOOL_SCOPES.novelRead, effect === 'draft_write' ? AGENT_TOOL_SCOPES.draftCreate : AGENT_TOOL_SCOPES.canonWrite],
      idempotent: effect === 'read' || name === 'ledger.merge_clues', taskMode: 'sync', timeoutClass: ['style.analyze', 'style.trial'].includes(name) ? 'model' : 'short', tags: ['creative-workspace'] }, handler: async input => {
        try { return await handler(input) } catch (error) {
          if (error instanceof AuthorLibraryError || error instanceof StoryAtlasError || error instanceof CreativeResearchValidationError) throw new AgentToolInvocationError(error.code, error.message)
          throw error
        }
      } })
  }
  add('research.personal_list', '搜索本机个人资料（最多 200 条）', 'read', { query: { type: 'string', maxLength: 200 }, includeArchived: { type: 'boolean' }, category: { type: 'string', maxLength: 30 } }, [], input => ({ cards: listPersonalResearch(input.query as string | undefined, input.includeArchived === true, input.category as string | undefined) }))
  add('research.publish', '发布通用卡到个人库，不带本作转化说明', 'canonical_write', { novelId: id, sourceKey: text }, ['novelId', 'sourceKey'], input => ({ card: publishPersonalResearch(Number(input.novelId), String(input.sourceKey)) }))
  add('research.personal_update', '更新或归档个人资料，保留已引用的作品副本', 'canonical_write', { cardId: text, expectedRevision: id, content: { type: 'object', additionalProperties: true }, archived: { type: 'boolean' } }, ['cardId', 'expectedRevision', 'content', 'archived'], input => ({ card: updatePersonalResearch(String(input.cardId), Number(input.expectedRevision), input.content, input.archived === true) }))
  add('research.reference', '显式采用个人资料版本，保留本作转化说明', 'canonical_write', { novelId: id, cardId: text, expectedRevision: id, expectedContextVersion: id, novelConnection: { type: 'string', minLength: 1, maxLength: 1200 } }, ['novelId', 'cardId', 'expectedRevision', 'expectedContextVersion', 'novelConnection'], input => ({ entry: referencePersonalResearch(input as unknown as Parameters<typeof referencePersonalResearch>[0]) }))
  add('ledger.get', '读取伏笔、重复提示和人物保护信息', 'read', { novelId: id }, ['novelId'], input => ({ ledger: getAuthorLedger(Number(input.novelId)) }))
  const merge = { novelId: id, keepId: id, sourceIds: { type: 'array', minItems: 1, maxItems: 20, items: id } } satisfies Record<string, AgentToolJsonSchema>
  add('ledger.merge_preview', '预览重复线索字段差异、引用迁移和关联冲突', 'read', merge, Object.keys(merge), input => ({ preview: previewClueMerge(input as unknown as Parameters<typeof previewClueMerge>[0]) }))
  const confirmedMerge = { ...merge, expectedContextVersion: id, previewFingerprint: text, reason: { type: 'string', minLength: 1, maxLength: 1200 }, idempotencyKey: text } satisfies Record<string, AgentToolJsonSchema>
  add('ledger.merge_clues', '确认合并线索，事务迁移引用并保留原项与合并记录', 'canonical_write', confirmedMerge, Object.keys(confirmedMerge), input => ({ result: mergeAuthorClues(input as unknown as Parameters<typeof mergeAuthorClues>[0]) }))
  const correction = { novelId: id, entityId: text, expectedContextVersion: id, effectiveFromChapter: { type: 'integer', minimum: 0 }, name: text, origin: { type: 'string', maxLength: 2000 }, abilityLimits: { type: 'string', maxLength: 2000 }, protectedFields: { type: 'array', maxItems: 3, items: { enum: ['name', 'attributes.origin', 'attributes.abilityLimits'] } }, note: { type: 'string', minLength: 1, maxLength: 1200 }, idempotencyKey: text } satisfies Record<string, AgentToolJsonSchema>
  add('ledger.correct_character', '作者明确更正人物常设属性和保护范围', 'canonical_write', correction, Object.keys(correction), input => ({ result: correctAuthorCharacter(input as unknown as Parameters<typeof correctAuthorCharacter>[0]) }))
  const chapter: AgentToolJsonSchema = { anyOf: [id, { type: 'null' }] }
  const clue = { novelId: id, expectedContextVersion: id, id, title: text, detail: { type: 'string', maxLength: 4000 }, status: { type: 'string', minLength: 1, maxLength: 80 }, sourceChapterId: chapter, targetPayoffChapter: chapter, actualPayoffChapterId: chapter, requiredEvidence: { type: 'string', maxLength: 2000 } } satisfies Record<string, AgentToolJsonSchema>
  add('ledger.correct_clue', '作者更正现有伏笔及实际回收依据', 'canonical_write', clue, Object.keys(clue), input => ({ ledger: correctAuthorClue(input as unknown as Parameters<typeof correctAuthorClue>[0]) }))
  add('style.list', '读取样稿目录和本作认可状态', 'read', { novelId: id }, ['novelId'], input => authorStyle.listAuthorStyles(Number(input.novelId)))
  add('style.get', '读取明确选择的样稿和可复算统计', 'read', { fingerprintId: id }, ['fingerprintId'], input => authorStyle.getAuthorStyle(Number(input.fingerprintId)))
  add('style.analyze', '分析实际样稿为候选，使用本作模型，不自动认可', 'draft_write', { novelId: id, name: { type: 'string', minLength: 1, maxLength: 120 }, text: { type: 'string', maxLength: 48000 }, chapterIds: { type: 'array', minItems: 1, maxItems: 20, items: id } }, ['novelId', 'name'], input => authorStyle.analyzeAuthorStyle(input as unknown as Parameters<typeof authorStyle.analyzeAuthorStyle>[0]))
  add('style.copy_sample', '将选中的样稿独立复制到本作，保留来源且不自动认可', 'draft_write', { novelId: id, sourceId: id }, ['novelId', 'sourceId'], input => authorStyle.copyAuthorStyle(Number(input.novelId), Number(input.sourceId)))
  add('style.approve', '明确认可或撤销本作样稿，检查来源和项目版本', 'canonical_write', { novelId: id, fingerprintId: { anyOf: [id, { type: 'null' }] }, expectedContextVersion: id }, ['novelId', 'fingerprintId', 'expectedContextVersion'], input => authorStyle.approveAuthorStyle(Number(input.novelId), input.fingerprintId as number | null, Number(input.expectedContextVersion)))
  add('style.trial', '用同一场景试写应用样稿前后候选，不改正文', 'draft_write', { novelId: id, fingerprintId: id, sceneBrief: { type: 'string', minLength: 1, maxLength: 4000 } }, ['novelId', 'fingerprintId', 'sceneBrief'], input => authorStyle.trialAuthorStyle(Number(input.novelId), Number(input.fingerprintId), String(input.sceneBrief)))
  add('style.approve_trial', '认可作者明确选中的试写为样稿，不改正文', 'canonical_write', { novelId: id, text: { type: 'string', minLength: 1, maxLength: 50000 }, expectedContextVersion: id }, ['novelId', 'text', 'expectedContextVersion'], input => authorStyle.approveAuthorTrial(Number(input.novelId), String(input.text), Number(input.expectedContextVersion)))
  return registry
}
