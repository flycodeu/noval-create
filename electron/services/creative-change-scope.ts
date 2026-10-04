import { CREATIVE_CHANGE_SCOPE_SCHEMA, type CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { validateJsonSchema } from '../../src/shared/tool-contracts'
import type { StoryAtlasChange, StoryAtlasValidationResult } from '../../src/shared/story-atlas'
import { listChapters } from './chapter.service'

const chapterFieldLabels = {
  title: '标题', outline: '原大纲', volumeId: '所属卷', partId: '所属单元', targetWords: '目标字数',
  allowedFactIds: '可用信息点', revealedFactIds: '本章揭示信息点',
} as const

function savedChapterField(chapter: ReturnType<typeof listChapters>[number], field: keyof typeof chapterFieldLabels): unknown {
  if (field === 'allowedFactIds' || field === 'revealedFactIds') {
    const value = JSON.parse(chapter[field === 'allowedFactIds' ? 'allowedFactIdsJson' : 'revealedFactIdsJson'] || '[]') as unknown
    if (!Array.isArray(value)) throw new Error('已有章节的信息点数据格式错误。')
    return value
  }
  return chapter[field]
}

export function validateCreativeChangeScope(input: CreativeWorkflowInput): void {
  if (input.changeScope === undefined) return
  const result = validateJsonSchema(input.changeScope, CREATIVE_CHANGE_SCOPE_SCHEMA)
  if (!result.valid) throw new Error(`保存范围格式错误：${result.issues.join('；')}`)
  const fields = Object.keys(input.changeScope)
  if (!fields.length) throw new Error('保存范围不能为空。')
  for (const ids of [input.changeScope.existingEntityIds, input.changeScope.existingRelationIds, input.changeScope.chapterIds]) {
    if (ids && (new Set<string | number>(ids).size !== ids.length || ids.some(id => typeof id === 'string' && id.trim() !== id))) throw new Error('保存范围的 ID 不得重复或包含首尾空白。')
  }
  if (input.changeScope.preserveChapterFields && (!input.changeScope.chapterIds || new Set(input.changeScope.preserveChapterFields).size !== input.changeScope.preserveChapterFields.length)) throw new Error('保留章节字段必须指定章节，且字段不得重复。')
  const allowed = input.stage === 'outline' ? ['chapterIds', 'preserveChapterFields']
    : ['characters', 'map', 'relationships', 'factions', 'items', 'events', 'chapter'].includes(input.stage)
      ? ['existingEntityIds', 'existingRelationIds', 'newEntityCount', 'allowNewRelations'] : []
  if (fields.some(field => !allowed.includes(field))) throw new Error('保存范围包含当前阶段不支持的限制。')
}

/** Check resolved records, so a new clientId cannot disguise an update to an existing name. */
export function assertCreativeChangeScope(input: CreativeWorkflowInput, data: Record<string, unknown>, resolution?: StoryAtlasValidationResult): void {
  validateCreativeChangeScope(input)
  const scope = input.changeScope
  if (!scope) return
  if (scope.chapterIds) {
    if (Array.isArray(data.volumes) && data.volumes.length) throw new Error('本次只允许保存指定章节，不能修改卷或单元。')
    const existing = scope.preserveChapterFields?.length ? new Map(listChapters(input.novelId).map(chapter => [chapter.id, chapter])) : undefined
    for (const chapter of (data.chapters || []) as Array<{ id?: number }>) {
      if (chapter.id === undefined || !scope.chapterIds.includes(chapter.id)) throw new Error(`章节 ${chapter.id ?? '新增章节'} 超出本次保存范围。`)
      for (const field of scope.preserveChapterFields || []) {
        const current = existing?.get(chapter.id)
        const proposed = (chapter as Record<string, unknown>)[field]
        if (!current || (proposed !== undefined && JSON.stringify(proposed) !== JSON.stringify(savedChapterField(current, field)))) {
          throw new Error(`第 ${current?.chapterNum || chapter.id} 章的${chapterFieldLabels[field]}必须保持不变。`)
        }
      }
    }
    return
  }
  const changes = (data.changes || []) as StoryAtlasChange[]
  if (changes.length && (!resolution || resolution.resolvedChanges.length !== changes.length)) throw new Error('保存范围检查缺少完整的变更解析结果。')
  let newEntities = 0
  for (const resolved of resolution?.resolvedChanges || []) {
    const change = changes[resolved.index]
    if (!change) throw new Error('保存范围检查收到无效的变更位置。')
    if (change.op === 'upsert_entity') {
      if (resolved.isNew) newEntities++
      else if (scope.existingEntityIds && !scope.existingEntityIds.includes(resolved.id)) throw new Error(`资料 ${resolved.id} 超出本次保存范围。`)
    } else if (change.op === 'upsert_relation') {
      if (resolved.isNew && scope.allowNewRelations === false) throw new Error('本次不允许新增关系。')
      if (!resolved.isNew && scope.existingRelationIds && !scope.existingRelationIds.includes(resolved.id)) throw new Error(`关系 ${resolved.id} 超出本次保存范围。`)
    } else throw new Error('本次保存范围只允许新增或更新资料。')
  }
  if (scope.newEntityCount !== undefined && newEntities !== scope.newEntityCount) throw new Error(`本次须新增 ${scope.newEntityCount} 项资料，实际新增 ${newEntities} 项。`)
}
