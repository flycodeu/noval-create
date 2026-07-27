const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'delete-integrity')
if (!tempRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}

function project(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function listTables(sqlite) {
  return sqlite.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => String(row.name))
}

function tableColumns(sqlite, tableName) {
  return sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((row) => String(row.name))
}

function rowsByNovel(sqlite, tableName, novelId) {
  return sqlite.prepare(`SELECT * FROM ${quoteIdentifier(tableName)} WHERE novel_id = ?`).all(novelId)
}

async function run() {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.mkdirSync(tempRoot, { recursive: true })
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  app.setName('NovelForge Delete Integrity')
  app.setPath('userData', tempRoot)
  app.commandLine.appendSwitch('disable-gpu')
  registerProjectTsRuntime(workspaceRoot)
  await app.whenReady()

  const { closeDb, getSqlite, initDb } = project('electron/database/db.ts')
  const novelService = project('electron/services/novel.service.ts')
  const chapterService = project('electron/services/chapter.service.ts')
  const characterService = project('electron/services/character.service.ts')
  const storyThreadService = project('electron/services/story-thread.service.ts')
  const timelineService = project('electron/services/timeline.service.ts')
  const mapService = project('electron/services/map.service.ts')
  const growthSystemService = project('electron/services/growth-system.service.ts')
  const glossaryService = project('electron/services/glossary.service.ts')
  const sceneTemplateService = project('electron/services/scene-template.service.ts')
  const revisionTaskService = project('electron/services/revision-task.service.ts')
  initDb()

  try {
    const sqlite = getSqlite()
    const victimNovel = novelService.createNovel({ title: '待删除小说', targetWords: 10000 })
    const survivorNovel = novelService.createNovel({ title: '保留小说', targetWords: 10000 })

    const victimChapter = chapterService.createChapter(victimNovel, { chapterNum: 1, title: '待删除章节' })
    const survivorChapter = chapterService.createChapter(survivorNovel, { chapterNum: 1, title: '保留章节' })
    characterService.createCharacter(victimNovel, { fullName: '待删除角色' }, { skipContextTracking: true })
    characterService.createCharacter(survivorNovel, { fullName: '保留角色' }, { skipContextTracking: true })
    storyThreadService.createStoryThread(victimNovel, { title: '待删除线程' }, { skipContextTracking: true })
    storyThreadService.createStoryThread(survivorNovel, { title: '保留线程' }, { skipContextTracking: true })
    timelineService.createTimelineEvent(victimNovel, { eventTitle: '待删除事件' }, { skipContextTracking: true })
    timelineService.createTimelineEvent(survivorNovel, { eventTitle: '保留事件' }, { skipContextTracking: true })
    mapService.createMapItem(victimNovel, { level: 0, name: '待删除地点' }, { skipContextTracking: true })
    mapService.createMapItem(survivorNovel, { level: 0, name: '保留地点' }, { skipContextTracking: true })
    growthSystemService.upsertGrowthTrack(victimNovel, { title: '待删除轨道', trackType: 'character' })
    growthSystemService.upsertGrowthTrack(survivorNovel, { title: '保留轨道', trackType: 'character' })
    growthSystemService.upsertResourcePool(victimNovel, { name: '待删除资源池' })
    growthSystemService.upsertResourcePool(survivorNovel, { name: '保留资源池' })
    growthSystemService.upsertRewardCostEvent(victimNovel, { title: '待删除回写', eventType: 'reward' })
    growthSystemService.upsertRewardCostEvent(survivorNovel, { title: '保留回写', eventType: 'reward' })
    glossaryService.createGlossaryEntry(victimNovel, { term: '待删除术语' })
    glossaryService.createGlossaryEntry(survivorNovel, { term: '保留术语' })
    sceneTemplateService.createSceneTemplate({ novelId: victimNovel, name: '待删除模板', category: 'conflict' })
    sceneTemplateService.createSceneTemplate({ novelId: survivorNovel, name: '保留模板', category: 'conflict' })
    revisionTaskService.createRevisionTask(victimNovel, { title: '待删除任务' })
    revisionTaskService.createRevisionTask(survivorNovel, { title: '保留任务' })

    const tables = listTables(sqlite)
    const scopedTables = tables.filter((tableName) => tableColumns(sqlite, tableName).includes('novel_id'))
    const victimScopedRows = new Map(scopedTables.map((tableName) => [tableName, rowsByNovel(sqlite, tableName, victimNovel)]))
    assert.ok(victimScopedRows.get('chapters')?.length, 'victim chapter should be present before deletion')

    const victimChapterIds = (victimScopedRows.get('chapters') || []).map((row) => row.id)
    const victimRunIds = (victimScopedRows.get('chapter_writeback_runs') || []).map((row) => row.id)
    const victimSnapshotIds = (victimScopedRows.get('chapter_batch_snapshots') || []).map((row) => row.id)

    novelService.deleteNovel(victimNovel)

    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM novels WHERE id = ?').get(victimNovel).count, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM novels WHERE id = ?').get(survivorNovel).count, 1)
    for (const tableName of scopedTables) {
      const remaining = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE novel_id = ?`).get(victimNovel).count
      assert.equal(remaining, 0, `novel deletion must clear ${tableName}`)
    }

    for (const tableName of tables) {
      const columns = tableColumns(sqlite, tableName)
      if (columns.includes('chapter_id') && victimChapterIds.length > 0) {
        const remaining = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE chapter_id IN (${victimChapterIds.map(() => '?').join(',')})`).get(...victimChapterIds).count
        assert.equal(remaining, 0, `novel deletion must clear chapter children in ${tableName}`)
      }
      if (columns.includes('run_id') && victimRunIds.length > 0) {
        const remaining = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE run_id IN (${victimRunIds.map(() => '?').join(',')})`).get(...victimRunIds).count
        assert.equal(remaining, 0, `novel deletion must clear writeback children in ${tableName}`)
      }
      if (columns.includes('snapshot_id') && victimSnapshotIds.length > 0) {
        const remaining = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE snapshot_id IN (${victimSnapshotIds.map(() => '?').join(',')})`).get(...victimSnapshotIds).count
        assert.equal(remaining, 0, `novel deletion must clear batch children in ${tableName}`)
      }
    }

    for (const tableName of ['chapters', 'characters', 'story_threads', 'timeline_events', 'world_map', 'growth_tracks', 'resource_pools', 'reward_cost_events', 'glossary', 'scene_templates', 'revision_tasks']) {
      assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)} WHERE novel_id = ?`).get(survivorNovel).count,
        1,
        `novel deletion must retain survivor rows in ${tableName}`,
      )
    }

    console.log('PASS delete integrity: novel-scoped rows, chapter/writeback children, and survivor isolation')
  } finally {
    closeDb()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    await app.quit()
  }
}

run().catch((error) => {
  console.error('[delete-integrity] failed:', error.stack || error.message || error)
  process.exit(1)
})
