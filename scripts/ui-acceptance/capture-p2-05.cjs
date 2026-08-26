const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-05'))
const PROJECT_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const PHASE = process.argv.includes('--before') ? 'before' : 'after'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]
const ROUTE = { key: 'factions', route: 'factions', root: '.novel-factions-page', label: '势力系统' }
const DENSITY_TARGET = 24

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
  const page = read('src/pages/Novel/Factions/index.tsx')
  const css = read('src/pages/Novel/Factions/index.css')
  const graph = read('src/pages/Novel/Factions/FactionGraphCanvas.tsx')
  const checks = [
    ['势力页接入共享信息栏和动作契约', page.includes('chrome="shared"') && page.includes('actionContract={{')],
    ['势力列表使用紧凑可键盘选择行', page.includes('data-faction-list-row') && page.includes('aria-pressed') && css.includes('.faction-list-card')],
    ['势力选择同步 factionId 深链', page.includes('useSearchParams') && page.includes("next.set('factionId'")],
    ['图谱与详情使用单一焦点视图', page.includes('data-faction-view') && page.includes("viewMode === 'graph'") && css.includes('.faction-workspace__view-switch')],
    ['图谱节点选择保持聚焦', graph.includes('onFactionSelect') && graph.includes('selectedFactionId')],
    ['成员列表具备独立有界滚动', page.includes('data-faction-members-scroll') && css.includes('[data-faction-members-scroll]') && css.includes('overflow-y: auto')],
    ['关系列表具备独立有界滚动', page.includes('data-faction-relations-scroll') && css.includes('[data-faction-relations-scroll]') && css.includes('max-height')],
    ['详情高级字段渐进披露', page.includes('faction-editor__advanced') && page.includes('<details') && css.includes('.faction-editor__advanced')],
    ['详情切换具备未保存保护', page.includes('当前势力还有未保存修改') && page.includes("addEventListener('beforeunload'") && page.includes('data-faction-save-state')],
    ['删除和清空保持危险确认', page.includes('Modal.confirm(') && page.includes("okType: 'danger'")],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-05 静态契约失败：${failed.join('、')}`)
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
  await page.waitForTimeout(300)
}

async function navigate(page, projectId, focusId) {
  const query = focusId ? `?factionId=${focusId}` : ''
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${ROUTE.route}${query}`, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(() => {
    const root = document.querySelector('.novel-factions-page')
    return Boolean(root)
      && !root.querySelector('.ant-spin')
      && (Boolean(root.querySelector('[data-faction-list-row]'))
        || Boolean(root.querySelector('.faction-list-card'))
        || root.textContent?.includes('当前没有势力记录'))
  }, null, { timeout: 20000 })
  await page.waitForTimeout(450)
}

async function seedDensity(page, projectId) {
  const marker = `P2-05-${Date.now()}`
  return page.evaluate(async ({ novelId, target, seedMarker }) => {
    const created = { factions: 0, members: 0, relations: 0 }
    let factions = await window.electron.faction.list(novelId)
    while (created.factions < target) {
      const seq = factions.length + created.factions + 1
      await window.electron.faction.create(novelId, {
        name: `${seedMarker}-势力-${String(seq).padStart(2, '0')}`,
        type: seq % 3 === 0 ? 'sect' : 'organization',
        goal: `${seedMarker} 验证势力定位、图谱聚焦与详情边界。`,
        resources: '掌握一条可被追踪的资源链。',
        currentPhase: seq % 2 ? '扩张前夜' : '关系重组',
        memberPolicy: '以任务和利益维持成员归属。',
        notes: `别名：${seedMarker}-别名-${seq}`,
        sortOrder: seq,
      })
      created.factions += 1
      factions = await window.electron.faction.list(novelId)
    }
    const seededFactions = factions.filter((item) => item.name.startsWith(seedMarker))
    const focus = seededFactions[0]
    if (!focus || seededFactions.length < target) throw new Error('P2-05 无法准备势力样本。')

    const relations = seededFactions.slice(1).map((item, index) => ({
      target_faction_id: item.id,
      target_faction_name: item.name,
      relation: ['ally', 'rival', 'trade', 'enemy'][index % 4],
      note: `${seedMarker} 关系记录 ${index + 1}`,
    }))
    await window.electron.faction.update(focus.id, { externalRelationsJson: JSON.stringify(relations) })
    created.relations = relations.length

    let characters = await window.electron.character.list(novelId)
    while (created.members < target) {
      const seq = characters.length + created.members + 1
      await window.electron.character.create(novelId, {
        fullName: `${seedMarker}-成员-${String(seq).padStart(2, '0')}`,
        roleType: 'major',
        recordStatus: 'confirmed',
        occupation: '势力成员',
        goals: `${seedMarker} 验证成员长列表边界。`,
        campFactionIdsJson: JSON.stringify([focus.name]),
        sortOrder: seq,
      })
      created.members += 1
      characters = await window.electron.character.list(novelId)
    }

    return { marker: seedMarker, focusId: focus.id, focusName: focus.name, ...created }
  }, { novelId: projectId, target: DENSITY_TARGET, seedMarker: marker })
}

