import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
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
    if (!Array.isArray(value)) throw new Error(formatUserFacingMessage('services.changeScope.chapterFactsInvalid'))
    return value
  }
  return chapter[field]
}

export function validateCreativeChangeScope(input: CreativeWorkflowInput): void {
  if (input.changeScope === undefined) return
  const result = validateJsonSchema(input.changeScope, CREATIVE_CHANGE_SCOPE_SCHEMA)
  if (!result.valid) throw new Error(formatUserFacingMessage('services.changeScope.invalid', { issues: `${result.issues.join('；')}` }))
  const fields = Object.keys(input.changeScope)
  if (!fields.length) throw new Error(formatUserFacingMessage('services.changeScope.empty'))
  for (const ids of [input.changeScope.existingEntityIds, input.changeScope.existingRelationIds, input.changeScope.chapterIds]) {
    if (ids && (new Set<string | number>(ids).size !== ids.length || ids.some(id => typeof id === 'string' && id.trim() !== id))) throw new Error(formatUserFacingMessage('services.changeScope.idsInvalid'))
  }
  if (input.changeScope.preserveChapterFields && (!input.changeScope.chapterIds || new Set(input.changeScope.preserveChapterFields).size !== input.changeScope.preserveChapterFields.length)) throw new Error(formatUserFacingMessage('services.changeScope.preservedFieldsInvalid'))
  const allowed = input.stage === 'outline' ? ['chapterIds', 'preserveChapterFields']
    : ['characters', 'map', 'relationships', 'factions', 'items', 'events', 'chapter'].includes(input.stage)
      ? ['existingEntityIds', 'existingRelationIds', 'newEntityCount', 'allowNewRelations'] : []
  if (fields.some(field => !allowed.includes(field))) throw new Error(formatUserFacingMessage('services.changeScope.unsupportedLimit'))
}

/** Check resolved records, so a new clientId cannot disguise an update to an existing name. */
export function assertCreativeChangeScope(input: CreativeWorkflowInput, data: Record<string, unknown>, resolution?: StoryAtlasValidationResult): void {
  validateCreativeChangeScope(input)
  const scope = input.changeScope
  if (!scope) return
  if (scope.chapterIds) {
    if (Array.isArray(data.volumes) && data.volumes.length) throw new Error(formatUserFacingMessage('services.changeScope.chaptersOnly'))
    const existing = scope.preserveChapterFields?.length ? new Map(listChapters(input.novelId).map(chapter => [chapter.id, chapter])) : undefined
    for (const chapter of (data.chapters || []) as Array<{ id?: number }>) {
      if (chapter.id === undefined || !scope.chapterIds.includes(chapter.id)) throw new Error(formatUserFacingMessage('services.changeScope.chapterOutside', { id: `${chapter.id ?? formatUserFacingMessage('services.changeScope.newChapterLabel')}` }))
      for (const field of scope.preserveChapterFields || []) {
        const current = existing?.get(chapter.id)
        const proposed = (chapter as Record<string, unknown>)[field]
        if (!current || (proposed !== undefined && JSON.stringify(proposed) !== JSON.stringify(savedChapterField(current, field)))) {
          throw new Error(formatUserFacingMessage('services.changeScope.chapterFieldImmutable', { chapterNum: `${current?.chapterNum || chapter.id}`, field: `${chapterFieldLabels[field]}` }))
        }
      }
    }
    return
  }
  const changes = (data.changes || []) as StoryAtlasChange[]
  if (changes.length && (!resolution || resolution.resolvedChanges.length !== changes.length)) throw new Error(formatUserFacingMessage('services.changeScope.resolvedChangesMissing'))
  let newEntities = 0
  for (const resolved of resolution?.resolvedChanges || []) {
    const change = changes[resolved.index]
    if (!change) throw new Error(formatUserFacingMessage('services.changeScope.changeLocationInvalid'))
    if (change.op === 'upsert_entity') {
      if (resolved.isNew) newEntities++
      else if (scope.existingEntityIds && !scope.existingEntityIds.includes(resolved.id)) throw new Error(formatUserFacingMessage('services.changeScope.entityOutside', { id: `${resolved.id}` }))
    } else if (change.op === 'upsert_relation') {
      if (resolved.isNew && scope.allowNewRelations === false) throw new Error(formatUserFacingMessage('services.changeScope.newRelationsBlocked'))
      if (!resolved.isNew && scope.existingRelationIds && !scope.existingRelationIds.includes(resolved.id)) throw new Error(formatUserFacingMessage('services.changeScope.relationOutside', { id: `${resolved.id}` }))
    } else throw new Error(formatUserFacingMessage('services.changeScope.upsertOnly'))
  }
  if (scope.newEntityCount !== undefined && newEntities !== scope.newEntityCount) throw new Error(formatUserFacingMessage('services.changeScope.newEntityCountMismatch', { expectedCount: `${scope.newEntityCount}`, actualCount: `${newEntities}` }))
}
