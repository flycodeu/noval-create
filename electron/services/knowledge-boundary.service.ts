import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, storyFacts } from '../database/schema'

export interface StoryFactKnowledgeRow {
  id: number
  novelId: number
  title: string
  summary: string | null
  kind: string
  readerKnownChapterId: number | null
  protagonistKnownChapterId: number | null
  characterKnowledgeJson: string | null
  forbiddenBeforeVolume: number | null
  targetRevealChapterId: number | null
}

export interface CharacterKnowledgeEntry {
  characterId: number
  knownChapterId: number | null
}

export interface CharacterKnowledgeProjection {
  characterId: number
  knownChapterNum: number | null
}

/**
 * 纯函数只接收章序投影，不直接解释数据库 chapterId。
 * readerKnownChapterNum 保留给 reader 视图，不能据此推导角色知情。
 */
export interface StoryFactKnowledgeProjection {
  readerKnownChapterNum: number | null
  protagonistKnownChapterNum: number | null
  characterKnowledge: CharacterKnowledgeProjection[]
}

export type KnowledgeBoundary = 'start' | 'end'

export interface KnowledgeBoundaryOptions {
  /** 默认按章节结束查询；章节开始写作使用严格小于当前章。 */
  boundary?: KnowledgeBoundary
}

export type KnowledgeDiagnosticCode =
  | 'chapter_reference_unresolved'
  | 'knowledge_time_unknown'
  | 'malformed_knowledge_json'

export interface KnowledgeBoundaryDiagnostic {
  code: KnowledgeDiagnosticCode
  factId: number
  field?: 'readerKnownChapterId' | 'protagonistKnownChapterId' | 'characterKnowledgeJson'
  characterId?: number
  chapterId?: number
  message: string
}

export interface KnowledgeBoundaryCheckResult {
  /** 事实是否在该章节点之前已被角色知晓。 */
  known: boolean
  /** 判定依据：protagonist | character_knowledge | reader | not_known */
  source: 'protagonist' | 'character_knowledge' | 'reader' | 'not_known'
}

export interface ProjectedStoryFactKnowledge {
  /** 原始数据库 row，返回给调用方时不做字段变形。 */
  fact: StoryFactKnowledgeRow
  projection: StoryFactKnowledgeProjection
  diagnostics?: KnowledgeBoundaryDiagnostic[]
}

export interface UnknownFactForCharacter {
  fact: StoryFactKnowledgeRow
  reason: string
  diagnostics?: KnowledgeBoundaryDiagnostic[]
}

interface ParsedCharacterKnowledge {
  entries: CharacterKnowledgeEntry[]
  malformed: boolean
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

function parseKnowledgeEntries(raw: string | null | undefined): ParsedCharacterKnowledge {
  if (!raw) return { entries: [], malformed: false }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { entries: [], malformed: true }

    const entries = parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        characterId: toPositiveInteger(entry.characterId),
        knownChapterId: entry.knownChapterId === null || entry.knownChapterId === undefined
          ? null
          : toPositiveInteger(entry.knownChapterId),
      }))
      .filter((entry): entry is CharacterKnowledgeEntry => typeof entry.characterId === 'number')

    return { entries, malformed: false }
  } catch {
    return { entries: [], malformed: true }
  }
}

function isValidBoundaryChapter(upToChapterNum: number): boolean {
  return typeof upToChapterNum === 'number' && Number.isFinite(upToChapterNum) && upToChapterNum > 0
}

function isKnownAtBoundary(
  knownChapterNum: number | null,
  upToChapterNum: number,
  boundary: KnowledgeBoundary,
): boolean {
  const normalizedKnownChapterNum = toPositiveInteger(knownChapterNum)
  if (!isValidBoundaryChapter(upToChapterNum) || normalizedKnownChapterNum === null) return false
  return boundary === 'start'
    ? normalizedKnownChapterNum < upToChapterNum
    : normalizedKnownChapterNum <= upToChapterNum
}

function evaluateKnowledge(
  knownChapterNum: number | null,
  source: KnowledgeBoundaryCheckResult['source'],
  upToChapterNum: number,
  boundary: KnowledgeBoundary,
): KnowledgeBoundaryCheckResult {
  const known = isKnownAtBoundary(knownChapterNum, upToChapterNum, boundary)
  return { known, source: known ? source : 'not_known' }
}

