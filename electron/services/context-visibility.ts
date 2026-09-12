import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, characters, sceneContracts, storyFacts } from '../database/schema'
import type { ContextPackSource } from '../../src/shared/context-pack'
import type { ChapterContext, ChapterContextParts, ChapterContextPromptProfile, ChapterContextRawData } from './context.service'
import {
  isFactKnownByCharacter,
  type StoryFactKnowledgeProjection,
  type StoryFactKnowledgeRow,
} from './knowledge-boundary.service'
import { isDeterministicRecallSource } from './context-recall-core'

export type ContextReadPurpose = 'writer' | 'planner' | 'review'
export type ContextVisibilityChannel =
  | 'story_fact'
  | 'entity_world'
  | 'timeline'
  | 'threads'
  | 'checkpoint'
  | 'previous_excerpt'
  | 'semantic_memory'
  | 'writer_override'

export interface ContextVisibilityFact {
  fact: StoryFactKnowledgeRow
  projection: StoryFactKnowledgeProjection
}

export interface ContextVisibilityCharacter {
  id: number
  fullName: string
  isProtagonist: boolean
}

export interface ContextVisibilityScene {
  id: number
  order: number
  pov: string
  status: string
  revealPayload: string[]
}

export interface ContextVisibilityPolicyInput {
  novelId: number
  chapterNum: number
  purpose: ContextReadPurpose
  facts: ContextVisibilityFact[]
  characters: ContextVisibilityCharacter[]
  scenes: ContextVisibilityScene[]
}

export interface ContextRevealDirective {
  factId: number
  sceneId: number
  sceneOrder: number
  text: string
}

export interface ContextVisibilityPolicy {
  novelId: number
  chapterNum: number
  purpose: ContextReadPurpose
  povCharacterIds: number[]
  unresolvedPovLabels: string[]
  allowedFacts: ContextVisibilityFact[]
  deniedFacts: ContextVisibilityFact[]
  revealDirectives: ContextRevealDirective[]
}

export interface ContextVisibilityDecision {
  sourceKey: string
  channel: ContextVisibilityChannel
  included: boolean
  reason: string
  factIds: number[]
}

export interface ContextVisibilityReport {
  purpose: ContextReadPurpose
  povCharacterIds: number[]
  unresolvedPovLabels: string[]
  decisions: ContextVisibilityDecision[]
  requiredMissingSourceKeys: string[]
  requiredMissingFactIds: number[]
  sources: ContextPackSource[]
}

const FIELD_CHANNELS: Partial<Record<keyof ChapterContextParts, ContextVisibilityChannel>> = {
  worldRules: 'entity_world', characterStates: 'entity_world', worldStates: 'entity_world', mapSummary: 'entity_world',
  itemSummary: 'entity_world', relationSummary: 'entity_world', dialogueVoiceLocks: 'entity_world',
  timelineSummary: 'timeline', timelineOpenThreads: 'timeline',
  openLoops: 'threads', dueForeshadows: 'threads', activeThreads: 'threads',
  previousSummaries: 'checkpoint', continuitySummary: 'checkpoint', continuityNotes: 'checkpoint', longTermMemory: 'checkpoint',
  chapterBridgePlan: 'checkpoint', stepMemorySummary: 'checkpoint',
  previousChapterContext: 'previous_excerpt', lastChapterEnding: 'previous_excerpt',
  recalledMemory: 'semantic_memory',
  scenePlanSummary: 'writer_override', draftTextSummary: 'writer_override', reviewRiskSummary: 'writer_override',
  reviewProofSummary: 'writer_override', rewriteDeltaSummary: 'writer_override', publishGateRiskSummary: 'writer_override',
  storyCore: 'writer_override', currentArc: 'writer_override', chapterGoal: 'writer_override', writingContractSummary: 'writer_override',
}

const UNCLASSIFIED_TEXT_FIELDS = new Set<keyof ChapterContextParts>([
  'previousSummaries', 'previousChapterContext', 'lastChapterEnding', 'longTermMemory', 'recalledMemory',
])
const CONFIRMED_SCENE_STATUSES = new Set(['ready', 'locked', 'approved'])

function parseNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseCharacterKnowledge(raw: string | null | undefined, chapterNumById: Map<number, number>) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      const characterId = parseNumber(record.characterId)
      if (!characterId) return []
      const knownChapterId = parseNumber(record.knownChapterId)
      return [{ characterId, knownChapterNum: knownChapterId ? chapterNumById.get(knownChapterId) ?? null : null }]
    })
  } catch {
    return []
  }
}

