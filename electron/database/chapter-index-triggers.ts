import type Database from 'better-sqlite3'

/** Persist index invalidation and refresh in the same transaction as the saved prose. */
export function installChapterIndexTriggers(sqlite: Database.Database): void {
  // Some supported repair fixtures contain only selected legacy tables. Installing a
  // trigger against an absent source would make all later migrations fail to open.
  const tableExists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
  if (['chapters', 'chapter_embeddings', 'semantic_memory_outbox'].some(name => !tableExists.get(name))) return
  const enqueue = `
    INSERT INTO semantic_memory_outbox (novel_id, source_type, source_id, operation, context_version)
    VALUES (NEW.novel_id, 'chapter', NEW.id, 'upsert', COALESCE(NEW.context_version, 1))
    ON CONFLICT(novel_id, source_type, source_id) DO UPDATE SET
      operation = excluded.operation,
      revision = semantic_memory_outbox.revision + 1, status = 'pending', attempts = 0,
      available_at = CURRENT_TIMESTAMP, locked_at = NULL, last_error = NULL,
      context_version = excluded.context_version, updated_at = CURRENT_TIMESTAMP;
  `
  const keyword = `
    INSERT INTO chapter_embeddings (novel_id, chapter_id, fragment_type, fragment_text, context_version, visibility)
    VALUES (NEW.novel_id, NEW.id, 'content_excerpt', substr(NEW.content, 1, 1800), COALESCE(NEW.context_version, 1), 'canon');
  `
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_chapters_index_insert AFTER INSERT ON chapters
    WHEN length(trim(COALESCE(NEW.content, ''))) > 0 BEGIN ${keyword} ${enqueue} END;
    CREATE TRIGGER IF NOT EXISTS trg_chapters_index_update AFTER UPDATE OF content, novel_id ON chapters
    WHEN NEW.content IS NOT OLD.content OR NEW.novel_id IS NOT OLD.novel_id BEGIN
      DELETE FROM chapter_embeddings WHERE chapter_id = OLD.id;
      DELETE FROM semantic_memory_outbox WHERE source_type = 'chapter' AND source_id = OLD.id AND novel_id = OLD.novel_id AND (NEW.novel_id IS NOT OLD.novel_id OR length(trim(COALESCE(NEW.content, ''))) = 0);
      INSERT INTO chapter_embeddings (novel_id, chapter_id, fragment_type, fragment_text, context_version, visibility)
        SELECT NEW.novel_id, NEW.id, 'content_excerpt', substr(NEW.content, 1, 1800), COALESCE(NEW.context_version, 1), 'canon'
        WHERE length(trim(COALESCE(NEW.content, ''))) > 0;
      INSERT INTO semantic_memory_outbox (novel_id, source_type, source_id, operation, context_version)
        SELECT NEW.novel_id, 'chapter', NEW.id, 'upsert', COALESCE(NEW.context_version, 1) WHERE length(trim(COALESCE(NEW.content, ''))) > 0
        ON CONFLICT(novel_id, source_type, source_id) DO UPDATE SET
          operation = excluded.operation,
          revision = semantic_memory_outbox.revision + 1, status = 'pending', attempts = 0,
          available_at = CURRENT_TIMESTAMP, locked_at = NULL, last_error = NULL,
          context_version = excluded.context_version, updated_at = CURRENT_TIMESTAMP;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_chapters_index_delete AFTER DELETE ON chapters BEGIN
      DELETE FROM semantic_memory_outbox WHERE source_type = 'chapter' AND source_id = OLD.id AND novel_id = OLD.novel_id;
    END;
    INSERT INTO chapter_embeddings (novel_id, chapter_id, fragment_type, fragment_text, context_version, visibility)
      SELECT c.novel_id, c.id, 'content_excerpt', substr(c.content, 1, 1800), COALESCE(c.context_version, 1), 'canon'
      FROM chapters c WHERE length(trim(COALESCE(c.content, ''))) > 0
        AND NOT EXISTS (SELECT 1 FROM chapter_embeddings e WHERE e.chapter_id = c.id AND e.fragment_type LIKE 'content_excerpt%');
    INSERT INTO semantic_memory_outbox (novel_id, source_type, source_id, operation, context_version)
      SELECT c.novel_id, 'chapter', c.id, 'upsert', COALESCE(c.context_version, 1)
      FROM chapters c WHERE length(trim(COALESCE(c.content, ''))) > 0
      ON CONFLICT(novel_id, source_type, source_id) DO NOTHING;
  `)
}
