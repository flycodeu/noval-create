const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-07'))
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
  { key: 'info-gap-board', route: 'info-gap-board', root: '.novel-info-gap-page', label: '信息差与谜题板' },
  { key: 'foreshadow-ledger', route: 'foreshadow-ledger', root: '.novel-foreshadow-ledger-page', label: '伏笔与回收账本' },
  { key: 'growth-system', route: 'growth-system', root: '.novel-growth-system-page', label: '成长资源代价系统' },
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
  const info = read('src/pages/Novel/InfoGapBoard/index.tsx')
  const infoCss = read('src/pages/Novel/InfoGapBoard/index.css')
  const ledger = read('src/pages/Novel/ForeshadowLedger/index.tsx')
  const ledgerCss = read('src/pages/Novel/ForeshadowLedger/index.css')
  const growth = read('src/pages/Novel/GrowthSystem/index.tsx')
  const growthCss = read('src/pages/Novel/GrowthSystem/index.css')
  const chrome = read('scripts/workspace-chrome-contract.test.cjs')
  const checks = [
    ['信息差页接入共享动作契约', info.includes('chrome="shared"') && info.includes('actionContract={{')],
    ['信息差支持关键词/类型/状态筛选', info.includes('data-info-gap-filters') && info.includes('kindFilter') && info.includes('statusFilter')],
    ['信息差采用目录与当前详情', info.includes('data-info-gap-list') && info.includes('data-info-gap-current-detail') && infoCss.includes('.novel-info-gap-board__workspace')],
    ['信息差显示揭示风险和卷级比例折叠', info.includes('data-info-gap-due-risk') && info.includes('data-info-gap-volume-constraints') && infoCss.includes('.novel-info-gap-board__volume-list')],
    ['信息差编辑具备未保存保护', info.includes('当前信息点还有未保存修改') && info.includes("addEventListener('beforeunload'")],
    ['信息差危险删除有确认入口', info.includes('handleDelete') && info.includes('Modal.confirm') && info.includes('删除信息点')],
    ['伏笔页接入共享动作契约', ledger.includes('chrome="shared"') && ledger.includes('actionContract={{')],
    ['伏笔采用表格与当前详情', ledger.includes('data-foreshadow-list') && ledger.includes('data-foreshadow-current-detail') && ledgerCss.includes('.novel-foreshadow-ledger__list-scroll')],
    ['伏笔支持到期风险筛选', ledger.includes('data-foreshadow-filters') && ledger.includes('laneFilter') && ledger.includes('data-foreshadow-due-risk')],
    ['伏笔显示章节挂载并支持推进/回收', ledger.includes('data-foreshadow-chapter-mount') && ledger.includes('标记推进') && ledger.includes('标记回收')],
    ['伏笔编辑具备未保存保护和局部横向滚动', ledger.includes('当前伏笔还有未保存修改') && ledger.includes("addEventListener('beforeunload'") && ledgerCss.includes('overflow-x: auto')],
    ['成长页接入共享动作契约', growth.includes('chrome="shared"') && growth.includes('actionContract={{')],
    ['成长目录支持轨道/资源池/回写单焦点切换', growth.includes('data-growth-focus-tabs') && growth.includes('data-growth-track-list') && growth.includes('data-growth-pool-list') && growth.includes('data-growth-event-list')],
    ['成长页显示当前详情与合同绑定', growth.includes('data-growth-current-detail') && growth.includes('data-growth-binding') && growth.includes('bindChapterContract') && growth.includes('bindVolumeDesign')],
    ['成长编辑具备未保存保护和危险确认', growth.includes('当前成长编辑还有未保存修改') && growth.includes("addEventListener('beforeunload'") && growth.includes('确认删除')],
    ['共享 Chrome 白名单包含 P2-07 三页', chrome.includes('src/pages/Novel/InfoGapBoard/index.tsx') && chrome.includes('src/pages/Novel/ForeshadowLedger/index.tsx') && chrome.includes('src/pages/Novel/GrowthSystem/index.tsx')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-07 静态契约失败：${failed.join('、')}`)
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
    if (routeKey === 'info-gap-board') return Boolean(root.querySelector('[data-info-gap-filters]'))
    if (routeKey === 'foreshadow-ledger') return Boolean(root.querySelector('[data-foreshadow-filters]'))
    return Boolean(root.querySelector('[data-growth-focus-tabs]'))
  }, { selector: route.root, routeKey: route.key, phase: PHASE }, { timeout: 20000 })
  await page.waitForTimeout(450)
}

async function seedDensity(page, projectId) {
  const marker = `P2-07-${Date.now()}`
  return page.evaluate(async ({ novelId, target, seedMarker }) => {
    const novel = await window.electron.novel.get(novelId)
    if (!novel) throw new Error('P2-07 找不到验收项目。')
    const [volumes, chapters, characters, threads, commitments] = await Promise.all([
      window.electron.structure.listVolumes(novelId),
      window.electron.chapter.list(novelId),
      window.electron.character.list(novelId),
      window.electron.thread.list(novelId),
      window.electron.endgameAsset.listCommitments(novelId),
    ])
    const firstVolume = [...volumes].sort((left, right) => left.volumeNumber - right.volumeNumber)[0]
    const currentChapterNum = Math.max(0, ...chapters.map((chapter) => chapter.chapterNum || 0))
    const firstCharacter = characters[0]
    const firstThread = threads[0]
    const firstCommitment = commitments[0]

    const existingFacts = await window.electron.storyFact.list(novelId)
    const factTitles = new Set(existingFacts.map((item) => item.title))
    for (let index = 0; index < target; index += 1) {
      const kind = index % 4 === 0 ? 'truth' : index % 4 === 1 ? 'puzzle' : index % 4 === 2 ? 'clue' : 'red_herring'
      const title = `${seedMarker}-信息点-${String(index + 1).padStart(2, '0')}`
      if (factTitles.has(title)) continue
      const chapter = chapters[index % Math.max(1, chapters.length)]
      const plannedRevealVolume = firstVolume?.volumeNumber || undefined
      await window.electron.storyFact.create(novelId, {
        volumeId: firstVolume?.id || null,
        kind,
        title,
        summary: `${seedMarker} 用于验证目录筛选、当前详情和揭示边界。`,
        status: index % 4 === 0 ? 'pending_payoff' : index % 5 === 0 ? 'explained' : 'introduced',
        readerKnownChapterId: chapter?.id || null,
        protagonistKnownChapterId: chapter?.id || null,
        forbiddenBeforeVolume: firstVolume?.volumeNumber || null,
        plannedRevealVolume,
        targetRevealChapterId: chapter?.id || null,
        isKeyTruth: kind === 'truth' ? 1 : 0,
        characterKnowledgeJson: firstCharacter ? JSON.stringify([{ characterId: firstCharacter.id, knownChapterId: chapter?.id || null }]) : '[]',
        notes: `${seedMarker} 控制备注：不得提前公开完整真相。`,
      })
      factTitles.add(title)
    }

    const existingLedger = await window.electron.foreshadow.listLedger(novelId)
    const ledgerTitles = new Set(existingLedger.map((item) => item.title))
    for (let index = 0; index < target; index += 1) {
      const title = `${seedMarker}-伏笔-${String(index + 1).padStart(2, '0')}`
      if (ledgerTitles.has(title)) continue
      const chapter = chapters[index % Math.max(1, chapters.length)]
      const targetChapter = index % 4 === 0
        ? Math.max(1, currentChapterNum - 1)
        : index % 4 === 1
          ? currentChapterNum + 1
          : currentChapterNum + 8 + index
      await window.electron.foreshadow.upsertLedger(novelId, {
        title,
        detail: `${seedMarker} 验证埋设、到期、回收条件与章节挂载。`,
        sourceChapterId: chapter?.id || null,
        plantMethod: '道具特写与一句异常对白',
        salienceLevel: index % 3 === 0 ? 'high' : 'medium',
        targetPayoffChapter: targetChapter,
        payoffMethod: '在证据链闭合时回收',
        payoffSceneAction: `${seedMarker} 在正文中完成一次可见回收动作。`,
        requiredEvidence: `${seedMarker} 必须出现的证据。`,
        readerVisibleOutcome: '读者明确知道伏笔为何成立。',
        allowedDelayReason: '当前章位仍受主线冲突阻断。',
        impactScope: index % 2 === 0 ? 'global' : 'character',
        status: index % 4 === 2 ? 'resolved' : index % 4 === 3 ? 'active' : 'draft',
        linkedThreadId: firstThread?.id || null,
        linkedEndgameCommitmentId: firstCommitment?.id || null,
        linkedVolumeId: firstVolume?.id || null,
      })
      ledgerTitles.add(title)
    }

    const initialDashboard = await window.electron.growthSystem.getDashboard(novelId)
    const trackTitles = new Set(initialDashboard.tracks.map((item) => item.title))
    for (let index = 0; index < target; index += 1) {
      const title = `${seedMarker}-成长轨道-${String(index + 1).padStart(2, '0')}`
      if (trackTitles.has(title)) continue
      await window.electron.growthSystem.upsertTrack(novelId, {
        trackType: index % 3 === 0 ? 'character' : index % 3 === 1 ? 'organization' : 'relationship',
        title,
        currentTier: `阶段 ${index + 1}`,
        stageGoal: `${seedMarker} 阶段目标 ${index + 1}`,
        nextGoal: `${seedMarker} 下一目标 ${index + 1}`,
        bottleneck: `${seedMarker} 当前瓶颈 ${index + 1}`,
        scarceResource: `${seedMarker} 稀缺资源 ${index + 1}`,
        acquirePath: '通过行动与选择取得。',
        consumptionRule: '每次关键行动消耗一格。',
        failureCost: '失败会失去关系或时间。',
        rewardCadence: '每三章释放一次阶段奖励。',
        linkedVolumeId: firstVolume?.id || null,
        linkedChapterId: chapters[index % Math.max(1, chapters.length)]?.id || null,
        sortOrder: index + 1,
      })
      trackTitles.add(title)
    }
    const afterTracks = await window.electron.growthSystem.getDashboard(novelId)
    const poolNames = new Set(afterTracks.pools.map((item) => item.name))
    for (let index = 0; index < target; index += 1) {
      const name = `${seedMarker}-资源池-${String(index + 1).padStart(2, '0')}`
      if (poolNames.has(name)) continue
      await window.electron.growthSystem.upsertPool(novelId, {
        name,
        poolType: index % 2 === 0 ? 'knowledge' : 'authority',
        scarcityLevel: index % 4 === 0 ? 'critical' : index % 3 === 0 ? 'scarce' : 'balanced',
        currentReserve: `${index + 2} 格`,
        replenishPath: `${seedMarker} 通过线索交换补给。`,
        consumptionRule: '触发一次高代价行动消耗。',
        failureCost: '耗尽后必须改变行动路线。',
        pressureSource: `${seedMarker} 对手持续施压。`,
        linkedVolumeId: firstVolume?.id || null,
      })
      poolNames.add(name)
    }
    const afterPools = await window.electron.growthSystem.getDashboard(novelId)
    const markerTracks = afterPools.tracks.filter((item) => item.title.includes(seedMarker))
    const markerPools = afterPools.pools.filter((item) => item.name.includes(seedMarker))
    const eventTitles = new Set(afterPools.events.map((item) => item.title))
    for (let index = 0; index < target; index += 1) {
      const title = `${seedMarker}-章节回写-${String(index + 1).padStart(2, '0')}`
      if (eventTitles.has(title)) continue
      await window.electron.growthSystem.upsertEvent(novelId, {
        chapterId: chapters[index % Math.max(1, chapters.length)]?.id || null,
        eventType: index % 3 === 0 ? 'cost' : index % 3 === 1 ? 'reward' : 'bottleneck',
        title,
        summary: `${seedMarker} 记录本章收益、代价和下一阶段卡点。`,
        trackId: markerTracks[index % Math.max(1, markerTracks.length)]?.id || null,
        resourcePoolId: markerPools[index % Math.max(1, markerPools.length)]?.id || null,
        deltaValue: index % 3 === 0 ? '-1' : '+1',
        costResolutionState: index % 3 === 0 ? 'ongoing' : 'new',
        rewardLevel: index % 3 === 1 ? 'partial' : 'none',
        nextBottleneck: `${seedMarker} 下一阶段卡点。`,
        linkedVolumeId: firstVolume?.id || null,
      })
      eventTitles.add(title)
    }
    const verifiedDashboard = await window.electron.growthSystem.getDashboard(novelId)
    return {
      marker: seedMarker,
      facts: (await window.electron.storyFact.list(novelId)).filter((item) => item.title.includes(seedMarker)).length,
      ledger: (await window.electron.foreshadow.listLedger(novelId)).filter((item) => item.title.includes(seedMarker)).length,
      tracks: verifiedDashboard.tracks.filter((item) => item.title.includes(seedMarker)).length,
      pools: verifiedDashboard.pools.filter((item) => item.name.includes(seedMarker)).length,
      events: verifiedDashboard.events.filter((item) => item.title.includes(seedMarker)).length,
      volumes: volumes.length,
      chapters: chapters.length,
    }
  }, { novelId: projectId, target: DENSITY_TARGET, seedMarker: marker })
}

async function chooseOption(page, select, optionText) {
  await select.click()
  const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
  const option = optionText
    ? options.filter({ hasText: optionText }).last()
    : options.first()
  await option.waitFor({ state: 'visible', timeout: 8000 })
  await option.click({ force: true })
  await page.waitForTimeout(150)
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
    const boundedSelectors = routeKey === 'info-gap-board'
      ? '[data-info-gap-list], .novel-info-gap-board__volume-list'
      : routeKey === 'foreshadow-ledger'
        ? '[data-foreshadow-list]'
        : '[data-growth-track-list], [data-growth-pool-list], [data-growth-event-list]'
    const bounded = [...(workspace?.querySelectorAll(boundedSelectors) || [])].filter(visible)
    const listSelectors = routeKey === 'info-gap-board'
      ? '[data-info-gap-list] .novel-info-gap-board__directory-row'
      : routeKey === 'foreshadow-ledger'
        ? '[data-foreshadow-list] .ant-table-tbody > tr'
        : '[data-growth-track-list] .ant-table-tbody > tr, [data-growth-pool-list] .ant-table-tbody > tr, [data-growth-event-list] .ant-table-tbody > tr'
    const listRows = workspace ? [...workspace.querySelectorAll(listSelectors)].filter(visible) : []
    const horizontal = bounded.filter((node) => node.scrollWidth > node.clientWidth + 1)
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (Math.max(root.scrollWidth, body?.scrollWidth || 0) > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (workspace && viewport.width <= 1024 && workspace.getBoundingClientRect().width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    if (phase === 'after' && !workspace?.querySelector(routeKey === 'info-gap-board' ? '[data-info-gap-current-detail]' : routeKey === 'foreshadow-ledger' ? '[data-foreshadow-current-detail]' : '[data-growth-current-detail]')) reasons.push('当前详情区域不存在')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      actionCount: pageActions.length,
      listRowCount: listRows.length,
      disclosureCount: workspace?.querySelectorAll('details').length || 0,
      boundedScrollCount: bounded.length,
      boundedOverflowCount: bounded.filter((node) => node.scrollHeight > node.clientHeight + 1).length,
      horizontalOverflowCount: horizontal.length,
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth || 0),
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: route.root, viewport, routeKey: route.key, phase: PHASE })
}

async function verifyInteractions(page, projectId, density) {
  const result = {}

  console.log('[P2-07] interaction info-gap: start')
  await navigate(page, projectId, ROUTES[0])
  const infoRoot = page.locator('.novel-info-gap-page')
  const infoSearch = infoRoot.getByPlaceholder('搜索标题、摘要或控制备注')
  await infoSearch.fill(density.marker)
  const infoRows = infoRoot.locator('[data-info-gap-list] .novel-info-gap-board__directory-row')
  await page.waitForFunction(({ selector, marker }) => [...document.querySelectorAll(selector)].some((node) => node.textContent.includes(marker)), { selector: '.novel-info-gap-page [data-info-gap-list] .novel-info-gap-board__directory-row', marker: density.marker })
  const infoRowCount = await infoRows.count()
  const infoTexts = await infoRows.allTextContents()
  result.infoFilter = infoRowCount > 0 && infoTexts.every((text) => text.includes(density.marker))
  await infoRows.first().click()
  result.infoSelection = await infoRoot.locator('[data-info-gap-current-detail]').getByText(density.marker, { exact: false }).count() > 0
  result.infoRisk = await infoRoot.locator('[data-info-gap-due-risk]').count() > 0
  const infoVolumeDisclosure = infoRoot.locator('[data-info-gap-volume-constraints]')
  await infoVolumeDisclosure.locator('summary').click()
  result.infoVolumeDisclosure = await infoVolumeDisclosure.evaluate((node) => node.hasAttribute('open'))
  const infoEdit = infoRoot.locator('[data-info-gap-current-detail]').getByRole('button', { name: '编辑信息点', exact: true })
  await infoEdit.click()
  const infoModal = page.locator('.ant-modal:visible').filter({ hasText: '编辑信息点' }).last()
  await infoModal.getByLabel('标题', { exact: true }).fill(`${density.marker}-信息点-编辑后`)
  result.infoDirty = await infoRoot.locator('[data-info-gap-save-state]').getAttribute('data-info-gap-save-state') === 'unsaved'
  result.infoBeforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  await infoModal.locator('.ant-modal-footer .ant-btn').filter({ hasText: /取/ }).first().click()
  const infoLeaveDialog = page.getByRole('dialog').filter({ hasText: '当前信息点还有未保存修改' }).last()
  result.infoLeaveProtection = await infoLeaveDialog.isVisible().catch(() => false)
  if (result.infoLeaveProtection) await infoLeaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await infoModal.locator('.ant-modal-footer .ant-btn-primary').click()
  await infoModal.waitFor({ state: 'hidden', timeout: 10000 })
  await page.waitForFunction(() => Boolean(document.querySelector('[data-info-gap-current-detail] button')), null, { timeout: 10000 })
  const infoDelete = infoRoot.locator('[data-info-gap-current-detail] button').filter({ hasText: '删除' }).last()
  await infoDelete.click()
  const infoDeleteDialog = page.getByRole('dialog').filter({ hasText: '删除信息点' }).last()
  result.infoDeleteConfirmation = await infoDeleteDialog.isVisible().catch(() => false)
  if (result.infoDeleteConfirmation) await infoDeleteDialog.getByRole('button', { name: /取\s*消/ }).click()

  console.log('[P2-07] interaction foreshadow: start')
  await navigate(page, projectId, ROUTES[1])
  const ledgerRoot = page.locator('.novel-foreshadow-ledger-page')
  const ledgerSearch = ledgerRoot.getByPlaceholder('搜索伏笔标题、说明或回收动作')
  await ledgerSearch.fill(density.marker)
  const ledgerRows = ledgerRoot.locator('[data-foreshadow-list] .ant-table-tbody > tr:not(.ant-table-measure-row)')
  await page.waitForFunction(({ selector, marker }) => [...document.querySelectorAll(selector)].some((node) => node.textContent.includes(marker)), { selector: '.novel-foreshadow-ledger-page [data-foreshadow-list] .ant-table-tbody > tr', marker: density.marker })
  const ledgerRowCount = await ledgerRows.count()
  const ledgerTexts = await ledgerRows.allTextContents()
  result.foreshadowFilter = ledgerRowCount > 0 && ledgerTexts.every((text) => text.includes(density.marker))
  const ledgerFilterSelect = ledgerRoot.locator('[data-foreshadow-filters] .ant-select').first()
  await chooseOption(page, ledgerFilterSelect, '超期未收')
  const overdueRows = ledgerRoot.locator('[data-foreshadow-list] .ant-table-tbody > tr:not(.ant-table-measure-row)')
  result.foreshadowRiskFilter = await overdueRows.count() > 0 && (await overdueRows.allTextContents()).every((text) => text.includes('超期未收'))
  await chooseOption(page, ledgerFilterSelect, '全部风险')
  await ledgerRows.first().click()
  result.foreshadowSelection = await ledgerRoot.locator('[data-foreshadow-current-detail]').getByText(density.marker, { exact: false }).count() > 0
  result.foreshadowDueRisk = await ledgerRoot.locator('[data-foreshadow-due-risk]').count() > 0
  result.foreshadowChapterMount = await ledgerRoot.locator('[data-foreshadow-chapter-mount]').count() === 1
  const ledgerList = ledgerRoot.locator('[data-foreshadow-list]')
  result.foreshadowHorizontalScroll = await ledgerList.evaluate((node) => node.scrollWidth > node.clientWidth + 1)
  const advanceRow = ledgerRows.filter({ hasText: '草稿' }).first()
  if (await advanceRow.count() > 0) await advanceRow.click()
  await ledgerRoot.locator('[data-foreshadow-current-detail]').getByRole('button', { name: '标记推进', exact: true }).click()
  await page.waitForTimeout(600)
  result.foreshadowAdvance = await page.waitForFunction(() => {
    const selected = document.querySelector('[data-foreshadow-list] tr.is-selected')
    return Boolean(selected?.textContent?.includes('进行中'))
  }, null, { timeout: 8000 }).then(() => true).catch(() => false)
  const ledgerEdit = ledgerRoot.locator('[data-foreshadow-current-detail]').getByRole('button', { name: '编辑伏笔', exact: true })
  await ledgerEdit.click()
  const ledgerModal = page.locator('.ant-modal:visible').filter({ hasText: /编辑伏笔/ }).last()
  await ledgerModal.getByLabel('伏笔标题', { exact: true }).fill(`${density.marker}-伏笔-编辑后`)
  result.foreshadowDirty = await ledgerRoot.locator('[data-foreshadow-save-state]').getAttribute('data-foreshadow-save-state') === 'unsaved'
  await ledgerModal.locator('.ant-modal-footer .ant-btn').filter({ hasText: /取/ }).first().click()
  const ledgerLeaveDialog = page.getByRole('dialog').filter({ hasText: '当前伏笔还有未保存修改' }).last()
  result.foreshadowLeaveProtection = await ledgerLeaveDialog.isVisible().catch(() => false)
  if (result.foreshadowLeaveProtection) await ledgerLeaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await ledgerModal.getByRole('button', { name: '保存修改', exact: true }).click()
  await ledgerModal.waitFor({ state: 'hidden', timeout: 10000 })
  await page.waitForFunction(() => Boolean(document.querySelector('[data-foreshadow-current-detail] button')), null, { timeout: 10000 })
  await ledgerRoot.locator('[data-foreshadow-current-detail] button').filter({ hasText: '删除' }).last().click()
  const ledgerDeleteDialog = page.getByRole('dialog').filter({ hasText: '删除伏笔' }).last()
  result.foreshadowDeleteConfirmation = await ledgerDeleteDialog.isVisible().catch(() => false)
  if (result.foreshadowDeleteConfirmation) await ledgerDeleteDialog.getByRole('button', { name: /取\s*消/ }).click()

  console.log('[P2-07] interaction growth: start')
  await navigate(page, projectId, ROUTES[2])
  const growthRoot = page.locator('.novel-growth-system-page')
  const tabs = growthRoot.locator('[data-growth-focus-tabs] [role="tab"]')
  await tabs.filter({ hasText: '成长轨道' }).click()
  const trackRows = growthRoot.locator('[data-growth-track-list] .ant-table-tbody > tr:not(.ant-table-measure-row)')
  result.growthTrackDensity = await trackRows.count() > 0 && (await trackRows.allTextContents()).some((text) => text.includes(density.marker))
  await trackRows.filter({ hasText: density.marker }).first().click()
  result.growthTrackDetail = await growthRoot.locator('[data-growth-current-detail]').getByText(density.marker, { exact: false }).count() > 0
  await tabs.filter({ hasText: '资源池' }).click()
  const poolRows = growthRoot.locator('[data-growth-pool-list] .ant-table-tbody > tr:not(.ant-table-measure-row)')
  result.growthPoolDensity = await poolRows.count() > 0 && (await poolRows.allTextContents()).some((text) => text.includes(density.marker))
  await poolRows.filter({ hasText: density.marker }).first().click()
  result.growthPoolDetail = await growthRoot.locator('[data-growth-current-detail]').getByText(density.marker, { exact: false }).count() > 0
  await tabs.filter({ hasText: '章节回写' }).click()
  const eventRows = growthRoot.locator('[data-growth-event-list] .ant-table-tbody > tr:not(.ant-table-measure-row)')
  result.growthEventDensity = await eventRows.count() > 0 && (await eventRows.allTextContents()).some((text) => text.includes(density.marker))
  await eventRows.first().click()
  result.growthEventDetail = await growthRoot.locator('[data-growth-current-detail]').getByText(density.marker, { exact: false }).count() > 0
  const binding = growthRoot.locator('[data-growth-binding]')
  await binding.locator('summary').click()
  const bindingSelects = binding.locator('.ant-select')
  await chooseOption(page, bindingSelects.nth(0))
  await chooseOption(page, bindingSelects.nth(1), density.marker)
  await chooseOption(page, bindingSelects.nth(2), density.marker)
  await chooseOption(page, bindingSelects.nth(3), density.marker)
  await binding.getByRole('button', { name: '绑定章节合同', exact: true }).click()
  await page.getByText('章节合同已绑定成长约束。', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  result.growthChapterBinding = true
  await chooseOption(page, bindingSelects.nth(4))
  await binding.locator('textarea[placeholder="卷级奖励节奏约束说明"]').fill(`${density.marker} 卷级奖励节奏约束。`)
  await binding.getByRole('button', { name: '绑定卷级节奏', exact: true }).click()
  await page.getByText('卷级节奏已绑定成长约束。', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  result.growthVolumeBinding = true
  await tabs.filter({ hasText: '成长轨道' }).click()
  await trackRows.filter({ hasText: density.marker }).first().click()
  await growthRoot.locator('[data-growth-current-detail]').getByRole('button', { name: '编辑轨道', exact: true }).click()
  const growthModal = page.locator('.ant-modal:visible').filter({ hasText: /编辑成长轨道/ }).last()
  await growthModal.getByLabel('轨道标题', { exact: true }).fill(`${density.marker}-成长轨道-编辑后`)
  result.growthDirty = await growthRoot.locator('[data-growth-save-state]').getAttribute('data-growth-save-state') === 'unsaved'
  const growthBeforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  result.growthBeforeUnload = growthBeforeUnload
  await growthModal.locator('.ant-modal-footer .ant-btn').filter({ hasText: /取/ }).first().click()
  const growthLeaveDialog = page.getByRole('dialog').filter({ hasText: '当前成长编辑还有未保存修改' }).last()
  result.growthLeaveProtection = await growthLeaveDialog.isVisible().catch(() => false)
  if (result.growthLeaveProtection) await growthLeaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await growthModal.locator('.ant-modal-footer .ant-btn-primary').click()
  await growthModal.waitFor({ state: 'hidden', timeout: 10000 })
  await page.waitForFunction(() => Boolean(document.querySelector('[data-growth-current-detail] button')), null, { timeout: 10000 })
  await growthRoot.locator('[data-growth-current-detail] button').filter({ hasText: '删除' }).last().click()
  const growthDeleteDialog = page.getByRole('dialog').filter({ hasText: '删除成长轨道' }).last()
  result.growthDeleteConfirmation = await growthDeleteDialog.isVisible().catch(() => false)
  if (result.growthDeleteConfirmation) await growthDeleteDialog.getByRole('button', { name: /取\s*消/ }).click()

  return result
}

function buildReport(runId, projectId, results, staticContracts, interactions, density) {
  const lines = [
    `# P2-07 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
      return `${value.clientWidth}/${value.scrollWidth}; H${Math.round(value.pageHeight)}; A${value.actionCount}; L${value.listRowCount}; D${value.disclosureCount}; X${value.horizontalOverflowCount}; B${value.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  })
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; L可见列表行; D按需展开区; X局部横向滚动体; B状态`。')
  if (PHASE === 'after') {
    lines.push(
      '',
      `- 临时样本：${density.facts} 条信息点、${density.ledger} 条伏笔、${density.tracks} 条成长轨道、${density.pools} 个资源池、${density.events} 条章节回写（运行结束已恢复）。`,
      `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`,
      `- 交互检查：${Object.keys(interactions).length} PASS`,
      '- 数据保护：交互测试前创建数据库快照，应用关闭后已恢复。',
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
      : { marker: '', facts: 0, ledger: 0, tracks: 0, pools: 0, events: 0 }
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
        console.log(`[P2-07] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId, density)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P2-07] interactions ${JSON.stringify(interactions)}`)
      if (failed.length > 0) throw new Error(`P2-07 交互验收失败：${failed.join('、')}`)
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
