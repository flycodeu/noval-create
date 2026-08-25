const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P1-01')
const P0_00_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]
const WRITING_ROUTES = ['editor', 'context', 'review', 'history']

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
  if (!fs.existsSync(P0_00_SUMMARY)) {
    throw new Error('缺少 P0-00 capture-summary.json，请先运行 npm run acceptance:p0-00。')
  }
  const summary = JSON.parse(fs.readFileSync(P0_00_SUMMARY, 'utf8'))
  const projectId = Number(summary?.project?.id || 0)
  if (projectId <= 0) throw new Error('P0-00 摘要中没有有效项目 ID。')
  return projectId
}

function assertStaticContracts() {
  const page = read('src/pages/Novel/Writing/index.tsx')
  const layout = read('src/pages/Novel/Writing/components/WritingWorkspaceLayout.tsx')
  const status = read('src/pages/Novel/Writing/components/WritingStatusBar.tsx')
  const navigator = read('src/pages/Novel/Writing/components/ChapterNavigator.tsx')
  const commands = read('src/pages/Novel/Writing/components/WritingCommandBar.tsx')
  const lifecycle = read('src/pages/Novel/Writing/useWritingEditorLifecycle.ts')
  const css = read('src/pages/Novel/Writing/index.css')
  const checks = [
    ['主工作区不再渲染重复章节头、验收汇总和底部备注', !layout.includes('WritingChapterHeader') && !layout.includes('WritingAcceptanceSummary') && !layout.includes('WritingFooter')],
    ['流水线改为紧凑状态条', layout.includes('WritingPipelineStrip') && layout.includes('data-writing-navigator-mode')],
    ['窄屏章节与辅助区使用 Drawer', layout.includes('<Drawer') && layout.includes('writing-drawer--navigator') && layout.includes('writing-drawer--inspector')],
    ['保存状态持续可见', status.includes('data-writing-save-state') && status.includes('有未保存修改') && status.includes('保存失败')],
    ['章节切换有未保存确认', page.includes('handleGuardedSelectChapter') && page.includes('保存并切换') && page.includes('留在当前章')],
    ['浏览器离开保护存在', lifecycle.includes("addEventListener('beforeunload'") && lifecycle.includes('event.preventDefault()')],
    ['章节导航支持搜索、状态筛选和分页', navigator.includes('searchKeyword') && navigator.includes('statusFilter') && navigator.includes('<Pagination')],
    ['默认只展开当前卷', navigator.includes("openVolumeKeys[group.key] ?? group.key === currentVolumeGroupKey")],
    ['次级写作动作进入更多菜单', commands.includes('<Dropdown') && commands.includes('更多')],
    ['960px 以下正文单列', css.includes('@media (max-width: 960px)') && css.includes('grid-template-columns: minmax(0, 1fr) !important')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P1-01 静态契约失败：${failed.join('、')}`)
  return checks.map(([label]) => label)
}

async function setViewport(app, page, viewport) {
  await page.setViewportSize(viewport)
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setContentSize(size.width, size.height)
  }, viewport)
  await page.waitForTimeout(350)
}

async function navigate(page, projectId, route, chapterId) {
  const hash = `#/novels/${projectId}/writing/${route}?chapterId=${chapterId}`
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ expectedRoute, expectedChapterId }) => {
    const root = document.querySelector('.novel-writing-console-page')
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return Boolean(root)
      && window.location.hash.split('?')[0].endsWith(`/writing/${expectedRoute}`)
      && params.get('chapterId') === String(expectedChapterId)
  }, { expectedRoute: route, expectedChapterId: chapterId }, { timeout: 20000 })
  await page.locator('.novel-writing-shell__editor-sheet').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(500)
  return hash
}

