import { getSqlite } from '../database/db'

export interface CharacterLocationSignalRow {
  characterId: number
  locationName: string
  startChapterNum?: number | null
  endChapterNum?: number | null
  confidence?: number | null
  isCanonical?: number | null
}

function normalizeLimit(limit: number): number {
  return Math.max(1, Math.min(24, Math.round(limit || 1)))
}

function activityRank(row: CharacterLocationSignalRow, chapterNum: number): number {
  return row.endChapterNum == null || row.endChapterNum >= chapterNum ? 0 : 1
}

/**
 * Selects a compact set of current or most recently known character locations.
 * Active canonical bindings win, followed by the latest historical binding.
 */
export function selectBoundLocationNames(
  rows: CharacterLocationSignalRow[],
  chapterNum: number,
  limit: number,
): string[] {
  const boundedLimit = normalizeLimit(limit)
  const normalizedChapterNum = Math.max(1, Math.round(chapterNum || 1))
  const ordered = rows
    .filter((row) => row.locationName.trim())
    .filter((row) => row.startChapterNum == null || row.startChapterNum <= normalizedChapterNum)
    .sort((left, right) => (
      activityRank(left, normalizedChapterNum) - activityRank(right, normalizedChapterNum)
      || Number(right.isCanonical || 0) - Number(left.isCanonical || 0)
      || Number(right.startChapterNum || 0) - Number(left.startChapterNum || 0)
      || Number(right.confidence || 0) - Number(left.confidence || 0)
      || left.characterId - right.characterId
      || left.locationName.localeCompare(right.locationName, 'zh-CN')
    ))

  const names: string[] = []
  const seen = new Set<string>()
  for (const row of ordered) {
    const name = row.locationName.trim()
    const key = name.toLocaleLowerCase('zh-CN')
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= boundedLimit) break
  }
  return names
}

export function loadBoundLocationNamesForCharacters(input: {
  novelId: number
  characterIds: number[]
  chapterNum: number
  limit: number
}): string[] {
  const novelId = Math.max(0, Math.round(input.novelId || 0))
  const characterIds = [...new Set(input.characterIds
    .map((id) => Math.round(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!novelId || characterIds.length === 0) return []

  const boundedLimit = normalizeLimit(input.limit)
  const rowLimit = Math.min(256, Math.max(boundedLimit * 8, characterIds.length * 4))
  const placeholders = characterIds.map(() => '?').join(',')
  const rows = getSqlite().prepare(`
    SELECT
      binding.character_id AS characterId,
      map.name AS locationName,
      start_chapter.chapter_num AS startChapterNum,
      end_chapter.chapter_num AS endChapterNum,
      binding.confidence AS confidence,
      binding.is_canonical AS isCanonical
    FROM character_location_binding binding
    INNER JOIN world_map map
      ON map.id = binding.map_node_id AND map.novel_id = binding.novel_id
    LEFT JOIN chapters start_chapter ON start_chapter.id = binding.chapter_start_id
    LEFT JOIN chapters end_chapter ON end_chapter.id = binding.chapter_end_id
    WHERE binding.novel_id = ?
      AND binding.character_id IN (${placeholders})
      AND (start_chapter.chapter_num IS NULL OR start_chapter.chapter_num <= ?)
    ORDER BY
      CASE
        WHEN end_chapter.chapter_num IS NULL OR end_chapter.chapter_num >= ? THEN 0
        ELSE 1
      END ASC,
      binding.is_canonical DESC,
      COALESCE(start_chapter.chapter_num, 0) DESC,
      binding.confidence DESC,
      binding.id DESC
    LIMIT ?
  `).all(
    novelId,
    ...characterIds,
    Math.max(1, Math.round(input.chapterNum || 1)),
    Math.max(1, Math.round(input.chapterNum || 1)),
    rowLimit,
  ) as CharacterLocationSignalRow[]

  return selectBoundLocationNames(rows, input.chapterNum, boundedLimit)
}