/**
 * 判定某个事实在指定章节点之前是否已被角色知晓（纯函数）。
 *
 * 纯函数只比较已投影的 chapterNum：人物明确记录优先；仅主角且没有人物记录
 * 时才使用主角专用记录。reader 可见性不会推导角色知情。
 */
export function isFactKnownByCharacter(
  fact: StoryFactKnowledgeProjection,
  characterId: number,
  upToChapterNum: number,
  isProtagonist = false,
  options: KnowledgeBoundaryOptions = {},
): KnowledgeBoundaryCheckResult {
  const boundary = options.boundary || 'end'
  const entry = fact.characterKnowledge.find((item) => item.characterId === characterId)
  if (entry) {
    return evaluateKnowledge(entry.knownChapterNum, 'character_knowledge', upToChapterNum, boundary)
  }

  if (isProtagonist) {
    return evaluateKnowledge(fact.protagonistKnownChapterNum, 'protagonist', upToChapterNum, boundary)
  }

  return { known: false, source: 'not_known' }
}

/** reader 视图专用判定；此结果不代表任何角色已经知情。 */
export function isFactVisibleToReader(
  fact: StoryFactKnowledgeProjection,
  upToChapterNum: number,
  options: KnowledgeBoundaryOptions = {},
): KnowledgeBoundaryCheckResult {
  return evaluateKnowledge(
    fact.readerKnownChapterNum,
    'reader',
    upToChapterNum,
    options.boundary || 'end',
  )
}

/**
 * 过滤出角色在指定章节点已知的事实（纯函数）。
 * 输入必须已经完成数据库 ID→章序投影，输出仍是原始 fact row。
 */
export function filterFactsForCharacter(
  facts: ProjectedStoryFactKnowledge[],
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } & KnowledgeBoundaryOptions = {},
): StoryFactKnowledgeRow[] {
  return facts
    .filter((item) => isFactKnownByCharacter(
      item.projection,
      characterId,
      upToChapterNum,
      options.isProtagonist === true,
      options,
    ).known)
    .map((item) => item.fact)
}

/**
 * 找出在指定章节点之前，某个角色“不应知道”的事实集合——用于知识边界泄漏校验。
 * 纯函数，便于测试。
 */
export function findUnexposedFactsForCharacter(
  facts: ProjectedStoryFactKnowledge[],
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } & KnowledgeBoundaryOptions = {},
): UnknownFactForCharacter[] {
  const result: UnknownFactForCharacter[] = []
  for (const item of facts) {
    const check = isFactKnownByCharacter(
      item.projection,
      characterId,
      upToChapterNum,
      options.isProtagonist === true,
      options,
    )
    if (!check.known) {
      const diagnostics = item.diagnostics && item.diagnostics.length > 0 ? item.diagnostics : undefined
      result.push({
        fact: item.fact,
        reason: `该信息点（${item.fact.title}）尚未在 ${upToChapterNum} 章前揭示给该角色。`,
        ...(diagnostics ? { diagnostics } : {}),
      })
    }
  }
  return result
}

function addDiagnostic(
  diagnostics: KnowledgeBoundaryDiagnostic[],
  diagnostic: KnowledgeBoundaryDiagnostic,
) {
  diagnostics.push(diagnostic)
}

function resolveChapterNum(
  novelId: number,
  factId: number,
  field: KnowledgeBoundaryDiagnostic['field'],
  chapterId: number | null,
  chapterNumById: Map<number, number>,
  diagnostics: KnowledgeBoundaryDiagnostic[],
): number | null {
  if (chapterId === null) return null
  const chapterNum = chapterNumById.get(chapterId)
  if (chapterNum !== undefined) return chapterNum

  addDiagnostic(diagnostics, {
    code: 'chapter_reference_unresolved',
    factId,
    field,
    chapterId,
    message: `信息点 ${factId} 的 ${field || 'chapter'}=${chapterId} 不属于小说 ${novelId} 的现有章节，按 unknown 处理。`,
  })
  return null
}

