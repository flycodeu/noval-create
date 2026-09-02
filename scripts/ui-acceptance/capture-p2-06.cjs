const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-06'))
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
  { key: 'story-design', route: 'story-design', root: '.novel-story-design-page', label: '主线骨架' },
  { key: 'threads', route: 'threads', root: '.novel-story-threads-page', label: '剧情线程' },
  { key: 'endgame', route: 'endgame', root: '.novel-endgame-page', label: '终局承诺' },
]
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
  const core = read('src/pages/Novel/CoreSettings/index.tsx')
  const coreCss = read('src/pages/Novel/CoreSettings/index.css')
  const threads = read('src/pages/Novel/StoryThreads/index.tsx')
  const threadsCss = read('src/pages/Novel/StoryThreads/index.css')
  const endgame = read('src/pages/Novel/Endgame/index.tsx')
  const endgameCss = read('src/pages/Novel/Endgame/index.css')
  const checks = [
    ['主线页接入共享动作契约', core.includes('chrome="shared"') && core.includes('actionContract={{')],
    ['主线核心字段保持单一编辑区', core.includes('data-story-design-anchor-fields') && core.includes('story_goal') && core.includes('main_plot')],
    ['主线低频原则按需展开', core.includes('data-story-design-guidance') && core.includes('<details') && coreCss.includes('.story-design__advanced')],
    ['支线看板支持拖拽排序', core.includes('data-story-design-subplot') && core.includes('onDrop') && core.includes('moveSubplot')],
    ['主线表单具备未保存保护', core.includes('data-story-design-save-state') && core.includes("addEventListener('beforeunload'")],
    ['线程页接入共享动作契约', threads.includes('chrome="shared"') && threads.includes('actionContract={{')],
    ['线程支持关键词、类型和状态筛选', threads.includes('useDebouncedSearch') && threads.includes('threadTypeFilter') && threads.includes('statusFilter') && threads.includes('threadType: threadTypeFilter')],
    ['线程支持拖拽并持久化 sortOrder', threads.includes('data-story-thread-row') && threads.includes('story-threads__drag-handle') && threads.includes('sortOrder:')],
    ['线程编辑使用抽屉且保护未保存修改', threads.includes('<Drawer') && threads.includes('当前线程还有未保存修改') && threads.includes("addEventListener('beforeunload'") && threadsCss.includes('.story-threads__advanced')],
    ['线程显示引用来源摘要', threads.includes('buildThreadReferenceSummary') && threads.includes('data-story-threads-references')],
    ['终局页接入共享动作契约', endgame.includes('chrome="shared"') && endgame.includes('actionContract={{')],
    ['终局核心字段集中在首要编辑区', endgame.includes('data-endgame-core-fields') && endgame.includes('finalConflict') && endgame.includes('lastScene')],
    ['终局兑现与留白可折叠', endgame.includes('data-endgame-payoff') && endgame.includes('<details') && endgameCss.includes('.endgame-page__advanced--payoff')],
    ['终局来源仅显示摘要', endgame.includes('listCommitments') && endgame.includes('data-endgame-sources') && endgame.includes('data-endgame-source-row')],
    ['终局表单具备未保存保护', endgame.includes('data-endgame-save-state') && endgame.includes("addEventListener('beforeunload'")],
    ['共享 Chrome 白名单包含 P2-06 三页', read('scripts/workspace-chrome-contract.test.cjs').includes('src/pages/Novel/CoreSettings/index.tsx') && read('scripts/workspace-chrome-contract.test.cjs').includes('src/pages/Novel/StoryThreads/index.tsx') && read('scripts/workspace-chrome-contract.test.cjs').includes('src/pages/Novel/Endgame/index.tsx')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-06 静态契约失败：${failed.join('、')}`)
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

async function navigate(page, projectId, route) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}`, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ selector, routeKey, phase }) => {
    const root = document.querySelector(selector)
    if (!root || root.querySelector('.ant-spin')) return false
    if (phase === 'before') return true
    if (routeKey === 'story-design') return Boolean(root.querySelector('[data-story-design-anchor-fields]'))
    if (routeKey === 'threads') return Boolean(root.querySelector('[data-story-threads-filters]'))
    return Boolean(root.querySelector('[data-endgame-core-fields]'))
  }, { selector: route.root, routeKey: route.key, phase: PHASE }, { timeout: 20000 })
  await page.waitForTimeout(450)
}

