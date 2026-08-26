const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-09'))
const PHASE = process.argv.includes('--before') ? 'before' : 'after'
const PREPARE_DENSITY = process.argv.includes('--prepare')
const PROJECT_ID = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 271)
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]
const DENSITY_TARGET = 120
const ROUTES = [
  { key: 'timeline', route: 'timeline', root: '.novel-timeline-page', beforeRoot: '.novel-timeline-page', label: '事件时间轴' },
  { key: 'contracts', route: 'contracts', root: '.novel-contracts-page', beforeRoot: '.novel-workspace', label: '章节合同' },
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

function assertStaticContracts() {
  const timeline = read('src/pages/Novel/Timeline/index.tsx')
  const timelinePanels = read('src/pages/Novel/Timeline/TimelinePanels.tsx')
  const timelineHook = read('src/pages/Novel/Timeline/useTimelineWorkspace.ts')
  const timelineCss = read('src/pages/Novel/Timeline/index.css')
  const contracts = read('src/pages/Novel/Contracts/index.tsx')
  const contractsCss = read('src/pages/Novel/Contracts/index.css')
  const checks = [
    ['时间轴不再渲染重复状态泳道', !timeline.includes('TimelineBoardPanel')],
    ['时间轴采用列表与单一详情工作区', timeline.includes('data-timeline-workspace') && timelinePanels.includes('data-timeline-event-list') && timelinePanels.includes('data-timeline-event-detail')],
    ['时间轴关键词接入服务端查询', timelinePanels.includes('搜索时间轴事件') && timelineHook.includes('keyword: keyword.trim()')],
    ['时间轴大数据使用虚拟列表和分页', timelinePanels.includes('VirtualList') && timelinePanels.includes('data-timeline-pagination')],
    ['时间轴局部工作区具备响应式有界布局', timelineCss.includes('.novel-timeline-page__workspace') && timelineCss.includes('max-width: 920px')],
    ['合同页采用章节导航与当前详情', contracts.includes('data-contract-workspace') && contracts.includes('data-contract-chapter-list') && contracts.includes('data-contract-current-detail')],
    ['合同页场景作为子导航且只渲染当前场景', contracts.includes('data-contract-scene-list') && contracts.includes('sceneContracts.filter((scene) => getSceneKey(scene) === activeSceneKey)')],
    ['合同页支持章节/场景切换', contracts.includes('data-contract-tabs') && contracts.includes('data-contract-tab="chapter"') && contracts.includes('data-contract-tab="scene"')],
    ['合同页保存状态和未保存切换保护可见', contracts.includes('data-contract-save-state') && contracts.includes('切换章节并放弃未保存合同')],
    ['合同页章节导航使用虚拟列表和有界滚动', contracts.includes('VirtualList') && contractsCss.includes('overflow-y: auto')],
    ['合同页正文跳转保留章节上下文', contracts.includes('writing?chapterId=${activeChapterId}')],
    ['合同页场景路由可恢复', contracts.includes('sceneId') && contracts.includes('setActiveSceneKey')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-09 静态契约失败：${failed.join('、')}`)
  return checks.map(([label]) => label)
}

async function launchProductionApp() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(REPO_ROOT, 'out/main/main.js'), '--no-sandbox', '--disable-gpu'],
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

async function setViewport(page, viewport) {
  await page.setViewportSize(viewport)
  // `page.setViewportSize` is the stable renderer-level viewport contract for
  // Electron. Resizing BrowserWindow through a second main-process RPC makes
  // Playwright intermittently lose the Electron evaluate promise while the
  // renderer is busy with the dense fixture; it does not improve the layout
  // measurement and makes the acceptance run nondeterministic.
  await page.waitForTimeout(260)
}

async function navigate(page, projectId, route) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}`, storageKey: VIEW_MODE_STORAGE_KEY })
  try {
    await page.waitForFunction(({ selector, routeKey, phase }) => {
      const root = document.querySelector(selector)
      if (!root || root.querySelector('.ant-spin')) return false
      if (phase === 'before') return Boolean(root.querySelector('.novel-panel') || root.querySelector('.ant-select'))
      if (routeKey === 'timeline') return Boolean(root.querySelector('[data-timeline-workspace]'))
      return Boolean(root.querySelector('[data-contract-workspace]'))
    }, { selector: PHASE === 'before' ? route.beforeRoot : route.root, routeKey: route.key, phase: PHASE }, { timeout: 20000 })
  } catch (error) {
    console.error(`[P2-09] route wait failed: ${route.key} ${PHASE}`)
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 4000))
    throw error
  }
  await page.waitForTimeout(420)
}

