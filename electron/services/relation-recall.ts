import type Database from 'better-sqlite3'
import type { RecallMemorySource } from '../../src/types'

export type RelationRecallEntityType = 'character' | 'item' | 'timeline_event' | 'story_thread'
export type RelationRecallContractType = RelationRecallEntityType | 'commitment' | 'foreshadow'

export interface RelationRecallSeedEntity {
  type: RelationRecallEntityType
  id: number
}

export interface RelationRecallContractRef {
  type: RelationRecallContractType
  id: number
}

export interface DeterministicRecallSource extends RecallMemorySource {
  deterministic: true
  sourceKey: string
  sourceVersion: string
  required: boolean
  reason: 'explicit_contract' | 'due_commitment' | 'one_hop_relation' | 'owner_relation' | 'typed_reference'
  optionalKind: 'relation' | 'item' | 'timeline' | 'thread' | 'contract'
  dueChapter: number | null
}

export interface RelationRecallDiagnostic {
  code: 'ambiguous_name' | 'unresolved_reference' | 'foreign_entity' | 'future_source' | 'candidate_limit'
  reference: string
}

export interface RelationRecallResult {
  sources: DeterministicRecallSource[]
  diagnostics: RelationRecallDiagnostic[]
  queryCount: number
  candidateCount: number
}

export interface RelationRecallInput {
  novelId: number
  chapterNum: number
  seedEntityIds: RelationRecallSeedEntity[]
  explicitContractRefs: RelationRecallContractRef[]
  optionalPerKindLimit?: number
  optionalTotalLimit?: number
}

export interface ResolveRelationRecallInputOptions {
  novelId: number
  chapterNum: number
  mentionedCharacters?: string[]
  mentionedItems?: string[]
}

interface CandidateSource extends DeterministicRecallSource {}

interface ContractRow {
  servedThreadIdsJson?: string | null
  requiredAssetRefsJson?: string | null
  requiredEndgameCommitmentIdsJson?: string | null
  requiredForeshadowIdsJson?: string | null
}

interface SceneContractRow {
  requiredEndgameCommitmentIdsJson?: string | null
  requiredForeshadowIdsJson?: string | null
}

interface NamedAssetRow {
  id: number
  primaryName: string
  alternateName?: string | null
}

const MAX_SEEDS_PER_TYPE = 32
const MAX_REFERENCE_SCAN_ROWS = 256
const DEFAULT_OPTIONAL_PER_KIND_LIMIT = 8
const DEFAULT_OPTIONAL_TOTAL_LIMIT = 24

function normalizeId(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value)
      ? [...new Set(value.flatMap((item) => normalizeId(item) || []).slice(0, MAX_REFERENCE_SCAN_ROWS))]
      : []
  } catch {
    return []
  }
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
          .slice(0, MAX_REFERENCE_SCAN_ROWS)
      : []
  } catch {
    return []
  }
}

