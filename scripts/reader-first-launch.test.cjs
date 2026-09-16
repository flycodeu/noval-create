const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf15-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
process.env.NOVELFORGE_USER_DATA_DIR = isolated
app.setPath('userData', isolated)
registerProjectTsRuntime(root)
const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-15/2026-09-16-final')
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
      .run('RF-15 本地模型桩', 'openai', 'rf15-loopback', null, `http://127.0.0.1:${server.address().port}/v1`, 1500, 32000, 1).lastInsertRowid)
    const settings = JSON.stringify({ readerFirst: { schemaVersion: 1, policyVersion: 'reader-first-v1', revision: 1 } })
    const novelId = Number(db.prepare('INSERT INTO novels (title, settings_json, model_config_id) VALUES (?, ?, ?)').run('RF-15 无地图关系试写', settings, modelId).lastInsertRowid)
    const otherId = Number(db.prepare('INSERT INTO novels (title) VALUES (?)').run('旧项目返回路径').lastInsertRowid)
    const style = require('../electron/services/style-analysis.service.ts')
    const trial = await style.runStyleAbTest(novelId, null, '姐妹收拾旧钢琴。姐姐要搬走，妹妹还不知道。', modelId)
    assert.ok(trial.withFingerprint.text)
    assert.ok(trial.without.text)
    assert.equal(style.resolveAuthorStyleMaterial(novelId).approvedSample, undefined)
    const sampleId = style.approveStyleTrial(novelId, trial.withFingerprint.text)
    assert.equal(style.resolveAuthorStyleMaterial(novelId).approvedSample.text, trial.withFingerprint.text)
    style.setActiveStyleFingerprint(novelId, null)
    assert.equal(style.resolveActiveStyleFingerprint(novelId), null)
    assert.equal(style.getStyleFingerprint(sampleId).sourceText, trial.withFingerprint.text)
    assert.equal(db.prepare('SELECT count(*) AS n FROM chapters WHERE novel_id=?').get(novelId).n, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM world_map WHERE novel_id=?').get(novelId).n, 0)
    await assert.rejects(() => style.runStyleAbTest(otherId, sampleId, '禁止跨书引用', modelId))
    await assert.rejects(() => style.runStyleAbTest(novelId, null, '', modelId))
    assert.throws(() => style.approveStyleTrial(novelId, ''))
    closeDb()
    const port = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 8797)
    backend = spawn(process.execPath, [path.join(root, 'scripts/local-web-backend.cjs')], { cwd: root, env: { ...process.env, NOVELFORGE_WEB_BACKEND_PORT: String(port) }, stdio: 'inherit', windowsHide: true })
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break } catch { /* Starting */ }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const rpc = async (service, method, args) => (await (await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, method, args }) })).json())
    const web = await rpc('style', 'abTest', [novelId, null, '姐妹收拾旧钢琴。姐姐要搬走，妹妹还不知道。', modelId])
    assert.equal(web.ok, true, JSON.stringify(web))
    assert.deepEqual(web.data, trial)
    assert.deepEqual(requests[0].messages, requests[2].messages)
    const approved = await rpc('style', 'approveTrial', [novelId, web.data.without.text])
    assert.equal(approved.ok, true, JSON.stringify(approved))
    assert.equal((await rpc('style', 'resolveActive', [novelId])).data.approvedSample.text, trial.without.text)
    assert.equal((await rpc('style', 'setActive', [novelId, null])).ok, true)
    assert.equal((await rpc('style', 'resolveActive', [novelId])).data, null)
    assert.equal((await rpc('chapter', 'list', [novelId])).data.length, 0)
    fs.writeFileSync(path.join(output, 'launch-service.json'), JSON.stringify({ result: 'PASS', kind: 'isolated-sqlite-loopback-and-web-rpc', realModel: false, novelId, otherId, port, isolated, checks: ['empty project trial without fingerprint/maps', 'Desktop/Web equivalent messages and result', 'approval and revoke persist', 'source retained after revoke', 'no body write', 'cross-project and empty inputs rejected'] }, null, 2))
    fs.writeFileSync(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2))
    console.log(`PASS RF-15 service/Web. Fixture novel=${novelId} other=${otherId} backend=${port}`)
    if (process.env.RF15_BROWSER_FIXTURE === '1') { console.log('RF-15 browser fixture ready'); return }
    backend.kill(); server.close(); app.quit()
  } catch (error) { console.error(error); backend?.kill(); closeDb(); server.close(); app.exit(1) }
})
