const fs = require('node:fs')
const path = require('node:path')

function parseArgs(argv) {
  const options = {
    dbPath: process.env.NOVELFORGE_DB_PATH || '',
    inputPath: '',
    novelId: Number(process.env.NOVELFORGE_SOAK_NOVEL_ID || 0) || 0,
    taskId: Number(process.env.NOVELFORGE_SOAK_TASK_ID || 0) || 0,
    outPath: '',
    provider: process.env.NOVELFORGE_SOAK_PROVIDER || '',
    model: process.env.NOVELFORGE_SOAK_MODEL || '',
    modelConfigId: process.env.NOVELFORGE_SOAK_MODEL_CONFIG_ID || '',
    runId: process.env.NOVELFORGE_SOAK_RUN_ID || '',
    realModelCalled: undefined,
    listNovels: false,
    json: false,
    help: false,
  }

  argv.forEach((arg, index) => {
    const readValue = (prefix) => arg.startsWith(prefix) ? arg.slice(prefix.length) : argv[index + 1]
    if (arg === '--help' || arg === '-h') options.help = true
    if (arg === '--json') options.json = true
    if (arg === '--list-novels') options.listNovels = true
    if (arg === '--real-model-called') options.realModelCalled = true
    if (arg === '--no-real-model-called') options.realModelCalled = false
    if (arg.startsWith('--db=')) options.dbPath = path.resolve(process.cwd(), readValue('--db='))
    if (arg === '--db' && argv[index + 1]) options.dbPath = path.resolve(process.cwd(), argv[index + 1])
    if (arg.startsWith('--input=')) options.inputPath = path.resolve(process.cwd(), readValue('--input='))
    if (arg === '--input' && argv[index + 1]) options.inputPath = path.resolve(process.cwd(), argv[index + 1])
    if (arg.startsWith('--novelId=')) options.novelId = Number(readValue('--novelId=')) || 0
    if (arg === '--novelId' && argv[index + 1]) options.novelId = Number(argv[index + 1]) || 0
    if (arg.startsWith('--novel-id=')) options.novelId = Number(readValue('--novel-id=')) || 0
    if (arg === '--novel-id' && argv[index + 1]) options.novelId = Number(argv[index + 1]) || 0
    if (arg.startsWith('--taskId=')) options.taskId = Number(readValue('--taskId=')) || 0
    if (arg === '--taskId' && argv[index + 1]) options.taskId = Number(argv[index + 1]) || 0
    if (arg.startsWith('--task-id=')) options.taskId = Number(readValue('--task-id=')) || 0
    if (arg === '--task-id' && argv[index + 1]) options.taskId = Number(argv[index + 1]) || 0
    if (arg.startsWith('--out=')) options.outPath = path.resolve(process.cwd(), readValue('--out='))
    if (arg === '--out' && argv[index + 1]) options.outPath = path.resolve(process.cwd(), argv[index + 1])
    if (arg.startsWith('--provider=')) options.provider = readValue('--provider=')
    if (arg === '--provider' && argv[index + 1]) options.provider = argv[index + 1]
    if (arg.startsWith('--model=')) options.model = readValue('--model=')
    if (arg === '--model' && argv[index + 1]) options.model = argv[index + 1]
    if (arg.startsWith('--modelConfigId=')) options.modelConfigId = readValue('--modelConfigId=')
    if (arg === '--modelConfigId' && argv[index + 1]) options.modelConfigId = argv[index + 1]
    if (arg.startsWith('--model-config-id=')) options.modelConfigId = readValue('--model-config-id=')
    if (arg === '--model-config-id' && argv[index + 1]) options.modelConfigId = argv[index + 1]
    if (arg.startsWith('--runId=')) options.runId = readValue('--runId=')
    if (arg === '--runId' && argv[index + 1]) options.runId = argv[index + 1]
    if (arg.startsWith('--run-id=')) options.runId = readValue('--run-id=')
    if (arg === '--run-id' && argv[index + 1]) options.runId = argv[index + 1]
  })

  return options
}

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/export-chapter-soak-report.cjs --db path/to/novelforge.db --list-novels --json',
    '  node scripts/export-chapter-soak-report.cjs --db path/to/novelforge.db --novelId 1 --out .tmp-tests/real-report.json',
    '  node scripts/export-chapter-soak-report.cjs --input path/to/run-status.json --real-model-called --provider openai --model gpt-5 --run-id nightly-001 --out .tmp-tests/real-report.json',
    '',
    'Options:',
    '  --list-novels       List read-only project scale and continuity coverage before selecting a run.',
    '  --input <path>      Optional JSON run status/report to normalize without opening SQLite.',
    '  --taskId <id>        Optional chapter_batch_generate or chapter_write task id to scope the report.',
    '  --task-id <id>       Alias for --taskId.',
    '  --novel-id <id>      Alias for --novelId.',
    '  --provider <name>    Overrides model provider provenance when it cannot be inferred.',
    '  --model <id>         Overrides model id provenance when it cannot be inferred.',
    '  --modelConfigId <id> Overrides model config provenance.',
    '  --model-config-id <id> Alias for --modelConfigId.',
    '  --runId <id>         Optional external run id.',
    '  --run-id <id>        Alias for --runId.',
    '  --real-model-called Mark the report as coming from an already completed real model run.',
    '  --json               Print the report JSON to stdout.',
  ].join('\n'))
}

