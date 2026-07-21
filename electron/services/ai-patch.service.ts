import { eq } from 'drizzle-orm'
import type { AiPatchRequest, AiPatchResult, AiPatchTarget } from '../../src/types'
import type { GenreWorldRules } from '../../src/shared/genre-system'
import { cleanAiFieldText, cleanAiValue } from '../../src/utils/text'
import {
  WORLD_RULE_SECTION_DEFINITIONS,
  WORLD_RULE_SECTION_ORDER,
  type WorldRuleSectionKey,
} from '../../src/shared/world-rules-generation'
import { normalizeWorldRulesDraft, parseWorldRulesDraftJson } from '../../src/shared/world-rules-draft'
import { getDb } from '../database/db'
import { chapterSegments, chapters, novels } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { throwUserFacingError } from '../utils/user-facing-error'
import { runChatTask } from './task.service'
import { buildStoryProfile } from './context.service'
import { markNovelContextChanged } from './context-impact.service'
import { suggestCharacterPatch, applyCharacterPatch } from './character.service'
import { updateChapter } from './chapter.service'
import { updateChapterSegment } from './story-structure.service'
import { getRecommendedChapterWordsForOperatingMode } from '../../src/shared/operating-mode'

type PatchRecord = Record<string, unknown>

interface FieldSpec {
  label: string
  type: 'text' | 'number' | 'enum'
  enumValues?: string[]
}

const SECTION_LABELS = new Map(WORLD_RULE_SECTION_DEFINITIONS.map((item) => [item.key, item.label]))

const STRUCTURE_CHAPTER_FIELDS: Record<string, FieldSpec> = {
  title: { label: '章节标题', type: 'text' },
  outline: { label: '章节目标', type: 'text' },
  summary: { label: '章节摘要', type: 'text' },
  targetWords: { label: '目标字数', type: 'number' },
}

const STRUCTURE_SEGMENT_FIELDS: Record<string, FieldSpec> = {
  title: { label: '场景标题', type: 'text' },
  segmentType: { label: '场景类型', type: 'enum', enumValues: ['scene', 'bridge', 'turn', 'reveal', 'climax'] },
  purpose: { label: '场景作用', type: 'text' },
  timeAnchor: { label: '时间锚点', type: 'text' },
  locationName: { label: '地点', type: 'text' },
  inputState: { label: '进入状态', type: 'text' },
  outputState: { label: '离开状态', type: 'text' },
  summary: { label: '片段摘要', type: 'text' },
  content: { label: '场景正文', type: 'text' },
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value)
  return undefined
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  const text = asText(value)
  return text ? [text] : []
}

function asRecord(value: unknown): PatchRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PatchRecord : {}
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatPatchValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return compactJson(value)
}

function normalizePrimitivePatch(rawPatch: PatchRecord, fields: Record<string, FieldSpec>): PatchRecord {
  const sanitized = cleanAiValue(rawPatch)
  const patch: PatchRecord = {}

  Object.entries(fields).forEach(([field, spec]) => {
    if (!(field in sanitized)) return
    const rawValue = sanitized[field]
    if (rawValue == null) return

    if (spec.type === 'number') {
      const nextNumber = asNumber(rawValue)
      if (typeof nextNumber === 'number') patch[field] = Math.round(nextNumber)
      return
    }

    if (spec.type === 'enum') {
      const nextText = asText(rawValue)
      if (nextText && (!spec.enumValues || spec.enumValues.includes(nextText))) patch[field] = nextText
      return
    }

    patch[field] = asText(rawValue)
  })

  return patch
}

function buildPrimitiveChanges(
  current: PatchRecord,
  patch: PatchRecord,
  fields: Record<string, FieldSpec>,
): AiPatchResult['changedFields'] {
  return Object.entries(patch).reduce<AiPatchResult['changedFields']>((result, [field, value]) => {
    const spec = fields[field]
    if (!spec) return result
    const before = formatPatchValue(current[field])
    const after = formatPatchValue(value)
    if (before === after) return result
    result.push({ field, label: spec.label, before, after })
    return result
  }, [])
}

function extractPatchPayload(raw: string): { summary: string; patch: PatchRecord; warnings: string[] } {
  const parsed = cleanAiValue(safeParseJson<PatchRecord>(raw))
  const patch = parsed.patch && typeof parsed.patch === 'object' && !Array.isArray(parsed.patch)
    ? parsed.patch as PatchRecord
    : parsed
  return {
    summary: asText(parsed.summary),
    patch,
    warnings: toStringArray(parsed.warnings).slice(0, 6),
  }
}

function buildFieldList(fields: Record<string, FieldSpec>): string {
  return Object.entries(fields)
    .map(([key, spec]) => `- ${key}: ${spec.label}${spec.enumValues ? `，只能取 ${spec.enumValues.join(' / ')}` : ''}`)
    .join('\n')
}