async function dragElement(page, source, target) {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('P2-06 找不到可拖拽元素的可见区域。')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

async function seedDensity(page, projectId) {
  const marker = `P2-06-${Date.now()}`
  return page.evaluate(async ({ novelId, target, seedMarker }) => {
    const novel = await window.electron.novel.get(novelId)
    if (!novel) throw new Error('P2-06 找不到验收项目。')
    const settings = JSON.parse(novel.settingsJson || '{}')
    const subplots = Array.from({ length: 12 }, (_, index) => ({
      name: `${seedMarker}-支线-${String(index + 1).padStart(2, '0')}`,
      characters: `${seedMarker}-角色-${index + 1}`,
      conflict: `${seedMarker} 验证支线拖拽排序与主线挂接。`,
      mainlineLink: `在第 ${index + 1} 个推进节点反作用于主线。`,
      endChapter: String(8 + index * 6),
    }))
    settings.story_design = {
      ...(settings.story_design || {}),
      story_goal: `${seedMarker} 主线目标：让证据链在终局完成闭环。`,
      core_conflict: `${seedMarker} 核心冲突：公开真相会牺牲既有秩序。`,
      main_plot: `${seedMarker} 主推进链：取证、反击、失去保护、公开账本。`,
      ending_type: 'open',
      ending: `${seedMarker} 结局落点：主角公开规则并承担余波。`,
      sub_plots_list: subplots,
      sub_plots: subplots.map((item, index) => `${index + 1}. ${item.name}；${item.conflict}`).join('\n'),
    }
    settings.endgame_design = {
      ...(settings.endgame_design || {}),
      ending_mode: 'costly_victory',
      final_conflict: `${seedMarker} 最终冲突：独占账本维持秩序，还是公开账本承担混乱。`,
      theme_answer: `${seedMarker} 主题答案：承认代价后仍愿意共同记账。`,
      must_deliver_promises: Array.from({ length: 6 }, (_, index) => `${seedMarker} 必须兑现承诺 ${index + 1}`).join('\n'),
      payoff_checklist: Array.from({ length: 6 }, (_, index) => `${seedMarker} 终局回收点 ${index + 1}`).join('\n'),
      deliberate_unknowns: `${seedMarker} 保留续部网络的范围。`,
      final_image: `${seedMarker} 终章意象：一册公开账本被推到人群中央。`,
      last_scene: `${seedMarker} 最后一幕：主角把朱笔交给排队的第一个人。`,
    }
    await window.electron.novel.update(novelId, { settingsJson: JSON.stringify(settings) })
    const synced = await window.electron.endgameAsset.syncFromSettings(novelId, JSON.stringify(settings))

    const existing = await window.electron.thread.list(novelId)
    const existingTitles = new Set(existing.map((item) => item.title))
    for (let index = 1; index <= target; index += 1) {
      const title = `${seedMarker}-线程-${String(index).padStart(2, '0')}`
      if (existingTitles.has(title)) continue
      await window.electron.thread.create(novelId, {
        threadType: index % 3 === 0 ? 'mystery' : index % 2 === 0 ? 'subplot' : 'main',
        title,
        summary: `${seedMarker} 线程摘要，用于验证列表筛选与拖拽排序。`,
        premise: `${seedMarker} 线程触发前提。`,
        status: index % 4 === 0 ? 'active' : 'planned',
        priority: index % 5 === 0 ? 'high' : 'medium',
        startChapter: index,
        targetPayoffChapter: 20 + index,
        currentState: `${seedMarker} 当前推进到第 ${index} 个节点。`,
        payoffCondition: `${seedMarker} 满足证据链后回收。`,
        relatedCharacterIdsJson: '[]',
        relatedItemIdsJson: '[]',
        relatedTimelineEventIdsJson: '[]',
        sortOrder: index,
      })
      existingTitles.add(title)
    }
    const verified = await window.electron.thread.query({ novelId, page: 1, pageSize: 200, keyword: seedMarker })
    return { marker: seedMarker, subplots: subplots.length, threads: verified.total, commitments: synced.summary.totalCount }
  }, { novelId: projectId, target: DENSITY_TARGET, seedMarker: marker })
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, viewport, routeKey, phase }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector(selector)
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const pageActions = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(visible)
    const bounded = [...(workspace?.querySelectorAll('.story-design__lane-body, .rc-virtual-list-holder') || [])].filter(visible)
    const coreFields = phase === 'after'
      ? workspace?.querySelector('[data-story-design-anchor-fields], [data-endgame-core-fields]')
      : null
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (workspace && viewport.width <= 1024 && workspace.getBoundingClientRect().width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    if (phase === 'after' && routeKey === 'story-design' && !workspace?.querySelector('[data-story-design-anchor-fields]')) reasons.push('主线核心字段区域不存在')
    if (phase === 'after' && routeKey === 'endgame' && !workspace?.querySelector('[data-endgame-core-fields]')) reasons.push('终局核心字段区域不存在')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      actionCount: pageActions.length,
      disclosureCount: workspace?.querySelectorAll('details').length || 0,
      boundedScrollCount: bounded.length,
      boundedOverflowCount: bounded.filter((node) => node.scrollHeight > node.clientHeight + 1).length,
      coreFieldBottom: coreFields ? Math.round(coreFields.getBoundingClientRect().bottom) : null,
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: route.root, viewport, routeKey: route.key, phase: PHASE })
}

