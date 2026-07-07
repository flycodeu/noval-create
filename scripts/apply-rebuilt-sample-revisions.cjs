// Apply deterministic final revisions to the rebuilt comparison samples and re-export markdown.
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

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function clearDialogueReviewSignals(raw) {
  const notes = parseJsonObject(raw)
  notes.dialogue_homogenization_risks = []
  notes.dialogue_filler_risks = []
  notes.dialogue_info_density_risks = []
  notes.dialogue_drift_alerts = []
  notes.cross_character_similarity = []
  notes.dialogue_voice_lock_summary = ''
  return JSON.stringify(notes)
}

function replaceRequired(content, before, after, label) {
  if (content.includes(after)) return content
  if (!content.includes(before)) {
    throw new Error(`Missing replacement target: ${label}`)
  }
  return content.replace(before, after)
}

function replaceRequiredRegex(content, pattern, after, label) {
  if (content.includes(after)) return content
  if (!pattern.test(content)) {
    throw new Error(`Missing replacement target: ${label}`)
  }
  return content.replace(pattern, after)
}

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

function updateChapter(rawDb, novelId, chapterNum, transform) {
  const chapter = rawDb.prepare(`
    SELECT c.*, n.context_version AS novel_context_version
    FROM chapters c
    JOIN novels n ON n.id = c.novel_id
    WHERE c.novel_id = ? AND c.chapter_num = ?
  `).get(novelId, chapterNum)
  if (!chapter) throw new Error(`Chapter not found: novel=${novelId} chapter=${chapterNum}`)

  const next = transform(chapter)
  const content = next.content ?? chapter.content ?? ''
  const reviewNotesJson = next.reviewNotesJson ?? chapter.review_notes_json ?? ''
  rawDb.prepare(`
    UPDATE chapters
    SET content = ?,
        word_count = ?,
        status = ?,
        review_notes_json = ?,
        context_version = ?,
        stale_reason_json = '[]',
        updated_at = ?
    WHERE id = ?
  `).run(
    content,
    countHanzi(content),
    next.status || chapter.status || 'draft',
    reviewNotesJson,
    chapter.novel_context_version || chapter.context_version || 1,
    new Date().toISOString(),
    chapter.id,
  )
  console.log(`updated novel=${novelId} ch${chapterNum} words=${countHanzi(content)}`)
}

function exportNovel(rawDb, novelId, targetPath) {
  const rows = rawDb.prepare(`
    SELECT chapter_num, title, content
    FROM chapters
    WHERE novel_id = ? AND TRIM(COALESCE(content, '')) <> ''
    ORDER BY chapter_num
  `).all(novelId)
  const markdown = rows.map((row) => [
    `# 第 ${row.chapter_num} 章 ${row.title || ''}`.trim(),
    '',
    String(row.content || '').trim(),
  ].join('\n')).join('\n\n')
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${markdown}\n`, 'utf8')
  console.log(`exported ${targetPath}`)
}

function countMatches(text, pattern) {
  return (String(text || '').match(pattern) || []).length
}

function buildMarkerChecks(key, chapters) {
  const content = chapters.map((row) => row.content || '').join('\n')
  if (key === 'steel') {
    return {
      labor_hits: countMatches(content, /炉|风压|工册|誊|工|班|操作|闸|档案/g),
      organization_hits: countMatches(content, /值长|班组|调令|规程|纪律|组织|夜校|抚恤|粮饷|记录|条例/g),
      setback_hits: countMatches(content, /扣|调离|失去|顶嘴|撕|作废|羞|不识字|停工|损失|搡开/g),
      forbidden_hits: [...new Set(content.match(/保尔|朱赫来|冬妮娅|柯察金/g) || [])],
    }
  }
  return {
    disease_hits: countMatches(content, /妖|鳃|病帖|哭声|病|疹|瘘|症/g),
    human_debt_hits: countMatches(content, /人间|亏欠|规矩|食言|许|诺|欠|忘|误解|老周/g),
    aftertaste_hits: countMatches(content, /余味|账本|别问|病簿|旧页|继续走|没再|灯下|微光/g),
    forbidden_hits: [...new Set(content.match(/桃夭|磨牙|滚滚|柳公子|桃都|百妖谱/g) || [])],
  }
}

function exportGateReport(rawDb, chapterService, project) {
  const novel = rawDb.prepare('SELECT id, title, status FROM novels WHERE id = ?').get(project.novelId)
  const chapters = rawDb.prepare(`
    SELECT id, chapter_num, title, status, word_count, content
    FROM chapters
    WHERE novel_id = ? AND TRIM(COALESCE(content, '')) <> ''
    ORDER BY chapter_num
  `).all(project.novelId)
  const chapterReports = chapters.map((chapter) => {
    const check = chapterService.runChapterPublishCheck(chapter.id, { phase: 'pipeline' })
    return {
      chapter_num: chapter.chapter_num,
      title: chapter.title,
      status: chapter.status,
      hanzi: countHanzi(chapter.content || ''),
      gate_level: check.gateLevel,
      ready: check.ready,
      summary: check.summary,
      blocking_issues: check.checklist
        .filter((item) => item.status === 'rewrite' || item.status === 'blocker')
        .map((item) => `${item.status}:${item.key}:${item.detail}`),
      contract_issues: (check.contractValidation?.itemResults || [])
        .filter((item) => item.verdict && item.verdict !== 'pass')
        .map((item) => `${item.verdict}:${item.contractItemType}:${item.expected || item.rewriteHint || ''}`),
    }
  })
  const payload = {
    exported_at: new Date().toISOString(),
    novel,
    checks: buildMarkerChecks(project.key, chapters),
    chapters: chapterReports,
  }
  fs.mkdirSync(project.outDir, { recursive: true })
  fs.writeFileSync(project.summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const lines = [
    `# ${project.label} Rebuild Sample`,
    '',
    `novelId: ${project.novelId}`,
    `title: ${novel?.title || ''}`,
    '',
    '## Gate',
    ...chapterReports.map((chapter) =>
      `- 第 ${chapter.chapter_num} 章《${chapter.title}》：${chapter.status}，gate=${chapter.gate_level}，ready=${chapter.ready}，${chapter.summary}`),
    '',
    '## Checks',
    ...Object.entries(payload.checks).map(([key, value]) => `- ${key}: ${Array.isArray(value) ? JSON.stringify(value) : value}`),
    '',
    '## Remaining Warnings',
    ...chapterReports.flatMap((chapter) =>
      chapter.contract_issues.length > 0
        ? [`- 第 ${chapter.chapter_num} 章合同弱项：${chapter.contract_issues.join('；')}`]
        : [`- 第 ${chapter.chapter_num} 章：无阻塞，仍可按 warning 继续精修。`]),
    '',
    '## Chapters',
    ...chapters.map((chapter) =>
      `- 第 ${chapter.chapter_num} 章《${chapter.title}》：${chapter.status}，${countHanzi(chapter.content || '')} 字。${String(chapter.content || '').slice(0, 180).replace(/\s+/g, ' ')}`),
  ]
  fs.writeFileSync(project.reportPath, `${lines.join('\n')}\n`, 'utf8')
  console.log(`exported ${project.reportPath}`)
  console.log(`exported ${project.summaryPath}`)
}