function normalizeName(value: string): string {
  return value
    .trim()
    .replace(/^(?:人物|角色|物品|道具|事件|时间轴|线程|伏笔)\s*[:：#]\s*/u, '')
    .replace(/[\s“”"'《》]/gu, '')
    .toLocaleLowerCase()
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sourceVersion(updatedAt: unknown, payload: string): string {
  const updated = typeof updatedAt === 'string' && updatedAt.trim() ? updatedAt.trim() : 'row'
  return `${updated}:${stableHash(payload)}`
}

function compact(parts: Array<unknown>, limit = 220): string {
  const text = parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim().replace(/\s+/gu, ' '))
    .join(' · ')
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1)).trim()}…`
}

function makeSource(input: {
  sourceKey: string
  sourceVersion: string
  sourceId: number
  semanticSourceType: 'character' | 'item' | 'story_thread' | 'timeline_event'
  bucket: 'character' | 'rule' | 'thread'
  fragmentType: string
  sourceLabel: string
  text: string
  required: boolean
  reason: DeterministicRecallSource['reason']
  optionalKind: DeterministicRecallSource['optionalKind']
  dueChapter?: number | null
}): CandidateSource {
  return {
    deterministic: true,
    sourceKey: input.sourceKey,
    sourceVersion: input.sourceVersion,
    required: input.required,
    reason: input.reason,
    optionalKind: input.optionalKind,
    dueChapter: input.dueChapter ?? null,
    sourceKind: 'semantic_asset',
    semanticSourceType: input.semanticSourceType,
    semanticSourceId: input.sourceId,
    bucket: input.bucket,
    fragmentType: input.fragmentType,
    similarity: 1,
    searchMode: 'keyword',
    sourceLabel: input.sourceLabel,
    summary: input.text,
    stale: false,
    staleReasons: [],
    overriddenByConstraint: false,
    entityMatches: [],
    entityValidated: true,
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function idsOfType(values: RelationRecallSeedEntity[], type: RelationRecallEntityType): number[] {
  return [...new Set(values.filter((item) => item.type === type).flatMap((item) => normalizeId(item.id) || []))]
    .slice(0, MAX_SEEDS_PER_TYPE)
}

function refsOfType(values: RelationRecallContractRef[], type: RelationRecallContractType): number[] {
  return [...new Set(values.filter((item) => item.type === type).flatMap((item) => normalizeId(item.id) || []))]
    .slice(0, MAX_REFERENCE_SCAN_ROWS)
}

function jsonIds(raw: unknown): number[] {
  return typeof raw === 'string' ? parseNumberArray(raw) : []
}

function typedRefIds(raw: unknown, type: RelationRecallEntityType): number[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const pointers = (parsed as { pointers?: unknown }).pointers
    if (!Array.isArray(pointers)) return []
    return pointers.flatMap((pointer) => {
      if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) return []
      const record = pointer as { assetType?: unknown; id?: unknown; unresolved?: unknown }
      if (record.assetType !== type || record.unresolved === true) return []
      return normalizeId(record.id) || []
    })
  } catch {
    return []
  }
}

function intersects(left: number[], right: Set<number>): boolean {
  return left.some((id) => right.has(id))
}

type RelationQueryAll = <T>(sql: string, ...params: unknown[]) => T[]

function validateSeedIds(
  queryAll: RelationQueryAll,
  novelId: number,
  groups: Array<{ type: RelationRecallEntityType; table: string; ids: number[] }>,
  diagnostics: RelationRecallDiagnostic[],
): Map<RelationRecallEntityType, Set<number>> {
  const validSeedIds = new Map<RelationRecallEntityType, Set<number>>()
  groups.forEach((group) => {
    if (group.ids.length === 0) {
      validSeedIds.set(group.type, new Set())
      return
    }
    const rows = queryAll<{ id: number }>(`
      SELECT id FROM ${group.table} WHERE novel_id = ? AND id IN (${placeholders(group.ids.length)}) ORDER BY id ASC
    `, novelId, ...group.ids)
    const valid = new Set(rows.map((row) => row.id))
    validSeedIds.set(group.type, valid)
    group.ids.filter((id) => !valid.has(id)).forEach((id) => {
      diagnostics.push({ code: 'foreign_entity', reference: `${group.type}:${id}` })
    })
  })
  return validSeedIds
}

function appendCommitmentCandidates(
  candidates: CandidateSource[],
  rows: Array<Record<string, unknown>>,
  chapterNum: number,
): void {
  rows.forEach((row) => {
    const text = compact([`到期承诺：${row.title}`, row.description])
    const targetChapter = normalizeId(row.targetResolutionChapter)
    const due = Boolean(targetChapter && targetChapter <= chapterNum + 3)
    candidates.push(makeSource({
      sourceKey: `contract:commitment:${row.id}`,
      sourceVersion: sourceVersion(row.updatedAt, text),
      sourceId: Number(row.id), semanticSourceType: 'story_thread', bucket: 'thread',
      fragmentType: 'contract_commitment', sourceLabel: `承诺#${row.id}`, text,
      required: true, reason: due ? 'due_commitment' : 'explicit_contract', optionalKind: 'contract',
      dueChapter: targetChapter,
    }))
  })
}

