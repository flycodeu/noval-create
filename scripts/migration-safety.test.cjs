const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function describeRuntime() {
  const nodeVersion = process.version
  const abiVersion = process.versions.modules || 'unknown'
  if (process.versions.electron) {
    return `electron ${process.versions.electron} / node ${nodeVersion} / abi ${abiVersion}`
  }
  return `node ${nodeVersion} / abi ${abiVersion}`
}

function isAbiMismatchError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('NODE_MODULE_VERSION') || message.includes('better_sqlite3.node')
}

function printAbiMismatchGuidance(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  const lines = [
    '[migration-safety] better-sqlite3 原生模块加载失败。',
    `当前运行时: ${describeRuntime()}`,
    '',
    '原因：better-sqlite3 的已编译原生模块 ABI 与当前运行时不匹配。',
    '这通常发生在以下情况：',
    '- 直接使用 `node scripts/migration-safety.test.cjs` 运行，而当前 node_modules 是按 Electron 运行时重建的。',
    '- 切换了 Node / Electron 版本后，没有重新重建原生依赖。',
    '',
    '本项目 migration safety 的正式入口是：',
    '- `npm run test:migrations`',
    '',
    '本机恢复顺序：',
    '- `npm run rebuild:native`',
    '- 如果仍失败，重新安装依赖后再执行 `npm run rebuild:native`',
    '- 最后执行 `npm run test:migrations` 验证',
    '',
    process.versions.electron
      ? '你当前已经在 Electron runtime 下运行；这通常说明本地 native 依赖需要重新重建。'
      : '你当前是在纯 Node runtime 下运行；如果只是想跑迁移安全测试，请改用 `npm run test:migrations`。',
    '',
    '原始错误：',
    message,
  ]
  console.error(lines.join('\n'))
}

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3')
  } catch (error) {
    if (isAbiMismatchError(error)) {
      printAbiMismatchGuidance(error)
      process.exit(1)
    }
    throw error
  }
}

const Database = loadBetterSqlite3()

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(workspaceRoot, '.tmp-tests')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    const directCandidates = ['.ts', '.tsx', '.js', '.json'].map((ext) => path.resolve(baseDir, request + ext))
    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }

    const indexCandidates = ['.ts', '.tsx', '.js'].map((ext) => path.resolve(baseDir, request, 'index' + ext))
    for (const candidate of indexCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })

  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

const { runMigrations } = require(path.join(workspaceRoot, 'electron/database/db.ts'))

function prepareTempDir() {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.mkdirSync(tempRoot, { recursive: true })
}