function readJson(raw, fallback) {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function openReadonlyDb(dbPath, DatabaseConstructor) {
  let Database = DatabaseConstructor
  if (!Database) {
    try {
      Database = require('better-sqlite3')
    } catch (error) {
      throw new Error(`Cannot load better-sqlite3. Use --input=<json> or run in the Electron-compatible runtime. ${error.message}`)
    }
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

function uniq(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))]
}

function percentile(values, pct) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right)
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)
  return sorted[index]
}

function listNovelInventory(db, dbPath) {
  const rows = db.prepare(`
    SELECT
      novel.id,
      novel.title,
      novel.target_words AS targetWords,
      novel.launch_mode AS launchMode,
      novel.context_version AS contextVersion,
      COUNT(chapter.id) AS chapterCount,
      COALESCE(MAX(chapter.chapter_num), 0) AS latestChapterNum,
      COALESCE(SUM(chapter.word_count), 0) AS totalWords,
      COALESCE(SUM(CASE WHEN TRIM(COALESCE(chapter.summary, '')) <> '' THEN 1 ELSE 0 END), 0) AS summaryChapterCount,
      COALESCE(SUM(CASE WHEN TRIM(COALESCE(chapter.continuity_state_json, '')) <> '' THEN 1 ELSE 0 END), 0) AS continuityChapterCount,
      (
        SELECT COUNT(*)
        FROM tasks AS task
        WHERE task.novel_id = novel.id
          AND task.type = 'chapter_write'
          AND task.runner_type = 'workflow'
          AND task.parent_task_id IS NULL
      ) AS chapterTaskCount,
      (
        SELECT COUNT(*)
        FROM tasks AS task
        WHERE task.novel_id = novel.id
          AND task.type = 'chapter_write'
          AND task.runner_type = 'workflow'
          AND task.parent_task_id IS NULL
          AND task.status = 'success'
      ) AS successfulChapterTaskCount
    FROM novels AS novel
    LEFT JOIN chapters AS chapter
      ON chapter.novel_id = novel.id
    GROUP BY novel.id
    ORDER BY chapterCount DESC, novel.id ASC
  `).all()

  return {
    mode: 'novel-inventory',
    invokedAt: new Date().toISOString(),
    source: {
      dbPath,
      readonly: true,
    },
    novels: rows.map((row) => {
      const chapterCount = Number(row.chapterCount || 0)
      const summaryChapterCount = Number(row.summaryChapterCount || 0)
      const continuityChapterCount = Number(row.continuityChapterCount || 0)
      return {
        id: Number(row.id),
        title: row.title || '',
        targetWords: Number(row.targetWords || 0),
        launchMode: row.launchMode || '',
        contextVersion: Number(row.contextVersion || 1),
        chapterCount,
        latestChapterNum: Number(row.latestChapterNum || 0),
        totalWords: Number(row.totalWords || 0),
        summaryChapterCount,
        continuityChapterCount,
        summaryCoverageRate: chapterCount > 0 ? summaryChapterCount / chapterCount : 0,
        continuityCoverageRate: chapterCount > 0 ? continuityChapterCount / chapterCount : 0,
        chapterTaskCount: Number(row.chapterTaskCount || 0),
        successfulChapterTaskCount: Number(row.successfulChapterTaskCount || 0),
      }
    }),
  }
}

