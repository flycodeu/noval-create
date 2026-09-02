const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P1-02')
const PROJECT_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
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
  const page = read('src/pages/Novel/Structure/index.tsx')
  const panels = read('src/pages/Novel/Structure/StructurePanels.tsx')
  const workspace = read('src/pages/Novel/Structure/useStructureWorkspace.ts')
  const helpers = read('src/pages/Novel/Structure/helpers.ts')
  const css = read('src/pages/Novel/Structure/index.css')
  const checks = [
    ['活动路由接入主从工作台', page.includes('data-structure-master-detail="active"') && page.includes('novel-structure-master-detail__rail')],
    ['章节与场景使用单一编辑器切换', page.includes("editorMode === 'chapter' ? (") && page.includes('data-structure-editor-mode={editorMode}')],
    ['窄屏层级导航使用 Drawer', page.includes('data-structure-navigator-trigger') && page.includes("narrowLayout ? 'drawer' : 'rail'")],
    ['联动、事件和检查点进入按需检查器', page.includes('data-structure-inspector="on-demand"') && page.includes('StructureLinkedEventsPanel') && page.includes('StructureCheckpointsPanel')],
    ['批量新增进入独立 Drawer', page.includes('novel-structure-drawer--batch') && page.includes('批量新增结构')],
    ['未保存切换与离开保护存在', page.includes('保存并继续') && page.includes('留在当前对象') && page.includes("addEventListener('beforeunload'")],
    ['AI 定向修改默认折叠', panels.includes('<details className="novel-structure-ai-disclosure">')],
    ['卷部章场景均保留层级操作', panels.includes('onStartRenameVolume') && panels.includes('onStartRenamePart') && panels.includes('onAddChapter') && panels.includes('onAddSegment')],
    ['分页契约保留', panels.includes('<Pagination') && helpers.includes('CHAPTER_PAGE_SIZE = 50') && helpers.includes('SEGMENT_PAGE_SIZE = 80')],
    ['拖拽排序协议保留', panels.includes('<DragDropContext') && workspace.includes('reorderVolumes') && workspace.includes('reorderPartsInVolume') && workspace.includes('reorderSegments')],
    ['结构深链参数保留', helpers.includes("params.set('volumeId'") && helpers.includes("params.set('segmentId'")],
    ['主区和导航均独立滚动', css.includes('.novel-structure-navigator__scroll') && css.includes('.novel-structure-editor-viewport') && css.includes('scrollbar-gutter: stable')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P1-02 静态契约失败：${failed.join('、')}`)
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
  const snapshotDir = path.resolve(runDir, '.database-snapshot')
  if (!snapshotDir.startsWith(path.resolve(runDir))) throw new Error('数据库快照目录越界。')
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

function buildStructureHash(projectId, selection = {}) {
  const params = new URLSearchParams()
  for (const key of ['volumeId', 'partId', 'chapterId', 'segmentId']) {
    if (selection[key]) params.set(key, String(selection[key]))
  }
  return `#/novels/${projectId}/structure${params.size ? `?${params}` : ''}`
}

async function navigate(page, projectId, selection = {}) {
  const hash = buildStructureHash(projectId, selection)
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(() => {
    const root = document.querySelector('.novel-structure-page')
    return Boolean(root?.querySelector('[data-structure-master-detail="active"]')) && !root?.querySelector('.ant-spin')
  }, null, { timeout: 20000 })
  await page.waitForTimeout(450)
  return hash
}

async function inspectDataset(page, projectId) {
  return page.evaluate(async (id) => {
    const [project, volumes, allChapters] = await Promise.all([
      window.electron.novel.get(id),
      window.electron.structure.listVolumes(id),
      window.electron.chapter.list(id),
    ])
    let selection = null
    let partCount = 0
    for (const volume of volumes) {
      const partPage = await window.electron.structure.listPartsPage(volume.id, 1, 200)
      partCount += partPage.total
      for (const part of partPage.items) {
        const chapterPage = await window.electron.structure.listChaptersPage(part.id, 1, 200)
        for (const chapter of chapterPage.items) {
          const segments = await window.electron.structure.listSegments(chapter.id)
          if (!selection && segments.length >= 2) {
            selection = {
              volumeId: volume.id,
              partId: part.id,
              chapterId: chapter.id,
              segmentId: segments[0].id,
              secondSegmentId: segments[1].id,
            }
          }
        }
      }
    }
    return {
      project,
      volumes,
      volumeCount: volumes.length,
      partCount,
      chapterCount: allChapters.length,
      selection,
    }
  }, projectId)
}

async function measure(page, viewport) {
  return page.evaluate(({ viewport }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector('.novel-structure-page')
    const master = workspace?.querySelector('[data-structure-master-detail]')
    const rail = workspace?.querySelector('.novel-structure-master-detail__rail')
    const detail = workspace?.querySelector('.novel-structure-master-detail__detail')
    const editorViewport = workspace?.querySelector('.novel-structure-editor-viewport')
    const navigatorTrigger = workspace?.querySelector('[data-structure-navigator-trigger]')
    const inspectorTrigger = workspace?.querySelector('[data-structure-inspector-trigger]')
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
    const panels = [...(workspace?.querySelectorAll('.novel-panel') || [])]
    const chapterEditor = panels.find((node) => node.querySelector('.novel-panel__title')?.textContent?.includes('章节编辑'))
    const segmentEditor = panels.find((node) => node.querySelector('.novel-panel__title')?.textContent?.includes('场景编辑'))
    const activeEditor = visible(chapterEditor) ? chapterEditor : visible(segmentEditor) ? segmentEditor : null
    const firstField = activeEditor?.querySelector('.ant-form-item')
    const heroButtons = [...(workspace?.querySelectorAll(':scope > .novel-hero .novel-hero__actions .ant-btn') || [])].filter(visible)
    const expectedMode = viewport.width <= 960 ? 'drawer' : 'rail'
    const masterRect = rect(master)
    const detailRect = rect(detail)
    const editorRect = rect(editorViewport)
    const firstFieldRect = rect(firstField)
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const simultaneousEditorCount = [chapterEditor, segmentEditor].filter(visible).length
    const reasons = []
    if (!visible(master)) reasons.push('主从工作台不可见')
    if (master?.getAttribute('data-structure-navigator-mode') !== expectedMode) reasons.push(`导航模式不是 ${expectedMode}`)
    if (heroButtons.length > 4) reasons.push(`顶部持续动作有 ${heroButtons.length} 个`)
    if (simultaneousEditorCount !== 1) reasons.push(`同时可见编辑器为 ${simultaneousEditorCount} 个`)
    if (!detailRect || detailRect.width < 520) reasons.push(`中央编辑器过窄：${Math.round(detailRect?.width || 0)}px`)
    if (!editorRect || editorRect.height < 200) reasons.push(`编辑器视口过矮：${Math.round(editorRect?.height || 0)}px`)
    if (!firstFieldRect || !editorRect || firstFieldRect.y >= editorRect.bottom) reasons.push('核心字段未进入首屏编辑视口')
    if (masterRect && masterRect.bottom > innerHeight + 8) reasons.push(`主工作台超出视口 ${Math.round(masterRect.bottom - innerHeight)}px`)
    if (expectedMode === 'rail' && !visible(rail)) reasons.push('桌面层级轨道不可见')
    if (expectedMode === 'rail' && visible(navigatorTrigger)) reasons.push('桌面不应显示层级抽屉入口')
    if (expectedMode === 'drawer' && visible(rail)) reasons.push('窄屏层级轨道未抽屉化')
    if (expectedMode === 'drawer' && !visible(navigatorTrigger)) reasons.push('窄屏层级抽屉入口不可见')
    if (!visible(inspectorTrigger)) reasons.push('结构检查器入口不可见')
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (master && master.scrollWidth > master.clientWidth + 1) reasons.push('主从工作台存在横向溢出')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      navigatorMode: master?.getAttribute('data-structure-navigator-mode') || '',
      topActionCount: heroButtons.length,
      simultaneousEditorCount,
      inspectorTriggerVisible: visible(inspectorTrigger),
      navigatorTriggerVisible: visible(navigatorTrigger),
      railVisible: visible(rail),
      master: masterRect,
      detail: detailRect,
      editorViewport: editorRect,
      firstField: firstFieldRect,
      saveState: workspace?.querySelector('[data-structure-save-state]')?.getAttribute('data-structure-save-state') || '',
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
    }
  }, { viewport })
}

