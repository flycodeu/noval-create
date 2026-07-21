const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  if (request.startsWith('@main/')) return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    for (const ext of ['.ts', '.tsx', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + ext)
      if (fs.existsSync(candidate)) return candidate
    }
    for (const ext of ['.ts', '.tsx', '.js']) {
      const candidate = path.resolve(baseDir, request, 'index' + ext)
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

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function backupDatabaseFiles(dbPath) {
  if (!fs.existsSync(dbPath)) return []
  const marker = `before-huaishang-${stamp()}`
  const copied = []
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`
    if (!fs.existsSync(source)) continue
    const target = `${dbPath}.${marker}${suffix || '-main'}.bak`
    fs.copyFileSync(source, target)
    copied.push(target)
  }
  return copied
}

function toJson(value) {
  return JSON.stringify(value)
}

function asListJson(values) {
  return toJson(values.filter((value) => value !== undefined && value !== null && value !== ''))
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null && field !== ''))
}

function mergeJsonObject(raw, patch) {
  let base = {}
  if (raw && typeof raw === 'string') {
    try {
      base = JSON.parse(raw)
    } catch {
      base = {}
    }
  }
  return toJson({ ...base, ...patch })
}

function parseJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function buildMaps(db, novelId) {
  const chapters = new Map(db.prepare('SELECT id, chapter_num AS chapterNum FROM chapters WHERE novel_id = ?').all(novelId).map((row) => [row.chapterNum, row.id]))
  const characters = new Map(db.prepare('SELECT id, full_name AS fullName FROM characters WHERE novel_id = ?').all(novelId).map((row) => [row.fullName, row.id]))
  const threads = new Map(db.prepare('SELECT id, title FROM story_threads WHERE novel_id = ?').all(novelId).map((row) => [row.title, row.id]))
  const items = new Map(db.prepare('SELECT id, item_name AS itemName FROM story_items WHERE novel_id = ?').all(novelId).map((row) => [row.itemName, row.id]))
  const maps = new Map(db.prepare('SELECT id, name FROM world_map WHERE novel_id = ?').all(novelId).map((row) => [row.name, row.id]))
  const volumes = new Map(db.prepare('SELECT id, volume_number AS volumeNumber FROM story_volumes WHERE novel_id = ?').all(novelId).map((row) => [row.volumeNumber, row.id]))
  return { chapters, characters, threads, items, maps, volumes }
}

function updateBlankFields(db, table, idColumn, id, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (entries.length === 0) return
  const assignments = entries.map(([column]) => `${column} = CASE WHEN ${column} IS NULL OR TRIM(CAST(${column} AS TEXT)) = '' THEN ? ELSE ${column} END`)
  db.prepare(`UPDATE ${table} SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${idColumn} = ?`).run(
    ...entries.map(([, value]) => value),
    id,
  )
}

function ensureByNovelTitle(db, table, titleColumn, novelId, title, insertSql, params) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE novel_id = ? AND ${titleColumn} = ?`).get(novelId, title)
  if (existing) return existing.id
  return Number(db.prepare(insertSql).run(...params).lastInsertRowid)
}