async function seedDensity(page, novelId) {
  const marker = `P2-09-${Date.now()}`
  return page.evaluate(async ({ novelId, marker, densityTarget }) => {
    const novel = await window.electron.novel.get(novelId)
    if (!novel) throw new Error('P2-09 找不到验收项目。')
    if (novelId !== 271 && novel.title !== '神账局：我给万神讨薪') {
      throw new Error('P2-09 密度准备只允许使用 NovelForge 专用验收项目。')
    }

    const chapters = (await window.electron.chapter.list(novelId)).sort((left, right) => left.chapterNum - right.chapterNum)
    if (chapters.length < 2) throw new Error('P2-09 至少需要两个章节才能验收合同导航。')

    const targetChapters = chapters.slice(0, Math.min(3, chapters.length))
    const preparedScenes = []
    for (const chapter of targetChapters) {
      let segments = await window.electron.structure.listSegments(chapter.id)
      while (segments.length < 2) {
        await window.electron.structure.createSegment(chapter.id, {
          title: `${marker}-场景-${chapter.chapterNum}-${segments.length + 1}`,
          segmentType: 'scene',
          purpose: `${marker} 用于验证场景合同单一详情切换。`,
          timeAnchor: `第${chapter.chapterNum}章 · 场景${segments.length + 1}`,
          summary: `${marker} 场景目标。`,
          status: 'planned',
        })
        segments = await window.electron.structure.listSegments(chapter.id)
      }
      const sceneRows = segments.slice(0, 2)
      for (const [index, segment] of sceneRows.entries()) {
        await window.electron.contract.upsertScene(chapter.id, segment.id, {
          pov: `${marker} POV-${chapter.chapterNum}-${index + 1}`,
          timeLocation: `${marker} · 第${chapter.chapterNum}章 · 场景${index + 1}`,
          sceneGoal: `${marker} 场景目标-${chapter.chapterNum}-${index + 1}`,
          obstacle: `${marker} 场景障碍-${index + 1}`,
          conflictType: index % 2 === 0 ? '信息博弈' : '外部对撞',
          emotionShift: '警觉 -> 失衡 -> 继续推进',
          revealPayload: [`${marker} 揭示-${index + 1}`],
          resultState: `${marker} 场景结果-${index + 1}`,
          linkageMode: '悬念续接',
          status: 'ready',
        })
      }
      preparedScenes.push({ chapterId: chapter.id, sceneIds: sceneRows.map((segment) => segment.id) })
      await window.electron.contract.upsertChapter(chapter.id, {
        chapterGoal: `${marker} 章节目标-${chapter.chapterNum}`,
        openingStyle: 'incident',
        endingStyle: 'hook',
        expositionMode: 'embedded_action',
        emotionFocus: '压抑警觉',
        requiredArcProgress: [`${marker} 弧线推进-${chapter.chapterNum}`],
        requiredResistanceActions: [`${marker} 阻力动作-${chapter.chapterNum}`],
        requiredAssetRefs: [`${marker} 资产-${chapter.chapterNum}`],
        forbiddenActions: [`${marker} 禁止提前揭露`],
        acceptanceNotes: [`${marker} 验收条件`],
        status: 'ready',
      })
    }

    const existing = await window.electron.timeline.search(novelId, marker, 50)
    const statuses = ['planned', 'seeded', 'written', 'resolved']
    const start = existing.length
    for (let index = start; index < densityTarget; index += 1) {
      const chapter = targetChapters[index % targetChapters.length]
      await window.electron.timeline.create(novelId, {
        eventTitle: `${marker}-事件-${String(index + 1).padStart(3, '0')}`,
        eventSummary: `${marker} 密集事件用于验证关键词定位、虚拟滚动和当前详情切换。`,
        timeMode: 'custom-era',
        timeLabel: `${marker} · 第${index + 1}日`,
        timeSortValue: 700000 + index,
        timePrecision: '日',
        isMajorEvent: index % 9 === 0 ? 1 : 0,
        eventType: index % 3 === 0 ? '冲突' : index % 3 === 1 ? '线索' : '转折',
        chapterStartId: chapter.id,
        chapterEndId: chapter.id,
        protagonistPresent: 1,
        protagonistAction: `${marker} 主角动作-${index + 1}`,
        eventCause: `${marker} 起因-${index + 1}`,
        eventProcess: `${marker} 过程-${index + 1}`,
        eventResult: `${marker} 结果-${index + 1}`,
        directConsequencesJson: JSON.stringify([`${marker} 后果-${index + 1}`]),
        openThreadsJson: index % 4 === 0 ? JSON.stringify([`${marker} 待回收-${index + 1}`]) : '[]',
        status: statuses[index % statuses.length],
      })
    }

    return {
      marker,
      timelineEvents: Math.max(existing.length, densityTarget),
      chapters: targetChapters.map((chapter) => ({ id: chapter.id, chapterNum: chapter.chapterNum })),
      firstChapterId: targetChapters[0].id,
      secondChapterId: targetChapters[1].id,
      scenes: preparedScenes,
    }
  }, { novelId, marker, densityTarget: DENSITY_TARGET })
}