async function captureScreenshot(page, filePath) {
  await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
}

async function verifyInspectorAndModes(page) {
  const trigger = page.locator('[data-structure-inspector-trigger]')
  await trigger.click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: '结构检查器' }).last()
  await drawer.waitFor({ state: 'visible', timeout: 5000 })
  const eventPanelVisible = await drawer.getByText('关联事件', { exact: true }).isVisible()
  const checkpointPanelVisible = await drawer.locator('.novel-panel__title').filter({ hasText: '检查点' }).isVisible()
  await drawer.locator('.ant-drawer-close').click()
  await drawer.waitFor({ state: 'hidden' })

  const mode = (label) => page.locator('.novel-structure-detail-bar .ant-segmented-item').filter({ hasText: label })
  await mode('场景').click()
  await page.waitForFunction(() => document.querySelector('[data-structure-editor-mode]')?.getAttribute('data-structure-editor-mode') === 'segment')
  const segmentMode = await page.evaluate(() => ({
    mode: document.querySelector('[data-structure-editor-mode]')?.getAttribute('data-structure-editor-mode'),
    chapterEditors: [...document.querySelectorAll('.novel-panel')].filter((node) => node.querySelector('.novel-panel__title')?.textContent?.includes('章节编辑')).length,
    segmentEditors: [...document.querySelectorAll('.novel-panel')].filter((node) => node.querySelector('.novel-panel__title')?.textContent?.includes('场景编辑')).length,
  }))
  await mode('章节').click()
  await page.waitForFunction(() => document.querySelector('[data-structure-editor-mode]')?.getAttribute('data-structure-editor-mode') === 'chapter')
  return {
    inspectorOpened: eventPanelVisible && checkpointPanelVisible,
    segmentModeSingleEditor: segmentMode.mode === 'segment' && segmentMode.chapterEditors === 0 && segmentMode.segmentEditors === 1,
  }
}

