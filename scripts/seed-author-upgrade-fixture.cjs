// Creates a synthetic pre-0075 library before the packaged runtime opens it.
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..'), fixture = path.resolve(process.env.NOVELFORGE_UPGRADE_FIXTURE_PATH || '.')
if (!fixture.startsWith(path.join(root, '.tmp-tests', 'packaged-mcp-'))) throw new Error('Upgrade fixture must be a packaged smoke profile.')
fs.mkdirSync(fixture, { recursive: true })
app.setPath('userData', fixture); app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
app.whenReady().then(() => {
  const db = require('../electron/database/db.ts'); db.initDb()
  try {
    const novels = require('../electron/services/novel.service.ts'), chapters = require('../electron/services/chapter.service.ts')
    const assets = require('../electron/services/endgame-asset.service.ts'), research = require('../electron/services/creative-research.service.ts')
    const sql = db.getSqlite(), body = '陈舟把欠条留在铺里，拿起木料。'
    const novelId = novels.createNovel({ title: '旧库升级与合并验证', operatingMode: 'creative_workflow' })
    const chapterId = chapters.createChapter(novelId, { chapterNum: 1, title: '旧欠条' })
    chapters.updateChapter(chapterId, { content: body })
    const card = research.upsertCreativeResearch(novelId, [{ category: 'narrative', title: '作者原有参考', content: '物件承担承诺的代价。', interpretation: '承诺通过具体损失体现。', novelConnection: '本作欠条作为抵押。' }])[0]
    const insert = detail => Number(sql.prepare('INSERT INTO foreshadow_ledger(novel_id,title,detail,status,required_evidence) VALUES(?,?,?,?,?)').run(novelId, '旧欠条', detail, 'planted', '作者旧依据').lastInsertRowid)
    const keepId = insert('欠条留在柜台。'), sourceId = insert('同一张欠条的重复记录。')
    assets.upsertChapterContract(chapterId, { requiredForeshadowIds: [keepId, sourceId] })
    sql.prepare("DELETE FROM _schema_migrations WHERE id='0075_foreshadow_merge'").run()
    sql.exec('DROP INDEX idx_foreshadow_merge_target; ALTER TABLE foreshadow_ledger DROP COLUMN merged_into_id; ALTER TABLE foreshadow_ledger DROP COLUMN merge_info_json')
    process.stdout.write(JSON.stringify({ novelId, chapterId, body, cardKey: card.sourceKey, keepId, sourceId }))
  } finally { db.closeDb() }
  app.exit(0)
}, error => { console.error(error.message); app.exit(1) }).catch(error => { console.error(error.message); app.exit(1) })
