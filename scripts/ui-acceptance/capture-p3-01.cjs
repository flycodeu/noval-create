const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P3-01'))
const PROJECT_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const PHASE = process.argv.includes('--before') ? 'before' : 'after'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]

const ROUTES = [
  { key: 'guide', route: 'guide', root: '.novel-dashboard, [data-studio-responsibility="next-step-blockers"]', label: '创作总控台' },
  { key: 'overview', route: 'overview', root: '.novel-overview-page, [data-overview-responsibility="project-information"]', label: '项目资料' },
]

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function resolveProjectId() {
  const requested = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 0)
  if (requested > 0) return requested
  if (!fs.existsSync(PROJECT_SUMMARY)) throw new Error('缺少 P0-00 capture-summary.json。')
  const summary = JSON.parse(fs.readFileSync(PROJECT_SUMMARY, 'utf8'))
  const projectId = Number(summary?.project?.id || 0)
  if (projectId <= 0) throw new Error('P0-00 摘要中没有有效项目 ID。')
  return projectId
}

function assertStaticContracts() {
  const studio = read('src/pages/Novel/Studio/index.tsx')
  const overview = read('src/pages/Novel/Overview/index.tsx')
  const checks = [
    ['Studio 使用共享信息栏与动作契约', studio.includes('chrome="shared"') && studio.includes('actionContract={{')],
    ['Studio 明确下一步职责区', studio.includes('data-studio-next-step') && studio.includes('推荐下一步')],
    ['Studio 独立呈现阻塞区', studio.includes('data-studio-blockers') && studio.includes('当前阻塞')],
    ['Studio 诊断信息按需展开', studio.includes('data-studio-diagnostics') && studio.includes('<details')],
    ['Studio 不再复制项目资料表单', !studio.includes('基础信息') && !studio.includes('userBackground')],
    ['Overview 使用共享信息栏与动作契约', overview.includes('chrome="shared"') && overview.includes('actionContract={{')],
    ['Overview 以项目资料为唯一职责', overview.includes('data-overview-responsibility="project-information"') && overview.includes('data-overview-project-info')],
    ['Overview 基础资料保留保存动作', overview.includes('data-overview-save-state') && overview.includes('保存项目资料')],
    ['Overview 包装信息按需展开', overview.includes('data-overview-packaging') && overview.includes('packagingExpanded')],
    ['Overview 删除流程状态复制', !overview.includes('buildAuthorWorkflowSummary') && !overview.includes('workflowStageCards') && !overview.includes('当前阻塞项')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P3-01 静态契约失败：${failed.join('、')}`)
  return checks.map(([label]) => label)
}

async function launchProductionApp() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'out/main/main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_RENDERER_URL: `file://${path.join(REPO_ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}`,
    },
  })
}

async function snapshotAcceptanceDatabase() {
  const probe = await launchProductionApp()
  let userDataPath
  try {
    userDataPath = await probe.evaluate(({ app }) => app.getPath('userData'))
  } finally {
    await probe.close().catch(() => undefined)
  }
  const databasePath = path.join(userDataPath, 'novelforge.db')
  if (!fs.existsSync(databasePath)) throw new Error(`找不到验收数据库：${databasePath}`)
  const snapshotDir = path.join(EVIDENCE_ROOT, `.database-snapshot-${timestampId()}`)
  fs.mkdirSync(snapshotDir, { recursive: true })
  const files = ['', '-wal', '-shm'].map((suffix) => {
    const source = `${databasePath}${suffix}`
    const backup = path.join(snapshotDir, `novelforge.db${suffix}`)
    const existed = fs.existsSync(source)
    if (existed) fs.copyFileSync(source, backup)
    return { source, backup, existed }
  })
  return { snapshotDir, files }
}

function restoreAcceptanceDatabase(snapshot) {
  if (!snapshot) return
  for (const file of snapshot.files) {
    if (file.existed) fs.copyFileSync(file.backup, file.source)
    else if (fs.existsSync(file.source)) fs.unlinkSync(file.source)
  }
  fs.rmSync(snapshot.snapshotDir, { recursive: true, force: true })
}

