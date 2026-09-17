const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const { pilotDrafts, pilotScene, pilotStory } = require('./reader-first-fixtures.cjs')

const root = path.resolve(__dirname, '..')
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`
const output = path.resolve(root, 'docs/implementation/reader-first-v1/evidence/RF-11', runId)
const isolatedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf11-'))
process.env.NOVELFORGE_USER_DATA_DIR = isolatedPath
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', isolatedPath)
registerProjectTsRuntime(root)

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const now = () => new Date().toISOString()

function workingTreeIdentity() {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\0').filter(Boolean).sort()
  const files = paths.map((relative) => ({
    path: relative,
    hash: fs.existsSync(path.join(root, relative)) ? sha256(fs.readFileSync(path.join(root, relative))) : 'deleted',
  }))
  return { digest: sha256(JSON.stringify(files)), files }
}

function currentChapterIndex(prompt) {
  const explicit = prompt.match(/章节[：:]\s*第\s*(\d+)\s*章/u)
    || prompt.match(/(?:规划本章场景|写本章正文|审读本章正文|修订本章正文)[：:]?[^\n]*第\s*(\d+)\s*章/u)
  if (explicit) return Math.max(0, Math.min(pilotStory.chapters.length - 1, Number(explicit[1]) - 1))
  for (const drafts of Object.values(pilotDrafts)) {
    const matchedIndex = drafts.findIndex((draft) => prompt.includes(draft.slice(0, 48)))
    if (matchedIndex >= 0) return matchedIndex
  }
  for (let index = pilotStory.chapters.length - 1; index >= 0; index -= 1) {
    if (prompt.includes(pilotStory.chapters[index].title)) return index
  }
  return 0
}

function classifyPrompt(prompt) {
  if (prompt.includes('你是小说 Canonizer') || prompt.includes('JSON 结构：{"extracts":[],"diffs":[]}')) return 'canonizer'
  if (prompt.includes('"next_chapter_seed"')) return 'summary'
  if (prompt.includes('"plot_progress"') && prompt.includes('"character_state_changes"')) return 'continuity'
  if (prompt.includes('"chapterFacts"') && prompt.includes('"threadForeshadow"')) return 'summary-health'
  if (prompt.includes('"characters"') && prompt.includes('"items"') && prompt.includes('新角色')) return 'entity-discovery'
  if (prompt.includes('"resolved_risks"') && prompt.includes('重写前初稿')) return 'rewrite-recheck'
  if (prompt.includes('"critical_fixes"') && prompt.includes('"rewrite_required"')) return 'critic'
  if (prompt.includes('scene_order') && prompt.includes('present_characters') && /JSON 数组/u.test(prompt)) return 'planner'
  if (/^修订本章正文/u.test(prompt)) return 'rewriter'
  if (/^写本章正文/u.test(prompt)) return 'writer'
  if (prompt.includes('你现在写的是可直接入稿的中文小说正文') && /待修订正文|本次修订要求|最终成稿补充要求/u.test(prompt)) return 'rewriter'
  if (prompt.includes('你现在写的是可直接入稿的中文小说正文')) return 'writer'
  if (prompt.includes('只输出正文') || prompt.includes('直接输出小说正文')) return 'writer'
  return 'unknown'
}

function responseFor(kind, variant, chapterIndex) {
  if (kind === 'planner') return JSON.stringify(pilotScene(chapterIndex))
  if (kind === 'writer') return pilotDrafts[variant][chapterIndex]
  if (kind === 'rewriter') {
    const alternate = variant === 'legacy' ? pilotDrafts.readerFirst[chapterIndex] : pilotDrafts.legacy[chapterIndex]
    const resultState = pilotStory.chapters[chapterIndex].outline.split('\n').at(-1).replace(/^收束：/, '')
    return `${alternate}\n\n林桥没有追求立刻定案。若把口述当成证据，后续核对会失去可信度；她因此放慢一步，承担遗漏线索的风险，仍决定先保存原始记录。${resultState}`
  }
  if (kind === 'critic') {
    return JSON.stringify({
      summary: '正文按可核对信息推进，人物行动和认识边界清楚。',
      strengths: ['记录、口述和猜测保持分层。'],
      critical_fixes: [], continuity_risks: [], arc_progress_risks: [], context_drift_risks: [],
      realism_risks: [], coherence_risks: [], reader_hook_risks: [], step_memory_risks: [],
      opening_hook_risks: [], title_alignment_risks: [], hallucination_risks: [], language_risks: [],
      human_language_repairs: [], genre_hollowing_risks: [], design_flatness_risks: [], missing_payoffs: [],
      severity: 'low', rewrite_required: false, revision_brief: '',
      protagonist_setback: 'none', setback_summary: '', cost_present: false, cost_summary: '',
      cost_resolution_state: 'not_applicable', reversal_marker: false, reversal_summary: '',
      reversal_support_state: 'not_applicable', pace_marker: 'progression', reward_state: 'partial',
      protagonist_pressure: 35, chapter_function_primary: 'progression', chapter_function_tags: ['progression'],
      dialogue_filler_risks: [], dialogue_info_density_risks: [], dialogue_voice_lock_summary: '',
      required_voice_lock_character_ids: [], verdicts: [],
    })
  }
  if (kind === 'summary') {
    return JSON.stringify({
      summary: `第${chapterIndex + 1}章通过纸面记录推进调查，保留未证实部分。`,
      next_chapter_seed: chapterIndex < 2 ? pilotStory.chapters[chapterIndex + 1].outline.split('\n')[0] : '继续核对改写页码的来源。',
    })
  }
  if (kind === 'continuity') {
    return JSON.stringify({
      plot_progress: [`第${chapterIndex + 1}章的记录核对已完成。`],
      character_state_changes: [], world_state_changes: [],
      open_loops: chapterIndex < 2 ? [pilotStory.chapters[chapterIndex + 1].title] : ['谁改过页码'],
      continuity_notes: ['记录、口述与猜测继续分层。'],
      arc_progress: '调查取得一项可复核进展。',
    })
  }
  if (kind === 'summary-health') return JSON.stringify({ chapterFacts: '记录已核对。', characterStates: '', threadForeshadow: '仍有一项待查。' })
  if (kind === 'entity-discovery') return JSON.stringify({ characters: [], items: [] })
  if (kind === 'canonizer') return JSON.stringify({ extracts: [], diffs: [] })
  if (kind === 'rewrite-recheck') {
    return JSON.stringify({
      step_memory_risks: [], opening_hook_risks: [], hallucination_risks: [],
      title_alignment_risks: [], resolved_risks: ['重写稿已按当前正文复核。'],
    })
  }
  return JSON.stringify({})
}

function sendOpenAiResponse(res, body, content) {
  const usage = { prompt_tokens: Math.max(1, Math.ceil(JSON.stringify(body.messages || []).length / 4)), completion_tokens: Math.max(1, Math.ceil(content.length / 4)) }
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`data: ${JSON.stringify({ id: 'rf11-loopback', choices: [{ delta: { content }, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ id: 'rf11-loopback', choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\n`)
    res.end('data: [DONE]\n\n')
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    id: 'rf11-loopback',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage,
  }))
}

function createBlindReviewPack(samples, seed) {
  const assignments = {}
  const publicPairs = pilotStory.chapters.map((chapter, chapterIndex) => {
    const legacyIsA = Number.parseInt(sha256(`${seed}:${chapterIndex}`).slice(0, 2), 16) % 2 === 0
    assignments[String(chapterIndex + 1)] = legacyIsA ? { A: 'legacy', B: 'reader-first-v1' } : { A: 'reader-first-v1', B: 'legacy' }
    const pick = (label, stage) => {
      const variant = assignments[String(chapterIndex + 1)][label] === 'legacy' ? 'legacy' : 'readerFirst'
      return samples[variant][chapterIndex][stage]
    }
    return {
      chapter: chapterIndex + 1,
      title: chapter.title,
      A: { firstDraft: pick('A', 'firstDraft'), finalDraft: pick('A', 'finalDraft') },
      B: { firstDraft: pick('B', 'firstDraft'), finalDraft: pick('B', 'finalDraft') },
    }
  })
  return {
    publicPack: {
      task: 'RF-11',
      evidenceKind: 'isolated-loopback-development-only',
      eligibleForReaderAcceptance: false,
      instructions: '此包只验证匿名导出结构；必须用固定真实模型重新生成后，才可分发给读者。',
      questions: [
        'A、B 各自是否愿意继续读？可回答都愿意或都不愿意。',
        '最早想停的位置在哪里？请抄录前后各一句。',
        '林桥和周岑此刻分别想做什么？',
        '读完后记得哪些具体动作或物件？',
        '哪些位置显得机械、解释过多或发生断裂？',
      ],
      pairs: publicPairs,
    },
    privateKey: { seed, assignments },
  }
}

app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const captures = []
  const runtime = { variant: 'legacy', rootTaskId: null, cancelChapterTwoCritic: false, cancelObserved: false }
  let taskService
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/embeddings') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        const body = JSON.parse(raw || '{}')
        const inputs = Array.isArray(body.input) ? body.input : [body.input]
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3, 0.4] })), usage: { prompt_tokens: 4, total_tokens: 4 } }))
      })
      return
    }
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      const prompt = (body.messages || []).map((message) => String(message.content || '')).join('\n')
      const chapterIndex = currentChapterIndex(prompt)
      const kind = classifyPrompt(prompt)
      const capture = { at: now(), variant: runtime.variant, chapter: chapterIndex + 1, kind, body }
      captures.push(capture)
      if (runtime.cancelChapterTwoCritic && chapterIndex === 1 && kind === 'critic' && runtime.rootTaskId) {
        runtime.cancelChapterTwoCritic = false
        runtime.cancelObserved = taskService.cancelTask(runtime.rootTaskId)
        capture.cancelledRootTaskId = runtime.rootTaskId
        res.destroy()
        return
      }
      const content = responseFor(kind, runtime.variant, chapterIndex)
      capture.response = content
      sendOpenAiResponse(res, body, content)
    })
  })

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const nativeFetch = globalThis.fetch
    globalThis.fetch = (url, ...args) => {
      const parsed = new URL(String(url))
      assert.equal(parsed.origin, baseUrl, `RF-11 isolation refused outbound request to ${parsed.origin}`)
      return nativeFetch(url, ...args)
    }

    initDb()
    const sqlite = getSqlite()
    const chapterService = require('../electron/services/chapter.service.ts')
    taskService = require('../electron/services/task.service.ts')
    const { encryptApiKey } = require('../electron/services/model.service.ts')
    const { ensureStoryStructure } = require('../electron/services/story-structure.service.ts')
    const { getNovelContextStatus, runChapterPublishCheck } = require('../electron/services/context-impact.service.ts')
    const { resolveChapterNarrativeIdentity } = require('../electron/services/chapter-narrative-policy.ts')
    const modelId = Number(sqlite.prepare(`
      INSERT INTO model_configs (name, provider, model_id, api_key, base_url, temperature, max_tokens, max_context_tokens, max_concurrency, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('RF-11 fixed loopback', 'openai', 'rf11-loopback-v1', encryptApiKey('isolated-fixture-key'), `${baseUrl}/v1`, 0.2, 1500, 32000, 1, 1).lastInsertRowid)
    const genreId = Number(sqlite.prepare('INSERT INTO genres (name, description, is_builtin) VALUES (?, ?, 0)')
      .run(pilotStory.genre, 'RF-11 隔离试点题材').lastInsertRowid)
    const settings = (policyVersion) => JSON.stringify({
      readerFirst: { schemaVersion: 1, policyVersion, revision: 1 },
      qualityGates: { semanticGate: 'off', fallbackMode: 'heuristic', goldenChapterNums: [2, 3], maxSemanticCallsPerChapter: 0 },
      aiExecution: { mode: 'balanced' },
    })
    const createNovel = (policyVersion, suffix) => Number(sqlite.prepare(`
      INSERT INTO novels (title, synopsis, genre_id, launch_mode, target_words, model_config_id, settings_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`${pilotStory.title}-${suffix}`, pilotStory.synopsis, genreId, 'shortform', 6000, modelId, settings(policyVersion)).lastInsertRowid)
    const createChapters = (novelId) => {
      const chapterIds = pilotStory.chapters.map((chapter, chapterIndex) => Number(sqlite.prepare(`
        INSERT INTO chapters (novel_id, chapter_num, title, outline, target_words, emotion_tone, status, content)
        VALUES (?, ?, ?, ?, ?, ?, 'outline', '')
      `).run(novelId, chapterIndex + 1, chapter.title, chapter.outline, 300, '克制、具体').lastInsertRowid))
      ensureStoryStructure(novelId)
      chapterIds.forEach((chapterId, chapterIndex) => {
        const fixture = pilotStory.chapters[chapterIndex]
        const goal = fixture.outline.split('\n')[0].replace(/^目标：/, '')
        const resultState = fixture.outline.split('\n').at(-1).replace(/^收束：/, '')
        sqlite.prepare(`
          INSERT INTO chapter_contracts
            (novel_id, chapter_id, chapter_goal, opening_style, ending_style, exposition_mode, emotion_focus,
             served_thread_ids_json, required_arc_progress_json, required_character_arc_ids_json,
             required_relationship_arc_ids_json, required_resistance_track_ids_json, required_resistance_actions_json,
             required_asset_refs_json, required_endgame_commitment_ids_json, required_foreshadow_ids_json,
             hook_type, forbidden_actions_json, acceptance_notes_json, status)
          VALUES (?, ?, ?, '从动作进入', '', '', '',
                  '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '', '[]', '[]', 'ready')
        `).run(novelId, chapterId, goal)
        const segment = sqlite.prepare('SELECT id FROM chapter_segments WHERE chapter_id = ? ORDER BY segment_order LIMIT 1').get(chapterId)
        assert.ok(segment?.id, `default segment missing for chapter ${chapterId}`)
        sqlite.prepare(`
          UPDATE chapter_segments SET purpose = ?, time_anchor = ?, location_name = ?, input_state = ?, output_state = ? WHERE id = ?
        `).run(goal, `第${chapterIndex + 1}天傍晚`, '旧港档案楼', '记录尚未核对', resultState, segment.id)
        sqlite.prepare(`
          INSERT INTO scene_contracts
            (novel_id, chapter_id, segment_id, pov, time_location, scene_goal, obstacle, conflict_type,
             emotion_shift, reveal_payload_json, result_state, linkage_mode,
             required_endgame_commitment_ids_json, required_foreshadow_ids_json, hidden_agendas_json, irony_gap, status)
          VALUES (?, ?, ?, '林桥', ?, ?, '记录有缺口且口述未经证实', '信息核对', '从戒备到有限协作',
                  '[]', ?, 'continue', '[]', '[]', ?, ?, 'ready')
        `).run(novelId, chapterId, segment.id, `第${chapterIndex + 1}天傍晚，旧港档案楼`, goal, resultState,
          JSON.stringify(['周岑担心漏签牵连值班员']), '读者只看见周岑迟疑，不提前获得答案')
      })
      return chapterIds
    }

    const readerNovelId = createNovel('reader-first-v1', '新版策略')
    const readerChapterIds = createChapters(readerNovelId)
    const sinkEvents = []
    const sink = { send(channel, payload) { sinkEvents.push({ at: now(), channel, payload }) } }
    const runChapter = async (variant, chapterId, cancelAtCritic = false) => {
      runtime.variant = variant
      runtime.rootTaskId = null
      runtime.cancelChapterTwoCritic = cancelAtCritic
      try {
        const taskId = await chapterService.generateChapterContent(chapterId, sink, {
          executionMode: 'balanced',
          totalBudget: 16000,
          onWorkflowTaskCreated(id) { runtime.rootTaskId = id },
        })
        return { taskId, interruptedTaskId: null }
      } catch (error) {
        if (!cancelAtCritic) {
          const failedRoot = runtime.rootTaskId ? taskService.getTaskRecord(runtime.rootTaskId) : null
          const publishCheck = runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: 'off' })
          console.error('[rf11] failed publish check:', JSON.stringify({
            summary: publishCheck.summary,
            blocking: publishCheck.checklist.filter((item) => item.status === 'blocker' || item.status === 'rewrite'),
          }))
          console.error('[rf11] failed workflow:', failedRoot ? JSON.stringify({ id: failedRoot.id, status: failedRoot.status, errorMessage: failedRoot.errorMessage }) : 'missing')
          throw error
        }
        assert.equal(runtime.cancelObserved, true, 'formal task cancellation must be observed')
        assert.ok(runtime.rootTaskId, 'cancelled workflow root id must be captured')
        const interruptedTaskId = runtime.rootTaskId
        const interrupted = taskService.getTaskRecord(interruptedTaskId)
        assert.equal(interrupted.status, 'cancelled', 'formal cancellation must not be recorded as a failure')
        try {
          const taskId = await chapterService.resumeChapterPipeline(interruptedTaskId, sink)
          return { taskId, interruptedTaskId }
        } catch (resumeError) {
          const publishCheck = runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: 'off' })
          console.error('[rf11] failed resume publish check:', JSON.stringify({
            summary: publishCheck.summary,
            blocking: publishCheck.checklist.filter((item) => item.status === 'blocker' || item.status === 'rewrite'),
          }))
          throw resumeError
        }
      }
    }

    const runResults = { readerFirst: [] }
    runResults.readerFirst.push(await runChapter('readerFirst', readerChapterIds[0]))
    runResults.readerFirst.push(await runChapter('readerFirst', readerChapterIds[1], true))

    const captureGeneratedState = (chapterId) => ({
      chapter: sqlite.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId),
      canonRuns: sqlite.prepare('SELECT * FROM chapter_writeback_runs WHERE chapter_id = ? ORDER BY id').all(chapterId),
    })
    const generatedStateByChapterId = new Map(readerChapterIds.slice(0, 2).map((chapterId) => [chapterId, captureGeneratedState(chapterId)]))
    const readerChapterOneBeforeEdit = generatedStateByChapterId.get(readerChapterIds[0]).chapter.content
    const readerChapterTwoBeforeEdit = generatedStateByChapterId.get(readerChapterIds[1]).chapter.content
    const chapterThreeIdentityBeforeEdit = resolveChapterNarrativeIdentity(readerChapterIds[2])
    const contextVersionBeforeEdit = sqlite.prepare('SELECT context_version FROM novels WHERE id = ?').get(readerNovelId).context_version
    const editedMarker = '【作者修订：盐渍来源仍未确认。】'
    chapterService.updateChapter(readerChapterIds[0], {
      content: `${readerChapterOneBeforeEdit}\n\n${editedMarker}`,
    }, { expectedContent: readerChapterOneBeforeEdit })
    const staleBeforeContinuation = getNovelContextStatus(readerNovelId)
    const chapterThreeIdentityAfterEdit = resolveChapterNarrativeIdentity(readerChapterIds[2])
    const contextVersionAfterEdit = sqlite.prepare('SELECT context_version FROM novels WHERE id = ?').get(readerNovelId).context_version
    assert.ok(staleBeforeContinuation.staleChapterIds.includes(readerChapterIds[1]), 'chapter two must be marked stale after chapter one edit')
    assert.ok(contextVersionAfterEdit > contextVersionBeforeEdit, 'chapter-one edit must advance the novel context version')
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(readerChapterIds[1]).content, readerChapterTwoBeforeEdit)
    runResults.readerFirst.push(await runChapter('readerFirst', readerChapterIds[2]))
    generatedStateByChapterId.set(readerChapterIds[2], captureGeneratedState(readerChapterIds[2]))

    await new Promise((resolve) => setTimeout(resolve, 250))

    const editedChapterOne = sqlite.prepare('SELECT * FROM chapters WHERE id = ?').get(readerChapterIds[0])
    assert.equal(editedChapterOne.summary, '', 'author edit must invalidate the prior summary')
    assert.equal(editedChapterOne.continuity_state_json, '', 'author edit must invalidate prior continuity state')
    assert.match(editedChapterOne.stale_reason_json, /正文已更新/u, 'author edit must record the derivative invalidation reason')

    const taskRowsForChapter = (chapterId) => sqlite.prepare(`
      SELECT * FROM tasks WHERE related_entity_type = 'chapter' AND related_entity_id = ? ORDER BY id
    `).all(chapterId)
    const workflowEvidence = (chapterId, finalTaskId) => {
      const roots = taskRowsForChapter(chapterId).filter((row) => row.type === 'chapter_write' && row.runner_type === 'workflow')
      const nodes = roots.flatMap((rootTask) => sqlite.prepare(`
        SELECT r.*, s.id snapshot_id, s.input_hash snapshot_input_hash, s.output_hash snapshot_output_hash, s.payload_json
        FROM workflow_node_runs r LEFT JOIN workflow_node_snapshots s ON s.node_run_id = r.id
        WHERE r.workflow_task_id = ? ORDER BY r.id
      `).all(rootTask.id))
      const finalTask = roots.find((row) => row.id === finalTaskId)
      assert.equal(finalTask?.status, 'success', `chapter ${chapterId} workflow must finish successfully`)
      for (const node of nodes.filter((row) => row.status === 'produced')) {
        assert.ok(node.snapshot_id, `produced node ${node.id} must have an immutable snapshot`)
      }
      const snapshot = finalTask?.progress_json ? JSON.parse(finalTask.progress_json) : null
      return { roots, nodes, finalSnapshot: snapshot }
    }
    const makeSamples = (variant, chapterIds, results) => chapterIds.map((chapterId, chapterIndex) => {
      const currentChapter = sqlite.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId)
      const generatedState = generatedStateByChapterId.get(chapterId)
      const chapter = generatedState?.chapter || currentChapter
      const writerCapture = captures.find((entry) => entry.variant === variant && entry.chapter === chapterIndex + 1 && entry.kind === 'writer')
      const firstDraft = writerCapture?.response || ''
      const finalDraft = chapter.content || ''
      assert.ok(firstDraft, `writer response missing for ${variant} chapter ${chapterIndex + 1}`)
      assert.ok(finalDraft, `final body missing for ${variant} chapter ${chapterIndex + 1}`)
      const canonRuns = generatedState?.canonRuns || sqlite.prepare('SELECT * FROM chapter_writeback_runs WHERE chapter_id = ? ORDER BY id').all(chapterId)
      assert.ok(canonRuns.some((run) => ['ready', 'applied'].includes(run.status)), `canon run missing for chapter ${chapterId}`)
      assert.ok(chapter.summary, `summary missing for chapter ${chapterId}`)
      assert.ok(chapter.continuity_state_json, `continuity missing for chapter ${chapterId}`)
      const evidence = workflowEvidence(chapterId, results[chapterIndex].taskId)
      const completedRoles = new Set(evidence.nodes.filter((node) => node.status === 'produced').map((node) => node.node_key))
      for (const role of ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize']) {
        assert.ok(completedRoles.has(role), `${variant} chapter ${chapterIndex + 1} missing successful ${role}`)
      }
      if (chapterIndex > 0) {
        const previous = sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(chapterIds[chapterIndex - 1]).content
        const previousMarker = previous.slice(0, 24)
        assert.ok(String(writerCapture.body.messages?.map((item) => item.content).join('\n')).includes(previousMarker), `${variant} chapter ${chapterIndex + 1} writer input must include previous body evidence`)
      }
      return {
        chapterId,
        chapterNum: chapterIndex + 1,
        title: chapter.title,
        firstDraft,
        finalDraft,
        firstDraftHash: sha256(firstDraft),
        finalDraftHash: sha256(finalDraft),
        summary: chapter.summary,
        nextChapterSeed: chapter.next_chapter_seed,
        continuityState: JSON.parse(chapter.continuity_state_json),
        currentState: {
          contentHash: sha256(currentChapter.content || ''),
          summary: currentChapter.summary,
          continuityStateJson: currentChapter.continuity_state_json,
          staleReasonJson: currentChapter.stale_reason_json,
          writebackStatusJson: currentChapter.writeback_status_json,
        },
        reviewNotes: JSON.parse(chapter.review_notes_json),
        canonRuns,
        workflow: evidence,
        modelRequests: captures.filter((entry) => entry.variant === variant && entry.chapter === chapterIndex + 1),
      }
    })

    const samples = {
      legacy: pilotStory.chapters.map((chapter, chapterIndex) => ({
        chapterNum: chapterIndex + 1,
        title: chapter.title,
        firstDraft: pilotDrafts.legacy[chapterIndex],
        finalDraft: pilotDrafts.legacy[chapterIndex],
        source: 'static-development-fixture; formal legacy generation not executed',
      })),
      readerFirst: makeSamples('readerFirst', readerChapterIds, runResults.readerFirst),
    }
    assert.equal(captures.filter((entry) => entry.kind === 'unknown').length, 0, 'every loopback model request must be classified')
    assert.equal(samples.readerFirst[2].workflow.finalSnapshot?.narrativeIdentity?.inputSourceDigest,
      chapterThreeIdentityAfterEdit.inputSourceDigest, 'chapter three task must bind the post-edit input identity')
    assert.equal(samples.readerFirst[2].workflow.nodes.find((node) => node.node_key === 'planner' && node.status === 'produced')?.context_version,
      contextVersionAfterEdit, 'chapter three Planner must start from the post-edit context version')
    assert.ok(samples.readerFirst[2].workflow.finalSnapshot?.baseContextVersion >= contextVersionAfterEdit,
      'chapter three task must checkpoint the post-edit context version')
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(readerChapterIds[1]).content, readerChapterTwoBeforeEdit, 'later author draft must not be overwritten')
    assert.ok(runResults.readerFirst[1].interruptedTaskId, 'chapter two interruption task must be recorded')

    const seed = sha256(`${readerNovelId}:${pilotStory.title}`).slice(0, 16)
    const blind = createBlindReviewPack(samples, seed)
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'blind-review-pack.loopback.json'), json(blind.publicPack))
    fs.writeFileSync(path.join(output, 'blind-review-key.loopback.json'), json(blind.privateKey))
    for (const [variant, chapters] of Object.entries(samples)) {
      const variantDir = path.join(output, 'samples', variant)
      fs.mkdirSync(variantDir, { recursive: true })
      chapters.forEach((chapter) => {
        const prefix = `chapter-${String(chapter.chapterNum).padStart(2, '0')}`
        fs.writeFileSync(path.join(variantDir, `${prefix}-first.txt`), `${chapter.firstDraft}\n`)
        fs.writeFileSync(path.join(variantDir, `${prefix}-final.txt`), `${chapter.finalDraft}\n`)
      })
    }
    const realModelManifest = {
      task: 'RF-11', status: 'UNVERIFIED', provider: null, model: null,
      parameters: null, costLimitUsd: null, tokenLimit: null, attempts: 0, actualCostUsd: 'unknown',
      reason: 'NOVELFORGE_SOAK_PROVIDER, NOVELFORGE_SOAK_MODEL and NOVELFORGE_SOAK_API_KEY were not configured for this run.',
      requiredScope: { genre: pilotStory.genre, variants: ['legacy', 'reader-first-v1'], chaptersPerVariant: 3, fixedRevisionBudget: true },
    }
    const readerManifest = {
      task: 'RF-11', status: 'UNVERIFIED', readers: 0, requiredReaders: 3,
      rawResponses: [], reason: 'No reader responses were supplied; the test does not simulate human opinions.',
    }
    fs.writeFileSync(path.join(output, 'real-model-manifest.json'), json(realModelManifest))
    fs.writeFileSync(path.join(output, 'reader-manifest.json'), json(readerManifest))
    const report = {
      task: 'RF-11',
      runId,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTree: workingTreeIdentity(),
      kind: 'isolated-integration',
      status: 'PASS',
      command: 'electron scripts/reader-first-pilot.test.cjs',
      policyVersion: 'reader-first-v1',
      contextCompilerMode: samples.readerFirst[0].workflow.finalSnapshot?.contextCompilerMode || 'captured-in-task-snapshots',
      model: { provider: 'openai-compatible-loopback', model: 'rf11-loopback-v1', temperature: 0.2, maxTokens: 1500, totalBudget: 16000, realProviderCalls: 0, loopbackCalls: captures.length },
      cases: {
        'RF-11-01': 'PASS (formal service entry, isolated SQLite and loopback model)',
        'RF-11-02': 'PASS (critic cancellation/resume plus prior-chapter edit propagation)',
        'RF-11-03': 'UNVERIFIED (real provider unavailable; loopback reader-first plus static legacy export structure passed)',
        'RF-11-04': 'UNVERIFIED (0/3 human readers)',
      },
      isolation: { userData: isolatedPath, loopbackOrigin: baseUrl, outboundOriginsAllowed: [baseUrl] },
      runResults,
      staleBeforeContinuation,
      chapterThreeIdentityBeforeEdit,
      chapterThreeIdentityAfterEdit,
      contextVersionBeforeEdit,
      contextVersionAfterEdit,
      editedMarker,
      laterBodyPreserved: true,
      samples,
      sinkEvents,
      limitations: [
        'Loopback outputs validate orchestration and persistence only; they do not establish prose quality.',
        'No real provider usage, finish reason, elapsed time or monetary cost was observed.',
        'No browser interaction or human reader response was performed.',
      ],
    }
    fs.writeFileSync(path.join(output, 'integration-capture.json'), json(report))
    fs.writeFileSync(path.join(output, 'checks.json'), json({
      task: 'RF-11', kind: 'isolated-integration', caseIds: ['RF-11-01', 'RF-11-02', 'RF-11-03', 'RF-11-04'],
      status: 'PASS_WITH_UNVERIFIED_EXTERNAL_GATES', cases: report.cases, limitations: report.limitations,
    }))
    console.log(JSON.stringify({ status: report.status, cases: report.cases, loopbackCalls: captures.length, interruptedTaskId: runResults.readerFirst[1].interruptedTaskId, output }))
    closeDb()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(isolatedPath, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    console.error(error)
    try { closeDb() } catch { /* no-op */ }
    try { await new Promise((resolve) => server.close(resolve)) } catch { /* no-op */ }
    if (path.resolve(isolatedPath).startsWith(path.resolve(os.tmpdir()))) fs.rmSync(isolatedPath, { recursive: true, force: true })
    app.exit(1)
  }
})