function truthyContent(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function getStructuredPackCount(pack) {
  if (!pack || typeof pack !== 'object') return 0
  return [
    Array.isArray(pack.characters) ? pack.characters.length : 0,
    Array.isArray(pack.items) ? pack.items.length : 0,
    Array.isArray(pack.mapLocations) ? pack.mapLocations.length : 0,
    Array.isArray(pack.timeline) ? pack.timeline.length : 0,
    Array.isArray(pack.recall?.hits) ? pack.recall.hits.length : 0,
    Array.isArray(pack.threads?.activeThreadLines) ? pack.threads.activeThreadLines.length : 0,
    Array.isArray(pack.worldState?.stateLines) ? pack.worldState.stateLines.length : 0,
    pack.storyMemory ? 1 : 0,
  ].reduce((sum, count) => sum + count, 0)
}

function getOverrideContentCount(overrides) {
  if (!overrides || typeof overrides !== 'object') return 0
  return Object.values(overrides).filter(truthyContent).length
}

function collectRootChapterTasks(db, options, scopedTask) {
  const params = []
  const where = [
    "type = 'chapter_write'",
    "runner_type = 'workflow'",
    "related_entity_type = 'chapter'",
    'parent_task_id IS NULL',
  ]
  if (options.novelId) {
    where.push('novel_id = ?')
    params.push(options.novelId)
  }

  let rows = db.prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY id ASC`).all(...params)
  if (!scopedTask) return rows

  if (scopedTask.type === 'chapter_write') {
    return rows.filter((row) => row.id === scopedTask.id)
  }

  const progress = readJson(scopedTask.progress_json, {})
  const chapterIds = Array.isArray(progress.chapterIds) ? progress.chapterIds : []
  if (chapterIds.length === 0) return rows
  const wanted = new Set(chapterIds.map(Number))
  return rows.filter((row) => wanted.has(Number(row.related_entity_id)))
}

function inferModelConfig(db, rootTasks, options) {
  const explicitId = Number(options.modelConfigId) || 0
  const modelConfigId = explicitId
    || rootTasks.map((row) => Number(row.model_config_id || 0)).find(Boolean)
    || 0
  const row = modelConfigId
    ? db.prepare('SELECT * FROM model_configs WHERE id = ?').get(modelConfigId)
    : null
  return {
    modelConfigId: modelConfigId || '',
    provider: options.provider || row?.provider || '',
    model: options.model || row?.model_id || '',
  }
}

function resolveRequestedChapterCount(rootTasks, scopedTask) {
  if (!scopedTask) return rootTasks.length
  const progress = readJson(scopedTask.progress_json, {})
  if (typeof progress.totalBatches === 'number') return progress.totalBatches
  if (Array.isArray(progress.chapterIds)) return progress.chapterIds.length
  return rootTasks.length
}

function buildReport(db, options) {
  const scopedTask = options.taskId
    ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(options.taskId)
    : null
  if (options.taskId && !scopedTask) throw new Error(`Task ${options.taskId} was not found`)

  const rootTasks = collectRootChapterTasks(db, options, scopedTask)
  const chapterIds = uniq(rootTasks.map((row) => Number(row.related_entity_id || 0)).filter(Boolean))
  const chapterRows = chapterIds.length > 0
    ? db.prepare(`SELECT * FROM chapters WHERE id IN (${chapterIds.map(() => '?').join(',')})`).all(...chapterIds)
    : []
  const chapterById = new Map(chapterRows.map((row) => [Number(row.id), row]))
  const modelConfig = inferModelConfig(db, rootTasks, options)

  const snapshots = rootTasks.map((task) => ({
    task,
    chapter: chapterById.get(Number(task.related_entity_id || 0)),
    progress: readJson(task.progress_json, {}),
  }))
  const completed = snapshots.filter((entry) => entry.task.status === 'success')
  const requestedChapters = resolveRequestedChapterCount(rootTasks, scopedTask)
  const completedChapters = completed.length
  const failedChapters = Math.max(0, requestedChapters - completedChapters)
  const durations = snapshots.map((entry) => Number(entry.progress.totalDurationMs || entry.task.duration_ms || 0)).filter(Boolean)
  const recallFallbackChapters = snapshots.filter((entry) => entry.progress.recallSnapshot?.degraded === true).length

  const sortedByChapter = [...snapshots].sort((left, right) =>
    Number(left.chapter?.chapter_num || 0) - Number(right.chapter?.chapter_num || 0))
  let streak = 0
  let maxRecallFallbackStreak = 0
  sortedByChapter.forEach((entry) => {
    if (entry.progress.recallSnapshot?.degraded === true) {
      streak += 1
      maxRecallFallbackStreak = Math.max(maxRecallFallbackStreak, streak)
    } else {
      streak = 0
    }
  })

  const wordRatios = completed.map((entry) => {
    const chapter = entry.chapter
    if (!chapter) return 0
    const target = Math.max(Number(chapter.target_words || 0), 1)
    return Math.min(1, Number(chapter.word_count || 0) / target)
  })

  const writerResolutions = snapshots
    .map((entry) => entry.progress.writerContextResolution)
    .filter((item) => item && typeof item === 'object')
  const contextExpected = writerResolutions.filter((item) =>
    Array.isArray(item.queryPlan) && item.queryPlan.some((step) => step.enabled)).length
  const contextHits = writerResolutions.filter((item) =>
    getStructuredPackCount(item.structuredPack) > 0 || getOverrideContentCount(item.renderedContextOverrides) > 0).length
  const contextHitRate = contextExpected > 0 ? contextHits / contextExpected : (completedChapters > 0 ? 1 : 0)

  const aliasExpected = writerResolutions.filter((item) => {
    const inputs = item.retrievalFingerprint?.inputs || {}
    return Number(inputs.mentionedCharacterCount || 0)
      + Number(inputs.mentionedItemCount || 0)
      + Number(inputs.mentionedLocationCount || 0)
      + Number(inputs.mentionedFactionCount || 0) > 0
  }).length
  const aliasHits = writerResolutions.filter((item) =>
    getStructuredPackCount(item.structuredPack) > 0).length
  const aliasHitRate = aliasExpected > 0 ? Math.min(1, aliasHits / aliasExpected) : (completedChapters > 0 ? 1 : 0)

  const contractExpected = snapshots.filter((entry) => truthyContent(entry.task.contract_version)).length
  const contractHits = snapshots.filter((entry) => {
    const overrides = entry.progress.writerContextResolution?.renderedContextOverrides || {}
    return truthyContent(overrides.writingContractSummary) || truthyContent(overrides.continuityNotes)
  }).length
  const contractAssetHitRate = contractExpected > 0 ? Math.min(1, contractHits / contractExpected) : (completedChapters > 0 ? 1 : 0)

  const pipelineRolesCovered = uniq(snapshots.flatMap((entry) => {
    const roles = entry.progress.roles && typeof entry.progress.roles === 'object'
      ? Object.keys(entry.progress.roles)
      : []
    return roles.length > 0 ? roles : [entry.task.pipeline_role].filter(Boolean)
  }))

  const blockedWritebacks = chapterRows.filter((chapter) => {
    const status = readJson(chapter.writeback_status_json, {})
    return status.blockedGeneration === true || status.readyForNextChapter === false
  }).length
  const publishGateFailures = snapshots.filter((entry) =>
    entry.task.pipeline_stage === 'blocked' || entry.progress.failureCode === 'publish_gate_blocked').length

  return {
    mode: 'real-run-export',
    invokedAt: new Date().toISOString(),
    realModelCalled: typeof options.realModelCalled === 'boolean' ? options.realModelCalled : completedChapters > 0,
    provenance: {
      provider: modelConfig.provider,
      model: modelConfig.model,
      modelConfigId: modelConfig.modelConfigId ? String(modelConfig.modelConfigId) : '',
      runId: options.runId || (scopedTask ? `task:${scopedTask.id}` : `novel:${options.novelId || 'unknown'}`),
    },
    source: {
      dbPath: options.dbPath,
      novelId: options.novelId || undefined,
      taskId: options.taskId || undefined,
      chapterTaskIds: rootTasks.map((row) => row.id),
    },
    metrics: {
      observed: true,
      requestedChapters,
      completedChapters,
      failedChapters,
      successRate: requestedChapters > 0 ? completedChapters / requestedChapters : 0,
      p95ChapterDurationMs: percentile(durations, 95),
      consecutiveRecallFallbackChapters: maxRecallFallbackStreak,
      minWordRatio: wordRatios.length > 0 ? Math.min(...wordRatios) : 0,
      contextHitRate,
      aliasHitRate,
      contractAssetHitRate,
      recallFallbackRate: completedChapters > 0 ? recallFallbackChapters / completedChapters : 0,
      recallFallbackChapters,
      publishGateFailures,
      blockedWritebacks,
      pipelineRolesCovered,
    },
  }
}

function normalizeInputReport(raw, options) {
  if (raw.metrics && typeof raw.metrics === 'object') {
    return {
      ...raw,
      mode: raw.mode === 'report-validation' ? 'real-run-export' : raw.mode || 'real-run-export',
      invokedAt: raw.invokedAt || new Date().toISOString(),
      realModelCalled: typeof options.realModelCalled === 'boolean' ? options.realModelCalled : raw.realModelCalled === true,
      provenance: {
        ...(raw.provenance || {}),
        source: raw.provenance?.source || 'json',
        provider: options.provider || raw.provenance?.provider || raw.modelProvider || '',
        model: options.model || raw.provenance?.model || raw.model || '',
        modelConfigId: options.modelConfigId || raw.provenance?.modelConfigId || raw.modelConfigId || '',
        runId: options.runId || raw.provenance?.runId || raw.runId || '',
        exportedAt: raw.provenance?.exportedAt || new Date().toISOString(),
      },
      metrics: {
        ...raw.metrics,
        observed: raw.metrics.observed === true || (
          raw.metrics.observed !== false
          && raw.metrics.completedChapters !== null
          && raw.metrics.completedChapters !== undefined
          && raw.metrics.successRate !== null
          && raw.metrics.successRate !== undefined
        ),
        pipelineRolesCovered: Array.isArray(raw.metrics.pipelineRolesCovered)
          ? raw.metrics.pipelineRolesCovered
          : ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize'],
      },
    }
  }

  const chapters = Array.isArray(raw.chapters) ? raw.chapters : []
  const completed = chapters.filter((chapter) => chapter.status === 'success' || chapter.completed === true)
  const failed = chapters.filter((chapter) => chapter.status === 'failed' || chapter.failed === true)
  const durations = completed
    .map((chapter) => Number(chapter.durationMs || chapter.totalDurationMs || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  const wordRatios = completed.map((chapter) => {
    const target = Math.max(Number(chapter.targetWords || raw.chapterTargetWords || 0), 1)
    return Math.min(1, Number(chapter.wordCount || 0) / target)
  })
  const requestedChapters = Number(raw.requestedChapters || raw.workflow?.requestedChapters || chapters.length || 0)
  const aliasExpected = completed.reduce((sum, chapter) => sum + Number(chapter.aliasRequirementCount || 0), 0)
  const aliasHits = completed.reduce((sum, chapter) => sum + Number(chapter.aliasHitCount || 0), 0)
  const contractExpected = completed.reduce((sum, chapter) => sum + Number(chapter.contractAssetRequirementCount || 0), 0)
  const contractHits = completed.reduce((sum, chapter) => sum + Number(chapter.contractAssetHitCount || 0), 0)
  const recallFallbackChapters = completed.filter((chapter) => chapter.recallFallback === true || chapter.recallSnapshot?.degraded === true).length
  const pipelineRolesCovered = uniq(chapters.flatMap((chapter) => {
    if (Array.isArray(chapter.pipelineRolesCovered)) return chapter.pipelineRolesCovered
    if (Array.isArray(chapter.rolesCovered)) return chapter.rolesCovered
    if (chapter.roles && typeof chapter.roles === 'object') return Object.keys(chapter.roles)
    return []
  }))

  return {
    mode: 'real-run-export',
    invokedAt: new Date().toISOString(),
    realModelCalled: typeof options.realModelCalled === 'boolean' ? options.realModelCalled : raw.realModelCalled === true,
    provenance: {
      ...(raw.provenance || {}),
      source: raw.provenance?.source || 'json',
      provider: options.provider || raw.provenance?.provider || raw.modelProvider || '',
      model: options.model || raw.provenance?.model || raw.model || '',
      modelConfigId: options.modelConfigId || raw.provenance?.modelConfigId || raw.modelConfigId || '',
      runId: options.runId || raw.provenance?.runId || raw.runId || '',
      exportedAt: new Date().toISOString(),
    },
    metrics: {
      observed: chapters.length > 0,
      requestedChapters,
      completedChapters: completed.length,
      failedChapters: failed.length,
      successRate: requestedChapters > 0 ? completed.length / requestedChapters : 0,
      p95ChapterDurationMs: percentile(durations, 95),
      consecutiveRecallFallbackChapters: Number(raw.consecutiveRecallFallbackChapters || raw.workflow?.consecutiveRecallFallbackChapters || 0),
      minWordRatio: wordRatios.length > 0 ? Math.min(...wordRatios) : 0,
      contextHitRate: completed.length > 0
        ? completed.filter((chapter) => chapter.contextHit !== false).length / completed.length
        : 0,
      aliasHitRate: aliasExpected > 0 ? Math.min(1, aliasHits / aliasExpected) : (completed.length > 0 ? 1 : 0),
      contractAssetHitRate: contractExpected > 0 ? Math.min(1, contractHits / contractExpected) : (completed.length > 0 ? 1 : 0),
      recallFallbackRate: completed.length > 0 ? recallFallbackChapters / completed.length : 0,
      recallFallbackChapters,
      publishGateFailures: Number(raw.publishGateFailures || raw.workflow?.publishGateFailures || 0),
      blockedWritebacks: Number(raw.blockedWritebacks || raw.workflow?.blockedWritebacks || 0),
      pipelineRolesCovered: pipelineRolesCovered.length > 0
        ? pipelineRolesCovered
        : ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize'],
    },
  }
}

function writeReport(outPath, report) {
  if (!outPath) return
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
}

function runCli() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (options.inputPath) {
    if (!fs.existsSync(options.inputPath)) throw new Error(`Input file not found: ${options.inputPath}`)
    const report = normalizeInputReport(readJsonFile(options.inputPath), options)
    writeReport(options.outPath, report)
    if (options.json || !options.outPath) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`chapter soak report exported: ${path.relative(process.cwd(), options.outPath)}`)
      console.log(`validate with: npm run test:chapter-soak -- --report ${options.outPath}`)
    }
    return
  }
  if (!options.dbPath) throw new Error('Missing --db path or NOVELFORGE_DB_PATH')
  if (!fs.existsSync(options.dbPath)) throw new Error(`Database file not found: ${options.dbPath}`)
  if (!options.listNovels && !options.novelId && !options.taskId) {
    throw new Error('Provide --list-novels, --novelId, or --taskId')
  }

  const db = openReadonlyDb(options.dbPath)
  try {
    if (options.listNovels) {
      const inventory = listNovelInventory(db, options.dbPath)
      writeReport(options.outPath, inventory)
      if (options.json || !options.outPath) {
        console.log(JSON.stringify(inventory, null, 2))
      } else {
        console.log(`novel inventory exported: ${path.relative(process.cwd(), options.outPath)}`)
      }
      return
    }
    const report = buildReport(db, options)
    writeReport(options.outPath, report)
    if (options.json || !options.outPath) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`chapter soak report exported: ${path.relative(process.cwd(), options.outPath)}`)
      console.log(`validate with: npm run test:chapter-soak -- --report ${options.outPath}`)
    }
  } finally {
    db.close()
  }
}

async function main() {
  if (process.versions.electron) {
    const { app } = require('electron')
    await app.whenReady()
    try {
      runCli()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  runCli()
}

const invokedAsCli = require.main === module
  || process.argv.slice(1).some((arg) => path.resolve(arg) === __filename)

if (invokedAsCli) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = {
  listNovelInventory,
  normalizeInputReport,
  openReadonlyDb,
  parseArgs,
}
