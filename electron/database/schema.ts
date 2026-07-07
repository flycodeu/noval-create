import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const genres = sqliteTable('genres', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  isBuiltin: integer('is_builtin').default(1),
  colorTag: text('color_tag'),
})

export const novels = sqliteTable('novels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  synopsis: text('synopsis'),
  genreId: integer('genre_id').references(() => genres.id),
  launchMode: text('launch_mode').default('professional_longform'),
  status: text('status').default('draft'),
  totalWords: integer('total_words').default(0),
  targetWords: integer('target_words').notNull().default(200000),
  coverImage: text('cover_image'),
  userBackground: text('user_background'),
  expandedBackground: text('expanded_background'),
  projectBriefJson: text('project_brief_json'),
  settingsJson: text('settings_json'),
  themeVoiceJson: text('theme_voice_json'),
  historicalProfileJson: text('historical_profile_json'),
  sourceLedgerJson: text('source_ledger_json'),
  chapterSourceUsageJson: text('chapter_source_usage_json'),
  factProvenanceJson: text('fact_provenance_json'),
  projectCanonProfileJson: text('project_canon_profile_json'),
  canonConstraintSetJson: text('canon_constraint_set_json'),
  canonSourceLedgerJson: text('canon_source_ledger_json'),
  canonFactCardsJson: text('canon_fact_cards_json'),
  worldRulesJson: text('world_rules_json'),
  blurbJson: text('blurb_json'),
  styleTemplateId: integer('style_template_id'),
  worldTemplateId: integer('world_template_id'),
  contextVersion: integer('context_version').default(1),
  modelConfigId: integer('model_config_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const storyVolumes = sqliteTable('story_volumes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  volumeNumber: integer('volume_number').notNull(),
  title: text('title'),
  summary: text('summary'),
  targetWords: integer('target_words').notNull().default(0),
  maxTruthRevealRatio: real('max_truth_reveal_ratio'),
  status: text('status').default('planning'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const storyParts = sqliteTable('story_parts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  volumeId: integer('volume_id').notNull().references(() => storyVolumes.id, { onDelete: 'cascade' }),
  partNumber: integer('part_number').notNull(),
  title: text('title'),
  summary: text('summary'),
  targetWords: integer('target_words').notNull().default(0),
  status: text('status').default('planning'),
  startChapterNum: integer('start_chapter_num'),
  endChapterNum: integer('end_chapter_num'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapters = sqliteTable('chapters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  volumeId: integer('volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  partId: integer('part_id').references(() => storyParts.id, { onDelete: 'set null' }),
  chapterNum: integer('chapter_num').notNull(),
  title: text('title'),
  outline: text('outline'),
  scenePlanJson: text('scene_plan_json'),
  content: text('content'),
  wordCount: integer('word_count').default(0),
  summary: text('summary'),
  nextChapterSeed: text('next_chapter_seed'),
  bridgePlanJson: text('bridge_plan_json'),
  continuityStateJson: text('continuity_state_json'),
  reviewNotesJson: text('review_notes_json'),
  status: text('status').default('outline'),
  aiScoreJson: text('ai_score_json'),
  arcId: integer('arc_id'),
  targetWords: integer('target_words').notNull().default(3000),
  emotionTone: text('emotion_tone'),
  compiledFromSegments: integer('compiled_from_segments').default(0),
  segmentCount: integer('segment_count').default(0),
  qualityScoresJson: text('quality_scores_json'),
  lockedParagraphsJson: text('locked_paragraphs_json'),
  allowedFactIdsJson: text('allowed_fact_ids_json').default('[]'),
  revealedFactIdsJson: text('revealed_fact_ids_json').default('[]'),
  contractAuditJson: text('contract_audit_json'),
  summaryHealthJson: text('summary_health_json'),
  expressionDedupJson: text('expression_dedup_json'),
  hookContinuityJson: text('hook_continuity_json'),
  writebackStatusJson: text('writeback_status_json'),
  contextVersion: integer('context_version').default(1),
  staleReasonJson: text('stale_reason_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterVersions = sqliteTable('chapter_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  versionSource: text('version_source').notNull().default('manual-save'),
  content: text('content').notNull(),
  wordCount: integer('word_count').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterSegments = sqliteTable('chapter_segments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  volumeId: integer('volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  partId: integer('part_id').references(() => storyParts.id, { onDelete: 'set null' }),
  segmentOrder: integer('segment_order').notNull(),
  title: text('title'),
  segmentType: text('segment_type').default('scene'),
  purpose: text('purpose'),
  timeAnchor: text('time_anchor'),
  locationName: text('location_name'),
  presentCharacterIdsJson: text('present_character_ids_json'),
  linkedItemIdsJson: text('linked_item_ids_json'),
  inputState: text('input_state'),
  outputState: text('output_state'),
  summary: text('summary'),
  content: text('content'),
  riskTagsJson: text('risk_tags_json'),
  status: text('status').default('planned'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const storyArcs = sqliteTable('story_arcs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  arcName: text('arc_name').notNull(),
  arcOrder: integer('arc_order').notNull(),
  chapterStart: integer('chapter_start'),
  chapterEnd: integer('chapter_end'),
  arcGoal: text('arc_goal'),
  arcSummary: text('arc_summary'),
  growthLedger: text('growth_ledger'),
  costLedger: text('cost_ledger'),
  phaseTargetsJson: text('phase_targets_json'),
  targetWords: integer('target_words').notNull().default(0),
  progressPercent: integer('progress_percent').notNull().default(0),
  stalledChapterCount: integer('stalled_chapter_count').notNull().default(0),
  lastProgressChapterNum: integer('last_progress_chapter_num'),
})

export const storyThreads = sqliteTable('story_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  threadType: text('thread_type').default('subplot'),
  title: text('title').notNull(),
  summary: text('summary'),
  premise: text('premise'),
  status: text('status').default('planned'),
  priority: text('priority').default('medium'),
  startChapter: integer('start_chapter'),
  targetPayoffChapter: integer('target_payoff_chapter'),
  payoffCondition: text('payoff_condition'),
  currentState: text('current_state'),
  plantedChapter: integer('planted_chapter'),
  lastReferencedChapter: integer('last_referenced_chapter'),
  resolvedChapter: integer('resolved_chapter'),
  reminderInterval: integer('reminder_interval').default(20),
  relatedCharacterIdsJson: text('related_character_ids_json'),
  relatedItemIdsJson: text('related_item_ids_json'),
  relatedTimelineEventIdsJson: text('related_timeline_event_ids_json'),
  typedRefsJson: text('typed_refs_json'),
  notes: text('notes'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const storyFacts = sqliteTable('story_facts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  volumeId: integer('volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  relatedPuzzleId: integer('related_puzzle_id'),
  kind: text('kind').notNull().default('clue'),
  title: text('title').notNull(),
  summary: text('summary'),
  status: text('status').notNull().default('introduced'),
  readerKnownChapterId: integer('reader_known_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  protagonistKnownChapterId: integer('protagonist_known_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  characterKnowledgeJson: text('character_knowledge_json').default('[]'),
  forbiddenBeforeVolume: integer('forbidden_before_volume'),
  plannedRevealVolume: integer('planned_reveal_volume'),
  targetRevealChapterId: integer('target_reveal_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  isKeyTruth: integer('is_key_truth').notNull().default(1),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const endgameCommitments = sqliteTable('endgame_commitments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  commitmentKind: text('commitment_kind').notNull().default('promise'),
  title: text('title').notNull(),
  description: text('description'),
  sourceOrder: integer('source_order').notNull().default(0),
  sourceText: text('source_text').notNull(),
  status: text('status').notNull().default('active'),
  targetResolutionChapter: integer('target_resolution_chapter'),
  lastServedChapter: integer('last_served_chapter'),
  fulfilledChapter: integer('fulfilled_chapter'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const foreshadowLedger = sqliteTable('foreshadow_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  detail: text('detail'),
  sourceChapterId: integer('source_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  sourceSegmentId: integer('source_segment_id').references(() => chapterSegments.id, { onDelete: 'set null' }),
  plantMethod: text('plant_method'),
  salienceLevel: text('salience_level').notNull().default('medium'),
  targetPayoffChapter: integer('target_payoff_chapter'),
  payoffMethod: text('payoff_method'),
  payoffSceneAction: text('payoff_scene_action'),
  requiredEvidence: text('required_evidence'),
  readerVisibleOutcome: text('reader_visible_outcome'),
  allowedDelayReason: text('allowed_delay_reason'),
  impactScope: text('impact_scope').notNull().default('global'),
  status: text('status').notNull().default('draft'),
  linkedThreadId: integer('linked_thread_id').references(() => storyThreads.id, { onDelete: 'set null' }),
  linkedEndgameCommitmentId: integer('linked_endgame_commitment_id').references(() => endgameCommitments.id, { onDelete: 'set null' }),
  linkedVolumeId: integer('linked_volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const volumeDesigns = sqliteTable('volume_designs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  volumeId: integer('volume_id').notNull().references(() => storyVolumes.id, { onDelete: 'cascade' }),
  volumeTheme: text('volume_theme'),
  volumePromise: text('volume_promise'),
  mainConflict: text('main_conflict'),
  climaxPlan: text('climax_plan'),
  endStateShift: text('end_state_shift'),
  mustAddCluesJson: text('must_add_clues_json'),
  mustResolveCluesJson: text('must_resolve_clues_json'),
  readerExpectation: text('reader_expectation'),
  linkedEndgameCommitmentIdsJson: text('linked_endgame_commitment_ids_json'),
  linkedResistanceTrackIdsJson: text('linked_resistance_track_ids_json'),
  auditStatus: text('audit_status').notNull().default('draft'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterContracts = sqliteTable('chapter_contracts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  chapterGoal: text('chapter_goal'),
  openingStyle: text('opening_style'),
  endingStyle: text('ending_style'),
  expositionMode: text('exposition_mode'),
  emotionFocus: text('emotion_focus'),
  servedThreadIdsJson: text('served_thread_ids_json'),
  requiredArcProgressJson: text('required_arc_progress_json'),
  requiredCharacterArcIdsJson: text('required_character_arc_ids_json'),
  requiredRelationshipArcIdsJson: text('required_relationship_arc_ids_json'),
  requiredResistanceTrackIdsJson: text('required_resistance_track_ids_json'),
  requiredResistanceActionsJson: text('required_resistance_actions_json'),
  requiredAssetRefsJson: text('required_asset_refs_json'),
  requiredEndgameCommitmentIdsJson: text('required_endgame_commitment_ids_json'),
  requiredForeshadowIdsJson: text('required_foreshadow_ids_json'),
  hookType: text('hook_type'),
  forbiddenActionsJson: text('forbidden_actions_json'),
  acceptanceNotesJson: text('acceptance_notes_json'),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const sceneContracts = sqliteTable('scene_contracts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  segmentId: integer('segment_id').references(() => chapterSegments.id, { onDelete: 'set null' }),
  pov: text('pov'),
  timeLocation: text('time_location'),
  sceneGoal: text('scene_goal'),
  obstacle: text('obstacle'),
  conflictType: text('conflict_type'),
  emotionShift: text('emotion_shift'),
  revealPayloadJson: text('reveal_payload_json'),
  resultState: text('result_state'),
  linkageMode: text('linkage_mode'),
  requiredEndgameCommitmentIdsJson: text('required_endgame_commitment_ids_json'),
  requiredForeshadowIdsJson: text('required_foreshadow_ids_json'),
  status: text('status').notNull().default('draft'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const growthTracks = sqliteTable('growth_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  trackType: text('track_type').notNull().default('character'),
  sourceEntityType: text('source_entity_type'),
  sourceEntityId: integer('source_entity_id'),
  sourceEntityLabel: text('source_entity_label'),
  title: text('title').notNull(),
  currentTier: text('current_tier'),
  stageGoal: text('stage_goal'),
  nextGoal: text('next_goal'),
  bottleneck: text('bottleneck'),
  scarceResource: text('scarce_resource'),
  acquirePath: text('acquire_path'),
  consumptionRule: text('consumption_rule'),
  failureCost: text('failure_cost'),
  rewardCadence: text('reward_cadence'),
  linkedVolumeId: integer('linked_volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  linkedChapterId: integer('linked_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const resourcePools = sqliteTable('resource_pools', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  poolType: text('pool_type').notNull().default('material'),
  scarcityLevel: text('scarcity_level').notNull().default('balanced'),
  currentReserve: text('current_reserve'),
  unit: text('unit'),
  replenishPath: text('replenish_path'),
  consumptionRule: text('consumption_rule'),
  failureCost: text('failure_cost'),
  pressureSource: text('pressure_source'),
  linkedVolumeId: integer('linked_volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const rewardCostEvents = sqliteTable('reward_cost_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  chapterNumSnapshot: integer('chapter_num_snapshot'),
  eventType: text('event_type').notNull().default('reward'),
  title: text('title').notNull(),
  summary: text('summary'),
  trackId: integer('track_id').references(() => growthTracks.id, { onDelete: 'set null' }),
  resourcePoolId: integer('resource_pool_id').references(() => resourcePools.id, { onDelete: 'set null' }),
  deltaValue: text('delta_value'),
  costResolutionState: text('cost_resolution_state').default('new'),
  rewardLevel: text('reward_level').default('none'),
  nextBottleneck: text('next_bottleneck'),
  linkedVolumeId: integer('linked_volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const factions = sqliteTable('factions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').default('faction'),
  goal: text('goal'),
  resources: text('resources'),
  territoryMapNodeIdsJson: text('territory_map_node_ids_json'),
  leaderCharacterId: integer('leader_character_id').references(() => characters.id, { onDelete: 'set null' }),
  memberPolicy: text('member_policy'),
  currentPhase: text('current_phase'),
  externalRelationsJson: text('external_relations_json'),
  notes: text('notes'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const glossary = sqliteTable('glossary', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  term: text('term').notNull(),
  category: text('category').default('custom'),
  definition: text('definition'),
  aliasesJson: text('aliases_json'),
  firstAppearChapter: integer('first_appear_chapter'),
  relatedEntityIdsJson: text('related_entity_ids_json'),
  isCanonical: integer('is_canonical').default(1),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const sceneTemplates = sqliteTable('scene_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').references(() => novels.id, { onDelete: 'cascade' }),
  genreId: integer('genre_id').references(() => genres.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  category: text('category').default('conflict'),
  description: text('description'),
  typicalBeatsJson: text('typical_beats_json'),
  suggestedCharacterRolesJson: text('suggested_character_roles_json'),
  emotionArc: text('emotion_arc'),
  isBuiltin: integer('is_builtin').default(0),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  roleType: text('role_type').default('minor'),
  recordStatus: text('record_status').default('confirmed'),
  entityType: text('entity_type').default('human'),
  species: text('species'),
  surname: text('surname'),
  givenName: text('given_name'),
  fullName: text('full_name').notNull(),
  gender: text('gender'),
  age: integer('age'),
  birthplace: text('birthplace'),
  activeRegionsJson: text('active_regions_json'),
  occupation: text('occupation'),
  rankLevel: text('rank_level'),
  socialIdentity: text('social_identity'),
  background: text('background'),
  personalityTraitsJson: text('personality_traits_json'),
  flawsJson: text('flaws_json'),
  habitsJson: text('habits_json'),
  campFactionIdsJson: text('camp_faction_ids_json'),
  powerSystemRefsJson: text('power_system_refs_json'),
  contextHooksJson: text('context_hooks_json'),
  goals: text('goals'),
  firstImpression: text('first_impression'),
  surfaceDesire: text('surface_desire'),
  deepNeed: text('deep_need'),
  coreFear: text('core_fear'),
  innerConflict: text('inner_conflict'),
  hiddenSecret: text('hidden_secret'),
  moralLine: text('moral_line'),
  selfDeception: text('self_deception'),
  trauma: text('trauma'),
  contradiction: text('contradiction'),
  relationshipTension: text('relationship_tension'),
  resonancePoint: text('resonance_point'),
  dramaticEngine: text('dramatic_engine'),
  characterArc: text('character_arc'),
  speechPattern: text('speech_pattern'),
  catchphrases: text('catchphrases'),
  vocabularyLevel: text('vocabulary_level'),
  dialectFeatures: text('dialect_features'),
  parentIdsJson: text('parent_ids_json'),
  appearanceJson: text('appearance_json'),
  abilitiesJson: text('abilities_json'),
  sourceContextJson: text('source_context_json'),
  appearChapter: integer('appear_chapter'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const characterRelations = sqliteTable('character_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull(),
  charAId: integer('char_a_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  charBId: integer('char_b_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  relationType: text('relation_type'),
  relationLabel: text('relation_label'),
  bilateral: integer('bilateral').default(1),
  description: text('description'),
  intimacyLevel: integer('intimacy_level'),
  tensionLevel: integer('tension_level'),
  interactionStyle: text('interaction_style'),
  subtextRule: text('subtext_rule'),
})

export const characterArcs = sqliteTable('character_arcs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  characterId: integer('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  startState: text('start_state'),
  surfaceWant: text('surface_want'),
  deepNeed: text('deep_need'),
  coreFear: text('core_fear'),
  misbelief: text('misbelief'),
  firstCrackChapterId: integer('first_crack_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  changeEvent: text('change_event'),
  changeTimelineEventId: integer('change_timeline_event_id').references(() => timelineEvents.id, { onDelete: 'set null' }),
  endState: text('end_state'),
  currentStatus: text('current_status').notNull().default('draft'),
  lastProgressChapterId: integer('last_progress_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  stalledReason: text('stalled_reason'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const characterArcBeats = sqliteTable('character_arc_beats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  arcId: integer('arc_id').notNull().references(() => characterArcs.id, { onDelete: 'cascade' }),
  beatType: text('beat_type').notNull().default('progress-note'),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  timelineEventId: integer('timeline_event_id').references(() => timelineEvents.id, { onDelete: 'set null' }),
  title: text('title'),
  summary: text('summary'),
  status: text('status').notNull().default('planned'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const relationshipArcs = sqliteTable('relationship_arcs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  charAId: integer('char_a_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  charBId: integer('char_b_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  relationLabelSnapshot: text('relation_label_snapshot'),
  relationTypeSnapshot: text('relation_type_snapshot'),
  startState: text('start_state'),
  crackPoint: text('crack_point'),
  changeEvent: text('change_event'),
  changeTimelineEventId: integer('change_timeline_event_id').references(() => timelineEvents.id, { onDelete: 'set null' }),
  endState: text('end_state'),
  currentStatus: text('current_status').notNull().default('draft'),
  lastProgressChapterId: integer('last_progress_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  stalledReason: text('stalled_reason'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const resistanceTracks = sqliteTable('resistance_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull().default('character'),
  sourceId: integer('source_id'),
  resistanceKind: text('resistance_kind').notNull().default('antagonist'),
  title: text('title').notNull(),
  goal: text('goal'),
  intelSource: text('intel_source'),
  resourcePool: text('resource_pool'),
  escalationPlan: text('escalation_plan'),
  heroKnowledgeShift: text('hero_knowledge_shift'),
  stageVictory: text('stage_victory'),
  counterMove: text('counter_move'),
  currentPressureMode: text('current_pressure_mode'),
  currentStatus: text('current_status').notNull().default('draft'),
  lastActionChapterId: integer('last_action_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  nextEscalationChapterId: integer('next_escalation_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  linkedVolumeId: integer('linked_volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const resistanceBeats = sqliteTable('resistance_beats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  trackId: integer('track_id').notNull().references(() => resistanceTracks.id, { onDelete: 'cascade' }),
  beatType: text('beat_type').notNull().default('status-note'),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  timelineEventId: integer('timeline_event_id').references(() => timelineEvents.id, { onDelete: 'set null' }),
  title: text('title'),
  summary: text('summary'),
  actionMode: text('action_mode'),
  successLevel: text('success_level'),
  counterResponse: text('counter_response'),
  protagonistImpact: text('protagonist_impact'),
  status: text('status').notNull().default('logged'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const worldMap = sqliteTable('world_map', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  level: integer('level').notNull(),
  parentId: integer('parent_id'),
  name: text('name').notNull(),
  locationType: text('location_type'),
  nodeType: text('node_type'),
  structureRole: text('structure_role'),
  parentRuleType: text('parent_rule_type'),
  description: text('description'),
  atmosphere: text('atmosphere'),
  plotRelevance: text('plot_relevance'),
  keyEventsJson: text('key_events_json'),
  relatedCharactersJson: text('related_characters_json'),
  tagsJson: text('tags_json'),
  affiliatedFactionIdsJson: text('affiliated_faction_ids_json'),
  dangerLevel: text('danger_level'),
  sortOrder: integer('sort_order').default(0),
})

export const mapRelations = sqliteTable('map_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  mapAId: integer('map_a_id').notNull().references(() => worldMap.id, { onDelete: 'cascade' }),
  mapBId: integer('map_b_id').notNull().references(() => worldMap.id, { onDelete: 'cascade' }),
  relationType: text('relation_type'),
  relationLabel: text('relation_label'),
  bilateral: integer('bilateral').default(1),
  description: text('description'),
  intensity: text('intensity'),
  colorHint: text('color_hint'),
  sortOrder: integer('sort_order').default(0),
})

export const timelineEvents = sqliteTable('timeline_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0),
  eventTitle: text('event_title').notNull(),
  eventSummary: text('event_summary'),
  timeMode: text('time_mode').default('custom-era'),
  timeLabel: text('time_label').notNull(),
  timeSortValue: real('time_sort_value').default(0),
  timePrecision: text('time_precision'),
  isMajorEvent: integer('is_major_event').default(1),
  eventType: text('event_type'),
  arcId: integer('arc_id').references(() => storyArcs.id, { onDelete: 'set null' }),
  volumeId: integer('volume_id').references(() => storyVolumes.id, { onDelete: 'set null' }),
  partId: integer('part_id').references(() => storyParts.id, { onDelete: 'set null' }),
  chapterStartId: integer('chapter_start_id').references(() => chapters.id, { onDelete: 'set null' }),
  chapterEndId: integer('chapter_end_id').references(() => chapters.id, { onDelete: 'set null' }),
  segmentId: integer('segment_id').references(() => chapterSegments.id, { onDelete: 'set null' }),
  locationMapId: integer('location_map_id').references(() => worldMap.id, { onDelete: 'set null' }),
  presentCharacterIdsJson: text('present_character_ids_json'),
  affectedCharacterIdsJson: text('affected_character_ids_json'),
  protagonistPresent: integer('protagonist_present').default(0),
  protagonistAction: text('protagonist_action'),
  eventCause: text('event_cause'),
  eventProcess: text('event_process'),
  eventResult: text('event_result'),
  linkedItemIdsJson: text('linked_item_ids_json'),
  typedRefsJson: text('typed_refs_json'),
  directConsequencesJson: text('direct_consequences_json'),
  openThreadsJson: text('open_threads_json'),
  notes: text('notes'),
  anchorInvalid: integer('anchor_invalid').default(0),
  status: text('status').default('planned'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const storyItems = sqliteTable('story_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  itemKind: text('item_kind').default('instance'),
  parentItemId: integer('parent_item_id'),
  itemName: text('item_name').notNull(),
  genreFamily: text('genre_family'),
  category: text('category'),
  subType: text('sub_type'),
  rarity: text('rarity'),
  recordStatus: text('record_status').default('confirmed'),
  ownerCharacterId: integer('owner_character_id').references(() => characters.id, { onDelete: 'set null' }),
  locationMapId: integer('location_map_id').references(() => worldMap.id, { onDelete: 'set null' }),
  status: text('status').default('available'),
  summary: text('summary'),
  acquisitionMethod: text('acquisition_method'),
  usageMethod: text('usage_method'),
  cost: text('cost'),
  risk: text('risk'),
  plotFunction: text('plot_function'),
  abilitySpec: text('ability_spec'),
  limitations: text('limitations'),
  appearance: text('appearance'),
  factionHint: text('faction_hint'),
  linkedCharacterIdsJson: text('linked_character_ids_json'),
  linkedTimelineEventIdsJson: text('linked_timeline_event_ids_json'),
  typedRefsJson: text('typed_refs_json'),
  tagsJson: text('tags_json'),
  sourceContextJson: text('source_context_json'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const storyMemoryCheckpoints = sqliteTable('story_memory_checkpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  scopeType: text('scope_type').notNull(),
  scopeId: integer('scope_id'),
  label: text('label'),
  summary: text('summary'),
  resolvedThreadsJson: text('resolved_threads_json'),
  activeThreadsJson: text('active_threads_json'),
  characterCardsJson: text('character_cards_json'),
  relationCardsJson: text('relation_cards_json'),
  itemCardsJson: text('item_cards_json'),
  timelineCardsJson: text('timeline_cards_json'),
  threadCardsJson: text('thread_cards_json'),
  characterStateDigest: text('character_state_digest'),
  relationDigest: text('relation_digest'),
  itemDigest: text('item_digest'),
  timelineDigest: text('timeline_digest'),
  forbiddenDirectionsJson: text('forbidden_directions_json'),
  styleGuard: text('style_guard'),
  sourceRangeStart: integer('source_range_start'),
  sourceRangeEnd: integer('source_range_end'),
  version: integer('version').default(1),
  stale: integer('stale').default(0),
  lastRefreshedChapterNum: integer('last_refreshed_chapter_num').default(0),
  locked: integer('locked').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterWritebackRuns = sqliteTable('chapter_writeback_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),
  triggerSource: text('trigger_source').notNull().default('manual'),
  summaryText: text('summary_text'),
  retryCount: integer('retry_count').notNull().default(0),
  lastAttemptAt: text('last_attempt_at'),
  sourceChapterVersion: integer('source_chapter_version'),
  startedAt: text('started_at').default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at'),
  failedAt: text('failed_at'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterGateRuns = sqliteTable('chapter_gate_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  chapterNum: integer('chapter_num').notNull().default(0),
  gateLevel: text('gate_level').notNull().default('warning'),
  ready: integer('ready').notNull().default(0),
  summary: text('summary'),
  rewriteCount: integer('rewrite_count').notNull().default(0),
  blockerCount: integer('blocker_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
  scoreBreakdownJson: text('score_breakdown_json'),
  topIssueKeysJson: text('top_issue_keys_json'),
  generatedTaskCount: integer('generated_task_count').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterRecallRuntimeSnapshots = sqliteTable('chapter_recall_runtime_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  snapshotJson: text('snapshot_json').notNull(),
  diagnosticsJson: text('diagnostics_json').notNull(),
  source: text('source').notNull().default('runtime'),
  sourceTaskId: integer('source_task_id'),
  contextVersion: integer('context_version').default(1),
  computedAt: text('computed_at').default(sql`CURRENT_TIMESTAMP`),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const antiAiRuleHits = sqliteTable('anti_ai_rule_hits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  chapterNum: integer('chapter_num').notNull(),
  ruleCode: text('rule_code').notNull(),
  ruleTitle: text('rule_title'),
  scope: text('scope').notNull().default('structure'),
  severity: text('severity').notNull().default('medium'),
  excerpt: text('excerpt'),
  source: text('source').notNull().default('guardrail'),
  detail: text('detail'),
  promotedToHardConstraint: integer('promoted_to_hard_constraint').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterFactExtracts = sqliteTable('chapter_fact_extracts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => chapterWritebackRuns.id, { onDelete: 'cascade' }),
  assetType: text('asset_type').notNull(),
  sourceText: text('source_text'),
  factJson: text('fact_json').notNull(),
  confidence: real('confidence').default(0),
  verificationStatus: text('verification_status').notNull().default('auto_ready'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterWritebackDiffs = sqliteTable('chapter_writeback_diffs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => chapterWritebackRuns.id, { onDelete: 'cascade' }),
  assetType: text('asset_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id'),
  beforeStateJson: text('before_state_json'),
  afterStateJson: text('after_state_json').notNull(),
  diffReason: text('diff_reason'),
  confidence: real('confidence').default(0),
  verificationStatus: text('verification_status').notNull().default('auto_ready'),
  canonDecision: text('canon_decision').notNull().default('pending'),
  writebackStatus: text('writeback_status').notNull().default('pending'),
  writebackError: text('writeback_error'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const assetChangeEvents = sqliteTable('asset_change_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  assetType: text('asset_type').notNull(),
  assetId: integer('asset_id'),
  assetLabel: text('asset_label').notNull(),
  operation: text('operation').notNull().default('update'),
  changeReason: text('change_reason'),
  impactLevel: text('impact_level').notNull().default('medium'),
  triggeredBy: text('triggered_by'),
  payloadJson: text('payload_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const assetChangeImpacts = sqliteTable('asset_change_impacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id').notNull().references(() => assetChangeEvents.id, { onDelete: 'cascade' }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id'),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  targetLabel: text('target_label').notNull(),
  impactReason: text('impact_reason').notNull(),
  detail: text('detail'),
  confidence: real('confidence').default(0),
  resolutionStatus: text('resolution_status').notNull().default('pending'),
  relatedTaskId: integer('related_task_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const modelConfigs = sqliteTable('model_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  temperature: real('temperature').default(0.85),
  maxTokens: integer('max_tokens').default(4096),
  maxContextTokens: integer('max_context_tokens'),
  maxConcurrency: integer('max_concurrency').default(2),
  isDefault: integer('is_default').default(0),
  extraParamsJson: text('extra_params_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const sourceSearchSettings = sqliteTable('source_search_settings', {
  id: integer('id').primaryKey(),
  provider: text('provider').notNull().default('auto'),
  tavilyApiKey: text('tavily_api_key'),
  braveApiKey: text('brave_api_key'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  contentJson: text('content_json'),
  isBuiltin: integer('is_builtin').default(0),
  genreCompatibilityJson: text('genre_compatibility_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const promptOverrides = sqliteTable('prompt_overrides', {
  key: text('key').primaryKey(),
  content: text('content').notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const promptOverrideAudits = sqliteTable('prompt_override_audits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  action: text('action').notNull().default('save'),
  protectedRuleCount: integer('protected_rule_count').notNull().default(0),
  contentPreview: text('content_preview'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const revisionTasks = sqliteTable('revision_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  taskSource: text('task_source').default('manual'),
  issueKey: text('issue_key'),
  taskType: text('task_type').default('continuity'),
  status: text('status').default('open'),
  severity: text('severity').default('medium'),
  title: text('title').notNull(),
  description: text('description'),
  fixBrief: text('fix_brief'),
  relatedPage: text('related_page'),
  entityType: text('entity_type'),
  entityId: integer('entity_id'),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  originMetaJson: text('origin_meta_json'),
  lastDetectedAt: text('last_detected_at'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id'),
  type: text('type').notNull(),
  status: text('status').default('pending'),
  inputJson: text('input_json'),
  outputText: text('output_text'),
  modelConfigId: integer('model_config_id'),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  relatedEntityType: text('related_entity_type'),
  relatedEntityId: integer('related_entity_id'),
  runnerType: text('runner_type').default('chat'),
  retryable: integer('retryable').default(0),
  parentTaskId: integer('parent_task_id'),
  currentChildTaskId: integer('current_child_task_id'),
  pipelineRole: text('pipeline_role'),
  pipelineStage: text('pipeline_stage'),
  upstreamTaskId: integer('upstream_task_id'),
  contractVersion: text('contract_version'),
  canonRunId: integer('canon_run_id'),
  recoveryHintJson: text('recovery_hint_json'),
  controlJson: text('control_json'),
  progressJson: text('progress_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterBatchSnapshots = sqliteTable('chapter_batch_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  workflowTaskId: integer('workflow_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  summaryText: text('summary_text'),
  chapterIdsJson: text('chapter_ids_json').notNull(),
  chapterNumsJson: text('chapter_nums_json').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  rolledBackAt: text('rolled_back_at'),
  latestRollbackMode: text('latest_rollback_mode'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterBatchInspections = sqliteTable('chapter_batch_inspections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => chapterBatchSnapshots.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  chapterNum: integer('chapter_num'),
  category: text('category').notNull().default('continuity'),
  status: text('status').notNull().default('pass'),
  note: text('note').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const chapterBatchRollbacks = sqliteTable('chapter_batch_rollbacks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: integer('snapshot_id').notNull().references(() => chapterBatchSnapshots.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull(),
  summary: text('summary').notNull(),
  impactJson: text('impact_json').notNull(),
  restoredCountsJson: text('restored_counts_json').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const globalLockLibraries = sqliteTable('global_lock_libraries', {
  novelId: integer('novel_id').primaryKey().references(() => novels.id, { onDelete: 'cascade' }),
  lockedCanonFactsJson: text('locked_canon_facts_json').notNull().default('[]'),
  lockedParagraphsJson: text('locked_paragraphs_json').notNull().default('[]'),
  lockedStyleRulesJson: text('locked_style_rules_json').notNull().default('[]'),
  lockedCharacterVoiceJson: text('locked_character_voice_json').notNull().default('[]'),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const operationLogs = sqliteTable('operation_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityIdsJson: text('entity_ids_json'),
  operationType: text('operation_type').notNull(),
  summary: text('summary').notNull(),
  batchKey: text('batch_key'),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  undoPayloadJson: text('undo_payload_json').notNull(),
  undone: integer('undone').default(0),
  undoneAt: text('undone_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export type Novel = typeof novels.$inferSelect
export type NewNovel = typeof novels.$inferInsert
export type StoryVolume = typeof storyVolumes.$inferSelect
export type NewStoryVolume = typeof storyVolumes.$inferInsert
export type StoryPart = typeof storyParts.$inferSelect
export type NewStoryPart = typeof storyParts.$inferInsert
export type Chapter = typeof chapters.$inferSelect
export type NewChapter = typeof chapters.$inferInsert
export type ChapterVersion = typeof chapterVersions.$inferSelect
export type NewChapterVersion = typeof chapterVersions.$inferInsert
export type ChapterSegment = typeof chapterSegments.$inferSelect
export type NewChapterSegment = typeof chapterSegments.$inferInsert
export type StoryThread = typeof storyThreads.$inferSelect
export type NewStoryThread = typeof storyThreads.$inferInsert
export type StoryFact = typeof storyFacts.$inferSelect
export type NewStoryFact = typeof storyFacts.$inferInsert
export type EndgameCommitment = typeof endgameCommitments.$inferSelect
export type NewEndgameCommitment = typeof endgameCommitments.$inferInsert
export type ForeshadowLedgerEntry = typeof foreshadowLedger.$inferSelect
export type NewForeshadowLedgerEntry = typeof foreshadowLedger.$inferInsert
export type VolumeDesign = typeof volumeDesigns.$inferSelect
export type NewVolumeDesign = typeof volumeDesigns.$inferInsert
export type ChapterContract = typeof chapterContracts.$inferSelect
export type NewChapterContract = typeof chapterContracts.$inferInsert
export type SceneContract = typeof sceneContracts.$inferSelect
export type NewSceneContract = typeof sceneContracts.$inferInsert
export type GrowthTrack = typeof growthTracks.$inferSelect
export type NewGrowthTrack = typeof growthTracks.$inferInsert
export type ResourcePool = typeof resourcePools.$inferSelect
export type NewResourcePool = typeof resourcePools.$inferInsert
export type RewardCostEvent = typeof rewardCostEvents.$inferSelect
export type NewRewardCostEvent = typeof rewardCostEvents.$inferInsert
export type Faction = typeof factions.$inferSelect
export type NewFaction = typeof factions.$inferInsert
export type GlossaryEntry = typeof glossary.$inferSelect
export type NewGlossaryEntry = typeof glossary.$inferInsert
export type SceneTemplate = typeof sceneTemplates.$inferSelect
export type NewSceneTemplate = typeof sceneTemplates.$inferInsert
export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert
export type CharacterRelation = typeof characterRelations.$inferSelect
export type WorldMapItem = typeof worldMap.$inferSelect
export type TimelineEvent = typeof timelineEvents.$inferSelect
export type StoryItem = typeof storyItems.$inferSelect
export type StoryMemoryCheckpoint = typeof storyMemoryCheckpoints.$inferSelect
export type NewStoryMemoryCheckpoint = typeof storyMemoryCheckpoints.$inferInsert
export type ChapterWritebackRun = typeof chapterWritebackRuns.$inferSelect
export type NewChapterWritebackRun = typeof chapterWritebackRuns.$inferInsert
export type ChapterGateRun = typeof chapterGateRuns.$inferSelect
export type NewChapterGateRun = typeof chapterGateRuns.$inferInsert
export type ChapterRecallRuntimeSnapshot = typeof chapterRecallRuntimeSnapshots.$inferSelect
export type NewChapterRecallRuntimeSnapshot = typeof chapterRecallRuntimeSnapshots.$inferInsert
export type AntiAiRuleHit = typeof antiAiRuleHits.$inferSelect
export type NewAntiAiRuleHit = typeof antiAiRuleHits.$inferInsert
export type ChapterFactExtract = typeof chapterFactExtracts.$inferSelect
export type NewChapterFactExtract = typeof chapterFactExtracts.$inferInsert
export type ChapterWritebackDiff = typeof chapterWritebackDiffs.$inferSelect
export type NewChapterWritebackDiff = typeof chapterWritebackDiffs.$inferInsert
export type ModelConfig = typeof modelConfigs.$inferSelect
export type Template = typeof templates.$inferSelect
export type PromptOverride = typeof promptOverrides.$inferSelect
export type RevisionTask = typeof revisionTasks.$inferSelect
export type NewRevisionTask = typeof revisionTasks.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type ChapterBatchSnapshot = typeof chapterBatchSnapshots.$inferSelect
export type NewChapterBatchSnapshot = typeof chapterBatchSnapshots.$inferInsert
export type ChapterBatchInspection = typeof chapterBatchInspections.$inferSelect
export type NewChapterBatchInspection = typeof chapterBatchInspections.$inferInsert
export type ChapterBatchRollback = typeof chapterBatchRollbacks.$inferSelect
export type NewChapterBatchRollback = typeof chapterBatchRollbacks.$inferInsert
export type GlobalLockLibraryRow = typeof globalLockLibraries.$inferSelect
export type NewGlobalLockLibraryRow = typeof globalLockLibraries.$inferInsert
export type OperationLog = typeof operationLogs.$inferSelect
export type NewOperationLog = typeof operationLogs.$inferInsert
export type Genre = typeof genres.$inferSelect
export type StoryArc = typeof storyArcs.$inferSelect

export const generationHistory = sqliteTable('generation_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id'),
  taskType: text('task_type').notNull(),
  outputDigest: text('output_digest').notNull(),
  rejected: integer('rejected').default(0),
  attemptNumber: integer('attempt_number').default(1),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export type GenerationHistory = typeof generationHistory.$inferSelect
export type NewGenerationHistory = typeof generationHistory.$inferInsert

// --- Task 3: 向量记忆检索 ---
export const chapterEmbeddings = sqliteTable('chapter_embeddings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  fragmentType: text('fragment_type').notNull(), // 'summary' | 'continuity' | 'seed'
  fragmentText: text('fragment_text').notNull(),
  embeddingJson: text('embedding_json'), // JSON array of floats
  modelId: text('model_id'),
  dimensions: integer('dimensions'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// --- Task 4: 风格学习 ---
export const styleFingerprints = sqliteTable('style_fingerprints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').references(() => novels.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  sourceText: text('source_text'),
  fingerprintJson: text('fingerprint_json'),
  analysisModelId: text('analysis_model_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const characterDialogueFingerprints = sqliteTable('character_dialogue_fingerprints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  characterId: integer('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  sampleChapterStart: integer('sample_chapter_start'),
  sampleChapterEnd: integer('sample_chapter_end'),
  sampleCount: integer('sample_count').notNull().default(0),
  statsJson: text('stats_json'),
  summaryJson: text('summary_json'),
  analysisModelId: text('analysis_model_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const characterStateVersions = sqliteTable('character_state_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  characterId: integer('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  chapterNum: integer('chapter_num').notNull(),
  injuryState: text('injury_state'),
  resourceState: text('resource_state'),
  stanceState: text('stance_state'),
  mentalState: text('mental_state'),
  relationshipHeatSummary: text('relationship_heat_summary'),
  goalState: text('goal_state'),
  eventCause: text('event_cause'),
  changeReason: text('change_reason'),
  summaryText: text('summary_text'),
  triggerEventId: integer('trigger_event_id').references(() => timelineEvents.id, { onDelete: 'set null' }),
  sourceSegmentId: integer('source_segment_id').references(() => chapterSegments.id, { onDelete: 'set null' }),
  stateDeltaJson: text('state_delta_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const worldStateVersions = sqliteTable('world_state_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  entityName: text('entity_name').notNull(),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  chapterNum: integer('chapter_num').notNull(),
  stateKey: text('state_key').notNull(),
  stateValue: text('state_value'),
  normalizedValue: text('normalized_value'),
  summaryText: text('summary_text'),
  eventCause: text('event_cause'),
  changeReason: text('change_reason'),
  sourceKind: text('source_kind'),
  sourceRef: text('source_ref'),
  severity: text('severity').default('info'),
  triggerEventId: integer('trigger_event_id').references(() => timelineEvents.id, { onDelete: 'set null' }),
  sourceSegmentId: integer('source_segment_id').references(() => chapterSegments.id, { onDelete: 'set null' }),
  stateDeltaJson: text('state_delta_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export type CharacterDialogueFingerprint = typeof characterDialogueFingerprints.$inferSelect
export type NewCharacterDialogueFingerprint = typeof characterDialogueFingerprints.$inferInsert
export type CharacterStateVersion = typeof characterStateVersions.$inferSelect
export type NewCharacterStateVersion = typeof characterStateVersions.$inferInsert
export type WorldStateVersion = typeof worldStateVersions.$inferSelect
export type NewWorldStateVersion = typeof worldStateVersions.$inferInsert