function visible(node) {
  if (!node) return false
  const style = getComputedStyle(node)
  const box = node.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, routeKey, viewport, before }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector(selector)
    const isVisible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const list = routeKey === 'timeline'
      ? workspace?.querySelector(before ? '.novel-list-card' : '[data-timeline-event-list]')
      : workspace?.querySelector(before ? '.novel-contracts-page__chapter-select' : '[data-contract-chapter-list]')
    const detail = routeKey === 'timeline'
      ? workspace?.querySelector(before ? '.novel-panel:nth-of-type(2)' : '[data-timeline-event-detail]')
      : workspace?.querySelector(before ? '.novel-panel:nth-of-type(2)' : '[data-contract-current-detail]')
    const listRows = routeKey === 'timeline'
      ? workspace?.querySelectorAll(before ? '.novel-list-card' : '[data-timeline-event-list] [data-timeline-event-id]')
      : workspace?.querySelectorAll(before ? '.novel-contracts-page__scene-card' : '[data-contract-chapter-list] [data-contract-chapter-id]')
    const disclosures = workspace ? [...workspace.querySelectorAll('details')] : []
    const bounded = [list, ...disclosures, ...[...workspace?.querySelectorAll('.rc-virtual-list-holder') || []]].filter(Boolean)
    const rootWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (!isVisible(list)) reasons.push('导航列表不可见')
    if (!isVisible(detail)) reasons.push('当前详情不可见')
    if (rootWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (viewport.width <= 1024 && workspace && workspace.getBoundingClientRect().width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      actionCount: [...document.querySelectorAll('.novel-hero__actions .ant-btn, .workspace-contract-actions .ant-btn')].filter(isVisible).length,
      listRowCount: [...(listRows || [])].filter(isVisible).length,
      disclosureCount: disclosures.length,
      boundedScrollCount: bounded.length,
      boundedOverflowCount: bounded.filter((node) => node.scrollHeight > node.clientHeight + 1).length,
      clientWidth: root.clientWidth,
      scrollWidth: rootWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: PHASE === 'before' ? route.beforeRoot : route.root, routeKey: route.key, viewport, before: PHASE === 'before' })
}

