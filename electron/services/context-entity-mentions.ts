import type {
  characterRelations,
  characters,
  factions,
  storyItems,
  worldMap,
} from '../database/schema'
import { getOperatingModePolicy } from '../../src/shared/operating-mode'

export interface EntityMentionCandidate {
  canonicalName: string
  aliases?: string[]
}

const ENTITY_MENTION_ALIAS_KEYS = [
  'alias',
  'aliases',
  'aliasesJson',
  'name',
  'displayName',
  'entityName',
  'refName',
  'aliasNames',
  'nicknames',
  'nickname',
  'titles',
  'title',
  'codenames',
  'codename',
  'codeName',
  'mentionNames',
  'mentions',
  'addressTerms',
  'relationTerms',
  'relationshipTitles',
  '称号',
  '别名',
  '代号',
  '称谓',
  '关系称谓',
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function parseJsonRecordArray(raw?: string | null): Record<string, unknown>[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => (
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        ))
      : []
  } catch {
    return []
  }
}

function parseJsonStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function dedupe(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function normalizeMentionAlias(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'“”‘’《》<>【】[\]()（）]+|[\s"'“”‘’《》<>【】[\]()（）]+$/gu, '')
}

function normalizeMentionAliasKey(value: string): string {
  return normalizeMentionAlias(value).replace(/\s+/g, '').toLowerCase()
}

function splitMentionAliasText(value: string): string[] {
  return value
    .split(/[\n,，、;；/|]+/u)
    .map(normalizeMentionAlias)
    .filter(Boolean)
}

function isUsefulMentionAlias(value: string): boolean {
  const alias = normalizeMentionAlias(value)
  if (!alias) return false
  if (/^\d+$/u.test(alias)) return false
  if (alias.length < 2) return false
  if (alias.length > 32) return false
  return true
}

function aliasValuesFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => aliasValuesFromUnknown(item))
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [
      ...ENTITY_MENTION_ALIAS_KEYS.flatMap((key) => aliasValuesFromUnknown(record[key])),
      ...['pointers', 'refs', 'references', 'entities', 'items']
        .flatMap((key) => aliasValuesFromUnknown(record[key])),
    ]
  }
  const text = asText(value)
  if (!text) return []
  return splitMentionAliasText(text)
}

function parseMentionAliasesFromJson(raw?: string | null): string[] {
  if (!raw) return []
  return dedupe([
    ...aliasValuesFromUnknown(parseJsonRecord(raw)),
    ...parseJsonRecordArray(raw).flatMap((record) => aliasValuesFromUnknown(record)),
  ].filter(isUsefulMentionAlias), 16)
}

function parseMentionAliasesFromText(raw?: string | null): string[] {
  const text = asText(raw)
  if (!text) return []

  const values: string[] = []
  const labeledPattern = /(?:别名|又称|亦称|代号|称号|简称|称谓|alias|aliases|aka)\s*[:：]\s*([^\n。；;]+)/giu
  let labeledMatch = labeledPattern.exec(text)
  while (labeledMatch) {
    values.push(...splitMentionAliasText(labeledMatch[1] || ''))
    labeledMatch = labeledPattern.exec(text)
  }

  const inlinePattern = /(?:又称|亦称|代号为|简称为)\s*([\u4e00-\u9fffA-Za-z0-9_·-]{2,32})/gu
  let inlineMatch = inlinePattern.exec(text)
  while (inlineMatch) {
    values.push(inlineMatch[1] || '')
    inlineMatch = inlinePattern.exec(text)
  }

  return dedupe(values.filter(isUsefulMentionAlias), 16)
}

function collectUniqueAliasesByOwner<T extends { id: number }>(
  rows: T[],
  collectAliases: (row: T) => string[],
): Map<number, string[]> {
  const aliasesByOwner = new Map<number, string[]>()
  const ownersByAlias = new Map<string, Set<number>>()

  rows.forEach((row) => {
    const aliases = dedupe(collectAliases(row)
      .map(normalizeMentionAlias)
      .filter(isUsefulMentionAlias), 24)
    aliasesByOwner.set(row.id, aliases)
    aliases.forEach((alias) => {
      const key = normalizeMentionAliasKey(alias)
      if (!ownersByAlias.has(key)) ownersByAlias.set(key, new Set())
      ownersByAlias.get(key)?.add(row.id)
    })
  })

  const result = new Map<number, string[]>()
  aliasesByOwner.forEach((aliases, ownerId) => {
    result.set(ownerId, aliases.filter((alias) => ownersByAlias.get(normalizeMentionAliasKey(alias))?.size === 1))
  })
  return result
}

function isTokenChar(value?: string): boolean {
  return Boolean(value && /[A-Za-z0-9_]/u.test(value))
}

function isDigitChar(value?: string): boolean {
  return Boolean(value && /\d/u.test(value))
}