async function measure(page, viewport, expectedChapterCount) {
  return page.evaluate(({ viewport, expectedChapterCount }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector('.novel-writing-console-page')
    const grid = document.querySelector('.chapter-console-page__grid')
    const center = document.querySelector('.chapter-console-page__column--center')
    const sheet = document.querySelector('.novel-writing-shell__editor-sheet')
    const status = document.querySelector('[data-writing-status-bar="compact"]')
    const pipeline = document.querySelector('[data-writing-pipeline="compact"]')
    const navigator = grid?.querySelector('.chapter-console-page__column--left .chapter-navigator-panel')
    const navigatorTrigger = document.querySelector('.chapter-console-page__navigator-trigger')
    const errorCard = document.querySelector('.novel-route-shell__error-card')
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const rect = (node) => {
      if (!node) return null
      const value = node.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height, bottom: value.bottom }
    }
    const reasons = []
    const expectedMode = viewport.width <= 960 ? 'drawer' : 'column'
    const sheetRect = rect(sheet)
    const centerRect = rect(center)
    if (errorCard) reasons.push(errorCard.textContent?.replace(/\s+/g, ' ').trim() || '错误边界已触发')
    if (!workspace) reasons.push('正文工作台根节点不存在')
    if (workspace?.getAttribute('data-writing-navigator-mode') !== expectedMode) reasons.push(`章节导航模式不是 ${expectedMode}`)
    if (!visible(status) || !visible(pipeline)) reasons.push('紧凑状态栏或流水线状态条不可见')
    if (!visible(sheet) || !sheetRect || sheetRect.width < 420 || sheetRect.bottom <= 0 || sheetRect.y >= innerHeight) reasons.push(`正文首屏不可用，宽度 ${sheetRect?.width || 0}px`)
    if (!centerRect || centerRect.width < 460) reasons.push(`正文主区过窄，宽度 ${centerRect?.width || 0}px`)
    if (expectedMode === 'drawer') {
      if (visible(navigator)) reasons.push('窄屏仍在主网格内显示章节列表')
      if (!visible(navigatorTrigger)) reasons.push('窄屏章节抽屉入口不可见')
    } else {
      if (!visible(navigator)) reasons.push('桌面章节导航栏不可见')
      if (visible(navigatorTrigger)) reasons.push('桌面不应显示章节抽屉入口')
    }
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    const countText = document.querySelector('.chapter-navigator__count-badge')?.textContent || ''
    if (expectedMode === 'column' && !countText.includes(String(expectedChapterCount))) reasons.push('章节总数标记与真实数据不一致')
    return {
      status: reasons.length > 0 ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      navigatorMode: workspace?.getAttribute('data-writing-navigator-mode') || '',
      grid: rect(grid),
      center: centerRect,
      editor: sheetRect,
      editorFirstScreenVisible: visible(sheet) && Boolean(sheetRect && sheetRect.y < innerHeight),
      inlineNavigatorVisible: visible(navigator),
      navigatorTriggerVisible: visible(navigatorTrigger),
      saveState: document.querySelector('[data-writing-save-state]')?.getAttribute('data-writing-save-state') || '',
      compactStatusVisible: visible(status),
      compactPipelineVisible: visible(pipeline),
      renderedChapterRows: document.querySelectorAll('[data-writing-chapter-row]').length,
      chapterCountText: countText.trim(),
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
    }
  }, { viewport, expectedChapterCount })
}

