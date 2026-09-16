const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf13-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
process.env.NOVELFORGE_USER_DATA_DIR = isolated
app.setPath('userData', isolated)
registerProjectTsRuntime(root)
const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-13/2026-09-16-final')
fs.mkdirSync(output, { recursive: true })
const requests = []
const server = http.createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  if (req.url.endsWith('/embeddings')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const inputs = Array.isArray(body.input) ? body.input : [body.input]
    res.end(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: Array(16).fill(0.1) })), usage: { total_tokens: 1 } }))
    return
  }
  requests.push(body)
  const prompt = JSON.stringify(body.messages || [])
  const content = prompt.includes('overall_score') ? JSON.stringify({ dimensions: [], overall_score: 80, overall_feedback: '固定桩评分', top_fixes: [], ai_like_rate: 0, repetition_risk: '低' }) : '她把信折好，收进抽屉。'
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`)
  res.end('data: [DONE]\n\n')
})
app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  let backend
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    initDb()
    const db = getSqlite()
    const modelId = Number(db.prepare('INSERT INTO model_configs (name, provider, model_id, api_key, base_url, max_tokens, max_context_tokens, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('RF-13 本地模型桩', 'openai', 'rf13-loopback', null, `http://127.0.0.1:${server.address().port}/v1`, 1500, 32000, 1).lastInsertRowid)
    const settings = JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 1 } })
    const novelId = Number(db.prepare('INSERT INTO novels (title, settings_json, model_config_id) VALUES (?, ?, ?)').run('RF-14 隔离交互样例', settings, modelId).lastInsertRowid)
    const otherId = Number(db.prepare('INSERT INTO novels (title) VALUES (?)').run('归属反例').lastInsertRowid)
    const original = '她把信折好，又把信折好，收进抽屉。'
    const { createQualityIssue } = require('../src/shared/quality-issue.ts')
    const issue = createQualityIssue({ ruleId: 'exposition_density', detector: 'heuristic', message: '同一动作重复叙述，可删去一次。', content: original, excerpt: '又把信折好，' })
    const chapterId = Number(db.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, status, review_notes_json, scene_plan_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(novelId, 1, '信', original, 'draft', JSON.stringify({ summary: '固定桩审校', issues: [issue] }), JSON.stringify([{ scene_order: 1, scene_title: '收信' }])).lastInsertRowid)
    db.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, status) VALUES (?, 2, ?, ?, ?)').run(novelId, '空章', '', 'outline')
    const prose = require('../electron/services/prose-operation.service.ts')
    const request = { novelId, chapterId, originalParagraph: original, contextBefore: '', specificRequirements: '删除重复动作', modelConfigId: modelId }
    const compiled = prose.buildProseOperation('rewrite', request)
    assert.equal(compiled.diagnostics.policy.policyVersion, 'reader-first-v1')
    const desktop = await prose.rewriteProse(request)
    assert.equal(typeof desktop, 'string')
    const rewriteTask = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 1').get()
    assert.ok(Array.isArray(JSON.parse(rewriteTask.input_json)), 'retry input must remain a message array')
    assert.equal(JSON.parse(rewriteTask.recovery_hint_json).diagnostics.policy.policyVersion, 'reader-first-v1')
    const scoreInput = { novelId, chapterId, modelConfigId: modelId, content: original, contentType: 'chapter', genreContext: '', novelBackground: '' }
    const desktopScore = await prose.scoreProse(scoreInput)
    assert.equal(desktopScore.overall_score, 80)
    assert.throws(() => prose.buildProseOperation('rewrite', { ...request, novelId: otherId }))
    assert.throws(() => prose.buildProseOperation('rewrite', { ...request, novelId: 999999, chapterId: undefined }))
    assert.equal(await prose.rewriteProse({ originalParagraph: original, contextBefore: '', specificRequirements: '', modelConfigId: modelId }), desktop)
    const { saveNovelReaderFeedback } = require('../electron/services/novel.service.ts')
    assert.throws(() => saveNovelReaderFeedback(novelId, { chapterId, start: 0, end: 2, expectedContentHash: 'stale', expectedRevision: 0, note: '保留', topic: '语言', sentiment: 'keep', scope: { type: 'passage' } }))
    assert.equal(db.prepare('SELECT content FROM chapters WHERE id = ?').get(chapterId).content, original)
    if (process.env.RF13_BROWSER_FIXTURE === '1') {
      const longContent = '夜雨落在屋檐上。她等脚步声走远，才推开窗。\n'.repeat(450) + original
      const tailIssue = createQualityIssue({ ruleId: 'exposition_density', detector: 'heuristic', message: '尾段动作重复。', content: longContent, excerpt: '又把信折好，' })
      db.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, status, review_notes_json) VALUES (?, 4, ?, ?, ?, ?)').run(novelId, '长章尾部证据', longContent, 'draft', JSON.stringify({ issues: Array.from({ length: 20 }, (_, index) => ({ ...tailIssue, id: tailIssue.id + '-' + index, message: '尾段动作重复 ' + (index + 1) })) }))
      const partial = '门外的脚步停了。她握住信封，尚未决定是否开门。'
      const interruptedId = Number(db.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, status) VALUES (?, 3, ?, ?, ?)').run(novelId, '中断半稿', partial, 'draft').lastInsertRowid)
      const taskId = Number(db.prepare('INSERT INTO tasks (type, novel_id, related_entity_type, related_entity_id, status, runner_type, retryable, input_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('chapter_write', novelId, 'chapter', interruptedId, 'cancelled', 'workflow', 1, JSON.stringify({ chapterId: interruptedId })).lastInsertRowid)
      const roles = Object.fromEntries(['planner', 'writer', 'critic', 'enforcer', 'rewriter', 'canonizer', 'finalize'].map(role => [role, { role, label: role, status: role === 'writer' ? 'failed' : 'pending', summary: 'RF-14 展示夹具' }]))
      db.prepare('UPDATE tasks SET progress_json = ? WHERE id = ?').run(JSON.stringify({ kind: 'chapter_pipeline', chapterId: interruptedId, workflowTaskId: taskId, status: 'cancelled', currentRole: 'writer', currentStage: 'drafting', partialContent: partial, totalTokensUsed: 0, totalDurationMs: 0, roles }), taskId)
    }
    closeDb()
    const port = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 8796)
    backend = spawn(process.execPath, [path.join(root, 'scripts/local-web-backend.cjs')], { cwd: root, env: { ...process.env, NOVELFORGE_WEB_BACKEND_PORT: String(port) }, stdio: 'inherit', windowsHide: true })
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break } catch { /* Starting */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const rpc = async (service, method, args) => (await (await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, method, args }) })).json())
    const web = await rpc('ai', 'rewriteParagraph', [request])
    assert.equal(web.ok, true, JSON.stringify(web))
    assert.equal(web.data, desktop)
    assert.deepEqual(requests[0].messages, requests[3].messages)
    const score = await rpc('ai', 'scoreContent', [scoreInput])
    assert.deepEqual(score.data, desktopScore)
    assert.deepEqual(requests[1].messages, requests[4].messages)
    assert.equal((await rpc('ai', 'rewriteParagraph', [{ ...request, novelId: otherId }])).ok, false)
    const saved = await rpc('novel', 'saveReaderFeedback', [novelId, { chapterId, start: 0, end: 2, expectedRevision: 0, note: '保留动作', topic: '语言', sentiment: 'keep', scope: { type: 'passage' } }])
    assert.equal(saved.ok, true, JSON.stringify(saved))
    const revoked = await rpc('novel', 'revokeReaderFeedback', [novelId, { id: saved.data.item.id, expectedRevision: saved.data.feedback.revision }])
    assert.equal(revoked.data.item.status, 'revoked')
    if (process.env.RF13_BROWSER_FIXTURE !== '1') {
      const retried = await rpc('task', 'retry', [rewriteTask.id])
      assert.equal(retried.ok, true, JSON.stringify(retried))
      let retryResult
      for (let attempt = 0; attempt < 100; attempt++) {
        retryResult = await rpc('task', 'get', [retried.data])
        if (retryResult.data?.status === 'success') break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.equal(retryResult.data?.status, 'success', JSON.stringify(retryResult))
      assert.equal(requests[5].messages[0].content, requests[0].messages[0].content)
    }
    fs.writeFileSync(path.join(output, 'entrypoints.json'), JSON.stringify({ result: 'PASS', kind: 'isolated-sqlite-loopback-and-web-rpc', calls: requests.length, compiled: compiled.diagnostics, novelId, chapterId, checks: ['desktop/Web final messages equal', 'score result object equal', 'legacy standalone text', 'wrong/missing ownership rejected', 'no canonical/body write', 'stale feedback source rejected', 'Web feedback save/revoke', ...(process.env.RF13_BROWSER_FIXTURE === '1' ? [] : ['Web task retry preserves compiled messages'])], realModel: false }, null, 2))
    fs.writeFileSync(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2))
    console.log(`PASS RF-13 shared service and Web RPC. Fixture novel=${novelId} chapter=${chapterId} backend=${port}`)
    if (process.env.RF13_BROWSER_FIXTURE === '1') { console.log('RF-14 browser fixture ready'); return }
    backend.kill()
    server.close()
    app.quit()
  } catch (error) { console.error(error); backend?.kill(); closeDb(); server.close(); app.exit(1) }
})
