const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { app, nativeImage } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root, '.tmp-tests'), { recursive: true })
const profile = fs.mkdtempSync(path.join(root, '.tmp-tests/novel-cover-'))
app.setPath('userData', profile)
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)

async function main() {
  await app.whenReady()
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const { generateNovelCover, setNovelCover } = require('../electron/services/novel-cover.service.ts')
  const { encryptApiKey } = require('../electron/services/model.service.ts')
  initDb()
  const sqlite = getSqlite()
  const novelId = Number(sqlite.prepare("INSERT INTO novels (title, context_version, settings_json, lifecycle_mode) VALUES ('封面隔离用书',7,?, 'manual')").run('{"custom":{"keep":true}}').lastInsertRowid)
  sqlite.prepare("INSERT INTO chapters (novel_id, chapter_num, title, content, summary, context_version) VALUES (?,1,'既有章名','既有正文','既有摘要',7)").run(novelId)
  const snapshot = () => JSON.stringify(Object.fromEntries(['novels', 'chapters', 'asset_change_events', 'revision_tasks'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table} WHERE ${table === 'novels' ? 'id' : 'novel_id'}=? ORDER BY id`).all(novelId)])))
  const png = nativeImage.createFromBitmap(Buffer.alloc(80 * 120 * 4, 110), { width: 80, height: 120 }).toPNG().toString('base64')
  const imported = `data:image/png;base64,${png}`
  let requests = [], mode = 'ok', redirected = 0
  const server = http.createServer(async (req, res) => {
    if (req.url === '/leak') { redirected++; res.end('{}'); return }
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) })
    res.setHeader('Content-Type', 'application/json')
    if (mode === 'redirect') { res.writeHead(302, { Location: '/leak' }); res.end(); return }
    if (mode === 'error') { res.writeHead(401); res.end('{"error":"SECRET_KEY should never appear"}'); return }
    if (mode === 'url') { res.end('{"data":[{"url":"http://localhost/leak"}]}'); return }
    if (mode === 'malformed') { res.end('null'); return }
    if (mode === 'oversized') { res.end('x'.repeat(20_000_001)); return }
    if (mode === 'invalid') { res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] })); return }
    res.end(JSON.stringify({ data: [{ b64_json: png }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const configId = Number(sqlite.prepare('INSERT INTO model_configs (name, provider, model_id, api_key, base_url) VALUES (?,?,?,?,?)').run('封面测试接口', 'custom', 'text-model-stays', encryptApiKey('SECRET_KEY'), `http://127.0.0.1:${server.address().port}/v1/`).lastInsertRowid)
  const input = { configId, modelId: 'gpt-image-1', prompt: '一盏河边的灯', size: '1024x1536' }
  try {
    const before = snapshot()
    const generated = await generateNovelCover(novelId, input)
    assert.match(generated, /^data:image\/jpeg;base64,/)
    assert.equal(snapshot(), before, 'generation never saves a cover or changes story data')
    assert.deepEqual(requests[0], { url: '/v1/images/generations', auth: 'Bearer SECRET_KEY', body: { model: 'gpt-image-1', prompt: input.prompt, size: input.size, n: 1 } })
    await generateNovelCover(novelId, { ...input, modelId: 'other-image-model' })
    assert.equal(requests[1].body.response_format, 'b64_json')
    assert.equal(sqlite.prepare('SELECT model_id FROM model_configs WHERE id=?').get(configId).model_id, 'text-model-stays')
    const saved = setNovelCover(novelId, { image: generated, expectedCoverImage: null })
    const storedCover = saved.coverImage
    assert.match(storedCover, /^data:image\/jpeg;base64,/)
    assert.deepEqual(nativeImage.createFromDataURL(storedCover).getSize(), { width: 80, height: 120 }, 'saved normalization retains image dimensions')
    assert.equal(saved.contextVersion, 7, 'cover does not stale narrative context')
    assert.equal(JSON.parse(saved.settingsJson).custom.keep, true)
    assert.equal(sqlite.prepare('SELECT content, summary FROM chapters WHERE novel_id=?').get(novelId).content, '既有正文')
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM asset_change_events WHERE novel_id=?').get(novelId).n, 0)
    const after = snapshot()
    assert.throws(() => setNovelCover(novelId, { image: null, expectedCoverImage: null }), /其他操作修改/)
    assert.equal(snapshot(), after)
    for (const bad of ['https://example.com/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk', 'x'.repeat(1_800_001)]) {
      assert.throws(() => setNovelCover(novelId, { image: bad, expectedCoverImage: storedCover }), /有效的 PNG/)
    }
    assert.equal(snapshot(), after)
    closeDb(); initDb()
    assert.equal(getSqlite().prepare('SELECT cover_image FROM novels WHERE id=?').get(novelId).cover_image, storedCover, 'cover survives database reopen')
    setNovelCover(novelId, { image: imported, expectedCoverImage: storedCover })
    const current = getSqlite().prepare('SELECT cover_image FROM novels WHERE id=?').get(novelId).cover_image
    setNovelCover(novelId, { image: null, expectedCoverImage: current })
    assert.equal(getSqlite().prepare('SELECT cover_image FROM novels WHERE id=?').get(novelId).cover_image, null)
    for (const failure of ['error', 'url', 'malformed', 'invalid', 'redirect', 'oversized']) {
      mode = failure
      const count = requests.length
      await assert.rejects(() => generateNovelCover(novelId, input), error => {
        assert(!error.message.includes('SECRET_KEY')); assert(!error.message.includes('/v1'))
        return true
      })
      assert.equal(requests.length, count + 1, 'paid requests are never retried automatically')
    }
    assert.equal(redirected, 0)
    const count = requests.length
    await assert.rejects(() => generateNovelCover(novelId, { ...input, modelId: '' }))
    await assert.rejects(() => generateNovelCover(999999, input))
    assert.equal(requests.length, count, 'invalid requests fail before network access')
    console.log('Novel cover passed: generation, bounded response, credential redaction, redirect refusal, save CAS, clear, reopen and story preservation.')
  } finally { closeDb(); await new Promise(resolve => server.close(resolve)) }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