function projectFact(
  fact: StoryFactKnowledgeRow,
  novelId: number,
  chapterNumById: Map<number, number>,
): ProjectedStoryFactKnowledge {
  const diagnostics: KnowledgeBoundaryDiagnostic[] = []
  const parsed = parseKnowledgeEntries(fact.characterKnowledgeJson)
  if (parsed.malformed) {
    addDiagnostic(diagnostics, {
      code: 'malformed_knowledge_json',
      factId: fact.id,
      field: 'characterKnowledgeJson',
      message: `信息点 ${fact.id} 的人物知情记录不是有效数组，按 unknown 处理。`,
    })
  }

  const characterKnowledge = parsed.entries.map((entry) => {
    let knownChapterNum: number | null = null
    if (entry.knownChapterId === null) {
      addDiagnostic(diagnostics, {
        code: 'knowledge_time_unknown',
        factId: fact.id,
        field: 'characterKnowledgeJson',
        characterId: entry.characterId,
        message: `信息点 ${fact.id} 的角色 ${entry.characterId} 未记录获知章序，按 unknown 处理。`,
      })
    } else {
      knownChapterNum = resolveChapterNum(
        novelId,
        fact.id,
        'characterKnowledgeJson',
        entry.knownChapterId,
        chapterNumById,
        diagnostics,
      )
    }
    return { characterId: entry.characterId, knownChapterNum }
  })

  return {
    fact,
    projection: {
      readerKnownChapterNum: resolveChapterNum(
        novelId,
        fact.id,
        'readerKnownChapterId',
        fact.readerKnownChapterId,
        chapterNumById,
        diagnostics,
      ),
      protagonistKnownChapterNum: resolveChapterNum(
        novelId,
        fact.id,
        'protagonistKnownChapterId',
        fact.protagonistKnownChapterId,
        chapterNumById,
        diagnostics,
      ),
      characterKnowledge,
    },
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  }
}

function readChapterNumById(novelId: number): Map<number, number> {
  const db = getDb()
  const rows = db.select({ id: chapters.id, chapterNum: chapters.chapterNum })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
  return new Map(rows.map((row) => [row.id, row.chapterNum] as const))
}

function loadProjectedFacts(novelId: number): ProjectedStoryFactKnowledge[] {
  const chapterNumById = readChapterNumById(novelId)
  return listKnowledgeFacts(novelId).map((fact) => projectFact(fact, novelId, chapterNumById))
}

/**
 * 读取某小说全部信息点（含知识字段），供知识边界服务使用。
 * 返回数据库原始 row，不附加投影字段。
 */
export function listKnowledgeFacts(novelId: number): StoryFactKnowledgeRow[] {
  const db = getDb()
  return db.select().from(storyFacts).where(eq(storyFacts.novelId, novelId)).all() as StoryFactKnowledgeRow[]
}

/**
 * 查询某角色在指定章节点已知的信息点（DB 版快捷入口）。
 * 章节 ID→章序映射只读取一次，并限定在 novelId 内。
 */
export function getKnownFactsForCharacter(
  novelId: number,
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } & KnowledgeBoundaryOptions = {},
): StoryFactKnowledgeRow[] {
  return filterFactsForCharacter(loadProjectedFacts(novelId), characterId, upToChapterNum, options)
}

/**
 * 查询某角色在指定章节点未知的信息点（DB 版快捷入口），用于展示“知识盲区”。
 */
export function getUnknownFactsForCharacter(
  novelId: number,
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } & KnowledgeBoundaryOptions = {},
): UnknownFactForCharacter[] {
  return findUnexposedFactsForCharacter(loadProjectedFacts(novelId), characterId, upToChapterNum, options)
}

export interface CharacterKnowledgeSnapshot {
  characterId: number
  upToChapterNum: number
  isProtagonist: boolean
  knownFacts: StoryFactKnowledgeRow[]
  unknownFacts: UnknownFactForCharacter[]
  diagnostics?: KnowledgeBoundaryDiagnostic[]
}

/**
 * 返回某角色在指定章节点的知识边界快照（已知信息点 + 未知信息点），
 * 供信息差谜题板与上下文预览展示。原 fact row 字段保持不变。
 */
export function getCharacterKnowledgeSnapshot(
  novelId: number,
  characterId: number,
  upToChapterNum: number,
  isProtagonist = false,
  options: KnowledgeBoundaryOptions = {},
): CharacterKnowledgeSnapshot {
  const projectedFacts = loadProjectedFacts(novelId)
  const unknownFacts = findUnexposedFactsForCharacter(
    projectedFacts,
    characterId,
    upToChapterNum,
    { isProtagonist, ...options },
  )
  const diagnostics = projectedFacts.flatMap((item) => item.diagnostics || [])

  return {
    characterId,
    upToChapterNum,
    isProtagonist,
    knownFacts: filterFactsForCharacter(
      projectedFacts,
      characterId,
      upToChapterNum,
      { isProtagonist, ...options },
    ),
    unknownFacts,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  }
}