function parseCharacterKnowledgeChapterIds(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const chapterId = parseNumber((entry as Record<string, unknown>).knownChapterId)
      return chapterId ? [chapterId] : []
    })
  } catch {
    return []
  }
}

function normalizeFact(row: typeof storyFacts.$inferSelect, chapterNumById: Map<number, number>): ContextVisibilityFact {
  return {
    fact: row as StoryFactKnowledgeRow,
    projection: {
      readerKnownChapterNum: row.readerKnownChapterId ? chapterNumById.get(row.readerKnownChapterId) ?? null : null,
      protagonistKnownChapterNum: row.protagonistKnownChapterId ? chapterNumById.get(row.protagonistKnownChapterId) ?? null : null,
      characterKnowledge: parseCharacterKnowledge(row.characterKnowledgeJson, chapterNumById),
    },
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  } catch {
    return []
  }
}

export function loadContextVisibilityPolicyInput(
  novelId: number,
  chapterId: number,
  chapterNum: number,
  purpose: ContextReadPurpose,
  existing: {
    chapterRows?: Array<{ id: number; chapterNum: number }>
    characters?: Array<{ id: number; fullName: string; roleType?: string | null }>
    scenes?: Array<{
      id?: number
      segmentId?: number
      segmentOrder?: number
      pov?: string | null
      status?: string | null
      revealPayload?: string[]
    }>
  } = {},
): ContextVisibilityPolicyInput {
  const db = getDb()
  const factRows = db.select().from(storyFacts).where(eq(storyFacts.novelId, novelId)).all()
  const chapterNumById = new Map((existing.chapterRows || []).map((row) => [row.id, row.chapterNum] as const))
  const referencedChapterIds = [...new Set(factRows.flatMap((row) => {
    const characterKnowledgeIds = parseCharacterKnowledgeChapterIds(row.characterKnowledgeJson)
    return [row.readerKnownChapterId, row.protagonistKnownChapterId, ...characterKnowledgeIds]
      .filter((id): id is number => typeof id === 'number' && id > 0 && !chapterNumById.has(id))
  }))]
  if (referencedChapterIds.length > 0) {
    db.select({ id: chapters.id, chapterNum: chapters.chapterNum })
      .from(chapters)
      .where(and(eq(chapters.novelId, novelId), inArray(chapters.id, referencedChapterIds)))
      .all()
      .forEach((row) => chapterNumById.set(row.id, row.chapterNum))
  }
  const characterRows = existing.characters || db.select({ id: characters.id, fullName: characters.fullName, roleType: characters.roleType })
    .from(characters).where(eq(characters.novelId, novelId)).all()
  const sceneRows = existing.scenes || db.select().from(sceneContracts)
    .where(and(eq(sceneContracts.novelId, novelId), eq(sceneContracts.chapterId, chapterId)))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id)).all()
  return {
    novelId,
    chapterNum,
    purpose,
    facts: factRows.map((row) => normalizeFact(row, chapterNumById)),
    characters: characterRows.map((row) => ({
      id: row.id,
      fullName: row.fullName.trim(),
      isProtagonist: row.roleType === 'protagonist',
    })),
    scenes: sceneRows.map((row, index) => ({
      id: row.id || row.segmentId || index + 1,
      order: 'segmentOrder' in row && row.segmentOrder ? row.segmentOrder : index + 1,
      pov: row.pov?.trim() || '',
      status: row.status || 'draft',
      revealPayload: 'revealPayload' in row && Array.isArray(row.revealPayload)
        ? row.revealPayload
        : parseStringArray('revealPayloadJson' in row ? row.revealPayloadJson as string | null | undefined : undefined),
    })),
  }
}

function resolvePovCharacters(input: ContextVisibilityPolicyInput) {
  const byName = new Map<string, ContextVisibilityCharacter[]>()
  input.characters.forEach((character) => {
    const bucket = byName.get(character.fullName) || []
    bucket.push(character)
    byName.set(character.fullName, bucket)
  })
  const resolved: ContextVisibilityCharacter[] = []
  const unresolved: string[] = []
  if (input.scenes.length === 0) unresolved.push('missing_scene_contract')
  input.scenes.forEach((scene) => {
    if (!scene.pov) {
      unresolved.push(`scene:${scene.id}:missing_pov`)
      return
    }
    const matches = byName.get(scene.pov) || []
    if (matches.length !== 1) {
      unresolved.push(`scene:${scene.id}:ambiguous_pov`)
      return
    }
    resolved.push(matches[0])
  })
  return {
    characters: [...new Map(resolved.map((character) => [character.id, character])).values()],
    unresolved: [...new Set(unresolved)],
  }
}

