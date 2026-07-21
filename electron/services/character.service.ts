import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapters, characters, characterRelations, novels, storyItems, timelineEvents } from '../database/schema'
import type { CharacterAiPatchResult, CharacterBatchGenerationOptions } from '../../src/types'
import { safeParseJson, salvageAiJsonArrayItems } from '../utils/json'
import { buildStoryProfile } from './context.service'
import {
  buildCharacterEcologySummary,
  getFactionNameOptions,
  getSpeciesNameOptions,
  parseWorldRulesJson,
  buildMapBlueprintSummary,
} from '../../src/shared/genre-system'
import {
  batchCharacterPrompt,
  characterRelationsPrompt,
  protagonistPrompt,
  regenerateCharacterPrompt,
} from './prompts'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { buildCharacterRelationSummaryLine, normalizeCharacterRelationLevel } from '../../src/shared/character-relations'
import { recordAssetChangeEvent } from './asset-impact.service'
import { markNovelContextChanged } from './context-impact.service'
import {
  runAssetQualityLoop,
  summarizeAssetQualityWarnings,
  type AssetQualityLoopResult,
} from './asset-quality.service'
import {
  resolveFactionNamesFromReferences,
  stringifyFactionReferences,
} from './faction-reference.service'
import { cleanupCharacterSoftReferences } from './data-cascade.service'
import { refreshWorldStateVersionsForNovel } from './world-state.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import { buildVariationDigest, isRejectedDigestTooSimilar } from './variation-control.service'
import { repairItemCharacterLinks } from './item.service'

const BATCH_CHARACTER_QUALITY_BUDGET_MS = 90_000
const BATCH_CHARACTER_MAX_REWRITE_PASSES = 0

// 单张人物卡解析：本地修复失败后再按“文本中的对象”打捞一次；
// 仍失败则落盘完整 payload 供诊断并返回 null，让调用方走重试循环而不是中断。
function parseCharacterCardWithFallback(raw: string, source: string): Record<string, unknown> | null {
  try {
    return cleanAiValue(safeParseJson<Record<string, unknown>>(raw))
  } catch (error) {
    const salvaged = salvageAiJsonArrayItems<Record<string, unknown>>(raw)
    const candidate = salvaged.find((item) => typeof item.full_name === 'string' || typeof item.name === 'string')
    if (candidate) {
      console.warn(`[character] 人物卡整体解析失败（${source}），已按对象打捞恢复`)
      return cleanAiValue(candidate)
    }
    console.error(
      `[character] 人物卡 JSON 解析失败（${source}）：${error instanceof Error ? error.message : error}\n--- payload start ---\n${String(raw || '').slice(0, 4000)}\n--- payload end ---`,
    )
    return null
  }
}

// 引导顺序是地图 -> 物品 -> 人物：物品先落库时只能弱绑定，
// 人物批量落库后自动做一次物品-人物链接回填。失败不阻断人物生成。
function runItemCharacterLinkRepair(novelId: number) {
  try {
    const repair = repairItemCharacterLinks(novelId)
    if (repair.itemsLinked > 0 || repair.ownersAssigned > 0) {
      console.info(
        `[character] 物品-人物链接修复：关联 ${repair.itemsLinked} 件物品，回填归属 ${repair.ownersAssigned} 件`,
      )
    }
  } catch (error) {
    console.warn('[character] 物品-人物链接修复失败（不影响人物生成）:', error instanceof Error ? error.message : error)
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))
      ? Number(value)
      : undefined
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanAiStringArray(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))
  }

  const text = asText(value)
  if (!text) return []
  return cleanAiStringArray(text.split(/[\n,，、]/))
}

function parseJsonArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return toStringArray(parsed)
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function stringifyNumberArray(values: number[]): string {
  return JSON.stringify([...new Set(values.filter((item) => Number.isFinite(item)))])
}

function normalizeLookup(input: string): string {
  return input.trim().replace(/\s+/g, '').toLowerCase()
}

function normalizeRecordStatus(value: unknown): 'draft' | 'confirmed' {
  return asText(value) === 'draft' ? 'draft' : 'confirmed'
}

function parseAppearanceDescription(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.description === 'string'
      ? parsed.description.trim()
      : ''
  } catch {
    return ''
  }
}

function inferEntityType(species: string): string {
  if (!species || species === '人类' || species === '幸存者' || species === '人族' || species === '人族修士') {
    return 'human'
  }
  if (/(丧尸|感染者|尸鬼|亡灵)/u.test(species)) return 'undead'
  if (/(兽|狼|虎|狐|熊|龙|灵兽|魔兽)/u.test(species)) return 'beast'
  if (/(精灵|异族|妖|魔|鬼)/u.test(species)) return 'nonhuman'
  if (/(仙|神)/u.test(species)) return 'immortal'
  return 'nonhuman'
}

function jsonStringifyArray(value: string[]): string {
  return JSON.stringify(cleanAiStringArray(value))
}

function stringifyFactionReferenceInput(novelId: number, input: unknown): string {
  return novelId > 0 ? stringifyFactionReferences(novelId, input) : jsonStringifyArray(toStringArray(input))
}

function resolveFactionJson(novelId: number, raw?: string | null): string | undefined {
  const names = novelId > 0
    ? resolveFactionNamesFromReferences(novelId, raw)
    : parseJsonArray(raw)
  return names.length > 0 ? JSON.stringify(names) : undefined
}

function roleOrder(roleType?: string | null): number {
  const priority = ['protagonist', 'major', 'antagonist', 'supporting', 'minor']
  const index = priority.indexOf(roleType || 'minor')
  return index === -1 ? priority.length : index
}

export type GeneratedCharacterRole = 'protagonist' | 'major' | 'minor' | 'antagonist' | 'supporting'

function normalizeRoleType(value: string): GeneratedCharacterRole {
  if (value === 'protagonist' || value === 'major' || value === 'antagonist' || value === 'supporting') return value
  return 'minor'
}

function buildRoleQueue(opts: {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
}): GeneratedCharacterRole[] {
  return [
    ...Array.from({ length: Math.max(0, opts.majorCount) }, () => 'major' as const),
    ...Array.from({ length: Math.max(0, opts.antagonistCount || 0) }, () => 'antagonist' as const),
    ...Array.from({ length: Math.max(0, opts.supportingCount || 0) }, () => 'supporting' as const),
    ...Array.from({ length: Math.max(0, opts.minorCount) }, () => 'minor' as const),
  ]
}

function countRoleQueue(queue: GeneratedCharacterRole[]) {
  return {
    protagonistCount: queue.filter((role) => role === 'protagonist').length,
    majorCount: queue.filter((role) => role === 'major').length,
    antagonistCount: queue.filter((role) => role === 'antagonist').length,
    supportingCount: queue.filter((role) => role === 'supporting').length,
    minorCount: queue.filter((role) => role === 'minor').length,
  }
}

export interface CharacterBatchChunkResult {
  ids: number[]
  taskId?: number
  draftCharacters?: CharacterDraftPayload[]
  qualityReview?: Omit<AssetQualityLoopResult, 'finalOutput'>
  protagonistGenerated?: number
  majorGenerated: number
  minorGenerated: number
  antagonistGenerated: number
  supportingGenerated: number
  batchDigest?: string
  warning?: string
}

export type CharacterDraftPayload = Partial<typeof characters.$inferInsert> & {
  fullName: string
  roleType: string
  recordStatus: 'draft'
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return [
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.endgameDesignSummary,
    profile.writingRulesSummary,
  ].filter(Boolean).join('\n\n')
}

function buildOptionSummary(label: string, values: string[]): string {
  return values.length > 0 ? `${label}：${values.join('、')}` : ''
}

function buildItemResourceSummary(rows: Array<typeof storyItems.$inferSelect>): string {
  return rows
    .filter((item) => item.itemKind === 'instance')
    .slice(0, 12)
    .map((item) => {
      const parts = [item.category, item.ownerCharacterId ? '已绑定人物' : '', item.summary || item.plotFunction || '']
        .filter(Boolean)
        .slice(0, 3)
      return `- ${item.itemName}${parts.length > 0 ? `：${parts.join('；')}` : ''}`
    })
    .join('\n')
}

function buildRoleBlueprintSummary(opts: {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
  helperRoles?: string[]
}): string {
  return [
    `主要人物 ${opts.majorCount} 位`,
    `对立角色 ${opts.antagonistCount || 0} 位`,
    `功能角色 ${opts.supportingCount || 0} 位`,
    `次要人物 ${opts.minorCount} 位`,
    opts.helperRoles && opts.helperRoles.length > 0 ? `优先功能位：${opts.helperRoles.join('、')}` : '',
  ].filter(Boolean).join('；')
}

function buildExistingCharacterDigest(rows: Array<typeof characters.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((character) => buildCharacterSummary(character))
    .join('\n')
}

function buildCharacterSummary(character: typeof characters.$inferSelect): string {
  const traits = parseJsonArray(character.personalityTraitsJson).slice(0, 3).join('、')
  const flaws = parseJsonArray(character.flawsJson).slice(0, 2).join('、')
  const parts = [
    character.entityType ? `实体：${character.entityType}` : '',
    character.species ? `种族：${character.species}` : '',
    character.occupation ? `身份：${character.occupation}` : '',
    character.rankLevel ? `等级：${character.rankLevel}` : '',
    character.socialIdentity ? `社会身份：${character.socialIdentity}` : '',
    character.background ? `经历：${character.background.slice(0, 60)}` : '',
    traits ? `特点：${traits}` : '',
    flaws ? `缺陷：${flaws}` : '',
    character.goals ? `追求：${character.goals}` : '',
    character.dramaticEngine ? `戏剧引擎：${character.dramaticEngine}` : '',
    character.innerConflict ? `矛盾：${character.innerConflict}` : '',
    character.relationshipTension ? `关系张力：${character.relationshipTension}` : '',
    character.resonancePoint ? `共鸣点：${character.resonancePoint}` : '',
  ].filter(Boolean)

  return `- ${character.fullName}（${character.roleType || 'minor'}）：${parts.join('；') || '暂无补充'}`
}

