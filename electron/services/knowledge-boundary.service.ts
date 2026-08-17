import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { storyFacts } from '../database/schema'

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

export interface KnowledgeBoundaryCheckResult {
  /** 事实是否在该章节点之前已被角色知晓。 */
  known: boolean
  /** 判定依据：protagonist | character_knowledge | reader | not_known */
  source: 'protagonist' | 'character_knowledge' | 'reader' | 'not_known'
}

function parseKnowledgeEntries(raw: string | null | undefined): CharacterKnowledgeEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        characterId: typeof entry.characterId === 'number' ? entry.characterId : Number(entry.characterId ?? 0),
        knownChapterId: typeof entry.knownChapterId === 'number' ? entry.knownChapterId : null,
      }))
      .filter((entry) => Number.isInteger(entry.characterId) && entry.characterId > 0)
  } catch {
    return []
  }
}

/**
 * 判定某个事实在指定章节点之前是否已被角色知晓（纯函数，便于测试）。
 *
 * 判定顺序：
 * 1. 主角（isProtagonist=true）且事实的 protagonistKnownChapterId 不晚于当前章节；
 * 2. 该角色在 characterKnowledgeJson 中登记的 knownChapterId 不晚于当前章节；
 * 3. 事实已对读者揭示（readerKnownChapterId 不晚于当前章节）时，角色默认知情；
 * 4. 其余视为未知。
 */
export function isFactKnownByCharacter(
  fact: Pick<StoryFactKnowledgeRow, 'protagonistKnownChapterId' | 'readerKnownChapterId' | 'characterKnowledgeJson'>,
  characterId: number,
  upToChapterNum: number,
  isProtagonist = false,
): KnowledgeBoundaryCheckResult {
  if (isProtagonist && typeof fact.protagonistKnownChapterId === 'number' && fact.protagonistKnownChapterId > 0) {
    if (fact.protagonistKnownChapterId <= upToChapterNum) {
      return { known: true, source: 'protagonist' }
    }
    return { known: false, source: 'not_known' }
  }

  const entries = parseKnowledgeEntries(fact.characterKnowledgeJson)
  const entry = entries.find((item) => item.characterId === characterId)
  if (entry) {
    if (typeof entry.knownChapterId === 'number' && entry.knownChapterId > 0) {
      return entry.knownChapterId <= upToChapterNum
        ? { known: true, source: 'character_knowledge' }
        : { known: false, source: 'not_known' }
    }
    return { known: true, source: 'character_knowledge' }
  }

  if (typeof fact.readerKnownChapterId === 'number' && fact.readerKnownChapterId > 0) {
    return fact.readerKnownChapterId <= upToChapterNum
      ? { known: true, source: 'reader' }
      : { known: false, source: 'not_known' }
  }

  return { known: false, source: 'not_known' }
}

/**
 * 过滤出角色在指定章节点已知的事实（用于组装角色 POV 上下文）。
 * 纯函数，便于测试。
 */
export function filterFactsForCharacter(
  facts: StoryFactKnowledgeRow[],
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } = {},
): StoryFactKnowledgeRow[] {
  return facts.filter((fact) => isFactKnownByCharacter(fact, characterId, upToChapterNum, options.isProtagonist).known)
}

/**
 * 找出在指定章节点之前，某个角色"不应知道"的事实集合——用于知识边界泄漏校验。
 * 纯函数，便于测试。
 */
export function findUnexposedFactsForCharacter(
  facts: StoryFactKnowledgeRow[],
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } = {},
): Array<{ fact: StoryFactKnowledgeRow; reason: string }> {
  const result: Array<{ fact: StoryFactKnowledgeRow; reason: string }> = []
  for (const fact of facts) {
    const check = isFactKnownByCharacter(fact, characterId, upToChapterNum, options.isProtagonist)
    if (!check.known) {
      result.push({ fact, reason: `该信息点（${fact.title}）尚未在 ${upToChapterNum} 章前揭示给该角色。` })
    }
  }
  return result
}

/**
 * 读取某小说全部信息点（含知识字段），供知识边界服务使用。
 */
export function listKnowledgeFacts(novelId: number): StoryFactKnowledgeRow[] {
  const db = getDb()
  return db.select().from(storyFacts).where(eq(storyFacts.novelId, novelId)).all()
}

/**
 * 查询某角色在指定章节点已知的信息点（DB 版快捷入口）。
 */
export function getKnownFactsForCharacter(
  novelId: number,
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } = {},
): StoryFactKnowledgeRow[] {
  return filterFactsForCharacter(listKnowledgeFacts(novelId), characterId, upToChapterNum, options)
}

/**
 * 查询某角色在指定章节点未知的信息点（DB 版快捷入口），用于展示"知识盲区"。
 */
export function getUnknownFactsForCharacter(
  novelId: number,
  characterId: number,
  upToChapterNum: number,
  options: { isProtagonist?: boolean } = {},
): Array<{ fact: StoryFactKnowledgeRow; reason: string }> {
  return findUnexposedFactsForCharacter(listKnowledgeFacts(novelId), characterId, upToChapterNum, options)
}

export interface CharacterKnowledgeSnapshot {
  characterId: number
  upToChapterNum: number
  isProtagonist: boolean
  knownFacts: StoryFactKnowledgeRow[]
  unknownFacts: Array<{ fact: StoryFactKnowledgeRow; reason: string }>
}

/**
 * 返回某角色在指定章节点的知识边界快照（已知信息点 + 未知信息点），
 * 供信息差谜题板与上下文预览展示。
 */
export function getCharacterKnowledgeSnapshot(
  novelId: number,
  characterId: number,
  upToChapterNum: number,
  isProtagonist = false,
): CharacterKnowledgeSnapshot {
  const facts = listKnowledgeFacts(novelId)
  return {
    characterId,
    upToChapterNum,
    isProtagonist,
    knownFacts: filterFactsForCharacter(facts, characterId, upToChapterNum, { isProtagonist }),
    unknownFacts: findUnexposedFactsForCharacter(facts, characterId, upToChapterNum, { isProtagonist }),
  }
}
