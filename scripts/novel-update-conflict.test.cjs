const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const root = path.resolve(__dirname, '..')
const tempRoot = path.join(root, '.tmp-tests')
fs.mkdirSync(tempRoot, { recursive: true })
const profile = fs.mkdtempSync(path.join(tempRoot, 'novel-update-conflict-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', profile)
registerProjectTsRuntime(root)

async function main() {
  await app.whenReady()
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const { updateNovel, getNovel } = require('../electron/services/novel.service.ts')
  const { buildStoryDesignPatch } = require('../src/pages/Novel/AuthorWorkspace/story-design-navigation.ts')
  initDb()
  const sqlite = getSqlite()
  const novelId = Number(sqlite.prepare('INSERT INTO novels (title, context_version, settings_json) VALUES (?,1,?)')
    .run('作品版本保存隔离测试', JSON.stringify({ customSentinel: { preserve: '原有扩展' }, premise: { core_hook: '既有起点' } })).lastInsertRowid)
  sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, context_version, stale_reason_json) VALUES (?,1,?,?,1,?)')
    .run(novelId, '既有章节', '这段正式正文必须保留。', '[]')
  const snapshot = () => JSON.stringify(Object.fromEntries(['novels', 'chapters', 'asset_change_events', 'asset_change_impacts', 'revision_tasks']
    .map(table => [table, sqlite.prepare(`SELECT * FROM ${table} WHERE ${table === 'novels' ? 'id' : 'novel_id'}=? ORDER BY id`).all(novelId)])))

  // A manual editor reads version 1, then another task commits before its update IPC reaches the writer.
  const manualBase = getNovel(novelId)
  const manualPatch = buildStoryDesignPatch(manualBase, 'premise', { coreHook: '手工新起点' })
  updateNovel(novelId, buildStoryDesignPatch(manualBase, 'storyDesign', { mainPlot: '另一任务已保存的新主线' }), { expectedContextVersion: 1 })
  const afterOtherTask = snapshot()
  assert.throws(() => updateNovel(novelId, manualPatch, { expectedContextVersion: manualBase.contextVersion }), /其他任务修改/)
  assert.equal(snapshot(), afterOtherTask, 'stale save cannot change content, version, stale flags, impacts or issue records')

  const fresh = getNovel(novelId)
  updateNovel(novelId, buildStoryDesignPatch(fresh, 'premise', { coreHook: '重新读取后保存的起点' }), { expectedContextVersion: fresh.contextVersion })
  const saved = getNovel(novelId)
  const settings = JSON.parse(saved.settingsJson)
  assert.equal(settings.premise.core_hook, '重新读取后保存的起点')
  assert.equal(settings.story_design.main_plot, '另一任务已保存的新主线')
  assert.deepEqual(settings.customSentinel, { preserve: '原有扩展' })
  assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE novel_id=?').get(novelId).content, '这段正式正文必须保留。')
  assert.equal(saved.contextVersion, fresh.contextVersion + 1)

  const world = {
    version: 999,
    extensionSentinel: { preserve: '顶层作者扩展' },
    genreProfile: { worldviewTone: '有明确代价', localCustom: { preserve: '世界基调扩展' } },
    speciesSystem: [
      { id: 'lamp-spirit', name: '灯精', traits: ['守灯', 9], identityCustom: { owner: 'lamp-spirit', noFreeHealing: true } },
      { id: 'fox-spirit', name: '狐妖', summary: '独立种属', identityCustom: { owner: 'fox-spirit', keepsOwnNeeds: true } },
    ],
    powerSystems: [
      { cost: 999, noIdSentinel: '无有效内容的第一项，不能拼入下一项' },
      { name: '照幽', cost: '须休息', noIdSentinel: '此扩展只属于照幽' },
    ],
    timelineConfig: { currentTimeChapterNum: -5, currentTimeLabel: 99, authorClock: { preserve: '作者时间扩展' } },
    writingConstraints: { realismLevel: 'illegal-value', antiConceptSlogans: '非法布尔', customRule: { preserve: '约束扩展' } },
  }
  updateNovel(novelId, { worldRulesJson: JSON.stringify(world) }, { expectedContextVersion: saved.contextVersion })
  const beforeClockEdit = getNovel(novelId)
  updateNovel(novelId, buildStoryDesignPatch(beforeClockEdit, 'world:timelineConfig', { ...JSON.parse(beforeClockEdit.worldRulesJson).timelineConfig, dynastyName: '景朝' }), { expectedContextVersion: beforeClockEdit.contextVersion })
  const storedWorld = JSON.parse(getNovel(novelId).worldRulesJson)
  assert.deepEqual(storedWorld.extensionSentinel, world.extensionSentinel)
  assert.deepEqual(storedWorld.genreProfile.localCustom, world.genreProfile.localCustom)
  assert.deepEqual(storedWorld.speciesSystem.map(row => [row.id, row.identityCustom]), world.speciesSystem.map(row => [row.id, row.identityCustom]))
  assert.deepEqual(storedWorld.timelineConfig.authorClock, world.timelineConfig.authorClock)
  assert.deepEqual(storedWorld.writingConstraints.customRule, world.writingConstraints.customRule)
  assert.equal(storedWorld.powerSystems.length, 1, 'invalid known entries remain subject to normalization')
  assert.equal(storedWorld.powerSystems[0].name, '照幽')
  assert.equal(storedWorld.powerSystems[0].noIdSentinel, '此扩展只属于照幽', 'no-id entries retain their own extensions without index-based cross-row merging')
  assert.equal(storedWorld.version, 2)
  assert.deepEqual(storedWorld.speciesSystem[0].traits, ['守灯'])
  assert.equal(storedWorld.timelineConfig.currentTimeChapterNum, undefined)
  assert.equal(storedWorld.timelineConfig.currentTimeLabel, undefined)
  assert.equal(storedWorld.writingConstraints.realismLevel, 'rule-realism')
  assert.equal(storedWorld.writingConstraints.antiConceptSlogans, false)
  const reordered = { ...storedWorld, speciesSystem: [...storedWorld.speciesSystem].reverse() }
  updateNovel(novelId, { worldRulesJson: JSON.stringify(reordered) }, { expectedContextVersion: getNovel(novelId).contextVersion })
  assert.deepEqual(JSON.parse(getNovel(novelId).worldRulesJson).speciesSystem.map(row => [row.id, row.identityCustom.owner]), [['fox-spirit', 'fox-spirit'], ['lamp-spirit', 'lamp-spirit']], 'reordering stable IDs never joins extensions across species')

  // Failure after content + context updates must roll back every mutation in the save transaction.
  const beforeFailure = snapshot()
  sqlite.exec("CREATE TEMP TRIGGER fail_novel_save_impact BEFORE INSERT ON main.asset_change_events BEGIN SELECT RAISE(ABORT, 'isolated impact failure'); END")
  assert.throws(() => updateNovel(novelId, { synopsis: '不能半保存的简介' }, { expectedContextVersion: getNovel(novelId).contextVersion }), /isolated impact failure/)
  assert.equal(snapshot(), beforeFailure, 'late impact failure rolls back the novel, context version and derived stale state')
  sqlite.exec('DROP TRIGGER fail_novel_save_impact')

  for (const invalid of [0, -1, 1.5, '3', null]) {
    assert.throws(() => updateNovel(novelId, { synopsis: '无效版本不写入' }, { expectedContextVersion: invalid }), /预期版本无效/)
  }
  assert.equal(snapshot(), beforeFailure)
  sqlite.transaction(() => updateNovel(novelId, { synopsis: '旧的两参数调用仍可用' }))()
  assert.equal(getNovel(novelId).synopsis, '旧的两参数调用仍可用', 'legacy calls and nested writer transactions remain compatible')
  closeDb()
  initDb()
  assert.equal(getNovel(novelId).synopsis, '旧的两参数调用仍可用', 'successful save survives reopening SQLite')
  closeDb()
  console.log('[novel-update-conflict] stale read/save rejection, atomic impact rollback, world extension/identity preservation with known-field normalization, legacy calls, nested transaction and SQLite reload passed')
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