function openDb(name) {
  const dbPath = path.join(tempRoot, name)
  let db
  try {
    db = new Database(dbPath)
  } catch (error) {
    if (isAbiMismatchError(error)) {
      printAbiMismatchGuidance(error)
      process.exit(1)
    }
    throw error
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function getColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all()
  return new Set(rows.map((row) => row.name))
}

function getMigrationIds(db) {
  return db.prepare('SELECT id FROM _schema_migrations ORDER BY id').all().map((row) => row.id)
}

function assertRequiredColumns(db) {
  assert.ok(getColumns(db, 'recommendation_preflight_runs').has('counted_external_attempt'))
  assert.ok(getColumns(db, 'recommendation_preflight_runs').has('content_hash'))
  assert.ok(getColumns(db, 'recommendation_candidates').has('preflight_run_id'))
  assert.ok(getColumns(db, 'recommendation_candidates').has('approval_id'))
  assert.ok(getColumns(db, 'external_evaluation_attempts').has('idempotency_key'))
  assert.ok(getColumns(db, 'external_evaluation_attempts').has('policy_snapshot_json'))
  assert.ok(getColumns(db, 'external_evaluation_attempts').has('work_state_at_evaluation'))
  assert.ok(getColumns(db, 'artifacts').has('content_hash'))
  assert.ok(getColumns(db, 'artifacts').has('context_version'))
  assert.ok(getColumns(db, 'approval_grants').has('input_hash'))
  assert.ok(getColumns(db, 'tool_invocations').has('redacted_input_json'))
  assert.ok(getColumns(db, 'tasks').has('idempotency_key'))
  assert.ok(getColumns(db, 'chapter_writeback_runs').has('apply_idempotency_key'))
  assert.ok(getColumns(db, 'chapter_writeback_runs').has('apply_lock_version'))
  assert.ok(db.prepare('PRAGMA index_list(chapter_writeback_runs)').all().some((row) => row.name === 'idx_chapter_writeback_runs_apply_idempotency'))
  assert.ok(getColumns(db, 'novels').has('lifecycle_mode'))
  assert.ok(getColumns(db, 'novels').has('historical_profile_json'))
  assert.ok(getColumns(db, 'novels').has('source_ledger_json'))
  assert.ok(getColumns(db, 'novels').has('chapter_source_usage_json'))
  assert.ok(getColumns(db, 'novels').has('fact_provenance_json'))
  assert.ok(getColumns(db, 'novels').has('project_canon_profile_json'))
  assert.ok(getColumns(db, 'novels').has('canon_constraint_set_json'))
  assert.ok(getColumns(db, 'novels').has('canon_source_ledger_json'))
  assert.ok(getColumns(db, 'novels').has('canon_fact_cards_json'))
  assert.ok(getColumns(db, 'model_configs').has('max_concurrency'))
  assert.ok(getColumns(db, 'model_configs').has('max_context_tokens'))
  assert.ok(getColumns(db, 'story_arcs').has('progress_percent'))
  assert.ok(getColumns(db, 'story_arcs').has('stalled_chapter_count'))
  assert.ok(getColumns(db, 'story_arcs').has('last_progress_chapter_num'))
  assert.ok(getColumns(db, 'story_arcs').has('rhythm_template_key'))
  assert.ok(getColumns(db, 'glossary').has('body_md'))
  assert.ok(getColumns(db, 'glossary').has('tags_json'))
  assert.ok(getColumns(db, 'glossary_term_references').has('glossary_id'))
  assert.ok(getColumns(db, 'glossary_term_references').has('chapter_num'))
  assert.ok(getColumns(db, 'glossary_term_references').has('hit_count'))
  assert.ok(getColumns(db, 'story_threads').has('planted_chapter'))
  assert.ok(getColumns(db, 'story_threads').has('last_referenced_chapter'))
  assert.ok(getColumns(db, 'story_threads').has('resolved_chapter'))
  assert.ok(getColumns(db, 'story_threads').has('reminder_interval'))
  assert.ok(getColumns(db, 'story_threads').has('typed_refs_json'))
  assert.ok(getColumns(db, 'timeline_events').has('typed_refs_json'))
  assert.ok(getColumns(db, 'characters').has('dramatic_engine'))
  assert.ok(getColumns(db, 'characters').has('character_arc'))
  assert.ok(getColumns(db, 'characters').has('record_status'))
  assert.ok(getColumns(db, 'characters').has('source_context_json'))
  assert.ok(getColumns(db, 'characters').has('speech_pattern'))
  assert.ok(getColumns(db, 'characters').has('catchphrases'))
  assert.ok(getColumns(db, 'characters').has('vocabulary_level'))
  assert.ok(getColumns(db, 'characters').has('dialect_features'))
  assert.ok(getColumns(db, 'story_items').has('record_status'))
  assert.ok(getColumns(db, 'story_items').has('source_context_json'))
  assert.ok(getColumns(db, 'story_items').has('typed_refs_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('character_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('relation_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('item_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('timeline_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('thread_cards_json'))
  assert.ok(getColumns(db, 'tasks').has('runner_type'))
  assert.ok(getColumns(db, 'tasks').has('progress_json'))
  assert.ok(getColumns(db, 'chapter_versions').has('version_source'))
  assert.ok(getColumns(db, 'chapter_versions').has('word_count'))
  assert.ok(getColumns(db, 'operation_logs').has('summary'))
  assert.ok(getColumns(db, 'operation_logs').has('undo_payload_json'))
  assert.ok(getColumns(db, 'world_state_versions').has('entity_type'))
  assert.ok(getColumns(db, 'world_state_versions').has('entity_name'))
  assert.ok(getColumns(db, 'world_state_versions').has('state_key'))
  assert.ok(getColumns(db, 'world_state_versions').has('normalized_value'))
  assert.ok(getColumns(db, 'world_state_versions').has('severity'))
  assert.ok(getColumns(db, 'chapter_contracts').has('required_character_arc_ids_json'))
  assert.ok(getColumns(db, 'chapter_contracts').has('required_relationship_arc_ids_json'))
  assert.ok(getColumns(db, 'chapter_contracts').has('required_resistance_track_ids_json'))
  assert.ok(getColumns(db, 'chapter_contracts').has('required_resistance_actions_json'))
  assert.ok(getColumns(db, 'chapter_contracts').has('opening_style'))
  assert.ok(getColumns(db, 'chapter_contracts').has('ending_style'))
  assert.ok(getColumns(db, 'chapter_contracts').has('exposition_mode'))
  assert.ok(getColumns(db, 'chapter_contracts').has('emotion_focus'))
  assert.ok(getColumns(db, 'volume_designs').has('linked_resistance_track_ids_json'))
  assert.ok(getColumns(db, 'chapter_recall_runtime_snapshots').has('snapshot_json'))
  assert.ok(getColumns(db, 'chapter_recall_runtime_snapshots').has('diagnostics_json'))
  assert.ok(getColumns(db, 'chapter_recall_runtime_snapshots').has('source'))
  assert.ok(getColumns(db, 'chapter_recall_runtime_snapshots').has('context_version'))
  assert.ok(getColumns(db, 'anti_ai_rule_hits').has('rule_code'))
  assert.ok(getColumns(db, 'anti_ai_rule_hits').has('scope'))
  assert.ok(getColumns(db, 'anti_ai_rule_hits').has('severity'))
  assert.ok(getColumns(db, 'anti_ai_rule_hits').has('source'))
  assert.ok(getColumns(db, 'anti_ai_rule_hits').has('promoted_to_hard_constraint'))
  assert.ok(getColumns(db, 'character_arcs').has('character_id'))
  assert.ok(getColumns(db, 'character_arc_beats').has('arc_id'))
  assert.ok(getColumns(db, 'relationship_arcs').has('char_a_id'))
  assert.ok(getColumns(db, 'resistance_tracks').has('resistance_kind'))
  assert.ok(getColumns(db, 'resistance_beats').has('track_id'))
  assert.ok(getColumns(db, 'creative_stages').has('chapter_start'))
  assert.ok(getColumns(db, 'creative_stages').has('handoff_summary'))
  assert.ok(getColumns(db, 'creative_stage_assets').has('detail_level'))
  assert.ok(getColumns(db, 'creative_stage_assets').has('requested_fields_json'))
  assert.ok(getColumns(db, 'canon_commits').has('input_hash'))
  assert.ok(getColumns(db, 'canon_commits').has('context_version_after'))
  assert.ok(getColumns(db, 'canon_ledger_entries').has('evidence_json'))
  assert.ok(getColumns(db, 'canon_ledger_entries').has('idempotency_key'))
  assert.ok(db.prepare('PRAGMA index_list(canon_commits)').all().some((row) => row.name === 'idx_canon_commits_novel_idempotency'))
  assert.ok(db.prepare('PRAGMA index_list(canon_ledger_entries)').all().some((row) => row.name === 'idx_canon_ledger_entries_commit_key'))
  assert.ok(getColumns(db, 'workflow_node_runs').has('lease_token'))
  assert.ok(getColumns(db, 'workflow_node_runs').has('snapshot_id'))
  assert.ok(getColumns(db, 'workflow_node_runs').has('retry_of_node_run_id'))
  assert.ok(getColumns(db, 'workflow_node_runs').has('retry_reason'))
  assert.ok(getColumns(db, 'workflow_node_snapshots').has('output_hash'))
  assert.ok(db.prepare('PRAGMA index_list(workflow_node_runs)').all().some((row) => row.name === 'idx_workflow_node_runs_attempt'))
  assert.ok(db.prepare('PRAGMA index_list(workflow_node_snapshots)').all().some((row) => row.name === 'idx_workflow_node_snapshots_node_run'))
  assert.ok(db.prepare('PRAGMA index_list(workflow_node_runs)').all().some((row) => row.name === 'idx_workflow_node_runs_retry_source'))
  assert.ok(getColumns(db, 'chapter_embeddings').has('embedding_profile'))
  assert.ok(getColumns(db, 'chapter_embeddings').has('source_hash'))
  assert.ok(getColumns(db, 'chapter_embeddings').has('context_version'))
  assert.ok(getColumns(db, 'chapter_embeddings').has('visibility'))
  assert.ok(db.prepare('PRAGMA index_list(chapter_embeddings)').all().some((row) => row.name === 'idx_chapter_embeddings_profile'))
}

function testFreshDbIsIdempotent() {
  const db = openDb('fresh-migration.db')
  try {
    runMigrations(db)
    assertRequiredColumns(db)
    const firstIds = getMigrationIds(db)
    assert.deepEqual(firstIds, [
      '0001_core_schema',
      '0002_additive_schema',
      '0003_indexes',
      '0004_backfills',
      '0005_validate_schema',
      '0006_history_recovery',
      '0007_validate_history',
      '0008_model_context_windows',
      '0009_validate_model_runtime',
      '0010_model_parameter_defaults',
      '0011_embedding_and_style_tables',
      '0012_story_memory_context_cards',
      '0013_asset_modules_and_blurbs',
      '0014_character_dialogue_fingerprints',
      '0015_character_state_versions',
      '0016_world_state_versions',
      '0017_story_arc_phase_targets',
      '0018_story_thread_foreshadow_columns',
      '0019_endgame_assets_and_contracts',
      '0020_backfill_endgame_assets_and_contracts',
      '0021_character_arc_center',
      '0022_resistance_system',
      '0023_info_gap_and_puzzle_board',
      '0024_growth_resource_cost_system',
      '0025_chapter_contract_audit',
      '0026_chapter_writeback_center',
      '0027_chapter_gate_runs',
      '0027_generation_integrity_reports',
      '0028_task_pipeline_metadata',
      '0029_chapter_recall_runtime_snapshots',
      '0030_anti_ai_rule_hits',
      '0031_foreshadow_actionized_payoff_fields',
      '0032_chapter_batch_workbench',
      '0033_novel_launch_mode',
      '0034_asset_change_impacts_and_writeback_verification',
      '0035_state_anchor_and_delta',
      '0036_chapter_contract_shape_controls',
      '0037_typed_ref_overlay_backfill',
      '0038_novel_source_canon_fields',
      '0039_character_design_columns',
      '0040_recommendation_evaluation_governance',
      '0041_agent_artifacts_approvals_and_audit',
      '0042_recommendation_work_state_lock_history',
      '0043_generation_idempotency_keys',
      '0044_writeback_apply_claims',
      '0045_novel_lifecycle_mode',
      '0046_semantic_gate_reviews',
      '0047_style_lab',
      '0048_scene_design_fields',
      '0049_outline_design_gate_results',
      '0050_story_arc_rhythm',
      '0051_glossary_lore',
      '0052_creative_stages',
      '0053_canon_ledger',
      '0054_workflow_node_snapshots',
      '0055_embedding_provenance',
      '0056_workflow_node_retry_lineage',
    ])

    runMigrations(db)
    assert.deepEqual(getMigrationIds(db), firstIds)
    assertRequiredColumns(db)
  } finally {
    db.close()
  }
}

function testPartialSchemaCanResume() {
  const db = openDb('partial-migration.db')
  try {
    db.exec(`
      CREATE TABLE novels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        synopsis TEXT,
        genre_id INTEGER,
        status TEXT DEFAULT 'draft',
        total_words INTEGER DEFAULT 0,
        target_words INTEGER DEFAULT 200000,
        cover_image TEXT,
        user_background TEXT,
        expanded_background TEXT,
        project_brief_json TEXT,
        settings_json TEXT,
        world_rules_json TEXT,
        style_template_id INTEGER,
        world_template_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE model_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api_key TEXT,
        base_url TEXT,
        temperature REAL DEFAULT 0.85,
        max_tokens INTEGER DEFAULT 4096,
        max_concurrency INTEGER DEFAULT 4
      );

      CREATE TABLE tasks (
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)

    db.prepare(`
      INSERT INTO model_configs (name, provider, model_id, api_key, temperature, max_tokens, max_concurrency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('OpenAI Legacy', 'openai', 'gpt-4o', null, 0.85, 4096, 4)

    db.prepare(`
      INSERT INTO model_configs (name, provider, model_id, api_key, temperature, max_tokens, max_concurrency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('Custom Legacy', 'custom', 'local-model', null, 0.85, 4096, 4)

    runMigrations(db)
    assertRequiredColumns(db)
    assert.deepEqual(getMigrationIds(db), [
      '0001_core_schema',
      '0002_additive_schema',
      '0003_indexes',
      '0004_backfills',
      '0005_validate_schema',
      '0006_history_recovery',
      '0007_validate_history',
      '0008_model_context_windows',
      '0009_validate_model_runtime',
      '0010_model_parameter_defaults',
      '0011_embedding_and_style_tables',
      '0012_story_memory_context_cards',
      '0013_asset_modules_and_blurbs',
      '0014_character_dialogue_fingerprints',
      '0015_character_state_versions',
      '0016_world_state_versions',
      '0017_story_arc_phase_targets',
      '0018_story_thread_foreshadow_columns',
      '0019_endgame_assets_and_contracts',
      '0020_backfill_endgame_assets_and_contracts',
      '0021_character_arc_center',
      '0022_resistance_system',
      '0023_info_gap_and_puzzle_board',
      '0024_growth_resource_cost_system',
      '0025_chapter_contract_audit',
      '0026_chapter_writeback_center',
      '0027_chapter_gate_runs',
      '0027_generation_integrity_reports',
      '0028_task_pipeline_metadata',
      '0029_chapter_recall_runtime_snapshots',
      '0030_anti_ai_rule_hits',
      '0031_foreshadow_actionized_payoff_fields',
      '0032_chapter_batch_workbench',
      '0033_novel_launch_mode',
      '0034_asset_change_impacts_and_writeback_verification',
      '0035_state_anchor_and_delta',
      '0036_chapter_contract_shape_controls',
      '0037_typed_ref_overlay_backfill',
      '0038_novel_source_canon_fields',
      '0039_character_design_columns',
      '0040_recommendation_evaluation_governance',
      '0041_agent_artifacts_approvals_and_audit',
      '0042_recommendation_work_state_lock_history',
      '0043_generation_idempotency_keys',
      '0044_writeback_apply_claims',
      '0045_novel_lifecycle_mode',
      '0046_semantic_gate_reviews',
      '0047_style_lab',
      '0048_scene_design_fields',
      '0049_outline_design_gate_results',
      '0050_story_arc_rhythm',
      '0051_glossary_lore',
      '0052_creative_stages',
      '0053_canon_ledger',
      '0054_workflow_node_snapshots',
      '0055_embedding_provenance',
      '0056_workflow_node_retry_lineage',
    ])

    const configs = db.prepare(`
      SELECT provider, temperature, max_tokens
      FROM model_configs
      ORDER BY id
    `).all()

    assert.deepEqual(configs, [
      { provider: 'openai', temperature: 0.8, max_tokens: 8192 },
      { provider: 'custom', temperature: 0.85, max_tokens: 4096 },
    ])

    runMigrations(db)
    assertRequiredColumns(db)
  } finally {
    db.close()
  }
}

function testAppliedLegacyMigrationCanStillReceiveTypedRefColumns() {
  const db = openDb('legacy-typed-ref-backfill.db')
  try {
    db.exec(`
      CREATE TABLE _schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE timeline_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        linked_item_ids_json TEXT
      );

      CREATE TABLE story_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        thread_type TEXT DEFAULT 'subplot',
        status TEXT DEFAULT 'planned',
        priority TEXT DEFAULT 'medium',
        planted_chapter INTEGER,
        last_referenced_chapter INTEGER,
        resolved_chapter INTEGER,
        reminder_interval INTEGER DEFAULT 20,
        related_character_ids_json TEXT,
        related_item_ids_json TEXT,
        related_timeline_event_ids_json TEXT,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        full_name TEXT NOT NULL
      );

      CREATE TABLE story_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        item_name TEXT NOT NULL
      );
    `)

    const legacyMigrationIds = [
      '0001_core_schema',
      '0002_additive_schema',
      '0003_indexes',
      '0004_backfills',
      '0005_validate_schema',
      '0006_history_recovery',
      '0007_validate_history',
      '0008_model_context_windows',
      '0009_validate_model_runtime',
      '0010_model_parameter_defaults',
      '0011_embedding_and_style_tables',
      '0012_story_memory_context_cards',
      '0013_asset_modules_and_blurbs',
      '0014_character_dialogue_fingerprints',
      '0015_character_state_versions',
      '0016_world_state_versions',
      '0017_story_arc_phase_targets',
      '0018_story_thread_foreshadow_columns',
      '0019_endgame_assets_and_contracts',
      '0020_backfill_endgame_assets_and_contracts',
      '0021_character_arc_center',
      '0022_resistance_system',
      '0023_info_gap_and_puzzle_board',
      '0024_growth_resource_cost_system',
      '0025_chapter_contract_audit',
      '0026_chapter_writeback_center',
      '0027_chapter_gate_runs',
      '0027_generation_integrity_reports',
      '0028_task_pipeline_metadata',
      '0029_chapter_recall_runtime_snapshots',
      '0030_anti_ai_rule_hits',
      '0031_foreshadow_actionized_payoff_fields',
      '0032_chapter_batch_workbench',
      '0033_novel_launch_mode',
      '0034_asset_change_impacts_and_writeback_verification',
      '0035_state_anchor_and_delta',
      '0036_chapter_contract_shape_controls',
    ]

    const insertMigration = db.prepare('INSERT INTO _schema_migrations (id, applied_at) VALUES (?, ?)')
    const timestamp = new Date().toISOString()
    legacyMigrationIds.forEach((id) => insertMigration.run(id, timestamp))

    runMigrations(db)

    assert.ok(getColumns(db, 'timeline_events').has('typed_refs_json'))
    assert.ok(getColumns(db, 'story_threads').has('typed_refs_json'))
    assert.ok(getColumns(db, 'characters').has('dramatic_engine'))
    assert.ok(getColumns(db, 'characters').has('character_arc'))
    assert.ok(getColumns(db, 'characters').has('record_status'))
    assert.ok(getColumns(db, 'characters').has('source_context_json'))
    assert.ok(getColumns(db, 'characters').has('speech_pattern'))
    assert.ok(getColumns(db, 'characters').has('catchphrases'))
    assert.ok(getColumns(db, 'characters').has('vocabulary_level'))
    assert.ok(getColumns(db, 'characters').has('dialect_features'))
    assert.ok(getColumns(db, 'story_items').has('record_status'))
    assert.ok(getColumns(db, 'story_items').has('source_context_json'))
    assert.ok(getColumns(db, 'story_items').has('typed_refs_json'))
    assert.ok(getMigrationIds(db).includes('0037_typed_ref_overlay_backfill'))
    assert.ok(getMigrationIds(db).includes('0038_novel_source_canon_fields'))
    assert.ok(getMigrationIds(db).includes('0039_character_design_columns'))
    assert.ok(getMigrationIds(db).includes('0040_recommendation_evaluation_governance'))
    assert.ok(getMigrationIds(db).includes('0041_agent_artifacts_approvals_and_audit'))
    assert.ok(getMigrationIds(db).includes('0042_recommendation_work_state_lock_history'))
    assert.ok(getMigrationIds(db).includes('0043_generation_idempotency_keys'))
    assert.ok(getMigrationIds(db).includes('0044_writeback_apply_claims'))
    assert.ok(getMigrationIds(db).includes('0045_novel_lifecycle_mode'))
    assert.ok(getMigrationIds(db).includes('0046_semantic_gate_reviews'))
    assert.ok(getMigrationIds(db).includes('0047_style_lab'))
    assert.ok(getMigrationIds(db).includes('0048_scene_design_fields'))
    assert.ok(getMigrationIds(db).includes('0049_outline_design_gate_results'))
    assert.ok(getMigrationIds(db).includes('0050_story_arc_rhythm'))
    assert.ok(getMigrationIds(db).includes('0051_glossary_lore'))
  } finally {
    db.close()
  }
}

function testAppliedLegacyMigrationCanStillReceiveCharacterDesignColumns() {
  const db = openDb('legacy-character-design-backfill.db')
  try {
    db.exec(`
      CREATE TABLE _schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER NOT NULL,
        role_type TEXT DEFAULT 'minor',
        full_name TEXT NOT NULL,
        record_status TEXT DEFAULT 'confirmed',
        source_context_json TEXT
      );
    `)

    const appliedMigrationIds = [
      '0001_core_schema',
      '0002_additive_schema',
      '0003_indexes',
      '0004_backfills',
      '0005_validate_schema',
      '0006_history_recovery',
      '0007_validate_history',
      '0008_model_context_windows',
      '0009_validate_model_runtime',
      '0010_model_parameter_defaults',
      '0011_embedding_and_style_tables',
      '0012_story_memory_context_cards',
      '0013_asset_modules_and_blurbs',
      '0014_character_dialogue_fingerprints',
      '0015_character_state_versions',
      '0016_world_state_versions',
      '0017_story_arc_phase_targets',
      '0018_story_thread_foreshadow_columns',
      '0019_endgame_assets_and_contracts',
      '0020_backfill_endgame_assets_and_contracts',
      '0021_character_arc_center',
      '0022_resistance_system',
      '0023_info_gap_and_puzzle_board',
      '0024_growth_resource_cost_system',
      '0025_chapter_contract_audit',
      '0026_chapter_writeback_center',
      '0027_chapter_gate_runs',
      '0027_generation_integrity_reports',
      '0028_task_pipeline_metadata',
      '0029_chapter_recall_runtime_snapshots',
      '0030_anti_ai_rule_hits',
      '0031_foreshadow_actionized_payoff_fields',
      '0032_chapter_batch_workbench',
      '0033_novel_launch_mode',
      '0034_asset_change_impacts_and_writeback_verification',
      '0035_state_anchor_and_delta',
      '0036_chapter_contract_shape_controls',
      '0037_typed_ref_overlay_backfill',
      '0038_novel_source_canon_fields',
    ]

    const insertMigration = db.prepare('INSERT INTO _schema_migrations (id, applied_at) VALUES (?, ?)')
    const timestamp = new Date().toISOString()
    appliedMigrationIds.forEach((id) => insertMigration.run(id, timestamp))

    runMigrations(db)

    assert.ok(getColumns(db, 'characters').has('entity_type'))
    assert.ok(getColumns(db, 'characters').has('surface_desire'))
    assert.ok(getColumns(db, 'characters').has('deep_need'))
    assert.ok(getColumns(db, 'characters').has('core_fear'))
    assert.ok(getColumns(db, 'characters').has('inner_conflict'))
    assert.ok(getColumns(db, 'characters').has('relationship_tension'))
    assert.ok(getColumns(db, 'characters').has('resonance_point'))
    assert.ok(getColumns(db, 'characters').has('dramatic_engine'))
    assert.ok(getColumns(db, 'characters').has('character_arc'))
    assert.ok(getColumns(db, 'characters').has('speech_pattern'))
    assert.ok(getColumns(db, 'characters').has('catchphrases'))
    assert.ok(getColumns(db, 'characters').has('vocabulary_level'))
    assert.ok(getColumns(db, 'characters').has('dialect_features'))
    assert.ok(getMigrationIds(db).includes('0039_character_design_columns'))
    assert.ok(getMigrationIds(db).includes('0040_recommendation_evaluation_governance'))
    assert.ok(getMigrationIds(db).includes('0041_agent_artifacts_approvals_and_audit'))
    assert.ok(getMigrationIds(db).includes('0042_recommendation_work_state_lock_history'))
    assert.ok(getMigrationIds(db).includes('0043_generation_idempotency_keys'))
    assert.ok(getMigrationIds(db).includes('0044_writeback_apply_claims'))
    assert.ok(getMigrationIds(db).includes('0045_novel_lifecycle_mode'))
    assert.ok(getMigrationIds(db).includes('0046_semantic_gate_reviews'))
    assert.ok(getMigrationIds(db).includes('0047_style_lab'))
    assert.ok(getMigrationIds(db).includes('0048_scene_design_fields'))
    assert.ok(getMigrationIds(db).includes('0049_outline_design_gate_results'))
    assert.ok(getMigrationIds(db).includes('0050_story_arc_rhythm'))
    assert.ok(getMigrationIds(db).includes('0051_glossary_lore'))
  } finally {
    db.close()
  }
}

function testRecommendationGovernanceTriggers() {
  const db = openDb('recommendation-governance.db')
  try {
    runMigrations(db)
    const createCandidate = (title, status) => {
      const novel = db.prepare(`
        INSERT INTO novels (title, status, target_words, context_version)
        VALUES (?, ?, 200000, 1)
      `).run(title, status)
      const novelId = Number(novel.lastInsertRowid)
      const preflight = db.prepare(`
        INSERT INTO recommendation_preflight_runs (
          novel_id, profile_version, status, score, confidence_lower_bound,
          coverage_rate, context_version, content_hash, counted_external_attempt
        ) VALUES (?, 'test-v1', 'ready', 90, 85, 100, 1, ?, 0)
      `).run(novelId, `sha256:${'a'.repeat(64)}`)
      const preflightId = Number(preflight.lastInsertRowid)
      const candidate = db.prepare(`
        INSERT INTO recommendation_candidates (
          novel_id, preflight_run_id, status, context_version, content_hash,
          snapshot_json, actor_type, actor_id, client_id, approval_id, locked_at
        ) VALUES (?, ?, 'locked', 1, ?, '{}', 'human', 'tester', 'migration-test', 'approval', ?)
      `).run(novelId, preflightId, `sha256:${'a'.repeat(64)}`, new Date().toISOString())
      return { novelId, candidateId: Number(candidate.lastInsertRowid) }
    }
    const insertAttempt = (novelId, candidateId, outcome, key, workState = 'serializing') => db.prepare(`
      INSERT INTO external_evaluation_attempts (
        novel_id, candidate_id, source, outcome, work_state_at_evaluation, failure_reason,
        evidence_completeness, evidence_json, policy_id, policy_snapshot_json,
        actor_type, actor_id, client_id, approval_id, confirmed_by,
        idempotency_key, occurred_at
      ) VALUES (?, ?, 'author_requested', ?, ?, ?, 'complete', '{}', 'test-policy', '{}',
        'human', 'tester', 'migration-test', 'approval', 'tester', ?, ?)
    `).run(novelId, candidateId, outcome, workState, outcome === 'failed' ? 'test failure' : null, key, new Date().toISOString())

    const serializing = createCandidate('serializing', 'serializing')
    insertAttempt(serializing.novelId, serializing.candidateId, 'failed', 'serial-fail-1')
    insertAttempt(serializing.novelId, serializing.candidateId, 'failed', 'serial-fail-2')
    insertAttempt(serializing.novelId, serializing.candidateId, 'failed', 'serial-fail-3')
    assert.throws(
      () => insertAttempt(serializing.novelId, serializing.candidateId, 'failed', 'serial-fail-4'),
      /RECOMMENDATION_ATTEMPTS_EXHAUSTED/,
    )

    const completed = createCandidate('completed', 'completed')
    insertAttempt(completed.novelId, completed.candidateId, 'failed', 'completed-fail-1', 'completed')
    db.prepare(`UPDATE novels SET status = 'serializing' WHERE id = ?`).run(completed.novelId)
    assert.throws(
      () => insertAttempt(completed.novelId, completed.candidateId, 'failed', 'completed-fail-2'),
      /RECOMMENDATION_COMPLETED_WORK_LOCKED/,
    )

    const passed = createCandidate('passed', 'serializing')
    insertAttempt(passed.novelId, passed.candidateId, 'passed', 'passed-1')
    assert.throws(
      () => insertAttempt(passed.novelId, passed.candidateId, 'failed', 'passed-2'),
      /RECOMMENDATION_ALREADY_PASSED/,
    )

    const internalCount = db.prepare(`
      SELECT SUM(counted_external_attempt) AS count
      FROM recommendation_preflight_runs
    `).get().count
    assert.equal(internalCount, 0)
  } finally {
    db.close()
  }
}

function runAllTests() {
  prepareTempDir()
  testFreshDbIsIdempotent()
  testPartialSchemaCanResume()
  testAppliedLegacyMigrationCanStillReceiveTypedRefColumns()
  testAppliedLegacyMigrationCanStillReceiveCharacterDesignColumns()
  testRecommendationGovernanceTriggers()
  console.log('migration-safety tests passed')
}

async function main() {
  if (process.versions.electron) {
    const { app } = require('electron')
    await app.whenReady()
    try {
      runAllTests()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  runAllTests()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