function dedupeAndLimitCandidates(
  candidates: CandidateSource[],
  input: RelationRecallInput,
  diagnostics: RelationRecallDiagnostic[],
): DeterministicRecallSource[] {
  const byKey = new Map<string, CandidateSource>()
  candidates.forEach((candidate) => {
    const existing = byKey.get(candidate.sourceKey)
    if (!existing || (!existing.required && candidate.required)) byKey.set(candidate.sourceKey, candidate)
  })
  const ordered = [...byKey.values()].sort((left, right) => {
    if (left.required !== right.required) return left.required ? -1 : 1
    const leftDue = left.dueChapter ?? Number.MAX_SAFE_INTEGER
    const rightDue = right.dueChapter ?? Number.MAX_SAFE_INTEGER
    if (leftDue !== rightDue) return leftDue - rightDue
    const kindRank = { contract: 0, relation: 1, item: 2, timeline: 3, thread: 4 }
    const kindDiff = kindRank[left.optionalKind] - kindRank[right.optionalKind]
    if (kindDiff !== 0) return kindDiff
    return Number(left.semanticSourceId || 0) - Number(right.semanticSourceId || 0)
  })
  const required = ordered.filter((source) => source.required)
  const perKindLimit = Math.max(1, Math.min(32, Math.floor(input.optionalPerKindLimit || DEFAULT_OPTIONAL_PER_KIND_LIMIT)))
  const totalLimit = Math.max(1, Math.min(96, Math.floor(input.optionalTotalLimit || DEFAULT_OPTIONAL_TOTAL_LIMIT)))
  const counts = new Map<DeterministicRecallSource['optionalKind'], number>()
  const optional: CandidateSource[] = []
  ordered.filter((source) => !source.required).forEach((source) => {
    const count = counts.get(source.optionalKind) || 0
    if (count >= perKindLimit || optional.length >= totalLimit) {
      diagnostics.push({ code: 'candidate_limit', reference: source.sourceKey })
      return
    }
    counts.set(source.optionalKind, count + 1)
    optional.push(source)
  })
  return [...required, ...optional]
}

function selectNamedIds(
  names: string[],
  rows: NamedAssetRow[],
  type: RelationRecallEntityType,
  diagnostics: RelationRecallDiagnostic[],
): RelationRecallSeedEntity[] {
  const byName = new Map<string, number[]>()
  rows.forEach((row) => {
    const candidates = [row.primaryName, row.alternateName || ''].map(normalizeName).filter(Boolean)
    candidates.forEach((name) => byName.set(name, [...new Set([...(byName.get(name) || []), row.id])]))
  })
  return names.flatMap((rawName) => {
    const name = normalizeName(rawName)
    if (!name) return []
    const ids = byName.get(name) || []
    if (ids.length === 1) return [{ type, id: ids[0] }]
    diagnostics.push({ code: ids.length > 1 ? 'ambiguous_name' : 'unresolved_reference', reference: `${type}:${rawName}` })
    return []
  })
}