async function verifyDeepLinkAndRefresh(page, projectId, selection) {
  await navigate(page, projectId, selection)
  const before = await page.evaluate((expected) => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return Object.entries(expected).every(([key, value]) => key === 'secondSegmentId' || params.get(key) === String(value))
  }, selection)
  await page.reload()
  await page.waitForFunction(() => Boolean(document.querySelector('[data-structure-master-detail="active"]')) && !document.querySelector('.novel-structure-page .ant-spin'), null, { timeout: 20000 })
  await page.waitForTimeout(500)
  const after = await page.evaluate((expected) => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const paramsPreserved = Object.entries(expected).every(([key, value]) => key === 'secondSegmentId' || params.get(key) === String(value))
    return {
      paramsPreserved,
      activeVolume: document.querySelectorAll('.novel-structure-volume-card.is-active').length,
      activePart: document.querySelectorAll('.novel-structure-part-card.is-active').length,
      activeChapter: document.querySelectorAll('.novel-structure-chapter-card.is-active').length,
      activeSegment: document.querySelectorAll('.novel-structure-scene-card.is-active').length,
    }
  }, selection)
  return {
    deepLinkPreserved: before,
    refreshSelectionRestored: after.paramsPreserved && after.activeVolume === 1 && after.activePart === 1 && after.activeChapter === 1 && after.activeSegment === 1,
    after,
  }
}