async function captureScreenshot(page, filePath) {
  await page.screenshot({
    path: filePath,
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    timeout: 60000,
  })
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

async function snapshotAcceptanceDatabase(runDir) {
  const probe = await launchProductionApp()
  let userDataPath
  try {
    userDataPath = await probe.evaluate(({ app }) => app.getPath('userData'))
  } finally {
    await probe.close().catch(() => undefined)
  }
  const databasePath = path.join(userDataPath, 'novelforge.db')
  if (!fs.existsSync(databasePath)) throw new Error(`找不到验收数据库：${databasePath}`)
  const snapshotDir = path.join(runDir, '.database-snapshot')
  fs.mkdirSync(snapshotDir, { recursive: true })
  const suffixes = ['', '-wal', '-shm']
  const files = suffixes.map((suffix) => {
    const source = `${databasePath}${suffix}`
    const backup = path.join(snapshotDir, `novelforge.db${suffix}`)
    const existed = fs.existsSync(source)
    if (existed) fs.copyFileSync(source, backup)
    return { source, backup, existed }
  })
  return { databasePath, snapshotDir, files }
}

function restoreAcceptanceDatabase(snapshot) {
  for (const file of snapshot.files) {
    if (file.existed) fs.copyFileSync(file.backup, file.source)
    else if (fs.existsSync(file.source)) fs.unlinkSync(file.source)
  }
  fs.rmSync(snapshot.snapshotDir, { recursive: true, force: true })
}

async function verifyNavigatorTools(page, chapter, chapters) {
  const navigator = page.locator('.chapter-console-page__column--left .chapter-navigator-panel')
  const input = navigator.locator('.chapter-navigator__search-input input')
  const needle = (chapter.title || String(chapter.chapterNum)).slice(0, 12)
  await input.fill(needle)
  await page.waitForTimeout(250)
  const searchBadge = (await navigator.locator('.chapter-navigator__search-badge').textContent())?.trim() || ''
  const searchMatched = /匹配\s+[1-9]\d*\s+章/.test(searchBadge)
  await input.fill('')
  await page.waitForTimeout(150)

  const statuses = [...new Set(chapters.map((item) => item.status).filter(Boolean))]
  let statusFilterVerified = false
  let selectedStatus = ''
  if (statuses.length > 0) {
    await navigator.locator('.chapter-navigator__status-filter').click()
    const options = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    const optionCount = await options.count()
    if (optionCount > 1) {
      selectedStatus = (await options.nth(1).textContent())?.trim() || ''
      await options.nth(1).click()
      await page.waitForTimeout(200)
      statusFilterVerified = (await navigator.locator('[data-writing-chapter-row]').count()) > 0
    } else {
      await page.keyboard.press('Escape')
    }
  }
  if (selectedStatus) {
    await navigator.locator('.chapter-navigator__status-filter').click()
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: '全部状态' }).click()
  }
  return {
    searchMatched,
    searchBadge,
    statusFilterVerified,
    selectedStatus,
    paginationContractPresent: read('src/pages/Novel/Writing/components/ChapterNavigator.tsx').includes('<Pagination'),
    paginationVisibleForCurrentData: await navigator.locator('.chapter-navigator__pagination-wrap').count() > 0,
  }
}

async function verifyDeepLinks(page, projectId, chapterId) {
  const results = {}
  for (const route of WRITING_ROUTES) {
    await navigate(page, projectId, route, chapterId)
    results[route] = await page.evaluate(({ route, chapterId }) => {
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
      return {
        hash: window.location.hash,
        routePreserved: window.location.hash.split('?')[0].endsWith(`/writing/${route}`),
        chapterIdPreserved: params.get('chapterId') === String(chapterId),
      }
    }, { route, chapterId })
  }
  return results
}