function sourceContainsAlias(sourceText: string, alias: string): boolean {
  const needle = normalizeMentionAlias(alias)
  if (!needle) return false

  let start = sourceText.indexOf(needle)
  while (start >= 0) {
    const before = sourceText[start - 1]
    const after = sourceText[start + needle.length]
    const first = needle[0]
    const last = needle[needle.length - 1]
    const blockedByAsciiToken = (isTokenChar(before) && isTokenChar(first))
      || (isTokenChar(after) && isTokenChar(last))
    const blockedByNumberSuffix = isDigitChar(after) && isDigitChar(last)
    if (!blockedByAsciiToken && !blockedByNumberSuffix) return true
    start = sourceText.indexOf(needle, start + 1)
  }

  return false
}

function collectMentionedEntityMatchesFromCandidates(
  sourceText: string,
  candidates: EntityMentionCandidate[],
  limit: number,
): Array<{ canonicalName: string; matchedTerms: string[]; score: number }> {
  if (!sourceText.trim()) return []

  const ownersByAlias = new Map<string, Set<string>>()
  candidates.forEach((candidate) => {
    dedupe([candidate.canonicalName, ...(candidate.aliases || [])]
      .map(normalizeMentionAlias)
      .filter(isUsefulMentionAlias), 32)
      .forEach((alias) => {
        const key = normalizeMentionAliasKey(alias)
        if (!ownersByAlias.has(key)) ownersByAlias.set(key, new Set())
        ownersByAlias.get(key)?.add(candidate.canonicalName)
      })
  })

  return candidates
    .map((candidate, index) => {
      const aliases = dedupe([candidate.canonicalName, ...(candidate.aliases || [])]
        .map(normalizeMentionAlias)
        .filter(isUsefulMentionAlias), 32)
        .filter((alias) => ownersByAlias.get(normalizeMentionAliasKey(alias))?.size === 1)
      const matchedTerms = aliases
        .filter((alias) => sourceContainsAlias(sourceText, alias))
        .sort((left, right) => right.length - left.length)
      return {
        canonicalName: candidate.canonicalName,
        matchedTerms,
        index,
        score: matchedTerms[0]?.length || 0,
      }
    })
    .filter((entry) => entry.canonicalName && entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
}

export function collectMentionedEntityNamesFromCandidates(
  sourceText: string,
  candidates: EntityMentionCandidate[],
  limit: number,
): string[] {
  return collectMentionedEntityMatchesFromCandidates(sourceText, candidates, limit)
    .map((entry) => entry.canonicalName)
    .filter(Boolean)
}

export function collectMentionedEntityValidationTermsFromCandidates(
  sourceText: string,
  candidates: EntityMentionCandidate[],
  limit: number,
): string[] {
  return dedupe(collectMentionedEntityMatchesFromCandidates(sourceText, candidates, limit)
    .flatMap((entry) => [entry.canonicalName, ...entry.matchedTerms])
    .filter(isUsefulMentionAlias), Math.max(limit * 3, limit))
}

export function buildCharacterMentionCandidates(
  rows: Array<typeof characters.$inferSelect>,
): EntityMentionCandidate[] {
  const uniqueAliases = collectUniqueAliasesByOwner(rows, (row) => [
    row.surname && row.givenName ? `${row.surname}${row.givenName}` : '',
    row.occupation || '',
    row.rankLevel || '',
    row.socialIdentity || '',
    ...parseMentionAliasesFromJson(row.sourceContextJson),
  ])

  return rows.map((row) => {
    const roleAliases = row.roleType === 'protagonist'
      ? [
          '主角',
          '主人公',
          row.gender?.includes('男') ? '男主' : '',
          row.gender?.includes('女') ? '女主' : '',
        ]
      : []
    return {
      canonicalName: row.fullName || '',
      aliases: dedupe([
        ...(uniqueAliases.get(row.id) || []),
        ...roleAliases,
      ], 24),
    }
  })
}

export function buildItemMentionCandidates(
  rows: Array<typeof storyItems.$inferSelect>,
): EntityMentionCandidate[] {
  const uniqueAliases = collectUniqueAliasesByOwner(rows, (row) => [
    row.subType || '',
    ...parseJsonStringArray(row.tagsJson),
    ...parseMentionAliasesFromJson(row.sourceContextJson),
    ...parseMentionAliasesFromJson(row.typedRefsJson),
  ])

  return rows.map((row) => ({
    canonicalName: row.itemName || '',
    aliases: uniqueAliases.get(row.id) || [],
  }))
}

export function buildLocationMentionCandidates(
  rows: Array<typeof worldMap.$inferSelect>,
): EntityMentionCandidate[] {
  const uniqueAliases = collectUniqueAliasesByOwner(rows, (row) => [
    row.locationType || '',
    row.structureRole || '',
    ...parseJsonStringArray(row.tagsJson),
    ...parseMentionAliasesFromText(row.description),
    ...parseMentionAliasesFromText(row.atmosphere),
    ...parseMentionAliasesFromText(row.plotRelevance),
  ])

  return rows.map((row) => ({
    canonicalName: row.name || '',
    aliases: uniqueAliases.get(row.id) || [],
  }))
}

export function buildFactionMentionCandidates(
  rows: Array<typeof factions.$inferSelect>,
): EntityMentionCandidate[] {
  return rows.map((row) => ({
    canonicalName: row.name || '',
    aliases: dedupe([
      ...parseMentionAliasesFromJson(row.notes),
      ...parseMentionAliasesFromText(row.notes),
    ], 12),
  }))
}

export function collectExplicitEntityNamesFromReferences(
  references: string[] | undefined,
  candidates: EntityMentionCandidate[],
): string[] {
  const referenceKeys = new Set((references || [])
    .map(normalizeMentionAliasKey)
    .filter(Boolean))
  if (referenceKeys.size === 0) return []

  return candidates
    .filter((candidate) => dedupe([candidate.canonicalName, ...(candidate.aliases || [])], 32)
      .some((alias) => referenceKeys.has(normalizeMentionAliasKey(alias))))
    .map((candidate) => candidate.canonicalName)
    .filter(Boolean)
}

export function collectRelationMentionedCharacterNames(
  sourceText: string,
  relationRows: Array<typeof characterRelations.$inferSelect>,
  characterNameById: Map<number, string>,
  limit: number,
): string[] {
  if (!sourceText.trim() || relationRows.length === 0 || limit <= 0) return []
  return dedupe(relationRows.flatMap((relation) => {
    const terms = [
      relation.relationLabel || '',
      relation.interactionStyle || '',
    ]
      .map(normalizeMentionAlias)
      .filter(isUsefulMentionAlias)
      .filter((term) => sourceContainsAlias(sourceText, term))
    if (terms.length === 0) return []
    return [
      characterNameById.get(relation.charAId) || '',
      characterNameById.get(relation.charBId) || '',
    ]
  }), limit)
}

export function collectRelationMentionValidationTerms(
  sourceText: string,
  relationRows: Array<typeof characterRelations.$inferSelect>,
  characterNameById: Map<number, string>,
  limit: number,
): string[] {
  if (!sourceText.trim() || relationRows.length === 0 || limit <= 0) return []
  return dedupe(relationRows.flatMap((relation) => {
    const matchedTerms = [
      relation.relationLabel || '',
      relation.interactionStyle || '',
    ]
      .map(normalizeMentionAlias)
      .filter(isUsefulMentionAlias)
      .filter((term) => sourceContainsAlias(sourceText, term))
    if (matchedTerms.length === 0) return []
    return [
      ...matchedTerms,
      characterNameById.get(relation.charAId) || '',
      characterNameById.get(relation.charBId) || '',
    ]
  }), Math.max(limit * 3, limit))
}

export function resolveMentionedEntityLimits(input: {
  targetWords?: number | null
  chapterCount?: number | null
  launchMode?: string | null
  settingsJson?: string | null
  mapDepth?: number | null
  factionCount?: number | null
  speciesCount?: number | null
  powerSystemCount?: number | null
}) {
  const policy = getOperatingModePolicy({
    targetWords: input.targetWords,
    chapterCount: input.chapterCount,
    launchMode: input.launchMode,
    settingsJson: input.settingsJson,
  })
  const targetWords = Number(input.targetWords || 0)
  const chapterCount = Number(input.chapterCount || 0)
  const extraWordBlocks = Math.max(0, Math.ceil((targetWords - 1000000) / 250000))
  const extraChapterBlocks = Math.max(0, Math.ceil((chapterCount - 300) / 100))
  const complexityScore = (
    Math.min(Math.max(Number(input.mapDepth || 0) - 4, 0), 4) * 2
    + Math.min(Math.max(Number(input.factionCount || 0) - 6, 0), 10)
    + Math.min(Math.max(Number(input.speciesCount || 0) - 3, 0), 8)
    + Math.min(Math.max(Number(input.powerSystemCount || 0) - 2, 0), 6)
  )
  const complexityBonus = Math.floor(complexityScore / 4)
  const expand = (base: number, cap: number, weight = 1) => Math.min(
    cap,
    base + extraWordBlocks * weight * 2 + extraChapterBlocks * weight + complexityBonus * weight,
  )

  switch (policy.mode) {
    case 'million_longform':
      return {
        characters: expand(targetWords >= 1500000 ? 32 : 24, 64, 2),
        items: expand(targetWords >= 1500000 ? 24 : 20, 56, 2),
        locations: expand(targetWords >= 1500000 ? 20 : 16, 56, 2),
      }
    case 'epic_longform':
      return {
        characters: expand(16, 40, 1),
        items: expand(14, 36, 1),
        locations: expand(12, 36, 1),
      }
    case 'standard_longform':
      return {
        characters: expand(10, 20, 1),
        items: expand(10, 18, 1),
        locations: expand(8, 16, 1),
      }
    case 'shortform':
    default:
      return {
        characters: 8,
        items: 8,
        locations: 6,
      }
  }
}