async function verifyUnsavedLifecycle(page, projectId, selection, marker) {
  await navigate(page, projectId, selection)
  const original = await page.evaluate((id) => window.electron.chapter.get(id), selection.chapterId)
  const titleInput = page.getByLabel('章节标题').first()
  await titleInput.fill(`${original.title || '未命名章节'}-${marker}`)
  await page.waitForFunction(() => document.querySelector('[data-structure-save-state]')?.getAttribute('data-structure-save-state') === 'unsaved')
  const beforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  const segmentMode = page.locator('.novel-structure-detail-bar .ant-segmented-item').filter({ hasText: '场景' })
  await segmentMode.click()
  const guard = page.locator('.ant-modal-confirm').filter({ hasText: '还有未保存修改' })
  await guard.waitFor({ state: 'visible', timeout: 5000 })
  const guardVisible = await guard.isVisible()
  await guard.getByRole('button', { name: '留在当前对象' }).click()
  await guard.waitFor({ state: 'hidden' })
  const cancelStayed = await page.locator('[data-structure-editor-mode="chapter"]').isVisible()

  await segmentMode.click()
  await guard.waitFor({ state: 'visible', timeout: 5000 })
  await guard.getByRole('button', { name: '保存并继续' }).click()
  await page.waitForFunction(() => document.querySelector('[data-structure-editor-mode]')?.getAttribute('data-structure-editor-mode') === 'segment', null, { timeout: 20000 })
  const persisted = await page.evaluate((id) => window.electron.chapter.get(id), selection.chapterId)
  return {
    unsavedStateVisible: true,
    beforeUnloadGuardActive: beforeUnload,
    switchGuardVisible: guardVisible,
    cancelStayedOnObject: cancelStayed,
    saveAndSwitchSucceeded: String(persisted?.title || '').includes(marker),
    originalChapterTitle: original.title || '',
  }
}

function navigatorPanel(page, level) {
  const index = { volume: 0, part: 1, chapter: 2, segment: 3 }[level]
  return page.locator('.novel-structure-master-detail__rail .novel-structure-navigator__scroll > .novel-panel').nth(index)
}