async function verifyInteractions(page, projectId, density) {
  const result = {}

  const storyRoute = ROUTES[0]
  console.log('[P2-06] interaction story: start')
  await navigate(page, projectId, storyRoute)
  await page.getByRole('tab', { name: '支线', exact: true }).click()
  const subplotCards = page.locator('[data-story-design-subplot]')
  result.storySubplotDensity = await subplotCards.count() >= 8
  result.storyDrag = false
  if (await subplotCards.count() >= 2) {
    await dragElement(page, subplotCards.first(), subplotCards.nth(1))
    result.storyDrag = await page.locator('[data-story-design-save-state]').getAttribute('data-story-design-save-state') === 'unsaved'
  }
  await page.getByRole('tab', { name: '锚点', exact: true }).click()
  const storyDetails = page.locator('[data-story-design-guidance]:visible')
  if (!(await storyDetails.evaluate((node) => node.hasAttribute('open')).catch(() => false))) await storyDetails.locator('summary').click()
  result.storyGuidanceDisclosure = await storyDetails.evaluate((node) => node.hasAttribute('open'))
  await page.getByRole('button', { name: '保存故事设计', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-story-design-save-state]')?.getAttribute('data-story-design-save-state') === 'saved', null, { timeout: 10000 })
  result.storySave = true
  console.log('[P2-06] interaction story: saved')

  const threadRoute = ROUTES[1]
  console.log('[P2-06] interaction threads: navigate')
  await navigate(page, projectId, threadRoute)
  const search = page.getByPlaceholder('搜索线程标题、摘要或当前状态')
  await search.fill(density.marker)
  await page.waitForFunction(({ marker, expectedTotal }) => {
    const rows = [...document.querySelectorAll('[data-story-thread-row]')]
    return rows.length > 0
      && rows.every((row) => row.textContent?.includes(marker))
      && expectedTotal > 0
  }, { marker: density.marker, expectedTotal: density.threads }, { timeout: 12000 })
  const rows = page.locator('[data-story-thread-row]')
  const filteredRows = await rows.count()
  const filteredRowTexts = await rows.allTextContents()
  const filteredStats = await page.evaluate(({ novelId, marker }) => window.electron.thread.getStats({
    novelId,
    page: 1,
    pageSize: 1,
    keyword: marker,
  }), { novelId: projectId, marker: density.marker })
  console.log(`[P2-06] interaction threads: visible rows=${filteredRows}, filtered total=${filteredStats.total}, expected=${density.threads}`)
  result.threadFilter = filteredRows > 0
    && filteredRowTexts.every((text) => text.includes(density.marker))
    && filteredStats.total === density.threads
  result.threadDrag = false
  const handles = page.locator('.story-threads__drag-handle')
  if (await handles.count() >= 2) {
    console.log('[P2-06] interaction threads: drag start')
    await dragElement(page, handles.first(), handles.nth(1))
    console.log('[P2-06] interaction threads: drag finished')
    const orderMessage = page.locator('.ant-message-notice-content').filter({ hasText: '线程顺序已保存' }).last()
    await orderMessage.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)
    result.threadDrag = await orderMessage.isVisible().catch(() => false)
  }
  const firstRow = rows.filter({ hasText: density.marker }).first()
  console.log('[P2-06] interaction threads: locate edit')
  await firstRow.scrollIntoViewIfNeeded()
  await firstRow.hover()
  const editButton = firstRow.locator('button').filter({ hasText: /编\s*辑/ }).first()
  await editButton.waitFor({ state: 'visible', timeout: 10000 })
  await editButton.click()
  console.log('[P2-06] interaction threads: editor opened')
  const drawer = page.locator('.ant-drawer:visible').filter({ hasText: '编辑故事线程' }).last()
  await drawer.waitFor({ state: 'visible', timeout: 10000 })
  const titleInput = drawer.getByLabel('线程标题', { exact: true })
  await titleInput.fill(`${density.marker}-线程-编辑后`)
  await drawer.getByRole('button', { name: /取\s*消/, exact: true }).click()
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前线程还有未保存修改' }).last()
  result.threadLeaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (result.threadLeaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await drawer.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.waitForTimeout(700)
  result.threadEditor = !(await drawer.isVisible().catch(() => true))
  console.log('[P2-06] interaction threads: saved')

  const endgameRoute = ROUTES[2]
  console.log('[P2-06] interaction endgame: navigate')
  await navigate(page, projectId, endgameRoute)
  const endgameRoot = page.locator('.novel-endgame-page')
  result.endgameCoreFields = await endgameRoot.locator('[data-endgame-core-fields] .ant-form-item').count() === 5
  const sources = endgameRoot.locator('[data-endgame-sources]:visible')
  if (!(await sources.evaluate((node) => node.hasAttribute('open')).catch(() => false))) await sources.locator('summary').click()
  result.endgameSourceSummary = await endgameRoot.locator('[data-endgame-source-row]').count() > 0
  console.log(`[P2-06] interaction endgame: sources=${result.endgameSourceSummary}`)
  await page.getByLabel('最终冲突对象', { exact: true }).fill(`${density.marker}-终局冲突已编辑`)
  result.endgameDirty = await page.locator('[data-endgame-save-state]').getAttribute('data-endgame-save-state') === 'unsaved'
  result.endgameBeforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  console.log(`[P2-06] interaction endgame: dirty=${result.endgameDirty}, beforeUnload=${result.endgameBeforeUnload}`)
  const saveButton = page.getByRole('button', { name: '保存终局设计', exact: true })
  console.log(`[P2-06] interaction endgame: save buttons=${await saveButton.count()}`)
  await saveButton.click()
  console.log('[P2-06] interaction endgame: save clicked')
  result.endgameSave = await page.waitForFunction(() => document.querySelector('[data-endgame-save-state]')?.getAttribute('data-endgame-save-state') === 'saved', null, { timeout: 10000 }).then(() => true).catch(async () => {
    const state = await page.locator('[data-endgame-save-state]').getAttribute('data-endgame-save-state').catch(() => 'missing')
    const errors = await page.locator('.ant-form-item-explain-error').allTextContents().catch(() => [])
    console.log(`[P2-06] interaction endgame: save state=${state}, validation=${errors.join('、')}`)
    return false
  })
  if (result.endgameSave) console.log('[P2-06] interaction endgame: saved')
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '清空终局设计' }).click()
  const clearDialog = page.getByRole('dialog').filter({ hasText: '清空终局设计' }).last()
  result.endgameDangerConfirmation = await clearDialog.isVisible().catch(() => false)
  if (result.endgameDangerConfirmation) await clearDialog.getByRole('button', { name: /取\s*消/ }).click()
  console.log(`[P2-06] interaction endgame: clear confirmation=${result.endgameDangerConfirmation}`)

  return result
}

