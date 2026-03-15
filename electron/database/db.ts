import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle> | null = null
let _sqlite: Database.Database | null = null

export function getDb() {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return _db
}

export function initDb(): ReturnType<typeof drizzle> {
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