function buildGenericPatchPrompt(params: {
  targetLabel: string
  allowedFields: string
  storyContext: string
  currentObject: PatchRecord
  instruction: string
  extraRules?: string[]
}): string {
  return [
    `你是小说资产的定向编辑器。当前目标：${params.targetLabel}。`,
    '',
    '硬性规则：',
    '- 只输出字段级 JSON 补丁，不要输出解释文本。',
    '- 只修改用户要求涉及的字段，不要整卡重写。',
    '- 没有必要变化的字段不要输出。',
    '- 字段值必须具体、可进入后续大纲/正文上下文，避免空泛标签和 AI 腔。',
    '- 输出必须是 JSON：{"summary":"本次修改摘要","patch":{...},"warnings":["可选风险"]}',
    ...(params.extraRules || []).map((rule) => `- ${rule}`),
    '',
    '允许 patch 字段：',
    params.allowedFields,
    '',
    '故事上下文：',
    params.storyContext || '暂无补充上下文。',
    '',
    '当前对象 JSON：',
    compactJson(params.currentObject),
    '',
    `用户修改要求：${params.instruction}`,
  ].join('\n')
}

function normalizeTarget(target: AiPatchTarget): AiPatchTarget {
  return {
    ...target,
    id: Number(target.id || 0),
    novelId: target.novelId == null ? undefined : Number(target.novelId),
  }
}

function requireInstruction(instruction: string): string {
  const trimmed = instruction.trim()
  if (!trimmed) throwUserFacingError('ipc.invalidNonEmptyString', { name: 'instruction' })
  return trimmed
}

function getNovel(novelId: number) {
  const novel = getDb().select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  return novel
}

async function buildStoryContext(novelId: number): Promise<string> {
  const profile = await buildStoryProfile(novelId)
  return [
    `小说：${profile.novelTitle}`,
    `题材：${profile.genre}`,
    profile.background ? `背景：${profile.background}` : '',
    profile.storyGoal ? `故事目标：${profile.storyGoal}` : '',
    profile.coreConflict ? `核心冲突：${profile.coreConflict}` : '',
    profile.worldRulesSummary ? `世界规则摘要：${profile.worldRulesSummary}` : '',
  ].filter(Boolean).join('\n')
}

function validateWorldRuleSection(value?: string): WorldRuleSectionKey {
  if (value && WORLD_RULE_SECTION_ORDER.includes(value as WorldRuleSectionKey)) {
    return value as WorldRuleSectionKey
  }
  throwUserFacingError('worldRules.targetSectionMissing')
}

function getWorldSectionPatchRoot(sectionKey: WorldRuleSectionKey): string[] {
  switch (sectionKey) {
    case 'overview': return ['genreProfile']
    case 'power': return ['powerSystems']
    case 'species': return ['speciesSystem', 'factionSystem']
    case 'ecology': return ['characterEcology']
    case 'map': return ['mapBlueprint']
    case 'dynamics': return ['worldDynamics']
    case 'timeline': return ['timelineConfig']
    case 'language': return ['writingConstraints']
    default: return []
  }
}

function pickWorldSection(rules: GenreWorldRules, sectionKey: WorldRuleSectionKey): PatchRecord {
  return getWorldSectionPatchRoot(sectionKey).reduce<PatchRecord>((result, key) => {
    result[key] = (rules as unknown as PatchRecord)[key]
    return result
  }, {})
}

function mergeWorldSection(
  currentRules: GenreWorldRules,
  sectionKey: WorldRuleSectionKey,
  patch: PatchRecord,
  genreName: string,
): GenreWorldRules {
  const roots = getWorldSectionPatchRoot(sectionKey)
  const next: PatchRecord = { ...(currentRules as unknown as PatchRecord) }

  roots.forEach((key) => {
    if (!(key in patch)) return
    const currentValue = next[key]
    const nextValue = patch[key]
    next[key] = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
      && nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)
      ? { ...(currentValue as PatchRecord), ...(nextValue as PatchRecord) }
      : nextValue
  })

  return normalizeWorldRulesDraft(next, genreName)
}

function buildWorldSectionChanges(
  currentRules: GenreWorldRules,
  nextRules: GenreWorldRules,
  sectionKey: WorldRuleSectionKey,
): AiPatchResult['changedFields'] {
  return getWorldSectionPatchRoot(sectionKey).reduce<AiPatchResult['changedFields']>((result, key) => {
    const before = formatPatchValue((currentRules as unknown as PatchRecord)[key])
    const after = formatPatchValue((nextRules as unknown as PatchRecord)[key])
    if (before === after) return result
    result.push({
      field: key,
      label: `${SECTION_LABELS.get(sectionKey) || sectionKey} / ${key}`,
      before,
      after,
    })
    return result
  }, [])
}

