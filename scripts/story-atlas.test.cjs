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
  const { parseCreativeCandidate } = require('../electron/services/creative-workflow.service.ts')
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

    const eventNovel = addNovel()
    const eventChapters = [1, 2, 3].map(number => Number(db.prepare('INSERT INTO chapters(novel_id,chapter_num,title) VALUES (?,?,?)').run(eventNovel, number, `第${number}章`).lastInsertRowid))
    const eventInput = (changes, effectiveFromChapter = 3) => ({ ...input(changes, effectiveFromChapter), novelId: eventNovel, expectedContextVersion: queryStoryAtlas({ novelId: eventNovel }).contextVersion })
    const eventId = applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', clientId: 'observed', kind: 'event', name: '前夜目击', attributes: { timeLabel: '到店前夜' } }], 1)).idMap.observed
    const eventRecord = () => queryStoryAtlas({ novelId: eventNovel }).entities.find(entity => entity.id === eventId)
    const nativeEvent = () => db.prepare('SELECT id,chapter_start_id,event_result FROM timeline_events WHERE novel_id=? AND event_title=?').get(eventNovel, '前夜目击')
    assert.equal(eventRecord().attributes.chapterStartId, eventChapters[0], 'new events store their narrative anchor independently of revision chapter')
    // Earlier versions created atlas events without chapterStartId while projecting a native chapter anchor.
    const legacyEvent = eventRecord()
    delete legacyEvent.attributes.chapterStartId
    db.prepare('UPDATE story_atlas_revisions SET snapshot_json=? WHERE novel_id=? AND record_id=?').run(JSON.stringify(legacyEvent), eventNovel, eventId)
    applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', id: eventId, kind: 'event', name: '前夜目击', attributes: { eventResult: '身份仍待核实', relativeDay: -1 } }]))
    assert.equal(nativeEvent().chapter_start_id, eventChapters[0], 'later enrichment must preserve the event chapter already projected by older versions')
    assert.equal(eventRecord().attributes.chapterStartId, eventChapters[0], 'atlas and native projection must agree on the preserved anchor')
    assert.equal(eventRecord().effectiveFromChapter, 3, 'newly learned details still take effect at their own revision chapter')
    assert.equal(queryStoryAtlas({ novelId: eventNovel, atChapter: 1 }).entities.find(entity => entity.id === eventId).attributes.eventResult, undefined, 'later details must not leak into earlier snapshots')
    applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', id: eventId, kind: 'event', name: '前夜目击', attributes: { chapterStartId: eventChapters[1] } }]))
    assert.equal(nativeEvent().chapter_start_id, eventChapters[1], 'an explicit valid anchor correction must reach the native timeline')
    assert.equal(eventRecord().attributes.chapterStartId, eventChapters[1])
    const foreignChapter = Number(db.prepare('INSERT INTO chapters(novel_id,chapter_num,title) VALUES (?,1,?)').run(another, '其他小说首章').lastInsertRowid)
    const beforeEventRejection = queryStoryAtlas({ novelId: eventNovel })
    for (const chapterStartId of [foreignChapter, 99999999, 0, String(eventChapters[0])]) {
      assert.throws(() => validateStoryAtlasChanges(eventInput([{ op: 'upsert_entity', id: eventId, kind: 'event', name: '前夜目击', attributes: { chapterStartId } }])), { code: 'INVALID_EVENT_CHAPTER' })
    }
    assert.deepEqual(queryStoryAtlas({ novelId: eventNovel }), beforeEventRejection)
    assert.equal(nativeEvent().chapter_start_id, eventChapters[1], 'invalid anchor references must not change native data')
    applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', id: eventId, kind: 'event', name: '前夜目击', attributeMode: 'replace', attributes: { chapterStartId: null } }]))
    assert.equal(nativeEvent().chapter_start_id, null, 'an explicit manual clearing remains possible')
    assert.equal(eventRecord().attributes.chapterStartId, null, 'a cleared anchor remains explicit in the atlas instead of disappearing')
    applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', id: eventId, kind: 'event', name: '前夜目击', summary: '仅整理证言' }]))
    assert.equal(nativeEvent().chapter_start_id, null, 'later text edits do not assign a new anchor to an unanchored event')
    assert.equal(eventRecord().attributes.chapterStartId, null)
    const backgroundEventId = applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', clientId: 'history', kind: 'event', name: '旧年水灾', attributes: { timeLabel: '十八年前' } }], 0)).idMap.history
    applyStoryAtlasChanges(eventInput([{ op: 'upsert_entity', id: backgroundEventId, kind: 'event', name: '旧年水灾', attributes: { eventResult: '补充历史依据' } }]))
    const backgroundEvent = queryStoryAtlas({ novelId: eventNovel }).entities.find(entity => entity.id === backgroundEventId)
    assert.equal(backgroundEvent.effectiveFromChapter, 3)
    assert.equal(backgroundEvent.attributes.chapterStartId, null, 'background evidence added at chapter three must stay unanchored')
    assert.equal(db.prepare('SELECT chapter_start_id FROM timeline_events WHERE novel_id=? AND event_title=?').get(eventNovel, '旧年水灾').chapter_start_id, null)

    const organizationNovel = addNovel()
    const organizationInput = (changes, effectiveFromChapter = 0) => ({ ...input(changes, effectiveFromChapter), novelId: organizationNovel, expectedContextVersion: queryStoryAtlas({ novelId: organizationNovel }).contextVersion })
    const organization = applyStoryAtlasChanges(organizationInput([
      { op: 'upsert_entity', clientId: 'north', kind: 'location', name: '北岸', attributes: { locationType: 'region' } },
      { op: 'upsert_entity', clientId: 'south', kind: 'location', name: '南岸', attributes: { locationType: 'region' } },
      { op: 'upsert_entity', clientId: 'branch', kind: 'faction', name: '渡运部', parentId: 'org', attributes: { organizationLevel: 'department', positions: [{ id: 'keeper', title: '掌船', status: 'established', responsibilities: '安排渡船' }, { id: 'scribe', title: '录事', status: 'planned' }] } },
      { op: 'upsert_entity', clientId: 'org', kind: 'faction', name: '两岸渡行', attributes: { organizationLevel: 'organization', traits: ['按水位排船'], goal: '维持两岸往来', funding: '渡资', resources: '两条船', memberPolicy: '熟悉水路者可入' } },
      { op: 'upsert_entity', clientId: 'worker', kind: 'character', name: '顾迟', attributes: { occupation: '船工', dailyRoutine: '查验绳索', motivation: '保住渡口生计', personalityTraits: ['谨慎'], abilityLimits: '不能预知水位', abilities: [{ name: '辨水', effect: '根据水痕判断涨落', limits: '暴雨后需重新测量', cost: '需要现场观察' }] } },
      { op: 'upsert_relation', clientId: 'birth', kind: 'presence', fromId: 'worker', toId: 'north', attributes: { locationRole: 'birthplace' } },
      { op: 'upsert_relation', clientId: 'home', kind: 'presence', fromId: 'worker', toId: 'south', attributes: { locationRole: 'residence' } },
      { op: 'upsert_relation', clientId: 'activity-n', kind: 'presence', fromId: 'worker', toId: 'north', attributes: { locationRole: 'activity' } },
      { op: 'upsert_relation', clientId: 'activity-s', kind: 'presence', fromId: 'worker', toId: 'south', attributes: { locationRole: 'activity' } },
      { op: 'upsert_relation', clientId: 'current', kind: 'presence', fromId: 'worker', toId: 'north', attributes: { locationRole: 'current' } },
      { op: 'upsert_relation', kind: 'presence', fromId: 'org', toId: 'north', attributes: { locationRole: 'headquarters' } },
      { op: 'upsert_relation', kind: 'presence', fromId: 'branch', toId: 'south', attributes: { locationRole: 'outpost' } },
      { op: 'upsert_relation', kind: 'presence', fromId: 'org', toId: 'north', attributes: { locationRole: 'jurisdiction' } },
      { op: 'upsert_relation', kind: 'presence', fromId: 'org', toId: 'south', attributes: { locationRole: 'jurisdiction' } },
      { op: 'upsert_relation', clientId: 'job', kind: 'membership', fromId: 'worker', toId: 'branch', attributes: { positionId: 'keeper' } },
    ]))
    const orgIds = organization.idMap
    const organizationSnapshot = () => queryStoryAtlas({ novelId: organizationNovel })
    assert.equal(organizationSnapshot().relations.filter(edge => edge.fromId === orgIds.worker && edge.kind === 'presence').length, 5, 'birthplace, home, activity and current position must coexist')
    assert.equal(organizationSnapshot().relations.filter(edge => edge.attributes.locationRole === 'jurisdiction').length, 2, 'a faction can cover multiple regions')
    const focused = queryStoryAtlas({ novelId: organizationNovel, focusEntityId: orgIds.org })
    assert.ok(focused.entities.some(entity => entity.id === orgIds.branch)); assert.ok(focused.entities.some(entity => entity.id === orgIds.worker), 'organization focus includes department members')
    assert.equal(db.prepare('SELECT COUNT(*) count FROM characters WHERE novel_id=?').get(organizationNovel).count, 1, 'planned positions never invent people')
    applyStoryAtlasChanges(organizationInput([
      { op: 'upsert_entity', id: orgIds.branch, kind: 'faction', name: '渡运部', attributes: { positions: [{ id: 'keeper', requirements: '能辨水痕' }] } },
      { op: 'upsert_entity', id: orgIds.worker, kind: 'character', name: '顾迟', attributes: { personalityTraits: ['说话克制'], dailyRoutine: '', campFactionIds: [] } },
      { op: 'upsert_relation', kind: 'presence', fromId: orgIds.worker, toId: orgIds.south, attributes: { locationRole: 'current' } },
    ], 2))
    const worker = organizationSnapshot().entities.find(entity => entity.id === orgIds.worker)
    assert.equal(worker.attributes.dailyRoutine, '查验绳索'); assert.deepEqual(worker.attributes.personalityTraits, ['谨慎', '说话克制'])
    assert.equal(organizationSnapshot().entities.find(entity => entity.id === orgIds.branch).attributes.positions.length, 2)
    assert.equal(organizationSnapshot().relations.find(edge => edge.id === orgIds.birth).toId, orgIds.north)
    assert.equal(organizationSnapshot().relations.find(edge => edge.id === orgIds.current).toId, orgIds.south)
    assert.equal(queryStoryAtlas({ novelId: organizationNovel, atChapter: 1 }).relations.find(edge => edge.id === orgIds.current).toId, orgIds.north)
    const guardVersion = organizationSnapshot().contextVersion
    for (const bad of [
      { op: 'upsert_relation', kind: 'membership', fromId: orgIds.worker, toId: orgIds.branch, attributes: { positionId: 'missing' } },
      { op: 'upsert_relation', kind: 'membership', fromId: orgIds.worker, toId: orgIds.branch, attributes: { positionId: 'scribe' } },
      { op: 'upsert_relation', kind: 'presence', fromId: orgIds.worker, toId: orgIds.south, attributes: { locationRole: 'headquarters' } },
      { op: 'upsert_relation', kind: 'presence', fromId: orgIds.org, toId: ids.town, attributes: { locationRole: 'outpost' } },
      { op: 'upsert_entity', id: orgIds.org, kind: 'faction', name: '两岸渡行', parentId: orgIds.branch },
      { op: 'upsert_entity', id: orgIds.branch, kind: 'faction', name: '渡运部', attributes: { positions: [{ id: 'keeper', reportsToPositionId: 'keeper' }] } },
    ]) assert.throws(() => applyStoryAtlasChanges(organizationInput([bad], 2)), /岗位|角色|生效|自身的上级|循环/)
    assert.equal(organizationSnapshot().contextVersion, guardVersion, 'bad organizational references must be atomic')
    const planJob = applyStoryAtlasChanges(organizationInput([{ op: 'upsert_relation', clientId: 'futureJob', kind: 'membership', fromId: orgIds.worker, toId: orgIds.branch, status: 'planned', attributes: { positionId: 'scribe' } }], 3))
    assert.ok(!organizationSnapshot().relations.some(edge => edge.id === planJob.idMap.futureJob))
    assert.ok(queryStoryAtlas({ novelId: organizationNovel, includePlanned: true }).relations.some(edge => edge.id === planJob.idMap.futureJob))

    applyStoryAtlasChanges(organizationInput([
      { op: 'upsert_entity', id: orgIds.worker, kind: 'character', name: '顾迟', attributes: { age: 22, goals: '守住渡口', appearance: { clothing: '旧衫', hair: '黑' } } },
      { op: 'upsert_relation', id: orgIds.job, kind: 'membership', fromId: orgIds.worker, toId: orgIds.branch, attributes: { roleTitle: '掌船', responsibilities: '检查船只' } },
    ], 3))
    const editWorkerBefore = organizationSnapshot().entities.find(entity => entity.id === orgIds.worker)
    const editInput = organizationInput([
      { op: 'upsert_entity', id: orgIds.worker, kind: 'character', name: '顾迟', attributeMode: 'replace', attributes: { age: null, goals: '', personalityTraits: ['直言'], appearance: { clothing: '短衫', hair: '' } } },
      { op: 'upsert_relation', id: orgIds.job, kind: 'membership', fromId: orgIds.worker, toId: orgIds.branch, attributeMode: 'replace', attributes: { roleTitle: '', responsibilities: '检查绳索' } },
    ], 3)
    const beforeEditing = organizationSnapshot().contextVersion
    assert.equal(validateStoryAtlasChanges(editInput).valid, true)
    assert.equal(organizationSnapshot().contextVersion, beforeEditing, 'replacement validation must not write')
    applyStoryAtlasChanges(editInput)
    const editWorker = organizationSnapshot().entities.find(entity => entity.id === orgIds.worker)
    assert.equal(editWorker.attributes.goals, undefined); assert.equal(editWorker.attributes.age, undefined)
    assert.deepEqual(editWorker.attributes.personalityTraits, ['直言'], 'manual replacement must not union old values')
    assert.deepEqual(editWorker.attributes.appearance, { clothing: '短衫' }, 'nested optional fields can be cleared')
    for (const key of ['occupation', 'dailyRoutine', 'motivation', 'abilityLimits', 'abilities']) assert.deepEqual(editWorker.attributes[key], editWorkerBefore.attributes[key], `omitted ${key} must stay unchanged`)
    const nativeEditedWorker = db.prepare('SELECT age,goals,personality_traits_json,appearance_json,occupation FROM characters WHERE novel_id=? AND full_name=?').get(organizationNovel, '顾迟')
    assert.equal(nativeEditedWorker.age, null); assert.equal(nativeEditedWorker.goals, null)
    assert.deepEqual(JSON.parse(nativeEditedWorker.personality_traits_json), ['直言']); assert.deepEqual(JSON.parse(nativeEditedWorker.appearance_json), { clothing: '短衫' })
    assert.equal(nativeEditedWorker.occupation, '船工', 'native projection preserves unrelated fields')
    const editedJob = organizationSnapshot().relations.find(edge => edge.id === orgIds.job)
    assert.equal(editedJob.attributes.roleTitle, undefined); assert.equal(editedJob.attributes.responsibilities, '检查绳索'); assert.equal(editedJob.attributes.positionId, 'keeper')
    const beforePositionEdit = organizationSnapshot().entities.find(entity => entity.id === orgIds.branch)
    applyStoryAtlasChanges(organizationInput([{ op: 'upsert_entity', id: orgIds.branch, kind: 'faction', name: '渡运部', attributes: { positions: [{ id: 'unused', title: '待增岗位', status: 'planned' }] } }], 3))
    applyStoryAtlasChanges(organizationInput([{ op: 'upsert_entity', id: orgIds.branch, kind: 'faction', name: '渡运部', attributeMode: 'replace', attributes: { positions: beforePositionEdit.attributes.positions.map(position => position.id === 'keeper' ? { ...position, responsibilities: '' } : position) } }], 3))
    const editedOrganization = organizationSnapshot().entities.find(entity => entity.id === orgIds.branch)
    assert.equal(editedOrganization.attributes.positions.length, 2, 'an unoccupied organization slot can be removed')
    assert.equal(editedOrganization.attributes.positions.find(position => position.id === 'keeper').responsibilities, undefined, 'optional slot text can be cleared')
    assert.equal(editedOrganization.attributes.organizationLevel, beforePositionEdit.attributes.organizationLevel)
    const stableSnapshot = organizationSnapshot()
    const stableRevisionCount = db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n
    const establishedPositions = stableSnapshot.entities.find(entity => entity.id === orgIds.branch).attributes.positions
    for (const positions of [[], establishedPositions.filter(position => position.id !== 'keeper'), establishedPositions.map(position => position.id === 'keeper' ? { ...position, status: 'planned' } : position)]) {
      assert.throws(() => applyStoryAtlasChanges(organizationInput([
        { op: 'upsert_entity', id: orgIds.worker, kind: 'character', name: '顾迟', summary: '应当一起回滚' },
        { op: 'upsert_entity', id: orgIds.branch, kind: 'faction', name: '渡运部', attributeMode: 'replace', attributes: { positions } },
      ], 3)), /岗位/)
    }
    assert.deepEqual(organizationSnapshot(), stableSnapshot, 'invalid occupied position edits must be atomic')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM story_atlas_revisions').get().n, stableRevisionCount)
    assert.deepEqual(db.prepare('SELECT age,goals,personality_traits_json,appearance_json,occupation FROM characters WHERE novel_id=? AND full_name=?').get(organizationNovel, '顾迟'), nativeEditedWorker)
    assert.throws(() => applyStoryAtlasChanges(organizationInput([{ op: 'upsert_entity', id: orgIds.worker, kind: 'character', name: '顾迟', attributeMode: 'invalid' }], 3)), /更新方式/)
    assert.throws(() => parseCreativeCandidate('characters', JSON.stringify({ changes: [{ op: 'upsert_entity', id: orgIds.worker, kind: 'character', name: '顾迟', attributeMode: 'replace', attributes: { personalityTraits: [] } }] })), /增量合并/)

    const futureMembershipNovel = addNovel()
    const futureInput = (changes, effectiveFromChapter = 0) => ({ ...input(changes, effectiveFromChapter), novelId: futureMembershipNovel, expectedContextVersion: queryStoryAtlas({ novelId: futureMembershipNovel }).contextVersion })
    const futureIds = applyStoryAtlasChanges(futureInput([
      { op: 'upsert_entity', clientId: 'organization', kind: 'faction', name: '后续任职组织', attributes: { positions: [{ id: 'later', title: '录事', status: 'established' }] } },
      { op: 'upsert_entity', clientId: 'member', kind: 'character', name: '后续成员' },
    ])).idMap
    const futureRole = applyStoryAtlasChanges(futureInput([{ op: 'upsert_relation', clientId: 'job', kind: 'membership', fromId: futureIds.member, toId: futureIds.organization, attributes: { positionId: 'later' } }], 3)).idMap.job
    applyStoryAtlasChanges(futureInput([{ op: 'retire', id: futureRole }], 5))
    const futureVersion = queryStoryAtlas({ novelId: futureMembershipNovel }).contextVersion
    assert.throws(() => applyStoryAtlasChanges(futureInput([{ op: 'upsert_entity', id: futureIds.organization, kind: 'faction', name: '后续任职组织', attributeMode: 'replace', attributes: { positions: [] } }])), /第 3 章.*岗位/, 'retirement in chapter five must not erase the chapter-three job reference')
    assert.throws(() => applyStoryAtlasChanges(futureInput([{ op: 'upsert_entity', id: futureIds.organization, kind: 'faction', name: '后续任职组织', attributeMode: 'replace', attributes: { positions: [{ id: 'later', title: '录事', status: 'planned' }] } }])), /第 3 章.*岗位/)
    assert.equal(queryStoryAtlas({ novelId: futureMembershipNovel }).contextVersion, futureVersion, 'future job guards must leave canon unchanged')
    applyStoryAtlasChanges(futureInput([{ op: 'upsert_entity', id: futureIds.organization, kind: 'faction', name: '后续任职组织', summary: '只更正组织简介' }]))
    applyStoryAtlasChanges(futureInput([{ op: 'upsert_entity', id: futureIds.organization, kind: 'faction', name: '后续任职组织', attributeMode: 'replace', attributes: { positions: [] } }], 5))
    assert.equal(queryStoryAtlas({ novelId: futureMembershipNovel, atChapter: 3 }).relations.find(edge => edge.id === futureRole).attributes.positionId, 'later', 'removing an unoccupied slot later preserves past assignments')

    const migratedEditNovel = addNovel()
    const oldFaction = Number(db.prepare('INSERT INTO factions(novel_id,name) VALUES (?,?)').run(migratedEditNovel, '旧行会').lastInsertRowid)
    const oldCharacter = Number(db.prepare('INSERT INTO characters(novel_id,full_name,camp_faction_ids_json,occupation,personality_traits_json) VALUES (?,?,?,?,?)').run(migratedEditNovel, '旧人物', JSON.stringify([oldFaction]), '船工', JSON.stringify(['谨慎'])).lastInsertRowid)
    migrateStoryAtlas(db)
    const migratedInput = (changes) => ({ ...input(changes), novelId: migratedEditNovel, expectedContextVersion: queryStoryAtlas({ novelId: migratedEditNovel }).contextVersion })
    const migratedEntity = queryStoryAtlas({ novelId: migratedEditNovel }).entities.find(entity => entity.id === `character:${oldCharacter}`)
    assert.deepEqual(migratedEntity.attributes.campFactionIds, [oldFaction])
    applyStoryAtlasChanges(migratedInput([{ op: 'upsert_entity', id: migratedEntity.id, kind: 'character', name: migratedEntity.name, summary: '仅更正简介', attributeMode: 'replace', attributes: migratedEntity.attributes }]))
    const migratedAfter = queryStoryAtlas({ novelId: migratedEditNovel })
    assert.equal(migratedAfter.entities.find(entity => entity.id === migratedEntity.id).summary, '仅更正简介', 'full old editor payload must save without rejecting unchanged migrated references')
    assert.deepEqual(migratedAfter.entities.find(entity => entity.id === migratedEntity.id).attributes.campFactionIds, [oldFaction])
    assert.equal(migratedAfter.relations.filter(edge => edge.kind === 'membership').length, 1)
    for (const campFactionIds of [[oldFaction + 1], [], null]) assert.throws(() => applyStoryAtlasChanges(migratedInput([{ op: 'upsert_entity', id: migratedEntity.id, kind: 'character', name: migratedEntity.name, attributeMode: 'replace', attributes: { campFactionIds } }])), /membership/)
    assert.deepEqual(queryStoryAtlas({ novelId: migratedEditNovel }), migratedAfter, 'reference edits must not bypass graph validation')

    const geographyNovel = addNovel()
    const geographyInput = (changes, effectiveFromChapter = 0) => ({ ...input(changes, effectiveFromChapter), novelId: geographyNovel, expectedContextVersion: queryStoryAtlas({ novelId: geographyNovel }).contextVersion })
    const boundary = (left, top, right, bottom) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
    const geographyIds = applyStoryAtlasChanges(geographyInput([
      { op: 'upsert_entity', clientId: 'country', kind: 'location', name: '图测国', attributes: { locationType: 'country', geography: { areaKm2: 1000, mapFrame: { widthKm: 50, heightKm: 40 } } } },
      { op: 'upsert_entity', clientId: 'west', kind: 'location', name: '西郡', parentId: 'country', attributes: { locationType: 'region', geography: { boundary: boundary(0, 0, 50, 100), areaKm2: 400, development: 'outlined' } } },
      { op: 'upsert_entity', clientId: 'east', kind: 'location', name: '东郡', parentId: 'country', attributes: { locationType: 'region', geography: { boundary: boundary(50, 0, 100, 100), development: 'unexplored' } } },
    ])).idMap
    const geographySnapshot = () => queryStoryAtlas({ novelId: geographyNovel })
    assert.ok(!geographySnapshot().diagnostics.some(item => item.code === 'MAP_BOUNDARIES_OVERLAP'), 'shared borders must be allowed')
    const overlap = geographyInput([{ op: 'upsert_entity', id: geographyIds.east, kind: 'location', name: '东郡', attributes: { geography: { boundary: boundary(40, 0, 100, 100) } } }], 2)
    const beforeMapValidation = geographySnapshot()
    assert.ok(validateStoryAtlasChanges(overlap).diagnostics.some(item => item.code === 'MAP_BOUNDARIES_OVERLAP'), 'the same validation surface used by MCP reports overlapping borders')
    assert.deepEqual(geographySnapshot(), beforeMapValidation, 'map validation must not save a candidate')
    applyStoryAtlasChanges(overlap)
    const eastGeography = geographySnapshot().entities.find(entity => entity.id === geographyIds.east).attributes.geography
    assert.equal(eastGeography.development, 'unexplored', 'incremental border adjustment preserves the development flag')
    assert.equal(eastGeography.areaKm2, undefined, 'drawn coordinates never invent physical area')
    assert.deepEqual(queryStoryAtlas({ novelId: geographyNovel, atChapter: 1 }).entities.find(entity => entity.id === geographyIds.east).attributes.geography.boundary, boundary(50, 0, 100, 100), 'earlier map boundaries are preserved')
    const validMapSnapshot = geographySnapshot()
    for (const [bad, expected] of [
      [{ op: 'upsert_entity', id: geographyIds.west, kind: 'location', name: '西郡', attributes: { geography: { areaKm2: 1001 } } }, { code: 'LOCATION_AREA_EXCEEDS_PARENT' }],
      [{ op: 'upsert_entity', id: geographyIds.country, kind: 'location', name: '图测国', attributes: { geography: { areaKm2: 300 } } }, { code: 'LOCATION_AREA_EXCEEDS_PARENT' }],
      [{ op: 'upsert_entity', id: geographyIds.country, kind: 'location', name: '图测国', attributes: { geography: { areaKm2: 2001 } } }, { message: /不能超过内部地图/ }],
      [{ op: 'upsert_entity', id: geographyIds.country, kind: 'location', name: '图测国', attributes: { geography: { mapFrame: { widthKm: 10, heightKm: 10 } } } }, { message: /不能超过内部地图/ }],
      [{ op: 'upsert_entity', id: geographyIds.west, kind: 'location', name: '西郡', attributes: { geography: { position: { x: -1, y: 30 } } } }, { message: /location 属性结构错误/ }],
      // Separate inverted hierarchy from ancestry cycles so random stable-ID traversal cannot change the expected guard.
      [{ op: 'upsert_entity', kind: 'location', name: '误置小国', parentId: geographyIds.west, attributes: { locationType: 'country' } }, { code: 'LOCATION_HIERARCHY_INVERTED' }],
      [{ op: 'upsert_entity', id: geographyIds.country, kind: 'location', name: '图测国', parentId: geographyIds.west, attributes: { locationType: 'region' } }, { code: 'ENTITY_CYCLE' }],
    ]) assert.throws(() => applyStoryAtlasChanges(geographyInput([bad], 2)), expected)
    assert.deepEqual(geographySnapshot(), validMapSnapshot, 'invalid geometry and hierarchy changes are atomic')
    applyStoryAtlasChanges(geographyInput([{ op: 'upsert_entity', id: geographyIds.west, kind: 'location', name: '西郡', attributes: { geography: { areaKm2: 900 } } }], 4))
    assert.throws(() => applyStoryAtlasChanges(geographyInput([{ op: 'upsert_entity', id: geographyIds.country, kind: 'location', name: '图测国', attributes: { geography: { areaKm2: 800 } } }])), /第 4 章.*面积/, 'background corrections cannot invalidate later area facts')
    assert.throws(() => applyStoryAtlasChanges(geographyInput([{ op: 'upsert_entity', id: geographyIds.east, kind: 'location', name: '东郡', attributes: { geography: { development: 'detailed' } } }])), /后续章节已有变化/, 'map changes respect existing chapter revision guards')
    const { creativePublicAttributes } = require('../electron/services/creative-atlas-context.ts')
    assert.deepEqual(creativePublicAttributes({ geography: { ...eastGeography, areaKm2: 450 } }, { kind: 'location', isPov: false }), { geography: { areaKm2: 450 } }, 'prose context excludes drawing coordinates and author development status')

    const containmentNovel = addNovel()
    const containmentInput = (changes, effectiveFromChapter = 0) => ({ ...input(changes, effectiveFromChapter), novelId: containmentNovel, expectedContextVersion: queryStoryAtlas({ novelId: containmentNovel }).contextVersion })
    const concave = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const containmentIds = applyStoryAtlasChanges(containmentInput([
      { op: 'upsert_entity', clientId: 'country', kind: 'location', name: '凹形国', attributes: { geography: { boundary: concave, mapFrame: { widthKm: 1000, heightKm: 600 } } } },
      { op: 'upsert_entity', clientId: 'south', kind: 'location', name: '南部', parentId: 'country', attributes: { geography: { boundary: boundary(0, 70, 100, 100), areaKm2: 100000, mapFrame: { widthKm: 800, heightKm: 180 } } } },
    ])).idMap
    const containmentSnapshot = () => queryStoryAtlas({ novelId: containmentNovel })
    assert.ok(containmentSnapshot().diagnostics.some(item => item.code === 'MAP_AREA_MISMATCH'), 'declared and measured areas are reviewed independently')
    assert.ok(containmentSnapshot().diagnostics.some(item => item.code === 'MAP_SCALE_MISMATCH'), 'explicit child scale cannot silently contradict the parent scale')
    const containmentBefore = containmentSnapshot()
    for (const geography of [{ position: { x: 50, y: 20 } }, { boundary: boundary(10, 10, 90, 90) }]) {
      assert.throws(() => applyStoryAtlasChanges(containmentInput([{ op: 'upsert_entity', kind: 'location', name: '越界地点', parentId: containmentIds.country, attributes: { geography } }])), { code: 'LOCATION_OUTSIDE_PARENT' })
    }
    assert.deepEqual(containmentSnapshot(), containmentBefore, 'containment failures are atomic and catch concave edge excursions')

    const futureBorderNovel = addNovel()
    const futureBorderInput = (changes, effectiveFromChapter = 0) => ({ ...input(changes, effectiveFromChapter), novelId: futureBorderNovel, expectedContextVersion: queryStoryAtlas({ novelId: futureBorderNovel }).contextVersion })
    const futureCountry = applyStoryAtlasChanges(futureBorderInput([{ op: 'upsert_entity', clientId: 'country', kind: 'location', name: '旧疆国', attributes: { geography: { boundary: boundary(0, 0, 100, 100) } } }])).idMap.country
    applyStoryAtlasChanges(futureBorderInput([{ op: 'upsert_entity', kind: 'location', name: '后续北郡', parentId: futureCountry, attributes: { geography: { boundary: boundary(40, 10, 60, 30) } } }], 4))
    const beforeBorderCorrection = queryStoryAtlas({ novelId: futureBorderNovel })
    assert.throws(() => applyStoryAtlasChanges(futureBorderInput([{ op: 'upsert_entity', id: futureCountry, kind: 'location', name: '旧疆国', attributes: { geography: { boundary: concave } } }])), /第 4 章.*超出上级/, 'background corrections must keep later regions within their parent borders')
    assert.deepEqual(queryStoryAtlas({ novelId: futureBorderNovel }), beforeBorderCorrection)

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
    process.stdout.write('PASS story atlas: hierarchy, native projections, shared graph, validation without writes, chapter history, future filtering, version/idempotency, cross-project protection, cycle/travel validation, outer transaction rollback, source migration, manual replacement and clearing, migrated reference preservation, current/future position guards\n')
  } finally { closeDb(); fs.rmSync(tempRoot, { recursive: true, force: true }) }
  app.exit(0)
}
main().catch((error) => { console.error(error); app.exit(1) })
