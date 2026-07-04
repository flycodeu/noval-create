const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const BACKEND_URL = process.env.NOVELFORGE_LOCAL_BACKEND || 'http://127.0.0.1:8787/rpc'
const OUT_ROOT = path.resolve(__dirname, '..', 'out', 'novel-ai-eval')
const REUSE_RAW = process.env.NOVELFORGE_EVAL_REUSE_RAW === '1'
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
    savedTitlePrefix: 'AI测试｜钢铁是怎么炼成的',
    genreName: '历史正剧',
    targetWords: 180000,
    benchmark: [
      '原作是革命成长/精神锻造叙事，重心在个人苦难如何被组织、时代目标和劳动纪律重塑。',
      '原作核心不是简单逆袭，而是病痛、战争、失去和自我教育共同锻造意志。',
      '测试时只取主题与结构压力，不复刻原著人物、具体事件、译文和场景。',
    ],
    input: {
      theme: '苦难中的自我锻造、集体信念、劳动与时代责任',
      protagonistStart: '一个来自边缘工矿家庭的年轻维修学徒，冲动、自尊强，但缺乏稳定方向。',
      coreHook: '主角在一次事故后失去继续当一线工人的资格，却被迫转向记录、组织和技术教育工作。',
      coreConflict: '个人伤病、失去和时代任务之间不断冲突；主角必须证明价值不只来自体力和战场。',
      tabooRules: '不得复刻原著人物姓名、具体战役、经典台词或译文；不得写成口号堆砌。',
      expectedOriginalGapFocus: '能否写出精神锻造、现实代价和组织生活，而不是把题目写成励志模板。',
    },
  },
  {
    key: 'doupo',
    baseTitle: '斗破苍穹',
    savedTitlePrefix: 'AI测试｜斗破苍穹',
    genreName: '玄幻修真',
    targetWords: 300000,
    benchmark: [
      '原作是升级爽文/玄幻成长叙事，核心体验是天赋跌落、羞辱压力、师承机缘、修炼体系和阶段性兑现。',
      '原作强项在早期钩子明确、等级目标清晰、每个阶段都有可量化成长和压迫者。',
      '测试时只取类型机制和读者承诺，不复刻原作人物、专有名词、具体设定和标志性桥段。',
    ],
    input: {
      theme: '从废弃天赋到重新掌握命运，成长必须付出代价',
      protagonistStart: '一个曾被家族寄予厚望的少年突然失去修炼感应，被视为拖累。',
      coreHook: '一枚残损古器在他最狼狈时回应，但每次借力都会留下身体和人际代价。',
      coreConflict: '家族资源、宗门名额、旧婚约压力和隐藏导师的代价形成连续压迫。',
      tabooRules: '不得使用原作人物姓名、斗气大陆、异火、药老、三年之约等专名或具体桥段；不得照搬经典退婚戏。',
      expectedOriginalGapFocus: '能否建立清晰等级、爽点兑现和长期目标，而不是只写泛化修炼。',
    },
  },
]

async function rpc(service, method, args = []) {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, method, args }),
  })
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
  const body = await response.json()
  if (!body.ok) {
    const message = body.error?.message || `${service}.${method} failed`
    const detail = body.error?.detail ? `\n${body.error.detail}` : ''
    throw new Error(`${message}${detail}`)
  }
  return body.data
}

function extractJson(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('AI output is empty')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced ? fenced[1].trim() : text
  try {
    return JSON.parse(source)
  } catch {
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1))
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

function countWords(text) {
  const source = String(text || '')
  return (source.match(/[\u4e00-\u9fa5]/g) || []).length + (source.match(/\b[a-zA-Z]+\b/g) || []).length
}

function nowIso() {
  return new Date().toISOString()
}

