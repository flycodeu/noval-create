// 真实流水线版小说 AI 生成评测：
// 1. 大纲拆两批生成（1-5 / 6-10 章），避免长 JSON 后段偷懒
// 2. scenePlan 空缺定向补全
// 3. 前 N 章正文走生产链路 generateChapterContent（含合同校验、审校、anti-ai 强制修复、发布门）
// 4. 章节长度只做结果观察，不按目标值自动扩写
// 5. 残留高危 AI 味自动带命中片段发起补救重写
// 6. 违禁桥段正则扫描
//
// 运行方式（必须用 Electron，better-sqlite3 为 Electron ABI）：
//   npx electron scripts/run-novel-ai-eval-pipeline.cjs
// 环境变量：
//   NOVELFORGE_EVAL_PROJECTS=steel,doupo   只跑指定项目
//   NOVELFORGE_EVAL_RUN_STAMP=xxx          指定输出目录
//   NOVELFORGE_EVAL_CONTENT_CHAPTERS=2     生成正文的章数
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))
const Database = require('better-sqlite3')

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  }
  if (request.startsWith('@main/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  }
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

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

const OUT_ROOT = path.resolve(workspaceRoot, 'out', 'novel-ai-eval-pipeline')
const CONTENT_CHAPTER_COUNT = Math.max(1, Math.min(10, Number(process.env.NOVELFORGE_EVAL_CONTENT_CHAPTERS) || 2))
const CHAPTER_TARGET_WORDS = 1200
const PROJECT_FILTER = new Set(
  String(process.env.NOVELFORGE_EVAL_PROJECTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)

const PROJECTS = [
  {
    key: 'steel',
    baseTitle: '钢铁是怎么炼成的',
    savedTitlePrefix: 'AI流水线测试｜钢铁是怎么炼成的',
    genreName: '历史正剧',
    targetWords: 180000,
    tabooPatterns: [
      '保尔|柯察金|冬妮娅|朱赫来|丽达|谢廖沙',
      '筑路.{0,6}博亚尔卡',
    ],
    benchmark: [
      '原作是革命成长/精神锻造叙事，重心在个人苦难如何被组织、时代目标和劳动纪律重塑。',
      '测试只取主题与结构压力，不复刻原著人物、具体事件、译文和场景。',
    ],
    input: {
      theme: '苦难中的自我锻造、集体信念、劳动与时代责任',
      protagonistStart: '一个来自边缘工矿家庭的年轻维修学徒，冲动、自尊强，但缺乏稳定方向。',
      coreHook: '主角在一次事故后失去继续当一线工人的资格，却被迫转向记录、组织和技术教育工作。',
      coreConflict: '个人伤病、失去和时代任务之间不断冲突；主角必须证明价值不只来自体力和战场。',
      tabooRules: '不得复刻原著人物姓名、具体战役、经典台词或译文；不得写成口号堆砌。',
    },
  },
  {
    key: 'doupo',
    baseTitle: '斗破苍穹',
    savedTitlePrefix: 'AI流水线测试｜斗破苍穹',
    genreName: '玄幻修真',
    targetWords: 300000,
    tabooPatterns: [
      '萧炎|药老|药尘|纳兰嫣然|萧薰儿|斗气大陆|异火|焚决',
      '退婚',
      '婚约.{0,6}(作废|解除|取消)',
      '[一二三两四五六七八九十0-9]+(?:个)?(?:年|月)之约',
    ],
    benchmark: [
      '原作是升级爽文，核心体验是天赋跌落、羞辱压力、师承机缘、修炼体系和阶段性兑现。',
      '测试只取类型机制和读者承诺，不复刻原作人物、专有名词、具体设定和标志性桥段。',
    ],
    input: {
      theme: '从废弃天赋到重新掌握命运，成长必须付出代价',
      protagonistStart: '一个曾被家族寄予厚望的少年突然失去修炼感应，被视为拖累。',
      coreHook: '一枚残损古器在他最狼狈时回应，但每次借力都会留下身体和人际代价。',
      coreConflict: '家族资源、宗门名额和隐藏导师的代价形成连续压迫。',
      tabooRules: '不得使用原作人物姓名、斗气大陆、异火、药老等专名；不得写退婚戏或任何"N年之约/N月之约"式期限婚约桥段。',
    },
  },
]

// 模型偶发在 JSON 字符串里输出未转义控制字符（裸换行/制表符），逐字符转义修复后再解析
function escapeControlCharsInJsonStrings(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch === '"') {
        out += ch
        inString = false
        continue
      }
      if (code < 0x20) {
        out += code === 10 ? '\\n' : code === 9 ? '\\t' : code === 13 ? '\\r' : ''
        continue
      }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out
}

function tryParseJson(source) {
  try {
    return JSON.parse(source)
  } catch {
    return JSON.parse(escapeControlCharsInJsonStrings(source))
  }
}

function extractJson(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('AI output is empty')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced ? fenced[1].trim() : text
  try {
    return tryParseJson(source)
  } catch {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return tryParseJson(source.slice(start, end + 1))
    throw new Error(`Cannot parse AI JSON: ${source.slice(0, 240)}`)
  }
}

function requiredString(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

function nowIso() {
  return new Date().toISOString()
}

const CHAPTER_SCHEMA = {
  chapterNum: 1,
  title: 'string（纯章节名，不要带"第X章"前缀，不要带"（大纲）"后缀）',
  outline: 'string（120-240字，必须包含：目标、冲突、转折、退出钩子）',
  chapterGoal: 'string',
  scenePlan: [
    {
      sceneTitle: 'string',
      purpose: 'string',
      location: 'string',
      conflict: 'string',
      exitHook: 'string',
    },
  ],
  summary: 'string',
  nextSeed: 'string',
  emotionTone: 'string',
}

function buildScaffoldSystemPrompt() {
  return [
    '你是 NovelForge 的小说项目生成器。',
    '必须生成原创内容，不能复刻、续写、改写或模仿任何在版权保护期内作品的具体表达、专名、人物关系、章节桥段或标志性场景。',
    '所有章节都不生成正文，只生成结构化设计。',
    '只输出一个 JSON 对象，不要 Markdown，不要解释。',
  ].join('\n')
}

function buildScaffoldPromptA(project) {
  return [
    { role: 'system', content: buildScaffoldSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        task: '基于对照作品的主题/类型压力，生成一个原创小说项目底盘和第 1-5 章设计。',
        sourceTitleForComparisonOnly: project.baseTitle,
        benchmark: project.benchmark,
        input: project.input,
        requirements: [
          '项目标题必须体现是 AI 原创对照测试版。',
          '本次只生成第 1 到 5 章，每章都必须有 2-4 个 scenePlan 场景，一个都不能省略。',
          '每章大纲必须包含目标、冲突、转折、退出钩子。',
          `严格遵守违禁约束：${project.input.tabooRules}`,
        ],
        outputSchema: {
          project: { title: 'string', synopsis: 'string', userBackground: 'string', expandedBackground: 'string' },
          projectBrief: { premise: 'string', targetReader: 'string', sellingPoints: ['string'], coreEmotion: 'string', constraints: ['string'] },
          settings: {
            premise: { positioning: 'string', coreHook: 'string', protagonistStart: 'string', constraints: 'string' },
            storyGoal: 'string',
            coreConflict: 'string',
            mainPlot: 'string',
            ending: 'string',
          },
          themeVoice: { theme: 'string', emotionalCore: 'string', pov: 'string', tense: 'string', styleRules: 'string', dialogueRules: 'string' },
          worldRules: { summary: 'string', sections: [{ key: 'string', title: 'string', content: 'string' }] },
          characters: [{ fullName: 'string', roleType: 'protagonist|antagonist|major|supporting', background: 'string', goals: 'string', flaws: ['string'], traits: ['string'], arc: 'string' }],
          arc: { name: 'string', goal: 'string', summary: 'string' },
          volume: { title: 'string', summary: 'string' },
          chapters: [CHAPTER_SCHEMA],
        },
      }, null, 2),
    },
  ]
}

function buildScaffoldPromptB(project, phase1) {
  const context = {
    title: phase1.project.title,
    synopsis: phase1.project.synopsis,
    storyGoal: phase1.settings?.storyGoal || '',
    coreConflict: phase1.settings?.coreConflict || '',
    characters: asArray(phase1.characters).map((item) => `${item.fullName}（${item.roleType}）：${item.goals || ''}`),
    previousChapters: asArray(phase1.chapters).map((chapter) => ({
      chapterNum: chapter.chapterNum,
      title: chapter.title,
      outline: chapter.outline,
      nextSeed: chapter.nextSeed,
    })),
  }
  return [
    { role: 'system', content: buildScaffoldSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        task: '继续为同一个原创小说项目生成第 6-10 章设计，保持与前 5 章连续。',
        projectContext: context,
        requirements: [
          '只生成第 6 到 10 章，每章都必须有 2-4 个 scenePlan 场景，一个都不能省略。',
          '每章大纲必须包含目标、冲突、转折、退出钩子。',
          '第 6 章必须自然承接第 5 章的 nextSeed。',
          `严格遵守违禁约束：${project.input.tabooRules}`,
        ],
        outputSchema: { chapters: [{ ...CHAPTER_SCHEMA, chapterNum: 6 }] },
      }, null, 2),
    },
  ]
}