function buildCurrentProfileSummary(character: typeof characters.$inferSelect): string {
  const traits = parseJsonArray(character.personalityTraitsJson).join('、')
  const flaws = parseJsonArray(character.flawsJson).join('、')
  const habits = parseJsonArray(character.habitsJson).join('、')
  const factions = resolveFactionNamesFromReferences(character.novelId, character.campFactionIdsJson).join('、')
  const powerSystems = parseJsonArray(character.powerSystemRefsJson).join('、')
  const contextHooks = parseJsonArray(character.contextHooksJson).join('、')
  return [
    `姓名：${character.fullName}`,
    `角色类型：${character.roleType || 'minor'}`,
    character.entityType ? `实体类型：${character.entityType}` : '',
    character.species ? `种族：${character.species}` : '',
    character.gender ? `性别：${character.gender}` : '',
    character.age ? `年龄：${character.age}` : '',
    character.occupation ? `职业/身份：${character.occupation}` : '',
    character.rankLevel ? `等级/境界：${character.rankLevel}` : '',
    character.socialIdentity ? `社会身份：${character.socialIdentity}` : '',
    factions ? `所属势力：${factions}` : '',
    powerSystems ? `适用体系：${powerSystems}` : '',
    contextHooks ? `上下文钩子：${contextHooks}` : '',
    character.background ? `背景经历：${character.background}` : '',
    traits ? `性格特点：${traits}` : '',
    flaws ? `性格缺陷：${flaws}` : '',
    habits ? `习惯/口头禅：${habits}` : '',
    character.goals ? `核心追求：${character.goals}` : '',
    character.surfaceDesire ? `表层欲望：${character.surfaceDesire}` : '',
    character.deepNeed ? `深层需要：${character.deepNeed}` : '',
    character.coreFear ? `核心恐惧：${character.coreFear}` : '',
    character.innerConflict ? `内在矛盾：${character.innerConflict}` : '',
    character.hiddenSecret ? `隐藏秘密：${character.hiddenSecret}` : '',
    character.moralLine ? `道德底线：${character.moralLine}` : '',
    character.selfDeception ? `自我欺骗：${character.selfDeception}` : '',
    character.trauma ? `旧伤/创伤：${character.trauma}` : '',
    character.contradiction ? `反差点：${character.contradiction}` : '',
    character.relationshipTension ? `关系张力：${character.relationshipTension}` : '',
    character.resonancePoint ? `共鸣点：${character.resonancePoint}` : '',
    character.dramaticEngine ? `戏剧引擎（贯穿全书、解释其每场戏选择）：${character.dramaticEngine}` : '',
    character.characterArc ? `人物弧光：${character.characterArc}` : '',
    character.firstImpression ? `初次印象：${character.firstImpression}` : '',
    parseAppearanceDescription(character.appearanceJson) ? `外貌描述：${parseAppearanceDescription(character.appearanceJson)}` : '',
  ].filter(Boolean).join('\n')
}

const CHARACTER_PATCH_FIELD_LABELS = {
  entityType: '实体类型',
  species: '种类/物种',
  gender: '性别',
  age: '年龄',
  occupation: '职业/身份',
  rankLevel: '等级/职级',
  socialIdentity: '社会位置',
  background: '背景经历',
  campFactionIdsJson: '所属势力',
  powerSystemRefsJson: '关联体系',
  contextHooksJson: '主线挂点',
  goals: '当前目标',
  firstImpression: '第一印象',
  surfaceDesire: '表层欲望',
  deepNeed: '深层需要',
  coreFear: '核心恐惧',
  innerConflict: '内在矛盾',
  hiddenSecret: '隐藏秘密',
  moralLine: '道德底线',
  selfDeception: '自我欺骗',
  trauma: '旧伤/创伤',
  contradiction: '反差点',
  relationshipTension: '关系张力',
  resonancePoint: '读者共情点',
  dramaticEngine: '戏剧引擎',
  characterArc: '后续弧光',
  speechPattern: '说话方式',
  catchphrases: '口头禅',
  vocabularyLevel: '用词层级',
  dialectFeatures: '方言/口癖',
  appearanceJson: '可识别外貌',
  abilitiesJson: '能力/技能',
  appearChapter: '登场章节',
} as const

type CharacterPatchField = keyof typeof CHARACTER_PATCH_FIELD_LABELS

const CHARACTER_PATCH_FIELDS = new Set<CharacterPatchField>(Object.keys(CHARACTER_PATCH_FIELD_LABELS) as CharacterPatchField[])

function formatPatchValue(field: CharacterPatchField, value: unknown): string {
  if (value == null) return ''
  if (field === 'campFactionIdsJson') return resolveFactionNamesFromReferences(0, typeof value === 'string' ? value : JSON.stringify(value)).join('、')
  if (field === 'powerSystemRefsJson' || field === 'contextHooksJson') {
    return (typeof value === 'string' ? parseJsonArray(value) : toStringArray(value)).join('、')
  }
  if (field === 'appearanceJson') return typeof value === 'string' ? parseAppearanceDescription(value) : asText((value as Record<string, unknown>)?.description)
  if (field === 'abilitiesJson') return typeof value === 'string' ? value : JSON.stringify(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function normalizePatchJsonField(field: CharacterPatchField, value: unknown, novelId: number): unknown {
  if (field === 'campFactionIdsJson') return stringifyFactionReferenceInput(novelId, value)
  if (field === 'powerSystemRefsJson' || field === 'contextHooksJson') return jsonStringifyArray(toStringArray(value))
  if (field === 'appearanceJson') {
    const description = typeof value === 'string'
      ? value
      : asText((value as Record<string, unknown>)?.description)
    return JSON.stringify({ description })
  }
  return value
}

function normalizeCharacterPatch(
  current: typeof characters.$inferSelect,
  rawPatch: Record<string, unknown>,
): Partial<typeof characters.$inferInsert> {
  const sanitized = cleanAiValue(rawPatch)
  const patch: Partial<typeof characters.$inferInsert> = {}
  ;(Object.keys(sanitized) as CharacterPatchField[]).forEach((field) => {
    if (!CHARACTER_PATCH_FIELDS.has(field)) return
    const rawValue = sanitized[field]
    if (rawValue == null) return
    if (field === 'age' || field === 'appearChapter') {
      const nextNumber = asNumber(rawValue)
      if (typeof nextNumber === 'number') {
        ;(patch as Record<string, unknown>)[field] = nextNumber
      }
      return
    }
    if (field === 'campFactionIdsJson' || field === 'powerSystemRefsJson' || field === 'contextHooksJson' || field === 'appearanceJson') {
      ;(patch as Record<string, unknown>)[field] = normalizePatchJsonField(field, rawValue, current.novelId)
      return
    }
    if (field === 'abilitiesJson') {
      ;(patch as Record<string, unknown>)[field] = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue)
      return
    }
    ;(patch as Record<string, unknown>)[field] = asText(rawValue)
  })
  return patch
}

function buildCharacterPatchChanges(
  current: typeof characters.$inferSelect,
  patch: Partial<typeof characters.$inferInsert>,
): CharacterAiPatchResult['changedFields'] {
  return (Object.keys(patch) as CharacterPatchField[]).reduce<CharacterAiPatchResult['changedFields']>((result, field) => {
    if (!CHARACTER_PATCH_FIELDS.has(field)) return result
    const before = formatPatchValue(field, (current as Record<string, unknown>)[field])
    const after = formatPatchValue(field, (patch as Record<string, unknown>)[field])
    if (before === after) return result
    result.push({
      field: field as CharacterAiPatchResult['changedFields'][number]['field'],
      label: CHARACTER_PATCH_FIELD_LABELS[field],
      before,
      after,
    })
    return result
  }, [])
}

function buildCharacterPatchPrompt(params: {
  novelTitle: string
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  current: typeof characters.$inferSelect
  currentProfile: string
  relationSummary: string
  itemSummary: string
  recentEvidence?: string
  instruction: string
}): string {
  return [
    '你是一个小说人物设定编辑器。用户会给出自然语言修改要求，你只输出字段级 JSON 补丁。',
    '',
    '硬性规则：',
    '- 只修改用户要求涉及的字段，不要整卡重写。',
    '- 不要修改姓名 fullName、角色类型 roleType、novelId、id、sortOrder、createdAt、updatedAt。',
    '- 没有必要变化的字段不要输出。',
    '- 字段值必须具体、可进入正文上下文，避免空泛标签和 AI 腔。',
    '- 输出必须是 JSON：{"summary":"本次修改摘要","patch":{...},"warnings":["可选风险"]}',
    '',
    '允许 patch 字段：',
    Object.entries(CHARACTER_PATCH_FIELD_LABELS).map(([key, label]) => `- ${key}: ${label}`).join('\n'),
    '',
    `小说：${params.novelTitle}`,
    `题材：${params.profile.genre}`,
    params.profile.background ? `背景：${params.profile.background}` : '',
    params.profile.storyGoal ? `故事目标：${params.profile.storyGoal}` : '',
    params.profile.coreConflict ? `核心冲突：${params.profile.coreConflict}` : '',
    params.profile.worldRulesSummary ? `世界规则：\n${params.profile.worldRulesSummary}` : '',
    params.relationSummary ? `人物关系：\n${params.relationSummary}` : '',
    params.itemSummary ? `关联资源：\n${params.itemSummary}` : '',
    params.recentEvidence ? `最近正文证据：\n${params.recentEvidence}` : '',
    '',
    `当前人物：${params.current.fullName}（${params.current.roleType || 'minor'}）`,
    params.currentProfile,
    '',
    `用户修改要求：${params.instruction}`,
  ].filter(Boolean).join('\n')
}

function buildRecentCharacterEvidence(novelId: number, character: typeof characters.$inferSelect): string {
  const db = getDb()
  const aliases = new Set([character.fullName])
  try {
    const sourceContext = JSON.parse(character.sourceContextJson || '{}') as Record<string, unknown>
    for (const key of ['aliases', 'aliasTerms']) {
      const values = sourceContext[key]
      if (Array.isArray(values)) {
        values.filter((value): value is string => typeof value === 'string' && value.trim().length > 1)
          .forEach((value) => aliases.add(value.trim()))
      }
    }
  } catch {
    // Historical character cards may contain non-JSON source context.
  }
  const evidenceTerms = [...aliases]
  const rows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => {
      const haystack = [chapter.title, chapter.summary, chapter.outline, chapter.content]
        .filter(Boolean)
        .join(' ')
      return evidenceTerms.some((term) => haystack.includes(term))
    })
    .slice(-6)

  return rows.map((chapter) => {
    const content = (chapter.content || '').replace(/\s+/gu, ' ').trim()
    const evidence = chapter.summary || chapter.outline || content.slice(0, 360)
    return `第${chapter.chapterNum}章《${chapter.title || '未命名'}》：${evidence.slice(0, 420)}`
  }).join('\n')
}

function buildCharacterReviewContext(params: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  worldSummary?: string
  protagonistSummary?: string
  existingCharacterSummaries?: string
  relationSummary?: string
  itemSummary?: string
  extraLines?: string[]
}): string {
  return [
    `题材：${params.profile.genre}`,
    params.profile.background ? `背景摘要：${params.profile.background}` : '',
    params.worldSummary ? `世界规则：${params.worldSummary}` : '',
    buildStoryCoreSummary(params.profile) ? `故事核心：\n${buildStoryCoreSummary(params.profile)}` : '',
    params.protagonistSummary ? `主角参考：\n${params.protagonistSummary}` : '',
    params.existingCharacterSummaries ? `现有人物：\n${params.existingCharacterSummaries}` : '',
    params.relationSummary ? `关系摘要：\n${params.relationSummary}` : '',
    params.itemSummary ? `相关资源：\n${params.itemSummary}` : '',
    ...(params.extraLines || []).filter(Boolean),
  ].filter(Boolean).join('\n\n')
}