async function measure(page, viewport) {
  return page.evaluate(({ viewport }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector('.novel-factions-page')
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const pageActions = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(visible)
    const listRows = [...(workspace?.querySelectorAll('[data-faction-list-row], .faction-list-card') || [])].filter(visible)
    const bounded = [...(workspace?.querySelectorAll('[data-faction-members-scroll], [data-faction-relations-scroll]') || [])].filter(visible)
    const overflowingBounded = bounded.filter((node) => node.scrollHeight > node.clientHeight + 1)
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const workspaceRect = workspace?.getBoundingClientRect()
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (workspaceRect && viewport.width <= 1024 && workspaceRect.width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    if (viewport.width >= 1024 && listRows.length === 0) reasons.push('势力列表没有可见行')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      actionCount: pageActions.length,
      listRowCount: listRows.length,
      graphVisible: Boolean(workspace?.querySelector('[data-faction-view="graph"]')),
      detailVisible: Boolean(workspace?.querySelector('[data-faction-view="detail"]')),
      boundedScrollCount: bounded.length,
      boundedOverflowCount: overflowingBounded.length,
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { viewport })
}

function readHashParam(page, name) {
  return page.evaluate((key) => new URLSearchParams(window.location.hash.split('?')[1] || '').get(key), name)
}

async function verifyInteractions(page, projectId, density) {
  await navigate(page, projectId, density.focusId)
  const search = page.getByPlaceholder('搜索势力、目标、资源或阶段')
  await search.fill(density.marker)
  await page.waitForTimeout(600)
  const rows = page.locator('[data-faction-list-row]')
  const rowCount = await rows.count()
  const located = rowCount >= DENSITY_TARGET && (await rows.first().innerText()).includes(density.marker)
  await rows.first().click()
  const selectedId = await readHashParam(page, 'factionId')

  const advanced = page.locator('.faction-editor__advanced')
  if (!(await advanced.evaluate((node) => node.hasAttribute('open')).catch(() => false))) await advanced.locator('summary').click()
  const detailsOpened = await advanced.evaluate((node) => node.hasAttribute('open'))
  const bounded = await page.evaluate(() => {
    const read = (selector) => {
      const node = document.querySelector(selector)
      return node ? { visible: getComputedStyle(node).display !== 'none', clientHeight: node.clientHeight, scrollHeight: node.scrollHeight } : null
    }
    return { members: read('[data-faction-members-scroll]'), relations: read('[data-faction-relations-scroll]') }
  })
  const membersBounded = Boolean(bounded.members?.visible && (bounded.members.scrollHeight > bounded.members.clientHeight))
  const relationsBounded = Boolean(bounded.relations?.visible && (bounded.relations.scrollHeight > bounded.relations.clientHeight))

  await page.getByRole('tab', { name: '关系图谱', exact: true }).click()
  const graphVisible = await page.locator('[data-faction-view="graph"]').isVisible()
  const graphNode = page.locator('.react-flow__node').filter({ hasText: density.marker }).first()
  const graphNodeVisible = await graphNode.isVisible().catch(() => false)
  if (graphNodeVisible) await graphNode.click()
  const graphSelectedId = await readHashParam(page, 'factionId')
  await page.getByRole('tab', { name: '当前详情', exact: true }).click()

  const nameInput = page.getByLabel('势力名称', { exact: true }).first()
  const originalName = await nameInput.inputValue()
  await nameInput.fill(`${originalName || density.focusName} · dirty-${Date.now()}`)
  const saveStateBefore = await page.evaluate(() => document.querySelector('[data-faction-save-state]')?.getAttribute('data-faction-save-state') || '')
  const beforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  const secondRow = rows.nth(1)
  await secondRow.click()
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前势力还有未保存修改' }).last()
  const leaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (leaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()

  await page.getByRole('button', { name: '保存势力', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-faction-save-state]')?.getAttribute('data-faction-save-state') === 'saved', null, { timeout: 8000 })

  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '删除势力' }).click()
  const deleteDialog = page.getByRole('dialog').filter({ hasText: '删除势力' }).last()
  const deleteConfirmation = await deleteDialog.isVisible().catch(() => false)
  if (deleteConfirmation) await deleteDialog.getByRole('button', { name: /取\s*消/ }).click()

  return {
    rowCount: rowCount >= DENSITY_TARGET,
    located,
    selectedId: Boolean(selectedId),
    detailsOpened,
    membersBounded,
    relationsBounded,
    graphVisible,
    graphNodeVisible,
    graphSelectedId: Boolean(graphSelectedId),
    unsavedStateVisible: saveStateBefore === 'unsaved',
    beforeUnload,
    leaveProtection,
    deleteConfirmation,
  }
}

function buildReport(runId, projectId, results, staticContracts, interactions, density) {
  const item = results[ROUTE.key]
  const cells = VIEWPORTS.map(({ width, height }) => {
    const value = item[`${width}x${height}`]
    return `${value.clientWidth}/${value.scrollWidth}; H${Math.round(value.pageHeight)}; A${value.actionCount}; L${value.listRowCount}; B${value.boundedOverflowCount}/${value.boundedScrollCount}; ${value.status}`
  })
  const lines = [
    `# P2-05 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
    '',
    `- 运行编号：\`${runId}\``,
    `- 项目 ID：\`${projectId}\``,
    `- 阶段：\`${PHASE}\``,
    '',
    '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |',
    '| --- | --- | --- | --- | --- |',
    `| ${ROUTE.label} | ${cells.join(' | ')} |`,
    '',
    '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; L可见列表行; B发生溢出的有界滚动体/有界滚动体总数; 状态`。',
    '',
  ]
  if (PHASE === 'after') {
    lines.push(
      `- 临时密度：${density.factions} 个势力、${density.members} 名成员、${density.relations} 条外部关系（运行结束已恢复）。`,
      `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`,
      `- 交互检查：${Object.keys(interactions).length} PASS`,
      '- 数据保护：交互测试前创建数据库快照，应用关闭后已恢复。',
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
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined))
    await page.waitForLoadState('domcontentloaded')
    const density = PHASE === 'after'
      ? await seedDensity(page, projectId)
      : { marker: '', focusId: 0, focusName: '', factions: 0, members: 0, relations: 0 }
    const results = { [ROUTE.key]: {} }
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      await navigate(page, projectId, PHASE === 'after' ? density.focusId : 0)
      const item = await measure(page, viewport)
      results[ROUTE.key][`${viewport.width}x${viewport.height}`] = item
      await page.screenshot({ path: path.join(screenshotsDir, `${ROUTE.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
      console.log(`[P2-05] ${item.status.padEnd(7)} ${ROUTE.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId, density)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P2-05] interactions ${JSON.stringify(interactions)}`)
      if (failed.length > 0) throw new Error(`P2-05 交互验收失败：${failed.join('、')}`)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
      writeJson(path.join(runDir, 'density.json'), density)
      writeJson(path.join(EVIDENCE_ROOT, 'after-density.json'), density)
    }
    const report = buildReport(runId, projectId, results, staticContracts, interactions, density)
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
  console.error(error)
  process.exitCode = 1
})
