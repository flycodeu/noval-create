const { _electron: electron } = require('playwright')
const { execFile } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'docs/ui-acceptance/SIMULATED')
const PROJECT_SUMMARY = path.join(ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const RUN_DIR = path.join(EVIDENCE, 'runs', RUN_ID)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function resolveProjectId() {
  const requested = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 0)
  if (requested > 0) return requested
  if (!fs.existsSync(PROJECT_SUMMARY)) throw new Error('缺少 P0-00 capture-summary.json，请先准备验收项目。')
  const summary = JSON.parse(fs.readFileSync(PROJECT_SUMMARY, 'utf8'))
  const projectId = Number(summary?.project?.id || 0)
  if (projectId <= 0) throw new Error('P0-00 摘要中没有有效项目 ID。')
  return projectId
}

async function launchProductionApp() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(ROOT, 'out/main/main.js'), '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_RENDERER_URL: `file://${path.join(ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}`,
    },
  })
}

async function closeApp(app) {
  if (!app) return
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function snapshotDatabase() {
  const probe = await launchProductionApp()
  let userDataPath
  try {
    userDataPath = await probe.evaluate(({ app }) => app.getPath('userData'))
  } finally {
    await closeApp(probe)
  }
  const databasePath = path.join(userDataPath, 'novelforge.db')
  if (!fs.existsSync(databasePath)) throw new Error(`找不到验收数据库：${databasePath}`)
  const snapshotDir = path.join(EVIDENCE, `.database-snapshot-${RUN_ID}`)
  fs.mkdirSync(snapshotDir, { recursive: true })
  const files = ['', '-wal', '-shm'].map((suffix) => {
    const source = `${databasePath}${suffix}`
    const backup = path.join(snapshotDir, `novelforge.db${suffix}`)
    const existed = fs.existsSync(source)
    if (existed) fs.copyFileSync(source, backup)
    return { source, backup, existed }
  })
  return { databasePath, snapshotDir, files }
}

function restoreDatabase(snapshot) {
  if (!snapshot) return
  for (const file of snapshot.files) {
    if (file.existed) fs.copyFileSync(file.backup, file.source)
    else if (fs.existsSync(file.source)) fs.unlinkSync(file.source)
  }
  fs.rmSync(snapshot.snapshotDir, { recursive: true, force: true })
}

function startLocalModelStub() {
  const requests = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: request.method, url: request.url, body })
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'simulation endpoint not found' }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        id: `sim-${Date.now()}`,
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '模拟模型响应：ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }))
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (!port) {
        reject(new Error('本地模型 stub 未取得端口'))
        return
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1`, requests })
    })
  })
}

async function stopLocalModelStub(stub) {
  if (!stub?.server) return
  await new Promise((resolve) => stub.server.close(() => resolve()))
}

async function seedTasks(snapshot, projectId, modelConfigId) {
  const result = await execFileAsync(require('electron'), [
    path.join(ROOT, 'scripts/ui-acceptance/seed-functional-simulated.cjs'),
    JSON.stringify({ databasePath: snapshot.databasePath, projectId, modelConfigId }),
  ], { cwd: ROOT, timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
  const output = String(result.stdout || '').trim()
  const match = output.match(/\{\s*"retryableTaskId"[\s\S]*\}/)
  if (!match) throw new Error(`模拟任务种子未返回 JSON：${output}`)
  return JSON.parse(match[0])
}

async function navigate(page, hash, selector) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ expectedHash, rootSelector }) => (
    window.location.hash.split('?')[0] === expectedHash && Boolean(document.querySelector(rootSelector))
  ), { expectedHash: hash, rootSelector: selector }, { timeout: 20000 })
  await page.waitForTimeout(500)
}

async function waitForTask(page, taskId, statuses, timeoutMs = 12000) {
  const started = Date.now()
  let latest = null
  while (Date.now() - started < timeoutMs) {
    latest = await page.evaluate((id) => window.electron.task.get(id), taskId)
    if (latest && statuses.includes(latest.status)) return latest
    await page.waitForTimeout(250)
  }
  return latest
}

async function runModelFlow(page, stub) {
  const result = {}
  const modelMarker = `模拟模型-${Date.now()}`
  const modelId = await page.evaluate(async ({ name, baseUrl }) => window.electron.model.create({
    name,
    provider: 'custom',
    modelId: 'novelforge-simulated',
    apiKey: '',
    baseUrl,
    temperature: 0,
    maxTokens: 512,
    maxConcurrency: 1,
  }), { name: modelMarker, baseUrl: stub.baseUrl })
  const listedModel = await page.evaluate(async (id) => {
    const configs = await window.electron.model.list()
    return configs.find((item) => item.id === id) || null
  }, modelId)
  result.modelCreateAndMask = Boolean(listedModel && listedModel.name === modelMarker && listedModel.apiKey === '')

  await page.evaluate(({ id, name }) => window.electron.model.update(id, { name, maxTokens: 1024 }), { id: modelId, name: `${modelMarker}-已更新` })
  const updatedModel = await page.evaluate(async (id) => (await window.electron.model.list()).find((item) => item.id === id) || null, modelId)
  result.modelUpdate = Boolean(updatedModel?.name === `${modelMarker}-已更新` && updatedModel.maxTokens === 1024)

  await page.evaluate((id) => window.electron.model.setDefault(id), modelId)
  const defaultModel = await page.evaluate(async (id) => (await window.electron.model.list()).find((item) => item.id === id) || null, modelId)
  result.modelSetDefault = defaultModel?.isDefault === 1

  const modelTest = await page.evaluate((id) => window.electron.model.test(id), modelId)
  result.modelTestLocalStub = Boolean(modelTest?.success && stub.requests.some((request) => request.url?.endsWith('/chat/completions')))

  return { result, modelId }
}

async function runSourceFlow(page) {
  const sourceSettings = await page.evaluate(() => window.electron.sourceSearch.updateSettings({
    provider: 'disabled',
    tavilyApiKey: '',
    braveApiKey: '',
  }))
  const sourceTest = await page.evaluate(() => window.electron.sourceSearch.test())
  return {
    sourceSearchDisabled: sourceSettings.provider === 'disabled'
      && sourceTest.success === false
      && sourceTest.providerName === null
      && /关闭/.test(sourceTest.info),
  }
}

async function runTemplateFlow(page) {
  const result = {}
  const templateMarker = `模拟模板-${Date.now()}`
  const templateId = await page.evaluate(({ name }) => window.electron.template.create({
    type: 'style',
    name,
    description: '本地模拟验收模板',
    contentJson: JSON.stringify({ perspective: '第三人称', sentence_style: '短句' }),
    isBuiltin: 0,
  }), { name: templateMarker })
  await page.evaluate((id) => window.electron.template.update(id, {
    description: '本地模拟验收模板·已更新',
    contentJson: JSON.stringify({ perspective: '第一人称', sentence_style: '短句推进' }),
  }), templateId)
  const updatedTemplate = await page.evaluate(async (id) => (await window.electron.template.list('style')).find((item) => item.id === id) || null, templateId)
  result.templateCreateUpdate = Boolean(updatedTemplate?.description?.includes('已更新') && updatedTemplate?.contentJson?.includes('第一人称'))

  const builtinTemplate = await page.evaluate(async () => {
    const templates = await window.electron.template.list()
    return templates.find((item) => item.isBuiltin === 1) || null
  })
  let builtinDeleteBlocked = false
  if (builtinTemplate) {
    try {
      await page.evaluate((id) => window.electron.template.delete(id), builtinTemplate.id)
    } catch {
      builtinDeleteBlocked = true
    }
  }
  result.templateBuiltinDeleteGuard = builtinTemplate ? builtinDeleteBlocked : false
  await page.evaluate((id) => window.electron.template.delete(id), templateId)
  const templateAfterDelete = await page.evaluate(async (id) => (await window.electron.template.list()).some((item) => item.id === id), templateId)
  result.templateDelete = templateAfterDelete === false

  return result
}

async function runPromptFlow(page) {
  const result = {}

  const promptMarker = `模拟提示词覆盖-${Date.now()}`
  await page.evaluate(({ key, content }) => window.electron.prompt.save(key, content), {
    key: 'chapterReview',
    content: `请保留上下文事实。${promptMarker}`,
  })
  const promptAfterSave = await page.evaluate(async (key) => (await window.electron.prompt.list()).find((item) => item.key === key) || null, 'chapterReview')
  result.promptSave = Boolean(promptAfterSave?.content?.includes(promptMarker))
  await page.evaluate((key) => window.electron.prompt.delete(key), 'chapterReview')
  const promptAfterReset = await page.evaluate(async (key) => (await window.electron.prompt.list()).some((item) => item.key === key), 'chapterReview')
  result.promptReset = promptAfterReset === false

  return result
}

async function runRevisionQualityFlow(page, projectId) {
  const result = {}

  const revisionMarker = `模拟修订任务-${Date.now()}`
  const revisionId = await page.evaluate(({ novelId, title }) => window.electron.revision.create(novelId, {
    title,
    taskType: 'continuity',
    severity: 'medium',
    description: '本地模拟修订 CRUD',
    relatedPage: 'revision',
  }), { novelId: projectId, title: revisionMarker })
  const revisionCreated = await page.evaluate((id) => window.electron.revision.get(id), revisionId)
  await page.evaluate((id) => window.electron.revision.update(id, { status: 'in_progress' }), revisionId)
  await page.evaluate((id) => window.electron.revision.update(id, { status: 'resolved' }), revisionId)
  const revisionResolved = await page.evaluate((id) => window.electron.revision.get(id), revisionId)
  result.revisionCreateUpdate = Boolean(revisionCreated?.title === revisionMarker && revisionResolved?.status === 'resolved')
  const unsupportedFix = await page.evaluate((id) => window.electron.revision.autoFix(id), revisionId)
  result.revisionUnsupportedFixFeedback = unsupportedFix?.status === 'unsupported'
  await page.evaluate((id) => window.electron.revision.delete(id), revisionId)
  result.revisionDelete = await page.evaluate((id) => window.electron.revision.get(id), revisionId) === null

  const qualityAction = {
    id: `simulated-quality-${Date.now()}`,
    label: '生成模拟修订任务',
    description: '本地模拟质量动作',
    actionType: 'create_revision_task',
    metricKey: 'simulated_quality',
    targetPage: 'revision',
    safeToExecute: true,
    taskDraft: {
      issueKey: `simulated-quality-${Date.now()}`,
      taskType: 'continuity',
      severity: 'medium',
      title: '模拟质量风险修订',
      description: '质量面板动作的本地模拟闭环。',
      fixBrief: '检查上下文承接。',
      relatedPage: 'revision',
      originMeta: { simulation: true },
    },
  }
  const qualityResult = await page.evaluate(({ novelId, action }) => window.electron.quality.executeRepairAction(novelId, action), { novelId: projectId, action: qualityAction })
  const qualityTask = qualityResult?.taskId ? await page.evaluate((id) => window.electron.revision.get(id), qualityResult.taskId) : null
  result.qualityRepairAction = qualityResult?.status === 'executed' && Boolean(qualityTask?.title === '模拟质量风险修订')

  return result
}

async function runCoreIpcFlow(page, projectId, stub) {
  const model = await runModelFlow(page, stub)
  const source = await runSourceFlow(page)
  const template = await runTemplateFlow(page)
  const prompt = await runPromptFlow(page)
  const revisionQuality = await runRevisionQualityFlow(page, projectId)
  return {
    result: { ...model.result, ...source, ...template, ...prompt, ...revisionQuality },
    modelId: model.modelId,
  }
}

async function runTaskUiFlow(page, projectId, taskIds, stub) {
  const result = {}
  await navigate(page, '#/tasks', '.task-center-page')
  const retryCard = page.locator('[data-p3-05-task-list] .novel-list-card').filter({ hasText: '模拟首次执行失败' }).first()
  result.retryCardVisible = await retryCard.count() === 1
  if (result.retryCardVisible) {
    await retryCard.click()
    await page.waitForTimeout(250)
    const retryButton = page.locator('.task-center-detail__actions button').filter({ hasText: '重试' }).first()
    result.retryButtonVisible = await retryButton.count() === 1
    if (result.retryButtonVisible) await retryButton.click()
  } else {
    result.retryButtonVisible = false
  }

  const startedAt = Date.now()
  let retriedTask = null
  while (Date.now() - startedAt < 12000) {
    const pageData = await page.evaluate(() => window.electron.task.query({ page: 1, pageSize: 200 }))
    retriedTask = pageData.items.find((task) => task.id !== taskIds.retryableTaskId
      && task.type === 'review'
      && task.outputText?.includes('模拟模型响应'))
    if (retriedTask?.status === 'success') break
    await page.waitForTimeout(250)
  }
  result.retryCompleted = retriedTask?.status === 'success' && stub.requests.length > 0

  const workflowCard = page.locator('[data-p3-05-task-list] .novel-list-card').filter({ hasText: '模拟应用重启后暂停' }).first()
  result.resumeCardVisible = await workflowCard.count() === 1
  if (result.resumeCardVisible) {
    await workflowCard.click()
    await page.waitForTimeout(250)
    const resumeButton = page.locator('.task-center-detail__actions button').filter({ hasText: '继续' }).first()
    result.resumeButtonVisible = await resumeButton.count() === 1
    if (result.resumeButtonVisible) await resumeButton.click()
  } else {
    result.resumeButtonVisible = false
  }
  const workflowTask = await waitForTask(page, taskIds.workflowTaskId, ['success', 'failed', 'blocked'], 12000)
  result.resumeCompleted = workflowTask?.status === 'success'
  return result
}

function buildReport({ projectId, core, tasks, stub }) {
  const checks = { ...core, ...tasks }
  const passed = Object.values(checks).filter(Boolean).length
  const total = Object.keys(checks).length
  const lines = [
    '# NovelForge 本地模拟功能闭环验收',
    '',
    `- 运行编号：\`${RUN_ID}\``,
    `- 项目 ID：\`${projectId}\``,
    '- 测试边界：仅 Electron IPC + 本地 OpenAI 兼容 stub；未调用任何真实模型或来源检索 API。',
    `- 本地模型请求：${stub.requests.length} 次（仅 127.0.0.1）。`,
    '',
    '| 功能 | 结果 |',
    '| --- | --- |',
  ]
  Object.entries(checks).forEach(([key, value]) => lines.push(`| ${key} | ${value ? 'PASS' : 'BLOCKED'} |`))
  lines.push('', `- 模拟功能检查：${passed}/${total} PASS`, '- 数据保护：执行前创建数据库快照，Electron 关闭后恢复原数据库。')
  return lines.join('\n')
}