async function setViewport(app, page, viewport) {
  await page.setViewportSize(viewport)
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setContentSize(size.width, size.height)
  }, viewport)
  await page.waitForTimeout(280)
}

async function navigate(page, projectId, route) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}`, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ selector }) => {
    const root = document.querySelector(selector)
    return Boolean(root && !root.querySelector('.ant-spin'))
  }, { selector: route.root }, { timeout: 20000 })
  await page.waitForTimeout(420)
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, viewport, phase, routeKey }) => {
    const root = document.querySelector(selector)
    const documentRoot = document.documentElement
    const body = document.body
    const visible = (node) => {
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const collectVisiblePageActions = () => root
      ? [...root.querySelectorAll('button, [role="button"], a')].filter((node) => visible(node) && node.getBoundingClientRect().top < innerHeight)
      : []
    const collectVisibleDetails = () => root ? [...root.querySelectorAll('details')].filter(visible) : []
    const overviewProjectInfo = () => {
      if (routeKey !== 'overview' || !root) return { header: null, body: null }
      return {
        header: root.querySelector('.overview-page__project-info .novel-panel__header'),
        body: root.querySelector('.overview-page__project-info .novel-panel__body'),
      }
    }
    const collectReasons = (maxScrollWidth, panelHeaderBox) => {
      const reasons = []
      if (!root) reasons.push('页面职责根节点不存在')
      if (maxScrollWidth > documentRoot.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
      if (phase === 'after' && routeKey === 'guide' && root && !root.querySelector('[data-studio-next-step]')) reasons.push('下一步区域不存在')
      if (phase === 'after' && routeKey === 'overview' && root && !root.querySelector('[data-overview-project-info]')) reasons.push('项目资料区域不存在')
      if (phase === 'after' && routeKey === 'overview' && panelHeaderBox && panelHeaderBox.height > 180) reasons.push('核心资料标题区出现异常空白')
      return reasons
    }
    const pageActions = collectVisiblePageActions()
    const visibleDetails = collectVisibleDetails()
    const projectInfo = overviewProjectInfo()
    const panelHeader = projectInfo.header
    const panelBody = projectInfo.body
    const panelHeaderBox = panelHeader?.getBoundingClientRect()
    const panelBodyBox = panelBody?.getBoundingClientRect()
    const maxScrollWidth = Math.max(documentRoot.scrollWidth, body?.scrollWidth || 0)
    const reasons = collectReasons(maxScrollWidth, panelHeaderBox)
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      phase,
      clientWidth: documentRoot.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(documentRoot.scrollHeight, body?.scrollHeight || 0, root?.scrollHeight || 0),
      visibleActionCount: pageActions.length,
      panelCount: root?.querySelectorAll('.novel-panel, .workflow-panel').length || 0,
      disclosureCount: visibleDetails.length,
      nextStepCount: root?.querySelectorAll('[data-studio-next-step]').length || 0,
      blockerCount: root?.querySelectorAll('[data-studio-blocker]').length || 0,
      projectInfoFieldCount: root?.querySelectorAll('[data-overview-project-info] input, [data-overview-project-info] textarea').length || 0,
      overviewHeaderHeight: panelHeaderBox ? Math.round(panelHeaderBox.height * 100) / 100 : null,
      overviewBodyTop: panelBodyBox ? Math.round(panelBodyBox.top * 100) / 100 : null,
    }
  }, { selector: route.root, viewport, phase: PHASE, routeKey: route.key })
}

async function verifyInteractions(page, projectId) {
  const marker = `P3-01-${Date.now()}`
  const result = {}

  const overviewRoute = ROUTES[1]
  await navigate(page, projectId, overviewRoute)
  const titleInput = page.getByLabel('书名', { exact: true })
  await titleInput.fill(`${marker} 项目资料`)
  result.overviewDirty = await page.locator('[data-overview-save-state]').getAttribute('data-overview-save-state') === 'unsaved'
  await page.getByRole('button', { name: '保存项目资料', exact: true }).click()
  result.overviewSaveState = await page.waitForFunction(() => document.querySelector('[data-overview-save-state]')?.getAttribute('data-overview-save-state') === 'saved', null, { timeout: 10000 }).then(() => true).catch(() => false)
  const savedNovel = await page.evaluate((novelId) => window.electron.novel.get(novelId), projectId)
  result.overviewSavePersisted = String(savedNovel?.title || '').includes(marker)

  const packagingToggle = page.getByRole('button', { name: /包装信息/ }).first()
  await packagingToggle.click()
  result.packagingDisclosure = await page.locator('[data-overview-packaging-content]').isVisible().catch(() => false)

  const guideRoute = ROUTES[0]
  await navigate(page, projectId, guideRoute)
  const nextStepButton = page.locator('[data-studio-next-step]').getByRole('button').first()
  const nextStepTarget = await page.locator('[data-studio-next-step]').getAttribute('data-target-route')
  await nextStepButton.click()
  await page.waitForTimeout(450)
  result.recommendedActionNavigates = (await windowHash(page)) !== `#/novels/${projectId}/guide`
  result.recommendedTargetDeclared = Boolean(nextStepTarget)

  await navigate(page, projectId, guideRoute)
  const blockerSection = page.locator('[data-studio-blockers]')
  result.blockerSectionSeparated = await blockerSection.count() === 1
  result.diagnosticsCollapsedByDefault = await page.locator('[data-studio-diagnostics]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)

  return result
}

