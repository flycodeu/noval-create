const path = require('node:path')
const { app } = require('electron')
const Database = require('better-sqlite3')

app.setName(process.env.NOVELFORGE_APP_NAME || 'Electron')

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'novelforge.db')
  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare(`
    SELECT id, name, provider, model_id, is_default,
      CASE WHEN api_key IS NULL OR api_key = '' THEN 0 ELSE 1 END AS has_api_key,
      base_url, max_tokens, max_context_tokens
    FROM model_configs
    ORDER BY is_default DESC, id ASC
  `).all()
  const taskSummary = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN ('pending', 'running') THEN 1 ELSE 0 END) AS active
    FROM tasks
  `).get()
  const taskStatuses = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM tasks
    GROUP BY status
    ORDER BY status
  `).all()
  const latestTasks = db.prepare(`
    SELECT id, type, status, model_config_id, error_message, created_at, updated_at
    FROM tasks
    ORDER BY id DESC
    LIMIT 8
  `).all()
  console.log(JSON.stringify({ dbPath, models: rows, taskSummary, taskStatuses, latestTasks }, null, 2))
  db.close()
  if (process.env.NOVELFORGE_RECOVER_ORPHANED === '1') {
    const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
    registerProjectTsRuntime(path.resolve(__dirname, '..'))
    const { closeDb, initDb } = require(path.resolve(__dirname, '..', 'electron', 'database', 'db.ts'))
    const taskService = require(path.resolve(__dirname, '..', 'electron', 'services', 'task.service.ts'))
    initDb()
    const recovered = taskService.recoverOrphanedTasks()
    console.log(JSON.stringify({ recoveredOrphanedTasks: recovered }))
    closeDb()
  }
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