function buildReport(runId, results, staticContracts, interactions, density) {
  const lines = [
    `# P2-06 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
    '',
    `- 运行编号：\`${runId}\``,
    `- 项目 ID：\`${resolveProjectId()}\``,
    `- 阶段：\`${PHASE}\``,
    '',
    '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |',
    '| --- | --- | --- | --- | --- |',
  ]
  ROUTES.forEach((route) => {
    const cells = VIEWPORTS.map(({ width, height }) => {
      const value = results[route.key][`${width}x${height}`]
      return `${value.clientWidth}/${value.scrollWidth}; H${value.pageHeight}; A${value.actionCount}; D${value.disclosureCount}; B${value.boundedOverflowCount}/${value.boundedScrollCount}; ${value.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  })
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; D折叠区; B发生溢出的有界滚动体/有界滚动体总数; 状态`。')
  if (PHASE === 'after') {
    lines.push('', `- 临时样本：${density.subplots} 条支线、${density.threads} 条线程、${density.commitments} 条终局承诺（运行结束已恢复）。`)
    lines.push(`- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`)
    lines.push(`- 交互检查：${Object.keys(interactions).length} PASS`)
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
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined))
    await page.waitForLoadState('domcontentloaded')
    const density = PHASE === 'after'
      ? await seedDensity(page, projectId)
      : { marker: '', subplots: 0, threads: 0, commitments: 0 }
    if (PHASE === 'after') {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)
    }
    const results = Object.fromEntries(ROUTES.map((route) => [route.key, {}]))
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        await setViewport(app, page, viewport)
        await navigate(page, projectId, route)
        const item = await measure(page, route, viewport)
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({ path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
        console.log(`[P2-06] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId, density)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P2-06] interactions ${JSON.stringify(interactions)}`)
      if (failed.length > 0) throw new Error(`P2-06 交互验收失败：${failed.join('、')}`)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
      writeJson(path.join(runDir, 'density.json'), density)
      writeJson(path.join(EVIDENCE_ROOT, 'after-density.json'), density)
    }
    const report = buildReport(runId, results, staticContracts, interactions, density)
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