async function main() {
  fs.mkdirSync(path.join(RUN_DIR, 'screenshots'), { recursive: true })
  const projectId = resolveProjectId()
  const snapshot = await snapshotDatabase()
  const stub = await startLocalModelStub()
  let app
  try {
    app = await launchProductionApp()
    const page = await app.firstWindow({ timeout: 30000 })
    page.on('pageerror', (error) => console.error(`[SIMULATED] pageerror: ${error.message}`))
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1800)

    const core = await runCoreIpcFlow(page, projectId, stub)
    await page.screenshot({ path: path.join(RUN_DIR, 'screenshots', 'core-operations.png'), fullPage: false, timeout: 120000 })
    await closeApp(app)
    app = null

    const taskIds = await seedTasks(snapshot, projectId, core.modelId)
    app = await launchProductionApp()
    const taskPage = await app.firstWindow({ timeout: 30000 })
    await taskPage.waitForLoadState('domcontentloaded')
    await taskPage.waitForTimeout(1200)
    const tasks = await runTaskUiFlow(taskPage, projectId, taskIds, stub)
    await taskPage.screenshot({ path: path.join(RUN_DIR, 'screenshots', 'tasks-recovery.png'), fullPage: false, timeout: 120000 })

    const report = buildReport({ projectId, core: core.result, tasks, stub })
    const checks = { ...core.result, ...tasks }
    writeJson(path.join(RUN_DIR, 'functional.json'), { runId: RUN_ID, projectId, checks, taskIds, localModelRequests: stub.requests })
    fs.writeFileSync(path.join(RUN_DIR, 'functional.md'), `${report}\n`, 'utf8')
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.copyFileSync(path.join(RUN_DIR, 'functional.md'), path.join(EVIDENCE, 'functional.md'))
    fs.copyFileSync(path.join(RUN_DIR, 'functional.json'), path.join(EVIDENCE, 'functional.json'))
    fs.writeFileSync(path.join(EVIDENCE, 'latest-run.json'), `${JSON.stringify({ runId: RUN_ID, runDir: path.relative(ROOT, RUN_DIR) }, null, 2)}\n`, 'utf8')

    const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key)
    console.log(`[SIMULATED] ${failed.length ? 'BLOCKED' : 'PASS'}; checks ${Object.keys(checks).length - failed.length}/${Object.keys(checks).length}; localRequests=${stub.requests.length}; run=${RUN_ID}`)
    if (failed.length) throw new Error(`模拟功能验收失败：${failed.join('、')}`)
  } finally {
    await closeApp(app)
    await stopLocalModelStub(stub)
    await new Promise((resolve) => setTimeout(resolve, 350))
    restoreDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error('[SIMULATED] FAILED', error)
  process.exitCode = 1
})