function factMatchesReveal(payload: string, fact: ContextVisibilityFact): boolean {
  const normalized = payload.trim()
  return normalized === `fact:${fact.fact.id}`
    || normalized === `#${fact.fact.id}`
    || normalized === fact.fact.title.trim()
    || Boolean(fact.fact.summary?.trim() && normalized === fact.fact.summary.trim())
}

function formatFact(fact: ContextVisibilityFact): string {
  return [fact.fact.title.trim(), fact.fact.summary?.trim() || ''].filter(Boolean).join('：')
}

export function buildContextVisibilityPolicy(input: ContextVisibilityPolicyInput): ContextVisibilityPolicy {
  const pov = resolvePovCharacters(input)
  const canUseCharacterBoundary = pov.characters.length > 0 && pov.unresolved.length === 0
  const allowedFacts = input.facts.filter((fact) => {
    if (input.purpose === 'review') return true
    if (!canUseCharacterBoundary) return false
    return pov.characters.every((character) => isFactKnownByCharacter(
      fact.projection,
      character.id,
      input.chapterNum,
      character.isProtagonist,
      { boundary: 'start' },
    ).known)
  })
  const allowedIds = new Set(allowedFacts.map((fact) => fact.fact.id))
  const deniedFacts = input.facts.filter((fact) => !allowedIds.has(fact.fact.id))
  const revealDirectives = input.purpose === 'review' ? [] : input.scenes.flatMap((scene) => {
    if (!CONFIRMED_SCENE_STATUSES.has(scene.status)) return []
    return input.facts.flatMap((fact) => (
      scene.revealPayload.some((payload) => factMatchesReveal(payload, fact))
        ? [{
            factId: fact.fact.id,
            sceneId: scene.id,
            sceneOrder: scene.order,
            text: `场景${scene.order}揭示（fact:${fact.fact.id}）：${formatFact(fact)}`,
          }]
        : []
    ))
  })
  return {
    novelId: input.novelId,
    chapterNum: input.chapterNum,
    purpose: input.purpose,
    povCharacterIds: pov.characters.map((character) => character.id),
    unresolvedPovLabels: pov.unresolved,
    allowedFacts,
    deniedFacts,
    revealDirectives,
  }
}

function factNeedles(fact: ContextVisibilityFact): string[] {
  return [fact.fact.title, fact.fact.summary || ''].map((value) => value.trim()).filter((value) => value.length >= 2)
}

function findMentionedFacts(text: string, facts: ContextVisibilityFact[]): ContextVisibilityFact[] {
  if (!text.trim()) return []
  return facts.filter((fact) => factNeedles(fact).some((needle) => text.includes(needle)))
}

function buildRecallVisibilitySourceKey(
  source: ChapterContext['recalledMemorySources'][number],
  index: number,
): string {
  if (isDeterministicRecallSource(source)) return source.sourceKey
  if (source.sourceKind === 'chapter') {
    return `recall:chapter:${source.chapterId || 0}:${source.fragmentType || 'unknown'}:${index}`
  }
  return `recall:asset:${source.semanticSourceType || 'unknown'}:${source.semanticSourceId || 0}:${index}`
}

function toPackSource(
  fact: ContextVisibilityFact,
  included: boolean,
  reason: string,
  purpose: ContextReadPurpose,
): ContextPackSource {
  const text = included ? formatFact(fact) : `[redacted fact:${fact.fact.id}]`
  return {
    key: `storyFact:${fact.fact.id}`,
    sourceKind: 'story_fact',
    sourceId: String(fact.fact.id),
    sourceVersion: String(fact.fact.id),
    visibility: purpose === 'planner' ? 'plan' : 'canon',
    text,
    required: false,
    included,
    reason,
    estimatedTokens: Math.max(1, Math.ceil(text.length / 2)),
  }
}