function buildScenePlanBackfillPrompt(project, phase1, missingChapters) {
  return [
    { role: 'system', content: buildScaffoldSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        task: '为下列章节补全 scenePlan 场景计划，每章 2-4 个场景。',
        projectTitle: phase1.project.title,
        chapters: missingChapters.map((chapter) => ({
          chapterNum: chapter.chapterNum,
          title: chapter.title,
          outline: chapter.outline,
          chapterGoal: chapter.chapterGoal,
        })),
        requirements: [`严格遵守违禁约束：${project.input.tabooRules}`],
        outputSchema: {
          chapters: [{
            chapterNum: 1,
            scenePlan: [{ sceneTitle: 'string', purpose: 'string', location: 'string', conflict: 'string', exitHook: 'string' }],
          }],
        },
      }, null, 2),
    },
  ]
}

function normalizeChapter(chapter, index, fallbackNum) {
  const num = Number(chapter?.chapterNum) || fallbackNum + index
  return {
    chapterNum: num,
    title: requiredString(chapter?.title, `第${num}章`)
      .replace(/^第[一二三四五六七八九十0-9]+章[·：:\s]*/u, '')
      .replace(/[（(]大纲[)）]\s*$/u, '')
      .trim() || `第${num}章`,
    outline: requiredString(chapter?.outline, '目标、冲突、转折和退出钩子待补。'),
    chapterGoal: requiredString(chapter?.chapterGoal, '推进主线并留下下一章钩子。'),
    scenePlan: asArray(chapter?.scenePlan).slice(0, 4),
    summary: requiredString(chapter?.summary, ''),
    nextSeed: requiredString(chapter?.nextSeed, ''),
    emotionTone: requiredString(chapter?.emotionTone, '推进'),
  }
}