async function verifyLifecycle(page, projectId, firstChapter, secondChapter) {
  const original = await page.evaluate((chapterId) => window.electron.chapter.get(chapterId), firstChapter.id)
  const marker = `P1-01验收-${Date.now()}`
  const originalContent = original?.content || ''
  const editor = page.locator('.novel-writing-shell__editor-sheet').first()
  let switchedChapterId = null
  await navigate(page, projectId, 'editor', firstChapter.id)
  const navigator = page.locator('.chapter-console-page__column--left .chapter-navigator-panel')
  const applyEdit = async (suffix) => {
    await editor.evaluate((node, payload) => {
      node.innerText = payload
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload }))
    }, `${originalContent}\n${marker}-${suffix}`)
    await page.waitForFunction(() => document.querySelector('[data-writing-save-state]')?.getAttribute('data-writing-save-state') === 'unsaved')
  }

  await applyEdit('取消切换')
  const unsavedStateVisible = await page.locator('[data-writing-save-state="unsaved"]').isVisible()
  const beforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return { defaultPrevented: event.defaultPrevented, dispatchReturned: dispatched }
  })
  await navigator.locator(`[data-writing-chapter-row="${secondChapter.id}"]`).click()
  const guard = page.locator('.ant-modal-confirm').filter({ hasText: '正文还有未保存修改' })
  await guard.waitFor({ state: 'visible', timeout: 5000 })
  const switchGuardVisible = await guard.isVisible()
  await guard.getByRole('button', { name: '留在当前章' }).click()
  await guard.waitFor({ state: 'hidden' })
  const activeAfterCancel = await navigator.locator(`[data-writing-chapter-row="${firstChapter.id}"]`).getAttribute('class')
  const cancelStayedOnChapter = Boolean(activeAfterCancel?.includes('is-active'))

  await page.waitForFunction(() => document.querySelector('[data-writing-save-state]')?.getAttribute('data-writing-save-state') === 'saved', null, { timeout: 15000 })
  await applyEdit('保存并切换')
  await navigator.locator(`[data-writing-chapter-row="${secondChapter.id}"]`).click()
  await guard.waitFor({ state: 'visible', timeout: 5000 })
  await guard.getByRole('button', { name: '保存并切换' }).click()
  await page.waitForFunction((chapterId) => [...document.querySelectorAll(`[data-writing-chapter-row="${chapterId}"]`)].some((node) => node.classList.contains('is-active')), secondChapter.id, { timeout: 20000 })
  switchedChapterId = secondChapter.id
  const persisted = await page.evaluate((chapterId) => window.electron.chapter.get(chapterId), firstChapter.id)
  const saveAndSwitchSucceeded = String(persisted?.content || '').includes(`${marker}-保存并切换`)

  return {
    result: {
      unsavedStateVisible,
      beforeUnloadGuardActive: beforeUnload.defaultPrevented && beforeUnload.dispatchReturned === false,
      switchGuardVisible,
      cancelStayedOnChapter,
      saveAndSwitchSucceeded,
      switchedChapterId,
      testedChapterIds: [firstChapter.id, secondChapter.id],
      dataRestored: false,
    },
    restoreExpectation: {
      chapterId: firstChapter.id,
      content: originalContent,
      wordCount: Number(original?.wordCount || 0),
    },
    marker,
  }
}

function buildReport({ runId, project, volumes, chapters, metrics, navigatorTools, deepLinks, lifecycle, staticContracts }) {
  const lines = [
    '# P1-01 正文写作工作台（改后）',
    '',
    `- 运行编号：\`${runId}\``,
    `- Electron 项目：ID ${project.id}「${project.title}」`,
    `- 真实数据：${volumes.length} 卷、${chapters.length} 章。`,
    '- 目标：正文首屏可写；桌面保留章节主从导航；窄屏改用抽屉；状态、保存和核心命令持续可见。',
    '',
    '| 视口 | 结果 | 导航模式 | 正文主区宽度 | 编辑器宽度 | 正文首屏 | 章节栏 | 抽屉入口 | 保存状态 | client/scroll | 截图 |',
    '| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- |',
  ]
  for (const [size, metric] of Object.entries(metrics)) {
    const result = metric.status === 'PASS' ? 'PASS' : `BLOCKED：${metric.reasons.join('；')}`
    lines.push(`| ${size} | ${result} | ${metric.navigatorMode} | ${Math.round(metric.center?.width || 0)}px | ${Math.round(metric.editor?.width || 0)}px | ${metric.editorFirstScreenVisible ? '是' : '否'} | ${metric.inlineNavigatorVisible ? '主栏' : '抽屉'} | ${metric.navigatorTriggerVisible ? '是' : '否'} | ${metric.saveState || '-'} | ${metric.clientWidth}/${metric.scrollWidth} | [截图](runs/${runId}/screenshots/writing-${size}.png) |`)
  }
  lines.push(
    '',
    '## 交互验收',
    '',
    `- 冗余章节头、验收汇总和底部备注移除：${staticContracts.length >= 1 ? 'PASS' : 'BLOCKED'}`,
    `- 章节搜索：${navigatorTools.searchMatched ? 'PASS' : 'BLOCKED'}（${navigatorTools.searchBadge || '无结果'}）`,
    `- 章节状态筛选：${navigatorTools.statusFilterVerified ? 'PASS' : 'BLOCKED'}${navigatorTools.selectedStatus ? `（${navigatorTools.selectedStatus}）` : ''}`,
    `- 分页能力：${navigatorTools.paginationContractPresent ? 'PASS' : 'BLOCKED'}（当前每卷不超过 40 章，运行态无需显示分页器）`,
    `- editor/context/review/history 深链与 chapterId：${Object.values(deepLinks).every((item) => item.routePreserved && item.chapterIdPreserved) ? 'PASS' : 'BLOCKED'}`,
    `- 未保存状态可见：${lifecycle.unsavedStateVisible ? 'PASS' : 'BLOCKED'}`,
    `- beforeunload 保护：${lifecycle.beforeUnloadGuardActive ? 'PASS' : 'BLOCKED'}`,
    `- 切换章节确认：${lifecycle.switchGuardVisible ? 'PASS' : 'BLOCKED'}`,
    `- 取消切换留在当前章：${lifecycle.cancelStayedOnChapter ? 'PASS' : 'BLOCKED'}`,
    `- 保存并切换：${lifecycle.saveAndSwitchSucceeded ? 'PASS' : 'BLOCKED'}`,
    `- 测试正文恢复：${lifecycle.dataRestored ? 'PASS' : 'BLOCKED'}`,
    '',
  )
  return lines.join('\n')
}

