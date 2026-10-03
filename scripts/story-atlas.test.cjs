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
