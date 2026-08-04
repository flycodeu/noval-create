const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

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
  const historyService = project('electron/services/history.service.ts')
  const storyStructureService = project('electron/services/story-structure.service.ts')
  const storyStructureBatchService = project('electron/services/story-structure-batch.service.ts')
  const writebackService = project('electron/services/chapter-writeback.service.ts')
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

    console.log('PASS chapter integrity: final gate, generation edit lock, invalidation, ownership, cross-novel isolation, reorder remap and locked writeback decisions')
  } finally {
    closeDb()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    await app.quit()
  }
}

run().catch((error) => {
  console.error('[chapter-integrity] failed:', error.stack || error.message || error)
  process.exit(1)
})