function buildPrompt(project) {
  return [
    {
      role: 'system',
      content: [
        '你是 NovelForge 的小说项目生成与评估器。',
        '必须生成原创测试内容，不能复刻、续写、改写或模仿任何在版权保护期内作品的具体表达、专名、人物关系、章节桥段或标志性场景。',
        '只输出一个 JSON 对象，不要 Markdown，不要解释。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: '基于对照作品的主题/类型压力，生成一个原创小说测试项目，用于验证 AI 小说工作流。',
        sourceTitleForComparisonOnly: project.baseTitle,
        benchmark: project.benchmark,
        input: project.input,
        requirements: [
          '项目标题必须体现是 AI 原创对照测试版。',
          '生成 10 个章节大纲。',
          '只为第 1、2 章生成正文，正文每章 900 到 1400 个汉字。',
          '第 3 到 10 章 content 必须为空字符串。',
          '每章大纲要包含目标、冲突、转折、退出钩子。',
          '给出评估：生成效果、与对照作品的差距、设计合理性、流程风险和下一步修正建议。',
          '不得使用对照作品的原文、角色名、专有设定名或标志性桥段。',
        ],
        outputSchema: {
          project: {
            title: 'string',
            synopsis: 'string',
            userBackground: 'string',
            expandedBackground: 'string',
          },
          projectBrief: {
            premise: 'string',
            targetReader: 'string',
            sellingPoints: ['string'],
            coreEmotion: 'string',
            constraints: ['string'],
            readyCount: 6,
          },
          settings: {
            premise: {
              positioning: 'string',
              coreHook: 'string',
              protagonistStart: 'string',
              constraints: 'string',
            },
            storyGoal: 'string',
            coreConflict: 'string',
            mainPlot: 'string',
            ending: 'string',
            endgameDesign: {
              endingMode: 'string',
              finalConflict: 'string',
              themeAnswer: 'string',
              mustDeliverPromises: 'string',
              payoffChecklist: 'string',
              deliberateUnknowns: 'string',
              finalImage: 'string',
              lastScene: 'string',
            },
            aiEngine: { defaultMode: 'cost_saver' },
          },
          themeVoice: {
            theme: 'string',
            emotionalCore: 'string',
            pov: 'string',
            tense: 'string',
            styleRules: 'string',
            dialogueRules: 'string',
            writingContractTags: ['string'],
          },
          worldRules: {
            summary: 'string',
            sections: [{ key: 'string', title: 'string', content: 'string' }],
            timelineConfig: {
              calendarType: 'string',
              eraName: 'string',
              epochLabel: 'string',
              baseYearLabel: 'string',
              displayPattern: 'string',
              relativeZeroLabel: 'string',
              recommendedEventTypes: ['string'],
              precisionOptions: ['string'],
            },
          },
          characters: [
            {
              fullName: 'string',
              roleType: 'protagonist|antagonist|major|supporting',
              background: 'string',
              goals: 'string',
              flaws: ['string'],
              traits: ['string'],
              arc: 'string',
            },
          ],
          arc: {
            name: 'string',
            goal: 'string',
            summary: 'string',
          },
          volume: {
            title: 'string',
            summary: 'string',
          },
          chapters: [
            {
              chapterNum: 1,
              title: 'string',
              outline: 'string',
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
              content: 'string',
              summary: 'string',
              nextSeed: 'string',
              emotionTone: 'string',
            },
          ],
          evaluation: {
            effect: 'string',
            comparisonWithBenchmark: ['string'],
            designReasonability: ['string'],
            flowProblems: ['string'],
            risks: ['string'],
            fixSuggestions: ['string'],
          },
        },
      }, null, 2),
    },
  ]
}

