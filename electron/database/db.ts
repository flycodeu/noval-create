import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import * as schema from './schema'
import { normalizeWorldRules, stringifyWorldRules, type GenreWorldRules } from '../../src/shared/genre-system'
import { selectGenreVoiceSeedInserts } from './genre-voice-seeds'

type AppDatabase = BetterSQLite3Database<typeof schema>

const DATABASE_FILE_NAME = 'novelforge.db'

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
  const dbPath = path.join(userDataPath, DATABASE_FILE_NAME)
  fs.mkdirSync(userDataPath, { recursive: true })
  ensureLegacyElectronDatabaseCopied(userDataPath, dbPath)

  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')

  _db = drizzle(_sqlite, { schema })

  runMigrations(_sqlite)
  seedBuiltinData(_db)
  seedGenreVoiceFingerprints(_db)

  return _db
}

function ensureLegacyElectronDatabaseCopied(userDataPath: string, dbPath: string) {
  if (fs.existsSync(dbPath)) return
  if (process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY === '1') return

  const legacyDbPath = path.join(app.getPath('appData'), 'Electron', DATABASE_FILE_NAME)
  if (path.resolve(legacyDbPath) === path.resolve(dbPath) || !fs.existsSync(legacyDbPath)) return

  try {
    fs.mkdirSync(userDataPath, { recursive: true })
    for (const suffix of ['', '-wal', '-shm']) {
      const sourcePath = `${legacyDbPath}${suffix}`
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, `${dbPath}${suffix}`)
      }
    }
    console.info(`[database] Migrated legacy Electron database to ${dbPath}`)
  } catch (error) {
    console.warn('[database] Failed to migrate legacy Electron database:', error)
  }
}

export function closeDb() {
  if (_sqlite) {
    _sqlite.close()
    _sqlite = null
    _db = null
  }
}