function scanTaboo(text, tabooPatterns) {
  const hits = []
  for (const pattern of tabooPatterns) {
    const regex = new RegExp(pattern, 'gu')
    const matches = String(text || '').match(regex)
    if (matches && matches.length > 0) {
      hits.push({ pattern, matches: [...new Set(matches)].slice(0, 5) })
    }
  }
  return hits
}

function getGenreId(db, name) {
  const row = db.prepare('SELECT id FROM genres WHERE name = ? ORDER BY id LIMIT 1').get(name)
  if (row?.id) return row.id
  const fallback = db.prepare('SELECT id FROM genres ORDER BY id LIMIT 1').get()
  if (!fallback?.id) throw new Error('No genres found in database')
  return fallback.id
}

function safeJson(value, fallback = {}) {
  return JSON.stringify(value && typeof value === 'object' ? value : fallback)
}

function insertScaffold(db, project, generated, modelConfigId, runStamp) {
  const ts2 = nowIso()
  const genreId = getGenreId(db, project.genreName)
  const savedTitle = `${project.savedTitlePrefix}（流水线版 ${runStamp}）`

  const novelResult = db.prepare(`
    INSERT INTO novels (
      title, synopsis, genre_id, launch_mode, status, total_words, target_words,
      user_background, expanded_background, project_brief_json, settings_json,
      theme_voice_json, world_rules_json, model_config_id, context_version, created_at, updated_at
    ) VALUES (
      @title, @synopsis, @genreId, 'professional_longform', 'writing', 0, @targetWords,
      @userBackground, @expandedBackground, @projectBriefJson, @settingsJson,
      @themeVoiceJson, @worldRulesJson, @modelConfigId, 1, @createdAt, @updatedAt
    )
  `).run({
    title: savedTitle,
    synopsis: generated.project.synopsis,
    genreId,
    targetWords: project.targetWords,
    userBackground: generated.project.userBackground,
    expandedBackground: generated.project.expandedBackground,
    projectBriefJson: safeJson({ ...generated.projectBrief, readyCount: 6 }),
    settingsJson: safeJson({ ...generated.settings, aiEngine: { defaultMode: 'cost_saver' } }),
    themeVoiceJson: safeJson(generated.themeVoice),
    worldRulesJson: safeJson(generated.worldRules),
    modelConfigId,
    createdAt: ts2,
    updatedAt: ts2,
  })
  const novelId = Number(novelResult.lastInsertRowid)

  const volumeId = Number(db.prepare(`
    INSERT INTO story_volumes (novel_id, volume_number, title, summary, target_words, status, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 'planning', ?, ?)
  `).run(
    novelId,
    requiredString(generated.volume.title, '第一卷'),
    requiredString(generated.volume.summary, generated.arc.summary || generated.project.synopsis),
    Math.round(project.targetWords * 0.32),
    ts2, ts2,
  ).lastInsertRowid)

  const partId = Number(db.prepare(`
    INSERT INTO story_parts (novel_id, volume_id, part_number, title, summary, target_words, status, start_chapter_num, end_chapter_num, created_at, updated_at)
    VALUES (?, ?, 1, '前十章验证段', '流水线评测用前十章。', ?, 'planning', 1, 10, ?, ?)
  `).run(novelId, volumeId, Math.round(project.targetWords * 0.08), ts2, ts2).lastInsertRowid)

  const arcId = Number(db.prepare(`
    INSERT INTO story_arcs (novel_id, arc_name, arc_order, chapter_start, chapter_end, arc_goal, arc_summary, target_words, progress_percent, stalled_chapter_count)
    VALUES (?, ?, 1, 1, 10, ?, ?, ?, 0, 0)
  `).run(
    novelId,
    requiredString(generated.arc.name, '开局验证弧'),
    requiredString(generated.arc.goal, '建立主角压力、目标与长期承诺。'),
    requiredString(generated.arc.summary, generated.project.synopsis),
    Math.round(project.targetWords * 0.08),
  ).lastInsertRowid)

  const insertCharacter = db.prepare(`
    INSERT INTO characters (
      novel_id, role_type, full_name, background, personality_traits_json, flaws_json,
      goals, character_arc, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  asArray(generated.characters).slice(0, 8).forEach((character, index) => {
    const roleType = ['protagonist', 'antagonist', 'major', 'supporting'].includes(character.roleType)
      ? character.roleType
      : index === 0 ? 'protagonist' : 'major'
    insertCharacter.run(
      novelId,
      roleType,
      requiredString(character.fullName, `角色${index + 1}`),
      requiredString(character.background, ''),
      JSON.stringify(asArray(character.traits)),
      JSON.stringify(asArray(character.flaws)),
      requiredString(character.goals, ''),
      requiredString(character.arc, ''),
      index + 1,
      ts2, ts2,
    )
  })

  const insertChapter = db.prepare(`
    INSERT INTO chapters (
      novel_id, volume_id, part_id, chapter_num, title, outline, scene_plan_json,
      content, word_count, summary, next_chapter_seed, status, arc_id, target_words,
      emotion_tone, compiled_from_segments, segment_count, allowed_fact_ids_json,
      revealed_fact_ids_json, context_version, stale_reason_json, writeback_status_json,
      created_at, updated_at
    ) VALUES (
      @novelId, @volumeId, @partId, @chapterNum, @title, @outline, @scenePlanJson,
      '', 0, @summary, @nextSeed, 'outline', @arcId, @targetWords,
      @emotionTone, 0, @segmentCount, '[]', '[]', 1, '[]', @writebackStatusJson,
      @createdAt, @updatedAt
    )
  `)
  const insertSegment = db.prepare(`
    INSERT INTO chapter_segments (
      novel_id, chapter_id, volume_id, part_id, segment_order, title, segment_type,
      purpose, time_anchor, location_name, present_character_ids_json, linked_item_ids_json,
      input_state, output_state, summary, content, risk_tags_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'scene', ?, ?, ?, '[]', '[]', ?, ?, ?, '', '[]', 'planned', ?, ?)
  `)
  const insertChapterContract = db.prepare(`
    INSERT INTO chapter_contracts (
      novel_id, chapter_id, chapter_goal, opening_style, ending_style, exposition_mode,
      emotion_focus, served_thread_ids_json, required_arc_progress_json,
      required_character_arc_ids_json, required_relationship_arc_ids_json,
      required_resistance_track_ids_json, required_resistance_actions_json,
      required_asset_refs_json, required_endgame_commitment_ids_json,
      required_foreshadow_ids_json, hook_type, forbidden_actions_json,
      acceptance_notes_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?, ?, ?, 'ready', ?, ?)
  `)
  const insertSceneContract = db.prepare(`
    INSERT INTO scene_contracts (
      novel_id, chapter_id, segment_id, pov, time_location, scene_goal, obstacle,
      conflict_type, emotion_shift, reveal_payload_json, result_state, linkage_mode,
      required_endgame_commitment_ids_json, required_foreshadow_ids_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, '[]', '[]', 'ready', ?, ?)
  `)

  const chapterIds = []
  generated.chapters.forEach((chapter) => {
    const scenePlan = asArray(chapter.scenePlan)
    const chapterResult = insertChapter.run({
      novelId,
      volumeId,
      partId,
      chapterNum: chapter.chapterNum,
      title: chapter.title,
      outline: chapter.outline,
      scenePlanJson: JSON.stringify(scenePlan),
      summary: chapter.summary,
      nextSeed: chapter.nextSeed,
      arcId,
      targetWords: chapter.chapterNum <= CONTENT_CHAPTER_COUNT ? CHAPTER_TARGET_WORDS : 1800,
      emotionTone: chapter.emotionTone,
      segmentCount: Math.max(1, scenePlan.length),
      writebackStatusJson: JSON.stringify({
        phase: 'idle',
        retryCount: 0,
        blockedGeneration: false,
        readyForNextChapter: true,
        contextVersion: 1,
        updatedAt: ts2,
      }),
      createdAt: ts2,
      updatedAt: ts2,
    })
    const chapterId = Number(chapterResult.lastInsertRowid)
    chapterIds.push(chapterId)

    const segmentSource = scenePlan.length > 0 ? scenePlan : [{
      sceneTitle: chapter.title,
      purpose: chapter.chapterGoal,
      location: '未指定',
      conflict: '按章节大纲推进',
      exitHook: chapter.nextSeed,
    }]
    segmentSource.forEach((scene, index) => {
      const segResult = insertSegment.run(
        novelId, chapterId, volumeId, partId,
        index + 1,
        requiredString(scene.sceneTitle, `${chapter.title} 场景${index + 1}`),
        requiredString(scene.purpose, chapter.chapterGoal),
        `第${chapter.chapterNum}章`,
        requiredString(scene.location, '未指定'),
        index === 0 ? '章节开始' : `场景${index}`,
        requiredString(scene.exitHook, chapter.nextSeed || '留下下一步问题'),
        `冲突：${requiredString(scene.conflict, '按章节冲突推进')}`,
        ts2, ts2,
      )
      // 每个场景段都要有可执行的场景合同（真实流水线启动前会校验 POV/目标/障碍/结果）
      insertSceneContract.run(
        novelId, chapterId, Number(segResult.lastInsertRowid),
        generated.themeVoice?.pov || '第三人称有限视角',
        requiredString(scene.location, '未指定'),
        requiredString(scene.purpose, chapter.chapterGoal),
        requiredString(scene.conflict, '按章节冲突推进'),
        index === 0 ? '开局压力' : '推进压力',
        chapter.emotionTone,
        requiredString(scene.exitHook, chapter.nextSeed || '留下下一步问题'),
        index === segmentSource.length - 1 ? '承接下一章' : '承接下一场景',
        ts2, ts2,
      )
    })

    insertChapterContract.run(
      novelId, chapterId,
      chapter.chapterGoal,
      chapter.chapterNum === 1 ? '直接落入压力场景' : '承接上一章余波',
      chapter.nextSeed || '留下下一章钩子',
      '少解释，多用行动和选择展示设定',
      chapter.emotionTone,
      chapter.chapterNum <= CONTENT_CHAPTER_COUNT ? '强钩子' : '推进钩子',
      JSON.stringify([project.input.tabooRules, '不得复刻对照作品具体桥段']),
      JSON.stringify(['目标清晰', '冲突可见', '结尾有推进钩子']),
      ts2, ts2,
    )
  })

  return { novelId, title: savedTitle, volumeId, partId, arcId, chapterIds }
}

async function main() {
  await app.whenReady()

  const { initDb, getDb } = requireProject('electron/database/db.ts')
  const schema = requireProject('electron/database/schema.ts')
  initDb()

  const taskService = requireProject('electron/services/task.service.ts')
  const chapterService = requireProject('electron/services/chapter.service.ts')
  const antiAiService = requireProject('electron/services/anti-ai-rule.service.ts')

  const databasePath = path.join(app.getPath('userData'), 'novelforge.db')
  const drizzleDb = getDb()
  const modelConfig = drizzleDb.select().from(schema.modelConfigs).all()
    .sort((left, right) => (right.isDefault || 0) - (left.isDefault || 0))[0]
  if (!modelConfig) throw new Error('No model config found')

  const runStamp = process.env.NOVELFORGE_EVAL_RUN_STAMP || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const outDir = path.join(OUT_ROOT, runStamp)
  fs.mkdirSync(outDir, { recursive: true })

  const rawDb = new Database(databasePath)
  rawDb.pragma('busy_timeout = 10000')
  rawDb.pragma('foreign_keys = ON')

  async function callModel(messages, label) {
    console.log(`[eval-pipeline] model call: ${label}`)
    return taskService.runChatTask({
      type: 'review',
      retryable: true,
      messages,
      modelConfigId: modelConfig.id,
    })
  }

  const runInfo = {
    generatedAt: nowIso(),
    databasePath,
    mode: 'real-pipeline',
    modelLabel: `${modelConfig.provider}:${modelConfig.modelId}#${modelConfig.id}`,
    contentChapterCount: CONTENT_CHAPTER_COUNT,
    chapterTargetWords: CHAPTER_TARGET_WORDS,
    projects: [],
  }

  const selectedProjects = PROJECT_FILTER.size > 0
    ? PROJECTS.filter((project) => PROJECT_FILTER.has(project.key))
    : PROJECTS

  try {
    for (const project of selectedProjects) {
      console.log(`[eval-pipeline] ${project.key}: scaffold phase A (ch1-5)`)
      const rawA = await callModel(buildScaffoldPromptA(project), `${project.key} scaffold A`)
      fs.writeFileSync(path.join(outDir, `${project.key}.scaffold-a.raw.txt`), String(rawA || ''), 'utf8')
      const phase1 = extractJson(rawA)

      console.log(`[eval-pipeline] ${project.key}: scaffold phase B (ch6-10)`)
      const rawB = await callModel(buildScaffoldPromptB(project, phase1), `${project.key} scaffold B`)
      fs.writeFileSync(path.join(outDir, `${project.key}.scaffold-b.raw.txt`), String(rawB || ''), 'utf8')
      const phase2 = extractJson(rawB)

      const chaptersA = asArray(phase1.chapters).slice(0, 5).map((chapter, index) => normalizeChapter(chapter, index, 1))
      const chaptersB = asArray(phase2.chapters).slice(0, 5).map((chapter, index) => normalizeChapter(chapter, index, 6))
      let chapters = [...chaptersA, ...chaptersB]
      while (chapters.length < 10) {
        const num = chapters.length + 1
        chapters.push(normalizeChapter({}, 0, num))
      }
      chapters = chapters.slice(0, 10).map((chapter, index) => ({ ...chapter, chapterNum: index + 1 }))

      // scenePlan 空缺定向补全
      const missingScenePlan = chapters.filter((chapter) => chapter.scenePlan.length === 0)
      if (missingScenePlan.length > 0) {
        console.log(`[eval-pipeline] ${project.key}: backfilling scenePlan for ${missingScenePlan.length} chapters`)
        try {
          const rawBackfill = await callModel(
            buildScenePlanBackfillPrompt(project, phase1, missingScenePlan),
            `${project.key} scenePlan backfill`,
          )
          const backfill = extractJson(rawBackfill)
          const backfillMap = new Map(asArray(backfill.chapters).map((item) => [Number(item.chapterNum), asArray(item.scenePlan).slice(0, 4)]))
          chapters = chapters.map((chapter) => backfillMap.has(chapter.chapterNum) && backfillMap.get(chapter.chapterNum).length > 0
            ? { ...chapter, scenePlan: backfillMap.get(chapter.chapterNum) }
            : chapter)
        } catch (error) {
          console.warn(`[eval-pipeline] ${project.key}: scenePlan backfill failed: ${error.message}`)
        }
      }

      const generated = {
        project: {
          title: requiredString(phase1.project?.title, `${project.savedTitlePrefix}（流水线版）`),
          synopsis: requiredString(phase1.project?.synopsis, project.input.coreHook),
          userBackground: requiredString(phase1.project?.userBackground, project.input.coreConflict),
          expandedBackground: requiredString(phase1.project?.expandedBackground, project.input.theme),
        },
        projectBrief: phase1.projectBrief || {},
        settings: phase1.settings || {},
        themeVoice: phase1.themeVoice || {},
        worldRules: phase1.worldRules || {},
        characters: asArray(phase1.characters).slice(0, 8),
        arc: phase1.arc || {},
        volume: phase1.volume || {},
        chapters,
      }

      console.log(`[eval-pipeline] ${project.key}: inserting scaffold`)
      const saved = rawDb.transaction(() => insertScaffold(rawDb, project, generated, modelConfig.id, runStamp))()
      console.log(`[eval-pipeline] ${project.key}: saved ${saved.title} -> novelId ${saved.novelId}`)

      // 前 N 章正文走真实生产流水线
      const chapterReports = []
      for (let chapterIndex = 0; chapterIndex < CONTENT_CHAPTER_COUNT; chapterIndex += 1) {
        const chapterId = saved.chapterIds[chapterIndex]
        const chapterNum = chapterIndex + 1
        const report = {
          chapterNum,
          chapterId,
          pipelineStatus: 'ok',
          pipelineError: '',
          expandAttempts: 0,
          repetitionRewrites: 0,
          finalWords: 0,
          targetWords: CHAPTER_TARGET_WORDS,
          antiAiHits: [],
          tabooHits: [],
        }
        console.log(`[eval-pipeline] ${project.key}: real pipeline for chapter ${chapterNum} (id ${chapterId})`)
        try {
          await chapterService.generateChapterContent(chapterId, undefined, { executionMode: 'cost_saver' })
        } catch (error) {
          report.pipelineStatus = 'error'
          report.pipelineError = String(error && error.message || error).slice(0, 400)
          console.warn(`[eval-pipeline] ${project.key} ch${chapterNum}: pipeline error: ${report.pipelineError}`)
        }

        let chapterRow = chapterService.getChapter(chapterId)
        let content = String(chapterRow?.content || '')

        // 参考字数只记录在报告中；章节是否需要续写应由场景完成度和截断迹象决定。

        // 残留高危 AI 味补救重写（带具体命中片段）
        let hits = antiAiService.collectAntiAiRuntimeHits(content, project.genreName)
        const highHits = hits.filter((hit) => hit.severity === 'high')
        if (content && highHits.length > 0) {
          report.repetitionRewrites += 1
          console.log(`[eval-pipeline] ${project.key} ch${chapterNum}: ${highHits.length} high anti-ai hits, corrective rewrite`)
          try {
            const rewritten = await callModel([
              { role: 'system', content: '你是小说改稿编辑。只输出改写后的完整正文，不要解释，不要 Markdown。' },
              {
                role: 'user',
                content: [
                  '下面的正文存在明显的 AI 生成痕迹，请针对性修复，其他内容尽量保持不动：',
                  ...highHits.map((hit) => `- ${hit.ruleTitle || hit.ruleCode}：${hit.detail || ''} 命中片段：${hit.excerpt || ''}`),
                  '高频重复的人名改用代词、称呼变化或动作主语省略；模板句式改成贴合场景的自然表达。',
                  `字数保持在 ${Math.round(countHanzi(content) * 0.9)} 字以上。`,
                  '',
                  '正文：',
                  content,
                ].join('\n'),
              },
            ], `${project.key} ch${chapterNum} anti-ai rewrite`)
            const rewrittenText = String(rewritten || '').trim()
            if (countHanzi(rewrittenText) >= Math.round(countHanzi(content) * 0.8)) {
              chapterService.updateChapter(chapterId, { content: rewrittenText })
              content = rewrittenText
              hits = antiAiService.collectAntiAiRuntimeHits(content, project.genreName)
            }
          } catch (error) {
            console.warn(`[eval-pipeline] ${project.key} ch${chapterNum}: anti-ai rewrite failed: ${error.message}`)
          }
        }

        chapterRow = chapterService.getChapter(chapterId)
        report.finalWords = countHanzi(chapterRow?.content || '')
        report.antiAiHits = hits.map((hit) => ({ rule: hit.ruleCode, severity: hit.severity, excerpt: (hit.excerpt || '').slice(0, 60) }))
        report.tabooHits = scanTaboo(chapterRow?.content || '', project.tabooPatterns)
        chapterReports.push(report)
      }

      // 大纲层违禁扫描
      const outlineTabooHits = scanTaboo(
        generated.chapters.map((chapter) => `${chapter.title}\n${chapter.outline}`).join('\n'),
        project.tabooPatterns,
      )

      const artifact = {
        baseTitle: project.baseTitle,
        key: project.key,
        input: project.input,
        tabooPatterns: project.tabooPatterns,
        saved,
        chapters: generated.chapters,
        chapterReports,
        outlineTabooHits,
      }
      fs.writeFileSync(path.join(outDir, `${project.key}.json`), JSON.stringify(artifact, null, 2), 'utf8')
      runInfo.projects.push(artifact)
    }

    fs.writeFileSync(path.join(outDir, 'run-info.json'), JSON.stringify(runInfo, null, 2), 'utf8')

    const reportLines = ['# 小说 AI 流水线评测报告', '', `生成时间：${runInfo.generatedAt}`, `模型：${runInfo.modelLabel}`, `数据库：${databasePath}`, '']
    for (const item of runInfo.projects) {
      reportLines.push(`## ${item.saved.title}`, '')
      reportLines.push(`- novelId：${item.saved.novelId}`)
      reportLines.push(`- 章节：${item.chapters.length}（scenePlan 缺失 ${item.chapters.filter((chapter) => chapter.scenePlan.length === 0).length} 章）`)
      reportLines.push(`- 大纲违禁命中：${item.outlineTabooHits.length === 0 ? '无' : item.outlineTabooHits.map((hit) => hit.matches.join('/')).join('；')}`)
      for (const chapterReport of item.chapterReports) {
        reportLines.push(
          `- 第 ${chapterReport.chapterNum} 章：${chapterReport.finalWords} 字（目标 ${chapterReport.targetWords}）`
          + `，流水线 ${chapterReport.pipelineStatus}${chapterReport.pipelineError ? `（${chapterReport.pipelineError.slice(0, 120)}）` : ''}`
          + `，扩写 ${chapterReport.expandAttempts} 次，AI味补救 ${chapterReport.repetitionRewrites} 次`
          + `，残留命中 ${chapterReport.antiAiHits.length} 条`
          + `，正文违禁命中 ${chapterReport.tabooHits.length} 条`,
        )
      }
      reportLines.push('')
    }
    fs.writeFileSync(path.join(outDir, 'report.md'), `${reportLines.join('\n')}\n`, 'utf8')
    console.log(`[eval-pipeline] report ${path.join(outDir, 'report.md')}`)
  } catch (error) {
    fs.writeFileSync(path.join(outDir, 'error.txt'), `${error.stack || error.message || error}\n`, 'utf8')
    throw error
  } finally {
    rawDb.close()
  }
}

function exitProcess(code) {
  process.exitCode = code
  try {
    app.quit()
  } catch {}
  setTimeout(() => process.exit(code), 100)
}

main().then(() => {
  console.log('[eval-pipeline] done')
  exitProcess(0)
}).catch((error) => {
  console.error('[eval-pipeline] failed:', error)
  exitProcess(1)
})