function characterSchemaHint(expectedCount?: number): string {
  return [
    typeof expectedCount === 'number'
      ? `输出应保持为 ${expectedCount} 个角色对象组成的 JSON 数组。`
      : '输出应保持为单个角色 JSON 对象。',
    '不要改动字段语义，不要把人物卡重写成散文。',
    '姓名、角色定位、背景、目标、矛盾、关系张力等关键字段必须保留。',
  ].join('\n')
}

function buildCharacterPayload(
  parsed: Record<string, unknown>,
  fallback: {
    novelId?: number
    roleType?: string
    fullName?: string
    existing?: typeof characters.$inferSelect | null
    recordStatus?: 'draft' | 'confirmed'
    sourceContextJson?: string
  } = {},
): Partial<typeof characters.$inferInsert> {
  const sanitized = cleanAiValue(parsed)
  const appearance = asText(sanitized.appearance) || parseAppearanceDescription(fallback.existing?.appearanceJson)
  const fullName = asText(sanitized.full_name) || asText(sanitized.name) || fallback.fullName || fallback.existing?.fullName || '未命名角色'
  const roleType = asText(sanitized.role_type) || fallback.roleType || fallback.existing?.roleType || 'minor'
  const personalityTraits = toStringArray(sanitized.personality_traits).length > 0
    ? toStringArray(sanitized.personality_traits)
    : toStringArray(sanitized.personality_keywords).length > 0
      ? toStringArray(sanitized.personality_keywords)
      : toStringArray(sanitized.personality).length > 0
        ? toStringArray(sanitized.personality)
        : parseJsonArray(fallback.existing?.personalityTraitsJson)
  const flaws = toStringArray(sanitized.flaws).length > 0
    ? toStringArray(sanitized.flaws)
    : parseJsonArray(fallback.existing?.flawsJson)
  const habits = toStringArray(sanitized.habits).length > 0
    ? toStringArray(sanitized.habits)
    : parseJsonArray(fallback.existing?.habitsJson)
  const species = asText(sanitized.species) || fallback.existing?.species || ''
  const entityType = asText(sanitized.entity_type) || fallback.existing?.entityType || inferEntityType(species)
  const factionNovelId = fallback.existing?.novelId ?? fallback.novelId ?? 0
  const factionNames = toStringArray(sanitized.faction_names).length > 0
    ? toStringArray(sanitized.faction_names)
    : toStringArray(sanitized.factions).length > 0
      ? toStringArray(sanitized.factions)
      : resolveFactionNamesFromReferences(factionNovelId, fallback.existing?.campFactionIdsJson)
  const powerSystemNames = toStringArray(sanitized.power_system_names).length > 0
    ? toStringArray(sanitized.power_system_names)
    : toStringArray(sanitized.power_system_refs).length > 0
      ? toStringArray(sanitized.power_system_refs)
      : parseJsonArray(fallback.existing?.powerSystemRefsJson)
  const contextHooks = toStringArray(sanitized.context_hooks).length > 0
    ? toStringArray(sanitized.context_hooks)
    : parseJsonArray(fallback.existing?.contextHooksJson)
  const recordStatus = Object.prototype.hasOwnProperty.call(sanitized, 'record_status')
    ? normalizeRecordStatus(sanitized.record_status)
    : fallback.recordStatus || fallback.existing?.recordStatus || 'confirmed'
  const sourceContextJson = asText(sanitized.source_context_json) || fallback.sourceContextJson || fallback.existing?.sourceContextJson || ''

  return {
    roleType,
    recordStatus,
    entityType,
    species,
    surname: asText(sanitized.surname) || fallback.existing?.surname || '',
    givenName: asText(sanitized.given_name) || fallback.existing?.givenName || '',
    fullName,
    gender: asText(sanitized.gender) || fallback.existing?.gender || '',
    age: asNumber(sanitized.age) ?? fallback.existing?.age,
    birthplace: asText(sanitized.birthplace) || fallback.existing?.birthplace || '',
    occupation: asText(sanitized.occupation) || fallback.existing?.occupation || '',
    rankLevel: asText(sanitized.rank_level) || fallback.existing?.rankLevel || '',
    socialIdentity: asText(sanitized.social_identity) || fallback.existing?.socialIdentity || '',
    background: asText(sanitized.background) || fallback.existing?.background || '',
    personalityTraitsJson: jsonStringifyArray(personalityTraits),
    flawsJson: jsonStringifyArray(flaws),
    habitsJson: jsonStringifyArray(habits),
    campFactionIdsJson: stringifyFactionReferenceInput(factionNovelId, factionNames),
    powerSystemRefsJson: jsonStringifyArray(powerSystemNames),
    contextHooksJson: jsonStringifyArray(contextHooks),
    goals: asText(sanitized.goals) || fallback.existing?.goals || '',
    firstImpression: asText(sanitized.first_impression) || fallback.existing?.firstImpression || '',
    surfaceDesire: asText(sanitized.surface_desire) || fallback.existing?.surfaceDesire || '',
    deepNeed: asText(sanitized.deep_need) || fallback.existing?.deepNeed || '',
    coreFear: asText(sanitized.core_fear) || fallback.existing?.coreFear || '',
    innerConflict: asText(sanitized.inner_conflict) || fallback.existing?.innerConflict || '',
    hiddenSecret: asText(sanitized.hidden_secret) || fallback.existing?.hiddenSecret || '',
    moralLine: asText(sanitized.moral_line) || fallback.existing?.moralLine || '',
    selfDeception: asText(sanitized.self_deception) || fallback.existing?.selfDeception || '',
    trauma: asText(sanitized.trauma) || fallback.existing?.trauma || '',
    contradiction: asText(sanitized.contradiction) || fallback.existing?.contradiction || '',
    relationshipTension: asText(sanitized.relationship_tension) || fallback.existing?.relationshipTension || asText(sanitized.relation_to_protagonist) || '',
    resonancePoint: asText(sanitized.resonance_point) || fallback.existing?.resonancePoint || '',
    dramaticEngine: asText(sanitized.dramatic_engine) || fallback.existing?.dramaticEngine || '',
    characterArc: asText(sanitized.character_arc) || fallback.existing?.characterArc || '',
    appearanceJson: JSON.stringify({ description: appearance }),
    sourceContextJson,
    appearChapter: asNumber(sanitized.appear_chapter) ?? fallback.existing?.appearChapter,
  }
}

interface CharacterQueryFilters {
  novelId: number
  roleType?: typeof characters.$inferSelect['roleType']
  recordStatus?: 'draft' | 'confirmed' | 'all'
  entityType?: string
  species?: string
  keyword?: string
  page?: number
  pageSize?: number
}

interface CharacterGraphFilters {
  novelId: number
  characterIds?: number[]
  focusCharacterId?: number
  roleTypes?: Array<typeof characters.$inferSelect['roleType']>
  relationTypes?: string[]
  factionNames?: string[]
  recordStatus?: 'draft' | 'confirmed' | 'all'
  limit?: number
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 24) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function mapCharacterEntity(row: typeof characters.$inferSelect) {
  return {
    ...row,
    campFactionIdsJson: resolveFactionJson(row.novelId, row.campFactionIdsJson) ?? null,
  }
}

function mapCharacterRecord(row: Record<string, unknown>) {
  const novelId = Number(row.novel_id)
  return {
    id: Number(row.id),
    novelId,
    roleType: String(row.role_type || 'minor') as typeof characters.$inferSelect['roleType'],
    recordStatus: normalizeRecordStatus(row.record_status),
    entityType: typeof row.entity_type === 'string' ? row.entity_type : undefined,
    species: typeof row.species === 'string' ? row.species : undefined,
    surname: typeof row.surname === 'string' ? row.surname : undefined,
    givenName: typeof row.given_name === 'string' ? row.given_name : undefined,
    fullName: String(row.full_name || ''),
    gender: typeof row.gender === 'string' ? row.gender : undefined,
    age: row.age == null ? undefined : Number(row.age),
    birthplace: typeof row.birthplace === 'string' ? row.birthplace : undefined,
    occupation: typeof row.occupation === 'string' ? row.occupation : undefined,
    rankLevel: typeof row.rank_level === 'string' ? row.rank_level : undefined,
    socialIdentity: typeof row.social_identity === 'string' ? row.social_identity : undefined,
    background: typeof row.background === 'string' ? row.background : undefined,
    personalityTraitsJson: typeof row.personality_traits_json === 'string' ? row.personality_traits_json : undefined,
    flawsJson: typeof row.flaws_json === 'string' ? row.flaws_json : undefined,
    habitsJson: typeof row.habits_json === 'string' ? row.habits_json : undefined,
    campFactionIdsJson: resolveFactionJson(novelId, typeof row.camp_faction_ids_json === 'string' ? row.camp_faction_ids_json : undefined),
    powerSystemRefsJson: typeof row.power_system_refs_json === 'string' ? row.power_system_refs_json : undefined,
    contextHooksJson: typeof row.context_hooks_json === 'string' ? row.context_hooks_json : undefined,
    goals: typeof row.goals === 'string' ? row.goals : undefined,
    firstImpression: typeof row.first_impression === 'string' ? row.first_impression : undefined,
    surfaceDesire: typeof row.surface_desire === 'string' ? row.surface_desire : undefined,
    deepNeed: typeof row.deep_need === 'string' ? row.deep_need : undefined,
    coreFear: typeof row.core_fear === 'string' ? row.core_fear : undefined,
    innerConflict: typeof row.inner_conflict === 'string' ? row.inner_conflict : undefined,
    hiddenSecret: typeof row.hidden_secret === 'string' ? row.hidden_secret : undefined,
    moralLine: typeof row.moral_line === 'string' ? row.moral_line : undefined,
    selfDeception: typeof row.self_deception === 'string' ? row.self_deception : undefined,
    trauma: typeof row.trauma === 'string' ? row.trauma : undefined,
    contradiction: typeof row.contradiction === 'string' ? row.contradiction : undefined,
    relationshipTension: typeof row.relationship_tension === 'string' ? row.relationship_tension : undefined,
    resonancePoint: typeof row.resonance_point === 'string' ? row.resonance_point : undefined,
    dramaticEngine: typeof row.dramatic_engine === 'string' ? row.dramatic_engine : undefined,
    characterArc: typeof row.character_arc === 'string' ? row.character_arc : undefined,
    appearanceJson: typeof row.appearance_json === 'string' ? row.appearance_json : undefined,
    abilitiesJson: typeof row.abilities_json === 'string' ? row.abilities_json : undefined,
    sourceContextJson: typeof row.source_context_json === 'string' ? row.source_context_json : undefined,
    appearChapter: row.appear_chapter == null ? undefined : Number(row.appear_chapter),
    sortOrder: Number(row.sort_order || 0),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

function mapRelationRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    charAId: Number(row.char_a_id),
    charBId: Number(row.char_b_id),
    relationType: typeof row.relation_type === "string" ? row.relation_type : undefined,
    relationLabel: typeof row.relation_label === "string" ? row.relation_label : undefined,
    bilateral: Number(row.bilateral || 0),
    description: typeof row.description === "string" ? row.description : undefined,
    intimacyLevel: normalizeCharacterRelationLevel(row.intimacy_level),
    tensionLevel: normalizeCharacterRelationLevel(row.tension_level),
    interactionStyle: typeof row.interaction_style === "string" ? row.interaction_style : undefined,
    subtextRule: typeof row.subtext_rule === "string" ? row.subtext_rule : undefined,
  }
}

function mapStoryItemRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    itemKind: String(row.item_kind || 'instance') as 'template' | 'instance',
    parentItemId: row.parent_item_id == null ? undefined : Number(row.parent_item_id),
    itemName: String(row.item_name || ''),
    genreFamily: typeof row.genre_family === 'string' ? row.genre_family : undefined,
    category: typeof row.category === 'string' ? row.category : undefined,
    subType: typeof row.sub_type === 'string' ? row.sub_type : undefined,
    rarity: typeof row.rarity === 'string' ? row.rarity : undefined,
    recordStatus: normalizeRecordStatus(row.record_status),
    ownerCharacterId: row.owner_character_id == null ? undefined : Number(row.owner_character_id),
    locationMapId: row.location_map_id == null ? undefined : Number(row.location_map_id),
    status: String(row.status || 'available') as 'available' | 'consumed' | 'hidden' | 'destroyed',
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    acquisitionMethod: typeof row.acquisition_method === 'string' ? row.acquisition_method : undefined,
    usageMethod: typeof row.usage_method === 'string' ? row.usage_method : undefined,
    cost: typeof row.cost === 'string' ? row.cost : undefined,
    risk: typeof row.risk === 'string' ? row.risk : undefined,
    plotFunction: typeof row.plot_function === 'string' ? row.plot_function : undefined,
    appearance: typeof row.appearance === 'string' ? row.appearance : undefined,
    factionHint: typeof row.faction_hint === 'string' ? row.faction_hint : undefined,
    linkedCharacterIdsJson: typeof row.linked_character_ids_json === 'string' ? row.linked_character_ids_json : undefined,
    linkedTimelineEventIdsJson: typeof row.linked_timeline_event_ids_json === 'string' ? row.linked_timeline_event_ids_json : undefined,
    tagsJson: typeof row.tags_json === 'string' ? row.tags_json : undefined,
    sourceContextJson: typeof row.source_context_json === 'string' ? row.source_context_json : undefined,
    sortOrder: Number(row.sort_order || 0),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

function buildCharacterWhere(filters: CharacterQueryFilters) {
  const whereClauses = ['c.novel_id = ?']
  const params: Array<number | string> = [filters.novelId]

  if (filters.roleType) {
    whereClauses.push('c.role_type = ?')
    params.push(filters.roleType)
  }

  if (filters.recordStatus && filters.recordStatus !== 'all') {
    whereClauses.push("COALESCE(c.record_status, 'confirmed') = ?")
    params.push(filters.recordStatus)
  }

  if (filters.entityType) {
    whereClauses.push('c.entity_type = ?')
    params.push(filters.entityType)
  }

  if (filters.species) {
    whereClauses.push('c.species = ?')
    params.push(filters.species)
  }

  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
  if (keyword) {
    const like = `%${keyword}%`
    whereClauses.push(`
      (
        c.full_name LIKE ?
        OR COALESCE(c.species, '') LIKE ?
        OR COALESCE(c.occupation, '') LIKE ?
        OR COALESCE(c.rank_level, '') LIKE ?
        OR COALESCE(c.goals, '') LIKE ?
        OR COALESCE(c.inner_conflict, '') LIKE ?
        OR COALESCE(c.background, '') LIKE ?
      )
    `)
    params.push(like, like, like, like, like, like, like)
  }

  return {
    whereSql: whereClauses.join(' AND '),
    params,
  }
}

function uniqueNumberArray(values: number[]) {
  return [...new Set(values.filter((value) => Number.isFinite(value)))]
}

export function queryCharacters(filters: CharacterQueryFilters) {
  const sqlite = getSqlite()
  const paging = normalizePaging(filters.page, filters.pageSize, 24)
  const query = buildCharacterWhere(filters)
  const countRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM characters c
    WHERE ${query.whereSql}
  `).get(...query.params) as { total?: number } | undefined

  const rows = sqlite.prepare(`
    SELECT c.*
    FROM characters c
    WHERE ${query.whereSql}
    ORDER BY
      CASE c.role_type
        WHEN 'protagonist' THEN 0
        WHEN 'major' THEN 1
        WHEN 'antagonist' THEN 2
        WHEN 'supporting' THEN 3
        ELSE 4
      END ASC,
      c.sort_order ASC,
      c.id ASC
    LIMIT ? OFFSET ?
  `).all(...query.params, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map(mapCharacterRecord)
  return buildPagedResult(items, paging.page, paging.pageSize, Number(countRow?.total || 0))
}

export function getCharacterStats(filters: CharacterQueryFilters) {
  const sqlite = getSqlite()
  const query = buildCharacterWhere(filters)
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS confirmedCount,
      SUM(CASE WHEN COALESCE(c.record_status, 'confirmed') = 'draft' THEN 1 ELSE 0 END) AS draftCount,
      SUM(CASE WHEN c.role_type = 'protagonist' AND COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS protagonistCount,
      SUM(CASE WHEN c.role_type = 'major' AND COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS majorCount,
      SUM(CASE WHEN c.role_type = 'antagonist' AND COALESCE(c.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS antagonistCount,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(c.species, '')), '')) AS speciesCount
    FROM characters c
    WHERE ${query.whereSql}
  `).get(...query.params) as Record<string, unknown> | undefined

  const relationRow = sqlite.prepare(`
    SELECT COUNT(*) AS relationCount
    FROM character_relations r
    WHERE r.novel_id = ?
      AND (
        r.char_a_id IN (SELECT c.id FROM characters c WHERE ${query.whereSql})
        OR r.char_b_id IN (SELECT c.id FROM characters c WHERE ${query.whereSql})
      )
  `).get(filters.novelId, ...query.params, ...query.params) as Record<string, unknown> | undefined

  return {
    total: Number(row?.total || 0),
    confirmedCount: Number(row?.confirmedCount || 0),
    draftCount: Number(row?.draftCount || 0),
    protagonistCount: Number(row?.protagonistCount || 0),
    majorCount: Number(row?.majorCount || 0),
    antagonistCount: Number(row?.antagonistCount || 0),
    relationCount: Number(relationRow?.relationCount || 0),
    speciesCount: Number(row?.speciesCount || 0),
  }
}

export function getCharacterFilterOptions(novelId: number) {
  const sqlite = getSqlite()
  const speciesRows = sqlite.prepare(`
    SELECT DISTINCT species
    FROM characters
    WHERE novel_id = ?
      AND species IS NOT NULL
      AND TRIM(species) <> ''
    ORDER BY species ASC
  `).all(novelId) as Array<{ species?: string | null }>
  const entityRows = sqlite.prepare(`
    SELECT DISTINCT entity_type
    FROM characters
    WHERE novel_id = ?
      AND entity_type IS NOT NULL
      AND TRIM(entity_type) <> ''
    ORDER BY entity_type ASC
  `).all(novelId) as Array<{ entity_type?: string | null }>

  return {
    species: speciesRows
      .map((row) => (typeof row.species === 'string' ? row.species.trim() : ''))
      .filter(Boolean),
    entityTypes: entityRows
      .map((row) => (typeof row.entity_type === 'string' ? row.entity_type.trim() : ''))
      .filter(Boolean),
  }
}

export function searchCharacters(novelId: number, keyword = '', limit = 20) {
  return queryCharacters({
    novelId,
    keyword,
    page: 1,
    pageSize: Math.max(1, Math.min(limit, 50)),
  }).items
}

function characterMatchesGraphFilters(
  row: Record<string, unknown>,
  filters: CharacterGraphFilters,
): boolean {
  const roleType = String(row.role_type || 'minor')
  const recordStatus = normalizeRecordStatus(row.record_status)
  if (filters.recordStatus && filters.recordStatus !== 'all' && recordStatus !== filters.recordStatus) return false
  if (filters.roleTypes && filters.roleTypes.length > 0 && !filters.roleTypes.includes(roleType as typeof characters.$inferSelect['roleType'])) return false
  if (filters.factionNames && filters.factionNames.length > 0) {
    const factionNames = resolveFactionNamesFromReferences(filters.novelId, typeof row.camp_faction_ids_json === 'string' ? row.camp_faction_ids_json : '')
    if (!filters.factionNames.some((name) => factionNames.includes(name))) return false
  }
  return true
}

