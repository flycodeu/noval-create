import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type Database from 'better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'

const states = new WeakMap<Database.Database, { version: string | null; error?: string }>()
export function vectorExtensionStatus(db: Database.Database) {
  if (!states.has(db)) {
    try {
      const original = getLoadablePath()
      const unpacked = original.replace(/\.asar([/\\])/, '.asar.unpacked$1')
      db.loadExtension(fs.existsSync(unpacked) ? unpacked : original)
      states.set(db, { version: (db.prepare('SELECT vec_version() AS version').get() as { version: string }).version })
    } catch {
      // Persisted native triggers must not prevent ordinary chapter saves when a DLL is missing.
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'chapter_vec_*'").all() as Array<{ name: string }>
      for (const trigger of triggers) if (/^chapter_vec_[a-f0-9]{24}_(insert|update|delete|chapter_order)$/.test(trigger.name)) db.exec(`DROP TRIGGER "${trigger.name}"`)
      states.set(db, { version: null, error: '向量扩展未加载，当前使用文字检索与完整候选扫描。' })
    }
  }
  return states.get(db)!
}
const tables = new WeakMap<Database.Database, Set<string>>()
function ensureProfile(db: Database.Database, profile: string, dimensions: number): string {
  if (!vectorExtensionStatus(db).version) throw new Error('sqlite-vec 不可用。')
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 8192) throw new Error('向量维度无效。')
  const table = `chapter_vec_${createHash('sha256').update(`${profile}:${dimensions}`).digest('hex').slice(0, 24)}`
  const initialized = tables.get(db) || new Set<string>()
  if (initialized.has(table)) return table
  const literal = `'${profile.replace(/'/g, "''")}'`
  const prose = "(NEW.fragment_type='content_excerpt' OR NEW.fragment_type LIKE 'content_excerpt:%')"
  const valid = `CASE WHEN json_valid(NEW.embedding_json) THEN json_type(NEW.embedding_json)='array' AND json_array_length(NEW.embedding_json)=${dimensions} AND NOT EXISTS (SELECT 1 FROM json_each(NEW.embedding_json) WHERE type NOT IN ('integer','real') OR abs(value)>3.4e38) AND EXISTS (SELECT 1 FROM json_each(NEW.embedding_json) WHERE value!=0) ELSE 0 END`
  db.transaction(() => {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(embedding float[${dimensions}] distance_metric=cosine, novel_id integer partition key, chapter_num integer, chapter_id integer, is_prose boolean);
      CREATE TRIGGER IF NOT EXISTS ${table}_insert AFTER INSERT ON chapter_embeddings WHEN NEW.embedding_profile=${literal} AND NEW.dimensions=${dimensions} AND (${valid}) BEGIN
        INSERT INTO ${table}(rowid,embedding,novel_id,chapter_num,chapter_id,is_prose) SELECT NEW.id,vec_f32(NEW.embedding_json),NEW.novel_id,chapter_num,NEW.chapter_id,${prose} FROM chapters WHERE id=NEW.chapter_id;
      END;
      CREATE TRIGGER IF NOT EXISTS ${table}_delete AFTER DELETE ON chapter_embeddings BEGIN DELETE FROM ${table} WHERE rowid=OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS ${table}_update AFTER UPDATE ON chapter_embeddings BEGIN
        DELETE FROM ${table} WHERE rowid=OLD.id;
        INSERT INTO ${table}(rowid,embedding,novel_id,chapter_num,chapter_id,is_prose) SELECT NEW.id,vec_f32(NEW.embedding_json),NEW.novel_id,chapter_num,NEW.chapter_id,${prose} FROM chapters WHERE id=NEW.chapter_id AND NEW.embedding_profile=${literal} AND NEW.dimensions=${dimensions} AND (${valid});
      END;
      CREATE TRIGGER IF NOT EXISTS ${table}_chapter_order AFTER UPDATE OF chapter_num ON chapters BEGIN
        DELETE FROM ${table} WHERE chapter_id=NEW.id;
        INSERT INTO ${table}(rowid,embedding,novel_id,chapter_num,chapter_id,is_prose)
          SELECT e.id,vec_f32(e.embedding_json),e.novel_id,NEW.chapter_num,e.chapter_id,(e.fragment_type='content_excerpt' OR e.fragment_type LIKE 'content_excerpt:%')
          FROM chapter_embeddings e WHERE e.chapter_id=NEW.id AND e.novel_id=NEW.novel_id AND e.embedding_profile=${literal} AND e.dimensions=${dimensions} AND (${valid.replaceAll('NEW.embedding_json', 'e.embedding_json')});
      END;`)
    // Reconcile after each reopen, including edits made while the extension was unavailable.
    db.exec(`DELETE FROM ${table}`)
    const rows = db.prepare(`SELECT e.id,e.embedding_json,e.novel_id,e.chapter_id,c.chapter_num,e.fragment_type FROM chapter_embeddings e JOIN chapters c ON c.id=e.chapter_id WHERE e.embedding_profile=? AND e.dimensions=? AND e.embedding_json IS NOT NULL AND e.novel_id=c.novel_id`).all(profile, dimensions) as Array<{ id: number; embedding_json: string; novel_id: number; chapter_id: number; chapter_num: number; fragment_type: string }>
    const insert = db.prepare(`INSERT INTO ${table}(rowid,embedding,novel_id,chapter_num,chapter_id,is_prose) VALUES(?,?,?,?,?,?)`)
    for (const row of rows) {
      try {
        const vector = JSON.parse(row.embedding_json)
        if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every((v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 3.4e38) || !vector.some((v: number) => v !== 0)) continue
        insert.run(BigInt(row.id), Buffer.from(new Float32Array(vector).buffer), BigInt(row.novel_id), BigInt(row.chapter_num), BigInt(row.chapter_id), BigInt(row.fragment_type === 'content_excerpt' || row.fragment_type.startsWith('content_excerpt:')))
      } catch (error) { if (!(error instanceof SyntaxError)) throw error }
    }
  })()
  initialized.add(table); tables.set(db, initialized)
  return table
}
export function searchChapterVectors(db: Database.Database, input: { novelId: number; profile: string; dimensions: number; vector: number[]; topK: number; beforeChapterNum?: number; proseOnly?: boolean }) {
  const table = ensureProfile(db, input.profile, input.dimensions)
  return db.prepare(`SELECT v.distance,e.chapter_id AS chapterId,c.chapter_num AS chapterNum,e.fragment_type AS fragmentType,e.fragment_text AS fragmentText
    FROM (SELECT rowid,distance FROM ${table} WHERE embedding MATCH ? AND k=? AND novel_id=? ${input.beforeChapterNum === undefined ? '' : 'AND chapter_num < ?'} ${input.proseOnly ? 'AND is_prose=1' : ''}) v
    JOIN chapter_embeddings e ON e.id=v.rowid JOIN chapters c ON c.id=e.chapter_id WHERE c.novel_id=? ORDER BY v.distance,e.id`)
    .all(Buffer.from(new Float32Array(input.vector).buffer), BigInt(input.topK), BigInt(input.novelId), ...(input.beforeChapterNum === undefined ? [] : [BigInt(input.beforeChapterNum)]), BigInt(input.novelId)) as Array<{ distance: number; chapterId: number; chapterNum: number; fragmentType: string; fragmentText: string }>
}
