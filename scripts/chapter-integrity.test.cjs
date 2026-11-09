const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
require('./isolate-test-session.cjs')(app)
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const { cleanupElectronFixture } = require('./cleanup-electron-fixture.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'chapter-integrity')
if (!tempRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}

function project(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error && error.code, code)
    return true
  })
}

async function expectCodeAsync(fn, code) {
  await assert.rejects(fn, (error) => {
    assert.equal(error && error.code, code)
    return true
  })
}

async function run() {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.mkdirSync(tempRoot, { recursive: true })
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  app.setName('NovelForge Chapter Integrity')
  app.setPath('userData', tempRoot)
  app.commandLine.appendSwitch('disable-gpu')
  registerProjectTsRuntime(workspaceRoot)
  await app.whenReady()

  const { closeDb, getSqlite, initDb } = project('electron/database/db.ts')
  const novelService = project('electron/services/novel.service.ts')
  const chapterService = project('electron/services/chapter.service.ts')
  const contextImpactService = project('electron/services/context-impact.service.ts')
  const historyService = project('electron/services/history.service.ts')
  const storyArcService = project('electron/services/story-arc.service.ts')
  const storyThreadService = project('electron/services/story-thread.service.ts')
  const storyStructureService = project('electron/services/story-structure.service.ts')
  const storyStructureBatchService = project('electron/services/story-structure-batch.service.ts')
  const writebackService = project('electron/services/chapter-writeback.service.ts')
  const endgameAssets = project('electron/services/endgame-asset.service.ts')
  initDb()

  try {
    const novelA = novelService.createNovel({ title: '章节完整性测试 A', targetWords: 10000, operatingMode: 'shortform' })
    const novelB = novelService.createNovel({ title: '章节完整性测试 B', targetWords: 10000, operatingMode: 'shortform' })
    chapterService.createChapter(novelB, { chapterNum: 1, title: '外部小说章节' })

    const batchLengthNovel = novelService.createNovel({ title: '结构批量参考长度测试', targetWords: 10000, operatingMode: 'shortform' })
    storyStructureBatchService.applyStructureBatchPlan(batchLengthNovel, {
      volumes: [{
        title: '第一卷',
        parts: [{
          title: '第一部',
          chapters: [{ title: '批量新增章节', segments: [] }],
        }],
      }],
    })
    const batchLengthRow = getSqlite().prepare('SELECT target_words FROM chapters WHERE novel_id = ? LIMIT 1').get(batchLengthNovel)
    assert.equal(
      batchLengthRow.target_words,
      2400,
      `structure batch append must derive the operating-mode reference length when the plan omits targetWords (actual=${batchLengthRow.target_words})`,
    )

    const firstChapter = chapterService.createChapter(novelA, {
      chapterNum: 1,
      title: '第一章',
      outline: '验证状态门禁。',
      novelId: novelB,
    })
    {
      const planningNovel = novelService.createNovel({ title: '正文编辑后的规划缓存验证' })
      const planningChapter = chapterService.createChapter(planningNovel, { chapterNum: 1, title: '当前章' })
      const followingChapter = chapterService.createChapter(planningNovel, { chapterNum: 2, title: '后续章' })
      const original = '林舟把钥匙放回柜中。'
      chapterService.updateChapter(planningChapter, { content: original })
      contextImpactService.markChapterContextCurrent(planningChapter)
      const seedPlan = getSqlite().prepare('UPDATE chapters SET scene_plan_json = ?, bridge_plan_json = ? WHERE id = ?')
      const scenePlan = JSON.stringify([{ scene_order: 1, purpose: '打开已移走的柜子', location: '旧柜内禁用地点' }])
      const bridge = JSON.stringify({ opening: '沿用旧稿的柜前动作' })
      seedPlan.run(scenePlan, bridge, planningChapter)
      seedPlan.run('后章作者场景保持', '后章作者桥保持', followingChapter)
      const segment = getSqlite().prepare('SELECT id FROM chapter_segments WHERE chapter_id = ? ORDER BY segment_order LIMIT 1').get(planningChapter)
      endgameAssets.upsertChapterContract(planningChapter, { chapterGoal: '把钥匙交给等候的人', status: 'ready' })
      endgameAssets.upsertSceneContract(planningChapter, segment.id, { sceneGoal: '保留作者安排的场景合同', pov: '林舟', obstacle: '柜门挡路', resultState: '钥匙交到来人手中', status: 'ready' })
      const contractsBefore = getSqlite().prepare('SELECT * FROM scene_contracts WHERE chapter_id = ? ORDER BY id').all(planningChapter)
      chapterService.updateChapter(planningChapter, { summary: '只改摘要' })
      assert.equal(chapterService.getChapter(planningChapter).scenePlanJson, scenePlan, 'metadata-only updates keep the scene plan')
      chapterService.updateChapter(planningChapter, { content: original }, { expectedContent: original })
      assert.equal(chapterService.getChapter(planningChapter).bridgePlanJson, bridge, 'same-content saves keep the bridge')
      expectCode(() => chapterService.updateChapter(planningChapter, { content: '旧候选覆盖' }, { expectedContent: '过期正文' }), 'chapter.pipelineContentConflict')
      assert.equal(chapterService.getChapter(planningChapter).scenePlanJson, scenePlan, 'rejected CAS must not clear plans')
      const edited = '林舟把钥匙交给柜外等候的人。'
      chapterService.updateChapter(planningChapter, chapterService.sanitizeChapterUpdatePayload({
        content: edited, scenePlanJson: '外部不得伪造新计划', bridgePlanJson: '外部不得伪造新桥',
      }), chapterService.sanitizeChapterUpdateOptions({ expectedContent: original, preservePlanningArtifacts: true }))
      assert.equal(chapterService.getChapter(planningChapter).scenePlanJson, '', 'external prose edits invalidate the previous generated scene plan')
      assert.equal(chapterService.getChapter(planningChapter).bridgePlanJson, '', 'external prose edits invalidate the previous generated bridge')
      assert.deepEqual(getSqlite().prepare('SELECT * FROM scene_contracts WHERE chapter_id = ? ORDER BY id').all(planningChapter), contractsBefore, 'author scene contracts are not generated caches')
      assert.equal(chapterService.getChapter(followingChapter).scenePlanJson, '后章作者场景保持')
      assert.equal(chapterService.getChapter(followingChapter).bridgePlanJson, '后章作者桥保持')
      seedPlan.run(scenePlan, bridge, planningChapter)
      const legacyRow = getSqlite().prepare('SELECT scene_plan_json, bridge_plan_json FROM chapters WHERE id = ?').get(planningChapter)
      assert.equal(chapterService.getChapter(planningChapter).scenePlanJson, '', 'an upgraded read hides plans retained by legacy editor saves')
      assert.equal(chapterService.listChapters(planningNovel)[0].bridgePlanJson, '', 'chapter lists also hide legacy bridges')
      const integrityService = project('electron/services/generation-integrity.service.ts')
      assert.doesNotMatch(JSON.stringify(integrityService.buildChapterBridgePlan(followingChapter)), /旧柜内禁用地点/, 'a rebuilt bridge cannot reuse a stale scene location')
      assert.equal(chapterService.__testing.getRequiredChapterGenerationInput(planningChapter).scenePlanJson, '', 'generation and continuation inputs cannot bypass the stale-plan projection')
      const recall = project('electron/services/context-recall-runtime.ts')
      const recallCore = project('electron/services/context-recall-core.ts')
      const originalRecall = recall.runRecallAugmentation
      const previewModelId = Number(getSqlite().prepare("INSERT INTO model_configs (name, provider, model_id, api_key, base_url, is_default, max_context_tokens, max_tokens) VALUES ('Planning preview fixture', 'openai', 'fixture', '', 'http://127.0.0.1:1', 1, 32768, 1500)").run().lastInsertRowid)
      // This fixture checks planning consumption, without loading a vector model.
      recall.runRecallAugmentation = async () => ({ assemblyStage: 'recall', recalledMemory: '',
        recallSnapshot: recallCore.createEmptyRecallSnapshot(), recallDiagnostics: recallCore.buildEmptyRecallDiagnostics(), recalledMemorySources: [] })
      try {
        const rawContext = await project('electron/services/context.service.ts').collectChapterContextRawData(planningNovel, 1)
        assert.equal(rawContext.currentChapter.scenePlanJson, '', 'writer context cannot reuse a stale scene plan')
        const preview = await chapterService.getChapterContextPreview(planningChapter)
        assert.doesNotMatch(JSON.stringify(preview), /旧柜内禁用地点|打开已移走的柜子/, 'context preview step memory cannot re-inject stale scenes')
        assert.doesNotMatch(JSON.stringify(storyThreadService.buildRecentStoryDesignProjection(planningNovel, 2)), /旧柜内禁用地点|打开已移走的柜子/, 'reader-first recent-plan prompts cannot reuse legacy plans')
        const taskService = project('electron/services/task.service.ts')
        const continuationSourceId = await taskService.createTask({ type: 'chapter_write', novelId: planningNovel,
          relatedEntityType: 'chapter', relatedEntityId: planningChapter, runnerType: 'workflow', status: 'failed', progressJson: '{}' })
        const sourceSnapshot = project('electron/services/chapter-pipeline-state.ts').createInitialChapterPipelineSnapshot(planningChapter, continuationSourceId, '', { content: edited, contextVersion: novelService.getNovel(planningNovel).contextVersion })
        const narrativePolicy = project('electron/services/chapter-narrative-policy.ts')
        sourceSnapshot.narrativeIdentity = narrativePolicy.currentNarrativeSceneIdentity(narrativePolicy.resolveChapterNarrativeIdentity(planningChapter), scenePlan)
        taskService.updateTask(continuationSourceId, { progressJson: JSON.stringify(sourceSnapshot) })
        const continuation = await chapterService.__testing.prepareChapterContinuation(planningChapter, edited, undefined, { sourceTaskId: continuationSourceId })
        assert.doesNotMatch(continuation.continuationPrompt, /旧柜内禁用地点|打开已移走的柜子/, 'the continuation prompt cannot reuse the old scene plan')
        assert.equal(continuation.snapshot.plannerScenePlanJson, undefined, 'the continuation task cannot persist a stale planner snapshot')
        taskService.updateTask(continuation.workflowTaskId, { status: 'failed', errorMessage: 'Fixture preparation complete' })
      } finally {
        recall.runRecallAugmentation = originalRecall
        getSqlite().prepare('DELETE FROM model_configs WHERE id = ?').run(previewModelId)
      }
      assert.deepEqual(getSqlite().prepare('SELECT scene_plan_json, bridge_plan_json FROM chapters WHERE id = ?').get(planningChapter), legacyRow, 'legacy read projection never migrates persisted plans')
      contextImpactService.markChapterContextCurrent(planningChapter)
      assert.equal(getSqlite().prepare('SELECT scene_plan_json FROM chapters WHERE id = ?').get(planningChapter).scene_plan_json, '', 'refreshing current derivatives cannot revive a stale legacy plan')
      seedPlan.run(scenePlan, bridge, planningChapter)
      getSqlite().prepare('UPDATE chapters SET stale_reason_json = ? WHERE id = ?').run(JSON.stringify(['第1章正文版本已修改，派生材料和后章输入需重新核对', '世界规则已变更']), planningChapter)
      chapterService.updateChapter(planningChapter, { scenePlanJson: scenePlan }, { preservePlanningArtifacts: true })
      chapterService.__testing.updatePipelineChapterContent(planningChapter, edited, novelService.getNovel(planningNovel).contextVersion, { content: '林舟把钥匙递过去，等对方收好。', status: 'draft' })
      assert.equal(chapterService.getChapter(planningChapter).scenePlanJson, scenePlan, 'a validated pipeline keeps its fresh plan visible before final memory refresh')
      assert.equal(chapterService.__testing.getRequiredChapterGenerationInput(planningChapter).bridgePlanJson, bridge, 'retry input retains the validated pipeline bridge')
      assert.match(chapterService.getChapter(planningChapter).staleReasonJson, /世界规则已变更/, 'refreshing planning must not clear unrelated stale reasons')
      contextImpactService.markChapterContextCurrent(planningChapter, { preservePlanningArtifacts: true })
      assert.equal(chapterService.getChapter(planningChapter).scenePlanJson, scenePlan, 'a CAS-checked pipeline keeps the plan used for its new body')
      assert.equal(chapterService.getChapter(planningChapter).bridgePlanJson, bridge)
      const legacyContinuation = chapterService.createChapter(planningNovel, { chapterNum: 3, title: '旧版本续写' })
      chapterService.updateChapter(legacyContinuation, { content: original })
      seedPlan.run(scenePlan, bridge, legacyContinuation)
      const legacyBeforeCas = getSqlite().prepare('SELECT scene_plan_json, bridge_plan_json, stale_reason_json FROM chapters WHERE id = ?').get(legacyContinuation)
      expectCode(() => chapterService.__testing.updatePipelineChapterContent(legacyContinuation, '过期原文', novelService.getNovel(planningNovel).contextVersion, { content: edited, status: 'draft' }), 'chapter.pipelineContentConflict')
      assert.deepEqual(getSqlite().prepare('SELECT scene_plan_json, bridge_plan_json, stale_reason_json FROM chapters WHERE id = ?').get(legacyContinuation), legacyBeforeCas, 'a rejected pipeline CAS cannot bless or erase a legacy snapshot')
      chapterService.__testing.updatePipelineChapterContent(legacyContinuation, original, novelService.getNovel(planningNovel).contextVersion, { content: edited, status: 'draft' })
      assert.equal(getSqlite().prepare('SELECT scene_plan_json FROM chapters WHERE id = ?').get(legacyContinuation).scene_plan_json, '', 'continuation without a fresh Planner must clear the legacy snapshot on commit')
      contextImpactService.markChapterContextCurrent(legacyContinuation, { preservePlanningArtifacts: true })
      assert.equal(chapterService.getChapter(legacyContinuation).bridgePlanJson, '', 'finalizing the continuation cannot revive its legacy bridge')
    }
    {
      const sceneNovel = novelService.createNovel({ title: '场景合同归属验证' })
      const foreignSceneNovel = novelService.createNovel({ title: '外部场景归属验证' })
      const sceneChapter = chapterService.createChapter(sceneNovel, { chapterNum: 1, title: '合同目标章节' })
      const otherChapter = chapterService.createChapter(sceneNovel, { chapterNum: 2, title: '同作品其他章节' })
      const foreignChapter = chapterService.createChapter(foreignSceneNovel, { chapterNum: 1, title: '外部场景章节' })
      const localSegment = storyStructureService.createChapterSegment(sceneChapter, { title: '合法场景' })
      const otherSegment = storyStructureService.createChapterSegment(otherChapter, { title: '其他章节场景' })
      const foreignSegment = storyStructureService.createChapterSegment(foreignChapter, { title: '其他作品场景' })
      const contractsBefore = getSqlite().prepare('SELECT * FROM scene_contracts ORDER BY id').all()
      const versionBefore = novelService.getNovel(sceneNovel).contextVersion
      for (const segmentId of [otherSegment, foreignSegment]) {
        expectCode(() => endgameAssets.upsertSceneContract(sceneChapter, segmentId, { sceneGoal: '错误归属' }), 'segment.chapterMismatch')
      }
      assert.deepEqual(getSqlite().prepare('SELECT * FROM scene_contracts ORDER BY id').all(), contractsBefore)
      assert.equal(novelService.getNovel(sceneNovel).contextVersion, versionBefore, 'rejected scene writes must not invalidate context')
      endgameAssets.upsertSceneContract(sceneChapter, localSegment, { sceneGoal: '合法场景合同' })
      assert.equal(endgameAssets.listSceneContracts(sceneChapter).find(row => row.segmentId === localSegment).sceneGoal, '合法场景合同')
    }
    const clientPayload = chapterService.sanitizeChapterUpdatePayload({
      title: '允许更新',
      summary: '允许恢复摘要',
      chapterNum: 999,
      contextVersion: 999,
      writebackStatusJson: '{"phase":"applied"}',
      novelId: novelB,
    })
    const firstRow = getSqlite().prepare('SELECT novel_id, status, target_words FROM chapters WHERE id = ?').get(firstChapter)
    assert.equal(firstRow.novel_id, novelA, 'chapter:create must pin the owner novelId')
    assert.equal(firstRow.status, 'outline')
    assert.equal(firstRow.target_words, 2400, 'chapter:create must derive the flexible reference length from the novel operating mode')
    assert.deepEqual(clientPayload, { title: '允许更新', summary: '允许恢复摘要' }, 'IPC chapter updates must retain editable snapshot fields but drop internal state')
    assert.deepEqual(
      chapterService.sanitizeChapterUpdateOptions({ versionSource: 'ai-rewrite', allowChapterNumberChange: true, skipStaleTracking: true }),
      { versionSource: 'ai-rewrite' },
      'IPC chapter options must not expose internal transaction controls',
    )
    expectCode(
      () => chapterService.sanitizeChapterUpdateOptions({ versionSource: 'pipeline-generate' }),
      'ipc.invalidObject',
    )
    assert.deepEqual(
      chapterService.sanitizeChapterGenerationOptions({
        executionMode: 'premium',
        preserveConstraintLabels: ['chapterGoal', 'chapterGoal', 'openLoops'],
        ignoredInternalFlag: true,
      }),
      { executionMode: 'premium', preserveConstraintLabels: ['chapterGoal', 'openLoops'] },
      'chapter generation options must keep only validated route and constraint labels',
    )
    assert.deepEqual(chapterService.sanitizeChapterGenerationOptions(null), {})
    expectCode(
      () => chapterService.sanitizeChapterGenerationOptions({ executionMode: 'pipeline-generate' }),
      'ipc.invalidObject',
    )
    expectCode(
      () => chapterService.sanitizeChapterGenerationOptions({ preserveConstraintLabels: ['not-a-real-label'] }),
      'ipc.invalidObject',
    )
    expectCode(() => chapterService.createChapter(novelA, { title: '禁止直达定稿', status: 'final' }), 'chapter.publishBlocked')

    const secondChapter = chapterService.createChapter(novelA, { chapterNum: 2, title: '第二章' })
    const thirdChapter = chapterService.createChapter(novelA, { chapterNum: 3, title: '第三章' })
    const maxBasedChapter = chapterService.createChapter(novelA, { chapterNum: 8, title: '编号间隔测试' })
    const autoNumberedChapter = chapterService.createChapter(novelA, { title: '按最大编号递增' })
    assert.equal(getSqlite().prepare('SELECT chapter_num FROM chapters WHERE id = ?').get(autoNumberedChapter).chapter_num, 9)
    expectCode(() => chapterService.createChapter(novelA, { chapterNum: 1, title: '重复编号' }), 'chapter.renumberConflict')
    const foreignVolume = getSqlite().prepare('SELECT id FROM story_volumes WHERE novel_id = ? LIMIT 1').get(novelB)
    expectCode(
      () => chapterService.createChapter(novelA, { title: '越权结构引用', volumeId: foreignVolume.id }),
      'volume.notFound',
    )
    const secondVolume = getSqlite().prepare(`
      INSERT INTO story_volumes (novel_id, volume_number, title, status)
      VALUES (?, 2, '第二卷', 'planning')
    `).run(novelA)
    const secondPart = getSqlite().prepare(`
      INSERT INTO story_parts (novel_id, volume_id, part_number, title, status)
      VALUES (?, ?, 1, '第二部', 'planning')
    `).run(novelA, Number(secondVolume.lastInsertRowid))
    const plannedVolume = getSqlite().prepare(`
      INSERT INTO story_volumes (novel_id, volume_number, title, status)
      VALUES (?, 4, '按范围分配卷', 'planning')
    `).run(novelA)
    const plannedVolumeId = Number(plannedVolume.lastInsertRowid)
    getSqlite().prepare(`
      INSERT INTO story_parts (novel_id, volume_id, part_number, title, start_chapter_num, end_chapter_num, status)
      VALUES (?, ?, 1, '范围部一', 40, 49, 'planning')
    `).run(novelA, plannedVolumeId)
    const plannedPartTwo = getSqlite().prepare(`
      INSERT INTO story_parts (novel_id, volume_id, part_number, title, start_chapter_num, end_chapter_num, status)
      VALUES (?, ?, 2, '范围部二', 50, 59, 'planning')
    `).run(novelA, plannedVolumeId)
    const rangeAssignedChapter = chapterService.createChapter(novelA, {
      volumeId: plannedVolumeId,
      chapterNum: 50,
      title: '按部范围分配章节',
    })
    assert.equal(
      getSqlite().prepare('SELECT part_id FROM chapters WHERE id = ?').get(rangeAssignedChapter).part_id,
      Number(plannedPartTwo.lastInsertRowid),
      'volume-only chapter creation must honor the planned chapter range instead of always selecting the first part',
    )
    const emptyVolume = getSqlite().prepare(`
      INSERT INTO story_volumes (novel_id, volume_number, title, status)
      VALUES (?, 3, '空卷', 'planning')
    `).run(novelA)
    const emptyVolumeId = Number(emptyVolume.lastInsertRowid)
    expectCode(
      () => chapterService.createChapter(novelA, { volumeId: emptyVolumeId, chapterNum: 1, title: '失败后不得留空部' }),
      'chapter.renumberConflict',
    )
    assert.equal(
      getSqlite().prepare('SELECT COUNT(*) AS count FROM story_parts WHERE volume_id = ?').get(emptyVolumeId).count,
      0,
      'failed chapter creation must not leave an auto-created part',
    )
    expectCode(
      () => chapterService.updateChapter(firstChapter, { volumeId: Number(secondVolume.lastInsertRowid) }),
      'chapter.structureConflict',
    )
    expectCode(
      () => chapterService.updateChapter(firstChapter, { partId: Number(secondPart.lastInsertRowid) }),
      'chapter.structureConflict',
    )
    expectCode(
      () => chapterService.updateChapter(firstChapter, { chapterNum: 99 }),
      'chapter.renumberConflict',
    )

    const foreignChapter = getSqlite().prepare('SELECT id FROM chapters WHERE novel_id = ? LIMIT 1').get(novelB).id
    expectCode(
      () => chapterService.batchUpdateChapters([firstChapter, foreignChapter], { status: 'draft' }),
      'structure.invalidChapterIds',
    )
    expectCode(
      () => chapterService.batchRenumberChapters([firstChapter, foreignChapter], 20),
      'structure.invalidChapterIds',
    )
    expectCode(
      () => chapterService.batchDeleteChapters([firstChapter, foreignChapter]),
      'structure.invalidChapterIds',
    )
    assert.equal(getSqlite().prepare('SELECT id FROM chapters WHERE id = ?').get(foreignChapter).id, foreignChapter)

    const atomicNovel = novelService.createNovel({ title: '章节批量删除原子性测试', targetWords: 5000 })
    const atomicFirst = chapterService.createChapter(atomicNovel, { chapterNum: 1, title: '原子删除第一章' })
    const atomicSecond = chapterService.createChapter(atomicNovel, { chapterNum: 2, title: '原子删除第二章' })
    getSqlite().exec(`
      CREATE TRIGGER fail_atomic_batch_second_delete
      BEFORE DELETE ON chapters
      WHEN OLD.id = ${atomicSecond}
      BEGIN
        SELECT RAISE(ABORT, 'forced batch delete failure');
      END;
    `)
    assert.throws(
      () => chapterService.batchDeleteChapters([atomicFirst, atomicSecond]),
      /forced batch delete failure/u,
    )
    getSqlite().exec('DROP TRIGGER fail_atomic_batch_second_delete')
    assert.deepEqual(
      getSqlite().prepare('SELECT id, chapter_num FROM chapters WHERE novel_id = ? ORDER BY chapter_num').all(atomicNovel),
      [{ id: atomicFirst, chapter_num: 1 }, { id: atomicSecond, chapter_num: 2 }],
      'failed batch delete must roll back chapters deleted earlier in the same batch',
    )
    assert.equal(
      getSqlite().prepare("SELECT COUNT(*) AS count FROM operation_logs WHERE novel_id = ? AND operation_type = 'batch_delete'").get(atomicNovel).count,
      0,
      'failed batch delete must not leave an undo log for a mutation that rolled back',
    )

    const arcNovel = novelService.createNovel({ title: '故事弧引用完整性测试', targetWords: 5000 })
    const arcChapter = chapterService.createChapter(arcNovel, { chapterNum: 1, title: '绑定故事弧的章节' })
    const deletedArcId = storyArcService.createStoryArc(arcNovel, { arcName: '待删除故事弧', arcOrder: 1 })
    getSqlite().prepare('UPDATE chapters SET arc_id = ? WHERE id = ?').run(deletedArcId, arcChapter)
    storyArcService.deleteStoryArc(deletedArcId)
    assert.equal(
      getSqlite().prepare('SELECT arc_id FROM chapters WHERE id = ?').get(arcChapter).arc_id,
      null,
      'deleting one story arc must detach chapters because chapters.arc_id has no foreign key',
    )

    const rollbackArcA = storyArcService.createStoryArc(arcNovel, { arcName: '清空回滚 A', arcOrder: 2 })
    storyArcService.createStoryArc(arcNovel, { arcName: '清空回滚 B', arcOrder: 3 })
    getSqlite().prepare('UPDATE chapters SET arc_id = ? WHERE id = ?').run(rollbackArcA, arcChapter)
    getSqlite().exec(`
      CREATE TRIGGER fail_story_arc_clear_chapter_update
      BEFORE UPDATE OF arc_id ON chapters
      WHEN OLD.id = ${arcChapter}
      BEGIN
        SELECT RAISE(ABORT, 'forced story arc clear failure');
      END;
    `)
    assert.throws(
      () => storyArcService.clearStoryArcs(arcNovel),
      /forced story arc clear failure/u,
    )
    getSqlite().exec('DROP TRIGGER fail_story_arc_clear_chapter_update')
    assert.equal(
      getSqlite().prepare('SELECT COUNT(*) AS count FROM story_arcs WHERE novel_id = ?').get(arcNovel).count,
      2,
      'failed story arc clear must roll back arc deletion',
    )
    assert.equal(
      getSqlite().prepare('SELECT arc_id FROM chapters WHERE id = ?').get(arcChapter).arc_id,
      rollbackArcA,
      'failed story arc clear must preserve the original chapter binding',
    )

    const threadAtomicNovel = novelService.createNovel({ title: '故事线程批量删除原子性测试', targetWords: 5000 })
    const atomicThreadA = storyThreadService.createStoryThread(threadAtomicNovel, { title: '原子线程 A' }, { skipContextTracking: true })
    const atomicThreadB = storyThreadService.createStoryThread(threadAtomicNovel, { title: '原子线程 B' }, { skipContextTracking: true })
    getSqlite().exec(`
      CREATE TRIGGER fail_atomic_thread_second_delete
      BEFORE DELETE ON story_threads
      WHEN OLD.id = ${atomicThreadB}
      BEGIN
        SELECT RAISE(ABORT, 'forced thread batch delete failure');
      END;
    `)
    assert.throws(
      () => storyThreadService.batchDeleteStoryThreads([atomicThreadA, atomicThreadB]),
      /forced thread batch delete failure/u,
    )
    getSqlite().exec('DROP TRIGGER fail_atomic_thread_second_delete')
    assert.deepEqual(
      getSqlite().prepare('SELECT id FROM story_threads WHERE novel_id = ? ORDER BY id').all(threadAtomicNovel),
      [{ id: atomicThreadA }, { id: atomicThreadB }],
      'failed story thread batch delete must roll back threads deleted earlier in the batch',
    )
    assert.equal(
      getSqlite().prepare("SELECT COUNT(*) AS count FROM operation_logs WHERE novel_id = ? AND entity_type = 'thread' AND operation_type = 'batch_delete'").get(threadAtomicNovel).count,
      0,
      'failed story thread batch delete must not leave a misleading undo log',
    )

    expectCode(() => chapterService.updateChapter(firstChapter, { status: 'final' }), 'chapter.publishBlocked')
    expectCode(
      () => chapterService.batchUpdateChapters([firstChapter, secondChapter], { status: 'final' }),
      'chapter.publishBlocked',
    )
    const unchangedStatuses = getSqlite().prepare('SELECT id, status FROM chapters WHERE id IN (?, ?) ORDER BY id').all(firstChapter, secondChapter)
    assert.deepEqual(unchangedStatuses.map((row) => row.status), ['outline', 'outline'])

    getSqlite().prepare(`
      UPDATE chapters
      SET status = 'final', summary = '旧摘要', continuity_state_json = '{"old":true}',
          review_notes_json = '{"old":true}', ai_score_json = '{"score":99}'
      WHERE id = ?
    `).run(firstChapter)
    getSqlite().prepare(`
      INSERT INTO chapter_writeback_runs
        (novel_id, chapter_id, status, trigger_source, source_chapter_version, created_at, updated_at)
      VALUES (?, ?, 'ready', 'integrity-test', 1, ?, ?)
    `).run(novelA, firstChapter, new Date().toISOString(), new Date().toISOString())
    chapterService.updateChapter(firstChapter, { content: '正文发生了新的状态变化。' })
    const invalidated = getSqlite().prepare(`
      SELECT status, summary, continuity_state_json, review_notes_json, ai_score_json, stale_reason_json, writeback_status_json
      FROM chapters WHERE id = ?
    `).get(firstChapter)
    assert.equal(invalidated.status, 'draft')
    assert.equal(invalidated.summary, '')
    assert.equal(invalidated.continuity_state_json, '')
    assert.equal(invalidated.review_notes_json, '')
    assert.equal(invalidated.ai_score_json, '')
    assert.match(invalidated.stale_reason_json, /正文已更新/)
    assert.equal(JSON.parse(invalidated.writeback_status_json).phase, 'idle')
    assert.equal(getSqlite().prepare('SELECT status FROM chapter_writeback_runs WHERE chapter_id = ? ORDER BY id DESC LIMIT 1').get(firstChapter).status, 'failed')
    chapterService.updateChapter(firstChapter, {
      content: '流水线提交的新正文。',
      reviewNotesJson: '{"semantic_verdicts":[{"status":"pass"}]}',
    }, { skipStaleTracking: true, versionSource: false })
    const preservedReviewNotes = getSqlite().prepare('SELECT review_notes_json FROM chapters WHERE id = ?').get(firstChapter).review_notes_json
    assert.match(preservedReviewNotes, /semantic_verdicts/, `internal pipeline review notes must survive: ${preservedReviewNotes}`)

    getSqlite().prepare(`
      UPDATE chapters
      SET status = 'final', summary = '待清理摘要', continuity_state_json = '{"old":true}', review_notes_json = '{"old":true}'
      WHERE id = ?
    `).run(secondChapter)
    const secondSegment = getSqlite().prepare('SELECT id FROM chapter_segments WHERE chapter_id = ? LIMIT 1').get(secondChapter).id
    storyStructureService.updateChapterSegment(secondSegment, { content: '由场景编译得到的新正文。' })
    storyStructureService.compileChapterFromSegments(secondChapter)
    const compiled = getSqlite().prepare('SELECT status, summary, continuity_state_json, review_notes_json FROM chapters WHERE id = ?').get(secondChapter)
    assert.equal(compiled.status, 'draft')
    assert.equal(compiled.summary, '')
    assert.equal(compiled.continuity_state_json, '')
    assert.equal(compiled.review_notes_json, '')

    getSqlite().prepare(`
      INSERT INTO story_arcs (novel_id, arc_name, arc_order, chapter_start, chapter_end)
      VALUES (?, '测试主线', 1, 1, 2)
    `).run(novelA)
    getSqlite().prepare(`
      INSERT INTO story_threads (novel_id, title, start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter)
      VALUES (?, '测试线程', 1, 2, 1, 2)
    `).run(novelA)

    expectCode(() => chapterService.batchRenumberChapters([firstChapter], 3), 'chapter.renumberConflict')
    const beforeRemap = getSqlite().prepare('SELECT chapter_num FROM chapters WHERE id = ?').get(firstChapter)
    assert.equal(beforeRemap.chapter_num, 1)

    chapterService.batchRenumberChapters([firstChapter, secondChapter], 10)
    const remappedArc = getSqlite().prepare('SELECT chapter_start, chapter_end FROM story_arcs WHERE novel_id = ?').get(novelA)
    const remappedThread = getSqlite().prepare('SELECT start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter FROM story_threads WHERE novel_id = ?').get(novelA)
    assert.deepEqual(remappedArc, { chapter_start: 10, chapter_end: 11 })
    assert.deepEqual(remappedThread, { start_chapter: 10, target_payoff_chapter: 11, planted_chapter: 10, last_referenced_chapter: 11 })

    chapterService.reorderChapters([thirdChapter, firstChapter, secondChapter], 1)
    const reordered = getSqlite().prepare('SELECT id, chapter_num FROM chapters WHERE id IN (?, ?, ?) ORDER BY chapter_num').all(thirdChapter, firstChapter, secondChapter)
    assert.deepEqual(reordered.map((row) => row.id), [thirdChapter, firstChapter, secondChapter])
    assert.deepEqual(reordered.map((row) => row.chapter_num), [1, 2, 3])
    const reorderedArc = getSqlite().prepare('SELECT chapter_start, chapter_end FROM story_arcs WHERE novel_id = ?').get(novelA)
    const reorderedThread = getSqlite().prepare('SELECT start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter FROM story_threads WHERE novel_id = ?').get(novelA)
    assert.deepEqual(reorderedArc, { chapter_start: 2, chapter_end: 3 })
    assert.deepEqual(reorderedThread, { start_chapter: 2, target_payoff_chapter: 3, planted_chapter: 2, last_referenced_chapter: 3 })

    chapterService.deleteChapter(thirdChapter)
    assert.equal(getSqlite().prepare('SELECT chapter_num FROM chapters WHERE id = ?').get(firstChapter).chapter_num, 1)
    assert.equal(getSqlite().prepare('SELECT chapter_num FROM chapters WHERE id = ?').get(secondChapter).chapter_num, 2)
    const deletedArc = getSqlite().prepare('SELECT chapter_start, chapter_end FROM story_arcs WHERE novel_id = ?').get(novelA)
    const deletedThread = getSqlite().prepare('SELECT start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter FROM story_threads WHERE novel_id = ?').get(novelA)
    assert.deepEqual(deletedArc, { chapter_start: 1, chapter_end: 2 })
    assert.deepEqual(deletedThread, { start_chapter: 1, target_payoff_chapter: 2, planted_chapter: 1, last_referenced_chapter: 2 })

    const defaultPartId = getSqlite().prepare('SELECT part_id FROM chapters WHERE id = ?').get(firstChapter).part_id
    const reorderedMax = getSqlite().prepare('SELECT id FROM chapters WHERE id = ?').get(maxBasedChapter).id
    const reorderedAuto = getSqlite().prepare('SELECT id FROM chapters WHERE id = ?').get(autoNumberedChapter).id
    storyStructureService.applyStructureBatchEdit(novelA, [{
      kind: 'reorder_chapters',
      partId: defaultPartId,
      orderedIds: [secondChapter, firstChapter, reorderedMax, reorderedAuto],
    }])
    const structureArc = getSqlite().prepare('SELECT chapter_start, chapter_end FROM story_arcs WHERE novel_id = ?').get(novelA)
    const structureThread = getSqlite().prepare('SELECT start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter FROM story_threads WHERE novel_id = ?').get(novelA)
    assert.deepEqual(structureArc, { chapter_start: 1, chapter_end: 2 })
    assert.deepEqual(structureThread, { start_chapter: 2, target_payoff_chapter: 1, planted_chapter: 2, last_referenced_chapter: 1 })
    const sentinelUpdatedAt = '2000-01-01T00:00:00.000Z'
    const defaultPartSegmentId = getSqlite().prepare('SELECT id FROM chapter_segments WHERE chapter_id = ? LIMIT 1').get(firstChapter).id
    getSqlite().prepare('UPDATE story_parts SET updated_at = ? WHERE id = ?').run(sentinelUpdatedAt, defaultPartId)
    getSqlite().prepare('UPDATE chapter_segments SET updated_at = ? WHERE id = ?').run(sentinelUpdatedAt, defaultPartSegmentId)
    storyStructureService.ensureStoryStructure(novelA)
    assert.equal(
      getSqlite().prepare('SELECT updated_at FROM story_parts WHERE id = ?').get(defaultPartId).updated_at,
      sentinelUpdatedAt,
      'reading a stable structure must not rewrite the part updatedAt',
    )
    assert.equal(
      getSqlite().prepare('SELECT updated_at FROM chapter_segments WHERE id = ?').get(defaultPartSegmentId).updated_at,
      sentinelUpdatedAt,
      'reading a stable structure must not rewrite segment updatedAt',
    )
    const repairedVolumeChapter = chapterService.createChapter(novelA, {
      volumeId: Number(secondVolume.lastInsertRowid),
      title: '修复失效部引用',
    })
    getSqlite().prepare('UPDATE chapters SET part_id = NULL WHERE id = ?').run(repairedVolumeChapter)
    storyStructureService.ensureStoryStructure(novelA)
    const repairedVolumeChapterRow = getSqlite().prepare('SELECT volume_id, part_id FROM chapters WHERE id = ?').get(repairedVolumeChapter)
    assert.equal(repairedVolumeChapterRow.volume_id, Number(secondVolume.lastInsertRowid))
    assert.equal(
      getSqlite().prepare('SELECT volume_id FROM story_parts WHERE id = ?').get(repairedVolumeChapterRow.part_id).volume_id,
      Number(secondVolume.lastInsertRowid),
      'a chapter with a valid volume but missing part must be repaired inside that volume',
    )
    assert.equal(
      getSqlite().prepare('SELECT part_id FROM chapter_segments WHERE chapter_id = ? LIMIT 1').get(repairedVolumeChapter).part_id,
      repairedVolumeChapterRow.part_id,
      'structure repair must keep chapter segments aligned with the repaired part',
    )
    const volumeChapter = chapterService.createChapter(novelA, {
      volumeId: Number(secondVolume.lastInsertRowid),
      title: '指定卷新增章节',
    })
    const volumeChapterRow = getSqlite().prepare('SELECT volume_id, part_id FROM chapters WHERE id = ?').get(volumeChapter)
    assert.equal(volumeChapterRow.volume_id, Number(secondVolume.lastInsertRowid))
    assert.equal(volumeChapterRow.part_id, Number(secondPart.lastInsertRowid))
    const autoPartChapter = chapterService.createChapter(novelA, {
      volumeId: emptyVolumeId,
      title: '空卷自动建部',
    })
    const autoPartChapterRow = getSqlite().prepare('SELECT volume_id, part_id FROM chapters WHERE id = ?').get(autoPartChapter)
    assert.equal(autoPartChapterRow.volume_id, emptyVolumeId)
    assert.ok(autoPartChapterRow.part_id > 0)
    assert.equal(
      getSqlite().prepare('SELECT volume_id FROM story_parts WHERE id = ?').get(autoPartChapterRow.part_id).volume_id,
      emptyVolumeId,
    )
    getSqlite().prepare('DELETE FROM story_parts WHERE id = ?').run(autoPartChapterRow.part_id)
    storyStructureService.ensureStoryStructure(novelA)
    const repairedEmptyVolumeChapterRow = getSqlite().prepare('SELECT volume_id, part_id FROM chapters WHERE id = ?').get(autoPartChapter)
    assert.equal(repairedEmptyVolumeChapterRow.volume_id, emptyVolumeId)
    assert.ok(repairedEmptyVolumeChapterRow.part_id > 0)
    assert.equal(
      getSqlite().prepare('SELECT volume_id FROM story_parts WHERE id = ?').get(repairedEmptyVolumeChapterRow.part_id).volume_id,
      emptyVolumeId,
      'a legacy chapter in a part-less volume must receive a new part in that same volume',
    )

    const historyNovel = novelService.createNovel({ title: '章节撤销测试', targetWords: 5000, operatingMode: 'shortform' })
    const historyFirst = chapterService.createChapter(historyNovel, { chapterNum: 1, title: '撤销第一章' })
    const historySecond = chapterService.createChapter(historyNovel, { chapterNum: 2, title: '撤销第二章' })
    const historyArc = getSqlite().prepare(`
      INSERT INTO story_arcs (novel_id, arc_name, arc_order, chapter_start, chapter_end)
      VALUES (?, '撤销主线', 1, 1, 2)
    `).run(historyNovel)
    const historyThread = getSqlite().prepare(`
      INSERT INTO story_threads (novel_id, title, start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter)
      VALUES (?, '撤销线程', 1, 2, 1, 2)
    `).run(historyNovel)
    chapterService.reorderChapters([historySecond, historyFirst], 1)
    const reorderLog = historyService.getLatestUndoableOperation(historyNovel)
    assert.equal(reorderLog.operationType, 'batch_reindex')
    historyService.undoOperation(reorderLog.id)
    assert.deepEqual(
      getSqlite().prepare('SELECT id, chapter_num FROM chapters WHERE novel_id = ? ORDER BY chapter_num').all(historyNovel),
      [{ id: historyFirst, chapter_num: 1 }, { id: historySecond, chapter_num: 2 }],
    )
    assert.deepEqual(
      getSqlite().prepare('SELECT chapter_start, chapter_end FROM story_arcs WHERE id = ?').get(Number(historyArc.lastInsertRowid)),
      { chapter_start: 1, chapter_end: 2 },
    )
    assert.deepEqual(
      getSqlite().prepare('SELECT start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter FROM story_threads WHERE id = ?').get(Number(historyThread.lastInsertRowid)),
      { start_chapter: 1, target_payoff_chapter: 2, planted_chapter: 1, last_referenced_chapter: 2 },
    )
    const historyThird = chapterService.createChapter(historyNovel, { chapterNum: 3, title: '撤销第三章' })
    getSqlite().prepare('UPDATE story_arcs SET chapter_end = 3 WHERE id = ?').run(Number(historyArc.lastInsertRowid))
    getSqlite().prepare(`
      UPDATE story_threads
      SET target_payoff_chapter = 3, last_referenced_chapter = 3
      WHERE id = ?
    `).run(Number(historyThread.lastInsertRowid))
    chapterService.batchDeleteChapters([historySecond])
    const deleteLog = historyService.getLatestUndoableOperation(historyNovel)
    assert.equal(deleteLog.operationType, 'batch_delete')
    const legacyUndoPayload = JSON.parse(deleteLog.undoPayloadJson)
    delete legacyUndoPayload.chapters[0].targetWords
    getSqlite().prepare('UPDATE operation_logs SET undo_payload_json = ? WHERE id = ?')
      .run(JSON.stringify(legacyUndoPayload), deleteLog.id)
    historyService.undoOperation(deleteLog.id)
    assert.deepEqual(
      getSqlite().prepare('SELECT id, chapter_num FROM chapters WHERE novel_id = ? ORDER BY chapter_num').all(historyNovel),
      [{ id: historyFirst, chapter_num: 1 }, { id: historySecond, chapter_num: 2 }, { id: historyThird, chapter_num: 3 }],
    )
    assert.equal(
      getSqlite().prepare('SELECT target_words FROM chapters WHERE id = ?').get(historySecond).target_words,
      2400,
      'legacy undo snapshots without targetWords must use the novel operating-mode reference length',
    )
    assert.deepEqual(
      getSqlite().prepare('SELECT chapter_start, chapter_end FROM story_arcs WHERE id = ?').get(Number(historyArc.lastInsertRowid)),
      { chapter_start: 1, chapter_end: 3 },
    )
    assert.deepEqual(
      getSqlite().prepare('SELECT start_chapter, target_payoff_chapter, planted_chapter, last_referenced_chapter FROM story_threads WHERE id = ?').get(Number(historyThread.lastInsertRowid)),
      { start_chapter: 1, target_payoff_chapter: 3, planted_chapter: 1, last_referenced_chapter: 3 },
    )

    const contentBeforeGenerationLock = getSqlite().prepare('SELECT content FROM chapters WHERE id = ?').get(firstChapter).content
    const activeGenerationTask = getSqlite().prepare(`
      INSERT INTO tasks
        (novel_id, type, status, related_entity_type, related_entity_id, runner_type, created_at, updated_at)
      VALUES (?, 'chapter_write', 'running', 'chapter', ?, 'workflow', ?, ?)
    `).run(novelA, firstChapter, new Date().toISOString(), new Date().toISOString())
    await expectCodeAsync(
      () => Promise.resolve().then(() => chapterService.updateChapter(firstChapter, { content: '不应覆盖的人工编辑' })),
      'chapter.generationActiveContentLocked',
    )
    assert.equal(
      getSqlite().prepare('SELECT content FROM chapters WHERE id = ?').get(firstChapter).content,
      contentBeforeGenerationLock,
    )
    getSqlite().prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").run(Number(activeGenerationTask.lastInsertRowid))

    const resumeNovel = novelService.createNovel({ title: '断点续写 CAS 测试', targetWords: 10000, operatingMode: 'shortform' })
    const resumeChapter = chapterService.createChapter(resumeNovel, { chapterNum: 1, title: '恢复章节' })
    chapterService.updateChapter(resumeChapter, { content: '已保留正文' })
    const resumeContextVersion = getSqlite().prepare('SELECT context_version FROM novels WHERE id = ?').get(resumeNovel).context_version || 1
    const resumeTask = getSqlite().prepare(`
      INSERT INTO tasks
        (novel_id, type, status, related_entity_type, related_entity_id, runner_type, created_at, updated_at)
      VALUES (?, 'chapter_write', 'running', 'chapter', ?, 'workflow', ?, ?)
    `).run(resumeNovel, resumeChapter, new Date().toISOString(), new Date().toISOString())
    chapterService.__testing.updatePipelineChapterContent(
      resumeChapter,
      '已保留正文',
      resumeContextVersion,
      { content: '已保留正文\n\n安全续写', status: 'reviewing' },
    )
    assert.equal(
      getSqlite().prepare('SELECT content FROM chapters WHERE id = ?').get(resumeChapter).content,
      '已保留正文\n\n安全续写',
      'resume pipeline write must pass its own active-generation lock through the CAS-only path',
    )
    getSqlite().prepare('UPDATE chapters SET content = ? WHERE id = ?').run('并发人工编辑', resumeChapter)
    expectCode(
      () => chapterService.__testing.updatePipelineChapterContent(
        resumeChapter,
        '已保留正文\n\n安全续写',
        resumeContextVersion,
        { content: '不应覆盖人工编辑', status: 'reviewing' },
      ),
      'chapter.pipelineContentConflict',
    )
    getSqlite().prepare('UPDATE chapters SET content = ? WHERE id = ?').run('已保留正文\n\n安全续写', resumeChapter)
    getSqlite().prepare('UPDATE novels SET context_version = context_version + 1 WHERE id = ?').run(resumeNovel)
    expectCode(
      () => chapterService.__testing.updatePipelineChapterContent(
        resumeChapter,
        '已保留正文\n\n安全续写',
        resumeContextVersion,
        { content: '不应跨上下文写入', status: 'reviewing' },
      ),
      'chapter.pipelineContextConflict',
    )
    getSqlite().prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").run(Number(resumeTask.lastInsertRowid))

    const staleResumeNovel = novelService.createNovel({ title: '陈旧断点拒绝测试', targetWords: 10000, operatingMode: 'shortform' })
    const staleResumeChapter = chapterService.createChapter(staleResumeNovel, { chapterNum: 1, title: '不能覆盖人工稿' })
    chapterService.updateChapter(staleResumeChapter, { content: '生成开始时正文' })
    const staleBaseContextVersion = getSqlite().prepare('SELECT context_version FROM novels WHERE id = ?').get(staleResumeNovel).context_version || 1
    const staleResumeTask = getSqlite().prepare(`
      INSERT INTO tasks
        (novel_id, type, status, related_entity_type, related_entity_id, runner_type, progress_json, created_at, updated_at)
      VALUES (?, 'chapter_write', 'failed', 'chapter', ?, 'workflow', ?, ?, ?)
    `).run(
      staleResumeNovel,
      staleResumeChapter,
      JSON.stringify({
        kind: 'chapter_pipeline',
        chapterId: staleResumeChapter,
        workflowTaskId: 0,
        status: 'failed',
        currentRole: 'writer',
        currentStage: 'drafting',
        totalTokensUsed: 0,
        totalDurationMs: 0,
        roles: {},
        lastFailureRole: 'writer',
        partialContent: '旧任务保留的模型断点',
        baseContentHash: chapterService.__testing.buildChapterContentHash('生成开始时正文'),
        baseContextVersion: staleBaseContextVersion,
      }),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    getSqlite().prepare('UPDATE chapters SET content = ? WHERE id = ?').run('作者后来保存的新正文', staleResumeChapter)
    await expectCodeAsync(
      () => chapterService.resumeChapterPipeline(Number(staleResumeTask.lastInsertRowid)),
      'chapter.pipelineContentConflict',
    )
    assert.equal(
      getSqlite().prepare('SELECT content FROM chapters WHERE id = ?').get(staleResumeChapter).content,
      '作者后来保存的新正文',
      'resuming an old partial must not overwrite a newer author edit',
    )

    const staleContextContent = '上下文变化前正文'
    getSqlite().prepare('UPDATE chapters SET content = ? WHERE id = ?').run(staleContextContent, staleResumeChapter)
    const contextResumeTask = getSqlite().prepare(`
      INSERT INTO tasks
        (novel_id, type, status, related_entity_type, related_entity_id, runner_type, progress_json, created_at, updated_at)
      VALUES (?, 'chapter_write', 'failed', 'chapter', ?, 'workflow', ?, ?, ?)
    `).run(
      staleResumeNovel,
      staleResumeChapter,
      JSON.stringify({
        kind: 'chapter_pipeline',
        chapterId: staleResumeChapter,
        workflowTaskId: 0,
        status: 'failed',
        currentRole: 'writer',
        currentStage: 'drafting',
        totalTokensUsed: 0,
        totalDurationMs: 0,
        roles: {},
        lastFailureRole: 'writer',
        partialContent: '上下文变化前的模型断点',
        baseContentHash: chapterService.__testing.buildChapterContentHash(staleContextContent),
        baseContextVersion: staleBaseContextVersion,
      }),
      new Date().toISOString(),
      new Date().toISOString(),
    )
    getSqlite().prepare('UPDATE novels SET context_version = context_version + 1 WHERE id = ?').run(staleResumeNovel)
    await expectCodeAsync(
      () => chapterService.resumeChapterPipeline(Number(contextResumeTask.lastInsertRowid)),
      'chapter.pipelineContextConflict',
    )

    const rollingContextNovel = novelService.createNovel({ title: '流水线上下文 checkpoint 测试', targetWords: 10000, operatingMode: 'shortform' })
    const rollingContextChapter = chapterService.createChapter(rollingContextNovel, { chapterNum: 1, title: 'Finalize 恢复章节' })
    chapterService.updateChapter(rollingContextChapter, { content: 'Finalize 已持久化正文' })
    const internalContextVersion = contextImpactService.markNovelContextChanged(
      rollingContextNovel,
      'Draft entities discovered from new content',
    )
    assert.equal(
      contextImpactService.markChapterContextCurrent(rollingContextChapter),
      internalContextVersion,
      'markChapterContextCurrent must report the committed rolling context version',
    )
    const rollingSnapshot = {
      kind: 'chapter_pipeline',
      chapterId: rollingContextChapter,
      workflowTaskId: 0,
      status: 'failed',
      currentRole: 'finalize',
      currentStage: 'canonizing',
      totalTokensUsed: 0,
      totalDurationMs: 0,
      roles: {},
      lastFailureRole: 'finalize',
      partialContent: 'Finalize 已持久化正文',
      baseContentHash: chapterService.__testing.buildChapterContentHash('Finalize 已持久化正文'),
      baseContextVersion: internalContextVersion,
    }
    assert.doesNotThrow(
      () => chapterService.__testing.assertChapterResumeBaseCurrent(rollingContextChapter, rollingSnapshot),
      'a workflow-owned context bump must remain resumable after the chapter is marked current',
    )
    contextImpactService.markNovelContextChanged(rollingContextNovel, 'World rules changed')
    expectCode(
      () => chapterService.__testing.assertChapterResumeBaseCurrent(rollingContextChapter, rollingSnapshot),
      'chapter.pipelineContextConflict',
    )

    const now = new Date().toISOString()
    const contextVersion = getSqlite().prepare('SELECT context_version FROM chapters WHERE id = ?').get(firstChapter).context_version || 1
    const run = getSqlite().prepare(`
      INSERT INTO chapter_writeback_runs
        (novel_id, chapter_id, status, trigger_source, source_chapter_version, created_at, updated_at)
      VALUES (?, ?, 'applied', 'integrity-test', ?, ?, ?)
    `).run(novelA, firstChapter, contextVersion, now, now)
    const runId = Number(run.lastInsertRowid)
    const diff = getSqlite().prepare(`
      INSERT INTO chapter_writeback_diffs
        (run_id, asset_type, entity_type, after_state_json, canon_decision, writeback_status, sort_order, created_at, updated_at)
      VALUES (?, 'thread', 'story-thread', '{}', 'accepted', 'applied', 1, ?, ?)
    `).run(runId, now, now)
    await expectCodeAsync(
      () => writebackService.updateChapterWritebackDecision(Number(diff.lastInsertRowid), { canonDecision: 'rejected' }),
      'chapterWriteback.appliedImmutable',
    )

    const applyingRun = getSqlite().prepare(`
      INSERT INTO chapter_writeback_runs
        (novel_id, chapter_id, status, trigger_source, source_chapter_version, created_at, updated_at)
      VALUES (?, ?, 'applying', 'integrity-lock-test', ?, ?, ?)
    `).run(novelA, firstChapter, contextVersion, now, now)
    const applyingRunId = Number(applyingRun.lastInsertRowid)
    const lockedDiff = getSqlite().prepare(`
      INSERT INTO chapter_writeback_diffs
        (run_id, asset_type, entity_type, after_state_json, canon_decision, writeback_status, sort_order, created_at, updated_at)
      VALUES (?, 'thread', 'story-thread', '{}', 'accepted', 'pending', 1, ?, ?)
    `).run(applyingRunId, now, now)
    const lockedDiffId = Number(lockedDiff.lastInsertRowid)
    await expectCodeAsync(
      () => writebackService.updateChapterWritebackDecision(lockedDiffId, { canonDecision: 'rejected' }),
      'chapterWriteback.decisionLocked',
    )
    assert.equal(
      getSqlite().prepare('SELECT canon_decision FROM chapter_writeback_diffs WHERE id = ?').get(lockedDiffId).canon_decision,
      'accepted',
    )

    console.log('PASS chapter integrity: final gate, generation edit lock, arc/thread transactions, invalidation, ownership, cross-novel isolation, reorder remap and locked writeback decisions')
  } finally {
    closeDb()
    cleanupElectronFixture(tempRoot, 'chapter-integrity')
    await app.quit()
  }
}

run().catch((error) => {
  console.error('[chapter-integrity] failed:', error.stack || error.message || error)
  process.exit(1)
})