function normalizeGenerated(project, rawData) {
  const data = rawData && typeof rawData === 'object' ? rawData : {}
  const chapters = asArray(data.chapters).slice(0, 10).map((chapter, index) => ({
    chapterNum: Number(chapter.chapterNum) || index + 1,
    title: requiredString(chapter.title, `第${index + 1}章`),
    outline: requiredString(chapter.outline, '目标、冲突、转折和退出钩子待补。'),
    chapterGoal: requiredString(chapter.chapterGoal, '推进主线并留下下一章钩子。'),
    scenePlan: asArray(chapter.scenePlan).slice(0, 4),
    content: index < 2 ? requiredString(chapter.content, '') : '',
    summary: requiredString(chapter.summary, ''),
    nextSeed: requiredString(chapter.nextSeed, ''),
    emotionTone: requiredString(chapter.emotionTone, index < 2 ? '压迫后反弹' : '推进'),
  }))
  while (chapters.length < 10) {
    const num = chapters.length + 1
    chapters.push({
      chapterNum: num,
      title: `第${num}章`,
      outline: '大纲缺失：需要补目标、冲突、转折和退出钩子。',
      chapterGoal: '补齐章节推进目标。',
      scenePlan: [],
      content: '',
      summary: '',
      nextSeed: '',
      emotionTone: '推进',
    })
  }

  return {
    project: {
      title: requiredString(data.project?.title, `${project.savedTitlePrefix}（原创对照版）`),
      synopsis: requiredString(data.project?.synopsis, project.input.coreHook),
      userBackground: requiredString(data.project?.userBackground, project.input.coreConflict),
      expandedBackground: requiredString(data.project?.expandedBackground, project.input.expectedOriginalGapFocus),
    },
    projectBrief: data.projectBrief || {},
    settings: data.settings || {},
    themeVoice: data.themeVoice || {},
    worldRules: data.worldRules || {},
    characters: asArray(data.characters).slice(0, 8),
    arc: data.arc || {},
    volume: data.volume || {},
    chapters,
    evaluation: data.evaluation || {},
  }
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

function insertGeneratedProject(db, project, generated, modelConfigId, runStamp) {
  const ts = nowIso()
  const genreId = getGenreId(db, project.genreName)
  const savedTitle = `${project.savedTitlePrefix}（原创对照版 ${runStamp}）`
  const settings = {
    ...generated.settings,
    aiEngine: {
      ...(generated.settings?.aiEngine || {}),
      defaultMode: 'cost_saver',
    },
  }

  const insertNovel = db.prepare(`
    INSERT INTO novels (
      title, synopsis, genre_id, launch_mode, status, total_words, target_words,
      user_background, expanded_background, project_brief_json, settings_json,
      theme_voice_json, world_rules_json, model_config_id, context_version, created_at, updated_at
    ) VALUES (
      @title, @synopsis, @genreId, @launchMode, @status, 0, @targetWords,
      @userBackground, @expandedBackground, @projectBriefJson, @settingsJson,
      @themeVoiceJson, @worldRulesJson, @modelConfigId, 1, @createdAt, @updatedAt
    )
  `)
  const novelResult = insertNovel.run({
    title: savedTitle,
    synopsis: generated.project.synopsis,
    genreId,
    launchMode: project.key === 'doupo' ? 'fast_launch' : 'professional_longform',
    status: 'writing',
    targetWords: project.targetWords,
    userBackground: generated.project.userBackground,
    expandedBackground: generated.project.expandedBackground,
    projectBriefJson: safeJson({ ...generated.projectBrief, readyCount: 6 }),
    settingsJson: safeJson(settings),
    themeVoiceJson: safeJson(generated.themeVoice),
    worldRulesJson: safeJson(generated.worldRules),
    modelConfigId,
    createdAt: ts,
    updatedAt: ts,
  })
  const novelId = Number(novelResult.lastInsertRowid)

  const volumeResult = db.prepare(`
    INSERT INTO story_volumes (novel_id, volume_number, title, summary, target_words, status, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 'planning', ?, ?)
  `).run(
    novelId,
    requiredString(generated.volume.title, '第一卷'),
    requiredString(generated.volume.summary, generated.arc.summary || generated.project.synopsis),
    Math.round(project.targetWords * 0.32),
    ts,
    ts,
  )
  const volumeId = Number(volumeResult.lastInsertRowid)

  const partResult = db.prepare(`
    INSERT INTO story_parts (novel_id, volume_id, part_number, title, summary, target_words, status, start_chapter_num, end_chapter_num, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, 'planning', 1, 10, ?, ?)
  `).run(
    novelId,
    volumeId,
    '前十章验证段',
    '用于验证开局大纲、前两章正文和工作流保存效果。',
    Math.round(project.targetWords * 0.08),
    ts,
    ts,
  )
  const partId = Number(partResult.lastInsertRowid)

  const arcResult = db.prepare(`
    INSERT INTO story_arcs (novel_id, arc_name, arc_order, chapter_start, chapter_end, arc_goal, arc_summary, target_words, progress_percent, stalled_chapter_count)
    VALUES (?, ?, 1, 1, 10, ?, ?, ?, 0, 0)
  `).run(
    novelId,
    requiredString(generated.arc.name, '开局验证弧'),
    requiredString(generated.arc.goal, '建立主角压力、目标与长期承诺。'),
    requiredString(generated.arc.summary, generated.project.synopsis),
    Math.round(project.targetWords * 0.08),
  )
  const arcId = Number(arcResult.lastInsertRowid)

  const insertCharacter = db.prepare(`
    INSERT INTO characters (
      novel_id, role_type, full_name, background, personality_traits_json, flaws_json,
      goals, character_arc, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  generated.characters.forEach((character, index) => {
    const name = requiredString(character.fullName, `角色${index + 1}`)
    const roleType = ['protagonist', 'antagonist', 'major', 'supporting'].includes(character.roleType)
      ? character.roleType
      : index === 0 ? 'protagonist' : 'major'
    insertCharacter.run(
      novelId,
      roleType,
      name,
      requiredString(character.background, ''),
      JSON.stringify(asArray(character.traits)),
      JSON.stringify(asArray(character.flaws)),
      requiredString(character.goals, ''),
      requiredString(character.arc, ''),
      index + 1,
      ts,
      ts,
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
      @content, @wordCount, @summary, @nextSeed, @status, @arcId, @targetWords,
      @emotionTone, 0, @segmentCount, '[]', '[]', 1, '[]', @writebackStatusJson,
      @createdAt, @updatedAt
    )
  `)
  const insertVersion = db.prepare(`
    INSERT INTO chapter_versions (novel_id, chapter_id, version_source, content, word_count, created_at)
    VALUES (?, ?, 'ai-generated', ?, ?, ?)
  `)
  const insertSegment = db.prepare(`
    INSERT INTO chapter_segments (
      novel_id, chapter_id, volume_id, part_id, segment_order, title, segment_type,
      purpose, time_anchor, location_name, present_character_ids_json, linked_item_ids_json,
      input_state, output_state, summary, content, risk_tags_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'scene', ?, ?, ?, '[]', '[]', ?, ?, ?, ?, '[]', ?, ?, ?)
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?, ?, ?, 'draft', ?, ?)
  `)
  const insertSceneContract = db.prepare(`
    INSERT INTO scene_contracts (
      novel_id, chapter_id, segment_id, pov, time_location, scene_goal, obstacle,
      conflict_type, emotion_shift, reveal_payload_json, result_state, linkage_mode,
      required_endgame_commitment_ids_json, required_foreshadow_ids_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, '[]', '[]', 'draft', ?, ?)
  `)

  const chapterIds = []
  generated.chapters.forEach((chapter) => {
    const scenePlan = asArray(chapter.scenePlan)
    const content = chapter.chapterNum <= 2 ? chapter.content : ''
    const wordCount = countWords(content)
    const chapterResult = insertChapter.run({
      novelId,
      volumeId,
      partId,
      chapterNum: chapter.chapterNum,
      title: chapter.title,
      outline: chapter.outline,
      scenePlanJson: JSON.stringify(scenePlan),
      content,
      wordCount,
      summary: chapter.summary,
      nextSeed: chapter.nextSeed,
      status: content ? 'draft' : 'outline',
      arcId,
      targetWords: chapter.chapterNum <= 2 ? 1200 : 1800,
      emotionTone: chapter.emotionTone,
      segmentCount: Math.max(1, scenePlan.length),
      writebackStatusJson: JSON.stringify({
        phase: 'idle',
        retryCount: 0,
        blockedGeneration: false,
        readyForNextChapter: true,
        contextVersion: 1,
        updatedAt: ts,
      }),
      createdAt: ts,
      updatedAt: ts,
    })
    const chapterId = Number(chapterResult.lastInsertRowid)
    chapterIds.push(chapterId)
    if (content) insertVersion.run(novelId, chapterId, content, wordCount, ts)

    const segmentSource = scenePlan.length > 0 ? scenePlan : [{
      sceneTitle: chapter.title,
      purpose: chapter.chapterGoal,
      location: '未指定',
      conflict: '按章节大纲推进',
      exitHook: chapter.nextSeed,
    }]
    segmentSource.forEach((scene, index) => {
      const segmentTitle = requiredString(scene.sceneTitle, `${chapter.title} 场景${index + 1}`)
      const segmentContent = index === 0 ? content : ''
      const segResult = insertSegment.run(
        novelId,
        chapterId,
        volumeId,
        partId,
        index + 1,
        segmentTitle,
        requiredString(scene.purpose, chapter.chapterGoal),
        `第${chapter.chapterNum}章`,
        requiredString(scene.location, '未指定'),
        index === 0 ? '章节开始' : `场景${index}`,
        requiredString(scene.exitHook, chapter.nextSeed || '留下下一步问题'),
        `${segmentContent ? `${segmentTitle} 已生成正文。` : `${segmentTitle} 待生成正文。`} 冲突：${requiredString(scene.conflict, '按章节冲突推进')}`,
        segmentContent,
        segmentContent ? 'draft' : 'planned',
        ts,
        ts,
      )
      if (index === 0) {
        insertSceneContract.run(
          novelId,
          chapterId,
          Number(segResult.lastInsertRowid),
          generated.themeVoice?.pov || '第三人称有限视角',
          requiredString(scene.location, '未指定'),
          requiredString(scene.purpose, chapter.chapterGoal),
          requiredString(scene.conflict, '按章节冲突推进'),
          '开局压力',
          chapter.emotionTone,
          requiredString(scene.exitHook, chapter.nextSeed || ''),
          '承接下一章',
          ts,
          ts,
        )
      }
    })

    insertChapterContract.run(
      novelId,
      chapterId,
      chapter.chapterGoal,
      chapter.chapterNum === 1 ? '直接落入压力场景' : '承接上一章余波',
      chapter.nextSeed || '留下下一章钩子',
      '少解释，多用行动和选择展示设定',
      chapter.emotionTone,
      chapter.chapterNum <= 2 ? '强钩子' : '推进钩子',
      JSON.stringify([project.input.tabooRules, '不得复刻对照作品具体桥段']),
      JSON.stringify(['目标清晰', '冲突可见', '结尾有推进钩子']),
      ts,
      ts,
    )
  })

  const totalWords = generated.chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0)
  db.prepare('UPDATE novels SET total_words = ?, updated_at = ? WHERE id = ?').run(totalWords, ts, novelId)

  return {
    novelId,
    title: savedTitle,
    genreId,
    volumeId,
    partId,
    arcId,
    chapterIds,
    totalWords,
  }
}

