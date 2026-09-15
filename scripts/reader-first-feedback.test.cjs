const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const root = path.resolve(__dirname, '..')
const isolatedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf12-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
process.env.NOVELFORGE_USER_DATA_DIR = isolatedPath
app.setPath('userData', isolatedPath)
app.commandLine.appendSwitch('disable-gpu')
registerProjectTsRuntime(root)

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-12', runId)
fs.mkdirSync(output, { recursive: true })

app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const report = {
    task: 'RF-12', runId, kind: 'isolated-sqlite-and-final-message',
    command: 'npm run test:reader-first-feedback',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    policyVersion: 'reader-first-v1', realProviderCalls: 0,
    limitations: ['No browser UI, real provider call, or reader acceptance. RF-14 owns feedback UI.'],
    results: [],
  }
  try {
    initDb()
    const sqlite = getSqlite()
    const { saveNovelReaderFeedback, revokeNovelReaderFeedback, updateNovel } = require('../electron/services/novel.service.ts')
    const { parseReaderFeedbackSettings } = require('../src/shared/reader-feedback.ts')
    const { collectChapterContextRawData, allocateChapterContext } = require('../electron/services/context.service.ts')
    const { resolveChapterNarrativeIdentity, assertChapterNarrativeInputCurrent } = require('../electron/services/chapter-narrative-policy.ts')
    const { buildChapterWriterMessages } = require('../electron/services/chapter-pipeline-writer.ts')

    const initialSettings = JSON.stringify({
      readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 1 },
      modelChoice: 'alpha',
      unrelated: { keep: true },
    })
    const novelId = Number(sqlite.prepare('INSERT INTO novels (title, settings_json) VALUES (?, ?)')
      .run('RF-12 隔离样例', initialSettings).lastInsertRowid)
    const shenId = Number(sqlite.prepare('INSERT INTO characters (novel_id, full_name, role_type) VALUES (?, ?, ?)')
      .run(novelId, '沈宁', 'protagonist').lastInsertRowid)
    const zhaoId = Number(sqlite.prepare('INSERT INTO characters (novel_id, full_name, role_type) VALUES (?, ?, ?)')
      .run(novelId, '赵安', 'supporting').lastInsertRowid)
    const insertChapter = sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, outline, status, scene_plan_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const sourceText = '沈宁扶住门框，直接说：“我知道是你。”'
    const sourceId = Number(insertChapter.run(novelId, 1, '旧门', sourceText, '', 'final', null).lastInsertRowid)
    const deletedText = '雨落在空院里。'
    const deletedSourceId = Number(insertChapter.run(novelId, 2, '空院', deletedText, '', 'final', null).lastInsertRowid)
    const currentText = '沈宁看见灯影，心里立刻明白了原因。她随后解释了三遍。'
    const scenePlan = JSON.stringify([{ scene_order: 1, scene_title: '灯影', purpose: '沈宁确认来人', present_characters: ['沈宁'] }])
    const currentId = Number(insertChapter.run(novelId, 3, '灯影', currentText, '沈宁确认来人。', 'outline', scenePlan).lastInsertRowid)

    const shen = saveNovelReaderFeedback(novelId, {
      expectedRevision: 0, chapterId: sourceId, start: 0, end: sourceText.length,
      note: '沈宁说得太直接，给她留一点回避。', topic: '对白直率度', sentiment: 'reduce',
      scope: { type: 'character', characterId: shenId, characterName: '沈宁' },
    })
    const retry = saveNovelReaderFeedback(novelId, {
      expectedRevision: 0, chapterId: sourceId, start: 0, end: sourceText.length,
      note: '沈宁说得太直接，给她留一点回避。', topic: '对白直率度', sentiment: 'reduce',
      scope: { type: 'character', characterId: shenId, characterName: '沈宁' },
    })
    assert.equal(retry.changed, false)
    assert.equal(retry.item.id, shen.item.id)
    const zhao = saveNovelReaderFeedback(novelId, {
      expectedRevision: 1, chapterId: sourceId, start: 0, end: sourceText.length,
      note: '赵安仍然可以直接说。', topic: '对白直率度', sentiment: 'keep',
      scope: { type: 'character', characterId: zhaoId, characterName: '赵安' },
    })
    const keepThought = saveNovelReaderFeedback(novelId, {
      expectedRevision: 2, chapterId: currentId, start: 0, end: currentText.length,
      note: '保留这处直接心理活动。', topic: '直接心理', sentiment: 'keep',
      scope: { type: 'scene', sceneOrder: 1 },
    })
    const lessExplanation = saveNovelReaderFeedback(novelId, {
      expectedRevision: 3, chapterId: currentId, start: 0, end: currentText.length,
      note: '减少动作已经表达清楚后的解释。', topic: '解释密度', sentiment: 'reduce',
      scope: { type: 'scene', sceneOrder: 1 },
    })
    saveNovelReaderFeedback(novelId, {
      expectedRevision: 4, chapterId: deletedSourceId, start: 0, end: deletedText.length,
      note: '保留雨声带来的停顿。', topic: '环境节奏', sentiment: 'keep', scope: { type: 'book' },
    })

    updateNovel(novelId, { settingsJson: JSON.stringify({ modelChoice: 'beta', styleChoice: 'restrained' }) })
    const afterSettingsUpdate = JSON.parse(sqlite.prepare('SELECT settings_json FROM novels WHERE id = ?').get(novelId).settings_json)
    const storedFeedback = parseReaderFeedbackSettings(JSON.stringify(afterSettingsUpdate))
    assert.equal(afterSettingsUpdate.modelChoice, 'beta')
    assert.equal(afterSettingsUpdate.styleChoice, 'restrained')
    assert.deepEqual(afterSettingsUpdate.unrelated, { keep: true })
    assert.equal(storedFeedback.items.length, 5)
    assert.equal(storedFeedback.revision, 5)
    assert.equal(zhao.feedback.revision, 2)
    assert.equal(keepThought.feedback.revision, 3)
    assert.equal(lessExplanation.feedback.revision, 4)
    report.results.push({ caseId: 'RF-12-04', status: 'PASS', feedbackCount: 5, feedbackRevision: 5,
      duplicateChanged: retry.changed, preservedSettings: ['modelChoice', 'styleChoice', 'unrelated', 'readerFirst.authorFeedback'] })

    sqlite.prepare('DELETE FROM chapters WHERE id = ?').run(deletedSourceId)
    const raw = await collectChapterContextRawData(novelId, 3)
    raw.narrativeIdentity = resolveChapterNarrativeIdentity(currentId)
    const context = allocateChapterContext(raw, { totalBudget: 18000, promptProfile: 'draft' })
    const messages = buildChapterWriterMessages({
      novelTitle: 'RF-12 隔离样例', genre: '现实', chapterNum: 3, chapterTitle: '灯影', emotionTone: '', targetWords: 1000,
      storyCore: '', context, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '沈宁确认来人。',
      runtimeAssertions: [], narrativeFields: {}, guidance: {}, protagonistReference: '沈宁', protagonistRule: '', promptTier: 'standard',
    })
    const firstPrompt = messages.map((message) => message.content).join('\n')
    const resolution = context.authorStyleMaterials.readerFeedback
    assert.ok(firstPrompt.includes('沈宁说得太直接'))
    assert.ok(!firstPrompt.includes('赵安仍然可以直接说'))
    assert.ok(firstPrompt.includes('保留这处直接心理活动'))
    assert.ok(firstPrompt.includes('减少动作已经表达清楚后的解释'))
    assert.ok(!firstPrompt.includes('禁止心理'))
    assert.equal(resolution.states.find((entry) => entry.id === zhao.item.id).state, 'out_of_scope')
    assert.ok(resolution.states.some((entry) => entry.state === 'source_deleted'))
    report.results.push({ caseId: 'RF-12-01', status: 'PASS', selectedIds: resolution.selected.map((entry) => entry.id),
      excludedCharacterFeedbackId: zhao.item.id })
    report.results.push({ caseId: 'RF-12-02', status: 'PASS', promptHash: sha256(firstPrompt),
      keepsDirectThought: true, reducesExplanation: true, globalBanIntroduced: false })

    const startedIdentity = context.narrativeIdentity
    sqlite.prepare('UPDATE chapters SET content = ? WHERE id = ?').run(`${sourceText}（来源已编辑）`, sourceId)
    revokeNovelReaderFeedback(novelId, { id: keepThought.item.id, expectedRevision: 5 })
    assert.throws(() => assertChapterNarrativeInputCurrent(currentId, startedIdentity), /不能混用旧稿恢复/)
    assert.ok(firstPrompt.includes('保留这处直接心理活动'), 'started task keeps its original compiled message snapshot')

    const nextRaw = await collectChapterContextRawData(novelId, 3)
    nextRaw.narrativeIdentity = resolveChapterNarrativeIdentity(currentId)
    const nextContext = allocateChapterContext(nextRaw, { totalBudget: 18000, promptProfile: 'draft' })
    const nextMessages = buildChapterWriterMessages({
      novelTitle: 'RF-12 隔离样例', genre: '现实', chapterNum: 3, chapterTitle: '灯影', emotionTone: '', targetWords: 1000,
      storyCore: '', context: nextContext, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '沈宁确认来人。',
      runtimeAssertions: [], narrativeFields: {}, guidance: {}, protagonistReference: '沈宁', protagonistRule: '', promptTier: 'standard',
    })
    const nextPrompt = nextMessages.map((message) => message.content).join('\n')
    const nextResolution = nextContext.authorStyleMaterials.readerFeedback
    assert.ok(!nextPrompt.includes('沈宁说得太直接'))
    assert.ok(!nextPrompt.includes('保留这处直接心理活动'))
    assert.ok(nextPrompt.includes('减少动作已经表达清楚后的解释'))
    assert.equal(nextResolution.states.find((entry) => entry.id === shen.item.id).state, 'source_changed')
    assert.equal(nextResolution.states.find((entry) => entry.id === keepThought.item.id).state, 'revoked')
    assert.ok(nextResolution.states.some((entry) => entry.state === 'source_deleted'))
    report.results.push({ caseId: 'RF-12-03', status: 'PASS', startedPromptHash: sha256(firstPrompt), nextPromptHash: sha256(nextPrompt),
      sourceChangedState: 'source_changed', revokedState: 'revoked', deletedState: 'source_deleted', staleResumeRejected: true,
      startedSnapshotUnchanged: true })

    report.status = 'PASS'
    const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
      .split('\0').filter(Boolean).sort()
    report.files = paths.map((relative) => ({ path: relative,
      hash: fs.existsSync(path.join(root, relative)) ? sha256(fs.readFileSync(path.join(root, relative))) : 'deleted' }))
    report.workingTreeDigest = sha256(JSON.stringify(report.files))
    console.log(JSON.stringify({ status: report.status, output, realProviderCalls: 0, cases: report.results.map((entry) => entry.caseId) }))
  } catch (error) {
    report.status = 'FAIL'
    report.error = error.stack || String(error)
    console.error(error)
  } finally {
    fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(report, null, 2))
    closeDb()
    fs.rmSync(isolatedPath, { recursive: true, force: true })
    app.exit(report.status === 'PASS' ? 0 : 1)
  }
}).catch((error) => { console.error(error); app.exit(1) })
