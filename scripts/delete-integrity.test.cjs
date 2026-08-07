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
  const factionService = project('electron/services/faction.service.ts')
  const itemService = project('electron/services/item.service.ts')
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

    const mapAtomicNovel = novelService.createNovel({ title: '地图清空原子性测试', targetWords: 5000 })
    const mapAtomicId = mapService.createMapItem(mapAtomicNovel, { level: 0, name: '不可半清空地点' }, { skipContextTracking: true })
    const mapAtomicEvent = timelineService.createTimelineEvent(mapAtomicNovel, {
      eventTitle: '地图引用事件',
      locationMapId: mapAtomicId,
    }, { skipContextTracking: true })
    const mapAtomicItem = Number(sqlite.prepare(`
      INSERT INTO story_items (novel_id, item_name, location_map_id)
      VALUES (?, '地图引用物品', ?)
    `).run(mapAtomicNovel, mapAtomicId).lastInsertRowid)
    sqlite.exec(`
      CREATE TRIGGER fail_map_clear_delete
      BEFORE DELETE ON world_map
      WHEN OLD.id = ${mapAtomicId}
      BEGIN
        SELECT RAISE(ABORT, 'forced map clear failure');
      END;
    `)
    assert.throws(() => mapService.clearMapByNovel(mapAtomicNovel, { skipContextTracking: true }), /forced map clear failure/u)
    sqlite.exec('DROP TRIGGER fail_map_clear_delete')
    assert.equal(sqlite.prepare('SELECT location_map_id FROM timeline_events WHERE id = ?').get(mapAtomicEvent).location_map_id, mapAtomicId)
    assert.equal(sqlite.prepare('SELECT location_map_id FROM story_items WHERE id = ?').get(mapAtomicItem).location_map_id, mapAtomicId)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM world_map WHERE id = ?').get(mapAtomicId).count, 1)

    const characterAtomicNovel = novelService.createNovel({ title: '角色清空原子性测试', targetWords: 5000 })
    const characterAtomicA = characterService.createCharacter(characterAtomicNovel, { fullName: '不可半清空角色 A' }, { skipContextTracking: true })
    const characterAtomicB = characterService.createCharacter(characterAtomicNovel, { fullName: '不可半清空角色 B' }, { skipContextTracking: true })
    sqlite.prepare(`
      INSERT INTO character_relations (novel_id, char_a_id, char_b_id, relation_type)
      VALUES (?, ?, ?, 'ally')
    `).run(characterAtomicNovel, characterAtomicA, characterAtomicB)
    const characterAtomicItem = Number(sqlite.prepare(`
      INSERT INTO story_items (novel_id, item_name, owner_character_id, linked_character_ids_json)
      VALUES (?, '角色引用物品', ?, ?)
    `).run(characterAtomicNovel, characterAtomicA, JSON.stringify([characterAtomicA, characterAtomicB])).lastInsertRowid)
    const characterAtomicEvent = timelineService.createTimelineEvent(characterAtomicNovel, {
      eventTitle: '角色引用事件',
      presentCharacterIdsJson: JSON.stringify([characterAtomicA]),
      affectedCharacterIdsJson: JSON.stringify([characterAtomicB]),
    }, { skipContextTracking: true })
    sqlite.exec(`
      CREATE TRIGGER fail_character_clear_delete
      BEFORE DELETE ON characters
      WHEN OLD.id = ${characterAtomicA}
      BEGIN
        SELECT RAISE(ABORT, 'forced character clear failure');
      END;
    `)
    assert.throws(() => characterService.clearCharactersByNovel(characterAtomicNovel, { skipContextTracking: true }), /forced character clear failure/u)
    sqlite.exec('DROP TRIGGER fail_character_clear_delete')
    assert.deepEqual(
      sqlite.prepare('SELECT owner_character_id, linked_character_ids_json FROM story_items WHERE id = ?').get(characterAtomicItem),
      { owner_character_id: characterAtomicA, linked_character_ids_json: JSON.stringify([characterAtomicA, characterAtomicB]) },
    )
    assert.deepEqual(
      sqlite.prepare('SELECT present_character_ids_json, affected_character_ids_json FROM timeline_events WHERE id = ?').get(characterAtomicEvent),
      { present_character_ids_json: JSON.stringify([characterAtomicA]), affected_character_ids_json: JSON.stringify([characterAtomicB]) },
    )
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM character_relations WHERE novel_id = ?').get(characterAtomicNovel).count, 1)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id = ?').get(characterAtomicNovel).count, 2)

    const itemAtomicNovel = novelService.createNovel({ title: '物品清空原子性测试', targetWords: 5000 })
    const itemAtomicId = itemService.createStoryItem(itemAtomicNovel, { itemName: '不可半清空物品' }, { skipContextTracking: true })
    const itemAtomicEvent = timelineService.createTimelineEvent(itemAtomicNovel, {
      eventTitle: '物品引用事件',
      linkedItemIdsJson: JSON.stringify([itemAtomicId]),
    }, { skipContextTracking: true })
    sqlite.exec(`
      CREATE TRIGGER fail_item_clear_delete
      BEFORE DELETE ON story_items
      WHEN OLD.id = ${itemAtomicId}
      BEGIN
        SELECT RAISE(ABORT, 'forced item clear failure');
      END;
    `)
    assert.throws(() => itemService.clearStoryItemsByNovel(itemAtomicNovel, { skipContextTracking: true }), /forced item clear failure/u)
    sqlite.exec('DROP TRIGGER fail_item_clear_delete')
    assert.equal(sqlite.prepare('SELECT linked_item_ids_json FROM timeline_events WHERE id = ?').get(itemAtomicEvent).linked_item_ids_json, JSON.stringify([itemAtomicId]))
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM story_items WHERE id = ?').get(itemAtomicId).count, 1)

    const timelineAtomicNovel = novelService.createNovel({ title: '时间线清空原子性测试', targetWords: 5000 })
    const timelineAtomicEvent = timelineService.createTimelineEvent(timelineAtomicNovel, { eventTitle: '不可半清空事件' }, { skipContextTracking: true })
    const timelineAtomicItem = itemService.createStoryItem(timelineAtomicNovel, {
      itemName: '时间线引用物品',
      linkedTimelineEventIdsJson: JSON.stringify([timelineAtomicEvent]),
    }, { skipContextTracking: true })
    sqlite.exec(`
      CREATE TRIGGER fail_timeline_clear_delete
      BEFORE DELETE ON timeline_events
      WHEN OLD.id = ${timelineAtomicEvent}
      BEGIN
        SELECT RAISE(ABORT, 'forced timeline clear failure');
      END;
    `)
    assert.throws(() => timelineService.clearTimelineByNovel(timelineAtomicNovel, { skipContextTracking: true }), /forced timeline clear failure/u)
    sqlite.exec('DROP TRIGGER fail_timeline_clear_delete')
    assert.equal(sqlite.prepare('SELECT linked_timeline_event_ids_json FROM story_items WHERE id = ?').get(timelineAtomicItem).linked_timeline_event_ids_json, JSON.stringify([timelineAtomicEvent]))
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM timeline_events WHERE id = ?').get(timelineAtomicEvent).count, 1)

    const factionAtomicNovel = novelService.createNovel({ title: '势力清空原子性测试', targetWords: 5000 })
    const factionAtomicId = factionService.createFaction(factionAtomicNovel, { name: '不可半清空势力' }, { skipContextTracking: true })
    const factionAtomicCharacter = characterService.createCharacter(factionAtomicNovel, {
      fullName: '势力引用角色',
      campFactionIdsJson: JSON.stringify([factionAtomicId]),
    }, { skipContextTracking: true })
    const factionAtomicMap = mapService.createMapItem(factionAtomicNovel, {
      level: 0,
      name: '势力引用地点',
      affiliatedFactionIdsJson: JSON.stringify([factionAtomicId]),
    }, { skipContextTracking: true })
    sqlite.exec(`
      CREATE TRIGGER fail_faction_clear_delete
      BEFORE DELETE ON factions
      WHEN OLD.id = ${factionAtomicId}
      BEGIN
        SELECT RAISE(ABORT, 'forced faction clear failure');
      END;
    `)
    assert.throws(() => factionService.clearFactions(factionAtomicNovel), /forced faction clear failure/u)
    sqlite.exec('DROP TRIGGER fail_faction_clear_delete')
    assert.equal(sqlite.prepare('SELECT camp_faction_ids_json FROM characters WHERE id = ?').get(factionAtomicCharacter).camp_faction_ids_json, JSON.stringify([factionAtomicId]))
    assert.equal(sqlite.prepare('SELECT affiliated_faction_ids_json FROM world_map WHERE id = ?').get(factionAtomicMap).affiliated_faction_ids_json, JSON.stringify([factionAtomicId]))
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM factions WHERE id = ?').get(factionAtomicId).count, 1)

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

    console.log('PASS delete integrity: asset clear rollback, novel-scoped rows, chapter/writeback children, and survivor isolation')
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
