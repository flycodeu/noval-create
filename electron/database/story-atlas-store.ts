import type Database from 'better-sqlite3'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSource } from '../../src/shared/story-atlas'

export type AtlasRecord = StoryAtlasEntity | StoryAtlasRelation
export interface AtlasStoredRecord {
  record: AtlasRecord
  recordType: 'entity' | 'relation'
  nativeTable: string | null
  nativeId: number | null
  retired: boolean
}
type Row = Record<string, unknown>
const text = (v: unknown) => typeof v === 'string' ? v : ''
const num = (v: unknown) => Number(v) || 0
function json(v: unknown): unknown { try { return JSON.parse(text(v)) } catch { return undefined } }
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
function attributes(row: Row, omit: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => !omit.includes(key) && value !== null)
    .map(([key, value]) => [camel(key.replace(/_json$/, '')), key.endsWith('_json') ? json(value) ?? value : value]))
}

/** One-time data migration, not a second live source of story truth. */
export function migrateStoryAtlas(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_atlas_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL,
      record_type TEXT NOT NULL CHECK(record_type IN ('entity','relation')),
      effective_from_chapter INTEGER NOT NULL CHECK(effective_from_chapter >= 0),
      status TEXT NOT NULL CHECK(status IN ('confirmed','planned','retired')),
      snapshot_json TEXT NOT NULL,
      native_table TEXT,
      native_id INTEGER,
      context_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_story_atlas_revision_lookup
      ON story_atlas_revisions(novel_id,record_id,effective_from_chapter,id);
    CREATE TABLE IF NOT EXISTS story_atlas_changes (
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(novel_id,idempotency_key)
    );
  `)
  const exists = (table: string) => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  const rows = (table: string): Row[] => exists(table) ? sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[] : []
  const versions = new Map(rows('novels').map((row) => [num(row.id), num(row.context_version) || 1]))
  const initializedNovels = new Set((sqlite.prepare('SELECT DISTINCT novel_id FROM story_atlas_revisions').all() as Array<{ novel_id: number }>).map((row) => row.novel_id))
  const chapterNums = new Map(rows('chapters').map((row) => [num(row.id), num(row.chapter_num)]))
  const source = (table: string, row: Row): StoryAtlasSource => ({ kind: table, id: String(row.id), note: '从项目已有记录迁移；未推断未记载的剧情。' })
  const inserted = new Set<string>()
  const add = (novelId: number, item: AtlasStoredRecord) => {
    if (initializedNovels.has(novelId)) return
    const key = `${novelId}/${item.record.id}`
    if (inserted.has(key) || sqlite.prepare('SELECT 1 FROM story_atlas_revisions WHERE novel_id=? AND record_id=?').get(novelId, item.record.id)) return
    insertAtlasRevision(sqlite, novelId, item, versions.get(novelId) || 1)
    inserted.add(key)
  }
  const specs = [
    ['world_map', 'location', 'name', 'description'], ['characters', 'character', 'full_name', 'background'],
    ['factions', 'faction', 'name', 'notes'], ['story_items', 'item', 'item_name', 'summary'],
    ['timeline_events', 'event', 'event_title', 'event_summary'],
  ] as const
  for (const [table, kind, nameKey, summaryKey] of specs) for (const row of rows(table)) {
    const chapter = kind === 'event' ? chapterNums.get(num(row.chapter_start_id)) || 0 : kind === 'character' ? num(row.appear_chapter) : 0
    add(num(row.novel_id), { recordType: 'entity', nativeTable: table, nativeId: num(row.id), retired: false, record: {
      id: `${kind}:${row.id}`, kind, name: text(row[nameKey]), summary: text(row[summaryKey]),
      parentId: kind === 'location' && row.parent_id ? `location:${row.parent_id}` : null,
      attributes: attributes(row, ['id', 'novel_id', nameKey, summaryKey, 'parent_id', 'created_at', 'updated_at']),
      status: row.record_status === 'draft' || row.record_status === 'planned' || (kind === 'event' && row.status === 'planned') ? 'planned' : 'confirmed',
      effectiveFromChapter: chapter, source: source(table, row),
    } })
  }
  const relation = (table: string, row: Row, kind: StoryAtlasRelation['kind'], fromId: string, toId: string, label: string, chapter = 0, planned = false) => {
    add(num(row.novel_id), { recordType: 'relation', nativeTable: table, nativeId: num(row.id) || null, retired: false, record: {
      id: `${kind}:${table}:${row.id}`, kind, fromId, toId, label, effectiveFromChapter: chapter,
      status: planned ? 'planned' : 'confirmed', source: source(table, row),
      attributes: attributes(row, ['id', 'novel_id', 'char_a_id', 'char_b_id', 'map_a_id', 'map_b_id', 'created_at', 'updated_at']),
    } })
  }
  const pairs = new Set<string>()
  for (const row of rows('character_relations')) {
    relation('character_relations', row, 'relationship', `character:${row.char_a_id}`, `character:${row.char_b_id}`, text(row.relation_label) || text(row.relation_type) || '关系待分类')
    pairs.add(`${row.novel_id}:${[num(row.char_a_id), num(row.char_b_id)].sort((a, b) => a - b).join(':')}`)
  }
  for (const row of rows('relationship_arcs')) {
    if (pairs.has(`${row.novel_id}:${[num(row.char_a_id), num(row.char_b_id)].sort((a, b) => a - b).join(':')}`)) continue
    const chapter = chapterNums.get(num(row.last_progress_chapter_id)) || 0
    relation('relationship_arcs', row, 'relationship', `character:${row.char_a_id}`, `character:${row.char_b_id}`,
      text(row.relation_label_snapshot) || '关系待分类', chapter, !chapter)
  }
  for (const row of rows('map_relations')) relation('map_relations', row, 'route', `location:${row.map_a_id}`, `location:${row.map_b_id}`, text(row.relation_label) || text(row.relation_type) || '路线')
  for (const row of rows('character_location_binding')) relation('character_location_binding', row, 'presence', `character:${row.character_id}`, `location:${row.map_node_id}`, text(row.binding_type) || '位于', chapterNums.get(num(row.chapter_start_id)) || 0, !row.is_canonical)
  for (const row of rows('story_items')) {
    if (row.owner_character_id) relation('story_items', { ...row, id: `${row.id}:owner` }, 'ownership', `character:${row.owner_character_id}`, `item:${row.id}`, '持有')
    if (row.location_map_id) relation('story_items', { ...row, id: `${row.id}:location` }, 'presence', `item:${row.id}`, `location:${row.location_map_id}`, '位于')
  }
  for (const row of rows('characters')) {
    const ids = json(row.camp_faction_ids_json)
    if (Array.isArray(ids)) for (const id of ids.filter((value) => Number.isInteger(Number(value)))) relation('characters', { ...row, id: `${row.id}:${id}` }, 'membership', `character:${row.id}`, `faction:${id}`, '所属')
  }
  for (const row of rows('timeline_events')) {
    const ids = json(row.present_character_ids_json)
    if (Array.isArray(ids)) for (const id of ids) relation('timeline_events', { ...row, id: `${row.id}:${id}` }, 'participation', `character:${id}`, `event:${row.id}`, '参与', chapterNums.get(num(row.chapter_start_id)) || 0, row.status === 'planned')
  }
}

export function insertAtlasRevision(sqlite: Database.Database, novelId: number, item: AtlasStoredRecord, contextVersion: number): void {
  sqlite.prepare(`INSERT INTO story_atlas_revisions
    (novel_id,record_id,record_type,effective_from_chapter,status,snapshot_json,native_table,native_id,context_version)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(novelId, item.record.id, item.recordType, item.record.effectiveFromChapter,
    item.retired ? 'retired' : item.record.status, JSON.stringify(item.record), item.nativeTable, item.nativeId, contextVersion)
}

export function readAtlasRecords(sqlite: Database.Database, novelId: number, atChapter?: number, includePlanned = true): AtlasStoredRecord[] {
  const where = ['novel_id = ?']
  const args: unknown[] = [novelId]
  if (atChapter !== undefined) { where.push('effective_from_chapter <= ?'); args.push(atChapter) }
  if (!includePlanned) where.push("status <> 'planned'")
  const rows = sqlite.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER
    (PARTITION BY record_id ORDER BY effective_from_chapter DESC,id DESC) AS rank
    FROM story_atlas_revisions WHERE ${where.join(' AND ')}) WHERE rank=1`).all(...args) as Row[]
  return rows.map((row) => ({ record: JSON.parse(text(row.snapshot_json)) as AtlasRecord, recordType: row.record_type as AtlasStoredRecord['recordType'],
    nativeTable: text(row.native_table) || null, nativeId: row.native_id === null ? null : num(row.native_id), retired: row.status === 'retired' }))
}
