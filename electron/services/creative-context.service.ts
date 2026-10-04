import { estimateTokens } from '../../src/shared/token-budget'
import type { CreativeContextReport, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import { listChapters } from './chapter.service'
import { getNovel } from './novel.service'
import { queryStoryAtlas } from './story-atlas.service'
import { resolveModelRuntimeBudget } from './model.service'
import { compileCreativeChapterContext, creativeProjectSources, creativeRevisionSource } from './creative-chapter-context'
import { getSqlite } from '../database/db'
import { queryCreativeFacts } from './creative-facts'
import { creativeAtlasCoverage, isCreativeChapterScopedRequest, selectCreativeAssetAtlas, selectCreativePlanningAtlas } from './creative-atlas-context'
import { validateCreativeChangeScope } from './creative-change-scope'
import { getChapterContract, listSceneContracts } from './endgame-asset.service'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { captureChapterRevisionBase, chapterRevisionGenerationMaterial, validateChapterRevision, type ChapterRevisionBase } from './creative-chapter-revision'

/** Freeze generation at a real narrative position; omitted atlas position is only for browsing. */
export function resolveCreativeChapterPosition(input: CreativeWorkflowInput): number {
  if (input.atChapter !== undefined && !(input.stage === 'chapter' && input.atChapter === 0)) return input.atChapter
  const chapters = listChapters(input.novelId)
  if (input.stage === 'outline' && input.changeScope?.chapterIds?.length === 1) {
    const chapter = chapters.find(row => row.id === input.changeScope!.chapterIds![0])
    if (!chapter) throw new Error(`章节 ${input.changeScope.chapterIds[0]} 不属于当前项目。`)
    return chapter.chapterNum
  }
  const writtenThrough = chapters.filter(chapter => chapter.content?.trim()).reduce((n, chapter) => Math.max(n, chapter.chapterNum), 0)
  return input.stage === 'chapter' ? writtenThrough + 1 : writtenThrough
}

/** A handoff is an excerpt, not a newly composed summary. Never cut through its last complete sentence. */
function endingEvidence(content: string, preferredCharacters = 1000) {
  const text = content.trimEnd()
  if (text.length <= preferredCharacters) return { endingExcerpt: text, excerptStart: 0, omittedCharacters: 0 }
  // Prefer complete paragraphs. A very long paragraph can use sentence boundaries, but an
  // unbroken passage stays intact and is subject to the normal mandatory-source budget gate.
  const paragraphStarts = [0, ...[...text.matchAll(/\r?\n+/gu)].map(match => match.index! + match[0].length)]
  let start = paragraphStarts.find(index => text.length - index <= preferredCharacters)
  if (start === undefined) start = [...text.matchAll(/[。！？.!?][”’"']*(?:\s*)/gu)]
    .map(match => match.index! + match[0].length).find(index => index < text.length && text.length - index <= preferredCharacters)
  start ??= 0
  return { endingExcerpt: text.slice(start), excerptStart: start, omittedCharacters: start }
}

// These are adapter/storage bookkeeping fields. Business attributes, evidence, empty authored
// values, chronology and planned-reveal constraints remain available in their original form.
const atlasBookkeeping = new Set(['sortOrder', 'recordStatus'])
function narrativeAttributes(attributes: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => !atlasBookkeeping.has(key)))
}

/** A blank stored field is not a constraint or an instruction to erase a field on apply. */
function populatedPlanningFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(populatedPlanningFields)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null && field !== undefined && field !== '')
    .map(([key, field]) => [key, populatedPlanningFields(field)]))
}

/** The independently reviewed formal snapshot is already budgeted; refer to identical whole values. */
function formalSnapshotValues(snapshot: unknown) {
  const values = new Map<string, string>()
  const visit = (value: unknown, path: string) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (text && estimateTokens(text) >= 100 && !values.has(text)) values.set(text, path)
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, `${path}[${JSON.stringify(key)}]`)
  }
  if (snapshot !== undefined) visit(snapshot, '$')
  return values
}

