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
    throw new Error('数据库尚未初始化，请先调用 initDb()。')
  }
  return _db
}

export function getSqlite(): Database.Database {
  if (!_sqlite) {
    throw new Error('数据库尚未初始化，请先调用 initDb()。')
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
      arc_summary TEXT,
      growth_ledger TEXT,
      cost_ledger TEXT
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
      description TEXT,
      intimacy_level INTEGER,
      tension_level INTEGER,
      interaction_style TEXT,
      subtext_rule TEXT
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

    CREATE TABLE IF NOT EXISTS map_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      map_a_id INTEGER NOT NULL REFERENCES world_map(id) ON DELETE CASCADE,
      map_b_id INTEGER NOT NULL REFERENCES world_map(id) ON DELETE CASCADE,
      relation_type TEXT,
      relation_label TEXT,
      bilateral INTEGER DEFAULT 1,
      description TEXT,
      intensity TEXT,
      color_hint TEXT,
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
      issue_key TEXT,
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
      origin_meta_json TEXT,
      last_detected_at TEXT,
      resolved_at TEXT,
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
  ensureColumn(sqlite, 'character_relations', 'intimacy_level', 'INTEGER')
  ensureColumn(sqlite, 'character_relations', 'tension_level', 'INTEGER')
  ensureColumn(sqlite, 'character_relations', 'interaction_style', 'TEXT')
  ensureColumn(sqlite, 'character_relations', 'subtext_rule', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'node_type', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'structure_role', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'parent_rule_type', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'tags_json', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'affiliated_faction_ids_json', 'TEXT')
  ensureColumn(sqlite, 'world_map', 'danger_level', 'TEXT')
  ensureColumn(sqlite, 'map_relations', 'relation_type', 'TEXT')
  ensureColumn(sqlite, 'map_relations', 'relation_label', 'TEXT')
  ensureColumn(sqlite, 'map_relations', 'bilateral', 'INTEGER DEFAULT 1')
  ensureColumn(sqlite, 'map_relations', 'description', 'TEXT')
  ensureColumn(sqlite, 'map_relations', 'intensity', 'TEXT')
  ensureColumn(sqlite, 'map_relations', 'color_hint', 'TEXT')
  ensureColumn(sqlite, 'map_relations', 'sort_order', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'timeline_events', 'linked_item_ids_json', 'TEXT')
  ensureColumn(sqlite, 'timeline_events', 'volume_id', 'INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'part_id', 'INTEGER REFERENCES story_parts(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'chapter_start_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'chapter_end_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'segment_id', 'INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'anchor_invalid', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_arcs', 'growth_ledger', 'TEXT')
  ensureColumn(sqlite, 'story_arcs', 'cost_ledger', 'TEXT')
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
  ensureColumn(sqlite, 'characters', 'record_status', "TEXT DEFAULT 'confirmed'")
  ensureColumn(sqlite, 'characters', 'source_context_json', 'TEXT')
  ensureColumn(sqlite, 'story_items', 'record_status', "TEXT DEFAULT 'confirmed'")
  ensureColumn(sqlite, 'story_items', 'source_context_json', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'task_source', "TEXT DEFAULT 'manual'")
  ensureColumn(sqlite, 'revision_tasks', 'issue_key', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'task_type', "TEXT DEFAULT 'continuity'")
  ensureColumn(sqlite, 'revision_tasks', 'status', "TEXT DEFAULT 'open'")
  ensureColumn(sqlite, 'revision_tasks', 'severity', "TEXT DEFAULT 'medium'")
  ensureColumn(sqlite, 'revision_tasks', 'description', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'fix_brief', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'related_page', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'entity_type', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'entity_id', 'INTEGER')
  ensureColumn(sqlite, 'revision_tasks', 'chapter_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'revision_tasks', 'origin_meta_json', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'last_detected_at', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'resolved_at', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'revision_tasks', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'tasks', 'runner_type', "TEXT DEFAULT 'chat'")
  ensureColumn(sqlite, 'tasks', 'retryable', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'tasks', 'parent_task_id', 'INTEGER')
  ensureColumn(sqlite, 'tasks', 'current_child_task_id', 'INTEGER')
  ensureColumn(sqlite, 'tasks', 'control_json', 'TEXT')
  ensureColumn(sqlite, 'tasks', 'progress_json', 'TEXT')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      task_type TEXT NOT NULL,
      output_digest TEXT NOT NULL,
      rejected INTEGER DEFAULT 0,
      attempt_number INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  ensureColumn(sqlite, 'story_arcs', 'target_words', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_memory_checkpoints', 'last_refreshed_chapter_num', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_memory_checkpoints', 'locked', 'INTEGER DEFAULT 0')

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
    { tableName: 'story_arcs', columns: ['growth_ledger', 'cost_ledger'] },
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
      columns: ['task_source', 'issue_key', 'task_type', 'status', 'severity', 'title', 'updated_at'],
    },
    {
      tableName: 'tasks',
      columns: ['runner_type', 'retryable', 'parent_task_id', 'current_child_task_id', 'control_json', 'progress_json'],
    },
    {
      tableName: 'map_relations',
      columns: ['novel_id', 'map_a_id', 'map_b_id', 'bilateral', 'sort_order'],
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
    throw new Error(`数据库结构迁移未完成，缺少：${missing.join(', ')}`)
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

    CREATE INDEX IF NOT EXISTS idx_map_relations_novel_pair
    ON map_relations (novel_id, map_a_id, map_b_id, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_map_relations_novel_reverse_pair
    ON map_relations (novel_id, map_b_id, map_a_id, sort_order, id);

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

    CREATE INDEX IF NOT EXISTS idx_revision_tasks_issue_key
    ON revision_tasks (novel_id, task_source, issue_key, id);

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
  const existingGenres = db.select().from(schema.genres).all()
  if (existingGenres.length === 0) {
    db.insert(schema.genres).values([
      { name: '现代都市', description: '都市生活、职场、生存压力与现代关系。', isBuiltin: 1, colorTag: '#2E86AB' },
      { name: '古代言情', description: '古典情感、宫廷关系与时代规训。', isBuiltin: 1, colorTag: '#E84393' },
      { name: '玄幻修真', description: '修炼体系、宗门势力与超凡成长。', isBuiltin: 1, colorTag: '#9B59B6' },
      { name: '悬疑推理', description: '谜案、线索追查与心理博弈。', isBuiltin: 1, colorTag: '#2C3E50' },
      { name: '科幻未来', description: '未来科技、社会变迁与宏观设定。', isBuiltin: 1, colorTag: '#1ABC9C' },
      { name: '架空历史', description: '虚构历史路线下的家国与权力演化。', isBuiltin: 1, colorTag: '#D35400' },
      { name: '赛博朋克', description: '高科技、低生活与秩序失衡。', isBuiltin: 1, colorTag: '#8E44AD' },
      { name: '武侠', description: '江湖秩序、门派冲突与侠义选择。', isBuiltin: 1, colorTag: '#C0392B' },
      { name: '历史正剧', description: '历史叙事、人物命运与时代结构。', isBuiltin: 1, colorTag: '#7D6608' },
      { name: '末世求生', description: '灾变后的生存、重建与资源竞争。', isBuiltin: 1, colorTag: '#5D4037' },
      { name: '丧尸末日', description: '感染蔓延、逃亡协作与社会崩塌。', isBuiltin: 1, colorTag: '#37474F' },
      { name: '盗墓探秘', description: '古墓机关、线索破解与冒险探索。', isBuiltin: 1, colorTag: '#4E342E' },
    ]).run()
  }

  const styleTemplates: Array<typeof schema.templates.$inferInsert> = [
    {
      type: 'style',
      name: '快节奏爽感',
      description: '适合爽文和强冲突推进，优先兑现反馈与压制反打。',
      contentJson: JSON.stringify({
        perspective: '第三人称近距，紧贴当前行动视角。',
        sentence_style: '短句优先，节奏利落，少铺垫性废话，关键节点直接落动作和结果。',
        emotion_style: '情绪反馈直接，但要落在身体反应、判断和反击上，不写空喊口号。',
        dialogue_style: '对白要干脆，有锋芒，有来回压制和快速试探，不拖泥带水。',
        description_style: '环境与人物描写服务冲突和兑现，只保留最有压迫感或最有收益感的细节。',
        forbidden: ['假深沉感慨', '空泛燃句', '模板化爽点口号'],
        example_tone: '动作先行，情绪紧跟，结果要让读者立刻感到值回票价。',
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '克制写实',
      description: '适合现实流和稳态叙事，强调常识、后果与自然交流感。',
      contentJson: JSON.stringify({
        perspective: '第三人称有限视角或第一人称内省视角，以贴近人物处境为主。',
        sentence_style: '句子自然克制，保留必要停顿和观察，不追求华丽堆叠。',
        emotion_style: '情绪通过动作、犹豫、沉默和后果显现，不直接替人物总结。',
        dialogue_style: '对白贴近真实身份、关系和场景压力，避免统一腔调。',
        description_style: '多写环境约束、资源消耗、伤病负担和现实细节，让事件可信。',
        forbidden: ['悬浮金句', '无根据升温', '说明书式心理分析'],
        example_tone: '先把人放回处境，再写他会怎么说、怎么忍、怎么付代价。',
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '细腻言情',
      description: '适合关系驱动型叙事，重点写温差、试探、误会与情感推进。',
      contentJson: JSON.stringify({
        perspective: '近距离贴角色感受，但不过度自我解说。',
        sentence_style: '节奏有呼吸感，保留停顿、转折和未说出口的部分。',
        emotion_style: '情绪放在称呼变化、眼神、肢体、回避、照顾和误判里。',
        dialogue_style: '对白要有潜台词和情绪温差，亲密关系不能说成普通同事口吻。',
        description_style: '重点捕捉人与人之间的距离变化，而不是空写氛围形容词。',
        forbidden: ['工业糖精句式', '空心虐感宣言', '脱离情境的心动独白'],
        example_tone: '一句称呼变了，一个动作慢了半拍，关系就已经往前推了一格。',
      }),
      isBuiltin: 1,
    },
    {
      type: 'style',
      name: '冷感悬疑',
      description: '适合悬疑与调查推进，强调信息差、压迫感和线索回收。',
      contentJson: JSON.stringify({
        perspective: '第三人称有限视角，优先保留未知与误判空间。',
        sentence_style: '句子收紧，信息分段释放，避免一次性解释完。',
        emotion_style: '情绪偏压抑和警觉，通过细微异常与反常反应推进。',
        dialogue_style: '对白要带试探、遮掩和信息差，不轻易把底牌翻出来。',
        description_style: '环境描写服务线索、风险和不安，不写观光式场景说明。',
        forbidden: ['过度剧透', '故作玄虚', '无意义惊叹号'],
        example_tone: '先让读者察觉不对，再让人物意识到危险，答案最后再露面。',
      }),
      isBuiltin: 1,
    },
  ]

  const worldTemplates: Array<typeof schema.templates.$inferInsert> = [
    {
      type: 'world',
      name: '现代都市底盘',
      description: '适合都市、职场、现实关系类题材，强调真实社会结构。',
      contentJson: JSON.stringify({
        time_period: '当代',
        technology_level: '现代城市基础设施与互联网社会。',
        social_structure: '家庭、学校、公司、平台和阶层流动共同塑造人物选择。',
        common_elements: ['职场压力', '住房成本', '亲密关系', '社交媒体', '现实规则'],
        forbidden_elements: ['脱离现实的万能资源', '无后果的身份跃迁'],
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '宫廷家国',
      description: '适合古代言情、朝堂博弈和门第婚配叙事。',
      contentJson: JSON.stringify({
        time_period: '古代王朝架空时期',
        technology_level: '冷兵器与传统交通，信息传递依赖人力与制度。',
        social_structure: '皇权、家族、门第、婚姻和礼法共同分配利益与风险。',
        common_elements: ['宗族关系', '礼法规训', '婚配联盟', '朝堂压力', '身份尊卑'],
        forbidden_elements: ['现代平权话术直贴', '无制度成本的越级抗命'],
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '宗门修真',
      description: '适合玄幻修真和仙侠成长，强调资源、境界与因果秩序。',
      contentJson: JSON.stringify({
        time_period: '架空修真时代',
        technology_level: '超凡能力与法器体系并存，凡俗与修行世界长期分层。',
        social_structure: '宗门、世家、秘境、资源点和境界差距决定地位与冲突。',
        common_elements: ['境界晋升', '灵脉资源', '宗门派系', '秘境试炼', '因果报应'],
        forbidden_elements: ['无根基秒升境界', '没有代价的天降机缘'],
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '赛博失衡都市',
      description: '适合赛博朋克和高科技低生活叙事，强调系统压迫与资源垄断。',
      contentJson: JSON.stringify({
        time_period: '近未来',
        technology_level: '高密度数字网络、改造技术和企业控制基础设施。',
        social_structure: '企业、帮派、平台系统和底层社区并行争夺秩序。',
        common_elements: ['义体改造', '监控系统', '黑市交易', '数据垄断', '阶层断裂'],
        forbidden_elements: ['没有副作用的高科技', '脱离系统代价的自由行动'],
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '末世废土',
      description: '适合末世求生和秩序重建，强调资源、感染和信任成本。',
      contentJson: JSON.stringify({
        time_period: '灾变后数年到数十年',
        technology_level: '残存旧时代设施与低效手工补给系统并存。',
        social_structure: '聚落、武装、物资分配和信任链决定生存资格。',
        common_elements: ['食水补给', '感染风险', '避难聚落', '路线选择', '人性博弈'],
        forbidden_elements: ['忽略生存链的空抒情', '无限补给'],
      }),
      isBuiltin: 1,
    },
    {
      type: 'world',
      name: '架空王朝风云',
      description: '适合历史正剧和架空历史，强调制度、地理与权力结构。',
      contentJson: JSON.stringify({
        time_period: '中前工业时代的架空王朝',
        technology_level: '农业、手工业与传统军事体系为主。',
        social_structure: '王权、官僚、地方豪强、宗族和边地势力长期角力。',
        common_elements: ['州府边军', '税赋徭役', '门阀联盟', '地理阻隔', '政治风向'],
        forbidden_elements: ['现代组织逻辑硬套', '跳过制度成本的改革奇迹'],
      }),
      isBuiltin: 1,
    },
  ]

  const existingTemplates = db.select().from(schema.templates).all()
  const allTemplates = [...styleTemplates, ...worldTemplates]

  if (existingTemplates.length === 0) {
    db.insert(schema.templates).values(allTemplates).run()
    return
  }

  const existingTemplateNames = new Set(existingTemplates.map((template) => template.name))
  const newTemplates = allTemplates.filter((template) => !existingTemplateNames.has(template.name))
  if (newTemplates.length > 0) {
    db.insert(schema.templates).values(newTemplates).run()
  }
}