async function suggestWorldRulesSectionPatch(target: AiPatchTarget, instruction: string): Promise<AiPatchResult> {
  const novelId = Number(target.novelId || target.id)
  const sectionKey = validateWorldRuleSection(target.sectionKey)
  const novel = getNovel(novelId)
  const rules = parseWorldRulesDraftJson(novel.worldRulesJson, undefined)
  const storyContext = await buildStoryContext(novelId)
  const sectionLabel = SECTION_LABELS.get(sectionKey) || sectionKey
  const roots = getWorldSectionPatchRoot(sectionKey)

  const raw = await runChatTask({
    type: 'world_rules_generate',
    novelId,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    retryable: true,
    messages: [{
      role: 'user',
      content: buildGenericPatchPrompt({
        targetLabel: `世界规则分区：${sectionLabel}`,
        allowedFields: roots.map((key) => `- ${key}: 当前分区根字段`).join('\n'),
        storyContext,
        currentObject: pickWorldSection(rules, sectionKey),
        instruction,
        extraRules: ['只能改当前分区根字段，不要顺手改其他世界规则分区。'],
      }),
    }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = extractPatchPayload(raw)
  const patch = roots.reduce<PatchRecord>((result, key) => {
    if (key in parsed.patch) result[key] = parsed.patch[key]
    return result
  }, {})
  const nextRules = mergeWorldSection(rules, sectionKey, patch, rules.genreProfile.name || '')
  const changedFields = buildWorldSectionChanges(rules, nextRules, sectionKey)
  return {
    summary: parsed.summary || (changedFields.length > 0 ? `建议修改 ${sectionLabel}。` : '没有生成可应用修改。'),
    patch,
    changedFields,
    warnings: parsed.warnings,
    target: { type: 'world_rules_section', id: novelId, novelId, sectionKey },
  }
}

function applyWorldRulesSectionPatch(target: AiPatchTarget, patchInput: unknown) {
  const novelId = Number(target.novelId || target.id)
  const sectionKey = validateWorldRuleSection(target.sectionKey)
  const db = getDb()
  const novel = getNovel(novelId)
  const currentRules = parseWorldRulesDraftJson(novel.worldRulesJson, undefined)
  const roots = getWorldSectionPatchRoot(sectionKey)
  const rawPatch = asRecord(patchInput)
  const patch = roots.reduce<PatchRecord>((result, key) => {
    if (key in rawPatch) result[key] = rawPatch[key]
    return result
  }, {})
  const nextRules = mergeWorldSection(currentRules, sectionKey, patch, currentRules.genreProfile.name || '')
  db.update(novels).set({
    worldRulesJson: JSON.stringify(nextRules),
    updatedAt: new Date().toISOString(),
  }).where(eq(novels.id, novelId)).run()
  markNovelContextChanged(novelId, 'World rules changed')
  return db.select().from(novels).where(eq(novels.id, novelId)).all()[0] || null
}

async function suggestStructureChapterPatch(target: AiPatchTarget, instruction: string): Promise<AiPatchResult> {
  const db = getDb()
  const current = db.select().from(chapters).where(eq(chapters.id, target.id)).all()[0]
  if (!current) throwUserFacingError('chapter.notFound')
  const novel = getNovel(current.novelId)
  const storyContext = await buildStoryContext(current.novelId)
  const raw = await runChatTask({
    type: 'chapter_planner',
    novelId: current.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: current.id,
    retryable: true,
    messages: [{
      role: 'user',
      content: buildGenericPatchPrompt({
        targetLabel: `第 ${current.chapterNum} 章结构`,
        allowedFields: buildFieldList(STRUCTURE_CHAPTER_FIELDS),
        storyContext,
        currentObject: {
          title: current.title || '',
          outline: current.outline || '',
          summary: current.summary || '',
          targetWords: current.targetWords || getRecommendedChapterWordsForOperatingMode({ targetWords: novel.targetWords }),
        },
        instruction,
        extraRules: ['不要修改章节编号、所属卷部和正文 content。'],
      }),
    }],
    modelConfigId: novel.modelConfigId || undefined,
  })
  const parsed = extractPatchPayload(raw)
  const patch = normalizePrimitivePatch(parsed.patch, STRUCTURE_CHAPTER_FIELDS)
  const changedFields = buildPrimitiveChanges(current as unknown as PatchRecord, patch, STRUCTURE_CHAPTER_FIELDS)
  return {
    summary: parsed.summary || (changedFields.length > 0 ? `建议修改 ${changedFields.length} 个章节字段。` : '没有生成可应用修改。'),
    patch,
    changedFields,
    warnings: parsed.warnings,
    target: { type: 'structure_chapter', id: current.id, novelId: current.novelId },
  }
}

function applyStructureChapterPatch(target: AiPatchTarget, patchInput: unknown) {
  const db = getDb()
  const current = db.select().from(chapters).where(eq(chapters.id, target.id)).all()[0]
  if (!current) throwUserFacingError('chapter.notFound')
  const patch = normalizePrimitivePatch(asRecord(patchInput), STRUCTURE_CHAPTER_FIELDS)
  if (Object.keys(patch).length > 0) {
    updateChapter(current.id, patch, { versionSource: false })
    markNovelContextChanged(current.novelId, 'Story structure changed')
  }
  return db.select().from(chapters).where(eq(chapters.id, current.id)).all()[0] || null
}

async function suggestStructureSegmentPatch(target: AiPatchTarget, instruction: string): Promise<AiPatchResult> {
  const db = getDb()
  const current = db.select().from(chapterSegments).where(eq(chapterSegments.id, target.id)).all()[0]
  if (!current) throwUserFacingError('segment.notFound')
  const chapter = db.select().from(chapters).where(eq(chapters.id, current.chapterId)).all()[0]
  const novel = getNovel(current.novelId)
  const storyContext = await buildStoryContext(current.novelId)
  const raw = await runChatTask({
    type: 'chapter_planner',
    novelId: current.novelId,
    relatedEntityType: 'segment',
    relatedEntityId: current.id,
    retryable: true,
    messages: [{
      role: 'user',
      content: buildGenericPatchPrompt({
        targetLabel: `第 ${chapter?.chapterNum || '?'} 章 / 场景 ${current.segmentOrder}`,
        allowedFields: buildFieldList(STRUCTURE_SEGMENT_FIELDS),
        storyContext: [
          storyContext,
          chapter ? `章节目标：${chapter.outline || chapter.title || ''}` : '',
        ].filter(Boolean).join('\n'),
        currentObject: {
          title: current.title || '',
          segmentType: current.segmentType || 'scene',
          purpose: current.purpose || '',
          timeAnchor: current.timeAnchor || '',
          locationName: current.locationName || '',
          inputState: current.inputState || '',
          outputState: current.outputState || '',
          summary: current.summary || '',
          content: current.content || '',
        },
        instruction,
        extraRules: ['场景正文如非用户明确要求，不要输出 content 字段。'],
      }),
    }],
    modelConfigId: novel.modelConfigId || undefined,
  })
  const parsed = extractPatchPayload(raw)
  const patch = normalizePrimitivePatch(parsed.patch, STRUCTURE_SEGMENT_FIELDS)
  const changedFields = buildPrimitiveChanges(current as unknown as PatchRecord, patch, STRUCTURE_SEGMENT_FIELDS)
  return {
    summary: parsed.summary || (changedFields.length > 0 ? `建议修改 ${changedFields.length} 个场景字段。` : '没有生成可应用修改。'),
    patch,
    changedFields,
    warnings: parsed.warnings,
    target: { type: 'structure_segment', id: current.id, novelId: current.novelId },
  }
}

function applyStructureSegmentPatch(target: AiPatchTarget, patchInput: unknown) {
  const db = getDb()
  const current = db.select().from(chapterSegments).where(eq(chapterSegments.id, target.id)).all()[0]
  if (!current) throwUserFacingError('segment.notFound')
  const patch = normalizePrimitivePatch(asRecord(patchInput), STRUCTURE_SEGMENT_FIELDS)
  if (Object.keys(patch).length > 0) updateChapterSegment(current.id, patch)
  return db.select().from(chapterSegments).where(eq(chapterSegments.id, current.id)).all()[0] || null
}

export async function suggestAiPatch(request: AiPatchRequest): Promise<AiPatchResult> {
  const target = normalizeTarget(request.target)
  const instruction = requireInstruction(request.instruction)
  switch (target.type) {
    case 'character':
      return suggestCharacterPatch(target.id, instruction)
    case 'world_rules_section':
      return suggestWorldRulesSectionPatch(target, instruction)
    case 'structure_chapter':
      return suggestStructureChapterPatch(target, instruction)
    case 'structure_segment':
      return suggestStructureSegmentPatch(target, instruction)
    default:
      throwUserFacingError('ipc.invalidNonEmptyString', { name: 'target.type' })
  }
}

export function applyAiPatch(targetInput: AiPatchTarget, patch: unknown): unknown {
  const target = normalizeTarget(targetInput)
  switch (target.type) {
    case 'character':
      return applyCharacterPatch(target.id, patch)
    case 'world_rules_section':
      return applyWorldRulesSectionPatch(target, patch)
    case 'structure_chapter':
      return applyStructureChapterPatch(target, patch)
    case 'structure_segment':
      return applyStructureSegmentPatch(target, patch)
    default:
      throwUserFacingError('ipc.invalidNonEmptyString', { name: 'target.type' })
  }
}
