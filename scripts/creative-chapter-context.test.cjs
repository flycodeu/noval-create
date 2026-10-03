const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'chapter-boundary-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
async function main() {
  await app.whenReady()
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  initDb()
  const db = getSqlite()
  const { migrateStoryAtlas } = require('../electron/database/story-atlas-store.ts')
  const { compileCreativeChapterContext: compile, assertCreativeChapterCandidate: gate, inspectCreativeChapterPrerequisites: inspect } = require('../electron/services/creative-chapter-context.ts')
  try {
    const novelId = Number(db.prepare('INSERT INTO novels(title,user_background,expanded_background,world_rules_json,context_version) VALUES(?,?,?,?,1)').run('边界测试', '渡口故事。', '未登记终局秘密不得直接注入', '{"hidden":"未登记规则秘密不得直接注入"}').lastInsertRowid)
    const person = Number(db.prepare("INSERT INTO characters(novel_id,full_name,role_type,hidden_secret,speech_pattern) VALUES(?,?,'protagonist',?,?)").run(novelId, '陈舟', '私有设定不可注入', '话短而清楚').lastInsertRowid)
    db.prepare("INSERT INTO characters(novel_id,full_name,role_type,goals,speech_pattern,background,inner_conflict,flaws_json) VALUES(?,?,'antagonist',?,?,?,?,?)").run(novelId, '邱账房', '保住赃物与账面秘密，把失踪推给阿烛或杨嫂。', '措辞周全，先请人核对', '与影鬼有意勾连，把客人姓名画像与行踪交出，并维护通往旧井的湿路；偷取财物，涂改账册。其动机不能替超自然规则开脱。', '求财与自保使他持续加深共谋', JSON.stringify(['为求财继续杀人']))
    db.prepare("INSERT INTO characters(novel_id,full_name,role_type,background) VALUES(?,?,'antagonist',?)").run(novelId, '旧井影鬼', '活动依赖连续湿路与旧井水；借邱账房提供的姓名、画像和湿路模仿亡者。无法凭空读透生者记忆，也不能越过断开的干处。')
    const chapter = (n, content = '') => Number(db.prepare('INSERT INTO chapters(novel_id,chapter_num,title,content,allowed_fact_ids_json,revealed_fact_ids_json) VALUES(?,?,?,?,?,?)').run(novelId, n, '渡口系绳', content, '[]', '[]').lastInsertRowid)
    const first = chapter(1, '陈舟知道河水暴涨。\n夜色落在石阶上，他把旧绳收在船舱里。')
    const target = chapter(2)
    const future = chapter(3)
    db.prepare('UPDATE novels SET world_rules_json=?,theme_voice_json=?,settings_json=? WHERE id=?').run(
      JSON.stringify({ powerSystems: [{ name: '观灯', limitations: '不能复生', cost: '伤眼' }], writingConstraints: { extraRules: ['渡河需要时间'] }, hidden: '未登记规则秘密不得直接注入' }),
      JSON.stringify({ pov: 'third_limited', style_rules: '对白克制，不替人物总结道理' }),
      JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 1 }, premise: { constraints: '主角保持凡人身份' }, writing_rules: { common_sense_rules: '伤势不能突然痊愈' }, story_design: { main_plot: '未登记全书终局不得注入' } }), novelId)
    db.prepare('UPDATE chapters SET content=? WHERE id=?').run('陈舟摸了摸磨白的旧绳，指尖沾着河泥。', target)
    const sampleId = Number(db.prepare('INSERT INTO style_fingerprints(novel_id,name,source_text,source_type) VALUES(?,?,?,?)').run(novelId, '显式样稿', '账房盗银，失踪的税银藏在井底。\n\n船板慢慢沉下去，他仍握着那根旧绳。', 'pasted').lastInsertRowid)
    require('../electron/services/style-analysis.service.ts').setActiveStyleFingerprint(novelId, sampleId)
    const known = Number(db.prepare('INSERT INTO story_facts(novel_id,title,summary,protagonist_known_chapter_id) VALUES(?,?,?,?)').run(novelId, '河水暴涨', '上游连日降雨', first).lastInsertRowid)
    const secret = Number(db.prepare('INSERT INTO story_facts(novel_id,title,summary,protagonist_known_chapter_id) VALUES(?,?,?,?)').run(novelId, '账房盗银', '失踪的税银藏在井底', future).lastInsertRowid)
    migrateStoryAtlas(db)
    const { applyStoryAtlasChanges, queryStoryAtlas } = require('../electron/services/story-atlas.service.ts')
    const atlasPerson = queryStoryAtlas({ novelId }).entities.find(entity => entity.name === '陈舟')
    const atlasNpc = queryStoryAtlas({ novelId }).entities.find(entity => entity.name === '邱账房')
    const atlasGhost = queryStoryAtlas({ novelId }).entities.find(entity => entity.name === '旧井影鬼')
    applyStoryAtlasChanges({ novelId, expectedContextVersion: 2, effectiveFromChapter: 0, idempotencyKey: 'geography-and-work', source: { kind: 'test' }, changes: [
      { op: 'upsert_entity', id: atlasPerson.id, kind: 'character', name: '陈舟', attributes: { goals: '守住渡船', habits: ['逐结检查缆绳'], dailyRoutine: '清晨巡视石阶', motivation: '履行渡工职责', abilityCosts: '久站耗费体力', abilityLimits: '无法听清对岸低语' } },
      { op: 'upsert_entity', id: atlasNpc.id, kind: 'character', name: '邱账房', attributes: { publicSummary: '店中负责客账登记的人', publicGoal: '尽快核对客账', firstImpression: '讲话稳妥', motivation: '灭口保身', abilities: ['暗中催眠'], abilityLimits: '只能催眠熟人', abilityCosts: '损失记忆', habits: ['说话前扶眼镜'] } },
      { op: 'upsert_relation', kind: 'relationship', fromId: atlasPerson.id, toId: atlasNpc.id, label: '对账协助' },
      { op: 'upsert_relation', kind: 'relationship', fromId: atlasPerson.id, toId: atlasGhost.id, label: '调查涉及' },
      { op: 'upsert_entity', clientId: 'region', kind: 'location', name: '南岭', attributes: { terrain: '低山河谷' } },
      { op: 'upsert_entity', clientId: 'village', kind: 'location', name: '河村', parentId: 'region', attributes: { livelihood: '摆渡' } },
      { op: 'upsert_entity', clientId: 'harbor', kind: 'location', name: '远港' },
      { op: 'upsert_entity', clientId: 'org', kind: 'faction', name: '水务会', attributes: { organizationLevel: 'organization', methods: '轮班巡河', funding: '会费' } },
      { op: 'upsert_entity', clientId: 'dept', kind: 'faction', name: '巡河部', parentId: 'org', attributes: { organizationLevel: 'department', positions: [{ id: 'watch', title: '值守员', status: 'established', responsibilities: '看护渡口' }, { id: 'future', title: '未来密巡使', status: 'planned', responsibilities: '未实行的扩展工作' }] } },
      { op: 'upsert_relation', kind: 'presence', fromId: atlasPerson.id, toId: 'village', label: '常住河村', attributes: { locationRole: 'residence' } },
      { op: 'upsert_relation', kind: 'membership', fromId: atlasPerson.id, toId: 'dept', label: '轮值守渡', attributes: { positionId: 'watch' } },
      { op: 'upsert_relation', kind: 'presence', fromId: 'org', toId: 'village', label: '总部所在地', attributes: { locationRole: 'headquarters' } },
      { op: 'upsert_relation', kind: 'route', fromId: 'village', toId: 'harbor', label: '顺流航道', attributes: { travelHours: 4, travelMode: '行船', routeOpen: true } },
    ] })
    const beforeCurrentChapter = queryStoryAtlas({ novelId })
    const region = beforeCurrentChapter.entities.find(entity => entity.name === '南岭')
    const existingBond = beforeCurrentChapter.relations.find(edge => edge.kind === 'relationship' && edge.toId === atlasNpc.id)
    const introductions = applyStoryAtlasChanges({ novelId, expectedContextVersion: beforeCurrentChapter.contextVersion, effectiveFromChapter: 2, idempotencyKey: 'chapter-two-introductions', source: { kind: 'test' }, changes: [
      { op: 'upsert_entity', id: atlasPerson.id, kind: 'character', name: '陈舟', attributes: { goals: '第二章末才决定辞去渡工' } },
      { op: 'upsert_entity', id: region.id, kind: 'location', name: '南岭', attributes: { terrain: '第二章末才发生山崩' } },
      { op: 'upsert_relation', id: existingBond.id, kind: 'relationship', fromId: atlasPerson.id, toId: atlasNpc.id, label: '第二章末才结成同盟' },
      { op: 'upsert_entity', clientId: 'newcomer', kind: 'character', name: '赵砚', summary: '首次登场的私有秘密不能注入', attributes: { publicSummary: '拎着补船木料的伙计', speechPattern: '先报来路，再问渡船', motivation: '初登场幕后动机不能注入', goals: '初登场秘密目标不能注入', hiddenSecret: '初登场隐情不能注入' } },
      { op: 'upsert_entity', clientId: 'town', kind: 'location', name: '石桥镇', parentId: region.id, attributes: { livelihood: '河岸木料交易' } },
      { op: 'upsert_entity', clientId: 'shop', kind: 'location', name: '木料铺', parentId: 'town', summary: '门旁堆着待运木料' },
      { op: 'upsert_entity', clientId: 'unmentioned', kind: 'character', name: '旁客', attributes: { publicSummary: '未被安排出场的旁客资料' } },
      { op: 'upsert_entity', clientId: 'planned', kind: 'character', name: '石榆', status: 'planned', attributes: { publicSummary: '尚未确认的候选人物档案' } },
      { op: 'upsert_entity', clientId: 'authorOnly', kind: 'character', name: '秦岑', attributes: { authorOnly: true, publicSummary: '仅作者可见的本章人物档案' } },
      { op: 'upsert_entity', clientId: 'futureOnly', kind: 'character', name: '未期者', attributes: { futureOnly: true, publicSummary: '标记未来专用的本章人物档案' } },
      { op: 'upsert_entity', clientId: 'event', kind: 'event', name: '木料失窃', summary: '本章末事件结果不可先作事实' },
      { op: 'upsert_relation', kind: 'presence', fromId: 'newcomer', toId: 'shop', label: '本章末才来到木料铺', attributes: { locationRole: 'current' } },
      { op: 'upsert_relation', kind: 'relationship', fromId: atlasPerson.id, toId: 'newcomer', label: '本章末才初次认识' },
    ] })
    applyStoryAtlasChanges({ novelId, expectedContextVersion: queryStoryAtlas({ novelId }).contextVersion, effectiveFromChapter: 3, idempotencyKey: 'future', source: { kind: 'test' }, changes: [
      { op: 'upsert_entity', id: atlasPerson.id, kind: 'character', name: '陈舟', summary: '未来才成为知府', attributes: { speechPattern: '未来才使用的官话' } },
      { op: 'upsert_entity', kind: 'character', name: '段青', attributes: { publicSummary: '第三章才准许使用的人物档案' } },
    ] })
    const input = { novelId, stage: 'chapter', request: '陈舟检查渡口旧绳，继续第二章。', atChapter: 2, idempotencyKey: 'fixture' }
    const limits = { maxInputTokens: 6000, outputReserve: 3000 }
    assert.ok(inspect(novelId, 2).blockers.length)
    await assert.rejects(compile(input, limits), error => error.code === 'CHAPTER_PREREQUISITES_REQUIRED')
    db.prepare("INSERT INTO chapter_contracts(novel_id,chapter_id,chapter_goal,status) VALUES(?,?,?,'ready')").run(novelId, target, '检查系船绳')
    await assert.rejects(compile(input, limits), error => error.code === 'CHAPTER_PREREQUISITES_REQUIRED')
    db.prepare("INSERT INTO scene_contracts(novel_id,chapter_id,pov,scene_goal,obstacle,result_state,status) VALUES(?,?,?,?,?,?,'ready')").run(novelId, target, '陈舟', '检查系船绳', '河水暴涨，旧绳磨断', '换上新绳，渡船停稳')
    const before = db.prepare('SELECT context_version FROM novels WHERE id=?').get(novelId).context_version
    const result = await compile(input, limits)
    assert.ok(result.text.includes('河水暴涨'))
    assert.ok(result.text.includes('话短而清楚'))
    for (const saved of ['守住渡船', '逐结检查缆绳', '清晨巡视石阶', '履行渡工职责', '久站耗费体力', '无法听清对岸低语', '南岭', '低山河谷', '巡河部', '水务会', '值守员', '看护渡口', '顺流航道', '"travelHours":4', '"locationRole":"residence"']) assert.ok(result.text.includes(saved), saved)
    for (const planned of ['未来密巡使', '未实行的扩展工作']) assert.ok(!result.text.includes(planned), planned)
    for (const npcPrivate of ['保住赃物与账面秘密', '灭口保身', '暗中催眠', '只能催眠熟人', '损失记忆']) assert.ok(!result.text.includes(npcPrivate), `unregistered NPC inner material must not leak: ${npcPrivate}`)
    for (const dossier of ['与影鬼有意勾连', '偷取财物', '求财与自保使他持续加深共谋', '为求财继续杀人', '活动依赖连续湿路与旧井水', '借邱账房提供的姓名', '也不能越过断开的干处', '"roleType":"antagonist"']) assert.ok(!result.text.includes(dossier), `unregistered author dossier must not leak: ${dossier}`)
    for (const observed of ['邱账房', '尽快核对客账', '说话前扶眼镜', '措辞周全，先请人核对', '店中负责客账登记的人', '讲话稳妥']) assert.ok(result.text.includes(observed), observed)
    assert.ok(result.omittedSources.includes(`${atlasNpc.id}:attributes.goals:not_public_to_pov`))
    assert.ok(result.omittedSources.includes(`${atlasNpc.id}:summary:not_public_to_pov`))
    assert.ok(result.omittedSources.includes(`${atlasGhost.id}:summary:not_public_to_pov`))
    assert.ok(result.text.includes('public_description'), 'missing NPC public description is visible without exposing the private fallback')
    assert.ok(result.text.includes('已设岗位不等于有人任职'))
    assert.ok(result.text.includes('location_current'), 'residence must not silently become present scene location')
    assert.ok(!result.sources.some(key => key.startsWith('chapter_introduction:')), 'unrequested first appearances do not expand the chapter cast')
    const introductionContext = await compile({ ...input, request: '陈舟在木料铺初次遇到赵砚。石榆、秦岑、未期者、段青与木料失窃只作为待核对的名字，不据此扩写。' }, { ...limits, maxInputTokens: 12000 })
    for (const id of [introductions.idMap.newcomer, introductions.idMap.town, introductions.idMap.shop]) {
      assert.ok(introductionContext.sources.includes(`chapter_introduction:${id}`), `new chapter entity must be available as an introduction plan: ${id}`)
      assert.ok(!introductionContext.sources.includes(id), 'introduction must not be promoted to chapter-opening canon')
    }
    for (const saved of ['本章引入计划', '不是章首已知事实', '拎着补船木料的伙计', '先报来路，再问渡船', '河岸木料交易', '门旁堆着待运木料', '低山河谷', '守住渡船', '对账协助']) assert.ok(introductionContext.text.includes(saved), saved)
    for (const denied of ['第二章末才决定辞去渡工', '第二章末才发生山崩', '第二章末才结成同盟', '本章末才来到木料铺', '本章末才初次认识', '本章末事件结果不可先作事实', '首次登场的私有秘密不能注入', '初登场幕后动机不能注入', '初登场秘密目标不能注入', '初登场隐情不能注入', '未被安排出场的旁客资料', '尚未确认的候选人物档案', '仅作者可见的本章人物档案', '标记未来专用的本章人物档案', '第三章才准许使用的人物档案']) assert.ok(!introductionContext.text.includes(denied), `introduction must not expose existing end-state updates or withheld material: ${denied}`)
    assert.ok(!introductionContext.sources.includes(`chapter_introduction:${introductions.idMap.event}`), 'current chapter events are not introductory entity records')
    db.prepare('UPDATE chapter_contracts SET chapter_goal=? WHERE chapter_id=?').run('检查系船绳，赵砚首次到访木料铺', target)
    const contractedIntroduction = await compile({ ...input, request: '按本章合同继续' }, { ...limits, maxInputTokens: 12000 })
    assert.ok(contractedIntroduction.sources.includes(`chapter_introduction:${introductions.idMap.newcomer}`), 'chapter contract alone can authorize an introduction')
    db.prepare('UPDATE chapter_contracts SET chapter_goal=? WHERE chapter_id=?').run('检查系船绳', target)
    const unnamed = await compile({ ...input, request: '继续本章，保留活动区域、职业和行程限制。' }, limits)
    assert.ok(unnamed.text.includes('顺流航道') && unnamed.text.includes('值守员'), 'scene POV anchors the graph when the request mentions no proper names')
    assert.ok(result.text.includes('夜色落在石阶上'), 'original ending retained without inventing a knowledge fact')
    for (const hidden of ['账房盗银', '失踪的税银藏在井底', '私有设定不可注入', '未登记终局秘密不得直接注入', '未登记规则秘密不得直接注入', '未来才成为知府', '未来才使用的官话']) assert.ok(!result.text.includes(hidden), hidden)
    assert.ok(result.text.includes('渡口故事。'))
    for (const required of ['不能复生', '伤眼', '渡河需要时间', '主角保持凡人身份', '伤势不能突然痊愈', '对白克制，不替人物总结道理', '指尖沾着河泥', '船板慢慢沉下去']) assert.ok(result.text.includes(required), required)
    assert.ok(!result.text.includes('未登记全书终局不得注入'))
    assert.ok(result.omittedSources.some(source => source.startsWith('author_reference:') && source.includes('pov_forbidden_fact')), 'approved sample still obeys chapter visibility')
    assert.ok(result.estimatedTokens <= limits.maxInputTokens)
    const reviewContext = await compile({ ...input, operation: 'review' }, limits)
    assert.ok(!reviewContext.text.includes('指尖沾着河泥'), 'review receives target prose separately, never twice in the prompt')
    db.prepare('UPDATE chapters SET content=content || ? WHERE id=?').run('账房盗银。', target)
    const leakingReviewContext = await compile({ ...input, operation: 'review' }, limits)
    assert.ok(leakingReviewContext.text.includes('review_boundary:fact:'), 'reviewer sees the matching forbidden fact boundary')
    await assert.rejects(compile(input, limits), error => error.code === 'CHAPTER_REQUIRED_SOURCE_HIDDEN')
    db.prepare('UPDATE chapters SET content=? WHERE id=?').run('陈舟摸了摸磨白的旧绳，指尖沾着河泥。', target)
    assert.equal(db.prepare('SELECT context_version FROM novels WHERE id=?').get(novelId).context_version, before, 'compile has no writes')
    await assert.rejects(compile(input, { ...limits, maxInputTokens: 10 }), error => error.code === 'CHAPTER_CONTEXT_BUDGET')
    db.prepare('UPDATE scene_contracts SET pov=? WHERE chapter_id=?').run('不存在的视角', target)
    await assert.rejects(compile(input, limits), error => error.code === 'CHAPTER_POV_UNRESOLVED')
    db.prepare('UPDATE scene_contracts SET pov=?,reveal_payload_json=? WHERE chapter_id=?').run('陈舟', JSON.stringify([`fact:${secret}`]), target)
    await assert.rejects(compile(input, limits), error => error.code === 'CHAPTER_REVEAL_NOT_AUTHORIZED')
    db.prepare('UPDATE chapters SET allowed_fact_ids_json=?,revealed_fact_ids_json=? WHERE id=?').run(JSON.stringify([secret]), JSON.stringify([secret]), target)
    const revealed = await compile(input, limits)
    assert.ok(revealed.text.includes('场景1揭示'))
    assert.ok(revealed.text.includes('账房盗银'))
    const revealRequest = { ...input, request: '陈舟通过读信揭示账房盗银，仅在场景1得知。' }
    const requestedReveal = await compile(revealRequest, limits)
    assert.ok(requestedReveal.text.includes(revealRequest.request), 'task may refer to the scene-authorized reveal')
    assert.ok(requestedReveal.text.includes('仅限指定场景，不能作为章首已知事实'))
    db.prepare('UPDATE scene_contracts SET reveal_payload_json=? WHERE chapter_id=?').run('[]', target)
    await assert.rejects(compile(input, limits), error => error.code === 'CHAPTER_REVEAL_SCENE_MISSING')
    db.prepare('UPDATE chapters SET allowed_fact_ids_json=?,revealed_fact_ids_json=? WHERE id=?').run('[]', '[]', target)
    await assert.rejects(compile(revealRequest, limits), error => error.code === 'CHAPTER_REQUIRED_SOURCE_HIDDEN')
    const content = '陈舟蹲下来检查系船绳。河水暴涨，旧绳磨断，他撑住晃动的船头，却怎么也拉不回缆绳。\n他换上新绳，渡船停稳。风里忽然传来一声呼喊，是谁在对岸等他？'
    const base = { novelId, chapterNum: 2, content, expectedContextVersion: before }
    assert.throws(() => gate({ ...base, content: content + '账房盗银。' }), error => error.code === 'CHAPTER_FORBIDDEN_FACT')
    assert.throws(() => gate({ ...base, changes: [{ op: 'upsert_entity', kind: 'item', name: '新绳' }] }), error => error.code === 'CHAPTER_CHANGE_EVIDENCE_MISSING')
    assert.throws(() => gate({ ...base, changes: [{ op: 'upsert_entity', kind: 'item', name: '新绳', attributes: { evidenceQuote: '正文没有这句话' } }] }), error => error.code === 'CHAPTER_CHANGE_EVIDENCE_MISSING')
    assert.throws(() => gate({ ...base, changes: [{ op: 'retire', id: `characters:${person}` }] }), error => error.code === 'CHAPTER_RETIRE_FORBIDDEN')
    assert.throws(() => gate({ ...base, expectedContextVersion: before + 1 }), error => error.code === 'CHAPTER_CONTEXT_STALE')
    assert.equal(gate({ ...base, changes: [{ op: 'upsert_entity', kind: 'item', name: '新绳', attributes: { evidenceQuote: '他换上新绳，渡船停稳' } }] }).chapterId, target)
    assert.ok(known > 0)
    process.stdout.write('PASS chapter context: prerequisites, POV, exact scene reveals, private/global/future isolation, chapter introduction plans without current end-state leakage, previous prose, budget, read-only compile, contract delivery, quoted graph changes\n')
  } finally { closeDb(); fs.rmSync(temp, { recursive: true, force: true }) }
  app.exit(0)
}
main().catch(error => { console.error(error); app.exit(1) })