export function runMigrations(sqlite: Database.Database) {
  ensureMigrationTable(sqlite)

  runMigrationStep(sqlite, '0001_core_schema', () => {
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
      launch_mode TEXT DEFAULT 'professional_longform',
      status TEXT DEFAULT 'draft',
      total_words INTEGER DEFAULT 0,
      target_words INTEGER DEFAULT 200000,
      cover_image TEXT,
      user_background TEXT,
      expanded_background TEXT,
      project_brief_json TEXT,
      settings_json TEXT,
      theme_voice_json TEXT,
      historical_profile_json TEXT,
      source_ledger_json TEXT,
      chapter_source_usage_json TEXT,
      fact_provenance_json TEXT,
      project_canon_profile_json TEXT,
      canon_constraint_set_json TEXT,
      canon_source_ledger_json TEXT,
      canon_fact_cards_json TEXT,
      world_rules_json TEXT,
      blurb_json TEXT,
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
      max_truth_reveal_ratio REAL,
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
      bridge_plan_json TEXT,
      continuity_state_json TEXT,
      review_notes_json TEXT,
      status TEXT DEFAULT 'outline',
      ai_score_json TEXT,
      arc_id INTEGER,
      target_words INTEGER DEFAULT 3000,
      emotion_tone TEXT,
      compiled_from_segments INTEGER DEFAULT 0,
      segment_count INTEGER DEFAULT 0,
      allowed_fact_ids_json TEXT DEFAULT '[]',
      revealed_fact_ids_json TEXT DEFAULT '[]',
      contract_audit_json TEXT,
      summary_health_json TEXT,
      expression_dedup_json TEXT,
      hook_continuity_json TEXT,
      writeback_status_json TEXT,
      context_version INTEGER DEFAULT 1,
      stale_reason_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapter_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      version_source TEXT DEFAULT 'manual-save',
      content TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      cost_ledger TEXT,
      target_words INTEGER DEFAULT 0,
      progress_percent INTEGER DEFAULT 0,
      stalled_chapter_count INTEGER DEFAULT 0,
      last_progress_chapter_num INTEGER
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
      planted_chapter INTEGER,
      last_referenced_chapter INTEGER,
      resolved_chapter INTEGER,
      reminder_interval INTEGER DEFAULT 20,
      related_character_ids_json TEXT,
      related_item_ids_json TEXT,
      related_timeline_event_ids_json TEXT,
      typed_refs_json TEXT,
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
      dramatic_engine TEXT,
      character_arc TEXT,
      parent_ids_json TEXT,
      appearance_json TEXT,
      abilities_json TEXT,
      appear_chapter INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
      related_puzzle_id INTEGER REFERENCES story_facts(id) ON DELETE SET NULL,
      kind TEXT NOT NULL DEFAULT 'clue',
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'introduced',
      reader_known_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      protagonist_known_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      character_knowledge_json TEXT DEFAULT '[]',
      forbidden_before_volume INTEGER,
      planned_reveal_volume INTEGER,
      target_reveal_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      is_key_truth INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS factions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'faction',
      goal TEXT,
      resources TEXT,
      territory_map_node_ids_json TEXT,
      leader_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      member_policy TEXT,
      current_phase TEXT,
      external_relations_json TEXT,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      term TEXT NOT NULL,
      category TEXT DEFAULT 'custom',
      definition TEXT,
      aliases_json TEXT,
      first_appear_chapter INTEGER,
      related_entity_ids_json TEXT,
      is_canonical INTEGER DEFAULT 1,
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
      typed_refs_json TEXT,
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
      typed_refs_json TEXT,
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
      max_context_tokens INTEGER,
      max_concurrency INTEGER DEFAULT 2,
      is_default INTEGER DEFAULT 0,
      extra_params_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS source_search_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'auto',
      tavily_api_key TEXT,
      brave_api_key TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS scene_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
      genre_id INTEGER REFERENCES genres(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'conflict',
      description TEXT,
      typical_beats_json TEXT,
      suggested_character_roles_json TEXT,
      emotion_arc TEXT,
      is_builtin INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompt_overrides (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prompt_override_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'save',
      protected_rule_count INTEGER NOT NULL DEFAULT 0,
      content_preview TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      idempotency_key TEXT,
      runner_type TEXT DEFAULT 'chat',
      retryable INTEGER DEFAULT 0,
      parent_task_id INTEGER,
      current_child_task_id INTEGER,
      control_json TEXT,
      progress_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_ids_json TEXT,
      operation_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      batch_key TEXT,
      before_json TEXT,
      after_json TEXT,
      undo_payload_json TEXT NOT NULL,
      undone INTEGER DEFAULT 0,
      undone_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

  `)
  })

  runMigrationStep(sqlite, '0002_additive_schema', () => {
  ensureColumn(sqlite, 'story_volumes', 'summary', 'TEXT')
  ensureColumn(sqlite, 'story_volumes', 'target_words', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_volumes', 'max_truth_reveal_ratio', 'REAL')
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
  ensureColumn(sqlite, 'chapters', 'allowed_fact_ids_json', "TEXT DEFAULT '[]'")
  ensureColumn(sqlite, 'chapters', 'revealed_fact_ids_json', "TEXT DEFAULT '[]'")
  ensureColumn(sqlite, 'chapters', 'bridge_plan_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'summary_health_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'expression_dedup_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'hook_continuity_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'writeback_status_json', 'TEXT')
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
  ensureColumn(sqlite, 'characters', 'dramatic_engine', 'TEXT')
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
  ensureColumn(sqlite, 'timeline_events', 'typed_refs_json', 'TEXT')
  ensureColumn(sqlite, 'timeline_events', 'volume_id', 'INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'part_id', 'INTEGER REFERENCES story_parts(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'chapter_start_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'chapter_end_id', 'INTEGER REFERENCES chapters(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'segment_id', 'INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL')
  ensureColumn(sqlite, 'timeline_events', 'anchor_invalid', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_arcs', 'growth_ledger', 'TEXT')
  ensureColumn(sqlite, 'story_arcs', 'cost_ledger', 'TEXT')
  ensureColumn(sqlite, 'story_arcs', 'phase_targets_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'thread_type', "TEXT DEFAULT 'subplot'")
  ensureColumn(sqlite, 'story_threads', 'summary', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'premise', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'status', "TEXT DEFAULT 'planned'")
  ensureColumn(sqlite, 'story_threads', 'priority', "TEXT DEFAULT 'medium'")
  ensureColumn(sqlite, 'story_threads', 'start_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'target_payoff_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'payoff_condition', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'current_state', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'planted_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'last_referenced_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'resolved_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'reminder_interval', 'INTEGER DEFAULT 20')
  ensureColumn(sqlite, 'story_threads', 'related_character_ids_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'related_item_ids_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'related_timeline_event_ids_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'typed_refs_json', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'notes', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'sort_order', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_threads', 'created_at', 'TEXT')
  ensureColumn(sqlite, 'story_threads', 'updated_at', 'TEXT')
  ensureColumn(sqlite, 'characters', 'record_status', "TEXT DEFAULT 'confirmed'")
  ensureColumn(sqlite, 'characters', 'source_context_json', 'TEXT')
  ensureColumn(sqlite, 'story_items', 'record_status', "TEXT DEFAULT 'confirmed'")
  ensureColumn(sqlite, 'story_items', 'source_context_json', 'TEXT')
  ensureColumn(sqlite, 'story_items', 'typed_refs_json', 'TEXT')
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
  ensureColumn(sqlite, 'model_configs', 'max_context_tokens', 'INTEGER')
  ensureColumn(sqlite, 'model_configs', 'max_concurrency', 'INTEGER DEFAULT 2')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS source_search_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'auto',
      tavily_api_key TEXT,
      brave_api_key TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO source_search_settings (id, provider)
    VALUES (1, 'auto');
  `)

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
  ensureColumn(sqlite, 'story_arcs', 'progress_percent', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_arcs', 'stalled_chapter_count', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_arcs', 'last_progress_chapter_num', 'INTEGER')
  ensureColumn(sqlite, 'story_memory_checkpoints', 'last_refreshed_chapter_num', 'INTEGER DEFAULT 0')
  ensureColumn(sqlite, 'story_memory_checkpoints', 'locked', 'INTEGER DEFAULT 0')

  // P0: 伏笔追踪字段
  ensureColumn(sqlite, 'story_threads', 'planted_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'last_referenced_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'resolved_chapter', 'INTEGER')
  ensureColumn(sqlite, 'story_threads', 'reminder_interval', 'INTEGER DEFAULT 20')

  // P0/P1: 角色语言画像字段
  ensureColumn(sqlite, 'characters', 'speech_pattern', 'TEXT')
  ensureColumn(sqlite, 'characters', 'catchphrases', 'TEXT')
  ensureColumn(sqlite, 'characters', 'vocabulary_level', 'TEXT')
  ensureColumn(sqlite, 'characters', 'dialect_features', 'TEXT')

  // P2: 物品能力规格字段
  ensureColumn(sqlite, 'story_items', 'ability_spec', 'TEXT')
  ensureColumn(sqlite, 'story_items', 'limitations', 'TEXT')

  // P3: 章节质量评分字段
  ensureColumn(sqlite, 'chapters', 'quality_scores_json', 'TEXT')
  ensureColumn(sqlite, 'chapters', 'locked_paragraphs_json', 'TEXT')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
      related_puzzle_id INTEGER REFERENCES story_facts(id) ON DELETE SET NULL,
      kind TEXT NOT NULL DEFAULT 'clue',
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'introduced',
      reader_known_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      protagonist_known_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      character_knowledge_json TEXT DEFAULT '[]',
      forbidden_before_volume INTEGER,
      planned_reveal_volume INTEGER,
      target_reveal_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      is_key_truth INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)
  })

  runMigrationStep(sqlite, '0003_indexes', () => {
    ensureIndexes(sqlite)
  })

  runMigrationStep(sqlite, '0004_backfills', () => {
    migrateWorldRules(sqlite)
    backfillCharacterTaxonomy(sqlite)
    backfillMapTaxonomy(sqlite)
    backfillStoryItems(sqlite)
    backfillContextMetadata(sqlite)
    backfillStoryStructureLinks(sqlite)
    backfillStoryStructureMetadata(sqlite)
    backfillPlanningWorkspaceData(sqlite)
    backfillTimelineStructureAnchors(sqlite)
  })

  runMigrationStep(sqlite, '0012_story_memory_context_cards', () => {
    ensureColumn(sqlite, 'story_memory_checkpoints', 'character_cards_json', 'TEXT')
    ensureColumn(sqlite, 'story_memory_checkpoints', 'relation_cards_json', 'TEXT')
    ensureColumn(sqlite, 'story_memory_checkpoints', 'item_cards_json', 'TEXT')
    ensureColumn(sqlite, 'story_memory_checkpoints', 'timeline_cards_json', 'TEXT')
    ensureColumn(sqlite, 'story_memory_checkpoints', 'thread_cards_json', 'TEXT')
  })

  runMigrationStep(sqlite, '0013_asset_modules_and_blurbs', () => {
    ensureColumn(sqlite, 'novels', 'blurb_json', 'TEXT')

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS factions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'faction',
        goal TEXT,
        resources TEXT,
        territory_map_node_ids_json TEXT,
        leader_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
        member_policy TEXT,
        current_phase TEXT,
        external_relations_json TEXT,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS glossary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        term TEXT NOT NULL,
        category TEXT DEFAULT 'custom',
        definition TEXT,
        aliases_json TEXT,
        first_appear_chapter INTEGER,
        related_entity_ids_json TEXT,
        is_canonical INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scene_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
        genre_id INTEGER REFERENCES genres(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'conflict',
        description TEXT,
        typical_beats_json TEXT,
        suggested_character_roles_json TEXT,
        emotion_arc TEXT,
        is_builtin INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_factions_novel_sort
      ON factions (novel_id, sort_order, id);

      CREATE INDEX IF NOT EXISTS idx_glossary_novel_sort
      ON glossary (novel_id, sort_order, id);

      CREATE INDEX IF NOT EXISTS idx_glossary_term
      ON glossary (novel_id, term, id);

      CREATE INDEX IF NOT EXISTS idx_scene_templates_scope
      ON scene_templates (novel_id, genre_id, is_builtin, sort_order, id);
    `)
  })

  runMigrationStep(sqlite, '0005_validate_schema', () => {
    validateRequiredSchema(sqlite)
  })

  runMigrationStep(sqlite, '0006_history_recovery', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chapter_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        version_source TEXT DEFAULT 'manual-save',
        content TEXT NOT NULL,
        word_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_ids_json TEXT,
        operation_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        batch_key TEXT,
        before_json TEXT,
        after_json TEXT,
        undo_payload_json TEXT NOT NULL,
        undone INTEGER DEFAULT 0,
        undone_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)

    ensureColumn(sqlite, 'chapter_versions', 'version_source', "TEXT DEFAULT 'manual-save'")
    ensureColumn(sqlite, 'chapter_versions', 'word_count', 'INTEGER DEFAULT 0')
    ensureColumn(sqlite, 'chapter_versions', 'created_at', 'TEXT')

    ensureColumn(sqlite, 'operation_logs', 'entity_ids_json', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'summary', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'batch_key', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'before_json', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'after_json', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'undo_payload_json', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'undone', 'INTEGER DEFAULT 0')
    ensureColumn(sqlite, 'operation_logs', 'undone_at', 'TEXT')
    ensureColumn(sqlite, 'operation_logs', 'created_at', 'TEXT')

    ensureIndexes(sqlite)
  })

  runMigrationStep(sqlite, '0007_validate_history', () => {
    validateRequiredSchema(sqlite)
    validateHistorySchema(sqlite)
  })

  runMigrationStep(sqlite, '0008_model_context_windows', () => {
    ensureColumn(sqlite, 'model_configs', 'max_context_tokens', 'INTEGER')
  })

  runMigrationStep(sqlite, '0009_validate_model_runtime', () => {
    validateRequiredSchema(sqlite)
  })

  runMigrationStep(sqlite, '0010_model_parameter_defaults', () => {
    sqlite.exec(`
      UPDATE model_configs
      SET max_tokens = 8192
      WHERE provider <> 'custom' AND COALESCE(max_tokens, 0) = 4096;

      UPDATE model_configs
      SET temperature = CASE
        WHEN provider = 'openai' THEN 0.8
        WHEN provider = 'anthropic' THEN 0.75
        WHEN provider = 'aliyun' THEN 0.85
        WHEN provider = 'baidu' THEN 0.8
        WHEN provider = 'deepseek' THEN 0.7
        WHEN provider = 'kimi' THEN 0.75
        ELSE temperature
      END
      WHERE provider <> 'custom' AND ABS(COALESCE(temperature, 0) - 0.85) < 0.000001;
    `)
  })

  runMigrationStep(sqlite, '0011_embedding_and_style_tables', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chapter_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        fragment_type TEXT NOT NULL,
        fragment_text TEXT NOT NULL,
        embedding_json TEXT,
        model_id TEXT,
        dimensions INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_chapter_embeddings_novel_type ON chapter_embeddings(novel_id, fragment_type);

      CREATE TABLE IF NOT EXISTS style_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER REFERENCES novels(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        source_text TEXT,
        fingerprint_json TEXT,
        analysis_model_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_style_fingerprints_novel ON style_fingerprints(novel_id);
    `)
  })

  runMigrationStep(sqlite, '0014_character_dialogue_fingerprints', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS character_dialogue_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        sample_chapter_start INTEGER,
        sample_chapter_end INTEGER,
        sample_count INTEGER NOT NULL DEFAULT 0,
        stats_json TEXT,
        summary_json TEXT,
        analysis_model_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_character_dialogue_fingerprints_novel_character
        ON character_dialogue_fingerprints(novel_id, character_id);
      CREATE INDEX IF NOT EXISTS idx_character_dialogue_fingerprints_novel
        ON character_dialogue_fingerprints(novel_id);
    `)
  })

  runMigrationStep(sqlite, '0015_character_state_versions', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS character_state_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        chapter_num INTEGER NOT NULL,
        injury_state TEXT,
        resource_state TEXT,
        stance_state TEXT,
        mental_state TEXT,
        relationship_heat_summary TEXT,
        goal_state TEXT,
        event_cause TEXT,
        change_reason TEXT,
        summary_text TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_character_state_versions_chapter_character
        ON character_state_versions(chapter_id, character_id);
      CREATE INDEX IF NOT EXISTS idx_character_state_versions_novel_character_chapter
        ON character_state_versions(novel_id, character_id, chapter_num);
      CREATE INDEX IF NOT EXISTS idx_character_state_versions_novel_chapter
        ON character_state_versions(novel_id, chapter_num);
    `)
  })

  runMigrationStep(sqlite, '0016_world_state_versions', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS world_state_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        entity_name TEXT NOT NULL,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        chapter_num INTEGER NOT NULL,
        state_key TEXT NOT NULL,
        state_value TEXT,
        normalized_value TEXT,
        summary_text TEXT,
        event_cause TEXT,
        change_reason TEXT,
        source_kind TEXT,
        source_ref TEXT,
        severity TEXT DEFAULT 'info',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_world_state_versions_chapter_entity_key
        ON world_state_versions(chapter_id, entity_type, entity_id, state_key);
      CREATE INDEX IF NOT EXISTS idx_world_state_versions_novel_entity_key_chapter
        ON world_state_versions(novel_id, entity_type, entity_id, state_key, chapter_num);
      CREATE INDEX IF NOT EXISTS idx_world_state_versions_novel_chapter
        ON world_state_versions(novel_id, chapter_num);
    `)
  })

  runMigrationStep(sqlite, '0017_story_arc_phase_targets', () => {
    ensureColumn(sqlite, 'story_arcs', 'phase_targets_json', 'TEXT')
  })

  runMigrationStep(sqlite, '0018_story_thread_foreshadow_columns', () => {
    ensureColumn(sqlite, 'story_threads', 'planted_chapter', 'INTEGER')
    ensureColumn(sqlite, 'story_threads', 'last_referenced_chapter', 'INTEGER')
    ensureColumn(sqlite, 'story_threads', 'resolved_chapter', 'INTEGER')
    ensureColumn(sqlite, 'story_threads', 'reminder_interval', 'INTEGER DEFAULT 20')
  })

  runMigrationStep(sqlite, '0019_endgame_assets_and_contracts', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS endgame_commitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        commitment_kind TEXT NOT NULL DEFAULT 'promise',
        title TEXT NOT NULL,
        description TEXT,
        source_order INTEGER NOT NULL DEFAULT 0,
        source_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        target_resolution_chapter INTEGER,
        last_served_chapter INTEGER,
        fulfilled_chapter INTEGER,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS foreshadow_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        detail TEXT,
        source_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        source_segment_id INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL,
        plant_method TEXT,
        salience_level TEXT NOT NULL DEFAULT 'medium',
        target_payoff_chapter INTEGER,
        payoff_method TEXT,
        payoff_scene_action TEXT,
        required_evidence TEXT,
        reader_visible_outcome TEXT,
        allowed_delay_reason TEXT,
        impact_scope TEXT NOT NULL DEFAULT 'global',
        status TEXT NOT NULL DEFAULT 'draft',
        linked_thread_id INTEGER REFERENCES story_threads(id) ON DELETE SET NULL,
        linked_endgame_commitment_id INTEGER REFERENCES endgame_commitments(id) ON DELETE SET NULL,
        linked_volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS volume_designs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        volume_id INTEGER NOT NULL REFERENCES story_volumes(id) ON DELETE CASCADE,
        volume_theme TEXT,
        volume_promise TEXT,
        main_conflict TEXT,
        climax_plan TEXT,
        end_state_shift TEXT,
        must_add_clues_json TEXT,
        must_resolve_clues_json TEXT,
        reader_expectation TEXT,
        linked_endgame_commitment_ids_json TEXT,
        linked_resistance_track_ids_json TEXT,
        audit_status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapter_contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        chapter_goal TEXT,
        opening_style TEXT,
        ending_style TEXT,
        exposition_mode TEXT,
        emotion_focus TEXT,
        served_thread_ids_json TEXT,
        required_arc_progress_json TEXT,
        required_character_arc_ids_json TEXT,
        required_relationship_arc_ids_json TEXT,
        required_resistance_track_ids_json TEXT,
        required_resistance_actions_json TEXT,
        required_asset_refs_json TEXT,
        required_endgame_commitment_ids_json TEXT,
        required_foreshadow_ids_json TEXT,
        hook_type TEXT,
        forbidden_actions_json TEXT,
        acceptance_notes_json TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scene_contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        segment_id INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL,
        pov TEXT,
        time_location TEXT,
        scene_goal TEXT,
        obstacle TEXT,
        conflict_type TEXT,
        emotion_shift TEXT,
        reveal_payload_json TEXT,
        result_state TEXT,
        linkage_mode TEXT,
        required_endgame_commitment_ids_json TEXT,
        required_foreshadow_ids_json TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_endgame_commitments_novel_kind_source
        ON endgame_commitments(novel_id, commitment_kind, source_text);
      CREATE INDEX IF NOT EXISTS idx_endgame_commitments_novel_status
        ON endgame_commitments(novel_id, status, source_order, id);
      CREATE INDEX IF NOT EXISTS idx_foreshadow_ledger_novel_status
        ON foreshadow_ledger(novel_id, status, target_payoff_chapter, id);
      CREATE INDEX IF NOT EXISTS idx_foreshadow_ledger_commitment
        ON foreshadow_ledger(linked_endgame_commitment_id, novel_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_volume_designs_volume
        ON volume_designs(volume_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_contracts_chapter
        ON chapter_contracts(chapter_id);
      CREATE INDEX IF NOT EXISTS idx_scene_contracts_chapter_segment
        ON scene_contracts(chapter_id, segment_id, id);
    `)
  })

  runMigrationStep(sqlite, '0020_backfill_endgame_assets_and_contracts', () => {
    backfillEndgameAssets(sqlite)
    backfillContractDefaults(sqlite)
  })

  runMigrationStep(sqlite, '0021_character_arc_center', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS character_arcs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        start_state TEXT,
        surface_want TEXT,
        deep_need TEXT,
        core_fear TEXT,
        misbelief TEXT,
        first_crack_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        change_event TEXT,
        change_timeline_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL,
        end_state TEXT,
        current_status TEXT NOT NULL DEFAULT 'draft',
        last_progress_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        stalled_reason TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS character_arc_beats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        arc_id INTEGER NOT NULL REFERENCES character_arcs(id) ON DELETE CASCADE,
        beat_type TEXT NOT NULL DEFAULT 'progress-note',
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        timeline_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL,
        title TEXT,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS relationship_arcs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        char_a_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        char_b_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        relation_label_snapshot TEXT,
        relation_type_snapshot TEXT,
        start_state TEXT,
        crack_point TEXT,
        change_event TEXT,
        change_timeline_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL,
        end_state TEXT,
        current_status TEXT NOT NULL DEFAULT 'draft',
        last_progress_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        stalled_reason TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_character_arcs_character
        ON character_arcs(character_id);
      CREATE INDEX IF NOT EXISTS idx_character_arcs_novel_status
        ON character_arcs(novel_id, current_status, last_progress_chapter_id, id);
      CREATE INDEX IF NOT EXISTS idx_character_arc_beats_arc_sort
        ON character_arc_beats(arc_id, sort_order, id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_arcs_pair
        ON relationship_arcs(novel_id, char_a_id, char_b_id);
      CREATE INDEX IF NOT EXISTS idx_relationship_arcs_status
        ON relationship_arcs(novel_id, current_status, last_progress_chapter_id, id);
    `)

    ensureColumn(sqlite, 'chapter_contracts', 'required_character_arc_ids_json', 'TEXT')
    ensureColumn(sqlite, 'chapter_contracts', 'required_relationship_arc_ids_json', 'TEXT')

    backfillContractDefaults(sqlite)
    sqlite.exec(`
      UPDATE chapter_contracts
      SET required_character_arc_ids_json = COALESCE(required_character_arc_ids_json, '[]'),
          required_relationship_arc_ids_json = COALESCE(required_relationship_arc_ids_json, '[]')
    `)
  })

  runMigrationStep(sqlite, '0022_resistance_system', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS resistance_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL DEFAULT 'character',
        source_id INTEGER,
        resistance_kind TEXT NOT NULL DEFAULT 'antagonist',
        title TEXT NOT NULL,
        goal TEXT,
        intel_source TEXT,
        resource_pool TEXT,
        escalation_plan TEXT,
        hero_knowledge_shift TEXT,
        stage_victory TEXT,
        counter_move TEXT,
        current_pressure_mode TEXT,
        current_status TEXT NOT NULL DEFAULT 'draft',
        last_action_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        next_escalation_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        linked_volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS resistance_beats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES resistance_tracks(id) ON DELETE CASCADE,
        beat_type TEXT NOT NULL DEFAULT 'status-note',
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        timeline_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL,
        title TEXT,
        summary TEXT,
        action_mode TEXT,
        success_level TEXT,
        counter_response TEXT,
        protagonist_impact TEXT,
        status TEXT NOT NULL DEFAULT 'logged',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_resistance_tracks_novel_kind
        ON resistance_tracks(novel_id, resistance_kind, current_status, id);
      CREATE INDEX IF NOT EXISTS idx_resistance_tracks_source
        ON resistance_tracks(novel_id, source_type, source_id, id);
      CREATE INDEX IF NOT EXISTS idx_resistance_beats_track_sort
        ON resistance_beats(track_id, sort_order, id);
    `)

    ensureColumn(sqlite, 'volume_designs', 'linked_resistance_track_ids_json', 'TEXT')
    ensureColumn(sqlite, 'chapter_contracts', 'required_resistance_track_ids_json', 'TEXT')
    ensureColumn(sqlite, 'chapter_contracts', 'required_resistance_actions_json', 'TEXT')

    backfillContractDefaults(sqlite)
    sqlite.exec(`
      UPDATE volume_designs
      SET linked_resistance_track_ids_json = COALESCE(linked_resistance_track_ids_json, '[]')
    `)
    sqlite.exec(`
      UPDATE chapter_contracts
      SET required_resistance_track_ids_json = COALESCE(required_resistance_track_ids_json, '[]'),
          required_resistance_actions_json = COALESCE(required_resistance_actions_json, '[]')
    `)
  })

  runMigrationStep(sqlite, '0023_info_gap_and_puzzle_board', () => {
    ensureColumn(sqlite, 'story_volumes', 'max_truth_reveal_ratio', 'REAL')
    ensureColumn(sqlite, 'chapters', 'allowed_fact_ids_json', "TEXT DEFAULT '[]'")
    ensureColumn(sqlite, 'chapters', 'revealed_fact_ids_json', "TEXT DEFAULT '[]'")

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS story_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
        related_puzzle_id INTEGER REFERENCES story_facts(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'clue',
        title TEXT NOT NULL,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'introduced',
        reader_known_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        protagonist_known_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        character_knowledge_json TEXT DEFAULT '[]',
        forbidden_before_volume INTEGER,
        planned_reveal_volume INTEGER,
        target_reveal_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        is_key_truth INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_story_facts_novel_kind
        ON story_facts(novel_id, kind, status, id);
      CREATE INDEX IF NOT EXISTS idx_story_facts_novel_volume
        ON story_facts(novel_id, volume_id, planned_reveal_volume, id);
      CREATE INDEX IF NOT EXISTS idx_story_facts_related_puzzle
        ON story_facts(related_puzzle_id, kind, id);
    `)

    sqlite.exec(`
      UPDATE chapters
      SET allowed_fact_ids_json = COALESCE(allowed_fact_ids_json, '[]'),
          revealed_fact_ids_json = COALESCE(revealed_fact_ids_json, '[]')
    `)
  })

  runMigrationStep(sqlite, '0024_growth_resource_cost_system', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS growth_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        track_type TEXT NOT NULL DEFAULT 'character',
        source_entity_type TEXT,
        source_entity_id INTEGER,
        source_entity_label TEXT,
        title TEXT NOT NULL,
        current_tier TEXT,
        stage_goal TEXT,
        next_goal TEXT,
        bottleneck TEXT,
        scarce_resource TEXT,
        acquire_path TEXT,
        consumption_rule TEXT,
        failure_cost TEXT,
        reward_cadence TEXT,
        linked_volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
        linked_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'active',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS resource_pools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        pool_type TEXT NOT NULL DEFAULT 'material',
        scarcity_level TEXT NOT NULL DEFAULT 'balanced',
        current_reserve TEXT,
        unit TEXT,
        replenish_path TEXT,
        consumption_rule TEXT,
        failure_cost TEXT,
        pressure_source TEXT,
        linked_volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS reward_cost_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        chapter_num_snapshot INTEGER,
        event_type TEXT NOT NULL DEFAULT 'reward',
        title TEXT NOT NULL,
        summary TEXT,
        track_id INTEGER REFERENCES growth_tracks(id) ON DELETE SET NULL,
        resource_pool_id INTEGER REFERENCES resource_pools(id) ON DELETE SET NULL,
        delta_value TEXT,
        cost_resolution_state TEXT DEFAULT 'new',
        reward_level TEXT DEFAULT 'none',
        next_bottleneck TEXT,
        linked_volume_id INTEGER REFERENCES story_volumes(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_growth_tracks_novel_type_status
        ON growth_tracks(novel_id, track_type, status, id);
      CREATE INDEX IF NOT EXISTS idx_growth_tracks_source
        ON growth_tracks(source_entity_type, source_entity_id, novel_id, id);
      CREATE INDEX IF NOT EXISTS idx_resource_pools_novel_scarcity
        ON resource_pools(novel_id, scarcity_level, id);
      CREATE INDEX IF NOT EXISTS idx_reward_cost_events_novel_chapter
        ON reward_cost_events(novel_id, chapter_num_snapshot, event_type, id);
      CREATE INDEX IF NOT EXISTS idx_reward_cost_events_track_pool
        ON reward_cost_events(track_id, resource_pool_id, chapter_num_snapshot, id);
    `)
  })

  runMigrationStep(sqlite, '0025_chapter_contract_audit', () => {
  ensureColumn(sqlite, 'chapters', 'contract_audit_json', 'TEXT')
  })

  runMigrationStep(sqlite, '0026_chapter_writeback_center', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chapter_writeback_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'draft',
        trigger_source TEXT NOT NULL DEFAULT 'manual',
        summary_text TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        source_chapter_version INTEGER,
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        failed_at TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapter_fact_extracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES chapter_writeback_runs(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL,
        source_text TEXT,
        fact_json TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapter_writeback_diffs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES chapter_writeback_runs(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        before_state_json TEXT,
        after_state_json TEXT NOT NULL,
        diff_reason TEXT,
        confidence REAL DEFAULT 0,
        canon_decision TEXT NOT NULL DEFAULT 'pending',
        writeback_status TEXT NOT NULL DEFAULT 'pending',
        writeback_error TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chapter_writeback_runs_chapter
        ON chapter_writeback_runs(chapter_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_chapter_writeback_runs_novel_status
        ON chapter_writeback_runs(novel_id, status, id DESC);
      CREATE INDEX IF NOT EXISTS idx_chapter_fact_extracts_run_asset
        ON chapter_fact_extracts(run_id, asset_type, sort_order, id);
      CREATE INDEX IF NOT EXISTS idx_chapter_writeback_diffs_run_asset
        ON chapter_writeback_diffs(run_id, asset_type, canon_decision, writeback_status, sort_order, id);
      `)
  })

  runMigrationStep(sqlite, '0027_generation_integrity_reports', () => {
    ensureColumn(sqlite, 'chapters', 'bridge_plan_json', 'TEXT')
    ensureColumn(sqlite, 'chapters', 'summary_health_json', 'TEXT')
    ensureColumn(sqlite, 'chapters', 'expression_dedup_json', 'TEXT')
    ensureColumn(sqlite, 'chapters', 'hook_continuity_json', 'TEXT')
    ensureColumn(sqlite, 'chapters', 'writeback_status_json', 'TEXT')
    ensureColumn(sqlite, 'chapter_writeback_runs', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn(sqlite, 'chapter_writeback_runs', 'last_attempt_at', 'TEXT')
    ensureColumn(sqlite, 'chapter_writeback_runs', 'source_chapter_version', 'INTEGER')
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS prompt_override_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'save',
        protected_rule_count INTEGER NOT NULL DEFAULT 0,
        content_preview TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)
  })

  runMigrationStep(sqlite, '0027_chapter_gate_runs', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chapter_gate_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        chapter_num INTEGER NOT NULL DEFAULT 0,
        gate_level TEXT NOT NULL DEFAULT 'warning',
        ready INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        rewrite_count INTEGER NOT NULL DEFAULT 0,
        blocker_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        score_breakdown_json TEXT,
        top_issue_keys_json TEXT,
        generated_task_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chapter_gate_runs_chapter
        ON chapter_gate_runs(chapter_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_chapter_gate_runs_novel_chapter
        ON chapter_gate_runs(novel_id, chapter_num, id DESC);
    `)
  })

  runMigrationStep(sqlite, '0028_task_pipeline_metadata', () => {
    ensureColumn(sqlite, 'tasks', 'pipeline_role', 'TEXT')
    ensureColumn(sqlite, 'tasks', 'pipeline_stage', 'TEXT')
    ensureColumn(sqlite, 'tasks', 'upstream_task_id', 'INTEGER')
    ensureColumn(sqlite, 'tasks', 'contract_version', 'TEXT')
    ensureColumn(sqlite, 'tasks', 'canon_run_id', 'INTEGER')
    ensureColumn(sqlite, 'tasks', 'recovery_hint_json', 'TEXT')
  })

  runMigrationStep(sqlite, '0029_chapter_recall_runtime_snapshots', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chapter_recall_runtime_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        snapshot_json TEXT NOT NULL,
        diagnostics_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'runtime',
        source_task_id INTEGER,
        context_version INTEGER DEFAULT 1,
        computed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_recall_runtime_snapshots_chapter
        ON chapter_recall_runtime_snapshots(chapter_id);
      CREATE INDEX IF NOT EXISTS idx_chapter_recall_runtime_snapshots_novel
        ON chapter_recall_runtime_snapshots(novel_id, chapter_id);
    `)
  })

  runMigrationStep(sqlite, '0030_anti_ai_rule_hits', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS anti_ai_rule_hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        chapter_num INTEGER NOT NULL,
        rule_code TEXT NOT NULL,
        rule_title TEXT,
        scope TEXT NOT NULL DEFAULT 'structure',
        severity TEXT NOT NULL DEFAULT 'medium',
        excerpt TEXT,
        source TEXT NOT NULL DEFAULT 'guardrail',
        detail TEXT,
        promoted_to_hard_constraint INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_anti_ai_rule_hits_chapter
        ON anti_ai_rule_hits(chapter_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_anti_ai_rule_hits_novel_rule
        ON anti_ai_rule_hits(novel_id, rule_code, chapter_num DESC);
      CREATE INDEX IF NOT EXISTS idx_anti_ai_rule_hits_novel_promoted
        ON anti_ai_rule_hits(novel_id, promoted_to_hard_constraint, chapter_num DESC);
    `)
    validateWorkflowRuntimeSchema(sqlite)
  })

  runMigrationStep(sqlite, '0031_foreshadow_actionized_payoff_fields', () => {
    ensureColumn(sqlite, 'foreshadow_ledger', 'payoff_scene_action', 'TEXT')
    ensureColumn(sqlite, 'foreshadow_ledger', 'required_evidence', 'TEXT')
    ensureColumn(sqlite, 'foreshadow_ledger', 'reader_visible_outcome', 'TEXT')
    ensureColumn(sqlite, 'foreshadow_ledger', 'allowed_delay_reason', 'TEXT')
  })

  runMigrationStep(sqlite, '0032_chapter_batch_workbench', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chapter_batch_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        workflow_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        summary_text TEXT,
        chapter_ids_json TEXT NOT NULL,
        chapter_nums_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        rolled_back_at TEXT,
        latest_rollback_mode TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapter_batch_inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES chapter_batch_snapshots(id) ON DELETE CASCADE,
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        chapter_num INTEGER,
        category TEXT NOT NULL DEFAULT 'continuity',
        status TEXT NOT NULL DEFAULT 'pass',
        note TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chapter_batch_rollbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES chapter_batch_snapshots(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        summary TEXT NOT NULL,
        impact_json TEXT NOT NULL,
        restored_counts_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS global_lock_libraries (
        novel_id INTEGER PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
        locked_canon_facts_json TEXT NOT NULL DEFAULT '[]',
        locked_paragraphs_json TEXT NOT NULL DEFAULT '[]',
        locked_style_rules_json TEXT NOT NULL DEFAULT '[]',
        locked_character_voice_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_batch_snapshots_task
        ON chapter_batch_snapshots(workflow_task_id);
      CREATE INDEX IF NOT EXISTS idx_chapter_batch_snapshots_novel_created
        ON chapter_batch_snapshots(novel_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_chapter_batch_inspections_snapshot
        ON chapter_batch_inspections(snapshot_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_chapter_batch_rollbacks_snapshot
        ON chapter_batch_rollbacks(snapshot_id, created_at DESC, id DESC);
    `)
  })

  runMigrationStep(sqlite, '0033_novel_launch_mode', () => {
    ensureColumn(sqlite, 'novels', 'launch_mode', "TEXT DEFAULT 'professional_longform'")
  })

  runMigrationStep(sqlite, '0034_asset_change_impacts_and_writeback_verification', () => {
    ensureColumn(sqlite, 'chapter_fact_extracts', 'verification_status', "TEXT NOT NULL DEFAULT 'auto_ready'")
    ensureColumn(sqlite, 'chapter_writeback_diffs', 'verification_status', "TEXT NOT NULL DEFAULT 'auto_ready'")

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS asset_change_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL,
        asset_id INTEGER,
        asset_label TEXT NOT NULL,
        operation TEXT NOT NULL DEFAULT 'update',
        change_reason TEXT,
        impact_level TEXT NOT NULL DEFAULT 'medium',
        triggered_by TEXT,
        payload_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS asset_change_impacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES asset_change_events(id) ON DELETE CASCADE,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id INTEGER,
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        target_label TEXT NOT NULL,
        impact_reason TEXT NOT NULL,
        detail TEXT,
        confidence REAL DEFAULT 0,
        resolution_status TEXT NOT NULL DEFAULT 'pending',
        related_task_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_asset_change_events_novel_created
        ON asset_change_events(novel_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_asset_change_events_asset
        ON asset_change_events(novel_id, asset_type, asset_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_asset_change_impacts_novel_status
        ON asset_change_impacts(novel_id, resolution_status, chapter_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_asset_change_impacts_event
        ON asset_change_impacts(event_id, target_type, target_id, id DESC);
    `)
  })

  runMigrationStep(sqlite, '0035_state_anchor_and_delta', () => {
    ensureColumn(sqlite, 'character_state_versions', 'trigger_event_id', 'INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL')
    ensureColumn(sqlite, 'character_state_versions', 'source_segment_id', 'INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL')
    ensureColumn(sqlite, 'character_state_versions', 'state_delta_json', 'TEXT')
    ensureColumn(sqlite, 'world_state_versions', 'trigger_event_id', 'INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL')
    ensureColumn(sqlite, 'world_state_versions', 'source_segment_id', 'INTEGER REFERENCES chapter_segments(id) ON DELETE SET NULL')
    ensureColumn(sqlite, 'world_state_versions', 'state_delta_json', 'TEXT')
  })

  runMigrationStep(sqlite, '0036_chapter_contract_shape_controls', () => {
    ensureColumn(sqlite, 'chapter_contracts', 'opening_style', 'TEXT')
    ensureColumn(sqlite, 'chapter_contracts', 'ending_style', 'TEXT')
    ensureColumn(sqlite, 'chapter_contracts', 'exposition_mode', 'TEXT')
    ensureColumn(sqlite, 'chapter_contracts', 'emotion_focus', 'TEXT')
  })

  runMigrationStep(sqlite, '0037_typed_ref_overlay_backfill', () => {
    ensureColumn(sqlite, 'timeline_events', 'typed_refs_json', 'TEXT')
    ensureColumn(sqlite, 'story_threads', 'typed_refs_json', 'TEXT')
    ensureColumn(sqlite, 'characters', 'record_status', "TEXT DEFAULT 'confirmed'")
    ensureColumn(sqlite, 'characters', 'source_context_json', 'TEXT')
    ensureColumn(sqlite, 'story_items', 'record_status', "TEXT DEFAULT 'confirmed'")
    ensureColumn(sqlite, 'story_items', 'source_context_json', 'TEXT')
    ensureColumn(sqlite, 'story_items', 'typed_refs_json', 'TEXT')

    sqlite.exec(`
      UPDATE characters
      SET record_status = COALESCE(NULLIF(record_status, ''), 'confirmed')
    `)

    sqlite.exec(`
      UPDATE story_items
      SET record_status = COALESCE(NULLIF(record_status, ''), 'confirmed')
    `)

    validateTypedRefOverlaySchema(sqlite)
  })

  runMigrationStep(sqlite, '0038_novel_source_canon_fields', () => {
    if (!hasTable(sqlite, 'novels')) {
      return
    }

    ensureColumn(sqlite, 'novels', 'historical_profile_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'source_ledger_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'chapter_source_usage_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'fact_provenance_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'project_canon_profile_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'canon_constraint_set_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'canon_source_ledger_json', 'TEXT')
    ensureColumn(sqlite, 'novels', 'canon_fact_cards_json', 'TEXT')
    validateRequiredSchema(sqlite, { includeNovelSourceCanonFields: true })
  })

  runMigrationStep(sqlite, '0039_character_design_columns', () => {
    if (!hasTable(sqlite, 'characters')) {
      return
    }

    ensureCharacterDesignColumns(sqlite)
    validateCharacterDesignSchema(sqlite)
  })

  runMigrationStep(sqlite, '0040_recommendation_evaluation_governance', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS recommendation_preflight_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        profile_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready', 'blocked')),
        score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
        confidence_lower_bound INTEGER NOT NULL CHECK (confidence_lower_bound BETWEEN 0 AND 100),
        coverage_rate INTEGER NOT NULL CHECK (coverage_rate BETWEEN 0 AND 100),
        blockers_json TEXT NOT NULL DEFAULT '[]',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        context_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        counted_external_attempt INTEGER NOT NULL DEFAULT 0 CHECK (counted_external_attempt = 0),
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS recommendation_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        preflight_run_id INTEGER NOT NULL REFERENCES recommendation_preflight_runs(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'locked' CHECK (status = 'locked'),
        context_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        locked_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS external_evaluation_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        candidate_id INTEGER NOT NULL REFERENCES recommendation_candidates(id) ON DELETE RESTRICT,
        source TEXT NOT NULL CHECK (source IN ('author_requested', 'platform_auto')),
        outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
        work_state_at_evaluation TEXT NOT NULL DEFAULT 'serializing' CHECK (work_state_at_evaluation IN ('serializing', 'completed')),
        failure_reason TEXT,
        evidence_completeness TEXT NOT NULL DEFAULT 'complete' CHECK (evidence_completeness IN ('complete', 'partial')),
        evidence_json TEXT NOT NULL DEFAULT '{}',
        policy_id TEXT NOT NULL,
        policy_snapshot_json TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        confirmed_by TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_recommendation_preflight_novel_created
        ON recommendation_preflight_runs(novel_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_recommendation_candidates_novel_created
        ON recommendation_candidates(novel_id, created_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_candidates_preflight
        ON recommendation_candidates(preflight_run_id);
      CREATE INDEX IF NOT EXISTS idx_external_evaluation_attempts_novel_created
        ON external_evaluation_attempts(novel_id, occurred_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_external_evaluation_attempts_idempotency
        ON external_evaluation_attempts(novel_id, idempotency_key);

      CREATE TRIGGER IF NOT EXISTS trg_external_evaluation_candidate_guard
      BEFORE INSERT ON external_evaluation_attempts
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM recommendation_candidates candidate
          WHERE candidate.id = NEW.candidate_id
            AND candidate.novel_id = NEW.novel_id
            AND candidate.status = 'locked'
        ) THEN RAISE(ABORT, 'RECOMMENDATION_CANDIDATE_INVALID') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_external_evaluation_policy_guard
      BEFORE INSERT ON external_evaluation_attempts
      BEGIN
        SELECT CASE WHEN (
          SELECT COUNT(*) FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id
        ) >= 3 THEN RAISE(ABORT, 'RECOMMENDATION_ATTEMPTS_EXHAUSTED') END;

        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id AND attempt.outcome = 'passed'
        ) THEN RAISE(ABORT, 'RECOMMENDATION_ALREADY_PASSED') END;

        SELECT CASE WHEN (
          SELECT LOWER(COALESCE(status, 'draft')) FROM novels WHERE id = NEW.novel_id
        ) = 'completed' AND EXISTS (
          SELECT 1 FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id AND attempt.outcome = 'failed'
        ) THEN RAISE(ABORT, 'RECOMMENDATION_COMPLETED_WORK_LOCKED') END;

        SELECT CASE WHEN (
          SELECT LOWER(COALESCE(status, 'draft')) FROM novels WHERE id = NEW.novel_id
        ) <> 'completed' AND (
          SELECT COUNT(*) FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id AND attempt.outcome = 'failed'
        ) >= 3 THEN RAISE(ABORT, 'RECOMMENDATION_SERIALIZING_WORK_LOCKED') END;
      END;
    `)
  })

  runMigrationStep(sqlite, '0041_agent_artifacts_approvals_and_audit', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved', 'committed', 'rejected', 'superseded')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        parent_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        content_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        context_version INTEGER NOT NULL,
        producer_type TEXT NOT NULL,
        producer_id TEXT NOT NULL,
        producer_client TEXT NOT NULL,
        model_config_id INTEGER REFERENCES model_configs(id) ON DELETE SET NULL,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        review_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
        committed_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        idempotency_key TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS approval_grants (
        id TEXT PRIMARY KEY,
        novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
        tool_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'consumed', 'rejected', 'expired')),
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tool_invocations (
        id TEXT PRIMARY KEY,
        novel_id INTEGER REFERENCES novels(id) ON DELETE SET NULL,
        run_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        tool_version TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        redacted_input_json TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('read', 'draft_write', 'canonical_write', 'external_effect')),
        approval_id TEXT,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'error', 'denied')),
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        output_hash TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_novel_kind_created
        ON artifacts(novel_id, kind, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_parent
        ON artifacts(parent_artifact_id, version DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_idempotency
        ON artifacts(novel_id, kind, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_approval_grants_lookup
        ON approval_grants(id, tool_id, status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_tool_invocations_novel_created
        ON tool_invocations(novel_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_tool_invocations_run
        ON tool_invocations(run_id, id);

      CREATE TRIGGER IF NOT EXISTS trg_artifact_content_immutable
      BEFORE UPDATE OF novel_id, kind, version, parent_artifact_id, content_json, content_hash, context_version,
        producer_type, producer_id, producer_client, model_config_id, task_id, idempotency_key
      ON artifacts
      BEGIN
        SELECT RAISE(ABORT, 'ARTIFACT_CONTENT_IMMUTABLE');
      END;
    `)
  })

  runMigrationStep(sqlite, '0042_recommendation_work_state_lock_history', () => {
    if (!hasTable(sqlite, 'external_evaluation_attempts')) {
      return
    }

    ensureColumn(
      sqlite,
      'external_evaluation_attempts',
      'work_state_at_evaluation',
      "TEXT NOT NULL DEFAULT 'serializing' CHECK (work_state_at_evaluation IN ('serializing', 'completed'))",
    )

    // Recovery tests can legitimately resume from a partial legacy schema. The
    // column is safe to add immediately; the data backfill and policy trigger
    // require the two referenced core tables to exist.
    if (!hasTable(sqlite, 'novels') || !hasTable(sqlite, 'recommendation_candidates')) {
      return
    }

    sqlite.exec(`
      UPDATE external_evaluation_attempts
      SET work_state_at_evaluation = CASE
        WHEN EXISTS (
          SELECT 1
          FROM recommendation_candidates candidate
          WHERE candidate.id = external_evaluation_attempts.candidate_id
            AND JSON_VALID(candidate.snapshot_json)
            AND LOWER(COALESCE(JSON_EXTRACT(candidate.snapshot_json, '$.novelStatus'), '')) = 'completed'
        ) THEN 'completed'
        WHEN LOWER(COALESCE((
          SELECT status FROM novels WHERE id = external_evaluation_attempts.novel_id
        ), 'draft')) = 'completed' THEN 'completed'
        ELSE 'serializing'
      END;

      DROP TRIGGER IF EXISTS trg_external_evaluation_policy_guard;
      CREATE TRIGGER trg_external_evaluation_policy_guard
      BEFORE INSERT ON external_evaluation_attempts
      BEGIN
        SELECT CASE WHEN (
          SELECT COUNT(*) FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id
        ) >= 3 THEN RAISE(ABORT, 'RECOMMENDATION_ATTEMPTS_EXHAUSTED') END;

        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id AND attempt.outcome = 'passed'
        ) THEN RAISE(ABORT, 'RECOMMENDATION_ALREADY_PASSED') END;

        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id
            AND attempt.outcome = 'failed'
            AND (
              attempt.work_state_at_evaluation = 'completed'
              OR LOWER(COALESCE((SELECT status FROM novels WHERE id = NEW.novel_id), 'draft')) = 'completed'
            )
        ) THEN RAISE(ABORT, 'RECOMMENDATION_COMPLETED_WORK_LOCKED') END;

        SELECT CASE WHEN LOWER(COALESCE((
          SELECT status FROM novels WHERE id = NEW.novel_id
        ), 'draft')) <> 'completed' AND (
          SELECT COUNT(*) FROM external_evaluation_attempts attempt
          WHERE attempt.novel_id = NEW.novel_id AND attempt.outcome = 'failed'
        ) >= 3 THEN RAISE(ABORT, 'RECOMMENDATION_SERIALIZING_WORK_LOCKED') END;
      END;
    `)
  })

  runMigrationStep(sqlite, '0043_generation_idempotency_keys', () => {
    if (hasTable(sqlite, 'tasks')) {
      ensureColumn(sqlite, 'tasks', 'idempotency_key', 'TEXT')
      sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
          ON tasks(idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `)
    }
  })

  runMigrationStep(sqlite, '0044_writeback_apply_claims', () => {
    if (hasTable(sqlite, 'chapter_writeback_runs')) {
      ensureColumn(sqlite, 'chapter_writeback_runs', 'apply_idempotency_key', 'TEXT')
      ensureColumn(sqlite, 'chapter_writeback_runs', 'apply_lock_version', 'INTEGER NOT NULL DEFAULT 0')
      sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_writeback_runs_apply_idempotency
          ON chapter_writeback_runs(apply_idempotency_key)
          WHERE apply_idempotency_key IS NOT NULL;
      `)
    }
  })

  runMigrationStep(sqlite, '0045_novel_lifecycle_mode', () => {
    if (!hasTable(sqlite, 'novels')) return

    ensureColumn(sqlite, 'novels', 'lifecycle_mode', "TEXT NOT NULL DEFAULT 'automatic'")
    sqlite.exec(`
      UPDATE novels
      SET lifecycle_mode = 'automatic'
      WHERE lifecycle_mode IS NULL OR lifecycle_mode = '';

      UPDATE novels
      SET lifecycle_mode = 'manual'
      WHERE status = 'archived';
    `)
  })

  runMigrationStep(sqlite, '0046_semantic_gate_reviews', () => {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS semantic_gate_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        chapter_id INTEGER NOT NULL,
        stage TEXT NOT NULL DEFAULT 'critic',
        mode TEXT NOT NULL DEFAULT 'shadow',
        dimensions_json TEXT NOT NULL DEFAULT '[]',
        verdicts_json TEXT NOT NULL DEFAULT '[]',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        evidence_accepted INTEGER NOT NULL DEFAULT 0,
        evidence_rejected INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        model_config_id INTEGER,
        prompt_fingerprint TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_gate_reviews_chapter
        ON semantic_gate_reviews(chapter_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_semantic_gate_reviews_novel
        ON semantic_gate_reviews(novel_id, created_at);
    `)
  })

  runMigrationStep(sqlite, '0047_style_lab', () => {
    if (hasTable(sqlite, 'style_fingerprints')) {
      ensureColumn(sqlite, 'style_fingerprints', 'source_type', "TEXT DEFAULT 'pasted'")
      ensureColumn(sqlite, 'style_fingerprints', 'source_chapter_ids_json', 'TEXT')
      ensureColumn(sqlite, 'style_fingerprints', 'stats_json', 'TEXT')
      ensureColumn(sqlite, 'style_fingerprints', 'genre_id', 'INTEGER')
    }
    if (hasTable(sqlite, 'novels')) {
      ensureColumn(sqlite, 'novels', 'active_style_fingerprint_id', 'INTEGER')
      // Backfill: pin each novel to its latest fingerprint so switching the
      // resolver from "take latest" to "take active" cannot change the style
      // of an existing project.
      if (hasTable(sqlite, 'style_fingerprints')) {
        sqlite.exec(`
          UPDATE novels
          SET active_style_fingerprint_id = (
            SELECT sf.id FROM style_fingerprints sf
            WHERE sf.novel_id = novels.id
            ORDER BY sf.id DESC
            LIMIT 1
          )
          WHERE active_style_fingerprint_id IS NULL;
        `)
      }
    }
  })

  runMigrationStep(sqlite, '0048_scene_design_fields', () => {
    // 设计层闭环（P1）：把 planner 生成的场景设计字段（hidden_agendas / irony_gap）
    // 落到 scene_contracts，供重生成延续与语义评审（design_subtext 维度）消费。
    if (hasTable(sqlite, 'scene_contracts')) {
      ensureColumn(sqlite, 'scene_contracts', 'hidden_agendas_json', 'TEXT')
      ensureColumn(sqlite, 'scene_contracts', 'irony_gap', 'TEXT')
    }
  })

  runMigrationStep(sqlite, '0049_outline_design_gate_results', () => {
    // 弧→章设计校验结果落库：每轮（首轮+重试）判定都持久化，
    // 供章节流水线查询“未消解的 flagged 记录”并向 planner / critic 传导。
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS outline_design_gate_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        arc_id INTEGER NOT NULL,
        batch_start INTEGER NOT NULL,
        batch_end INTEGER NOT NULL,
        judgeable INTEGER NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        design_terms_json TEXT NOT NULL DEFAULT '[]',
        findings_json TEXT NOT NULL DEFAULT '[]',
        corrective_directive TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_outline_design_gate_results_novel
        ON outline_design_gate_results(novel_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_outline_design_gate_results_arc
        ON outline_design_gate_results(arc_id, created_at);
    `)
  })
}

function ensureMigrationTable(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

function runMigrationStep(
  sqlite: Database.Database,
  migrationId: string,
  execute: () => void,
) {
  const existing = sqlite.prepare('SELECT id FROM _schema_migrations WHERE id = ?').get(migrationId) as { id: string } | undefined
  if (existing) return

  const transaction = sqlite.transaction(() => {
    execute()
    sqlite.prepare('INSERT INTO _schema_migrations (id, applied_at) VALUES (?, ?)').run(
      migrationId,
      new Date().toISOString(),
    )
  })
  transaction()
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

function ensureCharacterDesignColumns(sqlite: Database.Database) {
  ensureColumn(sqlite, 'characters', 'entity_type', "TEXT DEFAULT 'human'")
  ensureColumn(sqlite, 'characters', 'species', 'TEXT')
  ensureColumn(sqlite, 'characters', 'rank_level', 'TEXT')
  ensureColumn(sqlite, 'characters', 'social_identity', 'TEXT')
  ensureColumn(sqlite, 'characters', 'camp_faction_ids_json', 'TEXT')
  ensureColumn(sqlite, 'characters', 'power_system_refs_json', 'TEXT')
  ensureColumn(sqlite, 'characters', 'context_hooks_json', 'TEXT')
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
  ensureColumn(sqlite, 'characters', 'dramatic_engine', 'TEXT')
  ensureColumn(sqlite, 'characters', 'character_arc', 'TEXT')
  ensureColumn(sqlite, 'characters', 'record_status', "TEXT DEFAULT 'confirmed'")
  ensureColumn(sqlite, 'characters', 'source_context_json', 'TEXT')
  ensureColumn(sqlite, 'characters', 'speech_pattern', 'TEXT')
  ensureColumn(sqlite, 'characters', 'catchphrases', 'TEXT')
  ensureColumn(sqlite, 'characters', 'vocabulary_level', 'TEXT')
  ensureColumn(sqlite, 'characters', 'dialect_features', 'TEXT')
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

function validateRequiredSchema(
  sqlite: Database.Database,
  options: { includeNovelSourceCanonFields?: boolean } = {},
) {
  const novelColumns = [
    'project_brief_json',
    'theme_voice_json',
    'blurb_json',
  ]

  if (options.includeNovelSourceCanonFields) {
    novelColumns.splice(2, 0,
      'historical_profile_json',
      'source_ledger_json',
      'chapter_source_usage_json',
      'fact_provenance_json',
      'project_canon_profile_json',
      'canon_constraint_set_json',
      'canon_source_ledger_json',
      'canon_fact_cards_json',
    )
  }

  const requirements = [
    {
      tableName: 'novels',
      columns: novelColumns,
    },
    {
      tableName: 'story_arcs',
      columns: ['growth_ledger', 'cost_ledger', 'progress_percent', 'stalled_chapter_count', 'last_progress_chapter_num'],
    },
    { tableName: 'model_configs', columns: ['max_concurrency', 'max_context_tokens'] },
    {
      tableName: 'story_threads',
      columns: [
        'thread_type',
        'title',
        'status',
        'priority',
        'planted_chapter',
        'last_referenced_chapter',
        'resolved_chapter',
        'reminder_interval',
        'related_character_ids_json',
        'related_item_ids_json',
        'related_timeline_event_ids_json',
        'typed_refs_json',
        'sort_order',
      ],
    },
    {
      tableName: 'timeline_events',
      columns: ['linked_item_ids_json', 'typed_refs_json'],
    },
    {
      tableName: 'characters',
      columns: ['record_status', 'source_context_json'],
    },
    {
      tableName: 'story_items',
      columns: ['record_status', 'source_context_json', 'typed_refs_json'],
    },
    {
      tableName: 'revision_tasks',
      columns: ['task_source', 'issue_key', 'task_type', 'status', 'severity', 'title', 'updated_at'],
    },
    {
      tableName: 'tasks',
      columns: [
        'runner_type',
        'retryable',
        'parent_task_id',
        'current_child_task_id',
        'control_json',
        'progress_json',
      ],
    },
    {
      tableName: 'map_relations',
      columns: ['novel_id', 'map_a_id', 'map_b_id', 'bilateral', 'sort_order'],
    },
    {
      tableName: 'story_memory_checkpoints',
      columns: ['character_cards_json', 'relation_cards_json', 'item_cards_json', 'timeline_cards_json', 'thread_cards_json'],
    },
    {
      tableName: 'factions',
      columns: ['novel_id', 'name', 'type', 'territory_map_node_ids_json', 'leader_character_id', 'external_relations_json', 'sort_order'],
    },
    {
      tableName: 'glossary',
      columns: ['novel_id', 'term', 'category', 'aliases_json', 'is_canonical', 'sort_order'],
    },
    {
      tableName: 'scene_templates',
      columns: ['name', 'category', 'typical_beats_json', 'suggested_character_roles_json', 'is_builtin', 'sort_order'],
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

function validateTypedRefOverlaySchema(sqlite: Database.Database) {
  const requirements = [
    { tableName: 'timeline_events', columns: ['typed_refs_json'] },
    { tableName: 'story_threads', columns: ['typed_refs_json'] },
    { tableName: 'characters', columns: ['record_status', 'source_context_json'] },
    { tableName: 'story_items', columns: ['record_status', 'source_context_json', 'typed_refs_json'] },
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
    throw new Error(`typed ref overlay 迁移未完成，缺少：${missing.join(', ')}`)
  }
}

function validateCharacterDesignSchema(sqlite: Database.Database) {
  const requiredColumns = [
    'entity_type',
    'surface_desire',
    'deep_need',
    'core_fear',
    'inner_conflict',
    'relationship_tension',
    'resonance_point',
    'dramatic_engine',
    'character_arc',
    'record_status',
    'source_context_json',
    'speech_pattern',
    'catchphrases',
    'vocabulary_level',
    'dialect_features',
  ]
  const existing = getColumnNames(sqlite, 'characters')
  const missing = requiredColumns.filter((columnName) => !existing.has(columnName))

  if (missing.length > 0) {
    throw new Error(`数据库角色结构迁移未完成，缺少：${missing.map((columnName) => `characters.${columnName}`).join(', ')}`)
  }
}

function validateWorkflowRuntimeSchema(sqlite: Database.Database) {
  const requirements = [
    {
      tableName: 'tasks',
      columns: [
        'pipeline_role',
        'pipeline_stage',
        'upstream_task_id',
        'contract_version',
        'canon_run_id',
        'recovery_hint_json',
      ],
    },
    {
      tableName: 'chapter_recall_runtime_snapshots',
      columns: ['snapshot_json', 'diagnostics_json', 'source', 'context_version'],
    },
    {
      tableName: 'anti_ai_rule_hits',
      columns: ['rule_code', 'scope', 'severity', 'source', 'promoted_to_hard_constraint'],
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
    throw new Error(`数据库工作流运行时结构迁移未完成，缺少：${missing.join(', ')}`)
  }
}

function validateHistorySchema(sqlite: Database.Database) {
  const requirements = [
    {
      tableName: 'chapter_versions',
      columns: ['novel_id', 'chapter_id', 'version_source', 'content', 'word_count', 'created_at'],
    },
    {
      tableName: 'operation_logs',
      columns: ['novel_id', 'entity_type', 'operation_type', 'summary', 'undo_payload_json', 'undone', 'created_at'],
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
    throw new Error(`数据库历史恢复结构迁移未完成，缺少：${missing.join(', ')}`)
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

    CREATE INDEX IF NOT EXISTS idx_chapters_novel_status
    ON chapters (novel_id, status, chapter_num, id);

    CREATE INDEX IF NOT EXISTS idx_chapter_segments_chapter_order
    ON chapter_segments (chapter_id, segment_order, id);

    CREATE INDEX IF NOT EXISTS idx_story_memory_checkpoints_scope
    ON story_memory_checkpoints (novel_id, scope_type, scope_id, version);

    CREATE INDEX IF NOT EXISTS idx_story_memory_checkpoints_lookup
    ON story_memory_checkpoints (novel_id, scope_type, scope_id);

    CREATE INDEX IF NOT EXISTS idx_story_arcs_novel_order
    ON story_arcs (novel_id, arc_order, id);

    CREATE INDEX IF NOT EXISTS idx_characters_novel_role
    ON characters (novel_id, role_type, id);

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

    CREATE INDEX IF NOT EXISTS idx_timeline_events_arc_status
    ON timeline_events (novel_id, arc_id, status, time_sort_value, sort_order, id);

    CREATE INDEX IF NOT EXISTS idx_chapter_versions_chapter_created
    ON chapter_versions (chapter_id, created_at, id);

    CREATE INDEX IF NOT EXISTS idx_operation_logs_novel_created
    ON operation_logs (novel_id, created_at, id);

    CREATE INDEX IF NOT EXISTS idx_operation_logs_novel_undone
    ON operation_logs (novel_id, undone, created_at, id);
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

function splitMultilineEntries(raw?: string | null): string[] {
  return (raw || '')
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function truncateAssetTitle(text: string, maxLength = 60): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`
}

function backfillEndgameAssets(sqlite: Database.Database) {
  if (!hasTable(sqlite, 'endgame_commitments') || !hasTable(sqlite, 'foreshadow_ledger')) return

  const novelsWithSettings = sqlite.prepare(`
    SELECT id, settings_json
    FROM novels
    WHERE COALESCE(settings_json, '') <> ''
  `).all() as Array<{ id: number; settings_json?: string | null }>

  const selectCommitment = sqlite.prepare(`
    SELECT id
    FROM endgame_commitments
    WHERE novel_id = ? AND commitment_kind = ? AND source_text = ?
    LIMIT 1
  `)
  const insertCommitment = sqlite.prepare(`
    INSERT INTO endgame_commitments (
      novel_id,
      commitment_kind,
      title,
      description,
      source_order,
      source_text,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `)
  const updateCommitment = sqlite.prepare(`
    UPDATE endgame_commitments
    SET title = ?, description = ?, source_order = ?, status = 'active', updated_at = ?
    WHERE id = ?
  `)
  const selectLinkedForeshadow = sqlite.prepare(`
    SELECT id
    FROM foreshadow_ledger
    WHERE novel_id = ? AND linked_endgame_commitment_id = ?
    LIMIT 1
  `)
  const insertForeshadow = sqlite.prepare(`
    INSERT INTO foreshadow_ledger (
      novel_id,
      title,
      detail,
      salience_level,
      impact_scope,
      status,
      linked_endgame_commitment_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'medium', 'ending', 'draft', ?, ?, ?)
  `)
  const updateForeshadow = sqlite.prepare(`
    UPDATE foreshadow_ledger
    SET title = ?, detail = ?, updated_at = ?
    WHERE id = ?
  `)

  novelsWithSettings.forEach((row) => {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(row.settings_json || '{}') as Record<string, unknown>
    } catch {
      parsed = {}
    }

    const root = parsed && typeof parsed === 'object' ? parsed : {}
    const endgame = root.endgame_design && typeof root.endgame_design === 'object'
      ? root.endgame_design as Record<string, unknown>
      : {}
    const promiseEntries = splitMultilineEntries(
      typeof endgame.must_deliver_promises === 'string'
        ? endgame.must_deliver_promises
        : typeof root.endgame_must_deliver_promises === 'string'
          ? root.endgame_must_deliver_promises
          : '',
    )
    const payoffEntries = splitMultilineEntries(
      typeof endgame.payoff_checklist === 'string'
        ? endgame.payoff_checklist
        : typeof root.endgame_payoff_checklist === 'string'
          ? root.endgame_payoff_checklist
          : '',
    )
    const timestamp = new Date().toISOString()
    const syncCommitments = (entries: string[], kind: 'promise' | 'payoff') => {
      if (entries.length > 0) {
        const placeholders = entries.map(() => '?').join(', ')
        sqlite.prepare(`
          UPDATE endgame_commitments
          SET status = 'waived', updated_at = ?
          WHERE novel_id = ? AND commitment_kind = ? AND source_text NOT IN (${placeholders})
        `).run(timestamp, row.id, kind, ...entries)
      } else {
        sqlite.prepare(`
          UPDATE endgame_commitments
          SET status = 'waived', updated_at = ?
          WHERE novel_id = ? AND commitment_kind = ?
        `).run(timestamp, row.id, kind)
      }

      entries.forEach((entry, index) => {
        const title = truncateAssetTitle(entry)
        const existing = selectCommitment.get(row.id, kind, entry) as { id?: number } | undefined
        let commitmentId: number
        if (existing?.id) {
          updateCommitment.run(title, entry, index, timestamp, existing.id)
          commitmentId = existing.id
        } else {
          const insertResult = insertCommitment.run(row.id, kind, title, entry, index, entry, timestamp, timestamp)
          commitmentId = Number(insertResult.lastInsertRowid)
        }

        if (kind === 'payoff') {
          const existingForeshadow = selectLinkedForeshadow.get(row.id, commitmentId) as { id?: number } | undefined
          if (existingForeshadow?.id) {
            updateForeshadow.run(title, entry, timestamp, existingForeshadow.id)
          } else {
            insertForeshadow.run(row.id, title, entry, commitmentId, timestamp, timestamp)
          }
        }
      })
    }

    syncCommitments(promiseEntries, 'promise')
    syncCommitments(payoffEntries, 'payoff')
  })
}

function backfillContractDefaults(sqlite: Database.Database) {
  if (hasTable(sqlite, 'volume_designs')) {
    sqlite.exec(`
      UPDATE volume_designs
      SET must_add_clues_json = COALESCE(must_add_clues_json, '[]'),
          must_resolve_clues_json = COALESCE(must_resolve_clues_json, '[]'),
          linked_endgame_commitment_ids_json = COALESCE(linked_endgame_commitment_ids_json, '[]'),
          linked_resistance_track_ids_json = COALESCE(linked_resistance_track_ids_json, '[]'),
          audit_status = COALESCE(NULLIF(audit_status, ''), 'draft')
    `)
  }

  if (hasTable(sqlite, 'chapter_contracts')) {
    sqlite.exec(`
      UPDATE chapter_contracts
      SET served_thread_ids_json = COALESCE(served_thread_ids_json, '[]'),
          required_arc_progress_json = COALESCE(required_arc_progress_json, '[]'),
          required_character_arc_ids_json = COALESCE(required_character_arc_ids_json, '[]'),
          required_relationship_arc_ids_json = COALESCE(required_relationship_arc_ids_json, '[]'),
          required_resistance_track_ids_json = COALESCE(required_resistance_track_ids_json, '[]'),
          required_resistance_actions_json = COALESCE(required_resistance_actions_json, '[]'),
          required_asset_refs_json = COALESCE(required_asset_refs_json, '[]'),
          required_endgame_commitment_ids_json = COALESCE(required_endgame_commitment_ids_json, '[]'),
          required_foreshadow_ids_json = COALESCE(required_foreshadow_ids_json, '[]'),
          forbidden_actions_json = COALESCE(forbidden_actions_json, '[]'),
          acceptance_notes_json = COALESCE(acceptance_notes_json, '[]'),
          status = COALESCE(NULLIF(status, ''), 'draft')
    `)
  }

  if (hasTable(sqlite, 'scene_contracts')) {
    sqlite.exec(`
      UPDATE scene_contracts
      SET reveal_payload_json = COALESCE(reveal_payload_json, '[]'),
          required_endgame_commitment_ids_json = COALESCE(required_endgame_commitment_ids_json, '[]'),
          required_foreshadow_ids_json = COALESCE(required_foreshadow_ids_json, '[]'),
          status = COALESCE(NULLIF(status, ''), 'draft')
    `)
  }

  if (hasTable(sqlite, 'foreshadow_ledger')) {
    sqlite.exec(`
      UPDATE foreshadow_ledger
      SET salience_level = COALESCE(NULLIF(salience_level, ''), 'medium'),
          impact_scope = COALESCE(NULLIF(impact_scope, ''), 'global'),
          status = COALESCE(NULLIF(status, ''), 'draft')
    `)
  }
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

  const genreRows = db.select().from(schema.genres).all()
  const genreIdByName = new Map(genreRows.map((row) => [row.name, row.id]))
  const builtinSceneTemplates: Array<typeof schema.sceneTemplates.$inferInsert> = [
    {
      genreId: genreIdByName.get('末世求生'),
      name: '搜物资',
      category: 'crisis',
      description: '围绕食水、药品、能源或关键零件展开的高压搜集场景。',
      typicalBeatsJson: JSON.stringify(['锁定目标点', '路径风险评估', '遭遇资源争夺或环境威胁', '带着代价撤离']),
      suggestedCharacterRolesJson: JSON.stringify(['带路者', '执行者', '拖后者', '风险制造者']),
      emotionArc: '警觉 -> 压迫 -> 爆发 -> 撤离余震',
      isBuiltin: 1,
      sortOrder: 10,
    },
    {
      genreId: genreIdByName.get('丧尸末日'),
      name: '夜间突袭',
      category: 'conflict',
      description: '感染者或敌对幸存者在夜间逼近据点，迫使角色快速防守和取舍。',
      typicalBeatsJson: JSON.stringify(['异常征兆', '防线失守点出现', '角色被迫分工', '压住局面但暴露新缺口']),
      suggestedCharacterRolesJson: JSON.stringify(['守夜人', '决策者', '伤员', '冲动者']),
      emotionArc: '不安 -> 混乱 -> 硬顶 -> 后怕',
      isBuiltin: 1,
      sortOrder: 20,
    },
    {
      genreId: genreIdByName.get('玄幻修真'),
      name: '宗门内争',
      category: 'bonding',
      description: '宗门、世家或师徒体系内部围绕资源、名额、立场发生摩擦。',
      typicalBeatsJson: JSON.stringify(['利益冲突抛出', '话语试探', '潜规则曝光', '矛盾暂压但站队成形']),
      suggestedCharacterRolesJson: JSON.stringify(['受压者', '掌权者', '旁观者', '调停者']),
      emotionArc: '克制 -> 紧绷 -> 撕开表面 -> 余波扩散',
      isBuiltin: 1,
      sortOrder: 30,
    },
    {
      genreId: genreIdByName.get('玄幻修真'),
      name: '秘境试探',
      category: 'revelation',
      description: '角色进入未知地带，通过试探规则和付出代价换取线索或资源。',
      typicalBeatsJson: JSON.stringify(['规则不明', '低成本试探', '触发反噬', '确认收益与风险边界']),
      suggestedCharacterRolesJson: JSON.stringify(['探路者', '知识者', '贪心者', '收尾者']),
      emotionArc: '好奇 -> 紧张 -> 受创 -> 明悟',
      isBuiltin: 1,
      sortOrder: 40,
    },
    {
      genreId: genreIdByName.get('现代都市'),
      name: '内部争执',
      category: 'transition',
      description: '团队、家庭或职场核心关系因利益、误解或压力出现明显裂缝。',
      typicalBeatsJson: JSON.stringify(['压抑情绪累积', '导火索出现', '立场摊开', '暂时收口但信任受损']),
      suggestedCharacterRolesJson: JSON.stringify(['压抑者', '逼问者', '和事佬', '沉默旁观者']),
      emotionArc: '压抑 -> 对撞 -> 冷场 -> 隐性后果',
      isBuiltin: 1,
      sortOrder: 50,
    },
    {
      genreId: genreIdByName.get('现代都市'),
      name: '关系回温',
      category: 'bonding',
      description: '在小范围行动或照顾细节中，让紧张关系获得一次真实缓和。',
      typicalBeatsJson: JSON.stringify(['共同处境', '微小照顾', '旧误会被轻触', '关系前进一步但仍留余白']),
      suggestedCharacterRolesJson: JSON.stringify(['主动靠近者', '犹疑者', '旁观见证者']),
      emotionArc: '别扭 -> 试探 -> 松动 -> 留白',
      isBuiltin: 1,
      sortOrder: 60,
    },
    {
      genreId: genreIdByName.get('悬疑推理'),
      name: '线索反转',
      category: 'revelation',
      description: '原本指向单一答案的线索被重新解释，迫使调查路径转向。',
      typicalBeatsJson: JSON.stringify(['旧线索回看', '异常点被指出', '原推论崩塌', '新方向形成']),
      suggestedCharacterRolesJson: JSON.stringify(['调查者', '质疑者', '信息提供者']),
      emotionArc: '笃定 -> 怀疑 -> 失衡 -> 再聚焦',
      isBuiltin: 1,
      sortOrder: 70,
    },
  ]

  const existingSceneTemplates = db.select().from(schema.sceneTemplates).all()
  const existingSceneKeys = new Set(
    existingSceneTemplates.map((template) => `${template.genreId || 0}:${template.name}`),
  )
  const sceneTemplatesToInsert = builtinSceneTemplates.filter((template) => {
    if (!template.name) return false
    return !existingSceneKeys.has(`${template.genreId || 0}:${template.name}`)
  })

  if (sceneTemplatesToInsert.length > 0) {
    db.insert(schema.sceneTemplates).values(sceneTemplatesToInsert).run()
  }
}

/**
 * Seed genre-default voice fingerprints (题材默认声线): global rows with
 * novel_id = NULL + genre_id, used as the last fallback of
 * resolveActiveStyleFingerprint. Idempotent by fingerprint name — running the
 * seed repeatedly never duplicates rows.
 */
export function seedGenreVoiceFingerprints(db: ReturnType<typeof drizzle>) {
  try {
    const genreRows = db.select({ id: schema.genres.id, name: schema.genres.name })
      .from(schema.genres)
      .all()
    const existingSeedNames = db.select({
      novelId: schema.styleFingerprints.novelId,
      name: schema.styleFingerprints.name,
    })
      .from(schema.styleFingerprints)
      .all()
      .filter((row) => row.novelId === null)
      .map((row) => row.name)

    const inserts = selectGenreVoiceSeedInserts(genreRows, existingSeedNames)
    if (inserts.length === 0) return

    db.insert(schema.styleFingerprints).values(inserts.map((item) => ({
      novelId: null,
      name: item.name,
      sourceText: null,
      fingerprintJson: JSON.stringify(item.fingerprint),
      analysisModelId: null,
      sourceType: 'genre-default',
      sourceChapterIdsJson: null,
      statsJson: null,
      genreId: item.genreId,
    }))).run()
  } catch (error) {
    console.warn('[database] 题材默认声线种子写入失败：', error)
  }
}