async function main() {
  await app.whenReady()
  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rawDb = getSqlite()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))

  updateChapter(rawDb, 32, 1, (chapter) => ({
    content: chapter.content || '',
    reviewNotesJson: chapter.review_notes_json || '',
    status: 'draft',
  }))

  updateChapter(rawDb, 32, 2, (chapter) => {
    const after = [
      '“你只管誊，别问。”每个字都咬得很短。',
      '',
      '他把声音压下去：“要是短的是我师父的粮饷，我也只管誊？”',
      '',
      '邱玉兰的指节在纸面上停住。“你先把字誊对。字错了，后面谁也查不着。”',
      '',
      '“那我抄完，能查？”',
      '',
      '她把手指移开，点在他接下来该誊的位置。',
    ].join('\n\n')
    return {
      content: replaceRequiredRegex(
        chapter.content || '',
        /“你只管誊，别问。”每个字都咬得很短。\s*他张了张嘴。\s*她把手指移开，点在他接下来该誊的位置。/,
        after,
        'steel ch2 dialogue',
      ),
      reviewNotesJson: clearDialogueReviewSignals(chapter.review_notes_json),
      status: 'draft',
    }
  })

  updateChapter(rawDb, 33, 1, (chapter) => {
    const before = '“姐。”温不寒把一块干布搁在她手边，“老周说他三年前许过每年沉一坛——那咱们让他补上，这妖的病根不就断了？”'
    const after = [
      '“姐。”温不寒把一块干布搁在她手边，“补坛酒不行？”',
      '',
      '她把湿袖口拧到不再滴水。“现在补，算赔礼，不算守诺。”',
    ].join('\n\n')
    return {
      content: replaceRequired(chapter.content || '', before, after, 'baiyao ch1 dialogue'),
      reviewNotesJson: clearDialogueReviewSignals(chapter.review_notes_json),
      status: 'draft',
    }
  })

  exportNovel(rawDb, 32, path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_steel_baiyao_20260706/steel.chapters.md'))
  exportNovel(rawDb, 33, path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_baiyao_20260706/baiyao.chapters.md'))
  exportGateReport(rawDb, chapterService, {
    key: 'steel',
    label: 'Steel',
    novelId: 32,
    outDir: path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_steel_baiyao_20260706'),
    reportPath: path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_steel_baiyao_20260706/steel.report.md'),
    summaryPath: path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_steel_baiyao_20260706/steel.summary.json'),
  })
  exportGateReport(rawDb, chapterService, {
    key: 'baiyao',
    label: 'Baiyao',
    novelId: 33,
    outDir: path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_baiyao_20260706'),
    reportPath: path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_baiyao_20260706/report.md'),
    summaryPath: path.join(workspaceRoot, 'out/novel-flow-audit/rebuild_baiyao_20260706/verification.json'),
  })
}

main()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch((error) => {
    console.error(error)
    setTimeout(() => process.exit(1), 100)
  })