async function verifyTimelineInteractions(page, projectId, density) {
  const result = {}
  await navigate(page, projectId, ROUTES[0])
  const root = page.locator('.novel-timeline-page')
  const keyword = root.locator('[aria-label="搜索时间轴事件"]')
  await keyword.fill(`${density.marker}-事件-042`)
  const target = root.locator('[data-timeline-event-list] [data-timeline-event-id]').filter({ hasText: `${density.marker}-事件-042` }).first()
  await target.waitFor({ state: 'visible', timeout: 12000 })
  result.timelineDenseLocate = (await root.locator('[data-timeline-event-list] [data-timeline-event-id]').count()) >= 1
  await target.click()
  const eventId = Number(await target.getAttribute('data-timeline-event-id'))
  result.timelineSelection = await root.locator(`[data-timeline-event-id="${eventId}"]`).getAttribute('aria-current') === 'true'
  result.timelineSingleDetail = await root.locator('[data-timeline-event-detail]').count() === 1
  const summary = root.locator('[data-timeline-event-detail]').getByLabel('事件摘要', { exact: true })
  await summary.fill(`${density.marker}-事件-042-已编辑`)
  // Ant Design exposes the icon's aria-label as part of the button's accessible
  // name (for example, "save 保存"). Match the visible action text so the
  // acceptance check remains stable without requiring a UI-only aria-label.
  await root.locator('[data-timeline-event-detail]').getByRole('button', { name: /保存/ }).click()
  await page.waitForFunction(async ({ eventId, expected }) => (await window.electron.timeline.get(eventId))?.eventSummary === expected, { eventId, expected: `${density.marker}-事件-042-已编辑` }, { timeout: 12000 })
  result.timelineSaved = true
  await root.locator('[data-timeline-event-detail]').getByRole('button', { name: /跳到结构页/ }).click()
  await page.waitForFunction(() => window.location.hash.includes('/structure'), null, { timeout: 12000 })
  result.timelineStructureJump = true

  await navigate(page, projectId, ROUTES[0])
  await keyword.fill(`${density.marker}-事件-120`)
  const deletable = root.locator('[data-timeline-event-list] [data-timeline-event-id]').filter({ hasText: `${density.marker}-事件-120` }).first()
  await deletable.waitFor({ state: 'visible', timeout: 12000 })
  const deletableId = Number(await deletable.getAttribute('data-timeline-event-id'))
  await deletable.click()
  await root.locator('[data-timeline-event-detail]').getByRole('button', { name: /删除/ }).click()
  const deleteDialog = page.locator('.ant-modal-confirm:visible').filter({ hasText: '删除「' }).last()
  await deleteDialog.waitFor({ state: 'visible', timeout: 8000 })
  await deleteDialog.locator('button.ant-btn-dangerous').click()
  await page.waitForFunction(async ({ eventId }) => (await window.electron.timeline.get(eventId)) == null, { eventId: deletableId }, { timeout: 12000 })
  result.timelineDeleteConfirmed = true
  return result
}

