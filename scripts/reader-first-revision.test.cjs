const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const isolatedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf08-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
process.env.NOVELFORGE_USER_DATA_DIR = isolatedPath
app.setPath('userData', isolatedPath)
registerProjectTsRuntime(path.resolve(__dirname, '..'))

app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const evidenceDir = path.resolve(__dirname, '../docs/implementation/reader-first-v1/evidence/RF-08/2026-09-15-final')
  const capture = { isolatedPath, runtime: process.versions, cases: {}, providerCalls: 0 }
  let server
  try {
    initDb()
    let sqlite = getSqlite()
    const { createQualityIssue } = require('../src/shared/quality-issue.ts')
    const { buildFallbackReviewNotes } = require('../electron/services/chapter-review-notes.ts')
    const { buildReviewPrioritySummary } = require('../electron/services/chapter-pipeline-policy.service.ts')
    const { processChapterRewriteOutcome, runRewriterQualityPipeline } = require('../electron/services/chapter-pipeline-rewriter.ts')
    const { createRevisionBudget, RevisionBudgetController, restoreRevisionBudget } = require('../electron/services/revision-budget.ts')
    const { ChapterPipelineRuntime } = require('../electron/services/chapter-pipeline-runtime.ts')
    const { getTaskRecord, updateTaskStatus } = require('../electron/services/task.service.ts')
    const { __testing, updateChapter, sanitizeChapterUpdateOptions, optimizeChapterContent } = require('../electron/services/chapter-generation.usecase.ts')
    const { getNovel } = require('../electron/services/novel.service.ts')
    const { buildChapterOptimizationQualityGate, buildChapterStructuralRepairGate } = require('../src/shared/chapter-optimization-quality.ts')
    const original = '她把钥匙放在桌上。窗外的雨已经停了，院子里留着几处积水。厨房飘出米饭的香气，炉子上的汤还在沸腾。老人从抽屉里取出信，摊在灯下，信封上的地址已经模糊。远处有人骑车经过，车铃响过两声。等院门重新安静下来，两人才继续商量明早的行程。东面的桥还没修好，只能沿河岸走到渡口，再搭第一班船。行李放在楼梯下面，干粮装进布袋，留给邻居的字条压在杯底。夜深以后，楼上传来收拾床铺的声音，随后灯也熄了。'
    const novelId = Number(sqlite.prepare('INSERT INTO novels (title, context_version) VALUES (?, ?)').run('RF08 isolated', 1).lastInsertRowid)
    sqlite.prepare('UPDATE novels SET settings_json = ? WHERE id = ?').run(JSON.stringify({ operatingMode: { mode: 'standard_longform', locked: true } }), novelId)
    const chapterId = Number(sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, status) VALUES (?, ?, ?, ?, ?)').run(novelId, 1, '夜雨', original, 'draft').lastInsertRowid)
    function patchInput(content, expectedText, replacement) {
      const issue = createQualityIssue({ ruleId: 'motivation_irrational', detector: 'model', content, excerpt: expectedText, message: '修正本轮指代或重复', scope: 'span' })
      const evidence = issue.evidence[0]
      const notes = { ...buildFallbackReviewNotes(''), severity: 'high', issues: [issue] }
      return { originalDraft: content, lockedFallbackContent: content, chapterTitle: '夜雨', chapterWordTarget: 200,
        semanticGateMode: 'enforce', glossaryTerms: [], revisionMode: 'patch', reviewNotes: notes,
        rewriteOutput: JSON.stringify({ baseArtifactHash: evidence.artifactHash, patches: [{
          start: evidence.start, end: evidence.end, expectedText, replacement, issueIds: [issue.id],
        }] }),
        repairInput: { chapter: { id: chapterId, novelId, chapterNum: 1, title: '夜雨' }, novel: getNovel(novelId),
          context: {}, storyCore: '', profile: { genre: '生活', protagonistReference: '主角', protagonistRule: '限知' },
          scenePlanText: '', consistencyNotes: '', structuralAlertsSummary: '', lockedParagraphs: [],
          promptTier: 'standard', knownTerms: [], targetWords: 200,
          factGuard: (base, candidate) => __testing.buildChapterOptimizationFactGuard(novelId, base, candidate, { structuralRepair: true }),
        },
      }
    }
    const smallInput = patchInput(original, '她', '他')
    const small = await processChapterRewriteOutcome(smallInput)
    if (small.revisionRejected) console.error(JSON.stringify({ rejected: small.reviewNotes.critical_fixes, miniReview: small.miniReview }))
    assert.equal(small.content, original.replace('她', '他'))
    assert.equal(small.miniReview.needsHumanReview, false)
    assert.ok(small.miniReview.similarityToOriginal > 0.95)
    const currentContent = () => getSqlite().prepare('SELECT content FROM chapters WHERE id = ?').get(chapterId).content
    assert.equal(currentContent(), original)
    __testing.updatePipelineChapterContent(chapterId, original, 1, { content: small.content, status: 'draft' }, 'ai-rewrite')
    assert.equal(currentContent(), small.content)
    const afterVersionCount = sqlite.prepare('SELECT COUNT(*) AS n FROM chapter_versions WHERE chapter_id = ?').get(chapterId).n
    assert.ok(afterVersionCount > 0)
    capture.cases['RF-08-01'] = { status: 'PASS', similarity: small.miniReview.similarityToOriginal, miniReview: small.miniReview, persistedVersions: afterVersionCount }

    // Public editor options carry a source-content precondition through the real
    // update usecase. An intervening edit must fail without versions or writes.
    const editorOptions = sanitizeChapterUpdateOptions({ versionSource: 'ai-rewrite', expectedContent: original, skipStaleTracking: true })
    assert.equal(editorOptions.skipStaleTracking, undefined)
    assert.throws(() => updateChapter(chapterId, { content: '旧候选覆盖' }, editorOptions), /正文|变化|更新|冲突/)
    assert.equal(currentContent(), small.content)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM chapter_versions WHERE chapter_id = ?').get(chapterId).n, afterVersionCount)
    assert.throws(() => __testing.updatePipelineChapterContent(chapterId, original, 1, { content: '旧流水线覆盖', status: 'draft' }))
    assert.throws(() => sanitizeChapterUpdateOptions({ expectedContent: 7 }))
    updateChapter(chapterId, { content: original }, sanitizeChapterUpdateOptions({ versionSource: 'ai-rewrite', expectedContent: small.content }))
    assert.equal(currentContent(), original)
    capture.applicationCas = { status: 'PASS', stalePipelineRejected: true, staleEditorRejected: true, currentEditorAccepted: true }

    const redundant = '她确实不愿离开，旁白再次解释她的不舍。'.repeat(8)
    const largeOriginal = `钥匙藏在盒底。${redundant}她仍舍不得走。`
    const largeInput = patchInput(largeOriginal, redundant, '')
    const large = await processChapterRewriteOutcome(largeInput)
    if (large.revisionRejected) console.error(JSON.stringify({ largeRejected: large.reviewNotes.critical_fixes }))
    assert.equal(large.content, '钥匙藏在盒底。她仍舍不得走。')
    assert.equal(large.requiresAuthorReview, true)
    const runtime = await ChapterPipelineRuntime.create({ novelId, chapterId, idempotencyKey: 'rf08-review',
      executionMode: 'balanced', initialContent: original, initialContextVersion: 1,
      buildRecoveryHint: () => ({ kind: 'open_page', label: '比较候选', description: '保留原稿', path: '/writing' }),
      getOutputRefs: () => ({ chapterId, contentHash: 'rf08', scenePlanHash: '', reviewNotesHash: '' }), onProgress() {} })
    const controller = new RevisionBudgetController(createRevisionBudget('rf08-budget'), {
      onChange: (revisionBudget) => { runtime.adoptSnapshot({ ...runtime.snapshot, revisionBudget }); runtime.sync() },
    })
    let persistCalls = 0
    let roleId
    await assert.rejects(runRewriterQualityPipeline({ candidateLoop: {
      draftContent: largeOriginal, initialReviewNotes: largeInput.reviewNotes,
      reviewPrioritySummary: buildReviewPrioritySummary(largeInput.reviewNotes, largeOriginal),
      runAttempt: async () => {
        roleId = await runtime.startRole({ role: 'rewriter', type: 'chapter_rewriter', detail: 'RF08 author candidate', runnerType: 'workflow', inputJson: largeInput.rewriteOutput })
        return { taskId: roleId, result: { output: largeInput.rewriteOutput } }
      }, processOutcome: async () => large,
    }, revisionBudget: { reserveRevisionAttempt: (key) => Boolean(controller.tryReserve(key)) },
    persistCandidate: async () => { persistCalls += 1 }, rewriteScope: 'paragraph_patch',
    failRole: (taskId, error) => {
      runtime.failRole({ role: 'rewriter', taskId, detail: error.message, blocked: true, failureCode: 'human_review_required', outputText: error.outputText })
      throw error
    } }), /候选未通过/)
    assert.equal(persistCalls, 0)
    assert.equal(currentContent(), original)
    const savedCandidate = JSON.parse(getTaskRecord(roleId).outputText)
    assert.equal(savedCandidate.originalContent, largeOriginal)
    assert.equal(savedCandidate.candidateContent, large.content)
    capture.cases['RF-08-02'] = { status: 'PASS', originalLength: largeOriginal.length, candidateLength: large.content.length, taskId: roleId, persistedCandidate: savedCandidate, canonicalUnchanged: true }

    updateTaskStatus(runtime.workflowTaskId, 'cancelled')
    closeDb()
    initDb()
    sqlite = getSqlite()
    const saved = JSON.parse(getTaskRecord(runtime.workflowTaskId).progressJson)
    const restored = new RevisionBudgetController(restoreRevisionBudget('rf08-budget', saved).budget)
    assert.equal(restored.snapshot.used, 1)
    assert.equal(restored.tryReserve('reading:rewriter:style:1'), null)
    assert.ok(restored.tryReserve('fact:rewriter:candidate:2'))
    assert.equal(restored.tryReserve('rewriter:publish-gate:1'), null)
    assert.equal(JSON.parse(getTaskRecord(roleId).outputText).candidateContent, large.content)
    const badInput = patchInput('费用是100元。她关上门。', '费用是100元。', '费用是200元。')
    const bad = await processChapterRewriteOutcome(badInput)
    assert.equal(bad.revisionRejected, true)
    assert.equal(bad.content, badInput.originalDraft)
    assert.equal(bad.miniReview.needsHumanReview, true)
    capture.cases['RF-08-04'] = { status: 'PASS', savedBudget: saved.revisionBudget, restoredBudget: restored.snapshot, rejectedFactCandidate: bad.miniReview }

    const emoji = patchInput('😀她收好钥匙。必要线索保留。', '她', '他')
    const { applyRevisionPatch } = require('../src/shared/revision-patch.ts')
    const patch = JSON.parse(emoji.rewriteOutput)
    assert.equal(patch.patches[0].start, 2)
    assert.equal(applyRevisionPatch(emoji.originalDraft, patch), '😀他收好钥匙。必要线索保留。')
    assert.throws(() => applyRevisionPatch(`${emoji.originalDraft}新编辑`, patch), /NF_PATCH_BASE_MISMATCH/)
    assert.throws(() => applyRevisionPatch(emoji.originalDraft, patch, [{ start: 2, end: 3 }]), /NF_PATCH_LOCKED/)
    assert.throws(() => applyRevisionPatch(emoji.originalDraft, { ...patch, patches: [patch.patches[0], patch.patches[0]] }), /NF_PATCH_OVERLAP/)
    capture.cases['RF-08-03'] = { status: 'PASS', utf16Start: 2, staleRejected: true, locksRejected: true, overlapRejected: true }
    assert.equal(buildChapterStructuralRepairGate(original, small.content, 2, { goldenChapterNums: [] }).required, false)
    assert.ok(buildChapterOptimizationQualityGate(largeOriginal, large.content).warnings.some((warning) => warning.includes('逐段比较')))

    // Actual optimize usecase -> task -> adapter -> loopback HTTP, with network
    // constrained to this server. This is not a real-provider quality trial.
    const requests = []
    let responseText = small.content
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        requests.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'rf08-loopback', choices: [{ message: { role: 'assistant', content: responseText }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const nativeFetch = globalThis.fetch
    globalThis.fetch = (url, ...args) => {
      assert.equal(new URL(String(url)).origin, baseUrl, 'Only isolated loopback calls are allowed')
      return nativeFetch(url, ...args)
    }
    const modelId = Number(sqlite.prepare('INSERT INTO model_configs (name, provider, model_id, base_url, max_context_tokens, max_tokens, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)').run('RF08 loopback', 'openai', 'rf08-fixture', `${baseUrl}/v1`, 32000, 2000, 1).lastInsertRowid)
    sqlite.prepare('UPDATE novels SET model_config_id = ? WHERE id = ?').run(modelId, novelId)
    const optimizeId = Number(sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, status) VALUES (?, ?, ?, ?, ?)').run(novelId, 2, '钥匙', original, 'draft').lastInsertRowid)
    const optimized = await optimizeChapterContent(optimizeId, { repairMode: 'language' })
    assert.equal(optimized.optimizationPasses, 1)
    assert.equal(optimized.structuralGate.required, false)
    assert.equal(optimized.factGuard.safeToApply, true)
    assert.equal(requests.length, 1)
    assert.equal(optimized.optimizedContent, small.content)
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(optimizeId).content, original)
    assert.equal(getTaskRecord(optimized.taskId).outputText, small.content)
    sqlite.prepare('UPDATE chapters SET content = ? WHERE id = ?').run('费用是100元。她关上门。', optimizeId)
    responseText = '费用是200元。她关上门。'
    const unsafe = await optimizeChapterContent(optimizeId, { repairMode: 'language' })
    assert.equal(unsafe.optimizationPasses, 2)
    assert.equal(unsafe.factGuard.safeToApply, false)
    assert.equal(requests.length, 3)
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(optimizeId).content, '费用是100元。她关上门。')
    capture.optimizationAdapter = { status: 'PASS', loopbackCalls: requests.length, safe: optimized, unsafe, requests }
    await new Promise((resolve) => server.close(resolve))
    server = undefined
    globalThis.fetch = nativeFetch
    capture.status = 'PASS'
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(path.join(evidenceDir, 'integration-capture.json'), JSON.stringify(capture, null, 2))
    console.log(JSON.stringify({ status: capture.status, cases: Object.keys(capture.cases), applicationCas: capture.applicationCas, isolatedPath }))
    closeDb()
    app.exit(0)
  } catch (error) {
    console.error(error)
    if (server) server.close()
    closeDb()
    app.exit(1)
  }
})