/** A bounded, inspectable projection shared by generation, review and MCP preview. */
export async function compileCreativeContext(input: CreativeWorkflowInput, modelConfigId?: number, reviewModelConfigId?: number, formalReviewTokens = 0, formalReviewSnapshot?: unknown, frozenRevisionBase?: ChapterRevisionBase): Promise<CreativeContextReport> {
  validateCreativeChangeScope(input)
  validateChapterRevision(input)
  input = { ...input, atChapter: resolveCreativeChapterPosition(input) }
  const revisionBase = input.chapterRevision ? frozenRevisionBase || captureChapterRevisionBase(input) : undefined
  const novel = getNovel(input.novelId)
  if (!novel) throw new Error('项目不存在。')
  const generationBudget = resolveModelRuntimeBudget(modelConfigId || novel.modelConfigId)
  const reviewerId = reviewModelConfigId || parseStorySettingsDocument(novel.settingsJson).aiEngine.reviewModelConfigId
  const reviewBudget = reviewerId ? resolveModelRuntimeBudget(reviewerId) : generationBudget
  const budget = { maxTokens: Math.min(generationBudget.maxTokens || 12000, reviewBudget.maxTokens || 12000), maxContextTokens: Math.min(generationBudget.maxContextTokens || 32768, reviewBudget.maxContextTokens || 32768) }
  // Structured batches need both reasoning and the complete JSON. Count is the requested new assets,
  // so the base also covers changes to existing parents, endpoints and supporting records.
  const structuredAssets = ['characters', 'map', 'relationships', 'factions', 'items', 'events', 'outline'].includes(input.stage)
  const assetCount = Number.isFinite(input.count) ? Math.max(1, Math.min(12, Math.floor(input.count!))) : 3
  const stageOutputLimit = revisionBase ? revisionBase.revision.target === 'summary' ? 2_000
    : Math.min(8_000, Math.max(2_000, Math.ceil(estimateTokens(JSON.stringify(chapterRevisionGenerationMaterial(revisionBase))) * 1.6) + 1_000))
    : input.stage === 'chapter' ? 16_000 : structuredAssets ? Math.min(64_000, 16_000 + assetCount * 4_000) : 12_000
  const outputReserve = Math.min(budget.maxTokens || 12_000, stageOutputLimit, Math.floor((budget.maxContextTokens || 32_768) * 0.22))
  const reviewOutputReserve = revisionBase
    ? Math.min(reviewBudget.maxTokens || 12_000, 6_000, Math.floor((reviewBudget.maxContextTokens || 32_768) * 0.22))
    : outputReserve
  // Leave room for the candidate and instructions during the independent review request.
  const formalSnapshotTokens = input.operation === 'review' && formalReviewSnapshot !== undefined ? estimateTokens(JSON.stringify(formalReviewSnapshot)) : 0
  const reviewedChapterTokens = input.operation === 'review' && input.stage === 'chapter'
    ? Math.max(formalSnapshotTokens, estimateTokens(listChapters(input.novelId).find(chapter => chapter.chapterNum === input.atChapter)?.content || '')) : Math.max(formalReviewTokens, formalSnapshotTokens)
  const maxInputTokens = Math.min(24_000, Math.max(0, Math.floor((budget.maxContextTokens || 32_768) * 0.85) - outputReserve - reviewOutputReserve - 2_000 - Math.max(0, reviewedChapterTokens - outputReserve)))
  if (maxInputTokens < 1_000) throw new Error('当前模型窗口不足以完成生成和审校，请降低输出上限或切换模型。')
  if (input.stage === 'chapter') {
    // Review sees the complete merged chapter; generation only needs the selected ranges.
    const reviewReserve = revisionBase && revisionBase.revision.target !== 'summary' ? estimateTokens(JSON.stringify(revisionBase.chapter)) + outputReserve + 500 : 0
    if (maxInputTokens - reviewReserve < 1000) throw new Error('局部修订的合并章评审依据超过当前预算，请降低输出上限或切换模型。')
    const result = await compileCreativeChapterContext(input, { maxInputTokens: maxInputTokens - reviewReserve, outputReserve }, revisionBase)
    return { ...result, maxInputTokens, reviewOutputReserve }
  }
  const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: input.atChapter, includePlanned: true })
  for (const id of input.changeScope?.existingEntityIds || []) if (!atlas.entities.some(entity => entity.id === id)) throw new Error(`资料 ${id} 在当前项目章位不存在。`)
  for (const id of input.changeScope?.existingRelationIds || []) if (!atlas.relations.some(edge => edge.id === id)) throw new Error(`关系 ${id} 在当前项目章位不存在。`)
  const chapterRows = listChapters(input.novelId)
  const sources: string[] = []
  const omittedSources: string[] = []
  const pieces: string[] = []
  const snapshotValues = input.operation === 'review' ? formalSnapshotValues(formalReviewSnapshot) : new Map<string, string>()
  const candidates: Array<{ id: string; text: string; required: boolean; priority: number }> = []
  const seen = new Map<string, typeof candidates[number]>()
  let used = 0
  const reviewedValue = (value: unknown): unknown => {
    const original = typeof value === 'string' ? value : JSON.stringify(value)
    const reference = snapshotValues.get(original)
    if (reference) return { reviewSnapshotReference: reference, usage: '与本次审校对象中该路径的正式资料逐字相同；约束及证据以该值为准。' }
    if (Array.isArray(value)) return value.map(reviewedValue)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reviewedValue(item)]))
    return value
  }
  const add = (id: string, value: unknown, required = false, priority = 50) => {
    const projected = snapshotValues.size ? reviewedValue(value) : value
    const text = typeof projected === 'string' ? projected.trim() : JSON.stringify(projected)
    if (!text || text === 'null') return
    // Equal values under different rule names are different constraints (e.g. two enabled prohibitions).
    const identity = `${id}\u0000${text}`
    const previous = seen.get(identity)
    if (previous) { previous.required ||= required; previous.priority = Math.min(previous.priority, priority); return }
    const candidate = { id, text, required, priority }
    seen.set(identity, candidate); candidates.push(candidate)
  }
  add('task', { stage: input.stage, request: input.request, count: input.count, atChapter: input.atChapter, changeScope: input.changeScope }, true)
  add('background', novel.userBackground, true)
  const assetStage = input.stage === 'map' || input.stage === 'events' ? input.stage : undefined
  for (const source of creativeProjectSources(novel)) {
    if (assetStage && source.key.startsWith('voice:')) {
      omittedSources.push(`${source.key}:outside_${assetStage}_scope`)
      continue
    }
    // Geography and chronology are binding for asset planning even when they were optional for prose.
    const assetConstraint = assetStage && /^world_rules:(?:foundation|geography|mapBlueprint|worldDynamics|environment|environmentRules|naturalRules|timelineConfig)(?::|$)/u.test(source.key)
    add(source.key, source.value, source.required || Boolean(assetConstraint))
  }
  const revisionSource = creativeRevisionSource(input)
  if (revisionSource) add(`revision:${input.sourceArtifactId}`, revisionSource, true)
  add('expanded_background', novel.expandedBackground)
  const target = input.atChapter ?? chapterRows.reduce((n, chapter) => Math.max(n, chapter.chapterNum), 0) + 1
  const targetChapter = chapterRows.find(chapter => chapter.chapterNum === target)
  const previousChapter = chapterRows.filter(chapter => chapter.chapterNum < target && chapter.content?.trim()).sort((a, b) => b.chapterNum - a.chapterNum)[0]
  const localOutline = input.stage === 'outline' && (isCreativeChapterScopedRequest(input.request) || Boolean(input.changeScope?.chapterIds))
  const scopedChapters = input.changeScope?.chapterIds?.map(id => {
    const chapter = chapterRows.find(row => row.id === id)
    if (!chapter) throw new Error(`章节 ${id} 不属于当前项目。`)
    return chapter
  }) || []
  if (targetChapter) add(`chapter:${targetChapter.id}:target`, {
    chapterNum: target, title: targetChapter.title, outline: targetChapter.outline, summary: targetChapter.summary,
    volumeId: targetChapter.volumeId, partId: targetChapter.partId, targetWords: targetChapter.targetWords,
    allowedFactIdsJson: targetChapter.allowedFactIdsJson, revealedFactIdsJson: targetChapter.revealedFactIdsJson,
  }, localOutline || isCreativeChapterScopedRequest(input.request), 0)
  for (const chapter of scopedChapters) if (chapter.id !== targetChapter?.id) add(`chapter:${chapter.id}:target`, {
    chapterNum: chapter.chapterNum, title: chapter.title, outline: chapter.outline, summary: chapter.summary,
    volumeId: chapter.volumeId, partId: chapter.partId, targetWords: chapter.targetWords,
    allowedFactIdsJson: chapter.allowedFactIdsJson, revealedFactIdsJson: chapter.revealedFactIdsJson,
  }, true, 0)
  const plannedChapters = localOutline ? [...new Map([...(targetChapter ? [targetChapter] : []), ...scopedChapters].map(chapter => [chapter.id, chapter])).values()] : []
  for (const chapter of plannedChapters) add(`chapter:${chapter.id}:arrangement`, populatedPlanningFields({
    chapterContract: getChapterContract(chapter.id), scenes: listSceneContracts(chapter.id),
  }), true, 0)
  if (localOutline && previousChapter) add(`chapter:${previousChapter.id}:handoff`, {
    chapterNum: previousChapter.chapterNum, title: previousChapter.title, summary: previousChapter.summary,
    ...endingEvidence(previousChapter.content!), usage: '前章已发生的交接；本章大纲是计划，不能视为已发生。节选仅覆盖正文结尾，省略范围不表示此前没有发生其他事情。',
  }, true, 0)
  if (input.stage === 'outline' || input.stage === 'story') {
    const sqlite = getSqlite()
    const catalogs = [
      ['volume', sqlite.prepare('SELECT id,title,summary FROM story_volumes WHERE novel_id=? ORDER BY volume_number,id').all(input.novelId) as Array<{ id: number; title: string; summary: string }>],
      ['part', sqlite.prepare('SELECT id,volume_id AS volumeId,title,summary FROM story_parts WHERE novel_id=? ORDER BY volume_id,part_number,id').all(input.novelId) as Array<{ id: number; title: string; summary: string; volumeId: number }>],
      ['fact', queryCreativeFacts(input.novelId)],
    ] as const
    const chapterNumbers = new Map(chapterRows.map(chapter => [chapter.id, chapter.chapterNum]))
    const ids = (json: string | null | undefined): number[] => {
      try { const value: unknown = JSON.parse(json || '[]'); return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [] } catch { return [] }
    }
    const contractFacts = new Set(plannedChapters.flatMap(chapter => [...ids(chapter.allowedFactIdsJson), ...ids(chapter.revealedFactIdsJson)]))
    for (const [kind, rows] of catalogs) for (const row of rows) {
      const explicit = input.request.includes(row.title) || input.request.split(/[^\w:-]+/u).includes(`${kind}:${row.id}`)
      let related = false
      if (localOutline) {
        if (kind === 'volume') related = plannedChapters.some(chapter => row.id === chapter.volumeId)
        if (kind === 'part') related = plannedChapters.some(chapter => row.id === chapter.partId)
        if (kind === 'fact' && 'plannedRevealChapterNum' in row) {
          const knownAt = [row.protagonistKnownChapterId, row.readerKnownChapterId, ...row.characterKnowledge.map(knowledge => knowledge.knownChapterId)]
            .filter((id): id is number => typeof id === 'number').map(id => chapterNumbers.get(id))
          related = contractFacts.has(row.id) || row.plannedRevealChapterNum === target
            || knownAt.some(chapter => chapter !== undefined && chapter >= target - 2 && chapter < target)
            || Boolean(row.title && `${targetChapter?.outline || ''}\n${previousChapter?.summary || ''}`.includes(row.title))
        }
      }
      add(`${kind}:${row.id}:planning`, kind === 'fact' ? populatedPlanningFields(row) : row, explicit || related, related ? 0 : 10)
    }
  }
  const stageKinds: Partial<Record<string, string>> = { characters: 'character', map: 'location', factions: 'faction', items: 'item', events: 'event' }
  const stageKind = stageKinds[input.stage]
  const anchors = [targetChapter?.title, targetChapter?.outline, targetChapter?.summary, ...scopedChapters.flatMap(chapter => [chapter.title, chapter.outline, chapter.summary])].filter(Boolean).join('\n')
  const selectionInput = {
    request: [input.request, ...(input.changeScope?.existingEntityIds || []), ...(input.changeScope?.existingRelationIds || []), ...(localOutline ? ['当前章'] : [])].join('\n'), anchorText: anchors, fallbackText: previousChapter?.summary || previousChapter?.content?.slice(-2000),
  }
  const selection = assetStage ? selectCreativeAssetAtlas(atlas, { ...selectionInput, stage: assetStage }) : selectCreativePlanningAtlas(atlas, { ...selectionInput, stage: input.stage })
  const { entityIds: relevant, relationIds: relevantEdges } = selection
  const coverage = creativeAtlasCoverage(atlas, relevant)
  add('atlas_coverage', { ...coverage, selectedEntityIds: undefined }, true)
  const ordered = [...atlas.entities].sort((a, b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id)) || Number(b.kind === stageKind) - Number(a.kind === stageKind))
  for (const entity of ordered.filter(entity => relevant.has(entity.id))) {
    if (selection.constraintEntityIds.has(entity.id)) {
      add(`${entity.id}:boundary_constraint`, {
        id: entity.id, kind: entity.kind, name: entity.name, parentId: entity.parentId, status: entity.status,
        effectiveFromChapter: entity.effectiveFromChapter, usage: '仅作为既有相邻区域的边界约束，不能覆盖未提供的档案字段。',
        attributes: Object.fromEntries(Object.entries(entity.attributes).filter(([key]) => ['geography', 'locationType', 'nodeType'].includes(key))),
      }, true)
      omittedSources.push(`${entity.id}:non_geographic_fields`)
    // Provenance is kept on the saved record for audit. It is not a narrative fact and can
    // contain long workflow notes that consume the local planning window without helping a scene.
    } else {
      add(entity.id, { ...entity, source: undefined, attributes: narrativeAttributes(entity.attributes) }, true)
      for (const key of Object.keys(entity.attributes || {})) if (atlasBookkeeping.has(key)) omittedSources.push(`${entity.id}:${key}:storage_metadata`)
    }
  }
  const relevantEventIds = new Set(atlas.entities.filter(entity => relevant.has(entity.id) && entity.kind === 'event').map(entity => entity.id))
  for (const edge of atlas.relations.filter(edge => relevantEdges.has(edge.id))) {
    // The native timeline adapter gives every participant a synthetic edge whose attributes
    // are a full copy of the event row. Later atlas edits can make that copy stale. The
    // event itself is already a required source for a local outline, so retain only the
    // participant identity/label here; explicit atlas participation edges are untouched.
    const copiedEvent = localOutline && edge.kind === 'participation'
      && /^participation:timeline_events:\d+:\d+$/u.test(edge.id)
      && (relevantEventIds.has(edge.fromId) || relevantEventIds.has(edge.toId))
    if (copiedEvent) {
      add(`relation:${edge.id}`, {
        id: edge.id, kind: edge.kind, fromId: edge.fromId, toId: edge.toId,
        label: edge.label, status: edge.status, effectiveFromChapter: edge.effectiveFromChapter,
      }, true)
      omittedSources.push(`${edge.id}:duplicated_event_snapshot`)
      continue
    }
    // Legacy participation records copied the whole event into every participant edge.
    // Reference only byte-equivalent fields already present in this same context; differing
    // observations and participant-specific actions must remain intact.
    const event = localOutline && edge.kind === 'participation'
      ? atlas.entities.find(entity => relevant.has(entity.id) && entity.kind === 'event' && [edge.fromId, edge.toId].includes(entity.id)) : undefined
    const shared: string[] = []
    const attributes = Object.fromEntries(Object.entries(narrativeAttributes(edge.attributes)).filter(([key, value]) => {
      const original = key === 'eventTitle' ? event?.name : key === 'eventSummary' ? event?.summary : event?.attributes[key]
      if (event && original !== undefined && JSON.stringify(value) === JSON.stringify(original)) { shared.push(key); return false }
      return true
    }))
    add(`relation:${edge.id}`, shared.length
      ? { ...edge, source: undefined, attributes, sharedAttributes: { sourceId: event!.id, keys: shared } }
      : { ...edge, source: undefined, attributes }, true)
  }
  // Compact optional catalog is selected before optional full entities. Large projects can omit names
  // explicitly instead of blocking every local task on an ever-growing mandatory global directory.
  const catalog = assetStage ? ordered.filter(entity => relevant.has(entity.id) || entity.kind === stageKind) : ordered
  for (let index = 0; index < catalog.length; index += 40) add(`identities:${index / 40}`, catalog.slice(index, index + 40).map(entity => `${entity.id}|${entity.kind}|${entity.name}`).join('\n'))
  for (const entity of ordered.filter(entity => !relevant.has(entity.id))) {
    omittedSources.push(`${entity.id}:outside_${input.stage}_scope`)
  }
  for (const edge of atlas.relations.filter(edge => !relevantEdges.has(edge.id))) {
    omittedSources.push(`relation:${edge.id}:outside_${input.stage}_scope`)
  }
  for (const chapter of [...chapterRows].sort((a, b) => Math.abs(a.chapterNum - target) - Math.abs(b.chapterNum - target))) {
    if (chapter.id === targetChapter?.id || scopedChapters.some(row => row.id === chapter.id)) continue
    if (localOutline && chapter.id === previousChapter?.id) { omittedSources.push(`chapter:${chapter.id}:plan:superseded_by_written_handoff`); continue }
    add(`chapter:${chapter.id}:plan`, { chapterNum: chapter.chapterNum, title: chapter.title, outline: chapter.outline, summary: chapter.summary }, false, 20 + Math.abs(chapter.chapterNum - target))
  }
  const ranked = [...candidates].sort((a, b) => Number(b.required) - Number(a.required) || a.priority - b.priority)
  for (const { id, text, required } of ranked) {
    const section = `<source id="${id}">\n${text}\n</source>`
    const size = estimateTokens(`${pieces.length ? '\n\n' : ''}${section}`)
    if (used + size > maxInputTokens) {
      if (required) throw new Error(`必要资料 ${id} 超出模型上下文预算，请缩小本阶段范围。`)
      omittedSources.push(id); continue
    }
    used += size; sources.push(id); pieces.push(section)
  }
  return { text: pieces.join('\n\n'), estimatedTokens: used, maxInputTokens, outputReserve, reviewOutputReserve, sources, omittedSources }
}