async function verifyContractInteractions(page, projectId, density) {
  const result = {}
  await navigate(page, projectId, ROUTES[1])
  const root = page.locator('.novel-contracts-page')
  const chapterRows = root.locator('[data-contract-chapter-list] [data-contract-chapter-id]')
  await chapterRows.first().waitFor({ state: 'visible', timeout: 12000 })
  result.contractChapterDensity = await chapterRows.count() >= 2
  const secondChapter = chapterRows.nth(1)
  const secondChapterId = Number(await secondChapter.getAttribute('data-contract-chapter-id'))
  await secondChapter.click()
  await page.waitForFunction(({ id }) => document.querySelector(`[data-contract-chapter-id="${id}"]`)?.getAttribute('aria-selected') === 'true', { id: secondChapterId }, { timeout: 12000 })
  result.contractChapterSelection = true
  const scenes = root.locator('[data-contract-scene-list] [data-contract-scene-id]')
  await scenes.nth(1).waitFor({ state: 'visible', timeout: 12000 })
  result.contractSceneDensity = await scenes.count() >= 2
  const secondScene = scenes.nth(1)
  const sceneId = await secondScene.getAttribute('data-contract-scene-id')
  await secondScene.click()
  await page.waitForFunction(() => document.querySelector('[data-contract-tab="scene"]')?.getAttribute('aria-selected') === 'true', null, { timeout: 12000 })
  result.contractSceneSwitch = true
  result.contractChapterRoute = await page.evaluate(({ chapterId }) => window.location.hash.includes(`chapterId=${chapterId}`), { chapterId: secondChapterId })
  result.contractSceneRoute = await page.evaluate(({ sceneId }) => window.location.hash.includes(`sceneId=${sceneId}`), { sceneId })
  const sceneDetail = root.locator('[data-contract-scene-detail]')
  await sceneDetail.locator('textarea').first().fill(`${density.marker}-场景目标-已编辑`)
  await sceneDetail.getByRole('button', { name: /保存场景合同/ }).click()
  await page.waitForFunction(async ({ chapterId, sceneId, expected }) => {
    const scenes = await window.electron.contract.listScenes(chapterId)
    return scenes.some((scene) => String(scene.segmentId ?? 'chapterless') === String(sceneId) && scene.sceneGoal === expected)
  }, { chapterId: secondChapterId, sceneId, expected: `${density.marker}-场景目标-已编辑` }, { timeout: 12000 })
  result.contractSceneSaved = true

  const firstScene = scenes.first()
  const firstSceneId = await firstScene.getAttribute('data-contract-scene-id')
  await sceneDetail.locator('textarea').first().fill(`${density.marker}-场景目标-未保存`)
  await firstScene.click()
  const sceneLeaveDialog = page.locator('.ant-modal-confirm:visible').filter({ hasText: '切换场景并放弃未保存合同？' }).last()
  await sceneLeaveDialog.waitFor({ state: 'visible', timeout: 8000 })
  result.contractSceneUnsavedPrompt = await sceneLeaveDialog.isVisible()
  await sceneLeaveDialog.getByRole('button', { name: /留在当前场景/ }).click()
  await page.waitForFunction(({ sceneId }) => document.querySelector(`[data-contract-scene-id="${sceneId}"]`)?.getAttribute('aria-pressed') === 'true', { sceneId }, { timeout: 8000 })
  result.contractSceneUnsavedCancel = true
  await firstScene.click()
  const confirmSceneLeaveDialog = page.locator('.ant-modal-confirm:visible').filter({ hasText: '切换场景并放弃未保存合同？' }).last()
  await confirmSceneLeaveDialog.waitFor({ state: 'visible', timeout: 8000 })
  await confirmSceneLeaveDialog.getByRole('button', { name: /继续切换/ }).click()
  await page.waitForFunction(({ sceneId }) => document.querySelector(`[data-contract-scene-id="${sceneId}"]`)?.getAttribute('aria-pressed') === 'true', { sceneId: firstSceneId }, { timeout: 8000 })
  result.contractSceneUnsavedDiscard = true

  await page.evaluate(({ projectId, chapterId, sceneId }) => {
    window.location.hash = `#/novels/${projectId}/contracts?chapterId=${chapterId}&sceneId=${sceneId}`
  }, { projectId, chapterId: secondChapterId, sceneId })
  await page.waitForFunction(({ sceneId }) => (
    document.querySelector(`[data-contract-scene-id="${sceneId}"]`)?.getAttribute('aria-pressed') === 'true'
    && document.querySelector('[data-contract-tab="scene"]')?.getAttribute('aria-selected') === 'true'
  ), { sceneId }, { timeout: 12000 })
  result.contractSceneRouteRestore = true

  await root.locator('[data-contract-tab="chapter"]').click()
  const chapterDetail = root.locator('[data-contract-chapter-detail]')
  await chapterDetail.getByLabel('本章目标', { exact: true }).fill(`${density.marker}-章节目标-已编辑`)
  await root.getByRole('button', { name: /保存章节合同/ }).click()
  await page.waitForFunction(async ({ chapterId, expected }) => (await window.electron.contract.getChapter(chapterId))?.chapterGoal === expected, { chapterId: secondChapterId, expected: `${density.marker}-章节目标-已编辑` }, { timeout: 12000 })
  result.contractChapterSaved = true
  result.contractSaveState = await root.locator('[data-contract-save-state]').textContent().then((value) => value?.includes('已保存') === true)
  await root.getByRole('button', { name: /去正文写作/ }).click()
  await page.waitForFunction(({ chapterId }) => window.location.hash.includes(`/writing/editor?chapterId=${chapterId}`), { chapterId: secondChapterId }, { timeout: 12000 })
  result.contractWritingJump = true
  return result
}