export function getCharacterGraph(filters: CharacterGraphFilters) {
  const sqlite = getSqlite()
  const relationWindowLimit = Math.max(12, Math.min(filters.limit || 24, 80))
  const requestedSeedIds = uniqueNumberArray([
    ...(filters.characterIds || []),
    ...(typeof filters.focusCharacterId === 'number' ? [filters.focusCharacterId] : []),
  ])

  const allRows = sqlite.prepare(`
    SELECT *
    FROM characters
    WHERE novel_id = ?
    ORDER BY
      CASE role_type
        WHEN 'protagonist' THEN 0
        WHEN 'major' THEN 1
        WHEN 'antagonist' THEN 2
        WHEN 'supporting' THEN 3
        ELSE 4
      END ASC,
      sort_order ASC,
      id ASC
  `).all(filters.novelId) as Array<Record<string, unknown>>

  const filteredRows = allRows.filter((row) => characterMatchesGraphFilters(row, filters))
  let visibleIds = requestedSeedIds.length > 0
    ? requestedSeedIds.filter((id) => filteredRows.some((row) => Number(row.id) === id))
    : filteredRows.slice(0, relationWindowLimit).map((row) => Number(row.id))

  if (typeof filters.focusCharacterId === 'number' && visibleIds.includes(filters.focusCharacterId)) {
    const focusRelations = sqlite.prepare(`
      SELECT *
      FROM character_relations
      WHERE novel_id = ?
        AND (char_a_id = ? OR char_b_id = ?)
      ORDER BY id ASC
      LIMIT ?
    `).all(filters.novelId, filters.focusCharacterId, filters.focusCharacterId, relationWindowLimit) as Array<Record<string, unknown>>

    const neighborIds = uniqueNumberArray(focusRelations.flatMap((row) => {
      const charAId = Number(row.char_a_id)
      const charBId = Number(row.char_b_id)
      return charAId === filters.focusCharacterId ? [charBId] : [charAId]
    })).filter((id) => filteredRows.some((item) => Number(item.id) === id))
    visibleIds = uniqueNumberArray([...visibleIds, ...neighborIds])
  }

  if (visibleIds.length === 0) {
    return { characters: [], relations: [] }
  }

  const characterRows = filteredRows.filter((row) => visibleIds.includes(Number(row.id)))

  const graphCharacterIds = characterRows.map((row) => Number(row.id))
  if (graphCharacterIds.length === 0) {
    return { characters: [], relations: [] }
  }

  const graphPlaceholders = graphCharacterIds.map(() => '?').join(', ')
  const relationRows = sqlite.prepare(`
    SELECT *
    FROM character_relations
    WHERE novel_id = ?
      AND char_a_id IN (${graphPlaceholders})
      AND char_b_id IN (${graphPlaceholders})
    ORDER BY id ASC
    LIMIT ?
  `).all(filters.novelId, ...graphCharacterIds, ...graphCharacterIds, relationWindowLimit * 4) as Array<Record<string, unknown>>

  const filteredRelations = relationRows.filter((row) => {
    if (!filters.relationTypes || filters.relationTypes.length === 0) return true
    const relationType = typeof row.relation_type === 'string' ? row.relation_type : ''
    return filters.relationTypes.includes(relationType)
  })

  return {
    characters: characterRows.map(mapCharacterRecord),
    relations: filteredRelations.map(mapRelationRecord),
  }
}

export function getCharacterDetailContext(characterId: number) {
  const current = getCharacter(characterId)
  if (!current) {
    return {
      relatedItems: [],
      relatedCharacters: [],
      relatedRelations: [],
    }
  }

  const sqlite = getSqlite()
  const relationRows = sqlite.prepare(`
    SELECT *
    FROM character_relations
    WHERE novel_id = ?
      AND (char_a_id = ? OR char_b_id = ?)
    ORDER BY id ASC
    LIMIT 32
  `).all(current.novelId, characterId, characterId) as Array<Record<string, unknown>>
  const relatedRelations = relationRows.map(mapRelationRecord)
  const relatedIds = uniqueNumberArray(relatedRelations.flatMap((relation) => (
    relation.charAId === characterId ? [relation.charBId] : [relation.charAId]
  )))

  const relatedCharacters = relatedIds.length > 0
    ? sqlite.prepare(`
      SELECT *
      FROM characters
      WHERE novel_id = ?
        AND id IN (${relatedIds.map(() => '?').join(', ')})
      ORDER BY
        CASE role_type
          WHEN 'protagonist' THEN 0
          WHEN 'major' THEN 1
          WHEN 'antagonist' THEN 2
          WHEN 'supporting' THEN 3
          ELSE 4
        END ASC,
        sort_order ASC,
        id ASC
    `).all(current.novelId, ...relatedIds).map((row) => mapCharacterRecord(row as Record<string, unknown>))
    : []

  const singlePattern = `[${characterId}]`
  const prefixPattern = `[${characterId},%`
  const middlePattern = `%,${characterId},%`
  const suffixPattern = `%,${characterId}]`
  const itemRows = sqlite.prepare(`
    SELECT *
    FROM story_items
    WHERE novel_id = ?
      AND item_kind = 'instance'
      AND (
        owner_character_id = ?
        OR linked_character_ids_json = ?
        OR linked_character_ids_json LIKE ?
        OR linked_character_ids_json LIKE ?
        OR linked_character_ids_json LIKE ?
      )
    ORDER BY sort_order ASC, id ASC
    LIMIT 24
  `).all(current.novelId, characterId, singlePattern, prefixPattern, middlePattern, suffixPattern) as Array<Record<string, unknown>>

  return {
    relatedItems: itemRows.map(mapStoryItemRecord),
    relatedCharacters,
    relatedRelations,
  }
}

export function listCharacters(novelId: number) {
  const db = getDb()
  return db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
    .map(mapCharacterEntity)
}

export function getCharacter(id: number) {
  const db = getDb()
  const row = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  return row ? mapCharacterEntity(row) : null
}

export function createCharacter(
  novelId: number,
  data: Partial<typeof characters.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const normalizedData = {
    ...data,
    ...(Object.prototype.hasOwnProperty.call(data, 'campFactionIdsJson')
      ? { campFactionIdsJson: stringifyFactionReferenceInput(novelId, data.campFactionIdsJson) }
      : {}),
  }
  const result = db.insert(characters).values({
    novelId,
    fullName: normalizedData.fullName || '未命名角色',
    recordStatus: normalizeRecordStatus(normalizedData.recordStatus),
    ...normalizedData,
  }).run()
  const id = Number(result.lastInsertRowid)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Character profiles changed')
    refreshWorldStateVersionsForNovel(novelId)
    recordAssetChangeEvent({
      novelId,
      assetType: 'character',
      assetId: id,
      assetLabel: normalizedData.fullName || '未命名角色',
      operation: 'create',
      changeReason: 'Character profiles changed',
      impactLevel: 'medium',
      triggeredBy: 'character.service',
      payload: normalizedData,
    })
  }
  return id
}