async function verifyCrudPaginationCompileAndDrag(page, projectId, originalVolumes, marker) {
  await navigate(page, projectId)
  const root = page.locator('.novel-structure-page:visible').last()
  const originalIds = originalVolumes.map((item) => item.id)
  const chapterMode = page.locator('.novel-structure-detail-bar .ant-segmented-item').filter({ hasText: '章节' })
  if (await chapterMode.count()) await chapterMode.click().catch(() => undefined)

  await root.locator('.novel-structure-page__top-actions .ant-btn').filter({ hasText: '新建卷' }).click()
  await page.waitForFunction(async ({ novelId, count }) => (await window.electron.structure.listVolumes(novelId)).length === count + 1, { novelId: projectId, count: originalVolumes.length })
  const newVolume = await page.evaluate(async ({ novelId, originalIds }) => {
    const rows = await window.electron.structure.listVolumes(novelId)
    return rows.find((item) => !originalIds.includes(item.id))
  }, { novelId: projectId, originalIds })
  if (!newVolume) throw new Error('新建卷后找不到新增数据。')

  let activeVolume = page.locator('.novel-structure-volume-card.is-active')
  await activeVolume.locator('button[aria-label^="重命名"]').click()
  await activeVolume.locator('.novel-structure-inline-editor input').fill(`P1-02卷-${marker}`)
  await activeVolume.locator('.novel-structure-inline-editor .ant-btn-primary').click()
  await page.waitForFunction(async ({ novelId, marker }) => (await window.electron.structure.listVolumes(novelId)).some((item) => item.title?.includes(marker)), { novelId: projectId, marker })
  activeVolume = page.locator('.novel-structure-volume-card.is-active')
  await activeVolume.locator('button[aria-label*="新增一部"]').click()
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split('?')[1] || '').has('partId'))
  const partId = await page.evaluate(() => Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('partId')))

  let activePart = page.locator('.novel-structure-part-card.is-active')
  await activePart.locator('button[aria-label^="重命名"]').click()
  await activePart.locator('.novel-structure-inline-editor input').fill(`P1-02部-${marker}`)
  await activePart.locator('.novel-structure-inline-editor .ant-btn-primary').click()
  await page.waitForFunction(async ({ volumeId, marker }) => (await window.electron.structure.listPartsPage(volumeId, 1, 200)).items.some((item) => item.title?.includes(marker)), { volumeId: newVolume.id, marker })

  const chaptersPanel = navigatorPanel(page, 'chapter')
  await chaptersPanel.scrollIntoViewIfNeeded()
  await chaptersPanel.locator('.novel-panel__extra .ant-btn').first().click()
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split('?')[1] || '').has('chapterId'))
  const chapterId = await page.evaluate(() => Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('chapterId')))

  await page.evaluate(async ({ novelId, volumeId, partId, marker }) => {
    for (let index = 1; index <= 50; index += 1) {
      await window.electron.chapter.create(novelId, {
        title: `P1-02分页章${String(index).padStart(2, '0')}-${marker}`,
        status: 'outline',
        volumeId,
        partId,
      })
    }
  }, { novelId: projectId, volumeId: newVolume.id, partId, marker })
  await navigate(page, projectId, { volumeId: newVolume.id, partId, chapterId })
  const pagedChaptersPanel = navigatorPanel(page, 'chapter')
  await pagedChaptersPanel.scrollIntoViewIfNeeded()
  const paginationVisible = await pagedChaptersPanel.locator('.ant-pagination-item-2').isVisible()
  if (paginationVisible) {
    await pagedChaptersPanel.locator('.ant-pagination-item-2').click()
    await page.waitForTimeout(500)
  }
  const pageTwoLoaded = paginationVisible && (await pagedChaptersPanel.getByText(new RegExp(`P1-02分页章50-${marker}`)).count()) > 0

  await navigate(page, projectId, { volumeId: newVolume.id, partId, chapterId })
  let segmentsPanel = navigatorPanel(page, 'segment')
  await segmentsPanel.scrollIntoViewIfNeeded()
  await segmentsPanel.locator('.novel-panel__extra .ant-btn').first().click()
  await page.waitForTimeout(400)
  segmentsPanel = navigatorPanel(page, 'segment')
  await segmentsPanel.scrollIntoViewIfNeeded()
  await segmentsPanel.locator('.novel-panel__extra .ant-btn').first().click()
  await page.waitForFunction(async (id) => (await window.electron.structure.listSegments(id)).length >= 2, chapterId)
  const segments = await page.evaluate((id) => window.electron.structure.listSegments(id), chapterId)
  await page.evaluate(async ({ segments, marker }) => {
    await window.electron.structure.updateSegment(segments[0].id, { title: `编译场景A-${marker}`, content: `编译正文A-${marker}` })
    await window.electron.structure.updateSegment(segments[1].id, { title: `编译场景B-${marker}`, content: `编译正文B-${marker}` })
  }, { segments, marker })
  await navigate(page, projectId, { volumeId: newVolume.id, partId, chapterId, segmentId: segments[0].id })
  const structureActions = root.locator('.novel-structure-page__top-actions')
  const moreButton = structureActions.locator('.ant-dropdown-trigger').last()
  await moreButton.waitFor({ state: 'visible', timeout: 8000 })
  await moreButton.click()
  const compileMenuItem = page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')
    .filter({ hasText: '编译当前章节' })
    .last()
  await compileMenuItem.waitFor({ state: 'visible', timeout: 8000 })
  await compileMenuItem.click()
  await page.waitForFunction(async ({ chapterId, marker }) => String((await window.electron.chapter.get(chapterId))?.content || '').includes(marker), { chapterId, marker })
  const compiled = await page.evaluate(async ({ chapterId, marker }) => String((await window.electron.chapter.get(chapterId))?.content || '').includes(marker), { chapterId, marker })

  const volumePanel = navigatorPanel(page, 'volume')
  await volumePanel.scrollIntoViewIfNeeded()
  activeVolume = page.locator('.novel-structure-volume-card.is-active')
  const dragHandle = activeVolume.locator('.novel-structure-drag-handle')
  const dragHandleVisible = await dragHandle.isVisible()
  const orderBeforeDrag = await page.evaluate((novelId) => window.electron.structure.listVolumes(novelId), projectId)
  if (dragHandleVisible) {
    await dragHandle.press('Space')
    await page.waitForTimeout(180)
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(220)
    await page.keyboard.press('Space')
    await page.waitForTimeout(900)
  }
  let orderAfterDrag = await page.evaluate((novelId) => window.electron.structure.listVolumes(novelId), projectId)
  let reordered = orderAfterDrag.findIndex((item) => item.id === newVolume.id) < orderBeforeDrag.findIndex((item) => item.id === newVolume.id)
  if (dragHandleVisible && !reordered) {
    const cards = volumePanel.locator('.novel-structure-volume-card')
    const sourceIndex = await cards.count() - 1
    await cards.nth(sourceIndex).locator('.novel-structure-drag-handle').dragTo(cards.nth(Math.max(0, sourceIndex - 1)), { force: true }).catch(() => undefined)
    await page.waitForTimeout(900)
    orderAfterDrag = await page.evaluate((novelId) => window.electron.structure.listVolumes(novelId), projectId)
    reordered = orderAfterDrag.findIndex((item) => item.id === newVolume.id) < orderBeforeDrag.findIndex((item) => item.id === newVolume.id)
  }
  if (dragHandleVisible && !reordered) {
    const cards = volumePanel.locator('.novel-structure-volume-card')
    const sourceIndex = await cards.count() - 1
    const sourceBox = await cards.nth(sourceIndex).locator('.novel-structure-drag-handle').boundingBox()
    const targetBox = await cards.nth(Math.max(0, sourceIndex - 1)).boundingBox()
    if (sourceBox && targetBox) {
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(220)
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 3, { steps: 18 })
      await page.waitForTimeout(420)
      await page.mouse.up()
      await page.waitForTimeout(900)
      orderAfterDrag = await page.evaluate((novelId) => window.electron.structure.listVolumes(novelId), projectId)
      reordered = orderAfterDrag.findIndex((item) => item.id === newVolume.id) < orderBeforeDrag.findIndex((item) => item.id === newVolume.id)
    }
  }

  activeVolume = page.locator('.novel-structure-volume-card.is-active')
  await activeVolume.locator('button[aria-label^="删除"]').click()
  let confirm = page.locator('.ant-modal-confirm:visible').last()
  await confirm.waitFor({ state: 'visible', timeout: 5000 })
  const deleteConfirmationVisible = await confirm.isVisible()
  await confirm.locator('.ant-modal-confirm-btns .ant-btn').first().click()
  await confirm.waitFor({ state: 'hidden' })
  await activeVolume.locator('button[aria-label^="删除"]').click()
  confirm = page.locator('.ant-modal-confirm:visible').last()
  await confirm.waitFor({ state: 'visible', timeout: 5000 })
  await confirm.locator('.ant-modal-confirm-btns .ant-btn').last().click()
  await page.waitForFunction(async ({ novelId, volumeId }) => !(await window.electron.structure.listVolumes(novelId)).some((item) => item.id === volumeId), { novelId: projectId, volumeId: newVolume.id })

  return {
    volumeCreated: Boolean(newVolume.id),
    volumeRenamed: true,
    partCreatedAndRenamed: Boolean(partId),
    chapterCreated: Boolean(chapterId),
    segmentsCreated: segments.length >= 2,
    paginationVisible,
    pageTwoLoaded,
    compileSucceeded: compiled,
    dragHandleVisible,
    dragReorderPersisted: reordered,
    deleteConfirmationVisible,
    volumeDeleted: true,
  }
}

