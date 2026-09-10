'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

function totalChanges(db) {
  return Number(db.prepare('SELECT total_changes() AS count').get().count)
}

function loadBaselineDashboard(workspaceRoot) {
  const filename = path.join(workspaceRoot, 'electron', 'services', 'quality-dashboard.service.ts')
  const source = execFileSync('git', ['show', 'HEAD:electron/services/quality-dashboard.service.ts'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  })
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  const baselineModule = new Module(filename)
  baselineModule.filename = filename
  baselineModule.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalResolveFilename = Module._resolveFilename
  const originalTsLoader = require.extensions['.ts']
  Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
    if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
      const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
      for (const extension of ['.ts', '.tsx', '.js', '.json']) {
        const candidate = path.resolve(baseDir, `${request}${extension}`)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }
  require.extensions['.ts'] = (module, tsFilename) => {
    const tsSource = fs.readFileSync(tsFilename, 'utf8')
    const compiled = ts.transpileModule(tsSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: tsFilename,
    }).outputText
    module._compile(compiled, tsFilename)
  }
  try {
    baselineModule._compile(outputText, filename)
    return baselineModule.exports
  } finally {
    Module._resolveFilename = originalResolveFilename
    if (originalTsLoader) require.extensions['.ts'] = originalTsLoader
    else delete require.extensions['.ts']
  }
}

async function run({ workspaceRoot, tempRoot, Database, runMigrations, loadTypeScriptModule }) {
  fs.mkdirSync(tempRoot, { recursive: true })
  const dbPath = path.join(tempRoot, `nf16-${process.pid}-${Date.now()}.sqlite`)
  const sqlLog = []
  const db = new Database(dbPath, { verbose: (sql) => sqlLog.push(sql) })
  const { drizzle } = require('drizzle-orm/better-sqlite3')
  const schema = loadTypeScriptModule('electron/database/schema.ts')
  const orm = drizzle(db, { schema })
  const databaseModule = loadTypeScriptModule('electron/database/db.ts')
  const storyStructureModule = loadTypeScriptModule('electron/services/story-structure.service.ts')
  const storyMemoryModule = loadTypeScriptModule('electron/services/story-memory.service.ts')
  const endgameModule = loadTypeScriptModule('electron/services/endgame-asset.service.ts')
  const storyThreadModule = loadTypeScriptModule('electron/services/story-thread.service.ts')
  const originalGetDb = databaseModule.getDb
  const originalGetSqlite = databaseModule.getSqlite
  const originalEnsureStoryStructure = storyStructureModule.ensureStoryStructure
  const originalBuildStoryMemoryPromptPackage = storyMemoryModule.buildStoryMemoryPromptPackage
  const originalGetEndgameDebtSnapshot = endgameModule.getEndgameDebtSnapshot
  const originalGetForeshadowSnapshot = storyThreadModule.getForeshadowSnapshot
  const originalFetch = global.fetch
  let networkCalls = 0
  try {
    runMigrations(db)
    const novelId = Number(db.prepare(`
      INSERT INTO novels (title, context_version, target_words, launch_mode)
      VALUES ('NF-16 隔离看板', 7, 120000, 'standard')
    `).run().lastInsertRowid)
    db.prepare(`
      INSERT INTO chapters (
        novel_id, chapter_num, title, content, summary, continuity_state_json,
        ai_score_json, review_notes_json, context_version
      ) VALUES (?, 1, '潮汐钟', '钟声落下，调查继续。', '调查推进。', '{}', ?, ?, 7)
    `).run(
      novelId,
      JSON.stringify({ overallScore: 82, aiLikeRate: 12, dimensions: [{ name: '逻辑连贯', score: 80 }] }),
      JSON.stringify({
        issues: [{
          id: 'nf16-advice', ruleId: 'genre_register_drift', category: 'style', level: 'advice',
          detector: 'heuristic', confidence: null, evidence: [], scope: 'chapter', message: '语域轻微漂移',
        }],
        contract_validation: {
          status: 'warning', summary: '线索仍需推进',
          itemResults: [{ contractItemType: 'story_thread_progress', expected: '推进港口线索', verdict: 'weak' }],
          rewriteHints: [],
        },
      }),
    )

    databaseModule.getDb = () => orm
    databaseModule.getSqlite = () => db
    storyStructureModule.ensureStoryStructure = () => {
      throw new Error('NF16_READ_PATH_CALLED_ENSURE_STORY_STRUCTURE')
    }
    storyMemoryModule.buildStoryMemoryPromptPackage = (id, options = {}) => (
      originalBuildStoryMemoryPromptPackage(id, { ...options, readOnly: true })
    )
    endgameModule.getEndgameDebtSnapshot = (id) => originalGetEndgameDebtSnapshot(id, { readOnly: true })
    storyThreadModule.getForeshadowSnapshot = (id, chapterNum) => (
      originalGetForeshadowSnapshot(id, chapterNum, { readOnly: true })
    )
    global.fetch = async () => {
      networkCalls += 1
      throw new Error('NF16_DASHBOARD_MUST_NOT_CALL_NETWORK')
    }

    const baselineDashboard = loadBaselineDashboard(workspaceRoot)
    const dashboard = loadTypeScriptModule('electron/services/quality-dashboard.service.ts')
    sqlLog.length = 0
    const before = totalChanges(db)
    baselineDashboard.getQualityDashboardData(novelId, { includeDialogueInsights: false })
    const baselineDto = baselineDashboard.getQualityDashboardData(novelId, { includeDialogueInsights: false })
    const opened = dashboard.getQualityDashboardData(novelId, { includeDialogueInsights: false })
    const afterOpen = totalChanges(db)
    const first = dashboard.getQualityDashboardData(novelId)
    const second = dashboard.getQualityDashboardData(novelId)
    const afterRefresh = totalChanges(db)

    assert.deepEqual(second, first)
    assert.deepEqual(opened, baselineDto)
    assert.equal(afterOpen, before, `dashboard writes: ${sqlLog.filter((sql) => /^(insert|update|delete|replace)/iu.test(sql.trim())).join(' | ')}`)
    assert.equal(afterRefresh, before)
    assert.equal(networkCalls, 0)
    assert.equal(opened.chapterDetails[0].chapterNum, 1)
    assert.equal(first.chapterDetails[0].chapterNum, 1)
    assert.equal(first.averageOverallScore, second.averageOverallScore)

    return {
      cases: {
        '16-03': 'PASS',
        '16-05': 'PASS',
      },
      assertions: [
        'dashboard open and refresh perform zero SQLite writes',
        'dashboard performs zero network/model calls',
        'refresh preserves the complete DTO, ordering and scores',
      ],
      sqlite: { dbPath, totalChangesBefore: before, totalChangesAfter: afterRefresh },
    }
  } finally {
    global.fetch = originalFetch
    databaseModule.getDb = originalGetDb
    databaseModule.getSqlite = originalGetSqlite
    storyStructureModule.ensureStoryStructure = originalEnsureStoryStructure
    storyMemoryModule.buildStoryMemoryPromptPackage = originalBuildStoryMemoryPromptPackage
    endgameModule.getEndgameDebtSnapshot = originalGetEndgameDebtSnapshot
    storyThreadModule.getForeshadowSnapshot = originalGetForeshadowSnapshot
    db.close()
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${dbPath}${suffix}`
      if (fs.existsSync(target)) fs.rmSync(target)
    }
  }
}

module.exports = { run }