function ensureChapterContract(db, novelId, chapterId, data) {
  const existing = db.prepare('SELECT id FROM chapter_contracts WHERE novel_id = ? AND chapter_id = ?').get(novelId, chapterId)
  const payload = [
    data.chapterGoal,
    data.openingStyle,
    data.endingStyle,
    data.expositionMode,
    data.emotionFocus,
    data.servedThreadIdsJson,
    data.requiredArcProgressJson,
    data.requiredCharacterArcIdsJson,
    data.requiredRelationshipArcIdsJson,
    data.requiredResistanceTrackIdsJson,
    data.requiredResistanceActionsJson,
    data.requiredAssetRefsJson,
    data.requiredEndgameCommitmentIdsJson,
    data.requiredForeshadowIdsJson,
    data.hookType,
    data.forbiddenActionsJson,
    data.acceptanceNotesJson,
    data.status || 'ready',
  ]
  if (existing) {
    db.prepare(`
      UPDATE chapter_contracts
      SET chapter_goal = ?, opening_style = ?, ending_style = ?, exposition_mode = ?, emotion_focus = ?,
          served_thread_ids_json = ?, required_arc_progress_json = ?, required_character_arc_ids_json = ?,
          required_relationship_arc_ids_json = ?, required_resistance_track_ids_json = ?, required_resistance_actions_json = ?,
          required_asset_refs_json = ?, required_endgame_commitment_ids_json = ?, required_foreshadow_ids_json = ?,
          hook_type = ?, forbidden_actions_json = ?, acceptance_notes_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...payload, existing.id)
    return existing.id
  }
  return Number(db.prepare(`
    INSERT INTO chapter_contracts (
      novel_id, chapter_id, chapter_goal, opening_style, ending_style, exposition_mode, emotion_focus,
      served_thread_ids_json, required_arc_progress_json, required_character_arc_ids_json, required_relationship_arc_ids_json,
      required_resistance_track_ids_json, required_resistance_actions_json, required_asset_refs_json,
      required_endgame_commitment_ids_json, required_foreshadow_ids_json, hook_type, forbidden_actions_json,
      acceptance_notes_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, chapterId, ...payload).lastInsertRowid)
}

function ensureCharacterArc(db, novelId, characterId, data) {
  const existing = db.prepare('SELECT id FROM character_arcs WHERE novel_id = ? AND character_id = ?').get(novelId, characterId)
  const payload = [
    data.startState,
    data.surfaceWant,
    data.deepNeed,
    data.coreFear,
    data.misbelief,
    data.firstCrackChapterId || null,
    data.changeEvent,
    data.changeTimelineEventId || null,
    data.endState,
    data.currentStatus || 'active',
    data.lastProgressChapterId || null,
    data.stalledReason || '',
    data.notes || '',
  ]
  if (existing) {
    db.prepare(`
      UPDATE character_arcs
      SET start_state = ?, surface_want = ?, deep_need = ?, core_fear = ?, misbelief = ?, first_crack_chapter_id = ?,
          change_event = ?, change_timeline_event_id = ?, end_state = ?, current_status = ?, last_progress_chapter_id = ?,
          stalled_reason = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...payload, existing.id)
    return existing.id
  }
  return Number(db.prepare(`
    INSERT INTO character_arcs (
      novel_id, character_id, start_state, surface_want, deep_need, core_fear, misbelief, first_crack_chapter_id,
      change_event, change_timeline_event_id, end_state, current_status, last_progress_chapter_id, stalled_reason, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, characterId, ...payload).lastInsertRowid)
}

function ensureCharacterArcBeat(db, novelId, arcId, title, data) {
  const existing = db.prepare('SELECT id FROM character_arc_beats WHERE novel_id = ? AND arc_id = ? AND title = ?').get(novelId, arcId, title)
  if (existing) return existing.id
  return Number(db.prepare(`
    INSERT INTO character_arc_beats (novel_id, arc_id, beat_type, chapter_id, timeline_event_id, title, summary, status, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, arcId, data.beatType || 'progress-note', data.chapterId || null, data.timelineEventId || null, title, data.summary, data.status || 'planned', data.sortOrder || 0).lastInsertRowid)
}

function ensureRelationshipArc(db, novelId, charAId, charBId, data) {
  const existing = db.prepare(`
    SELECT id FROM relationship_arcs
    WHERE novel_id = ? AND ((char_a_id = ? AND char_b_id = ?) OR (char_a_id = ? AND char_b_id = ?))
  `).get(novelId, charAId, charBId, charBId, charAId)
  const payload = [
    data.relationLabelSnapshot,
    data.relationTypeSnapshot,
    data.startState,
    data.crackPoint,
    data.changeEvent,
    data.changeTimelineEventId || null,
    data.endState,
    data.currentStatus || 'active',
    data.lastProgressChapterId || null,
    data.stalledReason || '',
    data.notes || '',
  ]
  if (existing) {
    db.prepare(`
      UPDATE relationship_arcs
      SET relation_label_snapshot = ?, relation_type_snapshot = ?, start_state = ?, crack_point = ?, change_event = ?,
          change_timeline_event_id = ?, end_state = ?, current_status = ?, last_progress_chapter_id = ?, stalled_reason = ?,
          notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...payload, existing.id)
    return existing.id
  }
  return Number(db.prepare(`
    INSERT INTO relationship_arcs (
      novel_id, char_a_id, char_b_id, relation_label_snapshot, relation_type_snapshot, start_state, crack_point,
      change_event, change_timeline_event_id, end_state, current_status, last_progress_chapter_id, stalled_reason, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, charAId, charBId, ...payload).lastInsertRowid)
}

function ensureResistanceTrack(db, novelId, title, data) {
  const existing = db.prepare('SELECT id FROM resistance_tracks WHERE novel_id = ? AND title = ?').get(novelId, title)
  const payload = [
    data.sourceType || 'faction',
    data.sourceId || null,
    data.resistanceKind || 'antagonist',
    title,
    data.goal,
    data.intelSource,
    data.resourcePool,
    data.escalationPlan,
    data.heroKnowledgeShift,
    data.stageVictory,
    data.counterMove,
    data.currentPressureMode,
    data.currentStatus || 'active',
    data.lastActionChapterId || null,
    data.nextEscalationChapterId || null,
    data.linkedVolumeId || null,
    data.notes || '',
  ]
  if (existing) {
    db.prepare(`
      UPDATE resistance_tracks
      SET source_type = ?, source_id = ?, resistance_kind = ?, title = ?, goal = ?, intel_source = ?, resource_pool = ?,
          escalation_plan = ?, hero_knowledge_shift = ?, stage_victory = ?, counter_move = ?, current_pressure_mode = ?,
          current_status = ?, last_action_chapter_id = ?, next_escalation_chapter_id = ?, linked_volume_id = ?, notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...payload, existing.id)
    return existing.id
  }
  return Number(db.prepare(`
    INSERT INTO resistance_tracks (
      novel_id, source_type, source_id, resistance_kind, title, goal, intel_source, resource_pool, escalation_plan,
      hero_knowledge_shift, stage_victory, counter_move, current_pressure_mode, current_status, last_action_chapter_id,
      next_escalation_chapter_id, linked_volume_id, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, ...payload).lastInsertRowid)
}

function ensureResistanceBeat(db, novelId, trackId, title, data) {
  const existing = db.prepare('SELECT id FROM resistance_beats WHERE novel_id = ? AND track_id = ? AND title = ?').get(novelId, trackId, title)
  if (existing) return existing.id
  return Number(db.prepare(`
    INSERT INTO resistance_beats (
      novel_id, track_id, beat_type, chapter_id, timeline_event_id, title, summary, action_mode,
      success_level, counter_response, protagonist_impact, status, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    novelId,
    trackId,
    data.beatType || 'status-note',
    data.chapterId || null,
    data.timelineEventId || null,
    title,
    data.summary,
    data.actionMode || '',
    data.successLevel || 'partial',
    data.counterResponse || '',
    data.protagonistImpact || '',
    data.status || 'logged',
    data.sortOrder || 0,
  ).lastInsertRowid)
}

function ensureSceneTemplate(db, novelId, name, data) {
  const existing = db.prepare('SELECT id FROM scene_templates WHERE novel_id = ? AND name = ?').get(novelId, name)
  const payload = [
    data.category || 'conflict',
    data.description,
    toJson(data.typicalBeats || []),
    toJson(data.suggestedCharacterRoles || []),
    data.emotionArc,
    0,
    data.sortOrder || 0,
  ]
  if (existing) {
    db.prepare(`
      UPDATE scene_templates
      SET category = ?, description = ?, typical_beats_json = ?, suggested_character_roles_json = ?, emotion_arc = ?,
          is_builtin = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...payload, existing.id)
    return existing.id
  }
  return Number(db.prepare(`
    INSERT INTO scene_templates (
      novel_id, name, category, description, typical_beats_json, suggested_character_roles_json, emotion_arc, is_builtin, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, name, ...payload).lastInsertRowid)
}

function updateNovelDocuments(db, novel) {
  const settings = parseJsonObject(novel.settings_json)
  const themeVoice = parseJsonObject(novel.theme_voice_json)
  const writingRules = {
    ...(settings.writing_rules || {}),
    anti_ai_flavor: [
      '反 AI 味不靠口语化灌水，而靠信息不完美、段落参差、人物偏见、具体阻力和代价延续。',
      '每章同类气氛意象最多保留两组；雨、雾、江风、铁声、船板、旧木等只服务行动或判断。',
      '每个场景或关键叙事单元必须让军令、粮册、位置、伤亡、关系、物件或伏笔至少一项发生变化；不要按固定字数切段。',
      '禁止段段用感悟收口；章尾优先停在未答复的奏章、未到的信使、未核清的账或下一道命令。',
    ].join('\n'),
    banned_terms: '历史洪流、命运齿轮、热血沸腾、开挂、爽点、降维打击、像刀、像旧木、没有山呼、不是先看见、他没有立刻、好地方、某种无法言说、这只是开始',
    common_sense_rules: [
      '军令、粮运、水战、城防、传报必须有时间、空间和资源成本。',
      '史料不确定的兵力、船数、伤亡只能写成角色估计或传报，不写成旁白绝对事实。',
      '宋代官职、诏令、奏疏、邸报、制置司、粮运与脚程要作为情节阻力，不做装饰名词。',
    ].join('\n'),
  }

  const nextSettings = {
    ...settings,
    writing_rules: writingRules,
    ai_engine: {
      ...(settings.ai_engine || {}),
      default_mode: 'balanced',
      humanize_pipeline: {
        draft: '先保事实链和场景阻力',
        review: '检测气氛堆叠、段落均匀、零代价解决',
        rewrite: '跨模型或低温重写时只修语言和节奏，不改事实',
      },
    },
  }

  const nextThemeVoice = {
    ...themeVoice,
    styleRules: [
      themeVoice.styleRules || '',
      '段落长短必须参差；每章至少三处段尾停在未完成动作、账册数字、未答复问题或继续存在的代价上。',
      '每个场景或关键叙事单元出现一次可追踪变化：军令、粮册、位置、伤亡、关系、物件、伏笔至少一项改变；不要按固定字数切段。',
      '气氛意象只保留有行动价值的部分，其余改成官职程序、传报时差、物资消耗或人物站位。',
      '不要让旁白替人物总结历史意义；让奏疏措辞、军令改字、对话回避和实际损耗承担主题。',
    ].filter(Boolean).join('\n'),
    forbiddenPhrases: [
      themeVoice.forbiddenPhrases || '',
      '好地方\n像一块被水泡透的旧木\n像刀\n没有山呼\n不是先看见\n他没有立刻\n这一切才刚刚开始\n历史的车轮\n某种无法言说\n真正的成长',
    ].filter(Boolean).join('\n'),
    humanStyleSampleLock: [
      themeVoice.humanStyleSampleLock || '',
      '人工锁定：以赵构御笔改字、张浚奏对、韩世忠报损、岳飞军帖为叙事锚。重大转折必须先有物件/账册/军令，再有心理反应。',
      '退回重写条件：同类气氛词连续堆叠、对话像互相通报信息、每段结尾过于干净、史实数字写成无来源全知旁白。',
    ].filter(Boolean).join('\n'),
  }

  db.prepare('UPDATE novels SET settings_json = ?, theme_voice_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(toJson(nextSettings), toJson(nextThemeVoice), novel.id)
}

function backfillCharacters(db, novelId, ids) {
  const updates = {
    '赵构': {
      surface_desire: '立刻稳住行在、压下再撤船的声音，让百官看见皇帝还在决断。',
      deep_need: '把对武将和乱局的恐惧转化为可执行制度，而不是继续靠逃避和猜疑自保。',
      core_fear: '再次被武将裹挟，或在一纸错误诏令里失去最后的江南。',
      inner_conflict: '没有韩岳这类武将便无法站住，放任韩岳又触动苗刘旧创。',
      hidden_secret: '他并非不懂韩岳之功，只是不敢承认自己必须把性命押给曾经最怕的一类人。',
      moral_line: '可以疑人、制人、缓赏，但不能把前线真实损耗伪装成太平。',
      self_deception: '以为只要把诏令写得周密，就能让恐惧不再左右自己。',
      trauma: '苗刘兵变和海上奔逃留下的身体记忆：水声、甲声、佩刀都会触发紧绷。',
      contradiction: '想要中兴名义，又害怕中兴所需的军权集中。',
      relationship_tension: '与韩世忠是救命功臣和潜在隐患；与岳飞是待用新将和制度试题；与张浚是必须依赖又需防其激进的文臣。',
      resonance_point: '读者会记住他不是变成明君，而是学会把怯意钉在地图和账册上。',
      dramatic_engine: '每次军报到来都逼他在“撤一步保身”和“放一步让将”之间作出有代价的选择。',
      catchphrases: '“船，不撤了。”；“照实写。”；“先核粮，再言功。”',
      vocabulary_level: '御前短诏与克制白话并用，少长篇抒情。',
      dialect_features: '无方言，句式短，关键处用御笔式断句。',
    },
    '韩世忠': {
      surface_desire: '把完颜宗弼拖在黄天荡，让金军知道江面有人敢拦。',
      deep_need: '获得朝廷承认，同时学会把败处、损耗和功劳一并交给制度。',
      core_fear: '前线拼命换来的战果被朝廷一句“轻进”抹平。',
      inner_conflict: '敢抗命邀击，却也知道没有朝廷粮饷，水军血勇撑不了下一战。',
      hidden_secret: '比起被问罪，他更怕战报被粉饰成大捷，害死下一批船户。',
      moral_line: '战场可险，阵亡和折损必须实报。',
      self_deception: '以为只要打得狠，朝廷自然会懂。',
      trauma: '黄天荡火攻后，烧焦船索和浮尸清点成为他的败中记忆。',
      contradiction: '悍烈好胜，却愿意让梁氏把请罪札子写到最难看的程度。',
      relationship_tension: '与赵构隔着功臣和猜忌；与张浚隔着军功和制度；与岳飞互不相见却互为标尺。',
      resonance_point: '敢把胜处和败处一起报上去的将军，比只会报捷的将军更可信。',
      dramatic_engine: '每次战术冒险都在换取时间，但战后必须面对朝廷如何计算功过。',
      catchphrases: '“要过江，先过我船。”；“折了多少，照数写。”',
      vocabulary_level: '行伍短句，少典故，多船、箭、米、死人这些硬词。',
      dialect_features: '粗粝但不粗鄙，命令多于解释。',
    },
    '岳飞': {
      surface_desire: '收复建康并为北向请求器甲粮饷。',
      deep_need: '让朝廷看见军纪和民心同样是战功的一部分。',
      core_fear: '胜利之后军纪崩坏，使宋军在百姓眼里仍是另一支过境兵。',
      inner_conflict: '想继续追击，却必须先处理粮仓、流民和军纪。',
      hidden_secret: '他知道请粮请甲会被视作伸手要权，但不开口，下一战只会拿人命补器甲。',
      moral_line: '不得扰民，不得把收复之地当成战利品。',
      self_deception: '相信只要规矩够严，朝廷就会自然理解前线需求。',
      trauma: '多次败散与重聚让他对“军心散”格外敏感。',
      contradiction: '不贪虚功，却不得不把功劳换成器甲和粮。',
      relationship_tension: '与赵构隔着未知和试探；与张浚是可被纳入制度的将才；与韩世忠是江战与陆战两面镜子。',
      resonance_point: '他最打动人的不是“必胜”，而是胜后先贴军帖、先管粮仓。',
      dramatic_engine: '每一次胜利都会立刻变成治理题和补给题，逼他从战术奇兵走向制度内将领。',
      catchphrases: '“功要换粮甲，不换虚名。”；“军帖先贴。”',
      vocabulary_level: '平实精确，少空话，常把战果落回粮、甲、军纪。',
      dialect_features: '河朔军人口吻，简朴有压迫感。',
    },
    '张浚': {
      surface_desire: '把韩岳战果转为江防整编方案，压住朝堂“只收权不供粮”的惯性。',
      deep_need: '证明文臣制将不是拆将，而是让将帅之功能延续。',
      core_fear: '皇帝继续退缩，或武将战功失控重演苗刘阴影。',
      inner_conflict: '要替武将请粮请权，又必须替皇帝设计制衡。',
      hidden_secret: '他明白自己的强硬也可能把局势推过头。',
      moral_line: '不能用空名赏功，也不能让武将脱离朝廷账册。',
      self_deception: '以为制度方案足够周密，便能同时安抚皇帝、文臣和前线。',
      trauma: '苗刘勤王经验让他清楚武力既能救朝廷，也能掀翻朝廷。',
      contradiction: '知兵而为文臣，敢冒险却必须用文书包装冒险。',
      relationship_tension: '与赵构是劝进与犯忌；与韩岳是借战功成制度；与言官是同朝异路。',
      resonance_point: '他总是在最危险的词上替皇帝改一个能执行的说法。',
      dramatic_engine: '每次前线胜败都变成他在朝堂上为“给粮、给名、给约束”争一寸的材料。',
      catchphrases: '“臣请先定其法。”；“不供粮而责胜，非制将也。”',
      vocabulary_level: '奏对式白话，利害清楚，句子比武将长但不空。',
      dialect_features: '无方言，文臣锋芒。',
    },
    '完颜宗弼': {
      surface_desire: '带金军北还，保存南侵威势。',
      deep_need: '承认宋军江防正在成形，并找到下一次南下可利用的缝隙。',
      core_fear: '被拖在江南水网里耗尽军心、马力和战利品。',
      inner_conflict: '既要显出不可阻挡，又必须现实地凿渠、谈判、避险。',
      hidden_secret: '他开始把韩世忠和岳飞当成需要重新估量的对手。',
      moral_line: '以胜负和活路为准，不为虚名困死于江南。',
      self_deception: '认为宋廷的猜忌会比宋军的战力更先瓦解江防。',
      trauma: '黄天荡相持让他第一次意识到长江不是任由骑兵越过的平地。',
      contradiction: '宗室锐气和撤退现实之间的拉扯。',
      relationship_tension: '与韩世忠是江面困兽；与岳飞是建康退路上的新敌；与赵构隔着追杀未竟的心理压力。',
      resonance_point: '强敌不靠吼叫压迫，而靠每一次冷静找活路。',
      dramatic_engine: '他的每次突围和北顾都会证明宋军还没赢，同时逼宋廷承认危机远未结束。',
      catchphrases: '“路在水下，也要挖出来。”',
      vocabulary_level: '冷静军事判断，多路、粮、马、军心。',
      dialect_features: '译写成简短汉语，不堆蛮横口号。',
    },
  }

  for (const [name, fields] of Object.entries(updates)) {
    const id = ids.characters.get(name)
    if (!id) continue
    updateBlankFields(db, 'characters', 'id', id, fields)
  }
}

function backfillStoryArc(db, novelId) {
  const existing = db.prepare('SELECT id FROM story_arcs WHERE novel_id = ? ORDER BY arc_order, id LIMIT 1').get(novelId)
  const payload = {
    arcName: '海上回銮与江防初立',
    chapterStart: 1,
    chapterEnd: 10,
    arcGoal: '让赵构从海上奔逃后的惊魂中停止惯性撤船，借韩世忠黄天荡、岳飞牛头山和建康粮火，把“赏功、核粮、严军纪、定江防”写成第一版新旌军约。',
    arcSummary: '前四章完成海上回銮、黄天荡和牛头山三枚史实锚；五至十章转入胜后治理、文臣制将、财政饷道和制度摊牌。弧线重点不是爽胜，而是每次胜利都立刻变成粮、权、军纪和猜忌的账。',
    growthLedger: '赵构：撤船惯性 -> 公开实报功过 -> 以军约替代单纯猜忌；韩世忠：血勇拦江 -> 实报败处；岳飞：战术立功 -> 以军纪和请粮进入朝廷视野；张浚：催战 -> 制度整编。',
    costLedger: '黄天荡未能全歼，火攻折损持续；建康收复后粮仓、流民和豪强冲突暴露治理成本；给韩岳粮甲会触发文臣制将恐惧。',
    phaseTargets: ['第1章止撤船', '第2-3章黄天荡败中有功', '第4章岳飞收复建康', '第5章粮火治理', '第6-8章朝堂制度争议', '第9章韩岳双请', '第10章新旌军约'],
  }
  if (existing) {
    db.prepare(`
      UPDATE story_arcs
      SET arc_name = ?, chapter_start = ?, chapter_end = ?, arc_goal = ?, arc_summary = ?,
          growth_ledger = ?, cost_ledger = ?, target_words = 45000, progress_percent = 40,
          last_progress_chapter_num = 4, phase_targets_json = ?
      WHERE id = ?
    `).run(payload.arcName, payload.chapterStart, payload.chapterEnd, payload.arcGoal, payload.arcSummary, payload.growthLedger, payload.costLedger, toJson(payload.phaseTargets), existing.id)
    return existing.id
  }
  return Number(db.prepare(`
    INSERT INTO story_arcs (
      novel_id, arc_name, arc_order, chapter_start, chapter_end, arc_goal, arc_summary, growth_ledger,
      cost_ledger, target_words, progress_percent, last_progress_chapter_num, phase_targets_json
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 45000, 40, 4, ?)
  `).run(novelId, payload.arcName, payload.chapterStart, payload.chapterEnd, payload.arcGoal, payload.arcSummary, payload.growthLedger, payload.costLedger, toJson(payload.phaseTargets)).lastInsertRowid)
}

function backfillFactsCommitmentsAndForeshadow(db, novelId, ids) {
  const volumeId = ids.volumes.get(1) || null
  const factRows = [
    ['苗刘旧案是赵构制将的创伤证据', 'fact', '苗刘兵变不是背景板，而是赵构每次面对武将放权时的身体记忆和制度恐惧。', 1, 1, 10, '绑定赵构的撤船冲动与第10章军约。'],
    ['韩世忠黄天荡有功有过', 'fact', '黄天荡既拖住金军、重振江防士气，也暴露火攻突围和水军折损，不能写成单纯大捷。', 3, 3, 10, '第10章公开完整战报，作为军纪先于胜败的依据。'],
    ['岳飞收复建康后先遇粮仓题', 'clue', '建康收复后的第一道题不是北伐，而是粮仓、流民、豪强和军纪的治理冲突。', 4, 4, 5, '第5章兑现为建康粮火。'],
    ['建康豪强囤粮牵动行在财政', 'clue', '豪强囤粮、旧官推责、流民围仓会逼赵构承认胜后治理比战场捷报更难。', 5, 5, 6, '第6章转入江防新议。'],
    ['李纲旧疏代表道义债', 'promise', '恢复中原的道义不能被抹掉，但建炎四年的财政和兵力无法支撑空喊北伐。', 8, 8, 10, '第8章把旧疏变成财政难题。'],
    ['新旌军约必须三件同写', 'promise', '新旌军约若只赏功不核粮，只收权不供饷，只严军纪不定目标，都会失败。', 6, 6, 10, '第10章形成赏功、核粮、军纪、江防目标四条。'],
    ['金军北还不等于压力解除', 'fact', '完颜宗弼北还只是阶段撤离，淮东、川陕和下一轮南下压力仍在。', 7, 7, 10, '第7章提醒朝廷不能把捷报当太平。'],
    ['岳飞请甲粮是制度压力测试', 'fact', '岳飞的器甲粮饷请求会逼赵构决定：给不给、怎么给、给了如何制约。', 9, 9, 10, '第9章把岳飞请粮和韩世忠江防并案处理。'],
  ]
  const factIds = new Map()
  for (const [title, kind, summary, readerChapter, protagonistChapter, targetChapter, notes] of factRows) {
    const id = ensureByNovelTitle(db, 'story_facts', 'title', novelId, title, `
      INSERT INTO story_facts (
        novel_id, volume_id, kind, title, summary, status, reader_known_chapter_id, protagonist_known_chapter_id,
        character_knowledge_json, forbidden_before_volume, planned_reveal_volume, target_reveal_chapter_id, is_key_truth, notes
      ) VALUES (?, ?, ?, ?, ?, 'introduced', ?, ?, ?, NULL, 1, ?, 1, ?)
    `, [
      novelId,
      volumeId,
      kind,
      title,
      summary,
      ids.chapters.get(readerChapter) || null,
      ids.chapters.get(protagonistChapter) || null,
      toJson([{ characterId: ids.characters.get('赵构'), state: protagonistChapter <= 4 ? 'known' : 'planned' }]),
      ids.chapters.get(targetChapter) || null,
      notes,
    ])
    factIds.set(title, id)
  }

  const commitments = [
    ['制将不是弃将', 'theme', '最终必须回答赵构如何既依赖韩岳，又不让军权脱离朝廷。', 1, '读者承诺：不把赵构简单洗成明君，也不把名将当无成本战神。', 10],
    ['黄天荡完整战报公开', 'promise', '韩世忠的功过、折损和梁氏请罪都要成为第10章军约合法性的来源。', 2, '第3章已种：败中有功、如实报损。', 10],
    ['岳飞粮甲请求有明确答复', 'promise', '岳飞不能只被口头嘉奖；必须得到有条件的粮甲，同时被纳入军纪和核籍约束。', 3, '第4章已种：功要换器甲粮饷。', 10],
    ['建康粮火推动军纪条款', 'promise', '第5章的粮仓冲突必须回收到军约中的核粮和勿扰居民条款。', 4, '胜后治理线不能丢。', 10],
    ['苗刘旧案不被烧毁', 'image', '结尾保留苗刘案卷，表示赵构的猜忌仍在，但被制度暂时驯服。', 5, '最终画面：案卷匣和新旌军约同在御案。', 10],
  ]
  const commitmentIds = new Map()
  for (const [title, kind, description, sourceOrder, sourceText, targetResolutionChapter] of commitments) {
    const id = ensureByNovelTitle(db, 'endgame_commitments', 'title', novelId, title, `
      INSERT INTO endgame_commitments (
        novel_id, commitment_kind, title, description, source_order, source_text, status, target_resolution_chapter, last_served_chapter, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 4, ?)
    `, [novelId, kind, title, description, sourceOrder, sourceText, targetResolutionChapter, '《淮上新旌》回填承诺'])
    commitmentIds.set(title, id)
  }

  const foreshadows = [
    ['船不撤的第一道御笔', '第1章赵构没有撤韩世忠的船；第10章回收为江防大寨不再临战撤船。', 1, 'object-action', 'high', 10, '赵构在军约里写明沿江各寨不得无诏自撤船。', '第1章御笔和第10章军约条款互相印证。', '读者看到“止撤船”从情绪决定变成制度条款。', '赵构能否停止无底线撤退', '制将不是弃将'],
    ['黄天荡折损如实上报', '第3章梁氏请罪札子要求写明折损；第10章公开完整战报。', 3, 'document', 'high', 10, '邸报不只写捷报，也写火攻突围和阵亡册。', '梁氏札子、阵亡册、赵构批语。', '赏功与问责同时成立。', '韩世忠黄天荡败中有功', '黄天荡完整战报公开'],
    ['岳飞军帖勿扰居民', '第4章岳飞贴军帖；第5章粮仓冲突检验军纪；第10章写入军约。', 4, 'rule-test', 'high', 10, '建康粮火后，勿扰居民成为新旌军约的硬条。', '牛头山军帖、粮仓冲突、岳飞请粮札子。', '岳飞的军纪不是装饰。', '岳飞牛头山初显锋芒', '岳飞粮甲请求有明确答复'],
    ['建康粮仓火星', '第5章围绕粮仓、豪强、流民和宋军军纪爆发冲突。', 5, 'incident', 'medium', 6, '张浚用粮仓冲突提出江防新议。', '粮仓封条、流民口供、旧官推责。', '胜利后的治理题压过战场喜讯。', '赏功与制将的制度矛盾', '建康粮火推动军纪条款'],
    ['李纲旧疏重开', '第8章旧疏被重提，提醒朝廷道义债仍在。', 8, 'document', 'medium', 10, '赵构把旧疏的恢复之义压入可执行的江防目标，而非空喊北伐。', '旧疏、财政册、言官争议。', '恢复目标被暂时制度化。', '赵构能否停止无底线撤退', '制将不是弃将'],
    ['苗刘案卷匣', '第1章和第10章都出现旧案卷，形成赵构创伤未消但被制度约束的闭环。', 1, 'symbol', 'high', 10, '赵构最终没有烧掉案卷，只把新军约压在案卷旁。', '苗刘旧案卷、新旌军约朱批。', '人物弧线不靠洗白，而靠有代价的自控。', '赏功与制将的制度矛盾', '苗刘旧案不被烧毁'],
  ]
  const foreshadowIds = new Map()
  for (const [title, detail, sourceChapter, plantMethod, salienceLevel, targetPayoffChapter, payoffMethod, requiredEvidence, readerVisibleOutcome, threadTitle, commitmentTitle] of foreshadows) {
    const id = ensureByNovelTitle(db, 'foreshadow_ledger', 'title', novelId, title, `
      INSERT INTO foreshadow_ledger (
        novel_id, title, detail, source_chapter_id, plant_method, salience_level, target_payoff_chapter,
        payoff_method, payoff_scene_action, required_evidence, reader_visible_outcome, allowed_delay_reason,
        impact_scope, status, linked_thread_id, linked_endgame_commitment_id, linked_volume_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'global', 'active', ?, ?, ?)
    `, [
      novelId,
      title,
      detail,
      ids.chapters.get(sourceChapter) || null,
      plantMethod,
      salienceLevel,
      targetPayoffChapter,
      payoffMethod,
      payoffMethod,
      requiredEvidence,
      readerVisibleOutcome,
      '若史实节点需要延后，必须在章节合同里说明延期原因。',
      ids.threads.get(threadTitle) || null,
      commitmentIds.get(commitmentTitle) || null,
      volumeId,
    ])
    foreshadowIds.set(title, id)
  }

  return { factIds, commitmentIds, foreshadowIds }
}

function backfillVolumeDesign(db, novelId, ids, refs) {
  const volumeId = ids.volumes.get(1)
  if (!volumeId) return
  const existing = db.prepare('SELECT id FROM volume_designs WHERE novel_id = ? AND volume_id = ?').get(novelId, volumeId)
  const payload = [
    '恐惧被钉成规矩',
    '第一卷承诺读者看到赵构如何从海上奔逃后的惊魂，经过黄天荡、牛头山和建康粮火，第一次把江防写成可执行的军政框架。',
    '前线战功需要放权，朝堂创伤要求制衡，流民粮仓要求治理，三者在第10章合成新旌军约。',
    '第9章韩世忠江防请求与岳飞器甲粮饷并案，第10章赵构公开完整战报并颁布新旌军约。',
    '南宋不是赢了，而是第一次有了“下次不全靠逃”的制度底盘；赵构的猜忌仍在，但被账册、军纪和目标临时驯服。',
    toJson([...refs.foreshadowIds.values()]),
    toJson([...refs.foreshadowIds.values()].filter(Boolean)),
    '历史正剧读者期待史实节点、制度逻辑和人物灰度同时兑现；本卷必须避免单纯大捷爽文。',
    toJson([...refs.commitmentIds.values()]),
    '[]',
    'ready',
  ]
  if (existing) {
    db.prepare(`
      UPDATE volume_designs
      SET volume_theme = ?, volume_promise = ?, main_conflict = ?, climax_plan = ?, end_state_shift = ?,
          must_add_clues_json = ?, must_resolve_clues_json = ?, reader_expectation = ?,
          linked_endgame_commitment_ids_json = ?, linked_resistance_track_ids_json = ?, audit_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...payload, existing.id)
    return
  }
  db.prepare(`
    INSERT INTO volume_designs (
      novel_id, volume_id, volume_theme, volume_promise, main_conflict, climax_plan, end_state_shift,
      must_add_clues_json, must_resolve_clues_json, reader_expectation, linked_endgame_commitment_ids_json,
      linked_resistance_track_ids_json, audit_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(novelId, volumeId, ...payload)
}

function backfillChapterPlans(db, novelId, ids, refs, relationArcIds, resistanceTrackIds) {
  const arcId = db.prepare('SELECT id FROM story_arcs WHERE novel_id = ? ORDER BY arc_order, id LIMIT 1').get(novelId)?.id
  const allThreads = [...ids.threads.values()]
  const allCommitments = [...refs.commitmentIds.values()]
  const baseForbidden = toJson([
    '不得把黄天荡写成无损大捷。',
    '不得让赵构突然变成无创伤明君。',
    '不得让岳飞只用口号解决粮仓和军纪。',
    '不得写现代词、系统词、民族主义口号或无来源精确兵数。',
  ])
  const chapterData = {
    1: {
      goal: '赵构回越州，接到韩世忠邀击金军折子，第一次不撤船。',
      opening: 'incident',
      ending: 'decision-hook',
      emotion: '惊魂止退',
      hook: 'policy_choice',
      progress: [{ arcId, chapter: 1, target: '止撤船', state: 'done' }],
      assets: ['苗刘旧案卷'],
      foreshadows: ['船不撤的第一道御笔', '苗刘案卷匣'],
      scenePlan: [
        { order: 1, title: '越州码头落地', purpose: '用身体失衡和百官沉默呈现赵构海上创伤', conflict: '接驾礼仪需要安定，岸上流民和勤王甲士让恐惧无法被礼制遮住', exit_hook: '张浚带着镇江急折插入接驾' },
        { order: 2, title: '御笔止撤船', purpose: '赵构在撤与不撤之间作出第一道有代价的选择', conflict: '撤船保身与放韩世忠邀击之间撕扯', exit_hook: '“船，不撤了”送往镇江' },
      ],
    },
    2: {
      goal: '韩世忠在金山、黄天荡设伏，拒绝完颜宗弼使者。',
      opening: 'battlefield-object',
      ending: 'enemy-trapped',
      emotion: '紧张立势',
      hook: 'military_pressure',
      progress: [{ arcId, chapter: 2, target: '黄天荡拦江启动', state: 'done' }],
      assets: ['黄天荡江图', '金山铁绠钩'],
      foreshadows: ['黄天荡折损如实上报'],
      scenePlan: [
        { order: 1, title: '金山分船', purpose: '用船、潮、水口和征调写出水战准备', conflict: '船不够、箭不够、朝廷诏令未必来得及', exit_hook: '梁氏判断敌船载重' },
        { order: 2, title: '拒使', purpose: '让韩世忠用短对白立住拦江决心', conflict: '金使以活路与赏赐诱降，韩世忠以江面回应', exit_hook: '金军后部被拖入黄天荡' },
      ],
    },
    3: {
      goal: '黄天荡火攻突围，韩世忠败中有功，赵构接受实报功过。',
      opening: 'aftermath-count',
      ending: 'complete-report',
      emotion: '惨烈实报',
      hook: 'truth_over_victory',
      progress: [{ arcId, chapter: 3, target: '败中有功成为制度素材', state: 'done' }],
      assets: ['忠勇御书旗', '黄天荡江图'],
      foreshadows: ['黄天荡折损如实上报'],
      scenePlan: [
        { order: 1, title: '火船与无风', purpose: '写出韩世忠战术优势如何被天气和凿渠反制', conflict: '大船无风难动，箭矢和棹手消耗见底', exit_hook: '金军从新渠突围' },
        { order: 2, title: '梁氏请罪札', purpose: '把损耗、阵亡册和请罪变成可信战报', conflict: '报捷可保脸面，实报会招问责', exit_hook: '赵构决定赏“忠勇”但不抹败处' },
      ],
    },
    4: {
      goal: '岳飞牛头山收复建康，把军纪、粮饷和赏功放进同一道诏令。',
      opening: 'battlefield-smoke',
      ending: 'policy-merge',
      emotion: '反击立规矩',
      hook: 'victory_becomes_governance',
      progress: [{ arcId, chapter: 4, target: '岳飞进入制度视野', state: 'done' }],
      assets: ['牛头山军帖'],
      foreshadows: ['岳飞军帖勿扰居民'],
      scenePlan: [
        { order: 1, title: '清水亭到牛头山', purpose: '展示岳飞如何用伏击与军纪收复建康', conflict: '兵少甲缺，不可轻进也不可坐失', exit_hook: '建康城门打开后粮仓问题浮现' },
        { order: 2, title: '赏功诏令改字', purpose: '赵构第一次把赏功、核籍和勿扰居民放进同一批答', conflict: '言官劾状和岳飞请粮札子同时在案', exit_hook: '建康粮仓急报未到先有火星' },
      ],
    },
    5: {
      goal: '建康粮仓冲突爆发，岳飞用军纪止乱，赵构被迫把胜后治理纳入江防。',
      opening: 'grain-ledger',
      ending: 'urgent-report',
      emotion: '诱惑拒绝',
      hook: 'governance_crisis',
      progress: [{ arcId, chapter: 5, target: '胜后治理代价显形', state: 'planned' }],
      assets: ['牛头山军帖'],
      foreshadows: ['建康粮仓火星', '岳飞军帖勿扰居民'],
      scenePlan: [
        { order: 1, title: '粮仓封条', purpose: '流民、旧官、豪强和宋军围绕粮仓各自求活', conflict: '开仓救民会断军粮，封仓保军会激民变', exit_hook: '军士被诱去私取米袋' },
        { order: 2, title: '军帖前的杖责', purpose: '岳飞用军纪压住宋军，同时逼旧官交出囤粮名单', conflict: '严军纪会伤士气，不严会失民心', exit_hook: '建康急报送往越州' },
        { order: 3, title: '越州灯下核粮', purpose: '赵构看到胜利后的治理账，承认江防不是只靠捷报', conflict: '赏岳飞会被看作放权，不赏又断前线信心', exit_hook: '张浚提出江防新议' },
      ],
    },
    6: {
      goal: '张浚提出江防整编，文臣担忧武将坐大，赵构要求先拿出账册。',
      opening: 'court-debate',
      ending: 'ledger-demand',
      emotion: '紧张制衡',
      hook: 'institution_design',
      progress: [{ arcId, chapter: 6, target: '江防整编进入朝议', state: 'planned' }],
      assets: ['苗刘旧案卷', '忠勇御书旗'],
      foreshadows: ['新旌军约必须三件同写'],
      scenePlan: [
        { order: 1, title: '朝堂先吵收权', purpose: '让文臣用苗刘旧事反对继续放权', conflict: '收权可以安内，却会让前线无粮无名', exit_hook: '张浚把韩岳战报并列摊开' },
        { order: 2, title: '江防新议草案', purpose: '张浚提出赏功、核粮、节制三案并行', conflict: '每一案都需要钱、名分和皇帝承担风险', exit_hook: '赵构要求先核真实粮数' },
      ],
    },
    7: {
      goal: '完颜宗弼北还但金军压力未消，宋廷围绕守江还是进取出现裂缝。',
      opening: 'enemy-report',
      ending: 'next-front',
      emotion: '冷硬博弈',
      hook: 'threat_persists',
      progress: [{ arcId, chapter: 7, target: '外部压力延续', state: 'planned' }],
      assets: ['黄天荡江图'],
      foreshadows: ['金军北还不等于压力解除'],
      scenePlan: [
        { order: 1, title: '宗弼北顾', purpose: '从金军视角写北还不是败亡，而是保存下次南下能力', conflict: '战利品、马力、军心和水路恐惧同时消耗', exit_hook: '金军斥候记下宋军江防缝隙' },
        { order: 2, title: '守江还是北望', purpose: '朝廷内部围绕战果用途产生裂缝', conflict: '岳飞一线想进，行在财政只能守', exit_hook: '李纲旧疏被重新翻出' },
      ],
    },
    8: {
      goal: '李纲旧疏被重提，赵构面对恢复道义与现实财政的冲突。',
      opening: 'old-memorial',
      ending: 'moral-debt',
      emotion: '裂痕重组',
      hook: 'moral_vs_budget',
      progress: [{ arcId, chapter: 8, target: '恢复道义被压入财政现实', state: 'planned' }],
      assets: ['苗刘旧案卷'],
      foreshadows: ['李纲旧疏重开'],
      scenePlan: [
        { order: 1, title: '旧疏重开', purpose: '让恢复中原的道义以旧疏形式进入朝堂', conflict: '不提恢复失人心，真提恢复没钱没兵', exit_hook: '户部账册把道义压成缺额' },
        { order: 2, title: '朱批留白', purpose: '赵构不否定恢复，却把目标暂时写成江防可执行步骤', conflict: '这不是胜利，只是承认无力', exit_hook: '岳飞请甲粮札子到来' },
      ],
    },
    9: {
      goal: '岳飞请求器甲粮饷，韩世忠要求稳定江防，张浚把两线合成新旌军约草案。',
      opening: 'double-petition',
      ending: 'draft-ready',
      emotion: '动摇沉重',
      hook: 'dual_request',
      progress: [{ arcId, chapter: 9, target: '韩岳双请逼近摊牌', state: 'planned' }],
      assets: ['忠勇御书旗', '牛头山军帖'],
      foreshadows: ['岳飞请甲粮是制度压力测试', '黄天荡折损如实上报'],
      scenePlan: [
        { order: 1, title: '两封札子同到', purpose: '韩世忠要江防稳定，岳飞要器甲粮饷，二者同时压到御案', conflict: '给一方容易失衡，全不给前线离心', exit_hook: '赵构让张浚并案' },
        { order: 2, title: '草案三改', purpose: '张浚把赏功、核粮、军纪、节制写成同一军约草案', conflict: '每改一个字都触动一方利益', exit_hook: '赵构夜里独对苗刘案卷' },
      ],
    },
    10: {
      goal: '赵构颁布新旌军约，阶段性完成赏功、核粮、严军纪、定江防。',
      opening: 'final-edict',
      ending: 'new-banner',
      emotion: '燃起但克制',
      hook: 'endgame-payoff',
      progress: [{ arcId, chapter: 10, target: '新旌军约出台', state: 'planned' }],
      assets: ['苗刘旧案卷', '忠勇御书旗', '牛头山军帖'],
      foreshadows: ['船不撤的第一道御笔', '黄天荡折损如实上报', '岳飞军帖勿扰居民', '李纲旧疏重开', '苗刘案卷匣'],
      scenePlan: [
        { order: 1, title: '完整战报入邸报', purpose: '公开韩世忠功过并存，确立军纪先于粉饰胜败', conflict: '言官怕助长武臣，前线怕功劳被抹', exit_hook: '赵构批下忠勇和核粮并行' },
        { order: 2, title: '新旌军约四条', purpose: '把赏功、核粮、严军纪、定江防写成可执行制度', conflict: '每条都不完美，但比撤逃和空赏更能活下去', exit_hook: '新旌旗送往沿江各寨' },
        { order: 3, title: '案卷未烧', purpose: '完成赵构弧线：创伤未消但被制度约束', conflict: '他仍害怕武将，却不再只靠撤船回应恐惧', exit_hook: '江防号角压住烛火，没有灭' },
      ],
    },
  }

  for (const [chapterNumText, data] of Object.entries(chapterData)) {
    const chapterNum = Number(chapterNumText)
    const chapterId = ids.chapters.get(chapterNum)
    if (!chapterId) continue
    const assetRefs = data.assets.map((name) => compactObject({ type: 'item', name, id: ids.items.get(name) }))
    const foreshadowIds = data.foreshadows.map((name) => refs.foreshadowIds.get(name)).filter(Boolean)
    ensureChapterContract(db, novelId, chapterId, {
      chapterGoal: data.goal,
      openingStyle: data.opening,
      endingStyle: data.ending,
      expositionMode: 'through-action-and-documents',
      emotionFocus: data.emotion,
      servedThreadIdsJson: toJson(allThreads),
      requiredArcProgressJson: toJson(data.progress),
      requiredCharacterArcIdsJson: '[]',
      requiredRelationshipArcIdsJson: toJson(relationArcIds),
      requiredResistanceTrackIdsJson: toJson(resistanceTrackIds),
      requiredResistanceActionsJson: toJson(data.scenePlan.map((scene) => scene.conflict)),
      requiredAssetRefsJson: toJson(assetRefs),
      requiredEndgameCommitmentIdsJson: toJson(chapterNum >= 8 ? allCommitments : allCommitments.slice(0, 3)),
      requiredForeshadowIdsJson: toJson(foreshadowIds),
      hookType: data.hook,
      forbiddenActionsJson: baseForbidden,
      acceptanceNotesJson: toJson([
        '每个场景必须有具体阻力、行动选择和后续状态变化。',
        '历史节点只写角色可知信息，不用全知旁白给无来源精确数。',
        '同类气氛意象最多两组，多余篇幅改为军令、粮册、路线、站位或对话博弈。',
      ]),
      status: 'ready',
    })

    const scenePlanJson = toJson(data.scenePlan.map((scene) => ({
      scene_order: scene.order,
      scene_title: scene.title,
      purpose: scene.purpose,
      location: chapterNum <= 1 ? '越州行在' : chapterNum <= 3 ? '镇江/黄天荡' : chapterNum <= 5 ? '建康' : '越州行在与前线传报',
      time_anchor: `建炎四年·第${chapterNum}章`,
      present_characters: [],
      key_items: data.assets,
      conflict: scene.conflict,
      hidden_agendas: ['赵构要稳住朝廷却怕武将坐大', '前线要粮要名，朝堂要可控责任'],
      irony_gap: '捷报越多，制度压力越重。',
      audience: '历史正剧读者',
      beat: scene.purpose,
      must_cover: [scene.conflict, ...data.foreshadows],
      climax_variant: data.hook,
      exit_hook: scene.exit_hook,
    })))

    db.prepare(`
      UPDATE chapters
      SET scene_plan_json = CASE WHEN scene_plan_json IS NULL OR TRIM(scene_plan_json) = '' THEN ? ELSE scene_plan_json END,
          bridge_plan_json = CASE WHEN bridge_plan_json IS NULL OR TRIM(bridge_plan_json) = '' THEN ? ELSE bridge_plan_json END,
          allowed_fact_ids_json = ?,
          target_words = CASE WHEN COALESCE(target_words, 0) < 4200 THEN 4600 ELSE target_words END,
          emotion_tone = COALESCE(NULLIF(emotion_tone, ''), ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      scenePlanJson,
      toJson({ bridge_in: '承接上一章未完成压力，不另起世界观。', bridge_out: data.scenePlan.at(-1)?.exit_hook || data.goal, no_ai_flavor_focus: '段落参差、硬材料、代价延续' }),
      toJson([...refs.factIds.values()]),
      data.emotion,
      chapterId,
    )

    const segment = db.prepare('SELECT id FROM chapter_segments WHERE novel_id = ? AND chapter_id = ? ORDER BY segment_order, id LIMIT 1').get(novelId, chapterId)
    if (segment) {
      db.prepare(`
        UPDATE chapter_segments
        SET title = COALESCE(NULLIF(title, ''), ?),
            purpose = COALESCE(NULLIF(purpose, ''), ?),
            time_anchor = COALESCE(NULLIF(time_anchor, ''), ?),
            location_name = COALESCE(NULLIF(location_name, ''), ?),
            input_state = COALESCE(NULLIF(input_state, ''), ?),
            output_state = COALESCE(NULLIF(output_state, ''), ?),
            summary = COALESCE(NULLIF(summary, ''), ?),
            risk_tags_json = CASE WHEN risk_tags_json IS NULL OR TRIM(risk_tags_json) = '' THEN ? ELSE risk_tags_json END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.scenePlan[0]?.title || `第${chapterNum}章主场景`,
        data.goal,
        `建炎四年·第${chapterNum}章`,
        chapterNum <= 1 ? '越州行在' : chapterNum <= 3 ? '黄天荡' : chapterNum <= 5 ? '建康' : '越州行在',
        '上一章压力未完全解决。',
        data.scenePlan.at(-1)?.exit_hook || data.goal,
        data.scenePlan.map((scene) => `${scene.title}：${scene.purpose}`).join('；'),
        toJson(['history-fact-boundary', 'anti-ai-imagery-budget', 'resource-cost']),
        segment.id,
      )
    }
  }
}

function backfillGrowthAndResources(db, novelId, ids) {
  const volumeId = ids.volumes.get(1) || null
  const tracks = [
    ['赵构：从撤船惯性到制度制将', 'character', 'character', ids.characters.get('赵构'), '赵构', '创伤止退期', '第10章能把恐惧写入军约而非撤船', '公开实报功过并给出有条件的粮甲', '苗刘旧案带来的制将恐惧', '真实战报、粮册、张浚方案', '战报入邸报，粮册先核再赏', '每次放权必须绑定核粮、军纪和目标', '武将离心或朝臣借旧案阻断前线', '每2章一次可见抉择'],
    ['江防粮饷：从临时征调到可核账', 'resource', 'system', null, '江防粮饷', '短缺失衡', '第10章建立沿江大寨核粮规则', '第6-9章完成账册、请粮、节制并案', '粮船不足、地方推责、豪强囤粮', '建康粮仓、户部册、沿江船户', '先核粮仓和船数，再拨甲粮', '粮饷消耗必须反馈到下一章压力', '前线得虚赏无实粮，战功转为怨气', '每章检查资源余量'],
    ['岳飞：战功转制度信用', 'character', 'character', ids.characters.get('岳飞'), '岳飞', '被看见但未完全信任', '以军纪和请粮进入制度，不只靠战功立名', '第9章请甲粮，第10章获得有条件拨付', '年轻将领非嫡系，功高也可能触发猜疑', '建康军帖、粮仓冲突、牛头山军功', '战功 -> 军纪证明 -> 请粮札子 -> 有条件授权', '每次获得资源都要承担军纪和核籍约束', '战功被虚赏，岳飞无法继续经营建康', '第4、5、9、10章关键推进'],
    ['韩世忠：败中有功的信用账', 'character', 'character', ids.characters.get('韩世忠'), '韩世忠', '悍将报捷期', '完整战报成为朝廷信任水军的第一本账', '第10章以忠勇旗和实报折损并行收束', '黄天荡火攻突围带来功过争议', '阵亡册、梁氏请罪札、忠勇御书旗', '报损换信用，信用换江防稳定', '军功必须连带阵亡册和补船耗费', '若只报捷，下次江防会死在假账上', '第2、3、9、10章关键推进'],
  ]
  const trackIds = new Map()
  for (const [title, trackType, sourceEntityType, sourceEntityId, sourceEntityLabel, currentTier, stageGoal, nextGoal, bottleneck, scarceResource, acquirePath, consumptionRule, failureCost, rewardCadence] of tracks) {
    const id = ensureByNovelTitle(db, 'growth_tracks', 'title', novelId, title, `
      INSERT INTO growth_tracks (
        novel_id, track_type, source_entity_type, source_entity_id, source_entity_label, title, current_tier,
        stage_goal, next_goal, bottleneck, scarce_resource, acquire_path, consumption_rule, failure_cost,
        reward_cadence, linked_volume_id, linked_chapter_id, status, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `, [
      novelId,
      trackType,
      sourceEntityType,
      sourceEntityId || null,
      sourceEntityLabel,
      title,
      currentTier,
      stageGoal,
      nextGoal,
      bottleneck,
      scarceResource,
      acquirePath,
      consumptionRule,
      failureCost,
      rewardCadence,
      volumeId,
      ids.chapters.get(10) || null,
      (trackIds.size + 1) * 10,
    ])
    trackIds.set(title, id)
  }

  const pools = [
    ['江防粮米', 'material', 'scarce', '账面可拨，实仓不足', '石', '建康、镇江、明州船运与地方仓', '每次军令必须说明消耗去向', '军心散、流民围仓、前线停战', '建康粮火与岳飞请粮'],
    ['江船与熟水船户', 'logistics', 'strained', '船可征，人心难征', '艘/户', '沿江船户、镇江水军、明州海路', '征船需补偿，损船要入账', '船户逃散，江防无法复用', '黄天荡折损与不撤船命令'],
    ['朝廷信任额度', 'political', 'fragile', '每次放权都消耗旧案阴影下的信任', '批答/诏令', '真实战报、可核粮册、军纪执行', '给名必须配约束，收权必须配供给', '韩岳离心或文臣借旧案压死战果', '赏功与制将矛盾'],
  ]
  const poolIds = new Map()
  for (const [name, poolType, scarcityLevel, currentReserve, unit, replenishPath, consumptionRule, failureCost, pressureSource] of pools) {
    const id = ensureByNovelTitle(db, 'resource_pools', 'name', novelId, name, `
      INSERT INTO resource_pools (
        novel_id, name, pool_type, scarcity_level, current_reserve, unit, replenish_path, consumption_rule,
        failure_cost, pressure_source, linked_volume_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [novelId, name, poolType, scarcityLevel, currentReserve, unit, replenishPath, consumptionRule, failureCost, pressureSource, volumeId, '《淮上新旌》资源压力回填'])
    poolIds.set(name, id)
  }

  const events = [
    [1, 'cost', '止撤船消耗皇帝安全感', '赵构不撤韩世忠船，换来主动应战，也把自己暴露在再次失败的问责里。', '赵构：从撤船惯性到制度制将', '朝廷信任额度', '-1撤退余地', 'ongoing', 'partial', '下一封战报必须证明这不是鲁莽。'],
    [3, 'reward_cost', '黄天荡败中有功', '韩世忠拖住金军但损船折兵，功劳和亏损必须同时入账。', '韩世忠：败中有功的信用账', '江船与熟水船户', '+信用/-船户', 'ongoing', 'partial', '如何公开战报。'],
    [5, 'cost', '建康粮仓冲突', '收复后的第一笔账不是赏功，而是开仓、封仓与军纪之间的冲突。', '江防粮饷：从临时征调到可核账', '江防粮米', '-可支配粮', 'new', 'none', '朝廷必须建立核粮规则。'],
    [9, 'reward_cost', '韩岳双请并案', '岳飞要甲粮、韩世忠要江防稳定，二者同时逼近赵构御案。', '赵构：从撤船惯性到制度制将', '朝廷信任额度', '+制度压力', 'ongoing', 'partial', '第10章必须给制度答复。'],
  ]
  for (const [chapterNum, eventType, title, summary, trackTitle, poolName, deltaValue, costResolutionState, rewardLevel, nextBottleneck] of events) {
    const existing = db.prepare('SELECT id FROM reward_cost_events WHERE novel_id = ? AND title = ?').get(novelId, title)
    if (existing) continue
    db.prepare(`
      INSERT INTO reward_cost_events (
        novel_id, chapter_id, chapter_num_snapshot, event_type, title, summary, track_id, resource_pool_id,
        delta_value, cost_resolution_state, reward_level, next_bottleneck, linked_volume_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      novelId,
      ids.chapters.get(chapterNum) || null,
      chapterNum,
      eventType,
      title,
      summary,
      trackIds.get(trackTitle) || null,
      poolIds.get(poolName) || null,
      deltaValue,
      costResolutionState,
      rewardLevel,
      nextBottleneck,
      volumeId,
    )
  }

  return { trackIds, poolIds }
}

function backfillArcsAndResistance(db, novelId, ids) {
  const arcIds = []
  const characterArcs = [
    ['赵构', {
      startState: '海上回銮后仍以撤船和猜疑作为本能反应。',
      surfaceWant: '稳住行在，避免再一次被金军和武将逼到绝境。',
      deepNeed: '学会用制度承认恐惧，而不是用逃避掩盖恐惧。',
      coreFear: '苗刘旧案重演，或江南最后一道防线被自己误判葬送。',
      misbelief: '只要不彻底放权，就能保住皇权安全。',
      firstCrackChapterId: ids.chapters.get(1),
      changeEvent: '第1章不撤韩世忠船，第3章公开完整战报，第10章把制将写成军约。',
      endState: '仍有猜忌，但能把猜忌约束在粮册、军纪和江防目标里。',
      lastProgressChapterId: ids.chapters.get(4),
      notes: '核心人物弧：创伤不消失，创伤被制度化。',
    }],
    ['韩世忠', {
      startState: '以血勇和战场直觉拦江，尚未被朝廷完全接纳为制度资产。',
      surfaceWant: '拖住完颜宗弼并获得朝廷承认。',
      deepNeed: '让朝廷相信真实战报比漂亮捷报更有用。',
      coreFear: '战场折损被朝堂粉饰或反过来变成问罪借口。',
      misbelief: '打得够狠，朝廷自然会懂。',
      firstCrackChapterId: ids.chapters.get(3),
      changeEvent: '黄天荡火攻突围后，梁氏请罪札让败处也成为信用。',
      endState: '以完整战报和忠勇旗进入江防制度。',
      lastProgressChapterId: ids.chapters.get(3),
      notes: '败中有功线。',
    }],
    ['岳飞', {
      startState: '战术能力被看见，但朝廷尚未把他视为可托制度的人。',
      surfaceWant: '收复建康并请求继续北向所需粮甲。',
      deepNeed: '让军纪、民心和粮饷成为战功的一部分。',
      coreFear: '收复后的宋军也被百姓视作过境之兵。',
      misbelief: '只要军纪够严，朝廷自然会理解请粮请甲。',
      firstCrackChapterId: ids.chapters.get(4),
      changeEvent: '牛头山收复和建康粮火把战功转为治理题。',
      endState: '获得有条件的粮甲和制度约束。',
      lastProgressChapterId: ids.chapters.get(4),
      notes: '从战术奇兵到制度内名将的第一步。',
    }],
    ['张浚', {
      startState: '主战文臣，善于把危机推成方案，但容易过猛。',
      surfaceWant: '用韩岳战果推动江防整编。',
      deepNeed: '把冒险翻译成皇帝和朝堂能承受的制度文本。',
      coreFear: '皇帝退缩，武将离心，文臣只会收权却不供粮。',
      misbelief: '只要方案够完整，各方就会接受。',
      firstCrackChapterId: ids.chapters.get(6),
      changeEvent: '建康粮火后，他必须把核粮、赏功和制将同案处理。',
      endState: '成为新旌军约的制度桥梁。',
      lastProgressChapterId: ids.chapters.get(4),
      notes: '文臣制将线。',
    }],
    ['完颜宗弼', {
      startState: '长驱直入后的北还统帅，仍以骑兵威势判断宋廷会继续退。',
      surfaceWant: '带军北还并保住威势。',
      deepNeed: '重新估量长江水网和宋军新将领的约束力。',
      coreFear: '被拖入陌生水网耗尽军心和马力。',
      misbelief: '宋廷猜忌会比宋军战力更早摧毁江防。',
      firstCrackChapterId: ids.chapters.get(3),
      changeEvent: '黄天荡和牛头山让他承认南宋并非只能逃。',
      endState: '北还但留下下一轮南侵压力。',
      lastProgressChapterId: ids.chapters.get(4),
      notes: '外部压力持续线。',
    }],
  ]
  for (const [name, data] of characterArcs) {
    const characterId = ids.characters.get(name)
    if (!characterId) continue
    const arcId = ensureCharacterArc(db, novelId, characterId, data)
    arcIds.push(arcId)
    ensureCharacterArcBeat(db, novelId, arcId, `${name}弧线起点`, {
      beatType: 'setup',
      chapterId: data.firstCrackChapterId || ids.chapters.get(1),
      summary: data.startState,
      status: 'logged',
      sortOrder: 10,
    })
    ensureCharacterArcBeat(db, novelId, arcId, `${name}第十章目标`, {
      beatType: 'payoff',
      chapterId: ids.chapters.get(10),
      summary: data.endState,
      status: 'planned',
      sortOrder: 20,
    })
  }

  const relationArcIds = [
    ensureRelationshipArc(db, novelId, ids.characters.get('赵构'), ids.characters.get('张浚'), {
      relationLabelSnapshot: '君臣互用',
      relationTypeSnapshot: 'political',
      startState: '张浚敢犯忌进言，赵构需要他但防其过猛。',
      crackPoint: '第6章江防新议中，张浚必须把放权写成制衡。',
      changeEvent: '第10章赵构采纳草案但亲自改字。',
      endState: '短暂形成“皇帝拍板、文臣承压”的合作。',
      lastProgressChapterId: ids.chapters.get(4),
      notes: '主制度关系线。',
    }),
    ensureRelationshipArc(db, novelId, ids.characters.get('赵构'), ids.characters.get('韩世忠'), {
      relationLabelSnapshot: '功臣与疑主',
      relationTypeSnapshot: 'military-political',
      startState: '韩世忠救局有功，赵构却被苗刘旧案牵制。',
      crackPoint: '黄天荡败中有功如何定性。',
      changeEvent: '公开完整战报并赐忠勇。',
      endState: '以真实战报换取有限信任。',
      lastProgressChapterId: ids.chapters.get(3),
      notes: '赏功与问责并行。',
    }),
    ensureRelationshipArc(db, novelId, ids.characters.get('赵构'), ids.characters.get('岳飞'), {
      relationLabelSnapshot: '待用新将',
      relationTypeSnapshot: 'military-political',
      startState: '赵构只从战报中看见岳飞，尚未形成稳定信任。',
      crackPoint: '建康粮火证明岳飞既能战也能治军。',
      changeEvent: '岳飞请粮请甲被纳入新旌军约。',
      endState: '给资源，也给约束。',
      lastProgressChapterId: ids.chapters.get(4),
      notes: '岳飞进入朝廷制度视野。',
    }),
    ensureRelationshipArc(db, novelId, ids.characters.get('韩世忠'), ids.characters.get('完颜宗弼'), {
      relationLabelSnapshot: '江面困敌',
      relationTypeSnapshot: 'enemy',
      startState: '完颜宗弼北还，韩世忠拦江。',
      crackPoint: '凿渠火攻突围。',
      changeEvent: '双方都承认对方不是传言里的蠢敌。',
      endState: '金军脱身但南宋江防名声立住。',
      lastProgressChapterId: ids.chapters.get(3),
      notes: '外战压力线。',
    }),
  ].filter(Boolean)

  const volumeId = ids.volumes.get(1) || null
  const resistanceTrackIds = [
    ensureResistanceTrack(db, novelId, '金军北还后的二次压力', {
      sourceType: 'character',
      sourceId: ids.characters.get('完颜宗弼'),
      resistanceKind: 'antagonist',
      goal: '保住金军北还威势，寻找宋军江防新缝隙。',
      intelSource: '黄天荡火攻突围、建康方向斥候、沿江船户口供。',
      resourcePool: '马力、船只、战利品、军心。',
      escalationPlan: '第7章北顾重整，第10章作为未解除压力留到下一卷。',
      heroKnowledgeShift: '赵构意识到北还不是太平，必须定江防而非庆功。',
      stageVictory: '金军脱身但威慑受损。',
      counterMove: '利用宋廷内部猜忌等待下一次南下。',
      currentPressureMode: '外部军事压力',
      lastActionChapterId: ids.chapters.get(4),
      nextEscalationChapterId: ids.chapters.get(7),
      linkedVolumeId: volumeId,
    }),
    ensureResistanceTrack(db, novelId, '文臣收权惯性', {
      sourceType: 'faction',
      sourceId: null,
      resistanceKind: 'institutional',
      goal: '以苗刘旧案为据，要求先收兵权再谈给粮给名。',
      intelSource: '言官奏疏、朝堂争议、旧案卷。',
      resourcePool: '舆论、礼法、问责权。',
      escalationPlan: '第6章形成朝堂压力，第9章韩岳双请时升级。',
      heroKnowledgeShift: '赵构必须找到“制将而非弃将”的中间道路。',
      stageVictory: '阻止无条件放权。',
      counterMove: '要求每一笔粮甲都绑定核籍和军纪。',
      currentPressureMode: '政治制衡压力',
      lastActionChapterId: ids.chapters.get(1),
      nextEscalationChapterId: ids.chapters.get(6),
      linkedVolumeId: volumeId,
    }),
    ensureResistanceTrack(db, novelId, '建康粮仓与豪强囤粮', {
      sourceType: 'location',
      sourceId: ids.maps.get('建康牛头山'),
      resistanceKind: 'resource',
      goal: '用粮仓冲突迫使胜利转入治理。',
      intelSource: '建康旧官、流民口供、岳飞军帖。',
      resourcePool: '粮米、仓钥、旧官账册、地方豪强。',
      escalationPlan: '第5章爆发，第6章转化为江防核粮议题。',
      heroKnowledgeShift: '赵构看见战功后面还有治理成本。',
      stageVictory: '军纪压住私取，旧官被迫交册。',
      counterMove: '豪强改走拖延和虚报路线。',
      currentPressureMode: '治理资源压力',
      lastActionChapterId: ids.chapters.get(4),
      nextEscalationChapterId: ids.chapters.get(5),
      linkedVolumeId: volumeId,
    }),
  ]

  ensureResistanceBeat(db, novelId, resistanceTrackIds[0], '黄天荡未能全歼', {
    chapterId: ids.chapters.get(3),
    summary: '完颜宗弼凿渠火攻突围，证明外部压力仍在。',
    actionMode: '突围',
    successLevel: 'partial',
    counterResponse: '宋廷必须承认败中有功。',
    protagonistImpact: '赵构不能把战报写成纯捷报。',
    sortOrder: 10,
  })
  ensureResistanceBeat(db, novelId, resistanceTrackIds[1], '言官借旧案压放权', {
    chapterId: ids.chapters.get(6),
    summary: '朝堂要求先收权，逼张浚把放权写成可核制度。',
    actionMode: '奏疏',
    successLevel: 'partial',
    counterResponse: '江防新议必须有核粮和节制。',
    protagonistImpact: '赵构看见猜忌不能直接替代制度。',
    sortOrder: 20,
  })
  ensureResistanceBeat(db, novelId, resistanceTrackIds[2], '粮仓围堵', {
    chapterId: ids.chapters.get(5),
    summary: '流民、豪强、旧官和宋军围绕粮仓冲突，岳飞军纪被迫落地。',
    actionMode: '资源挤压',
    successLevel: 'contested',
    counterResponse: '赵构要求核粮，不再只看捷报。',
    protagonistImpact: '胜利后的治理压力进入御案。',
    sortOrder: 30,
  })

  return { arcIds, relationArcIds, resistanceTrackIds }
}

function backfillSceneContracts(db, novelId, ids, refs) {
  for (const chapterNum of Array.from({ length: 10 }, (_, index) => index + 1)) {
    const chapterId = ids.chapters.get(chapterNum)
    if (!chapterId) continue
    const existing = db.prepare('SELECT id FROM scene_contracts WHERE novel_id = ? AND chapter_id = ? LIMIT 1').get(novelId, chapterId)
    if (existing) continue
    const segment = db.prepare('SELECT id FROM chapter_segments WHERE novel_id = ? AND chapter_id = ? ORDER BY segment_order, id LIMIT 1').get(novelId, chapterId)
    const location = chapterNum <= 1 ? '越州行在' : chapterNum <= 3 ? '黄天荡/金山' : chapterNum <= 5 ? '建康' : '越州行在'
    db.prepare(`
      INSERT INTO scene_contracts (
        novel_id, chapter_id, segment_id, pov, time_location, scene_goal, obstacle, conflict_type,
        emotion_shift, reveal_payload_json, result_state, linkage_mode, required_endgame_commitment_ids_json,
        required_foreshadow_ids_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
    `).run(
      novelId,
      chapterId,
      segment?.id || null,
      chapterNum <= 1 || chapterNum >= 6 ? '赵构限制视角为主' : chapterNum <= 3 ? '韩世忠/完颜宗弼交替限制视角' : '岳飞限制视角为主',
      `建炎四年·第${chapterNum}章·${location}`,
      `执行第${chapterNum}章主目标，必须让制度/资源/关系至少一项发生变化。`,
      '史实边界、传报延迟、粮饷不足、朝堂猜忌或战场损耗。',
      chapterNum <= 4 ? 'military' : chapterNum <= 8 ? 'political-resource' : 'institutional-payoff',
      '从压力进入选择，再留下未完全解决的代价。',
      toJson([...refs.factIds.keys()].slice(0, 6)),
      '场景结束时必须留下下一场可承接的军令、账册、信使、札子或未答复问题。',
      '因果接力',
      toJson([...refs.commitmentIds.values()]),
      toJson([...refs.foreshadowIds.values()]),
    )
  }
}

function backfillMemoryAndTemplates(db, novelId, ids) {
  const checkpoints = [
    ['volume', ids.volumes.get(1), '第一卷核心记忆', '海上回銮后，赵构不再简单撤船；黄天荡和牛头山提供战功，也暴露损耗、粮饷和制将压力。第5章起必须把胜利转为治理题。', 1, 4],
    ['thread', ids.threads.get('赏功与制将的制度矛盾'), '制将线记忆', '赵构怕武将坐大，但前线没有粮甲和名分便无法继续。后续每次赏功必须绑定核粮、军纪和江防目标。', 1, 10],
  ]
  for (const [scopeType, scopeId, label, summary, start, end] of checkpoints) {
    const existing = db.prepare('SELECT id FROM story_memory_checkpoints WHERE novel_id = ? AND scope_type = ? AND COALESCE(scope_id, 0) = COALESCE(?, 0) AND label = ?').get(novelId, scopeType, scopeId || null, label)
    if (existing) continue
    db.prepare(`
      INSERT INTO story_memory_checkpoints (
        novel_id, scope_type, scope_id, label, summary, resolved_threads_json, active_threads_json,
        character_state_digest, relation_digest, item_digest, timeline_digest, forbidden_directions_json,
        style_guard, source_range_start, source_range_end, version, stale, last_refreshed_chapter_num, locked,
        character_cards_json, relation_cards_json, item_cards_json, timeline_cards_json, thread_cards_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      novelId,
      scopeType,
      scopeId || null,
      label,
      summary,
      '[]',
      toJson([...ids.threads.keys()]),
      '赵构创伤仍在；韩世忠败中有功；岳飞军纪进入视野；张浚开始把战功翻译成制度。',
      '赵构-韩世忠：功臣与疑主；赵构-岳飞：待用新将；赵构-张浚：君臣互用。',
      '苗刘旧案卷、忠勇御书旗、黄天荡江图、牛头山军帖都必须继续服务制度线。',
      '第1-4章完成史实锚点，第5-10章进入治理和军约。',
      toJson(['不得把赵构洗成无创伤明君', '不得把黄天荡写成无损大捷', '不得把岳飞写成无资源约束战神']),
      '冷峻、克制、动作和账册先于情绪；每章同类气氛意象最多两组。',
      start,
      end,
      end,
      toJson([...ids.characters.entries()].map(([name, id]) => ({ id, name }))),
      '[]',
      toJson([...ids.items.entries()].map(([name, id]) => ({ id, name }))),
      '[]',
      toJson([...ids.threads.entries()].map(([title, id]) => ({ id, title }))),
    )
  }

  const templates = [
    ['御前改字', 'political', '皇帝面对两份矛盾材料，在奏疏或诏令上改一个关键字，引发制度后果。', ['来报/旧案触发', '文臣陈利害', '赵构改字', '内侍或中书复核', '下一章前线承受后果'], ['赵构', '张浚'], '克制、压迫、留白'],
    ['战报入账', 'military', '前线胜败不以口号定性，而以阵亡册、箭耗、船损、粮余进入朝廷。', ['战场余波', '清点损耗', '是否粉饰的争执', '实报或瞒报选择', '朝廷反应'], ['韩世忠', '梁氏', '张浚'], '惨烈、冷硬'],
    ['粮仓冲突', 'resource', '胜后治理场景：流民、旧官、豪强、军队围绕粮仓各有诉求。', ['封条/钥匙', '四方诉求', '军纪试探', '账册暴露漏洞', '制度化回收'], ['岳飞', '流民代表', '旧官'], '躁动、克制'],
    ['言官制将', 'court', '文臣用旧案和礼法要求收权，主战派必须把放权包装成制衡。', ['言官奏事', '旧案压场', '主战反驳', '皇帝追问代价', '形成新条款'], ['赵构', '张浚', '言官'], '锋利、压抑'],
    ['敌军北顾', 'antagonist', '从金军视角写强敌现实计算，避免脸谱化。', ['路线和军心', '失败处复盘', '寻找宋军缝隙', '留下下轮压力'], ['完颜宗弼'], '冷静、威胁未消'],
    ['军约落地', 'payoff', '把前文战报、粮册、旧案和军帖收束成可执行条款。', ['列出旧账', '逐条改字', '各方让步', '旗/军约送出', '未解决压力留下'], ['赵构', '张浚', '韩世忠', '岳飞'], '克制燃起'],
  ]
  templates.forEach(([name, category, description, beats, roles, emotionArc], index) => {
    ensureSceneTemplate(db, novelId, name, {
      category,
      description,
      typicalBeats: beats,
      suggestedCharacterRoles: roles,
      emotionArc,
      sortOrder: (index + 1) * 10,
    })
  })
}

function updateThreadsAndFactions(db, novelId, ids) {
  db.prepare(`
    UPDATE story_threads
    SET current_state = CASE
      WHEN title = '赵构能否停止无底线撤退' THEN '第1章已止撤船，第10章必须把止撤从个人决定变成江防条款。'
      WHEN title = '韩世忠黄天荡败中有功' THEN '第3章完成败中有功；后续必须把完整战报回收到新旌军约。'
      WHEN title = '岳飞牛头山初显锋芒' THEN '第4章完成战功进入视野；第5章粮仓、第9章请粮、第10章拨付是后续兑现。'
      WHEN title = '赏功与制将的制度矛盾' THEN '主制度线进入第5-10章：每次赏功都必须绑定核粮、军纪和目标。'
      ELSE current_state END,
      last_referenced_chapter = CASE
      WHEN title IN ('赵构能否停止无底线撤退', '赏功与制将的制度矛盾') THEN 4
      WHEN title = '韩世忠黄天荡败中有功' THEN 3
      WHEN title = '岳飞牛头山初显锋芒' THEN 4
      ELSE last_referenced_chapter END,
      updated_at = CURRENT_TIMESTAMP
    WHERE novel_id = ?
  `).run(novelId)

  const factionUpdates = [
    ['南宋行在', '以赵构和张浚为核心，目标从单纯避敌转为建立可核账、可赏功、可制将的江防框架。', '诏令、邸报、户部账册、御笔批答、沿江粮船。', '第5-10章进入军约成形阶段', toJson([{ target: '韩世忠水军', stance: '依赖且猜疑' }, { target: '岳飞部', stance: '试用并约束' }, { target: '金军南路', stance: '阶段挡住但压力未消' }])],
    ['韩世忠水军', '用黄天荡拖住金军北还，并用真实战报换取江防信用。', '海舟、熟水船户、铁绠钩、阵亡册、梁氏军中调度。', '败中有功等待制度回收', toJson([{ target: '南宋行在', stance: '要赏也要补船粮' }, { target: '金军南路', stance: '江面死敌' }])],
    ['岳飞部', '以牛头山和建康军纪证明自己不只是能战，也能收束胜后秩序。', '步骑疲兵、军帖、建康粮仓民心、请粮札子。', '第5章粮火和第9章请粮待兑现', toJson([{ target: '南宋行在', stance: '需要粮甲和名分' }, { target: '建康地方豪强', stance: '军纪压制' }])],
    ['金军南路', '北还不代表失败出局，目标是保存威势、寻找下一次南下机会。', '马力、战利品、残余船队、斥候情报。', '北顾重整，外压延续', toJson([{ target: '韩世忠水军', stance: '水路受挫' }, { target: '岳飞部', stance: '建康退路受阻' }])],
  ]
  for (const [name, goal, resources, phase, relations] of factionUpdates) {
    db.prepare(`
      UPDATE factions
      SET goal = ?, resources = ?, current_phase = ?, external_relations_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE novel_id = ? AND name = ?
    `).run(goal, resources, phase, relations, novelId, name)
  }
}

async function main() {
  await app.whenReady()
  const dbPath = path.join(app.getPath('userData'), 'novelforge.db')
  const backups = backupDatabaseFiles(dbPath)
  const { initDb, getSqlite, closeDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const db = getSqlite()

  const novel = db.prepare("SELECT * FROM novels WHERE title = '淮上新旌' ORDER BY id DESC LIMIT 1").get()
  if (!novel) {
    throw new Error('未找到《淮上新旌》，未执行回填。')
  }
  const novelId = novel.id

  const result = db.transaction(() => {
    updateNovelDocuments(db, novel)
    let ids = buildMaps(db, novelId)
    backfillCharacters(db, novelId, ids)
    const arcId = backfillStoryArc(db, novelId)
    db.prepare('UPDATE timeline_events SET arc_id = COALESCE(arc_id, ?) WHERE novel_id = ?').run(arcId, novelId)
    ids = buildMaps(db, novelId)
    const refs = backfillFactsCommitmentsAndForeshadow(db, novelId, ids)
    backfillVolumeDesign(db, novelId, ids, refs)
    const arcRefs = backfillArcsAndResistance(db, novelId, ids)
    const growthRefs = backfillGrowthAndResources(db, novelId, ids)
    backfillChapterPlans(db, novelId, ids, refs, arcRefs.relationArcIds, arcRefs.resistanceTrackIds)
    backfillSceneContracts(db, novelId, ids, refs)
    backfillMemoryAndTemplates(db, novelId, ids)
    updateThreadsAndFactions(db, novelId, ids)

    return {
      novelId,
      facts: db.prepare('SELECT COUNT(*) AS count FROM story_facts WHERE novel_id = ?').get(novelId).count,
      commitments: db.prepare('SELECT COUNT(*) AS count FROM endgame_commitments WHERE novel_id = ?').get(novelId).count,
      foreshadows: db.prepare('SELECT COUNT(*) AS count FROM foreshadow_ledger WHERE novel_id = ?').get(novelId).count,
      chapterContracts: db.prepare('SELECT COUNT(*) AS count FROM chapter_contracts WHERE novel_id = ?').get(novelId).count,
      sceneContracts: db.prepare('SELECT COUNT(*) AS count FROM scene_contracts WHERE novel_id = ?').get(novelId).count,
      characterArcs: db.prepare('SELECT COUNT(*) AS count FROM character_arcs WHERE novel_id = ?').get(novelId).count,
      resistanceTracks: db.prepare('SELECT COUNT(*) AS count FROM resistance_tracks WHERE novel_id = ?').get(novelId).count,
      growthTracks: db.prepare('SELECT COUNT(*) AS count FROM growth_tracks WHERE novel_id = ?').get(novelId).count,
      resourcePools: db.prepare('SELECT COUNT(*) AS count FROM resource_pools WHERE novel_id = ?').get(novelId).count,
      sceneTemplates: db.prepare('SELECT COUNT(*) AS count FROM scene_templates WHERE novel_id = ?').get(novelId).count,
      growthTrackIds: [...growthRefs.trackIds.values()],
    }
  })()

  console.log(JSON.stringify({ backups, ...result }, null, 2))
  closeDb()
  app.quit()
}

main().catch((error) => {
  console.error(error)
  setTimeout(() => {
    app.quit()
    process.exit(1)
  }, 100)
})
