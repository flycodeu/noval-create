// Optional real-provider check. Only the configured model is copied read-only; all writing uses a disposable library.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const sourcePath = process.env.NOVELFORGE_REAL_MODEL_SOURCE
if (!sourcePath) throw new Error('Set NOVELFORGE_REAL_MODEL_SOURCE to a configured library database.')
fs.mkdirSync(path.join(root, '.tmp-tests'), { recursive: true })
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'assist-real-'))
const statePath = path.join(path.dirname(sourcePath), 'Local State')
if (fs.existsSync(statePath)) {
  const { os_crypt } = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (os_crypt) fs.writeFileSync(path.join(temp, 'Local State'), JSON.stringify({ os_crypt }))
}
app.setPath('userData', temp); app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
async function main() {
  await app.whenReady()
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  initDb()
  const sql = getSqlite()
  const model = require('../electron/services/model.service.ts')
  const Database = require('better-sqlite3')
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  let config
  try { config = source.prepare('SELECT * FROM model_configs WHERE is_default=1 ORDER BY id LIMIT 1').get() } finally { source.close() }
  assert.ok(config && model.decryptApiKey(config.api_key), 'Configured model key is not available in the isolated runtime.')
  const columns = new Set(sql.prepare('PRAGMA table_info(model_configs)').all().map(row => row.name))
  const fields = Object.keys(config).filter(key => key !== 'id' && columns.has(key) && /^[a-z_]+$/.test(key))
  const modelId = Number(sql.prepare(`INSERT INTO model_configs(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...fields.map(key => config[key])).lastInsertRowid)
  const novels = require('../electron/services/novel.service.ts')
  const tasks = require('../electron/services/author-assist-task.service.ts')
  const extraction = require('../electron/services/reference-extraction.service.ts')
  const artifacts = require('../electron/services/artifact.service.ts')
  const result = { realModelCalled: false, formalDatabaseWritten: false, provider: config.provider, model: config.model_id }
  const novelId = novels.createNovel({ title: '资料提炼验证', userBackground: '陈舟是渡口船工，修船需要担保。以普通人的劳动和信用解决困难。', modelConfigId: modelId })
  const text = '陈舟的渡船坏了舵叶。木匠肯赊给他一块木料，却要留下担保。陈舟把仅剩的长绳押在铺里，约定三日后还钱。回到河边，他才发现少了长绳，渡船只能贴着近岸走。修船的难题暂时解决了，下一趟摆渡却更费力。'
  try {
    const run = await extraction.startReferenceExtraction({ novelId, text, sourceTitle: '自建验证片段', sourceLabel: '单段', request: '只提炼1张卡，分析抵押如何把眼前解法变成后续代价，并说明适合本作的原创转化方向。', idempotencyKey: 'real-extraction-one' })
    result.realModelCalled = true
    let final
    for (let i = 0; i < 180; i++) {
      final = tasks.getAuthorAssistRun(novelId, run.taskId)
      if (!['pending', 'running', 'cancel_requested'].includes(final.status)) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (final.status !== 'success') { tasks.cancelAuthorAssistRun(novelId, run.taskId); throw new Error(final.error || 'Real-provider task timed out.') }
    const artifact = artifacts.requireArtifact(final.artifactId)
    const card = artifact.content.candidates.find(candidate => !candidate.error)
    assert.ok(card, 'Real-provider extraction returned no verifiable evidence.')
    extraction.adoptReferenceCandidates({ novelId, artifactId: artifact.id, expectedContextVersion: novels.getNovel(novelId).contextVersion,
      entries: [{ candidateId: card.id, draft: card.draft }], idempotencyKey: 'real-adoption-one' })
    Object.assign(result, { passed: true, cardCount: artifact.content.candidates.length, verifiedQuote: card.quote, card: card.draft })
  } catch (error) { Object.assign(result, { passed: false, error: error.message }); process.exitCode = 1 }
  finally {
    closeDb()
    const output = path.join(root, 'outputs', 'wenlan-first-batch'); fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'real-model-smoke.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ ...result, card: undefined, verifiedQuote: undefined }))
    if (!path.resolve(temp).startsWith(path.resolve(root, '.tmp-tests') + path.sep)) throw new Error('unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(process.exitCode || 0), error => { console.error(error.message); app.exit(1) })