async function main() {
  const runId = timestampId()
  const projectId = resolveProjectId()
  const staticContracts = assertStaticContracts()
  const runDir = path.join(EVIDENCE_ROOT, 'runs', runId)
  const screenshotsDir = path.join(runDir, 'screenshots')
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const databaseSnapshot = await snapshotAcceptanceDatabase(runDir)
  let databaseRestored = false
  let app
  try {
    app = await launchProductionApp()
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)
    const dataset = await page.evaluate(async (id) => {
      const [project, chapters, volumes] = await Promise.all([
        window.electron.novel.get(id),
        window.electron.chapter.list(id),
        window.electron.structure.listVolumes(id),
      ])
      return { project, chapters, volumes }
    }, projectId)
    const chapters = [...dataset.chapters].sort((left, right) => left.chapterNum - right.chapterNum || left.id - right.id)
    if (chapters.length < 120 || dataset.volumes.length < 5) {
      throw new Error(`项目密度不足：${dataset.volumes.length} 卷、${chapters.length} 章；P1-01 要求真实 5 卷、120 章。`)
    }
    const editable = []
    for (const chapter of chapters) {
      const detail = await page.evaluate((id) => window.electron.chapter.get(id), chapter.id)
      if (Number(detail?.segmentCount || 0) <= 1) editable.push(detail)
      if (editable.length >= 2) break
    }
    if (editable.length < 2) throw new Error('找不到两个可编辑的单场景章节，无法完成未保存切换验收。')
    const [firstChapter, secondChapter] = editable

    const metrics = {}
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      await navigate(page, projectId, 'editor', firstChapter.id)
      const size = `${viewport.width}x${viewport.height}`
      metrics[size] = await measure(page, viewport, chapters.length)
      await captureScreenshot(page, path.join(screenshotsDir, `writing-${size}.png`))
    }

    await setViewport(app, page, { width: 1280, height: 800 })
    await navigate(page, projectId, 'editor', firstChapter.id)
    const navigatorTools = await verifyNavigatorTools(page, firstChapter, chapters)
    const deepLinks = await verifyDeepLinks(page, projectId, firstChapter.id)
    await navigate(page, projectId, 'editor', firstChapter.id)
    const lifecycleRun = await verifyLifecycle(page, projectId, firstChapter, secondChapter)
    const lifecycle = lifecycleRun.result
    await app.close()
    app = null
    restoreAcceptanceDatabase(databaseSnapshot)
    databaseRestored = true
    const verificationApp = await launchProductionApp()
    try {
      const verificationPage = await verificationApp.firstWindow()
      await verificationPage.waitForLoadState('domcontentloaded')
      const restoredChapter = await verificationPage.evaluate((chapterId) => window.electron.chapter.get(chapterId), lifecycleRun.restoreExpectation.chapterId)
      const markerHits = await verificationPage.evaluate(async ({ novelId, marker }) => {
        const list = await window.electron.chapter.list(novelId)
        let hits = 0
        for (const chapter of list) {
          const detail = await window.electron.chapter.get(chapter.id)
          if (String(detail?.content || '').includes(marker)) hits += 1
        }
        return hits
      }, { novelId: projectId, marker: lifecycleRun.marker })
      lifecycle.dataRestored = (restoredChapter?.content || '') === lifecycleRun.restoreExpectation.content
        && Number(restoredChapter?.wordCount || 0) === lifecycleRun.restoreExpectation.wordCount
        && markerHits === 0
    } finally {
      await verificationApp.close().catch(() => undefined)
    }

    const blockedMetrics = Object.values(metrics).filter((metric) => metric.status !== 'PASS')
    const interactions = {
      navigatorSearch: navigatorTools.searchMatched,
      navigatorStatusFilter: navigatorTools.statusFilterVerified,
      paginationContract: navigatorTools.paginationContractPresent,
      deepLinks: Object.values(deepLinks).every((item) => item.routePreserved && item.chapterIdPreserved),
      unsavedState: lifecycle.unsavedStateVisible,
      beforeUnload: lifecycle.beforeUnloadGuardActive,
      switchGuard: lifecycle.switchGuardVisible,
      cancelSwitch: lifecycle.cancelStayedOnChapter,
      saveAndSwitch: lifecycle.saveAndSwitchSucceeded,
      dataRestored: lifecycle.dataRestored,
    }
    const failedInteractions = Object.entries(interactions).filter(([, passed]) => !passed).map(([name]) => name)
    const summary = {
      runId,
      capturedAt: new Date().toISOString(),
      project: { id: dataset.project.id, title: dataset.project.title },
      volumeCount: dataset.volumes.length,
      chapterCount: chapters.length,
      viewportCount: VIEWPORTS.length,
      passCount: VIEWPORTS.length - blockedMetrics.length,
      blockedCount: blockedMetrics.length,
      interactionCount: Object.keys(interactions).length,
      failedInteractions,
      staticContractCount: staticContracts.length,
      runtime: 'Electron production build',
    }
    const report = buildReport({
      runId,
      project: dataset.project,
      volumes: dataset.volumes,
      chapters,
      metrics,
      navigatorTools,
      deepLinks,
      lifecycle,
      staticContracts,
    })
    writeJson(path.join(runDir, 'metrics.json'), metrics)
    writeJson(path.join(runDir, 'capture-summary.json'), summary)
    writeJson(path.join(runDir, 'lifecycle.json'), { navigatorTools, deepLinks, lifecycle, interactions })
    fs.writeFileSync(path.join(runDir, 'after.md'), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, runDirectory: `runs/${runId}`, capturedAt: summary.capturedAt })
    writeJson(path.join(EVIDENCE_ROOT, 'after-capture-summary.json'), summary)
    writeJson(path.join(EVIDENCE_ROOT, 'after-lifecycle.json'), { navigatorTools, deepLinks, lifecycle, interactions })
    fs.writeFileSync(path.join(EVIDENCE_ROOT, 'after.md'), report, 'utf8')
    console.log(`[P1-01] ${summary.passCount} PASS / ${summary.blockedCount} BLOCKED; interactions ${failedInteractions.length === 0 ? 'PASS' : `BLOCKED: ${failedInteractions.join(', ')}`}`)
    if (blockedMetrics.length > 0 || failedInteractions.length > 0) {
      throw new Error([
        ...blockedMetrics.flatMap((metric) => metric.reasons),
        ...failedInteractions.map((name) => `交互失败：${name}`),
      ].join('；'))
    }
  } finally {
    if (app) await app.close().catch(() => undefined)
    if (!databaseRestored) restoreAcceptanceDatabase(databaseSnapshot)
  }
}

main().catch((error) => {
  console.error('[P1-01] FAILED', error)
  process.exitCode = 1
})
