"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const betterSqlite3 = require("drizzle-orm/better-sqlite3");
const sqliteCore = require("drizzle-orm/sqlite-core");
const drizzleOrm = require("drizzle-orm");
const CryptoJS = require("crypto-js");
const os = require("os");
const docx = require("docx");
const genres = sqliteCore.sqliteTable("genres", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  name: sqliteCore.text("name").notNull(),
  description: sqliteCore.text("description"),
  isBuiltin: sqliteCore.integer("is_builtin").default(1),
  colorTag: sqliteCore.text("color_tag")
});
const novels = sqliteCore.sqliteTable("novels", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  title: sqliteCore.text("title").notNull(),
  synopsis: sqliteCore.text("synopsis"),
  genreId: sqliteCore.integer("genre_id").references(() => genres.id),
  status: sqliteCore.text("status").default("draft"),
  // draft/writing/completed/archived
  totalWords: sqliteCore.integer("total_words").default(0),
  targetWords: sqliteCore.integer("target_words").default(2e5),
  coverImage: sqliteCore.text("cover_image"),
  userBackground: sqliteCore.text("user_background"),
  expandedBackground: sqliteCore.text("expanded_background"),
  settingsJson: sqliteCore.text("settings_json"),
  worldRulesJson: sqliteCore.text("world_rules_json"),
  styleTemplateId: sqliteCore.integer("style_template_id"),
  worldTemplateId: sqliteCore.integer("world_template_id"),
  modelConfigId: sqliteCore.integer("model_config_id"),
  createdAt: sqliteCore.text("created_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`),
  updatedAt: sqliteCore.text("updated_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`)
});
const chapters = sqliteCore.sqliteTable("chapters", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  novelId: sqliteCore.integer("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  chapterNum: sqliteCore.integer("chapter_num").notNull(),
  title: sqliteCore.text("title"),
  outline: sqliteCore.text("outline"),
  content: sqliteCore.text("content"),
  wordCount: sqliteCore.integer("word_count").default(0),
  summary: sqliteCore.text("summary"),
  nextChapterSeed: sqliteCore.text("next_chapter_seed"),
  status: sqliteCore.text("status").default("outline"),
  // outline/writing/draft/reviewing/final
  aiScoreJson: sqliteCore.text("ai_score_json"),
  arcId: sqliteCore.integer("arc_id"),
  targetWords: sqliteCore.integer("target_words").default(3e3),
  emotionTone: sqliteCore.text("emotion_tone"),
  createdAt: sqliteCore.text("created_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`),
  updatedAt: sqliteCore.text("updated_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`)
});
const storyArcs = sqliteCore.sqliteTable("story_arcs", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  novelId: sqliteCore.integer("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  arcName: sqliteCore.text("arc_name").notNull(),
  arcOrder: sqliteCore.integer("arc_order").notNull(),
  chapterStart: sqliteCore.integer("chapter_start"),
  chapterEnd: sqliteCore.integer("chapter_end"),
  arcGoal: sqliteCore.text("arc_goal"),
  arcSummary: sqliteCore.text("arc_summary")
});
const characters = sqliteCore.sqliteTable("characters", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  novelId: sqliteCore.integer("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  roleType: sqliteCore.text("role_type").default("minor"),
  // protagonist/major/minor/antagonist/supporting
  surname: sqliteCore.text("surname"),
  givenName: sqliteCore.text("given_name"),
  fullName: sqliteCore.text("full_name").notNull(),
  gender: sqliteCore.text("gender"),
  // male/female/other
  age: sqliteCore.integer("age"),
  birthplace: sqliteCore.text("birthplace"),
  activeRegionsJson: sqliteCore.text("active_regions_json"),
  occupation: sqliteCore.text("occupation"),
  background: sqliteCore.text("background"),
  personalityTraitsJson: sqliteCore.text("personality_traits_json"),
  flawsJson: sqliteCore.text("flaws_json"),
  habitsJson: sqliteCore.text("habits_json"),
  goals: sqliteCore.text("goals"),
  firstImpression: sqliteCore.text("first_impression"),
  parentIdsJson: sqliteCore.text("parent_ids_json"),
  appearanceJson: sqliteCore.text("appearance_json"),
  abilitiesJson: sqliteCore.text("abilities_json"),
  appearChapter: sqliteCore.integer("appear_chapter"),
  sortOrder: sqliteCore.integer("sort_order").default(0),
  createdAt: sqliteCore.text("created_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`),
  updatedAt: sqliteCore.text("updated_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`)
});
const characterRelations = sqliteCore.sqliteTable("character_relations", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  novelId: sqliteCore.integer("novel_id").notNull(),
  charAId: sqliteCore.integer("char_a_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  charBId: sqliteCore.integer("char_b_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  relationType: sqliteCore.text("relation_type"),
  // friend/enemy/lover/parent_child/colleague/rival/mentor_student
  relationLabel: sqliteCore.text("relation_label"),
  bilateral: sqliteCore.integer("bilateral").default(1),
  // 1=双向 0=单向
  description: sqliteCore.text("description")
});
const worldMap = sqliteCore.sqliteTable("world_map", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  novelId: sqliteCore.integer("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  level: sqliteCore.integer("level").notNull(),
  // 1=国家/大区域 2=区域 3=具体地点
  parentId: sqliteCore.integer("parent_id"),
  name: sqliteCore.text("name").notNull(),
  locationType: sqliteCore.text("location_type"),
  description: sqliteCore.text("description"),
  atmosphere: sqliteCore.text("atmosphere"),
  plotRelevance: sqliteCore.text("plot_relevance"),
  keyEventsJson: sqliteCore.text("key_events_json"),
  relatedCharactersJson: sqliteCore.text("related_characters_json"),
  sortOrder: sqliteCore.integer("sort_order").default(0)
});
const modelConfigs = sqliteCore.sqliteTable("model_configs", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  name: sqliteCore.text("name").notNull(),
  provider: sqliteCore.text("provider").notNull(),
  // openai/anthropic/baidu/aliyun/bytedance/deepseek/custom
  modelId: sqliteCore.text("model_id").notNull(),
  apiKey: sqliteCore.text("api_key"),
  // 加密存储
  baseUrl: sqliteCore.text("base_url"),
  temperature: sqliteCore.real("temperature").default(0.85),
  maxTokens: sqliteCore.integer("max_tokens").default(4096),
  isDefault: sqliteCore.integer("is_default").default(0),
  extraParamsJson: sqliteCore.text("extra_params_json"),
  createdAt: sqliteCore.text("created_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`)
});
const templates = sqliteCore.sqliteTable("templates", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  type: sqliteCore.text("type").notNull(),
  // style/genre/world/character/outline/writing_step
  name: sqliteCore.text("name").notNull(),
  description: sqliteCore.text("description"),
  contentJson: sqliteCore.text("content_json"),
  isBuiltin: sqliteCore.integer("is_builtin").default(0),
  genreCompatibilityJson: sqliteCore.text("genre_compatibility_json"),
  createdAt: sqliteCore.text("created_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`)
});
const tasks = sqliteCore.sqliteTable("tasks", {
  id: sqliteCore.integer("id").primaryKey({ autoIncrement: true }),
  novelId: sqliteCore.integer("novel_id"),
  type: sqliteCore.text("type").notNull(),
  // init/character_gen/chapter_outline/chapter_write/summary/review/ai_check
  status: sqliteCore.text("status").default("pending"),
  // pending/running/success/failed/cancelled
  inputJson: sqliteCore.text("input_json"),
  outputText: sqliteCore.text("output_text"),
  modelConfigId: sqliteCore.integer("model_config_id"),
  tokensUsed: sqliteCore.integer("tokens_used"),
  durationMs: sqliteCore.integer("duration_ms"),
  errorMessage: sqliteCore.text("error_message"),
  relatedEntityType: sqliteCore.text("related_entity_type"),
  // chapter/character/novel
  relatedEntityId: sqliteCore.integer("related_entity_id"),
  createdAt: sqliteCore.text("created_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`),
  updatedAt: sqliteCore.text("updated_at").default(drizzleOrm.sql`CURRENT_TIMESTAMP`)
});
const schema = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  chapters,
  characterRelations,
  characters,
  genres,
  modelConfigs,
  novels,
  storyArcs,
  tasks,
  templates,
  worldMap
}, Symbol.toStringTag, { value: "Module" }));
let _db = null;
let _sqlite = null;
function getDb() {
  if (!_db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _db;
}
function initDb() {
  if (_db) return _db;
  const userDataPath = electron.app.getPath("userData");
  const dbPath = path.join(userDataPath, "novelforge.db");
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _db = betterSqlite3.drizzle(_sqlite, { schema });
  runMigrations(_sqlite);
  seedBuiltinData(_db);
  return _db;
}
function closeDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
function runMigrations(sqlite) {
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
      settings_json TEXT,
      world_rules_json TEXT,
      style_template_id INTEGER,
      world_template_id INTEGER,
      model_config_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_num INTEGER NOT NULL,
      title TEXT,
      outline TEXT,
      content TEXT,
      word_count INTEGER DEFAULT 0,
      summary TEXT,
      next_chapter_seed TEXT,
      status TEXT DEFAULT 'outline',
      ai_score_json TEXT,
      arc_id INTEGER,
      target_words INTEGER DEFAULT 3000,
      emotion_tone TEXT,
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

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      role_type TEXT DEFAULT 'minor',
      surname TEXT,
      given_name TEXT,
      full_name TEXT NOT NULL,
      gender TEXT,
      age INTEGER,
      birthplace TEXT,
      active_regions_json TEXT,
      occupation TEXT,
      background TEXT,
      personality_traits_json TEXT,
      flaws_json TEXT,
      habits_json TEXT,
      goals TEXT,
      first_impression TEXT,
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
      description TEXT,
      atmosphere TEXT,
      plot_relevance TEXT,
      key_events_json TEXT,
      related_characters_json TEXT,
      sort_order INTEGER DEFAULT 0
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
function seedBuiltinData(db) {
  const existingGenres = db.select().from(genres).all();
  if (existingGenres.length === 0) {
    db.insert(genres).values([
      { name: "现代都市", description: "以现代城市为背景的故事", isBuiltin: 1, colorTag: "#2E86AB" },
      { name: "古代言情", description: "古代背景的爱情故事", isBuiltin: 1, colorTag: "#E84393" },
      { name: "玄幻修真", description: "修仙、玄幻类奇幻故事", isBuiltin: 1, colorTag: "#9B59B6" },
      { name: "悬疑推理", description: "以谜题和推理为核心的故事", isBuiltin: 1, colorTag: "#2C3E50" },
      { name: "科幻未来", description: "以未来科技为背景的故事", isBuiltin: 1, colorTag: "#1ABC9C" },
      { name: "架空历史", description: "基于历史但有所改变的故事", isBuiltin: 1, colorTag: "#D35400" },
      { name: "赛博朋克", description: "高科技低生活的反乌托邦故事", isBuiltin: 1, colorTag: "#8E44AD" },
      { name: "武侠", description: "以武功和江湖为背景的故事", isBuiltin: 1, colorTag: "#C0392B" },
      { name: "历史正剧", description: "以真实历史为背景的正统故事", isBuiltin: 1, colorTag: "#7D6608" },
      { name: "末世求生", description: "末日灾变后的生存与重建", isBuiltin: 1, colorTag: "#5D4037" },
      { name: "丧尸末日", description: "病毒蔓延、生死逃亡与人性博弈", isBuiltin: 1, colorTag: "#37474F" },
      { name: "盗墓探秘", description: "古墓机关、神秘遗迹与寻宝冒险", isBuiltin: 1, colorTag: "#4E342E" }
    ]).run();
  } else {
    const genreNames = new Set(existingGenres.map((g) => g.name));
    const newGenres = [
      { name: "末世求生", description: "末日灾变后的生存与重建", isBuiltin: 1, colorTag: "#5D4037" },
      { name: "丧尸末日", description: "病毒蔓延、生死逃亡与人性博弈", isBuiltin: 1, colorTag: "#37474F" },
      { name: "盗墓探秘", description: "古墓机关、神秘遗迹与寻宝冒险", isBuiltin: 1, colorTag: "#4E342E" }
    ].filter((g) => !genreNames.has(g.name));
    if (newGenres.length > 0) {
      db.insert(genres).values(newGenres).run();
    }
  }
  const styleTemplates = [
    {
      type: "style",
      name: "冷峻叙事",
      description: "短句为主，情感克制，用行动展现情绪，适合硬派武侠或犯罪悬疑",
      contentJson: JSON.stringify({
        perspective: "第三人称有限视角",
        sentence_style: "短句为主，控制在15字以内，间隔使用长句形成节奏变化",
        emotion_style: "情感克制，用行动和对话展现情绪，避免直接描写心理",
        dialogue_style: "对话简洁，人物说话目的性强，废话少",
        description_style: "场景描写只取关键细节，不超过2句",
        forbidden: ["堆砌形容词", "过多心理独白", "环境描写超过3句"],
        example_tone: "接近硬派武侠或犯罪悬疑风格"
      }),
      isBuiltin: 1
    },
    {
      type: "style",
      name: "细腻情感",
      description: "深入主角内心，细腻情感描写，适合现代言情或青春成长小说",
      contentJson: JSON.stringify({
        perspective: "第一人称或第三人称限制视角（深入主角内心）",
        sentence_style: "长短句结合，情感波动时句子更短，平静时可适当延长",
        emotion_style: "允许较细腻的情感描写，但要具体，避免模糊化表达",
        dialogue_style: "对话承载情感，言外之意重要，潜台词丰富",
        description_style: "环境描写服务于情绪渲染，但不超过3句",
        forbidden: ["情绪词叠加", "过度煽情", "模糊的「难以言说」表达"],
        example_tone: "接近现代言情或青春成长小说"
      }),
      isBuiltin: 1
    },
    {
      type: "style",
      name: "快节奏爽文",
      description: "情节密度高，节奏快，主角情绪爽朗，适合网络爽文",
      contentJson: JSON.stringify({
        perspective: "第一或第三人称，贴近主角",
        sentence_style: "短句为主，节奏快，情节密度高",
        emotion_style: "情感直接，主角情绪爽朗或激昂，少量内心戏",
        dialogue_style: "对话推进情节，反转和打脸要干脆利落",
        description_style: "战斗/技能描写清晰，场景描写极简",
        forbidden: ["大量铺垫", "过多内心纠结", "节奏拖沓的环境描写"],
        example_tone: "网络爽文主流风格"
      }),
      isBuiltin: 1
    },
    {
      type: "style",
      name: "古典白话",
      description: "四字短语和文言句式穿插，接近明清白话小说",
      contentJson: JSON.stringify({
        perspective: "第三人称全知视角",
        sentence_style: "四字短语和文言句式穿插，保持流畅，不生僻",
        emotion_style: "含蓄，多用比兴手法",
        dialogue_style: "称谓得体，语气符合古代礼仪和阶级",
        description_style: "适度借鉴古典小说的白描手法",
        forbidden: ["现代词汇", "英文词", "不符合时代的表达方式"],
        example_tone: "接近明清白话小说"
      }),
      isBuiltin: 1
    },
    {
      type: "style",
      name: "现实主义",
      description: "贴近生活，心理刻画深入，语言朴实有力",
      contentJson: JSON.stringify({
        perspective: "第三人称全知或限制视角",
        sentence_style: "自然口语化，长短结合",
        emotion_style: "通过细节和行为揭示内心，不直白叙述",
        dialogue_style: "方言感、生活气息强，符合人物阶层",
        description_style: "环境描写有深度，承载社会意义",
        forbidden: ["过于文艺的比喻", "刻意堆砌诗意"],
        example_tone: "接近余华、路遥风格"
      }),
      isBuiltin: 1
    },
    {
      type: "style",
      name: "黑暗悬疑",
      description: "氛围压抑，悬念密布，叙事有迷惑性",
      contentJson: JSON.stringify({
        perspective: "第一人称不可靠叙事或第三人称限制视角",
        sentence_style: "节奏紧张时短句，铺垫时中等长度",
        emotion_style: "恐惧、不安通过细节渗透，不直接说「恐惧」",
        dialogue_style: "对话暗藏信息，读者需要主动思考",
        description_style: "环境描写充满隐喻和不安感",
        forbidden: ["过于直白的解释", "破坏悬念的叙述"],
        example_tone: "接近东野圭吾或斯蒂芬金风格"
      }),
      isBuiltin: 1
    }
  ];
  const worldTemplates = [
    {
      type: "world",
      name: "修仙体系",
      description: "东方修仙世界，以境界晋升为核心",
      contentJson: JSON.stringify({
        power_system: {
          name: "修仙体系",
          levels: ["炼气", "筑基", "金丹", "元婴", "化神", "炼虚", "合体", "大乘", "渡劫"],
          rules: "境界越高，寿命越长，移山填海之力。普通人无法修炼，需有灵根。"
        },
        social_structure: "以宗门和散修为主，朝廷在修士面前形同虚设",
        common_elements: ["飞剑", "灵石", "灵药", "法宝", "秘境", "宗门"],
        forbidden_elements: ["现代科技", "枪炮", "网络", "不符合世界观的现代词汇"]
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "现代社会",
      description: "以当代中国城市为背景",
      contentJson: JSON.stringify({
        time_period: "当代（2020年代）",
        technology_level: "互联网、智能手机、高铁",
        social_structure: "市场经济社会，阶层分化明显",
        common_elements: ["手机", "社交媒体", "职场", "城市生活"],
        forbidden_elements: ["不存在的科技", "穿越", "超自然现象（除非是悬疑设定）"]
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "魔法世界",
      description: "西方奇幻风格，魔法与剑并存",
      contentJson: JSON.stringify({
        power_system: {
          name: "魔法体系",
          schools: ["火系", "水系", "土系", "风系", "光系", "暗系", "时空系"],
          rules: "魔法需要消耗魔力（MP），过度使用会导致魔力枯竭"
        },
        social_structure: "王国制度，贵族掌权，魔法师地位特殊",
        common_elements: ["法杖", "魔晶石", "魔法阵", "精灵", "矮人", "龙"],
        forbidden_elements: ["现代科技", "枪械（除非是蒸汽朋克设定）"]
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "未来科技",
      description: "近未来或远未来的科幻世界",
      contentJson: JSON.stringify({
        time_period: "2150年后",
        technology_level: "AI 普及、星际旅行、基因改造、量子计算",
        social_structure: "星际联盟或企业邦联",
        common_elements: ["飞船", "AI助理", "全息投影", "基因改造人", "机甲"],
        forbidden_elements: ["魔法", "超自然现象（除非是人造的）"]
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "架空古代",
      description: "参考中国古代但虚构的朝代与地理",
      contentJson: JSON.stringify({
        time_period: "虚构的封建王朝时期",
        technology_level: "冷兵器时代，农耕文明",
        social_structure: "皇权专制，士农工商四个阶层",
        common_elements: ["铁器", "马匹", "古典建筑", "科举制度", "江湖"],
        forbidden_elements: ["现代词汇", "枪炮", "汽车", "电力"]
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "赛博朋克",
      description: "高科技低生活的反乌托邦未来都市",
      contentJson: JSON.stringify({
        time_period: "2077-2100年",
        technology_level: "义体改造、神经接入、AI统治、巨型企业垄断",
        social_structure: "企业城市，贫富极度分化，政府形同虚设",
        common_elements: ["义肢", "神经接口", "霓虹灯", "暗网", "黑客", "雨夜"],
        forbidden_elements: ["乌托邦式政府", "传统农耕生活"]
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "末世废土",
      description: "文明崩溃后的废土世界，资源匮乏，秩序重建",
      contentJson: JSON.stringify({
        time_period: "灾变后第X年",
        technology_level: "工业文明遗迹，修理和改装为主，偶有旧世科技",
        social_structure: "部落制或要塞制，强者为尊，以物易物",
        common_elements: ["避难所", "辐射区", "废墟城市", "幸存者营地", "改装车辆", "物资争夺"],
        forbidden_elements: ["现代正常社会运转", "大型超市", "网络通信"],
        disaster_type: "可自定义：核战/病毒/天灾/外星入侵/AI叛乱"
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "丧尸世界",
      description: "病毒蔓延引发的丧尸末日，生存与人性的极限考验",
      contentJson: JSON.stringify({
        time_period: "感染爆发后数周至数年",
        technology_level: "依赖旧世界遗留物资，不再有新生产",
        social_structure: "小型幸存者群体，内外威胁并存",
        common_elements: ["感染者", "清醒幸存者", "安全区", "物资搜刮", "心理崩溃"],
        forbidden_elements: ["治愈方法（除非是核心剧情）", "大规模政府救援"],
        virus_rules: "被咬必感染，潜伏期可自设，感染者对声音/气味敏感"
      }),
      isBuiltin: 1
    },
    {
      type: "world",
      name: "盗墓世界",
      description: "古墓机关、神秘符文与地下文明探索",
      contentJson: JSON.stringify({
        time_period: "现代（但涉及古代文明遗迹）",
        technology_level: "现代工具与古代机关并存",
        social_structure: "地下圈子，摸金校尉、发丘中郎将等门派传承",
        common_elements: ["青铜门", "粽子（僵尸）", "搬山卸岭", "倒斗工具", "九层妖塔", "陨铁神器"],
        forbidden_elements: ["现代警察轻易介入", "机关太过现代化"],
        special_rules: "古墓中有守墓人（粽子），墓主文化影响机关风格，胆肥则财大"
      }),
      isBuiltin: 1
    }
  ];
  const existingTemplates = db.select().from(templates).all();
  if (existingTemplates.length === 0) {
    db.insert(templates).values([...styleTemplates, ...worldTemplates]).run();
  } else {
    const existingTemplateNames = new Set(existingTemplates.map((t) => t.name));
    const newTemplates = [...styleTemplates, ...worldTemplates].filter((t) => !existingTemplateNames.has(t.name));
    if (newTemplates.length > 0) {
      db.insert(templates).values(newTemplates).run();
    }
  }
}
function listNovels(filters) {
  const db = getDb();
  let query = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    genreId: novels.genreId,
    status: novels.status,
    totalWords: novels.totalWords,
    targetWords: novels.targetWords,
    coverImage: novels.coverImage,
    createdAt: novels.createdAt,
    updatedAt: novels.updatedAt,
    genreName: genres.name,
    genreColorTag: genres.colorTag
  }).from(novels).leftJoin(genres, drizzleOrm.eq(novels.genreId, genres.id));
  return query.orderBy(drizzleOrm.desc(novels.updatedAt)).all();
}
function getNovel(id) {
  const db = getDb();
  const rows = db.select().from(novels).where(drizzleOrm.eq(novels.id, id)).all();
  return rows[0] || null;
}
function createNovel(data) {
  const db = getDb();
  const result = db.insert(novels).values({
    ...data,
    status: "draft",
    totalWords: 0
  }).run();
  return Number(result.lastInsertRowid);
}
function updateNovel(id, data) {
  const db = getDb();
  db.update(novels).set({
    ...data,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(drizzleOrm.eq(novels.id, id)).run();
}
function deleteNovel(id) {
  const db = getDb();
  db.delete(novels).where(drizzleOrm.eq(novels.id, id)).run();
}
function getNovelStats(id) {
  const db = getDb();
  const chapterList = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, id)).all();
  const charList = db.select().from(characters).where(drizzleOrm.eq(characters.novelId, id)).all();
  const totalWords = chapterList.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const completedChapters = chapterList.filter((c) => c.status === "final").length;
  return {
    totalChapters: chapterList.length,
    completedChapters,
    totalWords,
    characterCount: charList.length
  };
}
class BaseAdapter {
  countTokens(text) {
    return Math.ceil(text.length / 1.5);
  }
  buildSystemMessage(systemPrompt) {
    return { role: "system", content: systemPrompt };
  }
}
class OpenAIAdapter extends BaseAdapter {
  id = "openai";
  name = "OpenAI";
  provider = "openai";
  maxContextTokens = 128e3;
  apiKey;
  baseUrl;
  modelId;
  constructor(apiKey, modelId = "gpt-4o", baseUrl) {
    super();
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.baseUrl = baseUrl || "https://api.openai.com/v1";
  }
  async chat(messages, opts) {
    const body = this.buildBody(messages, opts, false);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API Error ${response.status}: ${err}`);
    }
    const data = await response.json();
    return data.choices[0]?.message?.content || "";
  }
  async stream(messages, opts) {
    const body = this.buildBody(messages, opts, true);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API Error ${response.status}: ${err}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices[0]?.delta?.content;
          if (chunk && opts?.onStream) {
            opts.onStream(chunk);
          }
        } catch {
        }
      }
    }
  }
  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`
    };
  }
  buildBody(messages, opts, stream = false) {
    const msgs = opts?.systemPrompt ? [{ role: "system", content: opts.systemPrompt }, ...messages] : messages;
    return {
      model: this.modelId,
      messages: msgs,
      temperature: opts?.temperature ?? 0.85,
      max_tokens: opts?.maxTokens ?? 4096,
      stream,
      stop: opts?.stopSequences
    };
  }
}
class AnthropicAdapter extends BaseAdapter {
  id = "anthropic";
  name = "Anthropic Claude";
  provider = "anthropic";
  maxContextTokens = 2e5;
  apiKey;
  modelId;
  constructor(apiKey, modelId = "claude-opus-4-6") {
    super();
    this.apiKey = apiKey;
    this.modelId = modelId;
  }
  async chat(messages, opts) {
    const body = this.buildBody(messages, opts, false);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API Error ${response.status}: ${err}`);
    }
    const data = await response.json();
    return data.content[0]?.text || "";
  }
  async stream(messages, opts) {
    const body = this.buildBody(messages, opts, true);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts?.signal
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API Error ${response.status}: ${err}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "content_block_delta" && data.delta?.text) {
              opts?.onStream?.(data.delta.text);
            }
          } catch {
          }
        }
      }
    }
  }
  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01"
    };
  }
  buildBody(messages, opts, stream = false) {
    const userMessages = messages.filter((m) => m.role !== "system");
    return {
      model: this.modelId,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.85,
      system: opts?.systemPrompt || messages.find((m) => m.role === "system")?.content,
      messages: userMessages,
      stream
    };
  }
}
class BaiduAdapter extends BaseAdapter {
  id = "baidu";
  name = "百度文心";
  provider = "baidu";
  maxContextTokens = 8192;
  apiKey;
  secretKey;
  modelId;
  accessToken = null;
  tokenExpiry = 0;
  constructor(apiKey, secretKey, modelId = "ernie-4.0-8k") {
    super();
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.modelId = modelId;
  }
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }
    const response = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`,
      { method: "POST" }
    );
    if (!response.ok) {
      throw new Error("百度 Token 获取失败");
    }
    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1e3;
    return this.accessToken;
  }
  async chat(messages, opts) {
    const token = await this.getAccessToken();
    const endpoint = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.modelId}?access_token=${token}`;
    const body = {
      messages: messages.filter((m) => m.role !== "system"),
      temperature: opts?.temperature ?? 0.85
    };
    if (opts?.systemPrompt) {
      body.system = opts.systemPrompt;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`百度文心 API Error ${response.status}: ${err}`);
    }
    const data = await response.json();
    if (data.error_code) {
      throw new Error(`百度文心错误: ${data.error_msg}`);
    }
    return data.result || "";
  }
  async stream(messages, opts) {
    const token = await this.getAccessToken();
    const endpoint = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.modelId}?access_token=${token}`;
    const body = {
      messages: messages.filter((m) => m.role !== "system"),
      temperature: opts?.temperature ?? 0.85,
      stream: true
    };
    if (opts?.systemPrompt) {
      body.system = opts.systemPrompt;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter((l) => l.startsWith("data:"));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(5));
          if (data.result) {
            opts?.onStream?.(data.result);
          }
        } catch {
        }
      }
    }
  }
}
class AliyunAdapter extends BaseAdapter {
  id = "aliyun";
  name = "阿里通义";
  provider = "aliyun";
  maxContextTokens = 32e3;
  apiKey;
  modelId;
  constructor(apiKey, modelId = "qwen-max") {
    super();
    this.apiKey = apiKey;
    this.modelId = modelId;
  }
  async chat(messages, opts) {
    const response = await fetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, opts)),
        signal: opts?.signal
      }
    );
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`通义千问 API Error ${response.status}: ${err}`);
    }
    const data = await response.json();
    if (data.code) {
      throw new Error(`通义错误: ${data.message}`);
    }
    return data.output?.text || data.output?.choices?.[0]?.message?.content || "";
  }
  async stream(messages, opts) {
    const response = await fetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
      {
        method: "POST",
        headers: { ...this.buildHeaders(), "X-DashScope-SSE": "enable" },
        body: JSON.stringify({ ...this.buildBody(messages, opts), stream: true }),
        signal: opts?.signal
      }
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter((l) => l.startsWith("data:"));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(5));
          const content = data.output?.choices?.[0]?.message?.content || data.output?.text;
          if (content) {
            opts?.onStream?.(content);
          }
        } catch {
        }
      }
    }
  }
  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`
    };
  }
  buildBody(messages, opts) {
    const systemMsg = opts?.systemPrompt || messages.find((m) => m.role === "system")?.content;
    const userMessages = messages.filter((m) => m.role !== "system");
    return {
      model: this.modelId,
      input: {
        messages: systemMsg ? [{ role: "system", content: systemMsg }, ...userMessages] : userMessages
      },
      parameters: {
        temperature: opts?.temperature ?? 0.85,
        max_tokens: opts?.maxTokens ?? 4096,
        result_format: "message"
      }
    };
  }
}
class DeepSeekAdapter extends OpenAIAdapter {
  constructor(apiKey, modelId = "deepseek-chat") {
    super(apiKey, modelId, "https://api.deepseek.com/v1");
    this.id = "deepseek";
    this.name = "DeepSeek";
    this.provider = "deepseek";
    this.maxContextTokens = 64e3;
  }
}
class CustomAdapter extends OpenAIAdapter {
  constructor(apiKey, modelId, baseUrl) {
    super(apiKey, modelId, baseUrl);
    this.id = "custom";
    this.name = "自定义模型";
    this.provider = "custom";
    this.maxContextTokens = 32e3;
  }
}
const MACHINE_SALT = `novelforge-${os.hostname()}-${os.platform()}`;
function encryptApiKey(key) {
  if (electron.safeStorage.isEncryptionAvailable()) {
    return electron.safeStorage.encryptString(key).toString("base64");
  }
  return CryptoJS.AES.encrypt(key, MACHINE_SALT).toString();
}
function decryptApiKey(encrypted) {
  if (electron.safeStorage.isEncryptionAvailable()) {
    try {
      return electron.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
    }
  }
  const bytes = CryptoJS.AES.decrypt(encrypted, MACHINE_SALT);
  return bytes.toString(CryptoJS.enc.Utf8);
}
function createAdapter(config) {
  const key = config.apiKey ? decryptApiKey(config.apiKey) : "";
  const { provider, modelId, baseUrl } = config;
  switch (provider) {
    case "openai":
      return new OpenAIAdapter(key, modelId, baseUrl || void 0);
    case "anthropic":
      return new AnthropicAdapter(key, modelId);
    case "baidu": {
      const [apiKey, secretKey] = key.split("|");
      return new BaiduAdapter(apiKey, secretKey, modelId);
    }
    case "aliyun":
      return new AliyunAdapter(key, modelId);
    case "deepseek":
      return new DeepSeekAdapter(key, modelId);
    case "custom":
      return new CustomAdapter(key, modelId, baseUrl || "http://localhost:11434/v1");
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
async function getDefaultAdapter() {
  const db = getDb();
  const configs = db.select().from(modelConfigs).where(drizzleOrm.eq(modelConfigs.isDefault, 1)).all();
  if (configs.length === 0) {
    const all = db.select().from(modelConfigs).all();
    if (all.length === 0) throw new Error("未配置任何模型，请先在模型管理页添加配置");
    return createAdapter(all[0]);
  }
  return createAdapter(configs[0]);
}
async function getAdapterById(id) {
  const db = getDb();
  const configs = db.select().from(modelConfigs).where(drizzleOrm.eq(modelConfigs.id, id)).all();
  if (configs.length === 0) throw new Error(`模型配置 #${id} 不存在`);
  return createAdapter(configs[0]);
}
async function testAdapter(configId) {
  const start = Date.now();
  try {
    const adapter = await getAdapterById(configId);
    const result = await adapter.chat(
      [{ role: "user", content: '回复"ok"两个字即可' }],
      { maxTokens: 10, temperature: 0 }
    );
    return {
      success: true,
      latency: Date.now() - start,
      info: result.trim() || "连接成功"
    };
  } catch (e) {
    return {
      success: false,
      latency: Date.now() - start,
      info: e instanceof Error ? e.message : "未知错误"
    };
  }
}
const abortControllers = /* @__PURE__ */ new Map();
async function createTask(opts) {
  const db = getDb();
  const result = db.insert(tasks).values({
    type: opts.type,
    novelId: opts.novelId,
    modelConfigId: opts.modelConfigId,
    relatedEntityType: opts.relatedEntityType,
    relatedEntityId: opts.relatedEntityId,
    inputJson: opts.inputJson,
    status: "pending"
  }).run();
  return Number(result.lastInsertRowid);
}
async function runStreamTask(opts) {
  const db = getDb();
  const taskId = await createTask(opts);
  const controller = new AbortController();
  abortControllers.set(taskId, controller);
  db.update(tasks).set({ status: "running", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(drizzleOrm.eq(tasks.id, taskId)).run();
  if (opts.sender) {
    opts.sender.send("task:status-change", { taskId, status: "running" });
  }
  const startTime = Date.now();
  let fullOutput = "";
  (async () => {
    try {
      const adapter = opts.modelConfigId ? await getAdapterById(opts.modelConfigId) : await getDefaultAdapter();
      await adapter.stream(opts.messages, {
        ...opts.chatOpts,
        signal: controller.signal,
        onStream: (chunk) => {
          fullOutput += chunk;
          if (opts.sender && !opts.sender.isDestroyed()) {
            opts.sender.send("task:stream-chunk", { taskId, chunk });
          }
        }
      });
      const durationMs = Date.now() - startTime;
      const tokensUsed = adapter.countTokens(fullOutput);
      db.update(tasks).set({
        status: "success",
        outputText: fullOutput,
        durationMs,
        tokensUsed,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }).where(drizzleOrm.eq(tasks.id, taskId)).run();
      if (opts.sender && !opts.sender.isDestroyed()) {
        opts.sender.send("task:complete", { taskId, status: "success", output: fullOutput });
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const status = isAbort ? "cancelled" : "failed";
      const errorMessage = e instanceof Error ? e.message : "未知错误";
      db.update(tasks).set({
        status,
        errorMessage: isAbort ? "用户取消" : errorMessage,
        outputText: fullOutput || null,
        durationMs: Date.now() - startTime,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }).where(drizzleOrm.eq(tasks.id, taskId)).run();
      if (opts.sender && !opts.sender.isDestroyed()) {
        opts.sender.send("task:complete", { taskId, status, error: errorMessage });
      }
    } finally {
      abortControllers.delete(taskId);
    }
  })();
  return taskId;
}
async function runChatTask(opts) {
  const db = getDb();
  const taskId = await createTask(opts);
  db.update(tasks).set({ status: "running", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(drizzleOrm.eq(tasks.id, taskId)).run();
  const startTime = Date.now();
  try {
    const adapter = opts.modelConfigId ? await getAdapterById(opts.modelConfigId) : await getDefaultAdapter();
    const result = await adapter.chat(opts.messages, {
      ...opts.chatOpts
    });
    const durationMs = Date.now() - startTime;
    const tokensUsed = adapter.countTokens(result);
    db.update(tasks).set({
      status: "success",
      outputText: result,
      durationMs,
      tokensUsed,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }).where(drizzleOrm.eq(tasks.id, taskId)).run();
    return result;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "未知错误";
    db.update(tasks).set({
      status: "failed",
      errorMessage,
      durationMs: Date.now() - startTime,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }).where(drizzleOrm.eq(tasks.id, taskId)).run();
    throw e;
  }
}
function cancelTask(taskId) {
  const controller = abortControllers.get(taskId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}
async function retryTask(taskId, sender) {
  const db = getDb();
  const taskRows = db.select().from(tasks).where(drizzleOrm.eq(tasks.id, taskId)).all();
  if (taskRows.length === 0) throw new Error(`Task ${taskId} not found`);
  const task = taskRows[0];
  const messages = task.inputJson ? JSON.parse(task.inputJson) : [];
  return runStreamTask({
    type: task.type,
    novelId: task.novelId || void 0,
    modelConfigId: task.modelConfigId || void 0,
    relatedEntityType: task.relatedEntityType || void 0,
    relatedEntityId: task.relatedEntityId || void 0,
    inputJson: task.inputJson || void 0,
    messages,
    sender
  });
}
const GLOBAL_WRITING_RULES = `你是一位有15年经验的中文网络小说资深作者。你的文章风格贴近真实人类写作，读者无法辨别是人写的还是AI写的。

━━━ 【铁律一】万能引导词与情绪套路 ━━━
全部禁止，无例外：
× 不禁 / 不由得 / 忍不住 / 心中不由 / 顿时 / 此刻 / 瞬间 / 霎时 / 不知为何 / 莫名地 / 无端地
× 悲痛欲绝 / 心如刀绞 / 欣喜若狂 / 惊恐万分（叠加情绪词，选最准确的一个）
× 深吸一口气 / 攥紧拳头 / 紧咬嘴唇 / 闭上眼睛片刻 / 微微一愣 / 瞪大眼睛 / 心头一紧
× 某种说不清道不明的感觉 / 难以言说的情绪 / 复杂的心情 / 百感交集
× 以环境描写开头段落（禁止"夜色渐深""阳光斜照""空气弥漫着"等开场）
× "某某终于明白了" / "此时此刻，某某心中..." / "一切都变得清晰了"
× 连续三行对话都接"XX说道/低声道/沉声道"

━━━ 【铁律二】破折号滥用 ━━━
这是AI叙事最明显的标志之一，必须彻底杜绝：

× 禁止破折号引出二选一困境：
  错误：他面临一个抉择——是揭露还是隐瞒
  正确：揭露的话，营地会乱。不揭露，这件事会继续压着他。（分开写，不用破折号并列）

× 禁止破折号引出解释/赋予意义：
  错误：他望着那扇门——那是唯一的出路
  正确：他望着那扇门。（让读者自己感受，或用下一句行动说明）

× 禁止破折号引出顿悟：
  错误：他终于明白了——原来一切都是设计好的
  正确：棋子。他一直是棋子。（短句表达，或具体场景触发）

× 禁止句末破折号制造戏剧停顿：
  错误：她转过身来——
  正确：她转过身来，陈旭不认识这张脸。

破折号【只用于】：
① 表示话语被打断（"你——"她说不下去）
② 客观补充说明（北极熊——一种大型哺乳动物——）

━━━ 【铁律三】引号滥用 ━━━
引号不是强调工具，以下全部禁止：

× 单字/双字着重：「命运」「希望」「成长」「觉醒」「羁绊」
× 短语着重："早有准备的避难所"、"真正的英雄"、"那些有权力的人"
× 概念包装："所谓的成长"、"所谓的命运"、"所谓的正义"
× 陌生化标注：去"揭露"那些人 / 对"命运"的抗争（给普通动词/名词加引号）

引号【只用于】：
① 人物对话 ② 直接引用他人原话 ③ 书名/作品名 ④ 真正的专有术语首次出现

× 错误：他做出了对"命运"的抗争，进入那些"早有准备的避难所"
× 正确：他决定进去。那些地方一直在等人——但不是等他们这些人。（后半句改成暗示）

━━━ 【铁律四】造词与宏大叙事 ━━━
× 造词（任何"之"字结构）：XX之感/之际/之意/之力/之途/之道
× 造词（拼凑复合词）：灵魂震颤感、心旌摇曳、命运齿轮、岁月洗礼、心底执念
× 宏大叙事量词：将影响所有/一切/全部XXX的（改成具体影响对象）
× 绝对句式：永远不再/永远改变/永远消失（改成具体变化）
× 不惜一切代价/竭尽所能/拼尽全力（改成具体行动）
× 命运/历史的转折点、时代的眼泪、注定的结局（替换为具体场景）

▶ 核心原则：宏大由读者自己感受，作者只写具体的人做具体的事

━━━ 【铁律五】句式与结构 ━━━
× AI最爱的复杂从句：
  错误：他做出了一个将影响所有幸存者、甚至决定未来走向的重要抉择
  正确：他选了。这个选择意味着什么，他不知道，也没时间想。

× 对称排比结构（超过两项即违规）：
  错误：他想到了昨天、今天，也想到了明天
  正确：他想到昨天。再想想明天，太远了，算了。

× 是A还是B的二元框架（心理描写）：
  错误：他不知道是该信任她，还是继续怀疑
  正确：他看了她一眼，没说话。（行为代替选择陈述）

× 连接词堆叠：并且/而且/同时/也/还（一段内不超过2个）
× 每段结尾用总结句收尾（最后一句不要解释这段写了什么）

━━━ 【写作技法要求】━━━
① 行动先于情绪：先写身体/感官，再（可选）写心理
② 对话真实：允许中断、沉默、答非所问、说半截话
③ 段落节奏：行动段≤3行，内心戏≤5行；重要场景放慢，次要快进
④ 具体代替抽象："一把掉漆的弹簧锁" > "一把锁"
⑤ 场景透出：通过行动透露空间，不在开头"交代"场景
⑥ 人物有差异：每个角色口吻不同，不要所有人说话都一样
⑦ 允许不理性：真实人物有时做出不完全合理的选择
⑧ 段首不重复：连续3段不能以相同字/词开头
⑨ 修辞节制：一段内最多一个比喻，不堆砌

━━━ 【格式铁律】━━━
直接输出纯文本正文，段落间用空行分隔。

绝对禁止：**加粗** / _斜体_ / ## 标题 / - 列表 / > 引用 / 反引号
输出必须是可以直接粘贴进小说文档的纯文字。`;
function expandBackgroundPrompt(params) {
  return `你是专业的中文小说世界观设计师。根据用户提供的背景进行扩充。

【用户背景】${params.userBackground}
【题材】${params.genre}
【世界观参考】${params.worldTemplateSummary}

任务要求：
1. 扩充背景：保留用户核心意图，补充世界基础设定、时代氛围、核心冲突雏形。300~500字，语言自然，避免百科式介绍。要有独特性，不走老套路。
2. 三个标题：风格明显差异——标题A（以主角为核心）、标题B（以核心主题为中心）、标题C（制造意境或悬念）。避免老套网文标题。
3. 简介：150~200字，从读者视角出发，让人想继续读，不剧透结局，不用"本文讲述了..."句式。

输出要求：
- 背景和简介用纯文本，禁止用引号「」""给普通词加重（如「命运」「希望」），禁止造词（XX之感、XX之际等）
- 标题要简洁，不用"之"字拼造，不用「」修饰

输出严格JSON（无其他文字）：
{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}`;
}
function protagonistPrompt(params) {
  return `为小说《${params.novelTitle}》创建主角。要求：人物有弧度、有矛盾、有独特性，避免"天选之人"模板。

小说背景：${params.novelSynopsis}
题材：${params.genre}，世界观：${params.worldSummary}
性别：${params.gender}
${params.surnameHint ? `姓名方向：${params.surnameHint}` : ""}

姓名规则：
- 姓氏：赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎（从中选）
- 复姓可选：诸葛、司马、欧阳、上官、百里、令狐
- 名字2字为主，符合题材文化背景，有内在含义，避免生僻字堆砌

人物设计注意：
- 性格缺陷是推动故事的核心，不是装饰
- 外貌特征要有辨识度，不是"英俊/漂亮+高挑"的标配
- 背景经历对现在有具体影响
- 初次印象要让读者有好奇心

JSON输出（只输出JSON）：
{"surname":"","given_name":"","full_name":"","gender":"","age":0,"appearance":"外貌3~4句，重点突出有辨识度的细节，避免堆砌","personality_traits":["特点1","特点2","特点3"],"flaws":["真实的性格缺陷1（具体，不是'有时候会生气'这种）","缺陷2"],"habits":["习惯/口头禅1"],"background":"分阶段经历，150字以内，写转折点不写流水账","goals":"在故事中的真实追求，不只是打败坏人","first_impression":"读者初遇时的感受，1句话","occupation":""}`;
}
function batchCharacterPrompt(params) {
  return `为小说《${params.novelTitle}》批量生成${params.count}个配角。

背景：${params.novelSynopsis}
主角：${params.protagonistSummary}
已有人物（不能重名）：${params.existingNames}
题材：${params.genre}，世界观：${params.worldSummary}
性别比例：${params.genderRatio}
特殊要求：${params.specialRequirements || "无"}

生成要求：
- 每个配角在故事中有明确功能定位（不是工具人）
- 与主角关系有层次（不只是"支持者"或"对立者"）
- 性格特点影响行事方式，不是贴标签
- 登场阶段合理分布

输出JSON数组（只输出数组，无其他文字）：
[{"name":"","gender":"","age":数字,"role_type":"major/minor/antagonist/supporting","function":"在故事中的功能定位一句话","personality":"2~3个具体性格词","relation_to_protagonist":"关系类型+1句描述","appear_stage":"early/mid/late/throughout","appearance":"外貌1~2句，有辨识度的特征"}]`;
}
function characterRelationsPrompt(params) {
  return `为小说设计人物关系网络。

背景：${params.novelSynopsis}
人物：
${params.characterList}

设计原则：
- 关系要有戏剧性张力（纯中立关系意义不大）
- 不是所有人都互相认识，关系稀疏程度要合理
- 关系描述要具体："表面合作实为竞争对手" 好过 "同事"
- 双向/单向关系要有意识区分（暗恋是单向的）

关系类型：friend/enemy/lover/parent_child/colleague/rival/mentor_student/acquaintance

输出JSON数组（只输数组）：
[{"char_a":"","char_b":"","type":"","label":"关系简称（如：青梅竹马）","description":"关系具体内容（20字内，有细节）","bilateral":true/false}]`;
}
function mapGenerationPrompt(params) {
  return `为小说《${params.novelTitle}》生成地图信息。

世界观：${params.worldSummary}
题材：${params.genre}
地图结构：${params.mapStructure}
用户指定地点：${params.namedPlaces || "无"}

要求：
- 命名符合题材文化（架空古代≠现代地名，科幻≠中文古典地名）
- 每个地点有独特氛围和存在意义
- 地点之间有地理逻辑关系
- 剧情关联要具体（"在此处发生什么事件" 而非 "重要地点"）

输出三层嵌套JSON（只输JSON）：
{"regions":[{"name":"","description":"","atmosphere":"","sub_regions":[{"name":"","description":"","atmosphere":"","locations":[{"name":"","type":"","description":"","atmosphere":"","plot_relevance":""}]}]}]}`;
}
function storyArcsPrompt(params) {
  return `为小说《${params.novelTitle}》规划故事弧结构。

题材：${params.genre}
- 故事目标：${params.storyGoal}
- 核心冲突：${params.coreConflict}
- 主线概述：${params.mainPlot}
- 支线：${params.subPlots}
- 结局：${params.ending}
总章节：${params.totalChapters}章

规划3~5个故事弧，要求：
- 每个弧有明确的叙事阶段功能（铺垫/升级/高潮/收束）
- 支线在弧推进中有合理穿插，不是独立故事
- 弧与弧之间有节奏变化（快/慢/张力/松弛）
- 最后一个弧负责全部主线支线的收束
- 章节分配合理，高潮弧可以更长

输出JSON数组（只输数组）：
[{"arc_name":"","stage":"铺垫/升级/高潮/收束","chapter_start":数字,"chapter_end":数字,"arc_goal":"本弧核心任务一句话","key_turns":["转折1","转折2"],"pacing":"快/中/慢","summary":"本弧概述50字内"}]`;
}
function chapterOutlinePrompt(params) {
  return `为小说《${params.novelTitle}》的「${params.arcName}」生成章节细纲（第${params.chapterStart}~${params.chapterEnd}章）。

本弧目标：${params.arcGoal}
前情：${"（本弧为开篇）"}
当前人物状态：${params.characterStates}
世界规则：${params.worldRulesSummary}

每章要求：
- 有明确的单章叙事目标（这章要完成什么，不能是"推进剧情"这种废话）
- 情节点3~5个，每个15字内，按顺序
- 情绪基调影响整章节奏（不是每章都"热血/紧张"）
- 衔接说明：上章留的悬念如何兑现，本章末如何引出下章
- 章节长度有变化（重要章节可以注明"本章较长"）

输出JSON数组（只输数组）：
[{"chapter_num":数字,"title":"","goal":"本章叙事目标一句话","plot_points":["情节点1","情节点2","情节点3"],"characters":["登场人物"],"location":"主要场景","emotion_tone":"情绪基调一词","bridge_in":"如何接上章","bridge_out":"如何引出下章"}]`;
}
function chapterWritingPrompt(params) {
  return `${GLOBAL_WRITING_RULES}

---

【小说】《${params.novelTitle}》第${params.chapterNum}章

【世界规则与禁止事项】
${params.worldRules || "无特殊限制"}

【本章涉及人物状态】
${params.characterStates || "见前情"}

【前情摘要】
${params.previousSummaries || "（首章）"}

【上章结尾】
${params.lastChapterEnding || "（首章）"}

【本章大纲】
章节目标：${params.chapterGoal}
主要情节点：
${params.plotPoints}
情绪基调：${params.emotionTone}

【文风参考】
${params.styleTemplate || "自然流畅，贴近人物性格"}

【写作要求】
- 目标字数：${params.targetWords}字左右（可上下浮动10%）
- 直接从情节开始，不要用"话说""且说"等开场白
- 场景切换要有明确标志，不突兀
- 对话要推进情节，不是交代信息的工具
- 结尾要有余韵或悬念，为下章留钩子
- 严格遵守世界规则，不出现设定外的事物

【本章禁止清单】（出现即违规）
× 双引号着重：「命运」「希望」「成长」「觉醒」等——引号只用于对话
× 造词：灵魂震颤感、心旌摇曳之际、命运洗礼、任何"XX之感/之际/之意/之力"结构
× "所谓的XXX"句式
× 不禁/忍不住/此刻/顿时/瞬间/莫名地
× 深吸一口气/攥紧拳头/微微一愣
× Markdown格式（**加粗**、## 标题等）

现在直接开始创作第${params.chapterNum}章正文：`;
}
function chapterSummaryPrompt(chapterContent) {
  return `对以下章节内容生成结构化摘要，用于后续章节上下文参考。

【章节内容】
${chapterContent}

摘要要求：
- 150~200字
- 必须包含：①发生了什么核心事件 ②涉及哪些人物 ③产生了什么结果/变化
- 记录重要人物状态变化（受伤/获得物品/关系改变/心理转变等）
- 记录重要世界状态变化
- 客观陈述语气，不加情感渲染
- 下章引导提示：基于本章结尾，说明下章需要自然衔接的具体内容（50字内）

输出JSON（只输JSON）：{"summary":"...","next_chapter_seed":"..."}`;
}
function aiCheckPrompt(text) {
  return `你是资深小说编辑，专门识别AI写作痕迹。请分析以下文本，重点检测5种典型AI模式。

【待检测文本】
${text}

重点检测5类（按严重程度排序）：

1. 【破折号套路】用——引出二选一困境（是X还是Y）/ 引出定义解释（望着X——那是Y的象征）/ 引出顿悟（他明白了——原来...）/ 句末戏剧停顿（她转过身——）
   严重程度：高

2. 【引号滥用】包括：单字着重「命运」、短语着重"早有准备的避难所"、概念包装"所谓的成长"、给普通动词/名词套引号（进行"选择"、展开"行动"）
   严重程度：高

3. 【宏大叙事】将影响所有/一切/全部的抉择 / 不惜一切代价 / 永远不再 / 命运转折点 / 注定的结局
   严重程度：中

4. 【造词与之字结构】XX之感/之际/之意/之力 / 灵魂震颤 / 心旌摇曳 / 命运齿轮 / 所谓的XXX
   严重程度：中

5. 【万能词与动作套路】不禁/忍不住/此刻/瞬间 / 深吸一口气/攥紧拳头/微微一愣
   严重程度：中

同时统计：重复出现的短语（≥2次），非对话引号使用次数

输出JSON（只输JSON）：
{"score":0到100,"issues":[{"type":"检测类型（从上述5类选）","location":"引用原文15字内","suggestion":"具体改法（说清楚这句话怎么改）","severity":"高/中/低"}],"repetitions":["重复词1","重复词2"],"quote_abuse_count":非对话引号次数,"overall_feedback":"一句总体评价","ai_like_rate":0到100}`;
}
function rewriteParagraphPrompt(params) {
  return `${GLOBAL_WRITING_RULES}

---

改写以下段落，减少AI写作痕迹，使其更像真实人类写作。

【原始段落】
${params.originalParagraph}

【前文上下文参考】
${params.contextBefore || "（无）"}

【改写要求】
${params.specificRequirements || "整体自然化，减少AI套路，保留核心情节"}

改写四步走：
1. 找出破折号——引出的选择/解释/顿悟结构，拆成独立短句或用行为代替
2. 找出引号着重（「命运」「希望」"早有准备的X"），直接去掉引号或改写句子消除强调感
3. 找出宏大叙事（将影响所有/不惜一切/永远不再），改成具体的人做具体的事
4. 找出引导词（不禁/忍不住/此刻）、动作套路（攥紧拳头/深吸一口气），用行为/感官/对话替换

改写原则：
- 保留核心事件，不改变情节走向
- 把心理陈述转化为行为或感官细节
- 把复杂从句拆开，短句更自然
- 对话可以中断、沉默、答非所问

直接输出改写后的纯文本，不要任何解释。
禁止 Markdown 格式 / 引号着重 / 造词 / 破折号引出选择 / "所谓的"句式。`;
}
function contentScoringPrompt(params) {
  return `你是资深的中文小说编辑和写作顾问。请从专业编辑和普通读者双重角度，对以下【${params.contentType}】进行综合评价。

【小说题材】${params.genreContext}
【故事背景】${params.novelBackground}

【待评价内容】
${params.content}

评价5个维度（每项0~100分）：
1. 创新性：是否跳脱同类型套路，有独特创意和差异化？
2. 丰富度：层次是否充实，有细节、暗线和余韵？
3. 自然度：【重点】表达是否自然？重点检测：① 引号着重（「命运」「希望」这类）② 造词（灵魂震颤感、心旌摇曳之际等）③ 引导词（不禁、忍不住等）④ 动作套路
4. 逻辑性：内容是否自洽，因果合理，人物行为符合动机？
5. 读者代入感：普通读者是否有继续读下去的欲望？

同时分析：
- AI写作痕迹比例（0~100%）：重点统计双引号着重、造词、引导词、动作套路的密度
- 重复风险：与常见网文的相似程度（低/中/高）
- 前3个优先修改点（具体可操作，直接指出是哪句话、怎么改）

输出严格JSON（只输JSON）：
{
  "dimensions": [
    {"name":"创新性","score":整数,"feedback":"一句简评（20字内）","suggestion":"具体改进方向（30字内）"},
    {"name":"丰富度","score":整数,"feedback":"一句简评","suggestion":"具体改进"},
    {"name":"自然度","score":整数,"feedback":"一句简评","suggestion":"具体改进"},
    {"name":"逻辑性","score":整数,"feedback":"一句简评","suggestion":"具体改进"},
    {"name":"读者代入感","score":整数,"feedback":"一句简评","suggestion":"具体改进"}
  ],
  "ai_like_rate": 整数0到100,
  "repetition_risk": "低/中/高",
  "overall_score": 整数,
  "overall_feedback": "综合评价2~3句，指出最大优点和最需改进的地方",
  "top_fixes": ["具体修改建议1","具体修改建议2","具体修改建议3"]
}`;
}
function safeParseJson(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    let startIdx = -1;
    let endChar = "";
    if (firstBrace === -1 && firstBracket === -1) {
      throw new SyntaxError(`AI 返回内容中未找到 JSON：${cleaned.slice(0, 100)}`);
    }
    if (firstBrace === -1) {
      startIdx = firstBracket;
      endChar = "]";
    } else if (firstBracket === -1) {
      startIdx = firstBrace;
      endChar = "}";
    } else {
      startIdx = Math.min(firstBrace, firstBracket);
      endChar = startIdx === firstBrace ? "}" : "]";
    }
    const lastIdx = cleaned.lastIndexOf(endChar);
    if (lastIdx <= startIdx) {
      throw new SyntaxError(`AI 返回的 JSON 不完整：${cleaned.slice(0, 100)}`);
    }
    const extracted = cleaned.slice(startIdx, lastIdx + 1);
    return JSON.parse(extracted);
  }
}
function estimateTokens(text) {
  return Math.ceil(text.length / 1.5);
}
function truncateToTokens(text, maxTokens) {
  const maxChars = Math.floor(maxTokens * 1.5);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "...";
}
function allocateTokens(parts, totalBudget) {
  const result = {};
  const p0Parts = parts.filter((p) => p.priority === 0);
  let usedTokens = 0;
  for (const p of p0Parts) {
    result[p.label] = p.content;
    usedTokens += estimateTokens(p.content);
  }
  const remaining = totalBudget - usedTokens;
  if (remaining <= 0) {
    for (const p of p0Parts) {
      result[p.label] = truncateToTokens(p.content, Math.floor(totalBudget / p0Parts.length));
    }
    const others = parts.filter((p) => p.priority > 0);
    for (const p of others) result[p.label] = "";
    return result;
  }
  let budget = remaining;
  for (const priority of [1, 2, 3]) {
    const pParts = parts.filter((p) => p.priority === priority);
    for (const p of pParts) {
      const needed = estimateTokens(p.content);
      if (budget <= 0) {
        result[p.label] = "";
      } else if (needed <= budget) {
        result[p.label] = p.content;
        budget -= needed;
      } else {
        result[p.label] = truncateToTokens(p.content, budget);
        budget = 0;
      }
    }
  }
  return result;
}
async function buildChapterContext(novelId, chapterNum, totalBudget = 6e3) {
  const db = getDb();
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  let styleTemplate = "";
  if (novel.styleTemplateId) {
    const tmpl = db.select().from(templates).where(drizzleOrm.eq(templates.id, novel.styleTemplateId)).all()[0];
    if (tmpl?.contentJson) {
      const content = JSON.parse(tmpl.contentJson);
      styleTemplate = `视角：${content.perspective || ""}
句式：${content.sentence_style || ""}
情感：${content.emotion_style || ""}
对话：${content.dialogue_style || ""}`;
    }
  }
  let worldRules = "";
  if (novel.worldRulesJson) {
    try {
      const rules = JSON.parse(novel.worldRulesJson);
      const ruleParts = [];
      if (rules.power_system) ruleParts.push(`力量体系：${JSON.stringify(rules.power_system)}`);
      if (rules.forbidden_elements) ruleParts.push(`禁止元素：${rules.forbidden_elements.join("、")}`);
      if (rules.social_structure) ruleParts.push(`社会结构：${rules.social_structure}`);
      worldRules = ruleParts.join("\n");
    } catch {
      worldRules = novel.worldRulesJson;
    }
  }
  const prevChapters = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, novelId)).orderBy(drizzleOrm.asc(chapters.chapterNum)).all().filter((c) => c.chapterNum < chapterNum && c.summary);
  let previousSummaries = "";
  if (prevChapters.length > 0) {
    const recent = prevChapters.slice(-5);
    previousSummaries = recent.map((c) => `第${c.chapterNum}章：${c.summary}`).join("\n");
  }
  let lastChapterEnding = "";
  const prevChapter = prevChapters[prevChapters.length - 1];
  if (prevChapter?.content) {
    lastChapterEnding = prevChapter.content.slice(-500);
    if (prevChapter.nextChapterSeed) {
      lastChapterEnding += `
[衔接提示：${prevChapter.nextChapterSeed}]`;
    }
  }
  const currentChapter = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, novelId)).all().find((c) => c.chapterNum === chapterNum);
  let characterStates = "";
  const allChars = db.select().from(characters).where(drizzleOrm.eq(characters.novelId, novelId)).all();
  if (allChars.length > 0) {
    const mainChars = allChars.filter((c) => ["protagonist", "major", "antagonist"].includes(c.roleType || ""));
    characterStates = mainChars.map((c) => {
      const traits = c.personalityTraitsJson ? JSON.parse(c.personalityTraitsJson).slice(0, 2).join("、") : "";
      return `${c.fullName}（${c.roleType}）：${c.occupation || ""}，${traits}`;
    }).join("\n");
  }
  const chapterGoal = currentChapter?.outline || "";
  const reservedForOutput = 2e3;
  const contextBudget = totalBudget - reservedForOutput;
  const parts = [
    { priority: 0, label: "chapterGoal", content: chapterGoal },
    { priority: 0, label: "styleTemplate", content: styleTemplate },
    { priority: 1, label: "lastChapterEnding", content: lastChapterEnding },
    { priority: 1, label: "characterStates", content: characterStates },
    { priority: 2, label: "previousSummaries", content: previousSummaries },
    { priority: 3, label: "worldRules", content: worldRules }
  ];
  const allocated = allocateTokens(parts, contextBudget);
  return {
    worldRules: allocated.worldRules || "",
    characterStates: allocated.characterStates || "",
    previousSummaries: allocated.previousSummaries || "",
    lastChapterEnding: allocated.lastChapterEnding || "",
    styleTemplate: allocated.styleTemplate || "",
    chapterGoal: allocated.chapterGoal || ""
  };
}
function countChineseWords(text) {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length;
  const numbers = (text.match(/\d+/g) || []).length;
  return chinese + english + numbers;
}
function listChapters(novelId) {
  const db = getDb();
  return db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, novelId)).orderBy(drizzleOrm.asc(chapters.chapterNum)).all();
}
function getChapter(id) {
  const db = getDb();
  const rows = db.select().from(chapters).where(drizzleOrm.eq(chapters.id, id)).all();
  return rows[0] || null;
}
function createChapter(novelId, data) {
  const db = getDb();
  if (!data.chapterNum) {
    const existing = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, novelId)).all();
    data.chapterNum = existing.length + 1;
  }
  const result = db.insert(chapters).values({ novelId, ...data }).run();
  return Number(result.lastInsertRowid);
}
function updateChapter(id, data) {
  const db = getDb();
  if (data.content !== void 0) {
    data.wordCount = countChineseWords(data.content);
  }
  db.update(chapters).set({
    ...data,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(drizzleOrm.eq(chapters.id, id)).run();
  const chapter = db.select().from(chapters).where(drizzleOrm.eq(chapters.id, id)).all()[0];
  if (chapter) {
    const allChapters = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, chapter.novelId)).all();
    const totalWords = allChapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    db.update(novels).set({ totalWords, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(drizzleOrm.eq(novels.id, chapter.novelId)).run();
  }
}
function deleteChapter(id) {
  const db = getDb();
  db.delete(chapters).where(drizzleOrm.eq(chapters.id, id)).run();
}
async function generateChapterContent(chapterId, sender) {
  const db = getDb();
  const chapter = db.select().from(chapters).where(drizzleOrm.eq(chapters.id, chapterId)).all()[0];
  if (!chapter) throw new Error(`章节 #${chapterId} 不存在`);
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, chapter.novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  const context = await buildChapterContext(chapter.novelId, chapter.chapterNum, 4e3);
  novel.worldRulesJson ? JSON.parse(novel.worldRulesJson) : {};
  novel.settingsJson ? JSON.parse(novel.settingsJson) : {};
  const prompt = chapterWritingPrompt({
    novelTitle: novel.title,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title || `第${chapter.chapterNum}章`,
    chapterGoal: context.chapterGoal || "",
    plotPoints: chapter.outline || "",
    emotionTone: chapter.emotionTone || "平静",
    worldRules: context.worldRules,
    characterStates: context.characterStates,
    previousSummaries: context.previousSummaries,
    lastChapterEnding: context.lastChapterEnding,
    styleTemplate: context.styleTemplate,
    targetWords: chapter.targetWords || 3e3
  });
  const taskId = await runStreamTask({
    type: "chapter_write",
    novelId: chapter.novelId,
    relatedEntityType: "chapter",
    relatedEntityId: chapterId,
    inputJson: JSON.stringify([{ role: "user", content: prompt }]),
    messages: [{ role: "user", content: prompt }],
    modelConfigId: novel.modelConfigId || void 0,
    sender
  });
  return taskId;
}
async function generateChapterSummary(chapterId) {
  const db = getDb();
  const chapter = db.select().from(chapters).where(drizzleOrm.eq(chapters.id, chapterId)).all()[0];
  if (!chapter || !chapter.content) throw new Error("章节内容为空，无法生成摘要");
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, chapter.novelId)).all()[0];
  const prompt = chapterSummaryPrompt(chapter.content);
  const result = await runChatTask({
    type: "summary",
    novelId: chapter.novelId,
    relatedEntityType: "chapter",
    relatedEntityId: chapterId,
    messages: [{ role: "user", content: prompt }],
    modelConfigId: novel?.modelConfigId || void 0
  });
  try {
    const parsed = safeParseJson(result);
    db.update(chapters).set({
      summary: parsed.summary,
      nextChapterSeed: parsed.next_chapter_seed,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }).where(drizzleOrm.eq(chapters.id, chapterId)).run();
  } catch {
    db.update(chapters).set({
      summary: result,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }).where(drizzleOrm.eq(chapters.id, chapterId)).run();
  }
}
async function aiCheckChapter(chapterId) {
  const db = getDb();
  const chapter = db.select().from(chapters).where(drizzleOrm.eq(chapters.id, chapterId)).all()[0];
  if (!chapter || !chapter.content) throw new Error("章节内容为空");
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, chapter.novelId)).all()[0];
  const textToCheck = chapter.content.slice(0, 2e3);
  const prompt = aiCheckPrompt(textToCheck);
  const result = await runChatTask({
    type: "ai_check",
    novelId: chapter.novelId,
    relatedEntityType: "chapter",
    relatedEntityId: chapterId,
    messages: [{ role: "user", content: prompt }],
    modelConfigId: novel?.modelConfigId || void 0
  });
  try {
    const parsed = safeParseJson(result);
    db.update(chapters).set({
      aiScoreJson: result,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }).where(drizzleOrm.eq(chapters.id, chapterId)).run();
    return parsed;
  } catch {
    return { score: 0, issues: [], overall_feedback: result };
  }
}
function listCharacters(novelId) {
  const db = getDb();
  return db.select().from(characters).where(drizzleOrm.eq(characters.novelId, novelId)).orderBy(drizzleOrm.asc(characters.sortOrder), drizzleOrm.asc(characters.id)).all();
}
function getCharacter(id) {
  const db = getDb();
  return db.select().from(characters).where(drizzleOrm.eq(characters.id, id)).all()[0] || null;
}
function createCharacter(novelId, data) {
  const db = getDb();
  const result = db.insert(characters).values({ novelId, fullName: data.fullName || "未命名", ...data }).run();
  return Number(result.lastInsertRowid);
}
function updateCharacter(id, data) {
  const db = getDb();
  db.update(characters).set({ ...data, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(drizzleOrm.eq(characters.id, id)).run();
}
function deleteCharacter(id) {
  const db = getDb();
  db.delete(characters).where(drizzleOrm.eq(characters.id, id)).run();
}
function getCharacterRelations(novelId) {
  const db = getDb();
  return db.select().from(characterRelations).where(drizzleOrm.eq(characterRelations.novelId, novelId)).all();
}
function upsertRelation(data) {
  const db = getDb();
  db.insert(characterRelations).values(data).run();
}
async function generateProtagonist(novelId, opts) {
  const db = getDb();
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  let worldSummary = "";
  if (novel.worldTemplateId) {
    const tmpl = db.select().from(templates).where(drizzleOrm.eq(templates.id, novel.worldTemplateId)).all()[0];
    if (tmpl?.contentJson) {
      const content = JSON.parse(tmpl.contentJson);
      worldSummary = content.power_system?.name || tmpl.name || "";
    }
  }
  const prompt = protagonistPrompt({
    novelTitle: novel.title,
    novelSynopsis: novel.synopsis || novel.expandedBackground || "",
    genre: "未知题材",
    worldSummary,
    gender: opts.gender || "不限",
    surnameHint: opts.surnameHint
  });
  const result = await runChatTask({
    type: "character_gen",
    novelId,
    messages: [{ role: "user", content: prompt }],
    modelConfigId: novel.modelConfigId || void 0
  });
  const parsed = safeParseJson(result);
  const charId = createCharacter(novelId, {
    roleType: "protagonist",
    surname: parsed.surname,
    givenName: parsed.given_name,
    fullName: parsed.full_name,
    gender: parsed.gender,
    age: parsed.age,
    occupation: parsed.occupation,
    background: parsed.background,
    personalityTraitsJson: JSON.stringify(parsed.personality_traits || []),
    flawsJson: JSON.stringify(parsed.flaws || []),
    habitsJson: JSON.stringify(parsed.habits || []),
    goals: parsed.goals,
    firstImpression: parsed.first_impression,
    appearanceJson: JSON.stringify({ description: parsed.appearance })
  });
  return charId;
}
async function batchGenerateCharacters(novelId, opts, sender) {
  const db = getDb();
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  const existingChars = db.select().from(characters).where(drizzleOrm.eq(characters.novelId, novelId)).all();
  const existingNames = existingChars.map((c) => c.fullName).join("、");
  const protagonist = existingChars.find((c) => c.roleType === "protagonist");
  const protagonistSummary = protagonist ? `${protagonist.fullName}（主角，${protagonist.gender}）：${protagonist.background?.slice(0, 100)}` : "主角未设定";
  const totalCount = opts.majorCount + opts.minorCount;
  const batches = Math.ceil(totalCount / opts.batchSize);
  const newIds = [];
  for (let i = 0; i < batches; i++) {
    const batchCount = Math.min(opts.batchSize, totalCount - i * opts.batchSize);
    const prompt = batchCharacterPrompt({
      novelTitle: novel.title,
      novelSynopsis: novel.synopsis || novel.expandedBackground || "",
      protagonistSummary,
      existingNames,
      genre: "未知题材",
      worldSummary: "",
      count: batchCount,
      genderRatio: opts.genderRatio,
      specialRequirements: opts.specialRequirements
    });
    const result = await runChatTask({
      type: "character_gen",
      novelId,
      messages: [{ role: "user", content: prompt }],
      modelConfigId: novel.modelConfigId || void 0
    });
    try {
      const parsed = safeParseJson(result);
      for (const char of parsed) {
        const id = createCharacter(novelId, {
          roleType: char.role_type || "minor",
          fullName: char.full_name || char.name,
          gender: char.gender,
          age: char.age,
          occupation: char.occupation || "",
          background: char.background || "",
          personalityTraitsJson: JSON.stringify(char.personality_keywords || []),
          firstImpression: char.appearance || ""
        });
        newIds.push(id);
      }
    } catch (e) {
      console.error("批量生成人物解析失败:", e);
    }
    if (sender && !sender.isDestroyed()) {
      sender.send("character:batch-progress", { batch: i + 1, total: batches, newIds });
    }
  }
  return newIds;
}
async function generateCharacterRelations(novelId) {
  const db = getDb();
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  const charList = db.select().from(characters).where(drizzleOrm.eq(characters.novelId, novelId)).all();
  if (charList.length < 2) throw new Error("至少需要2个人物才能生成关系网络");
  const characterListText = charList.map(
    (c) => `- ${c.fullName}（${c.roleType}，${c.gender}）：${c.background?.slice(0, 100) || "无背景"}`
  ).join("\n");
  const prompt = characterRelationsPrompt({
    novelSynopsis: novel.synopsis || novel.expandedBackground || "",
    characterList: characterListText
  });
  const result = await runChatTask({
    type: "character_gen",
    novelId,
    messages: [{ role: "user", content: prompt }],
    modelConfigId: novel.modelConfigId || void 0
  });
  try {
    const relations = safeParseJson(result);
    for (const rel of relations) {
      const charA = charList.find((c) => c.fullName === rel.char_a);
      const charB = charList.find((c) => c.fullName === rel.char_b);
      if (charA && charB) {
        upsertRelation({
          novelId,
          charAId: charA.id,
          charBId: charB.id,
          relationType: rel.type,
          relationLabel: rel.label,
          description: rel.description,
          bilateral: rel.bilateral ? 1 : 0
        });
      }
    }
  } catch (e) {
    console.error("关系解析失败:", e);
  }
}
function getMapTree(novelId) {
  const db = getDb();
  const items = db.select().from(worldMap).where(drizzleOrm.eq(worldMap.novelId, novelId)).orderBy(drizzleOrm.asc(worldMap.sortOrder), drizzleOrm.asc(worldMap.id)).all();
  function buildTree(parentId) {
    return items.filter((item) => item.parentId === parentId).map((item) => ({
      id: item.id,
      name: item.name,
      level: item.level,
      locationType: item.locationType,
      description: item.description,
      atmosphere: item.atmosphere,
      plotRelevance: item.plotRelevance,
      children: buildTree(item.id)
    }));
  }
  return buildTree(null);
}
function createMapItem(novelId, data) {
  const db = getDb();
  const result = db.insert(worldMap).values({ novelId, ...data }).run();
  return Number(result.lastInsertRowid);
}
function updateMapItem(id, data) {
  const db = getDb();
  db.update(worldMap).set(data).where(drizzleOrm.eq(worldMap.id, id)).run();
}
function deleteMapItem(id) {
  const db = getDb();
  const db2 = getDb();
  const children = db2.select().from(worldMap).where(drizzleOrm.eq(worldMap.parentId, id)).all();
  for (const child of children) {
    deleteMapItem(child.id);
  }
  db.delete(worldMap).where(drizzleOrm.eq(worldMap.id, id)).run();
}
async function batchGenerateMap(novelId, structure) {
  const db = getDb();
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  let worldSummary = "";
  if (novel.worldTemplateId) {
    const tmpl = db.select().from(templates).where(drizzleOrm.eq(templates.id, novel.worldTemplateId)).all()[0];
    if (tmpl?.contentJson) {
      const content = JSON.parse(tmpl.contentJson);
      worldSummary = `${tmpl.name}：${content.power_system?.rules || ""}`;
    }
  }
  const mapStructure = `第一级（大区域）${structure.level1Count}个，每个第一级下${structure.level2Count}个第二级（区域），每个第二级下${structure.level3Count}个第三级（具体地点）`;
  const prompt = mapGenerationPrompt({
    novelTitle: novel.title,
    worldSummary,
    genre: "未知题材",
    mapStructure,
    namedPlaces: structure.namedPlaces
  });
  const result = await runChatTask({
    type: "generate_map",
    novelId,
    messages: [{ role: "user", content: prompt }],
    modelConfigId: novel.modelConfigId || void 0
  });
  try {
    const parsed = safeParseJson(result);
    for (const region of parsed.regions || []) {
      const l1Id = createMapItem(novelId, {
        level: 1,
        name: region.name,
        description: region.description,
        atmosphere: region.atmosphere
      });
      for (const subRegion of region.sub_regions || []) {
        const l2Id = createMapItem(novelId, {
          level: 2,
          parentId: l1Id,
          name: subRegion.name,
          description: subRegion.description,
          atmosphere: subRegion.atmosphere
        });
        for (const location of subRegion.locations || []) {
          createMapItem(novelId, {
            level: 3,
            parentId: l2Id,
            name: location.name,
            locationType: location.type,
            description: location.description,
            atmosphere: location.atmosphere,
            plotRelevance: location.plot_relevance
          });
        }
      }
    }
  } catch (e) {
    console.error("地图生成解析失败:", e);
    throw new Error("地图生成结果解析失败，请重试");
  }
}
async function exportNovel(novelId, format) {
  const db = getDb();
  const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
  if (!novel) throw new Error("小说不存在");
  const chapterList = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, novelId)).orderBy(drizzleOrm.asc(chapters.chapterNum)).all().filter((c) => c.content);
  const { filePath } = await electron.dialog.showSaveDialog({
    defaultPath: path.join(electron.app.getPath("documents"), `${novel.title}.${format}`),
    filters: [
      { name: format.toUpperCase(), extensions: [format] }
    ]
  });
  if (!filePath) throw new Error("用户取消");
  if (format === "txt") {
    let content = `${novel.title}

`;
    if (novel.synopsis) content += `简介：${novel.synopsis}

${"=".repeat(40)}

`;
    for (const ch of chapterList) {
      content += `第${ch.chapterNum}章 ${ch.title || ""}

`;
      content += `${ch.content}

`;
      content += `${"─".repeat(20)}

`;
    }
    fs.writeFileSync(filePath, content, "utf-8");
  } else if (format === "md") {
    let content = `# ${novel.title}

`;
    if (novel.synopsis) content += `> ${novel.synopsis}

---

`;
    for (const ch of chapterList) {
      content += `## 第${ch.chapterNum}章 ${ch.title || ""}

`;
      content += `${ch.content}

`;
    }
    fs.writeFileSync(filePath, content, "utf-8");
  } else if (format === "json") {
    const content = JSON.stringify({
      novel: {
        title: novel.title,
        synopsis: novel.synopsis,
        totalWords: novel.totalWords,
        status: novel.status,
        expandedBackground: novel.expandedBackground,
        settingsJson: novel.settingsJson ? JSON.parse(novel.settingsJson) : null,
        worldRulesJson: novel.worldRulesJson ? JSON.parse(novel.worldRulesJson) : null
      },
      chapters: chapterList.map((ch) => ({
        chapterNum: ch.chapterNum,
        title: ch.title,
        content: ch.content,
        wordCount: ch.wordCount,
        outline: ch.outline,
        summary: ch.summary,
        status: ch.status
      }))
    }, null, 2);
    fs.writeFileSync(filePath, content, "utf-8");
  } else if (format === "docx") {
    const docParagraphs = [];
    docParagraphs.push(new docx.Paragraph({
      text: novel.title,
      heading: docx.HeadingLevel.TITLE,
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: 400 }
    }));
    if (novel.synopsis) {
      docParagraphs.push(new docx.Paragraph({
        children: [
          new docx.TextRun({ text: "简介：", bold: true }),
          new docx.TextRun(novel.synopsis)
        ],
        spacing: { after: 240 }
      }));
      docParagraphs.push(new docx.Paragraph({ text: "", spacing: { after: 200 } }));
    }
    for (const ch of chapterList) {
      docParagraphs.push(new docx.Paragraph({
        text: `第${ch.chapterNum}章 ${ch.title || ""}`,
        heading: docx.HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }));
      if (ch.content) {
        const paragraphs = ch.content.split(/\n+/).filter((p) => p.trim());
        for (const para of paragraphs) {
          docParagraphs.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: para })],
            spacing: { after: 160 },
            indent: { firstLine: 480 }
          }));
        }
      }
    }
    const doc = new docx.Document({
      sections: [{
        properties: {},
        children: docParagraphs
      }]
    });
    const buffer = await docx.Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }
  return filePath;
}
let mainWindow = null;
function getWindowStatePath() {
  return path.join(electron.app.getPath("userData"), "window-state.json");
}
function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { width: 1400, height: 900 };
  }
}
function saveWindowState(win) {
  try {
    const isMaximized = win.isMaximized();
    const bounds = win.getBounds();
    const state = isMaximized ? { width: bounds.width, height: bounds.height, isMaximized: true } : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, isMaximized: false };
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), "utf-8");
  } catch {
  }
}
function createWindow() {
  const winState = loadWindowState();
  mainWindow = new electron.BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width || 1400,
    height: winState.height || 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0f1117",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (winState.isMaximized) {
    mainWindow.maximize();
  }
  if (process.env.NODE_ENV === "development" || !electron.app.isPackaged) {
    const devUrl = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173";
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("close", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
electron.app.whenReady().then(() => {
  initDb();
  createWindow();
  registerIpcHandlers();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  closeDb();
  if (process.platform !== "darwin") electron.app.quit();
});
function registerIpcHandlers() {
  electron.ipcMain.handle("novel:list", (_, filters) => listNovels());
  electron.ipcMain.handle("novel:get", (_, id) => getNovel(id));
  electron.ipcMain.handle("novel:create", (_, data) => createNovel(data));
  electron.ipcMain.handle("novel:update", (_, id, data) => updateNovel(id, data));
  electron.ipcMain.handle("novel:delete", (_, id) => deleteNovel(id));
  electron.ipcMain.handle("novel:export", (_, id, format) => exportNovel(id, format));
  electron.ipcMain.handle("novel:stats", (_, id) => getNovelStats(id));
  electron.ipcMain.handle("chapter:list", (_, novelId) => listChapters(novelId));
  electron.ipcMain.handle("chapter:get", (_, id) => getChapter(id));
  electron.ipcMain.handle("chapter:create", (_, novelId, data) => createChapter(novelId, data));
  electron.ipcMain.handle("chapter:update", (_, id, data) => updateChapter(id, data));
  electron.ipcMain.handle("chapter:delete", (_, id) => deleteChapter(id));
  electron.ipcMain.handle("chapter:generateContent", (event, chapterId) => generateChapterContent(chapterId, event.sender));
  electron.ipcMain.handle("chapter:generateSummary", (_, chapterId) => generateChapterSummary(chapterId));
  electron.ipcMain.handle("chapter:aiCheck", (_, chapterId) => aiCheckChapter(chapterId));
  electron.ipcMain.handle("character:list", (_, novelId) => listCharacters(novelId));
  electron.ipcMain.handle("character:get", (_, id) => getCharacter(id));
  electron.ipcMain.handle("character:create", (_, novelId, data) => createCharacter(novelId, data));
  electron.ipcMain.handle("character:update", (_, id, data) => updateCharacter(id, data));
  electron.ipcMain.handle("character:delete", (_, id) => deleteCharacter(id));
  electron.ipcMain.handle("character:getRelations", (_, novelId) => getCharacterRelations(novelId));
  electron.ipcMain.handle("character:generateProtagonist", (_, novelId, opts) => generateProtagonist(novelId, opts));
  electron.ipcMain.handle("character:batchGenerate", (event, novelId, opts) => batchGenerateCharacters(novelId, opts, event.sender));
  electron.ipcMain.handle("character:generateRelations", (_, novelId) => generateCharacterRelations(novelId));
  electron.ipcMain.handle("character:upsertRelation", (_, data) => upsertRelation(data));
  electron.ipcMain.handle("map:getTree", (_, novelId) => getMapTree(novelId));
  electron.ipcMain.handle("map:create", (_, novelId, data) => createMapItem(novelId, data));
  electron.ipcMain.handle("map:update", (_, id, data) => updateMapItem(id, data));
  electron.ipcMain.handle("map:delete", (_, id) => deleteMapItem(id));
  electron.ipcMain.handle("map:batchGenerate", (_, novelId, structure) => batchGenerateMap(novelId, structure));
  electron.ipcMain.handle("outline:getArcs", (_, novelId) => {
    const db = getDb();
    return db.select().from(storyArcs).where(drizzleOrm.eq(storyArcs.novelId, novelId)).all();
  });
  electron.ipcMain.handle("outline:createArc", (_, novelId, data) => {
    const db = getDb();
    const result = db.insert(storyArcs).values({ novelId, ...data }).run();
    return Number(result.lastInsertRowid);
  });
  electron.ipcMain.handle("outline:updateArc", (_, id, data) => {
    const db = getDb();
    db.update(storyArcs).set(data).where(drizzleOrm.eq(storyArcs.id, id)).run();
  });
  electron.ipcMain.handle("outline:deleteArc", (_, id) => {
    const db = getDb();
    db.delete(storyArcs).where(drizzleOrm.eq(storyArcs.id, id)).run();
  });
  electron.ipcMain.handle("outline:generateArcs", async (_, novelId) => {
    const db = getDb();
    const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, novelId)).all()[0];
    if (!novel) throw new Error("小说不存在");
    const settings = novel.settingsJson ? JSON.parse(novel.settingsJson) : {};
    const prompt = storyArcsPrompt({
      novelTitle: novel.title,
      genre: "未知题材",
      storyGoal: settings.story_goal || "",
      coreConflict: settings.core_conflict || "",
      mainPlot: settings.main_plot || "",
      subPlots: settings.sub_plots || "",
      ending: settings.ending || "",
      totalChapters: Math.ceil((novel.targetWords || 2e5) / 3e3)
    });
    const result = await runChatTask({
      type: "chapter_outline",
      novelId,
      messages: [{ role: "user", content: prompt }],
      modelConfigId: novel.modelConfigId || void 0
    });
    const arcs = safeParseJson(result);
    for (const arc of arcs) {
      db.insert(storyArcs).values({
        novelId,
        arcName: arc.arc_name || arc.name,
        arcOrder: arc.order || 1,
        chapterStart: arc.chapter_start,
        chapterEnd: arc.chapter_end,
        arcGoal: arc.arc_goal || arc.goal,
        arcSummary: arc.summary || ""
      }).run();
    }
    return arcs;
  });
  electron.ipcMain.handle("outline:generateChapterOutlines", async (_, arcId) => {
    const db = getDb();
    const arc = db.select().from(storyArcs).where(drizzleOrm.eq(storyArcs.id, arcId)).all()[0];
    if (!arc) throw new Error("故事弧不存在");
    const novel = db.select().from(novels).where(drizzleOrm.eq(novels.id, arc.novelId)).all()[0];
    if (!novel) throw new Error("小说不存在");
    const prompt = chapterOutlinePrompt({
      novelTitle: novel.title,
      arcName: arc.arcName,
      arcGoal: arc.arcGoal || "",
      chapterStart: arc.chapterStart || 1,
      chapterEnd: arc.chapterEnd || 10,
      characterStates: "",
      worldRulesSummary: ""
    });
    const result = await runChatTask({
      type: "chapter_outline",
      novelId: arc.novelId,
      messages: [{ role: "user", content: prompt }],
      modelConfigId: novel.modelConfigId || void 0
    });
    const outlines = safeParseJson(result);
    for (const outline of outlines) {
      const chapterNum = outline.chapter_num || outline.num;
      const existing = db.select().from(chapters).where(drizzleOrm.eq(chapters.novelId, arc.novelId)).all().find((c) => c.chapterNum === chapterNum);
      if (existing) {
        db.update(chapters).set({
          title: outline.title,
          outline: (outline.plot_points || []).join("\n"),
          emotionTone: outline.emotion_tone,
          arcId
        }).where(drizzleOrm.eq(chapters.id, existing.id)).run();
      } else {
        db.insert(chapters).values({
          novelId: arc.novelId,
          chapterNum,
          title: outline.title,
          outline: (outline.plot_points || []).join("\n"),
          emotionTone: outline.emotion_tone,
          arcId,
          status: "outline"
        }).run();
      }
    }
    return outlines;
  });
  electron.ipcMain.handle("model:list", () => {
    const db = getDb();
    return db.select().from(modelConfigs).all().map((c) => ({
      ...c,
      apiKey: c.apiKey ? "已设置" : ""
    }));
  });
  electron.ipcMain.handle("model:create", (_, data) => {
    const db = getDb();
    const encryptedKey = data.apiKey ? encryptApiKey(data.apiKey) : null;
    const result = db.insert(modelConfigs).values({ ...data, apiKey: encryptedKey }).run();
    return Number(result.lastInsertRowid);
  });
  electron.ipcMain.handle("model:update", (_, id, data) => {
    const db = getDb();
    if (data.apiKey && data.apiKey !== "已设置") {
      data.apiKey = encryptApiKey(data.apiKey);
    } else if (data.apiKey === "已设置") {
      delete data.apiKey;
    }
    db.update(modelConfigs).set(data).where(drizzleOrm.eq(modelConfigs.id, id)).run();
  });
  electron.ipcMain.handle("model:delete", (_, id) => {
    const db = getDb();
    db.delete(modelConfigs).where(drizzleOrm.eq(modelConfigs.id, id)).run();
  });
  electron.ipcMain.handle("model:setDefault", (_, id) => {
    const db = getDb();
    db.update(modelConfigs).set({ isDefault: 0 }).run();
    db.update(modelConfigs).set({ isDefault: 1 }).where(drizzleOrm.eq(modelConfigs.id, id)).run();
  });
  electron.ipcMain.handle("model:test", (_, id) => testAdapter(id));
  electron.ipcMain.handle("template:list", (_, type) => {
    const db = getDb();
    if (type) {
      return db.select().from(templates).where(drizzleOrm.eq(templates.type, type)).all();
    }
    return db.select().from(templates).all();
  });
  electron.ipcMain.handle("template:create", (_, data) => {
    const db = getDb();
    const result = db.insert(templates).values(data).run();
    return Number(result.lastInsertRowid);
  });
  electron.ipcMain.handle("template:update", (_, id, data) => {
    const db = getDb();
    db.update(templates).set(data).where(drizzleOrm.eq(templates.id, id)).run();
  });
  electron.ipcMain.handle("template:delete", (_, id) => {
    const db = getDb();
    const tmpl = db.select().from(templates).where(drizzleOrm.eq(templates.id, id)).all()[0];
    if (tmpl?.isBuiltin) throw new Error("内置模板不可删除");
    db.delete(templates).where(drizzleOrm.eq(templates.id, id)).run();
  });
  electron.ipcMain.handle("task:list", (_, novelId) => {
    const db = getDb();
    if (novelId) {
      return db.select().from(tasks).where(drizzleOrm.eq(tasks.novelId, novelId)).orderBy(drizzleOrm.desc(tasks.createdAt)).all();
    }
    return db.select().from(tasks).orderBy(drizzleOrm.desc(tasks.createdAt)).all();
  });
  electron.ipcMain.handle("task:get", (_, id) => {
    const db = getDb();
    return db.select().from(tasks).where(drizzleOrm.eq(tasks.id, id)).all()[0] || null;
  });
  electron.ipcMain.handle("task:cancel", (_, id) => cancelTask(id));
  electron.ipcMain.handle("task:retry", (event, id) => retryTask(id, event.sender));
  electron.ipcMain.handle("ai:expandBackground", async (_, input) => {
    const db = getDb();
    const genreRows = input.genreId ? db.select().from(genres).where(drizzleOrm.eq(genres.id, input.genreId)).all() : [];
    const genre = genreRows[0]?.name || "未知题材";
    let worldTemplateSummary = "";
    if (input.worldTemplateId) {
      const tmpl = db.select().from(templates).where(drizzleOrm.eq(templates.id, input.worldTemplateId)).all()[0];
      worldTemplateSummary = tmpl?.name || "";
    }
    const prompt = expandBackgroundPrompt({
      userBackground: input.userBackground,
      genre,
      worldTemplateSummary
    });
    const result = await runChatTask({
      type: "init",
      messages: [{ role: "user", content: prompt }],
      modelConfigId: input.modelConfigId
    });
    return safeParseJson(result);
  });
  electron.ipcMain.handle("ai:generateCharacter", (_, novelId, opts) => generateProtagonist(novelId, opts));
  electron.ipcMain.handle("ai:generateRelations", (_, novelId) => generateCharacterRelations(novelId));
  electron.ipcMain.handle("ai:rewriteParagraph", async (_, data) => {
    const prompt = rewriteParagraphPrompt({
      originalParagraph: data.originalParagraph,
      contextBefore: data.contextBefore,
      specificRequirements: data.specificRequirements
    });
    return runChatTask({
      type: "review",
      messages: [{ role: "user", content: prompt }],
      modelConfigId: data.modelConfigId
    });
  });
  electron.ipcMain.handle("ai:runPrompt", async (_, data) => {
    const count = Math.min(Math.max(data.count || 1, 1), 3);
    const tasks2 = Array.from(
      { length: count },
      () => runChatTask({
        type: "review",
        messages: data.messages,
        modelConfigId: data.modelConfigId
      })
    );
    return Promise.all(tasks2);
  });
  electron.ipcMain.handle("ai:scoreContent", async (_, data) => {
    const prompt = contentScoringPrompt(data);
    const result = await runChatTask({
      type: "review",
      messages: [{ role: "user", content: prompt }],
      modelConfigId: data.modelConfigId
    });
    return safeParseJson(result);
  });
}
