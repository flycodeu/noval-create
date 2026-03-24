import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import path from 'path'
import * as schema from './schema'
import { normalizeWorldRules, stringifyWorldRules, type GenreWorldRules } from '../../src/shared/genre-system'

type AppDatabase = BetterSQLite3Database<typeof schema>

let _db: AppDatabase | null = null
let _sqlite: Database.Database | null = null

export function getDb(): AppDatabase {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _db
}

export function getSqlite(): Database.Database {
  if (!_sqlite) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _sqlite
}

export function initDb(): AppDatabase {
  if (_db) return _db

  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'novelforge.db')

  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')

  _db = drizzle(_sqlite, { schema })

  runMigrations(_sqlite)
  seedBuiltinData(_db)

  return _db
}

export function closeDb() {
  if (_sqlite) {
    _sqlite.close()
    _sqlite = null
    _db = null
  }
}

function runMigrations(sqlite: Database.Database) {
  // 手动建表（使用 better-sqlite3 直接执行 SQL）
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS genres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_builtin INTEGER DEFAULT 1,
      color_tag TEXT
    );

    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      synopsis TEXT,
      genre_id INTEGER REFERENCES genres(id),
      status TEXT DEFAULT 'draft',
      total_words INTEGER DEFAULT 0,
      target_words INTEGER DEFAULT 200000,
      cover_image TEXT,
      user_background TEXT,
      expanded_background TEXT,
      project_brief_json TEXT,
      settings_json TEXT,
      theme_voice_json TEXT,
      world_rules_json TEXT,
      style_template_id INTEGER,
      world_template_id INTEGER,
      context_version INTEGER DEFAULT 1,
      model_config_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      volume_number INTEGER NOT NULL,
      title TEXT,
      summary TEXT,
      target_words INTEGER DEFAULT 0,
      status TEXT DEFAULT 'planning',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      volume_id INTEGER NOT NULL REFERENCES story_volumes(id) ON DELETE CASCADE,
      part_number INTEGER NOT NULL,
      title TEXT,
      summary TEXT,
      target_words INTEGER DEFAULT 0,
      status TEXT DEFAULT 'planning',
      start_chapter_num INTEGER,
      end_chapter_num INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
      part_id INTEGER REFERENCES story_parts(id) ON DELETE SET NULL,
      chapter_num INTEGER NOT NULL,
      title TEXT,
      outline TEXT,
      scene_plan_json TEXT,
      content TEXT,
      word_count INTEGER DEFAULT 0,
      summary TEXT,
      next_chapter_seed TEXT,
      continuity_state_json TEXT,
      review_notes_json TEXT,
      status TEXT DEFAULT 'outline',
      ai_score_json TEXT,
      arc_id INTEGER,
      target_words INTEGER DEFAULT 3000,
      emotion_tone TEXT,
      compiled_from_segments INTEGER DEFAULT 0,
      segment_count INTEGER DEFAULT 0,
      context_version INTEGER DEFAULT 1,
      stale_reason_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapter_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
      part_id INTEGER REFERENCES story_parts(id) ON DELETE SET NULL,
      segment_order INTEGER NOT NULL,
      title TEXT,
      segment_type TEXT DEFAULT 'scene',
      purpose TEXT,
      time_anchor TEXT,
      location_name TEXT,
      present_character_ids_json TEXT,
      linked_item_ids_json TEXT,
      input_state TEXT,
      output_state TEXT,
      summary TEXT,
      content TEXT,
      risk_tags_json TEXT,
      status TEXT DEFAULT 'planned',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_arcs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      arc_name TEXT NOT NULL,
      arc_order INTEGER NOT NULL,
      chapter_start INTEGER,
      chapter_end INTEGER,
      arc_goal TEXT,
      arc_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS story_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      thread_type TEXT DEFAULT 'subplot',
      title TEXT NOT NULL,
      summary TEXT,
      premise TEXT,
      status TEXT DEFAULT 'planned',
      priority TEXT DEFAULT 'medium',
      start_chapter INTEGER,
      target_payoff_chapter INTEGER,
      payoff_condition TEXT,
      current_state TEXT,
      related_character_ids_json TEXT,
      related_item_ids_json TEXT,
      related_timeline_event_ids_json TEXT,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      role_type TEXT DEFAULT 'minor',
      entity_type TEXT DEFAULT 'human',
      species TEXT,
      surname TEXT,
      given_name TEXT,
      full_name TEXT NOT NULL,
      gender TEXT,
      age INTEGER,
      birthplace TEXT,
      active_regions_json TEXT,
      occupation TEXT,
      rank_level TEXT,
      social_identity TEXT,
      background TEXT,
      personality_traits_json TEXT,
      flaws_json TEXT,
      habits_json TEXT,
      camp_faction_ids_json TEXT,
      power_system_refs_json TEXT,
      context_hooks_json TEXT,
      goals TEXT,
      first_impression TEXT,
      surface_desire TEXT,
      deep_need TEXT,
      core_fear TEXT,
      inner_conflict TEXT,
      hidden_secret TEXT,
      moral_line TEXT,
      self_deception TEXT,
      trauma TEXT,
      contradiction TEXT,
      relationship_tension TEXT,
      resonance_point TEXT,
      character_arc TEXT,
      parent_ids_json TEXT,
      appearance_json TEXT,
      abilities_json TEXT,
      appear_chapter INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS character_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      char_a_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      char_b_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      relation_type TEXT,
      relation_label TEXT,
      bilateral INTEGER DEFAULT 1,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS world_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      level INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      location_type TEXT,
      node_type TEXT,
      structure_role TEXT,
      parent_rule_type TEXT,
      description TEXT,
      atmosphere TEXT,
      plot_relevance TEXT,
      key_events_json TEXT,
      related_characters_json TEXT,
      tags_json TEXT,
      affiliated_faction_ids_json TEXT,
      danger_level TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      event_title TEXT NOT NULL,
      event_summary TEXT,
      time_mode TEXT DEFAULT 'custom-era',
      time_label TEXT NOT NULL,
      time_sort_value REAL DEFAULT 0,
      time_precision TEXT,
      is_major_event INTEGER DEFAULT 1,
      event_type TEXT,
      arc_id INTEGER REFERENCES story_arcs(id) ON DELETE SET NULL,
      volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
      part_id INTEGER REFERENCES story_parts(id) ON DELETE SET NULL,
      chapter_start_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      chapter_end_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      segment_id INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL,
      location_map_id INTEGER REFERENCES world_map(id) ON DELETE SET NULL,
      present_character_ids_json TEXT,
      affected_character_ids_json TEXT,
      protagonist_present INTEGER DEFAULT 0,
      protagonist_action TEXT,
      event_cause TEXT,
      event_process TEXT,
      event_result TEXT,
      linked_item_ids_json TEXT,
      direct_consequences_json TEXT,
      open_threads_json TEXT,
      notes TEXT,
      anchor_invalid INTEGER DEFAULT 0,
      status TEXT DEFAULT 'planned',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      item_kind TEXT DEFAULT 'instance',
      parent_item_id INTEGER,
      item_name TEXT NOT NULL,
      genre_family TEXT,
      category TEXT,
      sub_type TEXT,
      rarity TEXT,
      owner_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      location_map_id INTEGER REFERENCES world_map(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'available',
      summary TEXT,
      acquisition_method TEXT,
      usage_method TEXT,
      cost TEXT,
      risk TEXT,
      plot_function TEXT,
      appearance TEXT,
      faction_hint TEXT,
      linked_character_ids_json TEXT,
      linked_timeline_event_ids_json TEXT,
      tags_json TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_memory_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL,
      scope_id INTEGER,
      label TEXT,
      summary TEXT,
      resolved_threads_json TEXT,
      active_threads_json TEXT,
      character_state_digest TEXT,
      relation_digest TEXT,
      item_digest TEXT,
      timeline_digest TEXT,
      forbidden_directions_json TEXT,
      style_guard TEXT,
      source_range_start INTEGER,
      source_range_end INTEGER,
      version INTEGER DEFAULT 1,
      stale INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      api_key TEXT,
      base_url TEXT,
      temperature REAL DEFAULT 0.85,
      max_tokens INTEGER DEFAULT 4096,
      is_default INTEGER DEFAULT 0,
      extra_params_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      content_json TEXT,
      is_builtin INTEGER DEFAULT 0,
      genre_compatibility_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompt_overrides (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS revision_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      task_source TEXT DEFAULT 'manual',
      task_type TEXT DEFAULT 'continuity',
      status TEXT DEFAULT 'open',
      severity TEXT DEFAULT 'medium',
      title TEXT NOT NULL,
      description TEXT,
      fix_brief TEXT,
      related_page TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      input_json TEXT,
      output_text TEXT,
      model_config_id INTEGER,
      tokens_used INTEGER,
      duration_ms INTEGER,
      error_message TEXT,
      related_entity_type TEXT,
      related_entity_id INTEGER,
      runner_type TEXT DEFAULT 'chat',
      retryable INTEGER DEFAULT 0,
      parent_task_id INTEGER,
      current_child_task_id INTEGER,
      control_json TEXT,
      progress_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

  `)

  ensureColumn(sqlite, 'story_volumes', 'summary', 'TEXT')
  ensureColumn(sqlite, 'story_volumes', 'target_words', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_volumes', 'status', "TEXT DEFAULT 'planning'")
  ensureColumn(sqlite, 'story_volumes', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'story_volumes', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'story_parts', 'volume_id', 'INTEGER')
  ensureColumn(sqlite, 'story_parts', 'target_words', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_parts', 'status', "TEXT DEFAULT 'planning'")
  ensureColumn(sqlite, 'story_parts', 'start_chapter_num', 'INTEGER')
  ensureColumn(sqlite, 'story_parts', 'end_chapter_num', 'INTEGER')
  ensureColumn(sqlite, 'story_parts', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'story_parts', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'continuity_state_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'scene_plan_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'review_notes_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'volume_id', 'INTEGER')
  ensureColumn(sqlite, 'chapters', 'part_id', 'INTEGER')
  ensureColumn(sqlite, 'chapters', 'compiled_from_segments', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'chapters', 'segment_count', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'novels', 'project_brief_json', 'TEXT')
  ensureColumn(sqlite, 'novels', 'theme_voice_json', 'TEXT')
  ensureColumn(sqlite, 'novels', 'context_version', 'INTEGER DEFAULT 1')
  ensureColumn(sqlite, 'chapters', 'context_version', 'INTEGER DEFAULT 1')
  ensureColumn(sqlite, 'chapters', 'stale_reason_json', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'volume_id', 'INTEGER')
  ensureColumn(sqlite, 'chapter_segments', 'part_id', 'INTEGER')
  ensureColumn(sqlite, 'chapter_segments', 'title', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'segment_type', "TEXT DEFAULT 'scene'")
  ensureColumn(sqlite, 'chapter_segments', 'purpose', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'time_anchor', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'location_name', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'present_character_ids_json', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'linked_item_ids_json', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'input_state', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'output_state', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'summary', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'content', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'risk_tags_json', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'status', "TEXT DEFAULT 'planned'")
  ensureColumn(sqlite, 'chapter_segments', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'chapter_segments', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'characters', 'entity_type', "TEXT DEFAULT 'human'")
  ensureColumn(sqlite, 'characters', 'species', 'TEXT')
  ensureColumn(sqlite, 'characters', 'surface_desire', 'TEXT')
  ensureColumn(sqlite, 'characters', 'deep_need', 'TEXT')
  ensureColumn(sqlite, 'characters', 'core_fear', 'TEXT')
  ensureColumn(sqlite, 'characters', 'inner_conflict', 'TEXT')
  ensureColumn(sqlite, 'characters', 'hidden_secret', 'TEXT')
  ensureColumn(sqlite, 'characters', 'moral_line', 'TEXT')
  ensureColumn(sqlite, 'characters', 'self_deception', 'TEXT')
  ensureColumn(sqlite, 'characters', 'trauma', 'TEXT')
  ensureColumn(sqlite, 'characters', 'contradiction', 'TEXT')
  ensureColumn(sqlite, 'characters', 'relationship_tension', 'TEXT')
  ensureColumn(sqlite, 'characters', 'resonance_point', 'TEXT')
  ensureColumn(sqlite, 'characters', 'character_arc', 'TEXT')
  ensureColumn(sqlite, 'characters', 'rank_level', 'TEXT')
  ensureColumn(sqlite, 'characters', 'social_identity', 'TEXT')
  ensureColumn(sqlite, 'characters', 'camp_faction_ids_json', 'TEXT')
  ensureColumn(sqlite, 'characters', 'power_system_refs_json', 'TEXT')
  ensureColumn(sqlite, 'characters', 'context_hooks_json', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'node_type', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'structure_role', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'parent_rule_type', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'tags_json', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'affiliated_faction_ids_json', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'danger_level', 'TEXT')
  ensureColumn(sqlite, 'timeline_events', 'linked_item_ids_json', 'TEXT')
  ensureColumn(sqlite, 'timeline_events', 'volume_id', 'INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'part_id', 'INTEGER REFERENCES story_parts(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'chapter_start_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'chapter_end_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'segment_id', 'INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'anchor_invalid', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_threads', 'thread_type', "TEXT DEFAULT 'subplot'")
  ensureColumn(sqlite, 'story_threads', 'summary', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'premise', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'status', "TEXT DEFAULT 'planned'")
  ensureColumn(sqlite, 'story_threads', 'priority', "TEXT DEFAULT 'medium'")
  ensureColumn(sqlite, 'story_threads', 'start_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'target_payoff_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'payoff_condition', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'current_state', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'related_character_ids_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'related_item_ids_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'related_timeline_event_ids_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'notes', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'sort_order', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_threads', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'task_source', "TEXT DEFAULT 'manual'")
  ensureColumn(sqlite, 'revision_tasks', 'task_type', "TEXT DEFAULT 'continuity'")
  ensureColumn(sqlite, 'revision_tasks', 'status', "TEXT DEFAULT 'open'")
  ensureColumn(sqlite, 'revision_tasks', 'severity', "TEXT DEFAULT 'medium'")
  ensureColumn(sqlite, 'revision_tasks', 'description', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'fix_brief', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'related_page', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'entity_type', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'entity_id', 'INTEGER')
  ensureColumn(sqlite, 'revision_tasks', 'chapter_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'revision_tasks', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'tasks', 'runner_type', "TEXT DEFAULT 'chat'")
  ensureColumn(sqlite, 'tasks', 'retryable', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'tasks', 'parent_task_id', 'INTEGER')
  ensureColumn(sqlite, 'tasks', 'current_child_task_id', 'INTEGER')
  ensureColumn(sqlite, 'tasks', 'control_json', 'TEXT')
  ensureColumn(sqlite, 'tasks', 'progress_json', 'TEXT')

  ensureIndexes(sqlite)
  migrateWorldRules(sqlite)
  backfillCharacterTaxonomy(sqlite)
  backfillMapTaxonomy(sqlite)
  backfillStoryItems(sqlite)
  backfillContextMetadata(sqlite)
  backfillStoryStructureLinks(sqlite)
  backfillStoryStructureMetadata(sqlite)
  backfillPlanningWorkspaceData(sqlite)
  backfillTimelineStructureAnchors(sqlite)
  validateRequiredSchema(sqlite)
}

function ensureColumn(
  sqlite: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string,
) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  if (columns.some((column) => column.name === columnName)) return

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`)
}