function buildReport({ runId, dataset, metrics, staticContracts, interactions, dataRestored }) {
  const lines = [
    '# P1-02 卷章结构主从工作台（改后）',
    '',
    `- 运行编号：\`${runId}\``,
    `- Electron 项目：ID ${dataset.project.id}「${dataset.project.title}」`,
    `- 真实数据：${dataset.volumeCount} 卷、${dataset.partCount} 部、${dataset.chapterCount} 章。`,
    '- 验收策略：真实 Electron production build；写操作前快照数据库，验收后恢复并复核。',
    '',
    '| 视口 | 结果 | 顶部动作 | 导航 | 同时编辑器 | 中央宽度 | 编辑视口高度 | 核心字段首屏 | client/scroll | 截图 |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |',
  ]
  for (const [size, metric] of Object.entries(metrics)) {
    const result = metric.status === 'PASS' ? 'PASS' : `BLOCKED：${metric.reasons.join('；')}`
    lines.push(`| ${size} | ${result} | ${metric.topActionCount} | ${metric.navigatorMode} | ${metric.simultaneousEditorCount} | ${Math.round(metric.detail?.width || 0)}px | ${Math.round(metric.editorViewport?.height || 0)}px | ${metric.firstField && metric.editorViewport && metric.firstField.y < metric.editorViewport.bottom ? '是' : '否'} | ${metric.clientWidth}/${metric.scrollWidth} | [截图](runs/${runId}/screenshots/structure-${size}.png) |`)
  }
  lines.push(
    '',
    '## 交互验收',
    '',
    `- 静态保护契约：${staticContracts.length} 项 PASS。`,
    `- 检查器含关联事件与检查点：${interactions.inspectorOpened ? 'PASS' : 'BLOCKED'}`,
    `- 章节/场景切换且仅一个编辑器：${interactions.segmentModeSingleEditor ? 'PASS' : 'BLOCKED'}`,
    `- 四级深链参数：${interactions.deepLinkPreserved ? 'PASS' : 'BLOCKED'}`,
    `- 刷新后卷/部/章/场景选择恢复：${interactions.refreshSelectionRestored ? 'PASS' : 'BLOCKED'}`,
    `- 未保存状态、beforeunload、取消切换、保存并切换：${interactions.unsavedLifecycle ? 'PASS' : 'BLOCKED'}`,
    `- 新建卷、部、章、场景与卷/部重命名：${interactions.crudCreateRename ? 'PASS' : 'BLOCKED'}`,
    `- 51 章真实分页与第 2 页加载：${interactions.pagination ? 'PASS' : 'BLOCKED'}`,
    `- 场景编译为章节正文：${interactions.compile ? 'PASS' : 'BLOCKED'}`,
    `- 拖拽卷排序并持久化：${interactions.drag ? 'PASS' : 'BLOCKED'}`,
    `- 删除二次确认与删除执行：${interactions.delete ? 'PASS' : 'BLOCKED'}`,
    `- 验收数据库恢复：${dataRestored ? 'PASS' : 'BLOCKED'}`,
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
    await page.waitForTimeout(2200)
    const dataset = await inspectDataset(page, projectId)
    if (dataset.volumeCount < 5 || dataset.chapterCount < 120) {
      throw new Error(`项目密度不足：${dataset.volumeCount} 卷、${dataset.chapterCount} 章；P1-02 要求真实多卷 / 120 章数据。`)
    }
    if (!dataset.selection) throw new Error('找不到含至少两个场景的章节，无法完成四级主从验收。')

    const metrics = {}
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      await navigate(page, projectId, dataset.selection)
      const size = `${viewport.width}x${viewport.height}`
      metrics[size] = await measure(page, viewport)
      await captureScreenshot(page, path.join(screenshotsDir, `structure-${size}.png`))
    }

    await setViewport(app, page, { width: 1280, height: 800 })
    await navigate(page, projectId, dataset.selection)
    const inspectorAndModes = await verifyInspectorAndModes(page)
    const deepLink = await verifyDeepLinkAndRefresh(page, projectId, dataset.selection)
    const marker = `P1-02-${Date.now()}`
    const unsaved = await verifyUnsavedLifecycle(page, projectId, dataset.selection, marker)
    const crud = await verifyCrudPaginationCompileAndDrag(page, projectId, dataset.volumes, marker)
    await app.close()
    app = null

    restoreAcceptanceDatabase(databaseSnapshot)
    databaseRestored = true
    const verificationApp = await launchProductionApp()
    let dataRestored = false
    try {
      const verificationPage = await verificationApp.firstWindow()
      await verificationPage.waitForLoadState('domcontentloaded')
      const restored = await verificationPage.evaluate(async ({ novelId, chapterId, originalTitle, originalIds, marker }) => {
        const [volumes, chapter] = await Promise.all([
          window.electron.structure.listVolumes(novelId),
          window.electron.chapter.get(chapterId),
        ])
        const chapters = await window.electron.chapter.list(novelId)
        return {
          volumeIds: volumes.map((item) => item.id),
          chapterTitle: chapter?.title || '',
          markerHits: chapters.filter((item) => String(item.title || '').includes(marker)).length,
          expectedVolumeIds: originalIds,
          expectedChapterTitle: originalTitle,
        }
      }, {
        novelId: projectId,
        chapterId: dataset.selection.chapterId,
        originalTitle: unsaved.originalChapterTitle,
        originalIds: dataset.volumes.map((item) => item.id),
        marker,
      })
      dataRestored = JSON.stringify(restored.volumeIds) === JSON.stringify(restored.expectedVolumeIds)
        && restored.chapterTitle === restored.expectedChapterTitle
        && restored.markerHits === 0
    } finally {
      await verificationApp.close().catch(() => undefined)
    }

    const interactions = {
      ...inspectorAndModes,
      ...deepLink,
      ...unsaved,
      ...crud,
      unsavedLifecycle: unsaved.unsavedStateVisible
        && unsaved.beforeUnloadGuardActive
        && unsaved.switchGuardVisible
        && unsaved.cancelStayedOnObject
        && unsaved.saveAndSwitchSucceeded,
      crudCreateRename: crud.volumeCreated
        && crud.volumeRenamed
        && crud.partCreatedAndRenamed
        && crud.chapterCreated
        && crud.segmentsCreated,
      pagination: crud.paginationVisible && crud.pageTwoLoaded,
      compile: crud.compileSucceeded,
      drag: crud.dragHandleVisible && crud.dragReorderPersisted,
      delete: crud.deleteConfirmationVisible && crud.volumeDeleted,
    }
    const gates = {
      ...Object.fromEntries(Object.entries(metrics).map(([size, item]) => [`viewport:${size}`, item.status === 'PASS'])),
      inspector: interactions.inspectorOpened,
      editorSwitch: interactions.segmentModeSingleEditor,
      deepLink: interactions.deepLinkPreserved,
      refreshSelection: interactions.refreshSelectionRestored,
      unsavedLifecycle: interactions.unsavedLifecycle,
      crudCreateRename: interactions.crudCreateRename,
      pagination: interactions.pagination,
      compile: interactions.compile,
      drag: interactions.drag,
      delete: interactions.delete,
      dataRestored,
    }
    const failedGates = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name)
    const summary = {
      runId,
      capturedAt: new Date().toISOString(),
      project: { id: dataset.project.id, title: dataset.project.title },
      volumeCount: dataset.volumeCount,
      partCount: dataset.partCount,
      chapterCount: dataset.chapterCount,
      viewportCount: VIEWPORTS.length,
      passCount: VIEWPORTS.filter((viewport) => metrics[`${viewport.width}x${viewport.height}`].status === 'PASS').length,
      blockedCount: VIEWPORTS.filter((viewport) => metrics[`${viewport.width}x${viewport.height}`].status !== 'PASS').length,
      staticContractCount: staticContracts.length,
      failedGates,
      dataRestored,
      runtime: 'Electron production build',
    }
    const report = buildReport({ runId, dataset, metrics, staticContracts, interactions, dataRestored })
    writeJson(path.join(runDir, 'metrics.json'), metrics)
    writeJson(path.join(runDir, 'interactions.json'), { interactions, gates })
    writeJson(path.join(runDir, 'capture-summary.json'), summary)
    fs.writeFileSync(path.join(runDir, 'after.md'), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, runDirectory: `runs/${runId}`, capturedAt: summary.capturedAt })
    writeJson(path.join(EVIDENCE_ROOT, 'after-capture-summary.json'), summary)
    writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), { interactions, gates })
    writeJson(path.join(EVIDENCE_ROOT, 'after-metrics.json'), metrics)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, 'after.md'), report, 'utf8')
    console.log(`[P1-02] ${summary.passCount} PASS / ${summary.blockedCount} BLOCKED; gates ${failedGates.length ? `BLOCKED: ${failedGates.join(', ')}` : 'PASS'}`)
    if (failedGates.length) throw new Error(`P1-02 门禁失败：${failedGates.join('、')}`)
  } finally {
    if (app) await app.close().catch(() => undefined)
    if (!databaseRestored) restoreAcceptanceDatabase(databaseSnapshot)
  }
}

main().catch((error) => {
  console.error('[P1-02] FAILED', error)
  process.exitCode = 1
})