async function windowHash(page) {
  return page.evaluate(() => window.location.hash)
}

function buildReport({ runId, projectId, results, staticContracts, interactions }) {
  const lines = [
    `# P3-01 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
    '',
    `- 运行编号：\`${runId}\``,
    `- 项目 ID：\`${projectId}\``,
    `- 阶段：\`${PHASE}\``,
    '',
    '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |',
    '| --- | --- | --- | --- | --- |',
  ]
  ROUTES.forEach((route) => {
    const cells = VIEWPORTS.map(({ width, height }) => {
      const value = results[route.key][`${width}x${height}`]
      return `${value.clientWidth}/${value.scrollWidth}; H${value.pageHeight}; A${value.visibleActionCount}; P${value.panelCount}; D${value.disclosureCount}; ${value.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  })
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A职责区可见动作; P面板; D可见折叠区; 状态`。')
  if (PHASE === 'after') {
    lines.push('', `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`)
    lines.push(`- 交互检查：${Object.values(interactions).filter((value) => value === true).length}/${Object.keys(interactions).length} PASS`)
    lines.push('- 数据保护：交互测试前创建数据库快照，应用关闭后已恢复。')
  }
  return lines.join('\n')
}

async function main() {
  const projectId = resolveProjectId()
  const runId = timestampId()
  const runDir = path.join(EVIDENCE_ROOT, 'runs', runId)
  const screenshotsDir = path.join(runDir, 'screenshots')
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const staticContracts = PHASE === 'after' ? assertStaticContracts() : []
  const snapshot = PHASE === 'after' ? await snapshotAcceptanceDatabase() : null
  let app
  try {
    app = await launchProductionApp()
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const results = Object.fromEntries(ROUTES.map((route) => [route.key, {}]))
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      for (const route of ROUTES) {
        await navigate(page, projectId, route)
        const item = await measure(page, route, viewport)
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({
          path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`),
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
          timeout: 60000,
        })
        console.log(`[P3-01] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P3-01] interactions ${JSON.stringify(interactions)}`)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
      if (failed.length > 0) throw new Error(`P3-01 交互验收失败：${failed.join('、')}`)
    }
    const report = buildReport({ runId, projectId, results, staticContracts, interactions })
    writeJson(path.join(runDir, 'metrics.json'), results)
    fs.writeFileSync(path.join(runDir, `${PHASE}.md`), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, `${PHASE}-metrics.json`), results)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, `${PHASE}.md`), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, phase: PHASE, runDir: path.relative(REPO_ROOT, runDir).replace(/\\/g, '/') })
  } finally {
    if (app) await app.close().catch(() => undefined)
    restoreAcceptanceDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error('[P3-01] FAILED', error)
  process.exitCode = 1
})
