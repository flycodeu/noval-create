const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P2-02')
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
  { key: 'world-rules', route: 'world-rules', root: '.novel-world-rules-page', label: '世界规则' },
  { key: 'map', route: 'map', root: '.novel-map-page', label: '地图结构' },
  { key: 'items', route: 'items', root: '.novel-items-page', label: '物品与装备' },
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
  const worldRules = read('src/pages/Novel/WorldRules/index.tsx')
  const worldRulesCss = read('src/pages/Novel/WorldRules/index.css')
  const map = read('src/pages/Novel/MapExplorer/MapExplorerPage.tsx')
  const mapCss = read('src/pages/Novel/MapExplorer/map-explorer.css')
  const items = read('src/pages/Novel/ItemsWorkspace/index.tsx')
  const itemsCss = read('src/pages/Novel/ItemsWorkspace/index.css')
  const checks = [
    ['世界规则接入共享信息栏和动作契约', worldRules.includes('className="novel-world-rules-page"') && worldRules.includes('chrome="shared"') && worldRules.includes('actionContract={{')],
    ['世界规则高级运行明细按需展开', worldRules.includes('novel-world-rules-page__auto-details') && worldRules.includes('<details') && worldRulesCss.includes('novel-world-rules-page__auto-details')],
    ['地图接入共享信息栏和动作契约', map.includes('chrome="shared"') && map.includes('actionContract={{')],
    ['地图选中节点同步 nodeId 深链', map.includes('setSearchParams') && map.includes('nextParams.set(\'nodeId\'') && map.includes('nextParams.delete(\'nodeId\'')],
    ['地图窄屏保持列表与详情并排滚动', mapCss.includes('.map-list-workspace') && mapCss.includes('grid-template-columns: minmax(240px, 0.86fr) minmax(0, 1.14fr)') && mapCss.includes('grid-row: 1 / span 2')],
    ['物品接入共享信息栏和动作契约', items.includes('chrome="shared"') && items.includes('actionContract={{')],
    ['物品选中项同步 itemId 深链', items.includes('setSearchParams') && items.includes('nextParams.set(\'itemId\'') && items.includes('nextParams.delete(\'itemId\'')],
    ['物品编辑具备未保存状态和离开保护', items.includes('data-items-save-state') && items.includes("addEventListener('beforeunload'") && items.includes('pendingItemNavigation')],
    ['物品列表使用紧凑行和有界滚动', items.includes('itemHeight={116}') && itemsCss.includes('novel-items-page.novel-workspace--wide .novel-list-card') && itemsCss.includes('max-height')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-02 静态契约失败：${failed.join('、')}`)
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
  await page.waitForTimeout(300)
}

async function navigate(page, projectId, route) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}`, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ selector, fallback }) => {
    const root = document.querySelector(selector)
    const fallbackRoot = document.querySelector(fallback)
    return Boolean(root || fallbackRoot) && !(root || fallbackRoot)?.querySelector('.ant-spin')
  }, { selector: route.root, fallback: '.novel-workspace' }, { timeout: 20000 })
  await page.waitForTimeout(400)
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, fallback, viewport }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector(selector) || document.querySelector(fallback)
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const rect = (node) => {
      if (!node) return null
      const value = node.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height, bottom: value.bottom }
    }
    const pageActions = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(visible)
    const scrollableBodies = [...(workspace?.querySelectorAll('.novel-panel--scrollable .novel-panel__body') || [])].filter(visible)
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const workspaceRect = rect(workspace)
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (workspaceRect && viewport.width <= 1024 && workspaceRect.width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      actionCount: pageActions.length,
      scrollableCount: scrollableBodies.length,
      workspace: workspaceRect,
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
      listMode: Boolean(workspace?.querySelector('.map-list-workspace')),
      graphMode: Boolean(workspace?.querySelector('.map-graph-workspace')),
    }
  }, { selector: route.root, fallback: '.novel-workspace', viewport })
}

async function waitForPersisted(page, projectId, field, expected) {
  await page.waitForFunction(async ({ novelId, fieldName, marker }) => {
    const novel = await window.electron.novel.get(novelId)
    return String(novel?.[fieldName] || '').includes(marker)
  }, { novelId: projectId, fieldName: field, marker: expected }, { timeout: 12000 })
}

async function verifyWorldRules(page, projectId) {
  await navigate(page, projectId, ROUTES[0])
  await page.getByRole('tab', { name: '力量体系' }).click()
  const activeTab = await page.getByRole('tab', { name: '力量体系' }).getAttribute('aria-selected')
  await page.getByRole('tab', { name: '世界概览' }).click()
  const marker = `P2-02-world-${Date.now()}`
  const genreInput = page.getByLabel('题材名称').first()
  await genreInput.fill(marker)
  await page.getByRole('button', { name: '保存规则' }).click()
  await waitForPersisted(page, projectId, 'worldRulesJson', marker)
  return { sectionSwitch: activeTab === 'true', savePersisted: true }
}

async function verifyMap(page, projectId) {
  await navigate(page, projectId, ROUTES[1])
  const firstNode = page.locator('.map-list-panel .map-node-stack button').first()
  await firstNode.waitFor({ state: 'visible', timeout: 12000 })
  const nodeText = await firstNode.innerText()
  await firstNode.click()
  const nodeId = await page.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('nodeId'))
  await page.getByRole('button', { name: '图谱模式' }).click()
  await page.waitForSelector('.map-graph-workspace')
  const graphVisible = await page.locator('.map-graph-workspace').isVisible()
  await page.getByRole('button', { name: '列表模式' }).click()
  await page.waitForSelector('.map-list-workspace')
  const listVisible = await page.locator('.map-list-workspace').isVisible()
  return { selectedNodeUrl: Boolean(nodeId), selectedNodeText: nodeText.trim().length > 0, graphVisible, listVisible }
}

