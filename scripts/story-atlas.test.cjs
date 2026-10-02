const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempBase = path.resolve(workspaceRoot, '.tmp-tests')
fs.mkdirSync(tempBase, { recursive: true })
const tempRoot = path.resolve(tempBase, `story-atlas-${process.pid}-${randomUUID()}`)
if (!tempRoot.startsWith(`${tempBase}${path.sep}`) || !fs.realpathSync(tempBase).startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('Unsafe test directory')
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', tempRoot)
app.disableHardwareAcceleration()
registerProjectTsRuntime(workspaceRoot)

async function main() {
  await app.whenReady()
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  const { migrateStoryAtlas } = require('../electron/database/story-atlas-store.ts')
  const { queryStoryAtlas, validateStoryAtlasChanges, applyStoryAtlasChanges } = require('../electron/services/story-atlas.service.ts')
  initDb()
  try {
    const db = getSqlite()
    const addNovel = () => Number(db.prepare('INSERT INTO novels(title,context_version) VALUES (?,1)').run('图谱隔离测试').lastInsertRowid)
    const novelId = addNovel()
    const input = (changes, effectiveFromChapter = 0) => ({ novelId, expectedContextVersion: queryStoryAtlas({ novelId }).contextVersion, idempotencyKey: randomUUID(), effectiveFromChapter, source: { kind: 'test', id: 'fixture' }, changes })
    const create = input([
      { op: 'upsert_entity', clientId: 'town', kind: 'location', name: '白茅镇', parentId: 'region', attributes: { locationType: 'town' } },
      { op: 'upsert_entity', clientId: 'region', kind: 'location', name: '江南地区', attributes: { locationType: 'region' } },
      { op: 'upsert_entity', clientId: 'inn', kind: 'location', name: '借灯客栈', parentId: 'town', attributes: { locationType: 'site' } },
      { op: 'upsert_entity', clientId: 'lu', kind: 'character', name: '陆闻', attributes: { personalityTraits: ['先核对证据'], speechPattern: '问具体经过' } },
      { op: 'upsert_entity', clientId: 'yang', kind: 'character', name: '杨嫂' },
      { op: 'upsert_entity', clientId: 'guild', kind: 'faction', name: '行商会' },
      { op: 'upsert_entity', clientId: 'book', kind: 'item', name: '登记册' },
      { op: 'upsert_entity', clientId: 'event', kind: 'event', name: '到店查案', attributes: { timeLabel: '初夜' } },
      { op: 'upsert_relation', clientId: 'bond', kind: 'relationship', fromId: 'lu', toId: 'yang', label: '委托合作' },
      { op: 'upsert_relation', clientId: 'route', kind: 'route', fromId: 'town', toId: 'inn', label: '街道', attributes: { travelHours: 0.25, distanceKm: 1, travelMode: 'foot' } },
      { op: 'upsert_relation', clientId: 'position', kind: 'presence', fromId: 'lu', toId: 'town', label: '抵达' },
      { op: 'upsert_relation', kind: 'membership', fromId: 'yang', toId: 'guild' },
      { op: 'upsert_relation', kind: 'ownership', fromId: 'yang', toId: 'book' },
      { op: 'upsert_relation', kind: 'participation', fromId: 'lu', toId: 'event' },
    ])
    const before = db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n
    assert.equal(validateStoryAtlasChanges(create).valid, true)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n, before, 'validation must not write')
    assert.equal(queryStoryAtlas({ novelId }).contextVersion, 1)
    const made = applyStoryAtlasChanges(create)
    const ids = made.idMap
    const snapshot = queryStoryAtlas({ novelId, locationParentId: ids.town })
    assert.equal(snapshot.entities.length, 8)
    assert.equal(snapshot.relations.length, 6)
    assert.equal(snapshot.locationChildren[0].id, ids.inn)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM world_map WHERE novel_id=?').get(novelId).n, 3)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM character_relations WHERE novel_id=?').get(novelId).n, 1)
    assert.equal(applyStoryAtlasChanges(create).idempotentReplay, true)
    assert.throws(() => applyStoryAtlasChanges({ ...create, source: { kind: 'changed' } }), /幂等键/)
    assert.throws(() => applyStoryAtlasChanges({ ...create, idempotencyKey: randomUUID() }), /上下文/)
    const moved = input([{ op: 'upsert_relation', clientId: 'moved', kind: 'presence', fromId: ids.lu, toId: ids.inn, label: '进店' }], 3)
    const movement = applyStoryAtlasChanges(moved)
    assert.equal(movement.idMap.moved, ids.position, 'incremental movement keeps the same stable position edge')
    assert.equal(queryStoryAtlas({ novelId, atChapter: 2 }).relations.find((r) => r.id === ids.position).toId, ids.town)
    assert.equal(queryStoryAtlas({ novelId, atChapter: 3 }).relations.find((r) => r.id === ids.position).toId, ids.inn)
    const count = db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n
    assert.throws(() => applyStoryAtlasChanges(input([{ op: 'upsert_entity', id: ids.region, kind: 'location', name: '江南地区', parentId: ids.inn }])), /自身的上级|层级不能倒置/)
    assert.throws(() => applyStoryAtlasChanges(input([{ op: 'upsert_relation', id: ids.route, kind: 'route', fromId: ids.town, toId: ids.inn, attributes: { travelHours: -1 } }])), /非负数/)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n, count, 'invalid batches must leave no versions')
    const updated = applyStoryAtlasChanges(input([{ op: 'upsert_entity', clientId: 'samePerson', kind: 'character', name: '陆闻', summary: '同一个人物，补全资料。' }]))
    assert.equal(updated.idMap.samePerson, ids.lu)
    assert.equal(queryStoryAtlas({ novelId }).entities.filter((r) => r.kind === 'character').length, 2, 'same-name increments do not duplicate people')
    assert.throws(() => applyStoryAtlasChanges(input([{ op: 'upsert_relation', id: ids.position, kind: 'presence', fromId: ids.lu, toId: ids.town }], 1)), /后续章节已有变化/)
    const membership = queryStoryAtlas({ novelId }).relations.find((r) => r.kind === 'membership')
    applyStoryAtlasChanges(input([{ op: 'retire', id: membership.id }], 4))
    assert.equal(queryStoryAtlas({ novelId, atChapter: 3 }).relations.filter((r) => r.kind === 'membership').length, 1)
    assert.equal(queryStoryAtlas({ novelId, atChapter: 4 }).relations.filter((r) => r.kind === 'membership').length, 0)
    assert.equal(db.prepare('SELECT camp_faction_ids_json FROM characters WHERE novel_id=? AND full_name=?').get(novelId, '杨嫂').camp_faction_ids_json, '[]')
    applyStoryAtlasChanges(input([{ op: 'upsert_entity', kind: 'item', name: '新增背景物品' }]))
    assert.equal(db.prepare('SELECT camp_faction_ids_json FROM characters WHERE novel_id=? AND full_name=?').get(novelId, '杨嫂').camp_faction_ids_json, '[]', 'backdated unrelated changes must not restore old memberships')
    const another = addNovel()
    assert.throws(() => applyStoryAtlasChanges({ ...input([{ op: 'upsert_entity', id: ids.lu, kind: 'character', name: '冒用' }]), novelId: another, expectedContextVersion: 1 }), /不属于当前项目/)
    const planned = applyStoryAtlasChanges(input([{ op: 'upsert_entity', clientId: 'future', kind: 'location', name: '未来村落', status: 'planned' }], 8))
    assert.ok(!queryStoryAtlas({ novelId }).entities.some((r) => r.id === planned.idMap.future))
    assert.ok(queryStoryAtlas({ novelId, includePlanned: true }).entities.some((r) => r.id === planned.idMap.future))
    assert.ok(!queryStoryAtlas({ novelId, atChapter: 7, includePlanned: true }).entities.some((r) => r.id === planned.idMap.future))
    const beforeRollback = queryStoryAtlas({ novelId }).contextVersion
    assert.throws(() => db.transaction(() => { applyStoryAtlasChanges(input([{ op: 'upsert_entity', kind: 'item', name: '外部事务回滚物' }])); throw new Error('rollback') })(), /rollback/)
    assert.equal(queryStoryAtlas({ novelId }).contextVersion, beforeRollback)
    assert.ok(!queryStoryAtlas({ novelId }).entities.some((r) => r.name === '外部事务回滚物'))

    const importedNovel = addNovel()
    const a = Number(db.prepare('INSERT INTO characters(novel_id,full_name) VALUES (?,?)').run(importedNovel, '甲').lastInsertRowid)
    const b = Number(db.prepare('INSERT INTO characters(novel_id,full_name) VALUES (?,?)').run(importedNovel, '乙').lastInsertRowid)
    const ch = Number(db.prepare('INSERT INTO chapters(novel_id,chapter_num,title) VALUES (?,3,?)').run(importedNovel, '第三章').lastInsertRowid)
    db.prepare("INSERT INTO relationship_arcs(novel_id,char_a_id,char_b_id,end_state,current_status,last_progress_chapter_id) VALUES (?,?,?,?,'active',?)").run(importedNovel, a, b, '合作', ch)
    migrateStoryAtlas(db)
    assert.equal(queryStoryAtlas({ novelId }).entities.filter((r) => r.kind === 'character').length, 2, 'migration never imports current native projections a second time')
    const imported = queryStoryAtlas({ novelId: importedNovel, atChapter: 3 })
    assert.equal(imported.relations.length, 1, 'existing arc evidence must appear in the unified graph')
    assert.equal(imported.relations[0].source.kind, 'relationship_arcs')
    assert.equal(queryStoryAtlas({ novelId: importedNovel, atChapter: 2 }).relations.length, 0, 'no future relationship leakage')
    const migrationCount = db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n
    migrateStoryAtlas(db)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n, migrationCount, 'migration is idempotent')
    process.stdout.write('PASS story atlas: hierarchy, native projections, shared graph, validation without writes, chapter history, future filtering, version/idempotency, cross-project protection, cycle/travel validation, outer transaction rollback, source migration\n')
  } finally { closeDb(); fs.rmSync(tempRoot, { recursive: true, force: true }) }
  app.exit(0)
}
main().catch((error) => { console.error(error); app.exit(1) })
