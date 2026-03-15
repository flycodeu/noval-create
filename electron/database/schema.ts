import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// 题材表
export const genres = sqliteTable('genres', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  isBuiltin: integer('is_builtin').default(1),
  colorTag: text('color_tag'),
})

// 小说主表
export const novels = sqliteTable('novels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  synopsis: text('synopsis'),
  genreId: integer('genre_id').references(() => genres.id),
  status: text('status').default('draft'), // draft/writing/completed/archived
  totalWords: integer('total_words').default(0),
  targetWords: integer('target_words').default(200000),
  coverImage: text('cover_image'),
  userBackground: text('user_background'),
  expandedBackground: text('expanded_background'),
  settingsJson: text('settings_json'),
  worldRulesJson: text('world_rules_json'),
  styleTemplateId: integer('style_template_id'),
  worldTemplateId: integer('world_template_id'),
  modelConfigId: integer('model_config_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

// 章节表
export const chapters = sqliteTable('chapters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  chapterNum: integer('chapter_num').notNull(),
  title: text('title'),
  outline: text('outline'),
  content: text('content'),
  wordCount: integer('word_count').default(0),
  summary: text('summary'),
  nextChapterSeed: text('next_chapter_seed'),
  status: text('status').default('outline'), // outline/writing/draft/reviewing/final
  aiScoreJson: text('ai_score_json'),
  arcId: integer('arc_id'),
  targetWords: integer('target_words').default(3000),
  emotionTone: text('emotion_tone'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

// 故事弧表
export const storyArcs = sqliteTable('story_arcs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  arcName: text('arc_name').notNull(),
  arcOrder: integer('arc_order').notNull(),
  chapterStart: integer('chapter_start'),
  chapterEnd: integer('chapter_end'),
  arcGoal: text('arc_goal'),
  arcSummary: text('arc_summary'),
})

// 人物表
export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  roleType: text('role_type').default('minor'), // protagonist/major/minor/antagonist/supporting
  surname: text('surname'),
  givenName: text('given_name'),
  fullName: text('full_name').notNull(),
  gender: text('gender'), // male/female/other
  age: integer('age'),
  birthplace: text('birthplace'),
  activeRegionsJson: text('active_regions_json'),
  occupation: text('occupation'),
  background: text('background'),
  personalityTraitsJson: text('personality_traits_json'),
  flawsJson: text('flaws_json'),
  habitsJson: text('habits_json'),
  goals: text('goals'),
  firstImpression: text('first_impression'),
  parentIdsJson: text('parent_ids_json'),
  appearanceJson: text('appearance_json'),
  abilitiesJson: text('abilities_json'),
  appearChapter: integer('appear_chapter'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

// 人物关系表
export const characterRelations = sqliteTable('character_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull(),
  charAId: integer('char_a_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  charBId: integer('char_b_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  relationType: text('relation_type'), // friend/enemy/lover/parent_child/colleague/rival/mentor_student
  relationLabel: text('relation_label'),
  bilateral: integer('bilateral').default(1), // 1=双向 0=单向
  description: text('description'),
})

// 地图表（三级结构用 parent_id 实现）
export const worldMap = sqliteTable('world_map', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id').notNull().references(() => novels.id, { onDelete: 'cascade' }),
  level: integer('level').notNull(), // 1=国家/大区域 2=区域 3=具体地点
  parentId: integer('parent_id'),
  name: text('name').notNull(),
  locationType: text('location_type'),
  description: text('description'),
  atmosphere: text('atmosphere'),
  plotRelevance: text('plot_relevance'),
  keyEventsJson: text('key_events_json'),
  relatedCharactersJson: text('related_characters_json'),
  sortOrder: integer('sort_order').default(0),
})

// 模型配置表
export const modelConfigs = sqliteTable('model_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  provider: text('provider').notNull(), // openai/anthropic/baidu/aliyun/bytedance/deepseek/custom
  modelId: text('model_id').notNull(),
  apiKey: text('api_key'), // 加密存储
  baseUrl: text('base_url'),
  temperature: real('temperature').default(0.85),
  maxTokens: integer('max_tokens').default(4096),
  isDefault: integer('is_default').default(0),
  extraParamsJson: text('extra_params_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// 模板表
export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // style/genre/world/character/outline/writing_step
  name: text('name').notNull(),
  description: text('description'),
  contentJson: text('content_json'),
  isBuiltin: integer('is_builtin').default(0),
  genreCompatibilityJson: text('genre_compatibility_json'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// 任务日志表
export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  novelId: integer('novel_id'),
  type: text('type').notNull(), // init/character_gen/chapter_outline/chapter_write/summary/review/ai_check
  status: text('status').default('pending'), // pending/running/success/failed/cancelled
  inputJson: text('input_json'),
  outputText: text('output_text'),
  modelConfigId: integer('model_config_id'),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  relatedEntityType: text('related_entity_type'), // chapter/character/novel
  relatedEntityId: integer('related_entity_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export type Novel = typeof novels.$inferSelect
export type NewNovel = typeof novels.$inferInsert
export type Chapter = typeof chapters.$inferSelect
export type NewChapter = typeof chapters.$inferInsert
export type Character = typeof characters.$inferSelect
export type NewCharacter = typeof characters.$inferInsert
export type CharacterRelation = typeof characterRelations.$inferSelect
export type WorldMapItem = typeof worldMap.$inferSelect
export type ModelConfig = typeof modelConfigs.$inferSelect
export type Template = typeof templates.$inferSelect
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Genre = typeof genres.$inferSelect
export type StoryArc = typeof storyArcs.$inferSelect