function parseExplicitIdReference(value: string): RelationRecallContractRef | null {
  const match = value.trim().match(/^(character|item|timeline_event|story_thread|commitment|foreshadow)\s*[:#]\s*(\d+)$/iu)
  if (!match) return null
  const id = normalizeId(match[2])
  return id ? { type: match[1].toLocaleLowerCase() as RelationRecallContractType, id } : null
}

export function resolveRelationRecallInput(
  sqlite: Database.Database,
  options: ResolveRelationRecallInputOptions,
): { seedEntityIds: RelationRecallSeedEntity[]; explicitContractRefs: RelationRecallContractRef[]; diagnostics: RelationRecallDiagnostic[]; queryCount: number } {
  const diagnostics: RelationRecallDiagnostic[] = []
  let queryCount = 0
  const queryAll = <T>(sql: string, ...params: unknown[]): T[] => {
    queryCount += 1
    return sqlite.prepare(sql).all(...params) as T[]
  }
  const queryGet = <T>(sql: string, ...params: unknown[]): T | undefined => {
    queryCount += 1
    return sqlite.prepare(sql).get(...params) as T | undefined
  }

  const chapter = queryGet<{ id: number }>(`
    SELECT id FROM chapters WHERE novel_id = ? AND chapter_num = ? ORDER BY id ASC LIMIT 1
  `, options.novelId, options.chapterNum)
  const contract = chapter
    ? queryGet<ContractRow>(`
        SELECT served_thread_ids_json AS servedThreadIdsJson,
               required_asset_refs_json AS requiredAssetRefsJson,
               required_endgame_commitment_ids_json AS requiredEndgameCommitmentIdsJson,
               required_foreshadow_ids_json AS requiredForeshadowIdsJson
        FROM chapter_contracts WHERE novel_id = ? AND chapter_id = ? ORDER BY id ASC LIMIT 1
      `, options.novelId, chapter.id)
    : undefined
  const scenes = chapter
    ? queryAll<SceneContractRow>(`
        SELECT required_endgame_commitment_ids_json AS requiredEndgameCommitmentIdsJson,
               required_foreshadow_ids_json AS requiredForeshadowIdsJson
        FROM scene_contracts WHERE novel_id = ? AND chapter_id = ? ORDER BY id ASC
      `, options.novelId, chapter.id)
    : []

  const explicitContractRefs: RelationRecallContractRef[] = [
    ...parseNumberArray(contract?.servedThreadIdsJson).map((id) => ({ type: 'story_thread' as const, id })),
    ...parseNumberArray(contract?.requiredEndgameCommitmentIdsJson).map((id) => ({ type: 'commitment' as const, id })),
    ...parseNumberArray(contract?.requiredForeshadowIdsJson).map((id) => ({ type: 'foreshadow' as const, id })),
    ...scenes.flatMap((scene) => parseNumberArray(scene.requiredEndgameCommitmentIdsJson).map((id) => ({ type: 'commitment' as const, id }))),
    ...scenes.flatMap((scene) => parseNumberArray(scene.requiredForeshadowIdsJson).map((id) => ({ type: 'foreshadow' as const, id }))),
  ]
  const assetRefs = parseStringArray(contract?.requiredAssetRefsJson)
  assetRefs.forEach((value) => {
    const parsed = parseExplicitIdReference(value)
    if (parsed) explicitContractRefs.push(parsed)
  })

  const unresolvedAssetRefs = assetRefs.filter((value) => !parseExplicitIdReference(value))
  const candidateNames = (values: string[]) => [...new Set(values.map(normalizeName).filter(Boolean))]
  const queryNamedRows = (sql: string, names: string[], filterCopies = 1): NamedAssetRow[] => {
    const normalized = candidateNames(names)
    return normalized.length > 0
      ? queryAll<NamedAssetRow>(
          sql.replaceAll('/* NAME_FILTER */', placeholders(normalized.length)),
          options.novelId,
          ...Array.from({ length: filterCopies }, () => normalized).flat(),
        )
      : []
  }
  const characterNames = [...(options.mentionedCharacters || []), ...unresolvedAssetRefs]
  const characterRows = queryNamedRows(`
    SELECT id, full_name AS primaryName,
           TRIM(COALESCE(surname, '') || COALESCE(given_name, '')) AS alternateName
    FROM characters
    WHERE novel_id = ?
      AND (LOWER(REPLACE(full_name, ' ', '')) IN (/* NAME_FILTER */)
        OR LOWER(REPLACE(TRIM(COALESCE(surname, '') || COALESCE(given_name, '')), ' ', '')) IN (/* NAME_FILTER */))
    ORDER BY id ASC LIMIT ${MAX_REFERENCE_SCAN_ROWS}
  `, characterNames, 2)
  const itemRows = queryNamedRows(`
    SELECT id, item_name AS primaryName, NULL AS alternateName
    FROM story_items WHERE novel_id = ? AND LOWER(REPLACE(item_name, ' ', '')) IN (/* NAME_FILTER */)
    ORDER BY id ASC LIMIT ${MAX_REFERENCE_SCAN_ROWS}
  `, [...(options.mentionedItems || []), ...unresolvedAssetRefs])
  const timelineRows = queryNamedRows(`
    SELECT id, event_title AS primaryName, NULL AS alternateName
    FROM timeline_events WHERE novel_id = ? AND LOWER(REPLACE(event_title, ' ', '')) IN (/* NAME_FILTER */)
    ORDER BY id ASC LIMIT ${MAX_REFERENCE_SCAN_ROWS}
  `, unresolvedAssetRefs)
  const threadRows = queryNamedRows(`
    SELECT id, title AS primaryName, NULL AS alternateName
    FROM story_threads WHERE novel_id = ? AND LOWER(REPLACE(title, ' ', '')) IN (/* NAME_FILTER */)
    ORDER BY id ASC LIMIT ${MAX_REFERENCE_SCAN_ROWS}
  `, unresolvedAssetRefs)

  const seedEntityIds = [
    ...selectNamedIds(options.mentionedCharacters || [], characterRows, 'character', diagnostics),
    ...selectNamedIds(options.mentionedItems || [], itemRows, 'item', diagnostics),
  ]
  const matchingSeeds = (value: string, rows: NamedAssetRow[], type: RelationRecallEntityType): RelationRecallSeedEntity[] => {
    const normalized = normalizeName(value)
    return rows
      .filter((row) => [row.primaryName, row.alternateName || ''].some((name) => normalizeName(name) === normalized))
      .map((row) => ({ type, id: row.id }))
  }
  unresolvedAssetRefs.forEach((value) => {
    const matches = [
      ...matchingSeeds(value, characterRows, 'character'),
      ...matchingSeeds(value, itemRows, 'item'),
      ...matchingSeeds(value, timelineRows, 'timeline_event'),
      ...matchingSeeds(value, threadRows, 'story_thread'),
    ]
    if (matches.length === 1) explicitContractRefs.push(matches[0])
    else diagnostics.push({ code: matches.length > 1 ? 'ambiguous_name' : 'unresolved_reference', reference: `contract:${value}` })
  })

  return {
    seedEntityIds: [...new Map(seedEntityIds.map((seed) => [`${seed.type}:${seed.id}`, seed] as const)).values()],
    explicitContractRefs: [...new Map(explicitContractRefs.map((ref) => [`${ref.type}:${ref.id}`, ref] as const)).values()],
    diagnostics,
    queryCount,
  }
}

export function loadRelationRecallSources(
  sqlite: Database.Database,
  input: RelationRecallInput,
): RelationRecallResult {
  const diagnostics: RelationRecallDiagnostic[] = []
  const candidates: CandidateSource[] = []
  let queryCount = 0
  const queryAll = <T>(sql: string, ...params: unknown[]): T[] => {
    queryCount += 1
    return sqlite.prepare(sql).all(...params) as T[]
  }

  const characterSeedIds = idsOfType(input.seedEntityIds, 'character')
  const itemSeedIds = idsOfType(input.seedEntityIds, 'item')
  const timelineSeedIds = idsOfType(input.seedEntityIds, 'timeline_event')
  const threadSeedIds = idsOfType(input.seedEntityIds, 'story_thread')
  const explicitCharacterIds = refsOfType(input.explicitContractRefs, 'character')
  const explicitItemIds = refsOfType(input.explicitContractRefs, 'item')
  const explicitTimelineIds = refsOfType(input.explicitContractRefs, 'timeline_event')
  const explicitThreadIds = refsOfType(input.explicitContractRefs, 'story_thread')
  const explicitCommitmentIds = refsOfType(input.explicitContractRefs, 'commitment')
  const explicitForeshadowIds = refsOfType(input.explicitContractRefs, 'foreshadow')

  const seedGroups: Array<{ type: RelationRecallEntityType; table: string; ids: number[] }> = [
    { type: 'character', table: 'characters', ids: [...new Set([...characterSeedIds, ...explicitCharacterIds])] },
    { type: 'item', table: 'story_items', ids: [...new Set([...itemSeedIds, ...explicitItemIds])] },
    { type: 'timeline_event', table: 'timeline_events', ids: [...new Set([...timelineSeedIds, ...explicitTimelineIds])] },
    { type: 'story_thread', table: 'story_threads', ids: [...new Set([...threadSeedIds, ...explicitThreadIds])] },
  ]
  const validSeedIds = validateSeedIds(queryAll, input.novelId, seedGroups, diagnostics)

  const validCharacters = validSeedIds.get('character') || new Set<number>()
  const validItems = validSeedIds.get('item') || new Set<number>()
  const validTimeline = validSeedIds.get('timeline_event') || new Set<number>()
  const validThreads = validSeedIds.get('story_thread') || new Set<number>()

  {
    const explicitClause = explicitCommitmentIds.length > 0
      ? `id IN (${placeholders(explicitCommitmentIds.length)})`
      : '0'
    const rows = queryAll<Record<string, unknown>>(`
      SELECT id, title, description, target_resolution_chapter AS targetResolutionChapter,
             updated_at AS updatedAt
      FROM endgame_commitments
      WHERE novel_id = ?
        AND (
          ${explicitClause}
          OR (
            status = 'active'
            AND target_resolution_chapter > 0
            AND target_resolution_chapter <= ?
          )
        )
      ORDER BY target_resolution_chapter ASC, id ASC
    `, input.novelId, ...explicitCommitmentIds, input.chapterNum + 3)
    const found = new Set(rows.map((row) => Number(row.id)))
    explicitCommitmentIds.filter((id) => !found.has(id)).forEach((id) => diagnostics.push({ code: 'foreign_entity', reference: `commitment:${id}` }))
    appendCommitmentCandidates(candidates, rows, input.chapterNum)
  }

  if (explicitForeshadowIds.length > 0) {
    const rows = queryAll<Record<string, unknown>>(`
      SELECT ledger.id, ledger.title, ledger.detail,
             ledger.target_payoff_chapter AS targetPayoffChapter,
             ledger.payoff_method AS payoffMethod,
             ledger.payoff_scene_action AS payoffSceneAction,
             ledger.required_evidence AS requiredEvidence,
             ledger.reader_visible_outcome AS readerVisibleOutcome,
             ledger.linked_thread_id AS linkedThreadId,
             ledger.updated_at AS updatedAt,
             source_chapter.chapter_num AS sourceChapterNum
      FROM foreshadow_ledger AS ledger
      LEFT JOIN chapters AS source_chapter
        ON source_chapter.id = ledger.source_chapter_id
       AND source_chapter.novel_id = ledger.novel_id
      WHERE ledger.novel_id = ? AND ledger.id IN (${placeholders(explicitForeshadowIds.length)})
      ORDER BY ledger.target_payoff_chapter ASC, ledger.id ASC
    `, input.novelId, ...explicitForeshadowIds)
    const found = new Set(rows.map((row) => Number(row.id)))
    explicitForeshadowIds.filter((id) => !found.has(id)).forEach((id) => diagnostics.push({ code: 'foreign_entity', reference: `foreshadow:${id}` }))
    rows.forEach((row) => {
      const sourceChapterNum = normalizeId(row.sourceChapterNum)
      if (sourceChapterNum && sourceChapterNum >= input.chapterNum) {
        diagnostics.push({ code: 'future_source', reference: `foreshadow:${row.id}:chapter:${sourceChapterNum}` })
        return
      }
      const text = compact([
        `合同伏笔：${row.title}`,
        row.detail,
        row.payoffSceneAction ? `动作=${row.payoffSceneAction}` : '',
        row.requiredEvidence ? `证据=${row.requiredEvidence}` : '',
        row.readerVisibleOutcome ? `结果=${row.readerVisibleOutcome}` : row.payoffMethod ? `回收=${row.payoffMethod}` : '',
        sourceChapterNum ? `来源=第${sourceChapterNum}章` : '',
      ])
      candidates.push(makeSource({
        sourceKey: `contract:foreshadow:${row.id}`,
        sourceVersion: sourceVersion(row.updatedAt, text),
        sourceId: Number(row.id), semanticSourceType: 'story_thread', bucket: 'thread',
        fragmentType: 'contract_foreshadow', sourceLabel: `伏笔#${row.id}`, text,
        required: true, reason: 'explicit_contract', optionalKind: 'contract',
        dueChapter: normalizeId(row.targetPayoffChapter),
      }))
    })
  }

  if (validCharacters.size > 0) {
    const ids = [...validCharacters]
    const rows = queryAll<Record<string, unknown>>(`
      SELECT relation.id, relation.char_a_id AS charAId, relation.char_b_id AS charBId,
             relation.relation_type AS relationType, relation.relation_label AS relationLabel,
             relation.description, relation.interaction_style AS interactionStyle,
             char_a.full_name AS charAName, char_b.full_name AS charBName
      FROM character_relations AS relation
      INNER JOIN characters AS char_a ON char_a.id = relation.char_a_id AND char_a.novel_id = relation.novel_id
      INNER JOIN characters AS char_b ON char_b.id = relation.char_b_id AND char_b.novel_id = relation.novel_id
      WHERE relation.novel_id = ?
        AND (relation.char_a_id IN (${placeholders(ids.length)}) OR relation.char_b_id IN (${placeholders(ids.length)}))
      ORDER BY relation.id ASC
      LIMIT ${MAX_REFERENCE_SCAN_ROWS}
    `, input.novelId, ...ids, ...ids)
    rows.forEach((row) => {
      const text = compact([`${row.charAName} ↔ ${row.charBName}`, row.relationLabel || row.relationType, row.description, row.interactionStyle])
      candidates.push(makeSource({
        sourceKey: `asset:character_relation:${row.id}`,
        sourceVersion: sourceVersion(null, text), sourceId: Number(row.id),
        semanticSourceType: 'character', bucket: 'character', fragmentType: 'character_relation',
        sourceLabel: `人物关系#${row.id}`, text, required: false,
        reason: 'one_hop_relation', optionalKind: 'relation',
      }))
    })

    const itemRows = queryAll<Record<string, unknown>>(`
      SELECT item.id, item.item_name AS itemName, item.owner_character_id AS ownerCharacterId,
             item.status, item.summary, item.updated_at AS updatedAt,
             owner.full_name AS ownerName
      FROM story_items AS item
      INNER JOIN characters AS owner
        ON owner.id = item.owner_character_id AND owner.novel_id = item.novel_id
      WHERE item.novel_id = ? AND item.owner_character_id IN (${placeholders(ids.length)})
      ORDER BY item.id ASC
      LIMIT ${MAX_REFERENCE_SCAN_ROWS}
    `, input.novelId, ...ids)
    itemRows.forEach((row) => {
      const text = compact([
        row.ownerName ? `${row.ownerName}持有物品：${row.itemName}` : `持有物品：${row.itemName}`,
        row.status ? `状态=${row.status}` : '',
        row.summary,
      ])
      candidates.push(makeSource({
        sourceKey: `asset:item:${row.id}`,
        sourceVersion: sourceVersion(row.updatedAt, text), sourceId: Number(row.id),
        semanticSourceType: 'item', bucket: 'character', fragmentType: 'owner_relation',
        sourceLabel: `物品#${row.id}`, text, required: explicitItemIds.includes(Number(row.id)),
        reason: explicitItemIds.includes(Number(row.id)) ? 'explicit_contract' : 'owner_relation', optionalKind: 'item',
      }))
    })
  }

  if (explicitItemIds.length > 0) {
    const missingExplicit = explicitItemIds.filter((id) => !candidates.some((source) => source.sourceKey === `asset:item:${id}`))
    if (missingExplicit.length > 0) {
      const rows = queryAll<Record<string, unknown>>(`
        SELECT id, item_name AS itemName, status, summary, updated_at AS updatedAt
        FROM story_items WHERE novel_id = ? AND id IN (${placeholders(missingExplicit.length)}) ORDER BY id ASC
      `, input.novelId, ...missingExplicit)
      rows.forEach((row) => {
        const text = compact([`合同物品：${row.itemName}`, row.status ? `状态=${row.status}` : '', row.summary])
        candidates.push(makeSource({
          sourceKey: `asset:item:${row.id}`, sourceVersion: sourceVersion(row.updatedAt, text), sourceId: Number(row.id),
          semanticSourceType: 'item', bucket: 'rule', fragmentType: 'contract_item', sourceLabel: `物品#${row.id}`,
          text, required: true, reason: 'explicit_contract', optionalKind: 'item',
        }))
      })
    }
  }

  const threadRows = queryAll<Record<string, unknown>>(`
    SELECT id, title, summary, status, priority, planted_chapter AS plantedChapter,
           target_payoff_chapter AS targetPayoffChapter,
           related_character_ids_json AS relatedCharacterIdsJson,
           related_item_ids_json AS relatedItemIdsJson,
           related_timeline_event_ids_json AS relatedTimelineEventIdsJson,
           typed_refs_json AS typedRefsJson, updated_at AS updatedAt
    FROM story_threads WHERE novel_id = ? ORDER BY id ASC LIMIT ${MAX_REFERENCE_SCAN_ROWS}
  `, input.novelId)
  threadRows.forEach((row) => {
    const id = Number(row.id)
    const plantedChapter = normalizeId(row.plantedChapter)
    const explicit = explicitThreadIds.includes(id)
    if (plantedChapter && plantedChapter >= input.chapterNum) {
      if (explicit || validThreads.has(id)) diagnostics.push({ code: 'future_source', reference: `story_thread:${id}:chapter:${plantedChapter}` })
      return
    }
    const related = intersects(jsonIds(row.relatedCharacterIdsJson), validCharacters)
      || intersects(jsonIds(row.relatedItemIdsJson), validItems)
      || intersects(jsonIds(row.relatedTimelineEventIdsJson), validTimeline)
      || intersects(typedRefIds(row.typedRefsJson, 'character'), validCharacters)
      || intersects(typedRefIds(row.typedRefsJson, 'item'), validItems)
      || intersects(typedRefIds(row.typedRefsJson, 'timeline_event'), validTimeline)
    if (!explicit && !validThreads.has(id) && !related) return
    const text = compact([`故事线程：${row.title}`, row.status ? `状态=${row.status}` : '', row.summary, row.targetPayoffChapter ? `目标回收=第${row.targetPayoffChapter}章` : ''])
    candidates.push(makeSource({
      sourceKey: `asset:story_thread:${id}`, sourceVersion: sourceVersion(row.updatedAt, text), sourceId: id,
      semanticSourceType: 'story_thread', bucket: 'thread', fragmentType: 'story_thread', sourceLabel: `故事线程#${id}`,
      text, required: explicit, reason: explicit ? 'explicit_contract' : 'typed_reference', optionalKind: 'thread',
      dueChapter: normalizeId(row.targetPayoffChapter),
    }))
  })

  const timelineRows = queryAll<Record<string, unknown>>(`
    SELECT event.id, event.event_title AS eventTitle, event.event_summary AS eventSummary,
           event.status, event.anchor_invalid AS anchorInvalid,
           event.present_character_ids_json AS presentCharacterIdsJson,
           event.affected_character_ids_json AS affectedCharacterIdsJson,
           event.linked_item_ids_json AS linkedItemIdsJson,
           event.typed_refs_json AS typedRefsJson, event.updated_at AS updatedAt,
           start_chapter.chapter_num AS startChapterNum
    FROM timeline_events AS event
    LEFT JOIN chapters AS start_chapter
      ON start_chapter.id = event.chapter_start_id AND start_chapter.novel_id = event.novel_id
    WHERE event.novel_id = ? ORDER BY event.id ASC LIMIT ${MAX_REFERENCE_SCAN_ROWS}
  `, input.novelId)
  timelineRows.forEach((row) => {
    const id = Number(row.id)
    const explicit = explicitTimelineIds.includes(id)
    const startChapterNum = normalizeId(row.startChapterNum)
    const future = (startChapterNum && startChapterNum >= input.chapterNum)
      || (!startChapterNum && (row.status === 'planned' || row.status === 'draft'))
    if (future) {
      if (explicit || validTimeline.has(id)) diagnostics.push({ code: 'future_source', reference: `timeline_event:${id}${startChapterNum ? `:chapter:${startChapterNum}` : ''}` })
      return
    }
    if (Number(row.anchorInvalid || 0) !== 0) return
    const related = intersects(jsonIds(row.presentCharacterIdsJson), validCharacters)
      || intersects(jsonIds(row.affectedCharacterIdsJson), validCharacters)
      || intersects(jsonIds(row.linkedItemIdsJson), validItems)
      || intersects(typedRefIds(row.typedRefsJson, 'character'), validCharacters)
      || intersects(typedRefIds(row.typedRefsJson, 'item'), validItems)
      || intersects(typedRefIds(row.typedRefsJson, 'story_thread'), validThreads)
    if (!explicit && !validTimeline.has(id) && !related) return
    const text = compact([`时间轴事件：${row.eventTitle}`, row.eventSummary, startChapterNum ? `发生于第${startChapterNum}章` : ''])
    candidates.push(makeSource({
      sourceKey: `asset:timeline_event:${id}`, sourceVersion: sourceVersion(row.updatedAt, text), sourceId: id,
      semanticSourceType: 'timeline_event', bucket: 'thread', fragmentType: 'timeline_event', sourceLabel: `时间轴事件#${id}`,
      text, required: explicit, reason: explicit ? 'explicit_contract' : 'typed_reference', optionalKind: 'timeline',
      dueChapter: startChapterNum,
    }))
  })

  return {
    sources: dedupeAndLimitCandidates(candidates, input, diagnostics),
    diagnostics,
    queryCount,
    candidateCount: new Set(candidates.map((source) => source.sourceKey)).size,
  }
}