export function updateCharacter(
  id: number,
  data: Partial<typeof characters.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  const normalizedData = {
    ...data,
    ...(current && Object.prototype.hasOwnProperty.call(data, 'campFactionIdsJson')
      ? { campFactionIdsJson: stringifyFactionReferenceInput(current.novelId, data.campFactionIdsJson) }
      : {}),
  }
  db.update(characters).set({
    ...normalizedData,
    ...(normalizedData.recordStatus ? { recordStatus: normalizeRecordStatus(normalizedData.recordStatus) } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(characters.id, id)).run()
  if (!options.skipContextTracking) {
    if (current) {
      markNovelContextChanged(current.novelId, 'Character profiles changed')
      refreshWorldStateVersionsForNovel(current.novelId)
      recordAssetChangeEvent({
        novelId: current.novelId,
        assetType: 'character',
        assetId: id,
        assetLabel: normalizedData.fullName || current.fullName,
        operation: 'update',
        changeReason: 'Character profiles changed',
        impactLevel: 'medium',
        triggeredBy: 'character.service',
        payload: normalizedData,
      })
    }
  }
}

export function deleteCharacter(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  getSqlite().transaction(() => {
    if (current) {
      cleanupCharacterSoftReferences(current.novelId, id)
    }
    db.delete(characters).where(eq(characters.id, id)).run()
  })()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Character profiles changed')
    refreshWorldStateVersionsForNovel(current.novelId)
    recordAssetChangeEvent({
      novelId: current.novelId,
      assetType: 'character',
      assetId: id,
      assetLabel: current.fullName,
      operation: 'delete',
      changeReason: 'Character profiles changed',
      impactLevel: 'medium',
      triggeredBy: 'character.service',
    })
  }
}

export function clearCharactersByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()

  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  itemRows.forEach((item) => {
    db.update(storyItems).set({
      ownerCharacterId: null,
      linkedCharacterIdsJson: stringifyNumberArray([]),
      updatedAt: new Date().toISOString(),
    }).where(eq(storyItems.id, item.id)).run()
  })

  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  eventRows.forEach((event) => {
    const presentIds = parseNumberArray(event.presentCharacterIdsJson)
    const affectedIds = parseNumberArray(event.affectedCharacterIdsJson)
    if (presentIds.length === 0 && affectedIds.length === 0 && !event.protagonistAction) return
    db.update(timelineEvents).set({
      presentCharacterIdsJson: stringifyNumberArray([]),
      affectedCharacterIdsJson: stringifyNumberArray([]),
      protagonistAction: event.protagonistAction || null,
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })

  db.delete(characterRelations).where(eq(characterRelations.novelId, novelId)).run()
  db.delete(characters).where(eq(characters.novelId, novelId)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Character profiles changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
}

export function getCharacterRelations(novelId: number) {
  const db = getDb()
  return db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
}

export function upsertRelation(data: {
  novelId: number
  charAId: number
  charBId: number
  relationType: string
  relationLabel?: string
  description?: string
  bilateral?: number
  intimacyLevel?: number
  tensionLevel?: number
  interactionStyle?: string
  subtextRule?: string
}, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const existing = getCharacterRelations(data.novelId).find((relation) => {
    const sameDirection = relation.charAId === data.charAId && relation.charBId === data.charBId
    const reverseDirection = relation.charAId === data.charBId && relation.charBId === data.charAId
    return sameDirection || reverseDirection
  })

  const payload = {
    ...data,
    relationLabel: data.relationLabel?.trim() || null,
    description: data.description?.trim() || null,
    bilateral: data.bilateral ? 1 : 0,
    intimacyLevel: normalizeCharacterRelationLevel(data.intimacyLevel) ?? null,
    tensionLevel: normalizeCharacterRelationLevel(data.tensionLevel) ?? null,
    interactionStyle: data.interactionStyle?.trim() || null,
    subtextRule: data.subtextRule?.trim() || null,
  }

  if (existing) {
    db.update(characterRelations).set(payload).where(eq(characterRelations.id, existing.id)).run()
  } else {
    db.insert(characterRelations).values(payload).run()
  }

  if (!options.skipContextTracking) {
    markNovelContextChanged(data.novelId, "Character relations changed")
    refreshWorldStateVersionsForNovel(data.novelId)
  }
}

function hasReservedCharacterName(name: string, reservedNames: string[]) {
  const normalized = normalizeLookup(name)
  if (!normalized) return false
  return reservedNames.some((item) => normalizeLookup(item) === normalized)
}

export async function generateProtagonist(novelId: number, opts: {
  gender?: string
  surnameHint?: string
  ageRange?: string
  species?: string
  occupationHint?: string
  factionHint?: string
  itemPreferences?: string[]
  personalitySeed?: string
  forbiddenNames?: string[]
  forceDifferentFromExisting?: boolean
}): Promise<number> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const reservedNames = [...new Set([
    ...existingChars.map((character) => character.fullName).filter(Boolean),
    ...(opts.forbiddenNames || []).filter(Boolean),
  ])]
  const existingCharacterSummaries = buildExistingCharacterDigest(existingChars)
  const itemSummary = buildItemResourceSummary(itemRows)
  const historyEntityType = 'character'
  const historyTaskType = 'character_protagonist'

  let parsed: Record<string, unknown> | null = null
  const attempts = opts.forceDifferentFromExisting ? 3 : 2
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const prompt = protagonistPrompt({
      novelTitle: novel.title,
      novelSynopsis: profile.background,
      genre: profile.genre,
      worldSummary: profile.worldRulesSummary,
      storyCore: buildStoryCoreSummary(profile),
      speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
      factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
      ecologySummary: buildCharacterEcologySummary(rules),
      mapSummary: buildMapBlueprintSummary(rules),
      writingConstraints: rules.writingConstraints.extraRules.join('；'),
      gender: opts.gender || '不限',
      surnameHint: opts.surnameHint,
      ageRange: opts.ageRange,
      speciesPreference: opts.species,
      occupationHint: opts.occupationHint,
      factionHint: opts.factionHint,
      itemPreferences: opts.itemPreferences?.join('、'),
      personalitySeed: opts.personalitySeed,
      forbiddenNames: reservedNames.join('、'),
      forceDifferentFromExisting: opts.forceDifferentFromExisting,
      attemptNumber,
      rejectedDigests,
    })

    let acceptedCandidate: Record<string, unknown> | null = null
    let rejectedByQuality = false
    const result = await runChatTask({
      type: 'character_gen',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
      onSuccess: async (rawOutput, taskId) => {
        const quality = await runAssetQualityLoop({
          targetType: 'character',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          contextSummary: buildCharacterReviewContext({
            profile,
            worldSummary: profile.worldRulesSummary,
            protagonistSummary: '这是主角卡，请重点检查主角能否成立为全书最稳定的视角锚点。',
            existingCharacterSummaries,
            itemSummary,
            extraLines: [
              opts.itemPreferences && opts.itemPreferences.length > 0 ? `偏好线索：${opts.itemPreferences.join('、')}` : '',
            ],
          }),
          generatedOutput: rawOutput,
          schemaHint: characterSchemaHint(),
          reviewFocus: [
            '主角不能像万能模板人设，要有具体欲望、代价和内在矛盾。',
            '主角描述要能直接进入正文上下文，不要停留在空泛标签。',
          ],
          rewriteConstraints: [
            '保持单个角色 JSON 对象结构稳定。',
            '不要替换人物姓名，除非原输出根本没有可用姓名。',
          ],
        })
        if (quality.stage === 'rejected') {
          rejectedByQuality = true
          return quality
        }
        acceptedCandidate = parseCharacterCardWithFallback(quality.finalOutput, 'protagonist-quality')
        return quality
      },
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)

    if (rejectedByQuality) {
      markRejected(historyId)
      continue
    }

    const nextParsed = acceptedCandidate || parseCharacterCardWithFallback(result, 'protagonist-raw')
    if (!nextParsed) {
      // 单对象解析失败走循环重试（新一次生成），不让异常终止整个主角生成。
      markRejected(historyId)
      continue
    }
    const candidateDigest = buildVariationDigest(JSON.stringify(nextParsed))
    if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
      markRejected(historyId)
      continue
    }
    const candidateName = asText(nextParsed.full_name) || asText(nextParsed.name)
    if (!hasReservedCharacterName(candidateName, reservedNames)) {
      parsed = nextParsed
      break
    }
    markRejected(historyId)
  }

  if (!parsed) {
    throwUserFacingError('character.protagonistNoUsableCandidate')
  }

  const payload = buildCharacterPayload(parsed, {
    novelId,
    roleType: 'protagonist',
    recordStatus: 'confirmed',
  })
  payload.contextHooksJson = jsonStringifyArray([
    ...parseJsonArray(payload.contextHooksJson as string | undefined),
    ...(opts.itemPreferences || []).map((item) => `${item}线索`),
  ])
  if (!payload.background && itemRows.length > 0) {
    payload.background = `与 ${itemRows.slice(0, 2).map((item) => item.itemName).join('、')} 等关键资源存在潜在关联。`
  }
  const charId = createCharacter(novelId, payload, {
    skipContextTracking: true,
  })
  markNovelContextChanged(novelId, 'Character profiles changed')
  refreshWorldStateVersionsForNovel(novelId)
  return charId
}

export async function generateCharacterBatchChunk(
  novelId: number,
  opts: CharacterBatchGenerationOptions,
  runtime: {
    parentTaskId?: number
    sender?: WebContents
    batchIndex?: number
    totalBatches?: number
    commit?: boolean
    roleQueue?: GeneratedCharacterRole[]
  } = {},
): Promise<CharacterBatchChunkResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const reservedNames = existingChars.map((character) => character.fullName).filter(Boolean)
  const protagonist = existingChars.find((character) => character.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : '主角未设定'
  const existingCharacterSummaries = buildExistingCharacterDigest(existingChars)
  const itemSummary = buildItemResourceSummary(itemRows)
  const fullRoleQueue = runtime.roleQueue && runtime.roleQueue.length > 0
    ? runtime.roleQueue
    : buildRoleQueue(opts)
  const batchSize = Math.max(1, Math.min(opts.batchSize || fullRoleQueue.length || 1, fullRoleQueue.length || 1))
  const roleQueue = fullRoleQueue.slice(0, batchSize)
  const totalCount = roleQueue.length
  if (totalCount <= 0) {
    return {
      ids: [],
      majorGenerated: 0,
      minorGenerated: 0,
      antagonistGenerated: 0,
      supportingGenerated: 0,
    }
  }
  const chunkCounts = countRoleQueue(roleQueue)
  const chunkOptions = {
    ...opts,
    ...chunkCounts,
    batchSize,
  }
  const roleBlueprint = buildRoleBlueprintSummary(chunkOptions)

  const specialRequirements = [
    chunkOptions.specialRequirements,
    `本批角色配额：主要人物 ${chunkOptions.majorCount}，反派 ${chunkOptions.antagonistCount || 0}，功能角色 ${chunkOptions.supportingCount || 0}，次要人物 ${chunkOptions.minorCount}。`,
    chunkCounts.protagonistCount > 0 ? `本批还必须生成 ${chunkCounts.protagonistCount} 位主角/POV 锚点，role_type 必须为 protagonist。` : '',
    runtime.roleQueue && runtime.roleQueue.length > 0 ? `角色对象顺序必须严格对应：${roleQueue.join(' -> ')}。` : '',
    fullRoleQueue.length > roleQueue.length ? `全量剩余配额仍有 ${fullRoleQueue.length} 位，本批只生成 ${roleQueue.length} 位，后续批次继续补齐。` : '',
    chunkOptions.preferredSpecies && chunkOptions.preferredSpecies.length > 0 ? `优先种族或实体：${chunkOptions.preferredSpecies.join('、')}。` : '',
    chunkOptions.factionBias && chunkOptions.factionBias.length > 0 ? `优先势力来源：${chunkOptions.factionBias.join('、')}。` : '',
    chunkOptions.helperRoles && chunkOptions.helperRoles.length > 0 ? `优先补齐这些角色功能位：${chunkOptions.helperRoles.join('、')}。` : '',
    itemSummary ? `优先与这些现有物品/资源发生绑定：\n${itemSummary}` : '',
    '角色必须和题材、背景、地图结构、势力关系与主线冲突直接相关。',
  ].filter(Boolean).join('\n')
  const reviewContext = buildCharacterReviewContext({
    profile,
    worldSummary: profile.worldRulesSummary,
    protagonistSummary,
    existingCharacterSummaries,
    itemSummary,
    extraLines: [
      roleBlueprint ? `角色蓝图：${roleBlueprint}` : '',
      specialRequirements ? `额外要求：${specialRequirements}` : '',
    ],
  })
  const historyEntityType = 'character'
  const historyTaskType = 'character_batch'
  const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
  const prompt = batchCharacterPrompt({
    novelTitle: novel.title,
    novelSynopsis: profile.background,
    protagonistSummary,
    existingNames: reservedNames.join('、'),
    existingCharacterSummaries,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
    storyCore: buildStoryCoreSummary(profile),
    speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
    factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
    ecologySummary: buildCharacterEcologySummary(rules),
    mapSummary: buildMapBlueprintSummary(rules),
    writingConstraints: rules.writingConstraints.extraRules.join('；'),
    count: totalCount,
    genderRatio: opts.genderRatio || '不限',
    specialRequirements,
    roleBlueprint,
    relationSeedMode: opts.relationSeedMode,
    requiredItemLinks: opts.requiredItemLinks?.join('、'),
    diversityConstraints: opts.diversityConstraints?.join('、'),
    attemptNumber,
    rejectedDigests,
  })
  const messages = [{ role: 'user' as const, content: prompt }]
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'character_gen',
    novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson,
    runnerType: 'chat',
    parentTaskId: runtime.parentTaskId,
  })

  if (typeof runtime.parentTaskId === 'number') {
    updateTask(runtime.parentTaskId, { currentChildTaskId: taskId })
  }

  let resultPayload: CharacterBatchChunkResult | null = null

  try {
    await executeChatTask(taskId, {
      type: 'character_gen',
      novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: novelId,
      inputJson,
      messages,
      sender: runtime.sender,
      onSuccess: async (result) => {
        const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
        const quality = await runAssetQualityLoop({
          targetType: 'character',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender: runtime.sender,
          contextSummary: reviewContext,
          generatedOutput: result,
          schemaHint: characterSchemaHint(totalCount),
          reviewFocus: [
            '角色描述必须具体，避免只剩标签、履历和模板化设定句。',
            '每个角色都要和主线冲突、背景环境或关键资源形成可落笔的关系。',
          ],
          rewriteConstraints: [
            '保持角色数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把批量人物卡改写成说明文。',
          ],
          qualityBudgetMs: BATCH_CHARACTER_QUALITY_BUDGET_MS,
          maxRewritePasses: BATCH_CHARACTER_MAX_REWRITE_PASSES,
        })
        if (quality.stage === 'rejected') {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            taskId,
            qualityReview: {
              stage: quality.stage,
              review: quality.review,
              rewrittenReview: quality.rewrittenReview,
              warnings: quality.warnings,
            },
            majorGenerated: 0,
            minorGenerated: 0,
            antagonistGenerated: 0,
            supportingGenerated: 0,
            warning: summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批人物被审校拒收。`,
          }
          return resultPayload
        }

        let parsed: Array<Record<string, unknown>>
        try {
          parsed = cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(quality.finalOutput))
        } catch (error) {
          // 整体解析失败先逐对象打捞；一个成员字段损坏不应废掉整批人物。
          const salvaged = cleanAiValue(salvageAiJsonArrayItems<Record<string, unknown>>(quality.finalOutput))
          if (salvaged.length === 0) {
            markRejected(historyId)
            console.error('批量人物 JSON 解析失败且无可打捞成员:', error)
            resultPayload = {
              ids: [],
              majorGenerated: 0,
              minorGenerated: 0,
              antagonistGenerated: 0,
              supportingGenerated: 0,
              warning: `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批人物 JSON 解析失败，已跳过：${error instanceof Error ? error.message.slice(0, 160) : '未知错误'}`,
            }
            return resultPayload
          }
          console.warn(`[character] 批量人物 JSON 整体解析失败，逐对象打捞成功 ${salvaged.length} 个成员`)
          parsed = salvaged
        }
        const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
        if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            majorGenerated: 0,
            minorGenerated: 0,
            antagonistGenerated: 0,
            supportingGenerated: 0,
            warning: `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批人物与近期拒绝结果过于相近，已自动跳过。`,
          }
          return resultPayload
        }

        const createdIds: number[] = []
        const preparedDrafts: CharacterDraftPayload[] = []
        const createdNames: string[] = []
        let protagonistGenerated = 0
        let majorGenerated = 0
        let minorGenerated = 0
        let antagonistGenerated = 0
        let supportingGenerated = 0

        for (const char of parsed) {
          const fallbackRole = roleQueue[preparedDrafts.length] || 'minor'
          const assignedRole = runtime.roleQueue && runtime.roleQueue.length > 0
            ? fallbackRole
            : normalizeRoleType(asText(char.role_type) || fallbackRole)
          const payload = buildCharacterPayload(char, {
            novelId,
            roleType: assignedRole,
            recordStatus: runtime.commit === false ? 'draft' : 'confirmed',
          })
          const candidateName = typeof payload.fullName === 'string' ? payload.fullName : ''
          if (!candidateName || hasReservedCharacterName(candidateName, reservedNames)) {
            continue
          }
          if (itemRows.length > 0 && !payload.contextHooksJson) {
            payload.contextHooksJson = jsonStringifyArray(itemRows.slice(0, 2).map((item) => `${item.itemName}相关`))
          }
          preparedDrafts.push({
            ...payload,
            fullName: candidateName,
            roleType: String(payload.roleType || fallbackRole),
            recordStatus: 'draft',
          })
          if (runtime.commit !== false) {
            const id = createCharacter(novelId, payload, { skipContextTracking: true })
            createdIds.push(id)
          }
          reservedNames.push(candidateName)
          createdNames.push(candidateName)
          if (payload.roleType === 'protagonist') protagonistGenerated += 1
          else if (payload.roleType === 'major') majorGenerated += 1
          else if (payload.roleType === 'antagonist') antagonistGenerated += 1
          else if (payload.roleType === 'supporting') supportingGenerated += 1
          else minorGenerated += 1
          if (preparedDrafts.length >= totalCount) break
        }

        if (preparedDrafts.length === 0) {
          markRejected(historyId)
        }
        if (createdIds.length > 0 && runtime.commit !== false) {
          markNovelContextChanged(novelId, 'Character profiles changed')
          refreshWorldStateVersionsForNovel(novelId)
          runItemCharacterLinkRepair(novelId)
        }

        resultPayload = {
          ids: createdIds,
          taskId,
          ...(runtime.commit === false ? { draftCharacters: preparedDrafts } : {}),
          qualityReview: {
            stage: quality.stage,
            review: quality.review,
            rewrittenReview: quality.rewrittenReview,
            warnings: quality.warnings,
          },
          protagonistGenerated,
          majorGenerated,
          minorGenerated,
          antagonistGenerated,
          supportingGenerated,
          batchDigest: createdNames.slice(0, 4).join('、'),
          warning: preparedDrafts.length > 0
            ? summarizeAssetQualityWarnings(quality)
            : (summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批没有生成可用人物。`),
        }
        return resultPayload
      },
    })
  } finally {
    if (typeof runtime.parentTaskId === 'number') {
      updateTask(runtime.parentTaskId, { currentChildTaskId: null })
    }
  }

  return resultPayload || {
    ids: [],
    taskId,
    majorGenerated: 0,
    minorGenerated: 0,
    antagonistGenerated: 0,
    supportingGenerated: 0,
  }
}