async function verifyInteractions(page, projectId, density) {
  const timeline = await verifyTimelineInteractions(page, projectId, density)
  const contracts = await verifyContractInteractions(page, projectId, density)
  return { ...timeline, ...contracts }
}

function buildReport(runId, projectId, results, staticContracts, interactions, density) {
  const lines = [
    `# P2-09 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
      return `${value.clientWidth}/${value.scrollWidth}; H${Math.round(value.pageHeight)}; A${value.actionCount}; L${value.listRowCount}; B${value.boundedOverflowCount}/${value.boundedScrollCount}; ${value.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  })
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A持续动作; L可见导航项; B发生纵向滚动的有界体/有界体总数; 状态`。')
  if (density.marker) {
    lines.push(
      '',
      `- 临时样本：${density.timelineEvents} 条时间轴事件、${density.chapters.length} 个章节、${density.scenes.reduce((sum, item) => sum + item.sceneIds.length, 0)} 个场景合同（运行结束已恢复）。`,
      '- 数据保护：采集前创建数据库快照，应用关闭后已恢复。',
    )
    if (PHASE === 'after') {
      lines.splice(lines.length - 1, 0,
        `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`,
        `- 交互检查：${Object.keys(interactions).length}/${Object.keys(interactions).length} PASS`,
      )
    }
  }
  return lines.join('\n')
}

async function main() {
  const runId = timestampId()
  const runDir = path.join(EVIDENCE_ROOT, 'runs', runId)
  const screenshotsDir = path.join(runDir, 'screenshots')
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const staticContracts = PHASE === 'after' ? assertStaticContracts() : []
  const snapshot = PREPARE_DENSITY ? await snapshotAcceptanceDatabase() : null
  let app
  try {
    app = await launchProductionApp()
    const page = await app.firstWindow({ timeout: 30000 })
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined))
    page.on('pageerror', (error) => console.error(`[P2-09] pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[P2-09] console.error: ${message.text()}`)
    })
    await page.waitForLoadState('domcontentloaded')
    const density = PREPARE_DENSITY
      ? await seedDensity(page, PROJECT_ID)
      : { marker: '', timelineEvents: 0, chapters: [], scenes: [] }
    if (PREPARE_DENSITY) await page.reload({ waitUntil: 'domcontentloaded' })
    const results = Object.fromEntries(ROUTES.map((route) => [route.key, {}]))
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        await setViewport(page, viewport)
        await navigate(page, PROJECT_ID, route)
        const item = await measure(page, route, viewport)
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({ path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 120000 })
        console.log(`[P2-09] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, PROJECT_ID, density)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P2-09] interactions ${JSON.stringify(interactions)}`)
      if (failed.length > 0) throw new Error(`P2-09 交互验收失败：${failed.join('、')}`)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
      writeJson(path.join(runDir, 'density.json'), density)
      writeJson(path.join(EVIDENCE_ROOT, 'after-density.json'), density)
      writeJson(path.join(runDir, 'static-contracts.json'), staticContracts)
    }
    if (PHASE === 'before' && density.marker) {
      writeJson(path.join(runDir, 'density.json'), density)
      writeJson(path.join(EVIDENCE_ROOT, 'before-density.json'), density)
    }
    const report = buildReport(runId, PROJECT_ID, results, staticContracts, interactions, density)
    writeJson(path.join(runDir, 'metrics.json'), results)
    fs.writeFileSync(path.join(runDir, `${PHASE}.md`), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, `${PHASE}-metrics.json`), results)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, `${PHASE}.md`), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, phase: PHASE, runDir: path.relative(REPO_ROOT, runDir).replace(/\\/g, '/') })
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    if (snapshot) await new Promise((resolve) => setTimeout(resolve, 350))
    restoreAcceptanceDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