function buildMarkdownReport(runInfo) {
  const lines = [
    `# 小说 AI 生成验证报告`,
    ``,
    `生成时间：${runInfo.generatedAt}`,
    `数据库：${runInfo.databasePath}`,
    `模型：${runInfo.modelLabel}`,
    ``,
  ]

  for (const item of runInfo.projects) {
    const generated = item.generated
    const saved = item.saved
    lines.push(`## ${saved.title}`)
    lines.push(``)
    lines.push(`- 本地 novelId：${saved.novelId}`)
    lines.push(`- 章节数：${saved.chapterIds.length}`)
    lines.push(`- 已生成正文：前 2 章，共 ${saved.totalWords} 字`)
    lines.push(`- 对照对象：${item.baseTitle}`)
    lines.push(``)
    lines.push(`### 前 10 章大纲`)
    generated.chapters.forEach((chapter) => {
      lines.push(`- 第 ${chapter.chapterNum} 章《${chapter.title}》：${chapter.outline.replace(/\s+/g, ' ').slice(0, 220)}`)
    })
    lines.push(``)
    lines.push(`### 前两章正文长度`)
    generated.chapters.slice(0, 2).forEach((chapter) => {
      lines.push(`- 第 ${chapter.chapterNum} 章《${chapter.title}》：${countWords(chapter.content)} 字`)
    })
    lines.push(``)
    lines.push(`### 生成效果`)
    lines.push(requiredString(generated.evaluation.effect, '未返回效果评估。'))
    lines.push(``)
    lines.push(`### 与原作差距`)
    asArray(generated.evaluation.comparisonWithBenchmark).forEach((entry) => lines.push(`- ${entry}`))
    lines.push(``)
    lines.push(`### 设计合理性`)
    asArray(generated.evaluation.designReasonability).forEach((entry) => lines.push(`- ${entry}`))
    lines.push(``)
    lines.push(`### 流程/内容问题`)
    asArray(generated.evaluation.flowProblems).forEach((entry) => lines.push(`- ${entry}`))
    asArray(generated.evaluation.risks).forEach((entry) => lines.push(`- 风险：${entry}`))
    lines.push(``)
    lines.push(`### 修正建议`)
    asArray(generated.evaluation.fixSuggestions).forEach((entry) => lines.push(`- ${entry}`))
    lines.push(``)
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const databasePath = await rpc('app', 'getDatabasePath')
  const models = await rpc('model', 'list')
  const defaultModel = models.find((model) => model.isDefault) || models[0]
  if (!defaultModel) throw new Error('No model config found')

  const runStamp = process.env.NOVELFORGE_EVAL_RUN_STAMP || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)
  const outDir = path.join(OUT_ROOT, runStamp)
  fs.mkdirSync(outDir, { recursive: true })

  const db = new Database(databasePath)
  db.pragma('busy_timeout = 10000')
  db.pragma('foreign_keys = ON')

  const runInfo = {
    generatedAt: nowIso(),
    databasePath,
    modelLabel: `${defaultModel.provider}:${defaultModel.modelId}#${defaultModel.id}`,
    projects: [],
  }

  try {
    const selectedProjects = PROJECT_FILTER.size > 0
      ? PROJECTS.filter((project) => PROJECT_FILTER.has(project.key))
      : PROJECTS

    for (const project of selectedProjects) {
      console.log(`[novel-ai-eval] ${project.key}: start ${project.baseTitle}`)
      const rawPath = path.join(outDir, `${project.key}.raw.txt`)
      let rawOutput = ''
      if (REUSE_RAW && fs.existsSync(rawPath)) {
        console.log(`[novel-ai-eval] ${project.key}: reusing ${rawPath}`)
        rawOutput = fs.readFileSync(rawPath, 'utf8')
      } else {
        console.log(`[novel-ai-eval] ${project.key}: generating`)
        const outputs = await rpc('ai', 'runPrompt', [{
          modelConfigId: defaultModel.id,
          executionMode: 'cost_saver',
          count: 1,
          messages: buildPrompt(project),
        }])
        rawOutput = Array.isArray(outputs) ? outputs[0] : outputs
        fs.writeFileSync(rawPath, String(rawOutput || ''), 'utf8')
      }
      console.log(`[novel-ai-eval] ${project.key}: parsing`)
      const parsed = extractJson(rawOutput)
      const generated = normalizeGenerated(project, parsed)
      console.log(`[novel-ai-eval] ${project.key}: inserting`)
      const saved = db.transaction(() => insertGeneratedProject(db, project, generated, defaultModel.id, runStamp))()
      const artifact = {
        baseTitle: project.baseTitle,
        input: project.input,
        benchmark: project.benchmark,
        saved,
        generated,
      }
      fs.writeFileSync(path.join(outDir, `${project.key}.json`), JSON.stringify(artifact, null, 2), 'utf8')
      runInfo.projects.push(artifact)
      console.log(`[novel-ai-eval] saved ${saved.title} -> novelId ${saved.novelId}`)
    }

    fs.writeFileSync(path.join(outDir, 'report.md'), buildMarkdownReport(runInfo), 'utf8')
    fs.writeFileSync(path.join(outDir, 'run-info.json'), JSON.stringify(runInfo, null, 2), 'utf8')
    console.log(`[novel-ai-eval] report ${path.join(outDir, 'report.md')}`)
  } catch (error) {
    fs.writeFileSync(path.join(outDir, 'error.txt'), `${error.stack || error.message || error}\n`, 'utf8')
    throw error
  } finally {
    db.close()
  }
}

function exitProcess(code) {
  process.exitCode = code
  try {
    const electron = require('electron')
    electron?.app?.quit?.()
  } catch {}
  setTimeout(() => process.exit(code), 50)
}

main().then(() => {
  exitProcess(0)
}).catch((error) => {
  console.error('[novel-ai-eval] failed:', error)
  exitProcess(1)
})