export function filterChapterContextByVisibility(
  context: ChapterContext,
  policy: ContextVisibilityPolicy,
): ChapterContext {
  if (policy.purpose === 'review') {
    return {
      ...context,
      visibilityReport: {
        purpose: policy.purpose,
        povCharacterIds: policy.povCharacterIds,
        unresolvedPovLabels: policy.unresolvedPovLabels,
        decisions: [],
        requiredMissingSourceKeys: [],
        requiredMissingFactIds: [],
        sources: policy.allowedFacts.map((fact) => toPackSource(fact, true, 'review_truth', policy.purpose)),
      },
    }
  }

  const next = { ...context }
  const decisions: ContextVisibilityDecision[] = []
  const requiredLabels = new Set(context.hardConstraintEntries.map((entry) => entry.label))
  const authorizedRevealIds = new Set(policy.revealDirectives.map((directive) => directive.factId))
  const requiredMissingSourceKeys: string[] = []
  const requiredMissingFactIds = new Set<number>()

  ;(Object.keys(FIELD_CHANNELS) as Array<keyof ChapterContextParts>).forEach((field) => {
    const text = next[field]
    if (typeof text !== 'string' || !text.trim()) return
    const channel = FIELD_CHANNELS[field] || 'writer_override'
    const deniedMentions = findMentionedFacts(text, policy.deniedFacts)
    const allowedMentions = findMentionedFacts(text, policy.allowedFacts)
    const unclassified = UNCLASSIFIED_TEXT_FIELDS.has(field)
      && policy.deniedFacts.length > 0
      && deniedMentions.length === 0
      && allowedMentions.length === 0
    if (deniedMentions.length === 0 && !unclassified) {
      decisions.push({ sourceKey: `part:${field}`, channel, included: true, reason: 'visibility_allowed', factIds: [] })
      return
    }
    next[field] = ''
    const deniedIds = deniedMentions.map((fact) => fact.fact.id)
    const unauthorizedIds = deniedIds.filter((id) => !authorizedRevealIds.has(id))
    const required = requiredLabels.has(field as never)
    if (required && (unauthorizedIds.length > 0 || unclassified)) {
      requiredMissingSourceKeys.push(`part:${field}`)
      unauthorizedIds.forEach((id) => requiredMissingFactIds.add(id))
    }
    decisions.push({
      sourceKey: `part:${field}`,
      channel,
      included: false,
      reason: unclassified ? 'unclassified_visibility' : unauthorizedIds.length > 0 ? 'pov_forbidden_fact' : 'moved_to_reveal_instruction',
      factIds: deniedIds,
    })
  })

  next.recalledMemorySources = context.recalledMemorySources.filter((source, index) => {
    const deniedMentions = findMentionedFacts(source.summary, policy.deniedFacts)
    const allowedMentions = findMentionedFacts(source.summary, policy.allowedFacts)
    const unclassified = policy.deniedFacts.length > 0
      && deniedMentions.length === 0
      && allowedMentions.length === 0
    if (deniedMentions.length === 0 && !unclassified) return true
    const deniedIds = deniedMentions.map((fact) => fact.fact.id)
    const unauthorizedIds = deniedIds.filter((id) => !authorizedRevealIds.has(id))
    const sourceKey = buildRecallVisibilitySourceKey(source, index)
    if (isDeterministicRecallSource(source) && source.required && (unauthorizedIds.length > 0 || unclassified)) {
      requiredMissingSourceKeys.push(sourceKey)
      unauthorizedIds.forEach((id) => requiredMissingFactIds.add(id))
    }
    decisions.push({
      sourceKey,
      channel: 'semantic_memory',
      included: false,
      reason: unclassified ? 'unclassified_visibility' : unauthorizedIds.length > 0 ? 'pov_forbidden_fact' : 'moved_to_reveal_instruction',
      factIds: deniedIds,
    })
    return false
  })

  if (context.authorStyleMaterials) {
    const authorStyleMaterials = { ...context.authorStyleMaterials }
    ;([
      ['targetWorkSampleGuide', 'authorStyle:guide'],
      ['humanStyleSampleLock', 'authorStyle:sampleLock'],
    ] as const).forEach(([field, sourceKey]) => {
      const text = authorStyleMaterials[field]
      const deniedMentions = findMentionedFacts(text, policy.deniedFacts)
      if (deniedMentions.length === 0) return
      authorStyleMaterials[field] = ''
      const deniedIds = deniedMentions.map((fact) => fact.fact.id)
      decisions.push({
        sourceKey,
        channel: 'writer_override',
        included: false,
        reason: deniedIds.some((id) => !authorizedRevealIds.has(id)) ? 'pov_forbidden_fact' : 'moved_to_reveal_instruction',
        factIds: deniedIds,
      })
    })
    next.authorStyleMaterials = authorStyleMaterials
  }

  const keptHardEntries = context.hardConstraintEntries.filter((entry) => {
    const deniedMentions = findMentionedFacts(entry.content, policy.deniedFacts)
    if (deniedMentions.length === 0) return true
    const deniedIds = deniedMentions.map((fact) => fact.fact.id)
    const unauthorizedIds = deniedIds.filter((id) => !authorizedRevealIds.has(id))
    if (unauthorizedIds.length > 0) {
      requiredMissingSourceKeys.push(`hard:${entry.label}`)
      unauthorizedIds.forEach((id) => requiredMissingFactIds.add(id))
    }
    decisions.push({
      sourceKey: `hard:${entry.label}`,
      channel: FIELD_CHANNELS[entry.label as keyof ChapterContextParts] || 'writer_override',
      included: false,
      reason: unauthorizedIds.length > 0 ? 'pov_forbidden_fact' : 'moved_to_reveal_instruction',
      factIds: deniedIds,
    })
    return false
  })
  if (keptHardEntries.length !== context.hardConstraintEntries.length) {
    next.hardConstraintEntries = keptHardEntries
    next.hardConstraintContext = keptHardEntries.map((entry) => `${entry.title}：${entry.content}`).join('\n')
    next.hardConstraintSummary = findMentionedFacts(next.hardConstraintSummary, policy.deniedFacts).length > 0
      ? '部分关键约束因视角边界被隔离；请查看来源 ID 诊断。'
      : next.hardConstraintSummary
  }

  const knownFactLines = policy.allowedFacts.slice(0, 8).map((fact) => `已知信息点 fact:${fact.fact.id}：${formatFact(fact)}`)
  if (knownFactLines.length > 0) {
    next.continuityNotes = [next.continuityNotes, ...knownFactLines].filter(Boolean).join('\n')
  }
  if (policy.revealDirectives.length > 0) {
    next.writingContractSummary = [
      next.writingContractSummary,
      '【场景限定揭示指令：不得提前到章首或其他 POV 场景】',
      ...policy.revealDirectives.map((directive) => directive.text),
    ].filter(Boolean).join('\n')
  }

  const sources = [
    ...policy.allowedFacts.map((fact) => toPackSource(fact, true, 'knowledge_boundary_allowed', policy.purpose)),
    ...policy.deniedFacts.map((fact) => toPackSource(fact, false, 'knowledge_boundary_denied', policy.purpose)),
    ...policy.revealDirectives.map((directive): ContextPackSource => ({
      key: `reveal:${directive.sceneId}:${directive.factId}`,
      sourceKind: 'reveal_instruction',
      sourceId: String(directive.factId),
      sourceVersion: String(policy.chapterNum),
      visibility: 'plan',
      text: directive.text,
      required: true,
      included: true,
      reason: 'confirmed_scene_contract_reveal',
      estimatedTokens: Math.max(1, Math.ceil(directive.text.length / 2)),
    })),
  ]
  next.visibilityReport = {
    purpose: policy.purpose,
    povCharacterIds: policy.povCharacterIds,
    unresolvedPovLabels: policy.unresolvedPovLabels,
    decisions,
    requiredMissingSourceKeys: [...new Set(requiredMissingSourceKeys)],
    requiredMissingFactIds: [...requiredMissingFactIds],
    sources,
  }
  return next
}

export function resolveContextReadPurpose(profile: ChapterContextPromptProfile): ContextReadPurpose {
  if (profile === 'review') return 'review'
  if (profile === 'scenePlan') return 'planner'
  return 'writer'
}

export function applyContextVisibility(
  rawData: ChapterContextRawData,
  context: ChapterContext,
  profile: ChapterContextPromptProfile,
): ChapterContext {
  const chapter = rawData.currentChapter
  if (!chapter?.id || !chapter.chapterNum || !rawData.contextVisibilityInput) return context
  const purpose = resolveContextReadPurpose(profile)
  const input = { ...rawData.contextVisibilityInput, purpose }
  return filterChapterContextByVisibility(context, buildContextVisibilityPolicy(input))
}