async function verifyItems(page, projectId) {
  await navigate(page, projectId, ROUTES[2])
  let firstItem = page.locator('.novel-items-page .novel-list-card').first()
  if (!(await firstItem.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '新建模板' }).click()
    await page.getByRole('tab', { name: '字段编辑' }).click()
    const createdName = `P2-02-item-${Date.now()}`
    await page.getByLabel('名称').first().fill(createdName)
    await page.getByRole('button', { name: '保存物品' }).click()
    await page.waitForFunction(() => new URLSearchParams(window.location.hash.split('?')[1] || '').has('itemId'))
    firstItem = page.locator('.novel-items-page .novel-list-card').first()
  }
  await firstItem.waitFor({ state: 'visible', timeout: 12000 })
  await firstItem.click()
  const itemId = await page.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('itemId'))
  await page.getByRole('tab', { name: '字段编辑' }).click()
  const itemName = page.getByLabel('名称').first()
  const original = await itemName.inputValue()
  await itemName.fill(`${original || '验收物品'} · dirty-${Date.now()}`)
  const beforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  const search = page.getByPlaceholder('搜索名称、分类、剧情作用').first()
  await search.fill('__p2_02_no_match__')
  await page.waitForTimeout(500)
  const emptyState = await page.getByText('当前筛选下还没有记录。').isVisible().catch(() => false)
  await search.fill('')
  await page.waitForTimeout(500)
  const deleteButton = page.getByRole('button', { name: '删除' }).first()
  await deleteButton.click()
  const deleteDialog = page.getByRole('dialog').filter({ hasText: '删除' }).last()
  const deleteConfirmationVisible = await deleteDialog.isVisible().catch(() => false)
  await deleteDialog.getByRole('button', { name: /取\s*消/ }).click()
  const moreButton = page.getByRole('button', { name: '更多页面操作' })
  await moreButton.click()
  await page.getByRole('menuitem', { name: '清空物品系统' }).click()
  const clearDialog = page.getByRole('dialog').filter({ hasText: '清空物品系统' }).last()
  const clearConfirmationVisible = await clearDialog.isVisible().catch(() => false)
  await clearDialog.getByRole('button', { name: /取\s*消/ }).click()
  await page.getByRole('button', { name: '保存物品' }).click()
  await page.waitForFunction(() => document.querySelector('[data-items-save-state]')?.getAttribute('data-items-save-state') === 'saved', null, { timeout: 5000 })
  return {
    selectedItemUrl: Boolean(itemId),
    beforeUnloadGuardActive: beforeUnload,
    searchFilterVisible: emptyState,
    deleteConfirmationVisible,
    clearConfirmationVisible,
  }
}

async function verifyInteractions(page, projectId) {
  const checks = {
    worldRules: await verifyWorldRules(page, projectId),
    map: await verifyMap(page, projectId),
    items: await verifyItems(page, projectId),
  }
  const failed = Object.entries(checks).flatMap(([group, values]) => (
    Object.entries(values).filter(([, passed]) => passed !== true).map(([key]) => `${group}.${key}`)
  ))
  if (failed.length > 0) throw new Error(`P2-02 交互验收失败：${failed.join('、')}`)
  return checks
}

function buildReport(runId, projectId, results, staticContracts, interactions) {
  const lines = [
    `# P2-02 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
    '',
    `- 运行编号：\`${runId}\``,
    `- 项目 ID：\`${projectId}\``,
    `- 阶段：\`${PHASE}\``,
    '',
    '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const route of ROUTES) {
    const cells = VIEWPORTS.map(({ width, height }) => {
      const item = results[route.key][`${width}x${height}`]
      return `${item.clientWidth}/${item.scrollWidth}; H${Math.round(item.pageHeight)}; A${item.actionCount}; S${item.scrollableCount}; ${item.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  }
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; S独立滚动体; 状态`。', '')
  if (PHASE === 'after') {
    lines.push(
      `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`,
      `- 交互检查：${Object.values(interactions).reduce((total, group) => total + Object.keys(group).length, 0)} PASS`,
      '- 数据保护：世界规则保存与物品未保存检查前创建数据库快照，应用关闭后已恢复。',
      '',
    )
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
    const results = {}
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      for (const route of ROUTES) {
        await navigate(page, projectId, route)
        const item = await measure(page, route, viewport)
        if (!results[route.key]) results[route.key] = {}
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({ path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
        console.log(`[P2-02] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
    }
    fs.writeFileSync(path.join(runDir, `${PHASE}.md`), buildReport(runId, projectId, results, staticContracts, interactions), 'utf8')
    writeJson(path.join(runDir, 'metrics.json'), results)
    writeJson(path.join(EVIDENCE_ROOT, `${PHASE}-metrics.json`), results)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, `${PHASE}.md`), buildReport(runId, projectId, results, staticContracts, interactions), 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, phase: PHASE, runDir: path.relative(REPO_ROOT, runDir).replace(/\\/g, '/') })
  } finally {
    if (app) {
      await app.close().catch(() => undefined)
    }
    if (snapshot) restoreAcceptanceDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
