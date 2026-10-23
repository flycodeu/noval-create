// Optional real-model check. Only model configuration is read from the source library.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const sourcePath = process.env.NOVELFORGE_REAL_MODEL_SOURCE
if (!sourcePath) throw new Error('Set NOVELFORGE_REAL_MODEL_SOURCE to a configured library database.')
const base = path.join(root, '.tmp-tests')
fs.mkdirSync(base, { recursive: true })
const temp = fs.mkdtempSync(path.join(base, 'style-real-'))
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
  assert.ok(config && model.decryptApiKey(config.api_key), 'Configured model key unavailable.')
  const columns = new Set(sql.prepare('PRAGMA table_info(model_configs)').all().map(row => row.name))
  const fields = Object.keys(config).filter(key => key !== 'id' && columns.has(key) && /^[a-z_]+$/.test(key))
  const modelId = Number(sql.prepare(`INSERT INTO model_configs(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...fields.map(key => config[key])).lastInsertRowid)
  const novels = require('../electron/services/novel.service.ts')
  const styles = require('../electron/services/author-style.service.ts')
  const baseStyles = require('../electron/services/style-analysis.service.ts')
  const novelId = novels.createNovel({ title: '文风复用验证', modelConfigId: modelId })
  const text = '陈舟把长绳往柜上一放。掌柜抬眼看他，没有碰那张欠条。\n\n“桐油先给你。”掌柜说，“三天。”\n\n陈舟提起桶，桶底在门槛上磕了一下。他没回头。河边的渡船还在漏水，绳索却留在了铺子里。\n\n夜里风起，他把船拴在一截木桩上。绳不够长，船舷反复撞岸。他听了一阵，脱下外衣，跳进水里把船推远。'
  const result = { formalDatabaseWritten: false, realModelCalled: true, provider: config.provider, model: config.model_id }
  try {
    const sample = await styles.analyzeAuthorStyle({ novelId, name: '渡口动作样稿', text })
    assert.equal(baseStyles.resolveAuthorStyleMaterial(novelId).approvedSample, undefined)
    assert.ok(sample.fingerprint.narrativeTechniques)
    assert.ok(sample.fingerprint.exampleExcerpts.every(quote => text.includes(quote)))
    styles.approveAuthorStyle(novelId, sample.record.id, novels.getNovel(novelId).contextVersion)
    assert.equal(baseStyles.resolveAuthorStyleMaterial(novelId).approvedSample.text, text)
    const trial = await styles.trialAuthorStyle(novelId, sample.record.id, '陈舟次日撑船送一名木匠去对岸。木匠愿意帮他修船，但要先看裂口。只写上船与确认修船的过程，不增加隐藏身份、帮派、超能力或结局。')
    assert.ok(trial.withFingerprint.text.trim() && trial.without.text.trim())
    Object.assign(result, { passed: true, sampleStats: sample.stats, analysis: sample.fingerprint, trial })
  } catch (error) { Object.assign(result, { passed: false, error: error.message }); process.exitCode = 1 }
  finally {
    closeDb()
    const output = path.join(root, 'outputs', 'wenlan-second-batch'); fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'real-model-smoke.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ passed: result.passed, formalDatabaseWritten: false, provider: result.provider, model: result.model, error: result.error }))
    if (!path.resolve(temp).startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(process.exitCode || 0), error => { console.error(error.message); app.exit(1) })