export async function batchGenerateCharacters(novelId: number, opts: {
  majorCount: number
  minorCount: number
  antagonistCount?: number
  supportingCount?: number
  genderRatio: string
  preferredSpecies?: string[]
  factionBias?: string[]
  helperRoles?: string[]
  specialRequirements: string
  batchSize: number
  relationSeedMode?: 'balanced' | 'conflict-heavy' | 'ally-heavy'
  requiredItemLinks?: string[]
  diversityConstraints?: string[]
}, sender?: WebContents): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const existingChars = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const reservedNames = existingChars.map((character) => character.fullName).filter(Boolean)
  const protagonist = existingChars.find(c => c.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : '主角未设定'
  const existingCharacterSummaries = buildExistingCharacterDigest(existingChars)
  const roleBlueprint = buildRoleBlueprintSummary(opts)
  const itemSummary = buildItemResourceSummary(itemRows)
  const reviewContext = buildCharacterReviewContext({
    profile,
    worldSummary: profile.worldRulesSummary,
    protagonistSummary,
    existingCharacterSummaries,
    itemSummary,
    extraLines: [
      roleBlueprint ? `角色蓝图：${roleBlueprint}` : '',
      opts.specialRequirements ? `额外要求：${opts.specialRequirements}` : '',
    ],
  })

  const roleQueue = buildRoleQueue(opts)
  const specialRequirements = [
    opts.specialRequirements,
    `角色配额：主要人物 ${opts.majorCount}，反派 ${opts.antagonistCount || 0}，功能角色 ${opts.supportingCount || 0}，次要人物 ${opts.minorCount}。`,
    opts.preferredSpecies && opts.preferredSpecies.length > 0 ? `优先种族或实体：${opts.preferredSpecies.join('、')}。` : '',
    opts.factionBias && opts.factionBias.length > 0 ? `优先势力来源：${opts.factionBias.join('、')}。` : '',
    opts.helperRoles && opts.helperRoles.length > 0 ? `优先补齐这些角色功能位：${opts.helperRoles.join('、')}。` : '',
    itemSummary ? `优先与这些现有物品/资源发生绑定：\n${itemSummary}` : '',
    '角色必须和题材、背景、地图结构、势力关系与主线冲突直接相关。',
  ].filter(Boolean).join('\n')

  const totalCount = roleQueue.length
  if (totalCount <= 0) return []
  const newIds: number[] = []
  let generatedAttempts = 0
  const historyEntityType = 'character'
  const historyTaskType = 'character_batch'

  while (newIds.length < totalCount && generatedAttempts < Math.max(3, totalCount)) {
    const batchCount = Math.min(opts.batchSize, totalCount - newIds.length)
    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const prompt = batchCharacterPrompt({
      novelTitle: novel.title,
      novelSynopsis: profile.background,
      protagonistSummary,
      existingNames: reservedNames.join('、'),
      existingCharacterSummaries,
      genre: profile.genre,
      worldSummary: profile.worldRulesSummary,
      storyCore: buildStoryCoreSummary(profile),
      speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
      factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
      ecologySummary: buildCharacterEcologySummary(rules),
      mapSummary: buildMapBlueprintSummary(rules),
      writingConstraints: rules.writingConstraints.extraRules.join('；'),
      count: batchCount,
      genderRatio: opts.genderRatio || '不限',
      specialRequirements,
      roleBlueprint,
      relationSeedMode: opts.relationSeedMode,
      requiredItemLinks: opts.requiredItemLinks?.join('、'),
      diversityConstraints: opts.diversityConstraints?.join('、'),
      attemptNumber,
      rejectedDigests,
    })

    let acceptedBatch: Array<Record<string, unknown>> | null = null
    let rejectedByQuality = false
    const result = await runChatTask({
      type: 'character_gen',
      novelId,
      messages: [{ role: 'user', content: prompt }],
      modelConfigId: novel.modelConfigId || undefined,
      sender,
      onSuccess: async (rawOutput, taskId) => {
        const quality = await runAssetQualityLoop({
          targetType: 'character',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender,
          contextSummary: reviewContext,
          generatedOutput: rawOutput,
          schemaHint: characterSchemaHint(batchCount),
          reviewFocus: [
            '人物卡必须具体，不能只剩模板标签、履历词和空泛人设。',
            '人物与主线、背景、关键资源之间要存在可直接写进正文的钩子。',
          ],
          rewriteConstraints: [
            '保持角色数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把人物卡改写成散文。',
          ],
          qualityBudgetMs: BATCH_CHARACTER_QUALITY_BUDGET_MS,
          maxRewritePasses: BATCH_CHARACTER_MAX_REWRITE_PASSES,
        })
        if (quality.stage === 'rejected') {
          rejectedByQuality = true
          return quality
        }
        try {
          acceptedBatch = cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(quality.finalOutput))
        } catch (error) {
          const salvaged = cleanAiValue(salvageAiJsonArrayItems<Record<string, unknown>>(quality.finalOutput))
          if (salvaged.length > 0) {
            console.warn(`[character] 批量人物 JSON 整体解析失败，逐对象打捞成功 ${salvaged.length} 个成员`)
            acceptedBatch = salvaged
          } else {
            // 留给外层 while 循环按解析失败重试，不中断整个批量任务。
            console.error('批量人物 JSON 解析失败且无可打捞成员:', error)
            acceptedBatch = null
          }
        }
        return quality
      },
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
    const beforeCreateCount = newIds.length

    if (rejectedByQuality) {
      markRejected(historyId)
      if (sender && !sender.isDestroyed()) {
        sender.send('character:batch-progress', {
          batch: generatedAttempts + 1,
          total: Math.max(1, Math.ceil(totalCount / Math.max(1, opts.batchSize))),
          newIds,
        })
      }
      generatedAttempts += 1
      continue
    }

    try {
      const parsed = acceptedBatch || cleanAiValue(safeParseJson<Array<Record<string, unknown>>>(result))
      const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
      if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
        markRejected(historyId)
        if (sender && !sender.isDestroyed()) {
          sender.send('character:batch-progress', {
            batch: generatedAttempts + 1,
            total: Math.max(1, Math.ceil(totalCount / Math.max(1, opts.batchSize))),
            newIds,
          })
        }
        generatedAttempts += 1
        continue
      }
      for (const char of parsed) {
        const fallbackRole = roleQueue[newIds.length] || 'minor'
        const payload = buildCharacterPayload(char, {
          novelId,
          roleType: normalizeRoleType(asText(char.role_type) || fallbackRole),
          recordStatus: 'confirmed',
        })
        const candidateName = typeof payload.fullName === 'string' ? payload.fullName : ''
        if (!candidateName || hasReservedCharacterName(candidateName, reservedNames)) {
          continue
        }
        if (itemRows.length > 0 && !payload.contextHooksJson) {
          payload.contextHooksJson = jsonStringifyArray(itemRows.slice(0, 2).map((item) => `${item.itemName}相关`))
        }
        const id = createCharacter(novelId, payload, { skipContextTracking: true })
        reservedNames.push(candidateName)
        newIds.push(id)
        if (newIds.length >= totalCount) break
      }
    } catch (error) {
      console.error('批量生成人物解析失败:', error)
      markRejected(historyId)
    }

    if (newIds.length === beforeCreateCount) {
      markRejected(historyId)
    }

    if (sender && !sender.isDestroyed()) {
      sender.send('character:batch-progress', {
        batch: generatedAttempts + 1,
        total: Math.max(1, Math.ceil(totalCount / Math.max(1, opts.batchSize))),
        newIds,
      })
    }
    generatedAttempts += 1
  }

  if (newIds.length > 0) {
    markNovelContextChanged(novelId, 'Character profiles changed')
    refreshWorldStateVersionsForNovel(novelId)
    runItemCharacterLinkRepair(novelId)
  }

  return newIds
}