function hasTable(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
  return Boolean(row)
}

function getColumnNames(sqlite: Database.Database, tableName: string): Set<string> {
  if (!hasTable(sqlite, tableName)) {
    return new Set()
  }

  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function validateRequiredSchema(sqlite: Database.Database) {
  const requirements = [
    { tableName: 'novels', columns: ['project_brief_json', 'theme_voice_json'] },
    {
      tableName: 'story_threads',
      columns: [
        'thread_type',
        'title',
        'status',
        'priority',
        'related_character_ids_json',
        'related_item_ids_json',
        'related_timeline_event_ids_json',
        'sort_order',
      ],
    },
    {
      tableName: 'revision_tasks',
      columns: ['task_source', 'task_type', 'status', 'severity', 'title', 'updated_at'],
    },
    {
      tableName: 'tasks',
      columns: ['runner_type', 'retryable', 'parent_task_id', 'current_child_task_id', 'control_json', 'progress_json'],
    },
  ]

  const missing: string[] = []

  requirements.forEach(({ tableName, columns }) => {
    if (!hasTable(sqlite, tableName)) {
      missing.push(`table ${tableName}`)
      return
    }

    const existing = getColumnNames(sqlite, tableName)
    columns.forEach((columnName) => {
      if (!existing.has(columnName)) {
        missing.push(`column ${tableName}.${columnName}`)
      }
    })
  })

  if (missing.length > 0) {
    throw new Error(`Database schema migration incomplete. Missing ${missing.join(', ')}`)
  }
}

function ensureIndexes(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_timeline_events_novel_sort
    ON timeline_events (novel_id, time_sort_value, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_timeline_events_volume
    ON timeline_events (novel_id, volume_id, time_sort_value, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_timeline_events_part
    ON timeline_events (novel_id, part_id, time_sort_value, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_timeline_events_segment
    ON timeline_events (novel_id, segment_id, time_sort_value, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_timeline_events_status
    ON timeline_events (novel_id, status, time_sort_value, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_story_volumes_novel_order
    ON story_volumes (novel_id, volume_number, id);

    CREATE INDEX IF NOT EXISTS idx_story_parts_volume_order
    ON story_parts (volume_id, part_number, id);

    CREATE INDEX IF NOT EXISTS idx_chapters_part_order
    ON chapters (part_id, chapter_num, id);

    CREATE INDEX IF NOT EXISTS idx_chapters_novel_order
    ON chapters (novel_id, chapter_num, id);

    CREATE INDEX IF NOT EXISTS idx_chapter_segments_chapter_order
    ON chapter_segments (chapter_id, segment_order, id);

    CREATE INDEX IF NOT EXISTS idx_story_memory_checkpoints_scope
    ON story_memory_checkpoints (novel_id, scope_type, scope_id, version);

    CREATE INDEX IF NOT EXISTS idx_story_threads_novel_order
    ON story_threads (novel_id, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_story_threads_novel_status
    ON story_threads (novel_id, status, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_revision_tasks_novel_updated
    ON revision_tasks (novel_id, updated_at, id);

    CREATE INDEX IF NOT EXISTS idx_revision_tasks_novel_status
    ON revision_tasks (novel_id, status, updated_at, id);

    CREATE INDEX IF NOT EXISTS idx_tasks_novel_updated
    ON tasks (novel_id, updated_at, id);

    CREATE INDEX IF NOT EXISTS idx_tasks_status_updated
    ON tasks (status, updated_at, id);

    CREATE INDEX IF NOT EXISTS idx_tasks_parent
    ON tasks (parent_task_id, created_at, id);
  `)
}

function getGenreNameMap(sqlite: Database.Database): Map<number, string> {
  const rows = sqlite.prepare('SELECT id, name FROM genres').all() as Array<{ id: number; name: string }>
  return new Map(rows.map((row) => [row.id, row.name]))
}

function parseWorldRulesForMigration(raw?: string | null): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return {}
  }
}

function migrateWorldRules(sqlite: Database.Database) {
  const genreMap = getGenreNameMap(sqlite)
  const rows = sqlite.prepare('SELECT id, genre_id, world_rules_json FROM novels').all() as Array<{
    id: number
    genre_id?: number | null
    world_rules_json?: string | null
  }>
  const update = sqlite.prepare('UPDATE novels SET world_rules_json = ? WHERE id = ?')

  for (const row of rows) {
    const genreName = typeof row.genre_id === 'number' ? genreMap.get(row.genre_id) : undefined
    const normalized = normalizeWorldRules(parseWorldRulesForMigration(row.world_rules_json), genreName)
    update.run(stringifyWorldRules(normalized as GenreWorldRules), row.id)
  }
}

function backfillTimelineStructureAnchors(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE timeline_events
    SET
      chapter_start_id = COALESCE(
        chapter_start_id,
        (SELECT chapter_id FROM chapter_segments WHERE chapter_segments.id = timeline_events.segment_id)
      ),
      chapter_end_id = COALESCE(
        chapter_end_id,
        (SELECT chapter_id FROM chapter_segments WHERE chapter_segments.id = timeline_events.segment_id)
      )
    WHERE segment_id IS NOT NULL;

    UPDATE timeline_events
    SET
      part_id = COALESCE(
        (SELECT part_id FROM chapter_segments WHERE chapter_segments.id = timeline_events.segment_id),
        (SELECT part_id FROM chapters WHERE chapters.id = COALESCE(timeline_events.chapter_start_id, timeline_events.chapter_end_id)),
        (SELECT story_parts.id FROM story_parts WHERE story_parts.id = timeline_events.part_id)
      ),
      volume_id = COALESCE(
        (SELECT volume_id FROM chapter_segments WHERE chapter_segments.id = timeline_events.segment_id),
        (SELECT volume_id FROM chapters WHERE chapters.id = COALESCE(timeline_events.chapter_start_id, timeline_events.chapter_end_id)),
        (SELECT volume_id FROM story_parts WHERE story_parts.id = timeline_events.part_id),
        (SELECT story_volumes.id FROM story_volumes WHERE story_volumes.id = timeline_events.volume_id)
      );

    UPDATE timeline_events
    SET volume_id = (
      SELECT volume_id
      FROM story_parts
      WHERE story_parts.id = timeline_events.part_id
    )
    WHERE part_id IS NOT NULL;

    UPDATE timeline_events
    SET anchor_invalid = 0
    WHERE anchor_invalid IS NULL;
  `)
}

function backfillCharacterTaxonomy(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE characters
    SET entity_type = COALESCE(NULLIF(entity_type, ''), 'human')
  `)

  sqlite.exec(`
    UPDATE characters
    SET species = CASE
      WHEN species IS NOT NULL AND species <> '' THEN species
      WHEN entity_type = 'human' THEN '人类'
      ELSE species
    END
  `)

  sqlite.exec(`
    UPDATE characters
    SET camp_faction_ids_json = COALESCE(camp_faction_ids_json, '[]'),
        power_system_refs_json = COALESCE(power_system_refs_json, '[]'),
        context_hooks_json = COALESCE(context_hooks_json, '[]')
  `)
}

function backfillMapTaxonomy(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE world_map
    SET node_type = CASE
      WHEN node_type IS NOT NULL AND node_type <> '' THEN node_type
      WHEN level = 1 THEN '区域'
      WHEN level = 2 THEN '子区域'
      ELSE COALESCE(location_type, '地点')
    END,
        structure_role = COALESCE(structure_role, ''),
        parent_rule_type = COALESCE(parent_rule_type, ''),
        tags_json = COALESCE(tags_json, '[]'),
        affiliated_faction_ids_json = COALESCE(affiliated_faction_ids_json, '[]'),
        danger_level = COALESCE(danger_level, '')
  `)
}

function backfillStoryItems(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE story_items
    SET item_kind = COALESCE(NULLIF(item_kind, ''), 'instance'),
        status = COALESCE(NULLIF(status, ''), 'available'),
        linked_character_ids_json = COALESCE(linked_character_ids_json, '[]'),
        linked_timeline_event_ids_json = COALESCE(linked_timeline_event_ids_json, '[]'),
        tags_json = COALESCE(tags_json, '[]')
  `)

  sqlite.exec(`
    UPDATE timeline_events
    SET linked_item_ids_json = COALESCE(linked_item_ids_json, '[]')
  `)
}

function backfillStoryStructureLinks(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE story_volumes
    SET target_words = COALESCE(target_words, 0),
        status = COALESCE(NULLIF(status, ''), 'planning');

    UPDATE story_parts
    SET
      volume_id = COALESCE(
        volume_id,
        (
          SELECT c.volume_id
          FROM chapters c
          WHERE c.part_id = story_parts.id
            AND c.volume_id IS NOT NULL
          ORDER BY c.chapter_num ASC, c.id ASC
          LIMIT 1
        ),
        (
          SELECT v.id
          FROM story_volumes v
          WHERE v.novel_id = story_parts.novel_id
          ORDER BY v.volume_number ASC, v.id ASC
          LIMIT 1
        )
      ),
      target_words = COALESCE(target_words, 0),
      status = COALESCE(NULLIF(status, ''), 'planning'),
      start_chapter_num = COALESCE(
        start_chapter_num,
        (SELECT MIN(c.chapter_num) FROM chapters c WHERE c.part_id = story_parts.id)
      ),
      end_chapter_num = COALESCE(
        end_chapter_num,
        (SELECT MAX(c.chapter_num) FROM chapters c WHERE c.part_id = story_parts.id)
      );

    UPDATE chapters
    SET
      volume_id = COALESCE(
        volume_id,
        (SELECT p.volume_id FROM story_parts p WHERE p.id = chapters.part_id)
      ),
      compiled_from_segments = COALESCE(compiled_from_segments, 0),
      segment_count = COALESCE(segment_count, 0);

    UPDATE chapter_segments
    SET
      part_id = COALESCE(
        part_id,
        (SELECT c.part_id FROM chapters c WHERE c.id = chapter_segments.chapter_id)
      ),
      volume_id = COALESCE(
        volume_id,
        (SELECT c.volume_id FROM chapters c WHERE c.id = chapter_segments.chapter_id)
      ),
      present_character_ids_json = COALESCE(present_character_ids_json, '[]'),
      linked_item_ids_json = COALESCE(linked_item_ids_json, '[]'),
      risk_tags_json = COALESCE(risk_tags_json, '[]'),
      segment_type = COALESCE(NULLIF(segment_type, ''), 'scene'),
      status = COALESCE(NULLIF(status, ''), 'planned');
  `)
}

function backfillContextMetadata(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE novels
    SET context_version = COALESCE(context_version, 1)
  `)

  sqlite.exec(`
    UPDATE chapters
    SET context_version = COALESCE(context_version, 1),
        stale_reason_json = COALESCE(stale_reason_json, '[]')
  `)

  sqlite.exec(`
    UPDATE tasks
    SET runner_type = COALESCE(NULLIF(runner_type, ''), 'chat'),
        retryable = COALESCE(retryable, 0),
        control_json = COALESCE(control_json, '{}'),
        progress_json = COALESCE(progress_json, '{}')
  `)
}

function backfillStoryStructureMetadata(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE chapters
    SET compiled_from_segments = COALESCE(compiled_from_segments, 0),
        segment_count = COALESCE(segment_count, 0)
  `)

  sqlite.exec(`
    UPDATE story_memory_checkpoints
    SET resolved_threads_json = COALESCE(resolved_threads_json, '[]'),
        active_threads_json = COALESCE(active_threads_json, '[]'),
        forbidden_directions_json = COALESCE(forbidden_directions_json, '[]'),
        version = COALESCE(version, 1),
        stale = COALESCE(stale, 0)
  `)
}

function backfillPlanningWorkspaceData(sqlite: Database.Database) {
  sqlite.exec(`
    UPDATE story_threads
    SET thread_type = COALESCE(NULLIF(thread_type, ''), 'subplot'),
        status = COALESCE(NULLIF(status, ''), 'planned'),
        priority = COALESCE(NULLIF(priority, ''), 'medium'),
        related_character_ids_json = COALESCE(related_character_ids_json, '[]'),
        related_item_ids_json = COALESCE(related_item_ids_json, '[]'),
        related_timeline_event_ids_json = COALESCE(related_timeline_event_ids_json, '[]'),
        sort_order = COALESCE(sort_order, 0)
  `)

  sqlite.exec(`
    UPDATE revision_tasks
    SET task_source = COALESCE(NULLIF(task_source, ''), 'manual'),
        task_type = COALESCE(NULLIF(task_type, ''), 'continuity'),
        status = COALESCE(NULLIF(status, ''), 'open'),
        severity = COALESCE(NULLIF(severity, ''), 'medium')
  `)
}

function seedBuiltinData(db: ReturnType<typeof drizzle>) {
  // 检查是否已有数据
  const existingGenres = db.select().from(schema.genres).all()
  if (existingGenres.length === 0) {
    // 插入内置题材
    db.insert(schema.genres).values([
      { name: '现代都市', description: '以现代城市为背景的故事', isBuiltin: 1, colorTag: '#2E86AB' },
      { name: '古代言情', description: '古代背景的爱情故事', isBuiltin: 1, colorTag: '#E84393' },
      { name: '玄幻修真', description: '修仙、玄幻类奇幻故事', isBuiltin: 1, colorTag: '#9B59B6' },
      { name: '悬疑推理', description: '以谜题和推理为核心的故事', isBuiltin: 1, colorTag: '#2C3E50' },
      { name: '科幻未来', description: '以未来科技为背景的故事', isBuiltin: 1, colorTag: '#1ABC9C' },
      { name: '架空历史', description: '基于历史但有所改变的故事', isBuiltin: 1, colorTag: '#D35400' },
      { name: '赛博朋克', description: '高科技低生活的反乌托邦故事', isBuiltin: 1, colorTag: '#8E44AD' },
      { name: '武侠', description: '以武功和江湖为背景的故事', isBuiltin: 1, colorTag: '#C0392B' },
      { name: '历史正剧', description: '以真实历史为背景的正统故事', isBuiltin: 1, colorTag: '#7D6608' },
      { name: '末世求生', description: '末日灾变后的生存与重建', isBuiltin: 1, colorTag: '#5D4037' },
      { name: '丧尸末日', description: '病毒蔓延、生死逃亡与人性博弈', isBuiltin: 1, colorTag: '#37474F' },
      { name: '盗墓探秘', description: '古墓机关、神秘遗迹与寻宝冒险', isBuiltin: 1, colorTag: '#4E342E' },
    ]).run()
  } else {
    // 迁移：检查新题材是否存在，不存在则补充
    const genreNames = new Set(existingGenres.map(g => g.name))
    const newGenres = [
      { name: '末世求生', description: '末日灾变后的生存与重建', isBuiltin: 1, colorTag: '#5D4037' },
      { name: '丧尸末日', description: '病毒蔓延、生死逃亡与人性博弈', isBuiltin: 1, colorTag: '#37474F' },
      { name: '盗墓探秘', description: '古墓机关、神秘遗迹与寻宝冒险', isBuiltin: 1, colorTag: '#4E342E' },
    ].filter(g => !genreNames.has(g.name))
    if (newGenres.length > 0) {
      db.insert(schema.genres).values(newGenres).run()
    }
  }

  // 插入内置文风模板
  const styleTemplates = [
    {
      type: 'style',
      name: '冷峻叙事',
      description: '短句为主，情感克制，用行动展现情绪，适合硬派武侠或犯罪悬疑',
      contentJson: JSON.stringify({
        perspective: '第三人称有限视角',
        sentence_style: '短句为主，控制在15字以内，间隔使用长句形成节奏变化',
        emotion_style: '情感克制，用行动和对话展现情绪，避免直接描写心理',
        dialogue_style: '对话简洁，人物说话目的性强，废话少',
        description_style: '场景描写只取关键细节，不超过2句',
        forbidden: ['堆砌形容词', '过多心理独白', '环境描写超过3句'],
        example_tone: '接近硬派武侠或犯罪悬疑风格'
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '细腻情感',
      description: '深入主角内心，细腻情感描写，适合现代言情或青春成长小说',
      contentJson: JSON.stringify({
        perspective: '第一人称或第三人称限制视角（深入主角内心）',
        sentence_style: '长短句结合，情感波动时句子更短，平静时可适当延长',
        emotion_style: '允许较细腻的情感描写，但要具体，避免模糊化表达',
        dialogue_style: '对话承载情感，言外之意重要，潜台词丰富',
        description_style: '环境描写服务于情绪渲染，但不超过3句',
        forbidden: ['情绪词叠加', '过度煽情', '模糊的「难以言说」表达'],
        example_tone: '接近现代言情或青春成长小说'
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '快节奏爽文',
      description: '情节密度高，节奏快，主角情绪爽朗，适合网络爽文',
      contentJson: JSON.stringify({
        perspective: '第一或第三人称，贴近主角',
        sentence_style: '短句为主，节奏快，情节密度高',
        emotion_style: '情感直接，主角情绪爽朗或激昂，少量内心戏',
        dialogue_style: '对话推进情节，反转和打脸要干脆利落',
        description_style: '战斗/技能描写清晰，场景描写极简',
        forbidden: ['大量铺垫', '过多内心纠结', '节奏拖沓的环境描写'],
        example_tone: '网络爽文主流风格'
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '古典白话',
      description: '四字短语和文言句式穿插，接近明清白话小说',
      contentJson: JSON.stringify({
        perspective: '第三人称全知视角',
        sentence_style: '四字短语和文言句式穿插，保持流畅，不生僻',
        emotion_style: '含蓄，多用比兴手法',
        dialogue_style: '称谓得体，语气符合古代礼仪和阶级',
        description_style: '适度借鉴古典小说的白描手法',
        forbidden: ['现代词汇', '英文词', '不符合时代的表达方式'],
        example_tone: '接近明清白话小说'
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '现实主义',
      description: '贴近生活，心理刻画深入，语言朴实有力',
      contentJson: JSON.stringify({
        perspective: '第三人称全知或限制视角',
        sentence_style: '自然口语化，长短结合',
        emotion_style: '通过细节和行为揭示内心，不直白叙述',
        dialogue_style: '方言感、生活气息强，符合人物阶层',
        description_style: '环境描写有深度，承载社会意义',
        forbidden: ['过于文艺的比喻', '刻意堆砌诗意'],
        example_tone: '接近余华、路遥风格'
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '黑暗悬疑',
      description: '氛围压抑，悬念密布，叙事有迷惑性',
      contentJson: JSON.stringify({
        perspective: '第一人称不可靠叙事或第三人称限制视角',
        sentence_style: '节奏紧张时短句，铺垫时中等长度',
        emotion_style: '恐惧、不安通过细节渗透，不直接说「恐惧」',
        dialogue_style: '对话暗藏信息，读者需要主动思考',
        description_style: '环境描写充满隐喻和不安感',
        forbidden: ['过于直白的解释', '破坏悬念的叙述'],
        example_tone: '接近东野圭吾或斯蒂芬金风格'
      }),
      isBuiltin: 1,
    },
  ]

  // 插入内置世界观模板
  const worldTemplates = [
    {
      type: 'world',
      name: '修仙体系',
      description: '东方修仙世界，以境界晋升为核心',
      contentJson: JSON.stringify({
        power_system: {
          name: '修仙体系',
          levels: ['炼气', '筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'],
          rules: '境界越高，寿命越长，移山填海之力。普通人无法修炼，需有灵根。'
        },
        social_structure: '以宗门和散修为主，朝廷在修士面前形同虚设',
        common_elements: ['飞剑', '灵石', '灵药', '法宝', '秘境', '宗门'],
        forbidden_elements: ['现代科技', '枪炮', '网络', '不符合世界观的现代词汇']
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '现代社会',
      description: '以当代中国城市为背景',
      contentJson: JSON.stringify({
        time_period: '当代（2020年代）',
        technology_level: '互联网、智能手机、高铁',
        social_structure: '市场经济社会，阶层分化明显',
        common_elements: ['手机', '社交媒体', '职场', '城市生活'],
        forbidden_elements: ['不存在的科技', '穿越', '超自然现象（除非是悬疑设定）']
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '魔法世界',
      description: '西方奇幻风格，魔法与剑并存',
      contentJson: JSON.stringify({
        power_system: {
          name: '魔法体系',
          schools: ['火系', '水系', '土系', '风系', '光系', '暗系', '时空系'],
          rules: '魔法需要消耗魔力（MP），过度使用会导致魔力枯竭'
        },
        social_structure: '王国制度，贵族掌权，魔法师地位特殊',
        common_elements: ['法杖', '魔晶石', '魔法阵', '精灵', '矮人', '龙'],
        forbidden_elements: ['现代科技', '枪械（除非是蒸汽朋克设定）']
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '未来科技',
      description: '近未来或远未来的科幻世界',
      contentJson: JSON.stringify({
        time_period: '2150年后',
        technology_level: 'AI 普及、星际旅行、基因改造、量子计算',
        social_structure: '星际联盟或企业邦联',
        common_elements: ['飞船', 'AI助理', '全息投影', '基因改造人', '机甲'],
        forbidden_elements: ['魔法', '超自然现象（除非是人造的）']
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '架空古代',
      description: '参考中国古代但虚构的朝代与地理',
      contentJson: JSON.stringify({
        time_period: '虚构的封建王朝时期',
        technology_level: '冷兵器时代，农耕文明',
        social_structure: '皇权专制，士农工商四个阶层',
        common_elements: ['铁器', '马匹', '古典建筑', '科举制度', '江湖'],
        forbidden_elements: ['现代词汇', '枪炮', '汽车', '电力']
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '赛博朋克',
      description: '高科技低生活的反乌托邦未来都市',
      contentJson: JSON.stringify({
        time_period: '2077-2100年',
        technology_level: '义体改造、神经接入、AI统治、巨型企业垄断',
        social_structure: '企业城市，贫富极度分化，政府形同虚设',
        common_elements: ['义肢', '神经接口', '霓虹灯', '暗网', '黑客', '雨夜'],
        forbidden_elements: ['乌托邦式政府', '传统农耕生活']
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '末世废土',
      description: '文明崩溃后的废土世界，资源匮乏，秩序重建',
      contentJson: JSON.stringify({
        time_period: '灾变后第X年',
        technology_level: '工业文明遗迹，修理和改装为主，偶有旧世科技',
        social_structure: '部落制或要塞制，强者为尊，以物易物',
        common_elements: ['避难所', '辐射区', '废墟城市', '幸存者营地', '改装车辆', '物资争夺'],
        forbidden_elements: ['现代正常社会运转', '大型超市', '网络通信'],
        disaster_type: '可自定义：核战/病毒/天灾/外星入侵/AI叛乱'
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '丧尸世界',
      description: '病毒蔓延引发的丧尸末日，生存与人性的极限考验',
      contentJson: JSON.stringify({
        time_period: '感染爆发后数周至数年',
        technology_level: '依赖旧世界遗留物资，不再有新生产',
        social_structure: '小型幸存者群体，内外威胁并存',
        common_elements: ['感染者', '清醒幸存者', '安全区', '物资搜刮', '心理崩溃'],
        forbidden_elements: ['治愈方法（除非是核心剧情）', '大规模政府救援'],
        virus_rules: '被咬必感染，潜伏期可自设，感染者对声音/气味敏感'
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '盗墓世界',
      description: '古墓机关、神秘符文与地下文明探索',
      contentJson: JSON.stringify({
        time_period: '现代（但涉及古代文明遗迹）',
        technology_level: '现代工具与古代机关并存',
        social_structure: '地下圈子，摸金校尉、发丘中郎将等门派传承',
        common_elements: ['青铜门', '粽子（僵尸）', '搬山卸岭', '倒斗工具', '九层妖塔', '陨铁神器'],
        forbidden_elements: ['现代警察轻易介入', '机关太过现代化'],
        special_rules: '古墓中有守墓人（粽子），墓主文化影响机关风格，胆肥则财大'
      }),
      isBuiltin: 1,
    },
  ]

  // 检查模板是否已存在再插入（避免重复）
  const existingTemplates = db.select().from(schema.templates).all()
  if (existingTemplates.length === 0) {
    db.insert(schema.templates).values([...styleTemplates, ...worldTemplates]).run()
  } else {
    const existingTemplateNames = new Set(existingTemplates.map(t => t.name))
    const newTemplates = [...styleTemplates, ...worldTemplates].filter(t => !existingTemplateNames.has(t.name))
    if (newTemplates.length > 0) {
      db.insert(schema.templates).values(newTemplates).run()
    }
  }
}
