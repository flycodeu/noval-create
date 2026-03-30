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
  status: text('status').default('draft'),
  totalWords: integer('total_words').default(0),
  targetWords: integer('target_words').notNull().default(200000),
  coverImage: text('cover_image'),
  userBackground: text('user_background'),
  expandedBackground: text('expanded_background'),
  projectBriefJson: text('project_brief_json'),
  settingsJson: text('settings_json'),
  themeVoiceJson: text('theme_voice_json'),
  worldRulesJson: text('world_rules_json'),
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
  continuityStateJson: text('continuity_state_json'),
  reviewNotesJson: text('review_notes_json'),
  status: text('status').default('outline'),
  aiScoreJson: text('ai_score_json'),
  arcId: integer('arc_id'),
  targetWords: integer('target_words').notNull().default(3000),
  emotionTone: text('emotion_tone'),
  compiledFromSegments: integer('compiled_from_segments').default(0),
  segmentCount: integer('segment_count').default(0),
  contextVersion: integer('context_version').default(1),
  staleReasonJson: text('stale_reason_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
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
  targetWords: integer('target_words').notNull().default(0),
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
  relatedCharacterIdsJson: text('related_character_ids_json'),
  relatedItemIdsJson: text('related_item_ids_json'),
  relatedTimelineEventIdsJson: text('related_timeline_event_ids_json'),
  notes: text('notes'),
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
  characterArc: text('character_arc'),
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
  appearance: text('appearance'),
  factionHint: text('faction_hint'),
  linkedCharacterIdsJson: text('linked_character_ids_json'),
  linkedTimelineEventIdsJson: text('linked_timeline_event_ids_json'),
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

export const modelConfigs = sqliteTable('model_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  temperature: real('temperature').default(0.85),
  maxTokens: integer('max_tokens').default(4096),
  isDefault: integer('is_default').default(0),
  extraParamsJson: text('extra_params_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
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

export const revisionTasks = sqliteTable('revision_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  taskSource: text('task_source').default('manual'),
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
  controlJson: text('control_json'),
  progressJson: text('progress_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export type Novel = typeof novels.$inferSelect
export type NewNovel = typeof novels.$inferInsert
export type StoryVolume = typeof storyVolumes.$inferSelect
export type NewStoryVolume = typeof storyVolumes.$inferInsert
export type StoryPart = typeof storyParts.$inferSelect
export type NewStoryPart = typeof storyParts.$inferInsert
export type Chapter = typeof chapters.$inferSelect
export type NewChapter = typeof chapters.$inferInsert
export type ChapterSegment = typeof chapterSegments.$inferSelect
export type NewChapterSegment = typeof chapterSegments.$inferInsert
export type StoryThread = typeof storyThreads.$inferSelect
export type NewStoryThread = typeof storyThreads.$inferInsert
export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert
export type CharacterRelation = typeof characterRelations.$inferSelect
export type WorldMapItem = typeof worldMap.$inferSelect
export type TimelineEvent = typeof timelineEvents.$inferSelect
export type StoryItem = typeof storyItems.$inferSelect
export type StoryMemoryCheckpoint = typeof storyMemoryCheckpoints.$inferSelect
export type NewStoryMemoryCheckpoint = typeof storyMemoryCheckpoints.$inferInsert
export type ModelConfig = typeof modelConfigs.$inferSelect
export type Template = typeof templates.$inferSelect
export type PromptOverride = typeof promptOverrides.$inferSelect
export type RevisionTask = typeof revisionTasks.$inferSelect
export type NewRevisionTask = typeof revisionTasks.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
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