export async function regenerateCharacter(id: number): Promise<typeof characters.$inferSelect | null> {
  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  if (!current) throwUserFacingError('character.notFound')

  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(current.novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, current.novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, current.novelId)).all()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, current.novelId)).all()
    .filter((relation) => relation.charAId === current.id || relation.charBId === current.id)

  const relatedIds = new Set<number>()
  relationRows.forEach((relation) => {
    relatedIds.add(relation.charAId)
    relatedIds.add(relation.charBId)
  })
  relatedIds.delete(current.id)

  const relatedCharacters = allCharacters
    .filter((character) => character.id !== current.id)
    .sort((left, right) => {
      const relatedDiff = Number(relatedIds.has(right.id)) - Number(relatedIds.has(left.id))
      if (relatedDiff !== 0) return relatedDiff
      return roleOrder(left.roleType) - roleOrder(right.roleType)
    })
    .slice(0, 6)
    .map(buildCharacterSummary)
    .join('\n')

  const relationSummary = relationRows
    .map((relation) => {
      const otherId = relation.charAId === current.id ? relation.charBId : relation.charAId
      const other = allCharacters.find((character) => character.id === otherId)
      if (!other) return ""
      return buildCharacterRelationSummaryLine(current.fullName, other.fullName, relation)
    })
    .filter(Boolean)
    .join("\n")
  const protagonist = allCharacters.find((character) => character.roleType === 'protagonist')
  const protagonistSummary = protagonist ? buildCharacterSummary(protagonist) : ''
  const itemSummary = buildItemResourceSummary(itemRows)
  const reviewContext = buildCharacterReviewContext({
    profile,
    worldSummary: profile.worldRulesSummary,
    protagonistSummary,
    existingCharacterSummaries: buildExistingCharacterDigest(allCharacters.filter((character) => character.id !== current.id)),
    relationSummary,
    itemSummary,
    extraLines: [
      `当前人物卡：\n${buildCurrentProfileSummary(current)}`,
      relatedCharacters ? `关联人物：\n${relatedCharacters}` : '',
    ],
  })
  const historyEntityType = 'character'
  const historyTaskType = 'character_regenerate'
  const attemptNumber = getAttemptCount(current.novelId, historyEntityType, current.id, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(current.novelId, historyEntityType, current.id, historyTaskType)

  const prompt = regenerateCharacterPrompt({
    novelTitle: novel.title,
    novelSynopsis: profile.background,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
    storyCore: buildStoryCoreSummary(profile),
    speciesSummary: buildOptionSummary('可用种族', getSpeciesNameOptions(rules)),
    factionSummary: buildOptionSummary('核心势力', getFactionNameOptions(rules)),
    ecologySummary: buildCharacterEcologySummary(rules),
    writingConstraints: rules.writingConstraints.extraRules.join('；'),
    protagonistRule: profile.protagonistRule,
    lockedName: current.fullName,
    lockedRoleType: current.roleType || 'minor',
    currentProfile: buildCurrentProfileSummary(current),
    relatedCharacters,
    relationSummary,
    attemptNumber,
    rejectedDigests,
  })

  let acceptedCandidate: Record<string, unknown> | null = null
  let rejectedByQuality = false
  const result = await runChatTask({
    type: 'character_gen',
    novelId: current.novelId,
    relatedEntityType: 'character',
    relatedEntityId: current.id,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
    onSuccess: async (rawOutput, taskId) => {
      const quality = await runAssetQualityLoop({
        targetType: 'character',
        novelId: current.novelId,
        modelConfigId: novel.modelConfigId || undefined,
        relatedEntityType: 'character',
        relatedEntityId: current.id,
        parentTaskId: taskId,
        contextSummary: reviewContext,
        generatedOutput: rawOutput,
        schemaHint: characterSchemaHint(),
        reviewFocus: [
          '修复后的人物卡必须继续占据原功能位，不能漂移成另一个无关角色。',
          '优先修复空泛、冲突、关系失真和语言模板感。',
        ],
        rewriteConstraints: [
          '保持单个角色 JSON 对象结构稳定。',
          '除非原输出缺名，否则不要替换锁定姓名。',
        ],
      })
      if (quality.stage === 'rejected') {
        rejectedByQuality = true
        return quality
      }
      acceptedCandidate = cleanAiValue(safeParseJson<Record<string, unknown>>(quality.finalOutput))
      return quality
    },
  })
  const historyId = recordGeneration(current.novelId, historyEntityType, current.id, historyTaskType, result, attemptNumber)

  if (rejectedByQuality) {
    markRejected(historyId)
    return current
  }

  const parsed = acceptedCandidate || cleanAiValue(safeParseJson<Record<string, unknown>>(result))
  const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
  if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
    markRejected(historyId)
    return current
  }
  const payload = buildCharacterPayload(parsed, {
    novelId: current.novelId,
    existing: current,
    fullName: current.fullName,
    roleType: current.roleType || 'minor',
  })
  payload.fullName = current.fullName
  payload.roleType = current.roleType || 'minor'

  updateCharacter(current.id, payload, { skipContextTracking: true })
  markNovelContextChanged(current.novelId, 'Character profiles changed')
  refreshWorldStateVersionsForNovel(current.novelId)
  return getCharacter(current.id)
}

export async function suggestCharacterPatch(id: number, instruction: string): Promise<CharacterAiPatchResult> {
  const trimmedInstruction = instruction.trim()
  if (!trimmedInstruction) throwUserFacingError('ipc.invalidNonEmptyString', { name: 'instruction' })

  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  if (!current) throwUserFacingError('character.notFound')
  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(current.novelId)
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, current.novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, current.novelId)).all()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, current.novelId)).all()
    .filter((relation) => relation.charAId === current.id || relation.charBId === current.id)
  const relationSummary = relationRows
    .map((relation) => {
      const otherId = relation.charAId === current.id ? relation.charBId : relation.charAId
      const other = allCharacters.find((character) => character.id === otherId)
      return other ? buildCharacterRelationSummaryLine(current.fullName, other.fullName, relation) : ''
    })
    .filter(Boolean)
    .join('\n')

  const recentEvidence = buildRecentCharacterEvidence(current.novelId, current)
  const messages = [{
    role: 'user' as const,
    content: buildCharacterPatchPrompt({
      novelTitle: novel.title,
      profile,
      current,
      currentProfile: buildCurrentProfileSummary(current),
      relationSummary,
      itemSummary: buildItemResourceSummary(itemRows),
      recentEvidence,
      instruction: trimmedInstruction,
    }),
  }]
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'character_gen',
    novelId: current.novelId,
    relatedEntityType: 'character',
    relatedEntityId: current.id,
    retryable: true,
    inputJson,
    runnerType: 'chat',
  })
  const raw = await executeChatTask(taskId, {
    type: 'character_gen',
    novelId: current.novelId,
    relatedEntityType: 'character',
    relatedEntityId: current.id,
    retryable: true,
    inputJson,
    messages: [{
      role: 'user',
      content: messages[0].content,
    }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(raw))
  const patchRecord = parsed.patch && typeof parsed.patch === 'object' && !Array.isArray(parsed.patch)
    ? parsed.patch as Record<string, unknown>
    : parsed
  const patch = normalizeCharacterPatch(current, patchRecord)
  const changedFields = buildCharacterPatchChanges(current, patch)
  return {
    summary: asText(parsed.summary) || (changedFields.length > 0 ? `建议修改 ${changedFields.length} 个字段。` : '没有生成可应用修改。'),
    patch: patch as CharacterAiPatchResult['patch'],
    changedFields,
    warnings: toStringArray(parsed.warnings).slice(0, 6),
    target: { type: 'character', id: current.id, novelId: current.novelId },
    taskId,
  }
}

export function applyCharacterPatch(
  id: number,
  patchInput: unknown,
  options: { skipContextTracking?: boolean } = {},
): typeof characters.$inferSelect | null {
  const db = getDb()
  const current = db.select().from(characters).where(eq(characters.id, id)).all()[0]
  if (!current) throwUserFacingError('character.notFound')
  const patch = normalizeCharacterPatch(
    current,
    patchInput && typeof patchInput === 'object' && !Array.isArray(patchInput)
      ? patchInput as Record<string, unknown>
      : {},
  )
  if (Object.keys(patch).length === 0) return getCharacter(id)
  updateCharacter(id, patch, options)
  return getCharacter(id)
}

export async function generateCharacterRelations(novelId: number): Promise<void> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  const profile = await buildStoryProfile(novelId)
  if (!novel) throwUserFacingError('novel.notFound')

  const charList = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  if (charList.length < 2) throwUserFacingError('character.relationNeedAtLeastTwo')

  const characterListText = charList.map((character) => buildCharacterSummary(character)).join('\n')
  const prompt = characterRelationsPrompt({
    novelSynopsis: novel.synopsis || novel.expandedBackground || '',
    characterList: characterListText,
    genre: profile.genre,
    worldSummary: profile.worldRulesSummary,
  })

  const result = await runChatTask({
    type: 'character_gen',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  try {
    const relations = safeParseJson<Array<Record<string, unknown>>>(result)
    for (const relation of relations) {
      const charA = charList.find((character) => character.fullName === relation.char_a)
      const charB = charList.find((character) => character.fullName === relation.char_b)
      if (charA && charB) {
        upsertRelation({
          novelId,
          charAId: charA.id,
          charBId: charB.id,
          relationType: asText(relation.type || relation.relation_type),
          relationLabel: asText(relation.label || relation.relation_label),
          description: asText(relation.description),
          bilateral: relation.bilateral ? 1 : 0,
          intimacyLevel: normalizeCharacterRelationLevel(relation.intimacy_level ?? relation.intimacyLevel),
          tensionLevel: normalizeCharacterRelationLevel(relation.tension_level ?? relation.tensionLevel),
          interactionStyle: asText(relation.interaction_style || relation.interactionStyle),
          subtextRule: asText(relation.subtext_rule || relation.subtextRule),
        }, { skipContextTracking: true })
      }
    }
    markNovelContextChanged(novelId, 'Character relations changed')
    refreshWorldStateVersionsForNovel(novelId)
  } catch (error) {
    console.error('关系解析失败:', error)
  }
}
