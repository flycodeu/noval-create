const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-08'))
const PROJECT_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const PHASE = process.argv.includes('--before') ? 'before' : 'after'
const PREPARE_DENSITY = PHASE === 'after' || process.env.NOVELFORGE_UI_ACCEPTANCE_SEED_DENSITY === '1'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]
const ROUTES = [
  { key: 'volume-design', route: 'volume-design', root: '.volume-design-page', label: '卷级设计中心' },
  { key: 'stage-planner', route: 'stage-planner', root: '.creative-stage-page', label: '阶段计划' },
  { key: 'outline', route: 'outline', root: '.novel-outline-page', beforeRoot: '.novel-workspace', label: '故事大纲' },
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
  const volume = read('src/pages/Novel/VolumeDesign/index.tsx')
  const volumeCss = read('src/pages/Novel/VolumeDesign/index.css')
  const stage = read('src/pages/Novel/StagePlanner/index.tsx')
  const stageCss = read('src/pages/Novel/StagePlanner/index.css')
  const outline = read('src/pages/Novel/Outline/index.tsx')
  const outlineCss = read('src/pages/Novel/Outline/index.css')
  const chrome = read('scripts/workspace-chrome-contract.test.cjs')
  const checks = [
    ['卷级设计接入共享动作契约', volume.includes('chrome="shared"') && volume.includes('actionContract={{')],
    ['卷级设计采用卷目录与当前详情', volume.includes('data-volume-design-list') && volume.includes('data-volume-design-current-detail') && volumeCss.includes('.volume-design-page__workspace')],
    ['卷级设计保存具备未保存保护', volume.includes('data-volume-design-save-state') && volume.includes("addEventListener('beforeunload'") && volume.includes('当前卷还有未保存修改')],
    ['卷级设计高级工具按需展开', volume.includes('data-volume-design-advanced') && volume.includes('<summary>终局绑定、线索与卷后工具</summary>')],
    ['卷级设计保留 AI 工具入口', volume.includes('AI 生成·卷级闭环') && volume.includes('AI 生成·绑定与线索')],
    ['卷级选择通过会话恢复', volume.includes('novelforge-volume-design:${novelId}') && volume.includes('sessionStorage.setItem')],
    ['阶段计划接入共享动作契约', stage.includes('chrome="shared"') && stage.includes('actionContract={{')],
    ['阶段计划采用阶段目录与当前详情', stage.includes('data-stage-list') && stage.includes('data-stage-current-detail') && stageCss.includes('.creative-stage-layout')],
    ['阶段计划选择通过会话恢复', stage.includes('novelforge-stage-planner:${novelId}') && stage.includes('sessionStorage.setItem')],
    ['阶段质量、交接、资产按需展开', stage.includes('data-stage-quality') && stage.includes('data-stage-handoff') && stage.includes('data-stage-assets') && stage.includes('<summary>阶段交接工件</summary>')],
    ['阶段目录具备有界滚动', stageCss.includes('overflow-y: auto') && stageCss.includes('.creative-stage-list')],
    ['大纲接入共享动作契约', outline.includes('chrome="shared"') && outline.includes('actionContract={{')],
    ['大纲采用故事弧目录与当前详情', outline.includes('data-outline-arc-list') && outline.includes('data-outline-current-detail') && outlineCss.includes('.novel-outline-page__workspace')],
    ['大纲保留拖拽与分页', outline.includes('DragDropContext') && outline.includes('Droppable') && outline.includes('<Pagination') && outline.includes('OUTLINE_CHAPTER_PAGE_SIZE')],
    ['大纲生成工具按需展开', outline.includes('data-outline-tools') && outline.includes('<summary>生成与阶段工具</summary>')],
    ['大纲保留 AI 入口与草稿恢复', outline.includes('AI 生成·故事弧草稿') && outline.includes('usePlanningDraft') && outline.includes('data-outline-draft-recovery')],
    ['大纲选择通过会话恢复', outline.includes('novelforge-outline-arc:${novelId}') && outline.includes('sessionStorage.setItem')],
    ['大纲编辑具备未保存保护', outline.includes('data-outline-save-state') && outline.includes("addEventListener('beforeunload'") && outline.includes('当前故事弧还有未保存修改')],
    ['共享 Chrome 白名单包含 P2-08 三页', chrome.includes('src/pages/Novel/VolumeDesign/index.tsx') && chrome.includes('src/pages/Novel/StagePlanner/index.tsx') && chrome.includes('src/pages/Novel/Outline/index.tsx')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-08 静态契约失败：${failed.join('、')}`)
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

async function setViewport(app, page, viewport) {
  await page.setViewportSize(viewport)
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setContentSize(size.width, size.height)
  }, viewport)
  await page.waitForTimeout(260)
}

async function navigate(page, projectId, route) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}`, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ selector, routeKey, phase }) => {
    const root = document.querySelector(selector)
    if (!root || root.querySelector('.ant-spin')) return false
    if (phase === 'before') {
      if (routeKey === 'volume-design') return Boolean(root.querySelector('.volume-design-page__volume-grid'))
      if (routeKey === 'stage-planner') return Boolean(root.querySelector('.creative-stage-list'))
      return Boolean(root.querySelector('.novel-outline-track'))
    }
    if (routeKey === 'volume-design') return Boolean(root.querySelector('[data-volume-design-list]'))
    if (routeKey === 'stage-planner') return Boolean(root.querySelector('[data-stage-list]'))
    return Boolean(root.querySelector('[data-outline-arc-list]'))
  }, { selector: PHASE === 'before' ? route.beforeRoot || route.root : route.root, routeKey: route.key, phase: PHASE }, { timeout: 20000 })
  await page.waitForTimeout(420)
}

async function seedDensity(page, novelId) {
  const marker = `P2-08-${Date.now()}`
  return page.evaluate(async ({ novelId, marker }) => {
    const novel = await window.electron.novel.get(novelId)
    if (!novel) throw new Error('P2-08 找不到验收项目。')

    let volumes = await window.electron.structure.listVolumes(novelId)
    if (volumes.length === 0) throw new Error('P2-08 项目没有卷结构，无法验证卷目录。')
    if (volumes.length < 2) {
      const nextNumber = Math.max(0, ...volumes.map((item) => Number(item.volumeNumber) || 0)) + 1
      await window.electron.structure.createVolume(novelId, {
        volumeNumber: nextNumber,
        title: `${marker}-补充卷`,
        summary: 'P2-08 非生产验收卷样本。',
        targetWords: 100000,
        status: 'planning',
      })
      volumes = await window.electron.structure.listVolumes(novelId)
    }
    const volume = [...volumes].sort((left, right) => left.volumeNumber - right.volumeNumber)[0]
    const secondVolume = [...volumes].sort((left, right) => left.volumeNumber - right.volumeNumber)[1]
    const partPage = await window.electron.structure.listPartsPage(volume.id, 1, 200)
    let part = partPage.items?.[0]
    if (!part) {
      const partId = await window.electron.structure.createPart(volume.id, {
        partNumber: 1,
        title: `${marker}-验收部`,
        status: 'planning',
      })
      const refreshed = await window.electron.structure.listPartsPage(volume.id, 1, 200)
      part = refreshed.items?.find((item) => item.id === partId) || refreshed.items?.[0]
    }
    if (!part) throw new Error('P2-08 无法准备章节所属部。')

    const existingStages = await window.electron.creativeStage.list(novelId, true)
    const stageIds = []
    for (let index = 0; index < 12; index += 1) {
      const name = `${marker}-阶段-${String(index + 1).padStart(2, '0')}`
      const existing = existingStages.find((item) => item.name === name)
      const stage = existing || await window.electron.creativeStage.create(novelId, {
        name,
        kind: index === 0 ? 'volume' : 'chapter-window',
        status: index === 0 ? 'active' : 'planned',
        chapterStart: 1 + index * 4,
        chapterEnd: 10 + index * 4,
        volumeId: volume.id,
        partId: part.id,
        objective: `${marker} 阶段目标 ${index + 1}。`,
        storySummary: `${marker} 阶段剧情窗口 ${index + 1}。`,
        handoffSummary: `${marker} 阶段交接条件 ${index + 1}。`,
      })
      stageIds.push(stage.id)
    }

    const existingChapters = await window.electron.chapter.list(novelId)
    let nextChapterNum = Math.max(0, ...existingChapters.map((item) => Number(item.chapterNum) || 0)) + 1
    const existingArcs = await window.electron.outline.getArcs(novelId)
    const mainArcName = `${marker}-主线大纲`
    const supportArcName = `${marker}-副线大纲`
    let mainArc = existingArcs.find((item) => item.arcName === mainArcName)
    let supportArc = existingArcs.find((item) => item.arcName === supportArcName)
    if (!mainArc) {
      const mainStart = nextChapterNum
      const mainEnd = mainStart + 51
      const mainArcId = await window.electron.outline.createArc(novelId, {
        arcName: mainArcName,
        arcOrder: existingArcs.length + 1,
        chapterStart: mainStart,
        chapterEnd: mainEnd,
        arcGoal: `${marker} 用于验证分页、排序和当前对象切换。`,
        arcSummary: `${marker} 主线大纲验收摘要。`,
        growthLedger: `${marker} 主线成长账本。`,
        costLedger: `${marker} 主线代价账本。`,
      })
      for (let index = 0; index < 52; index += 1) {
        await window.electron.chapter.create(novelId, {
          chapterNum: mainStart + index,
          volumeId: volume.id,
          partId: part.id,
          arcId: mainArcId,
          title: `${marker}-主线章-${String(index + 1).padStart(2, '0')}`,
          outline: `${marker} 用于验证章节卡片与拖拽排序的临时细纲。`,
          status: index % 5 === 0 ? 'draft' : 'outline',
          targetWords: 2500,
        })
      }
      mainArc = (await window.electron.outline.getArcs(novelId)).find((item) => item.id === mainArcId)
      nextChapterNum = mainEnd + 1
    }
    if (!supportArc) {
      const supportStart = nextChapterNum
      const supportArcId = await window.electron.outline.createArc(novelId, {
        arcName: supportArcName,
        arcOrder: existingArcs.length + 2,
        chapterStart: supportStart,
        chapterEnd: supportStart + 1,
        arcGoal: `${marker} 用于验证故事弧选择恢复。`,
        arcSummary: `${marker} 副线验收摘要。`,
      })
      for (let index = 0; index < 2; index += 1) {
        await window.electron.chapter.create(novelId, {
          chapterNum: supportStart + index,
          volumeId: secondVolume?.id || volume.id,
          arcId: supportArcId,
          title: `${marker}-副线章-${index + 1}`,
          outline: `${marker} 副线选择恢复样本。`,
          status: 'outline',
          targetWords: 2200,
        })
      }
      supportArc = (await window.electron.outline.getArcs(novelId)).find((item) => item.id === supportArcId)
    }

    const draft = await window.electron.planningDraft.save({
      novelId,
      pageKey: 'outline',
      sourcePage: 'outline',
      data: {
        arcName: `${marker}-恢复草稿`,
        chapterStart: mainArc?.chapterStart,
        chapterEnd: mainArc?.chapterEnd,
        arcGoal: `${marker} 草稿已恢复到故事弧表单。`,
        arcSummary: `${marker} 草稿恢复验收摘要。`,
        growthLedger: `${marker} 草稿成长账本。`,
        costLedger: `${marker} 草稿代价账本。`,
      },
      warnings: [`${marker} 草稿恢复提示`],
    })
    await window.electron.planningDraft.markApplied(draft.taskId)

    const finalStages = await window.electron.creativeStage.list(novelId, true)
    const finalArcs = await window.electron.outline.getArcs(novelId)
    const finalChapters = await window.electron.chapter.list(novelId)
    return {
      marker,
      volumeId: volume.id,
      secondVolumeId: secondVolume?.id || volume.id,
      stageIds,
      mainStageId: stageIds[0],
      secondStageId: stageIds[1],
      mainArcId: mainArc?.id,
      supportArcId: supportArc?.id,
      mainArcName,
      supportArcName,
      volumes: volumes.length,
      stages: finalStages.filter((item) => item.name.includes(marker)).length,
      arcs: finalArcs.filter((item) => item.arcName.includes(marker)).length,
      chapters: finalChapters.filter((item) => item.title?.includes(marker)).length,
    }

  }, { novelId, marker })
}

async function clearSelectionStorage(page, novelId) {
  await page.evaluate((id) => {
    sessionStorage.removeItem(`novelforge-volume-design:${id}`)
    sessionStorage.removeItem(`novelforge-stage-planner:${id}`)
    sessionStorage.removeItem(`novelforge-outline-arc:${id}`)
  }, novelId)
}

async function chooseOption(page, select, optionText) {
  await select.click()
  const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
  const option = optionText ? options.filter({ hasText: optionText }).last() : options.first()
  await option.waitFor({ state: 'visible', timeout: 8000 })
  await option.evaluate((node) => {
    const init = { bubbles: true, cancelable: true, view: window }
    node.dispatchEvent(new MouseEvent('mousedown', init))
    node.dispatchEvent(new MouseEvent('mouseup', init))
    node.dispatchEvent(new MouseEvent('click', init))
  })
  await page.waitForTimeout(160)
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, routeKey, viewport, before }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector(selector)
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const actions = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(visible)
    const list = routeKey === 'volume-design'
      ? workspace?.querySelector(before ? '.volume-design-page__volume-grid' : '[data-volume-design-list]')
      : routeKey === 'stage-planner'
        ? workspace?.querySelector(before ? '.creative-stage-list' : '[data-stage-list]')
        : workspace?.querySelector(before ? '.novel-outline-track' : '[data-outline-arc-list]')
    const listRows = routeKey === 'volume-design'
      ? workspace?.querySelectorAll(before ? '.volume-design-page__volume-grid .volume-design-page__volume-card' : '[data-volume-design-list] [data-volume-design-volume-id]')
      : routeKey === 'stage-planner'
        ? workspace?.querySelectorAll(before ? '.creative-stage-list .creative-stage-card' : '[data-stage-list] [data-stage-id]')
        : workspace?.querySelectorAll(before ? '.novel-outline-track .novel-outline-arc' : '[data-outline-arc-list] .novel-outline-arc')
    const detail = routeKey === 'volume-design'
      ? workspace?.querySelector(before ? '.volume-design-page__form' : '[data-volume-design-current-detail]')
      : routeKey === 'stage-planner'
        ? workspace?.querySelector(before ? '.creative-stage-detail-column' : '[data-stage-current-detail]')
        : workspace?.querySelector(before ? '.novel-outline-track' : '[data-outline-current-detail]')
    const disclosures = workspace ? [...workspace.querySelectorAll('details')] : []
    const bounded = [list, ...disclosures].filter((node) => visible(node))
    const rootWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (!visible(list)) reasons.push('目录不可见')
    if (!visible(detail)) reasons.push('当前详情不可见')
    if (actions.length > 4) reasons.push(`顶部持续动作有 ${actions.length} 个`)
    if (rootWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (viewport.width <= 1024 && workspace && workspace.getBoundingClientRect().width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      actionCount: actions.length,
      listRowCount: [...(listRows || [])].filter(visible).length,
      disclosureCount: disclosures.length,
      openDisclosureCount: disclosures.filter((node) => node.hasAttribute('open')).length,
      boundedScrollCount: bounded.length,
      boundedOverflowCount: bounded.filter((node) => node.scrollHeight > node.clientHeight + 1).length,
      clientWidth: root.clientWidth,
      scrollWidth: rootWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: PHASE === 'before' ? route.beforeRoot || route.root : route.root, routeKey: route.key, viewport, before: PHASE === 'before' })
}

async function dispatchBeforeUnload(page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
}

async function verifyVolumeInteractions(page, projectId, density) {
  const result = {}
  await navigate(page, projectId, ROUTES[0])
  const root = page.locator('.volume-design-page')
  const rows = root.locator('[data-volume-design-list] [data-volume-design-volume-id]')
  result.volumeDensity = await rows.count() >= 2
  const targetRow = rows.nth(1)
  await targetRow.click()
  await page.waitForTimeout(300)
  result.volumeSelection = await targetRow.getAttribute('class').then((value) => value?.includes('is-active') === true)
  const theme = root.getByLabel('本卷主题', { exact: true })
  await theme.fill(`${density.marker}-卷主题-编辑后`)
  result.volumeDirty = await root.locator('[data-volume-design-save-state]').getAttribute('data-volume-design-save-state') === 'unsaved'
  result.volumeBeforeUnload = await dispatchBeforeUnload(page)
  const saveButton = page.getByRole('button', { name: '保存当前卷设计', exact: true })
  await saveButton.click()
  await page.waitForFunction(({ novelId, volumeId, marker }) => window.electron.volumeDesign.getByVolume(volumeId).then((item) => item?.volumeTheme === `${marker}-卷主题-编辑后`), { novelId: projectId, volumeId: Number(await targetRow.getAttribute('data-volume-design-volume-id')), marker: density.marker }, { timeout: 12000 })
  result.volumeSaved = await root.locator('[data-volume-design-save-state]').getAttribute('data-volume-design-save-state') === 'saved'
  const advanced = root.locator('[data-volume-design-advanced]')
  await advanced.locator('summary').click()
  result.volumeAdvancedDisclosure = await advanced.evaluate((node) => node.hasAttribute('open'))
  result.volumeAiEntry = await root.locator('button').filter({ hasText: 'AI 生成·卷级闭环' }).count() > 0

  await navigate(page, projectId, ROUTES[1])
  await navigate(page, projectId, ROUTES[0])
  const restoredRow = root.locator(`[data-volume-design-volume-id="${await targetRow.getAttribute('data-volume-design-volume-id')}"]`)
  result.volumeSelectionRestore = await restoredRow.getAttribute('class').then((value) => value?.includes('is-active') === true)
  return result
}

async function verifyStageInteractions(page, projectId, density) {
  const result = {}
  await navigate(page, projectId, ROUTES[1])
  const root = page.locator('.creative-stage-page')
  const rows = root.locator('[data-stage-list] [data-stage-id]')
  result.stageDensity = await rows.count() >= 12
  const targetRow = rows.filter({ hasText: `${density.marker}-阶段-01` }).first()
  await targetRow.click()
  await page.waitForFunction(() => Boolean(document.querySelector('[data-stage-quality]')), null, { timeout: 20000 })
  result.stageSelection = await targetRow.getAttribute('class').then((value) => value?.includes('is-selected') === true)

  const secondRow = rows.filter({ hasText: `${density.marker}-阶段-02` }).first()
  await secondRow.click()
  await page.waitForFunction(({ stageId }) => document.querySelector(`[data-stage-id="${stageId}"]`)?.className.includes('is-selected'), { stageId: density.secondStageId }, { timeout: 12000 })
  await navigate(page, projectId, ROUTES[0])
  await navigate(page, projectId, ROUTES[1])
  const restoredSecond = root.locator(`[data-stage-id="${density.secondStageId}"]`)
  result.stageSelectionRestore = await restoredSecond.getAttribute('class').then((value) => value?.includes('is-selected') === true)

  await targetRow.click()
  await page.waitForFunction(({ stageId }) => document.querySelector(`[data-stage-id="${stageId}"]`)?.className.includes('is-selected'), { stageId: density.mainStageId }, { timeout: 12000 })
  await page.waitForFunction(() => Boolean(document.querySelector('[data-stage-quality]')), null, { timeout: 20000 })
  const quality = root.locator('[data-stage-quality]')
  const handoff = root.locator('[data-stage-handoff]')
  const assets = root.locator('[data-stage-assets]')
  await quality.locator('summary').click()
  await handoff.locator('summary').click()
  await assets.locator('summary').click()
  result.stageQualityDisclosure = await quality.evaluate((node) => node.hasAttribute('open'))
  result.stageHandoffDisclosure = await handoff.evaluate((node) => node.hasAttribute('open'))
  result.stageAssetsDisclosure = await assets.evaluate((node) => node.hasAttribute('open'))
  result.stageQualityAiEntry = await quality.getByRole('button', { name: '运行质量评审', exact: true }).count() > 0

  await chooseOption(page, assets.locator('.ant-select').first(), '人物')
  await assets.getByLabel('名称或占位名', { exact: true }).fill(`${density.marker}-阶段资产`)
  const assetSaveButton = assets.locator('button').filter({ hasText: '登记焦点' }).last()
  await assetSaveButton.waitFor({ state: 'visible', timeout: 8000 })
  await assetSaveButton.click()
  await assets.locator('.creative-stage-asset').filter({ hasText: `${density.marker}-阶段资产` }).first().waitFor({ state: 'visible', timeout: 10000 })
  result.stageAssetSaved = true

  await handoff.getByLabel('状态变化', { exact: true }).fill(`${density.marker} 状态变化`)
  await handoff.getByLabel('付出的代价', { exact: true }).fill(`${density.marker} 阶段代价`)
  await handoff.getByLabel('未决问题', { exact: true }).fill(`${density.marker} 未决问题`)
  await handoff.getByLabel('下一阶段压力', { exact: true }).fill(`${density.marker} 下一阶段压力`)
  const handoffSaveButton = handoff.locator('button').filter({ hasText: '保存新草稿' }).last()
  await handoffSaveButton.waitFor({ state: 'visible', timeout: 8000 })
  await handoffSaveButton.click({ timeout: 8000 })
  await handoff.locator('.creative-stage-handoff-card').filter({ hasText: `${density.marker} 下一阶段压力` }).first().waitFor({ state: 'visible', timeout: 12000 })
  result.stageHandoffSaved = true
  return result
}

async function verifyOutlineInteractions(page, projectId, density) {
  const result = {}
  await navigate(page, projectId, ROUTES[2])
  const root = page.locator('.novel-outline-page')
  const recovery = root.locator('[data-outline-draft-recovery]')
  await recovery.waitFor({ state: 'visible', timeout: 12000 })
  const draftModal = page.locator('.ant-modal:visible').filter({ hasText: '新建故事弧' }).last()
  const draftModalCount = await draftModal.count()
  if (draftModalCount !== 1) throw new Error(`P2-08 找不到故事弧草稿恢复弹窗（可见数量：${draftModalCount}）。`)
  const modalVisible = await draftModal.isVisible().catch(() => false)
  result.outlineDraftRecovery = modalVisible && await recovery.isVisible().catch(() => false)
  const nameInput = draftModal.getByLabel('名称', { exact: true })
  const nameValue = await nameInput.inputValue({ timeout: 2000 })
  result.outlineDraftValue = nameValue === `${density.marker}-恢复草稿`
  result.outlineAiEntry = await draftModal.locator('button').filter({ hasText: 'AI 生成·故事弧草稿' }).count() > 0
  const cancelDraftButton = draftModal.locator('.ant-modal-footer .ant-btn').first()
  await cancelDraftButton.evaluate((node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })))
  await page.waitForTimeout(250)
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '关闭当前故事弧编辑' }).last()
  if (await leaveDialog.isVisible().catch(() => false)) {
    await leaveDialog.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
  }
  result.outlineRecoveryStrip = await recovery.isVisible().catch(() => false)

  const targetArc = root.locator('[data-outline-arc-list] .novel-outline-arc').filter({ hasText: density.mainArcName }).first()
  await targetArc.click()
  const detail = root.locator('[data-outline-current-detail]')
  await detail.locator('.novel-outline-chapter-card').first().waitFor({ state: 'visible', timeout: 12000 })
  result.outlineSelection = await targetArc.getAttribute('class').then((value) => value?.includes('novel-outline-arc--active') === true)
  const cards = detail.locator('.novel-outline-chapter-card')
  result.outlineFirstPageCount = await cards.count() === 50
  result.outlinePagination = await detail.locator('.novel-outline-page__pagination .ant-pagination-next').count() === 1

  const reorderButton = detail.locator('.novel-panel__extra button').filter({ hasText: '拖拽' }).first()
  await reorderButton.waitFor({ state: 'visible', timeout: 8000 })
  await reorderButton.click()
  const chapterOrderBefore = await page.evaluate(async ({ novelId, arcId }) => (await window.electron.chapter.list(novelId)).filter((item) => item.arcId === arcId).sort((a, b) => a.chapterNum - b.chapterNum).map((item) => item.id), { novelId: projectId, arcId: density.mainArcId })
  const handles = cards.locator('.novel-outline-chapter-card__handle')
  if (await handles.count() < 2) throw new Error('P2-08 找不到章节拖拽手柄。')
  await handles.first().focus()
  await handles.first().press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await page.waitForTimeout(900)
  let chapterOrderAfter = await page.evaluate(async ({ novelId, arcId }) => (await window.electron.chapter.list(novelId)).filter((item) => item.arcId === arcId).sort((a, b) => a.chapterNum - b.chapterNum).map((item) => item.id), { novelId: projectId, arcId: density.mainArcId })
  let reordered = chapterOrderBefore[0] !== chapterOrderAfter[0]
  if (!reordered) {
    const sourceBox = await handles.nth(0).boundingBox()
    const targetBox = await handles.nth(1).boundingBox()
    if (sourceBox && targetBox) {
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(220)
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 18 })
      await page.waitForTimeout(420)
      await page.mouse.up()
      await page.waitForTimeout(900)
      chapterOrderAfter = await page.evaluate(async ({ novelId, arcId }) => (await window.electron.chapter.list(novelId)).filter((item) => item.arcId === arcId).sort((a, b) => a.chapterNum - b.chapterNum).map((item) => item.id), { novelId: projectId, arcId: density.mainArcId })
      reordered = chapterOrderBefore[0] !== chapterOrderAfter[0]
    }
  }
  result.outlineDragReorder = reordered

  const nextPage = detail.locator('.novel-outline-page__pagination .ant-pagination-next')
  await nextPage.click()
  await page.waitForFunction(() => document.querySelector('.novel-outline-page__pagination .ant-pagination-item-active')?.textContent === '2', null, { timeout: 8000 })
  result.outlineSecondPageCount = await detail.locator('.novel-outline-chapter-card').count() === 2

  await navigate(page, projectId, ROUTES[2])
  const restoredArc = root.locator('[data-outline-arc-list] .novel-outline-arc').filter({ hasText: density.mainArcName }).first()
  result.outlineSelectionRestore = await restoredArc.getAttribute('class').then((value) => value?.includes('novel-outline-arc--active') === true)
  return result
}

async function verifyInteractions(page, projectId, density) {
  const volume = await verifyVolumeInteractions(page, projectId, density)
  const stage = await verifyStageInteractions(page, projectId, density)
  const outline = await verifyOutlineInteractions(page, projectId, density)
  return { ...volume, ...stage, ...outline }
}

function buildReport(runId, projectId, results, staticContracts, interactions, density) {
  const lines = [
    `# P2-08 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
      return `${value.clientWidth}/${value.scrollWidth}; H${Math.round(value.pageHeight)}; A${value.actionCount}; L${value.listRowCount}; D${value.disclosureCount}; B${value.boundedOverflowCount}/${value.boundedScrollCount}; ${value.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  })
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; L可见目录项; D按需展开区; B发生纵向滚动的有界体/有界体总数; 状态`。')
  if (density.marker) {
    lines.push(
      '',
      `- 临时样本：${density.volumes} 卷、${density.stages} 个阶段、${density.arcs} 条故事弧、${density.chapters} 章（运行结束已恢复）。`,
      '- 数据保护：采集前创建数据库快照，应用关闭后已恢复。',
    )
    if (PHASE === 'after') {
      lines.splice(lines.length - 1, 0,
        `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`,
        `- 交互检查：${Object.keys(interactions).length} PASS`,
      )
    }
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
  const snapshot = PREPARE_DENSITY ? await snapshotAcceptanceDatabase() : null
  let app
  try {
    app = await launchProductionApp()
    const page = await app.firstWindow({ timeout: 30000 })
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined))
    await page.waitForLoadState('domcontentloaded')
    const density = PREPARE_DENSITY
      ? await seedDensity(page, projectId)
      : { marker: '', volumes: 0, stages: 0, arcs: 0, chapters: 0 }
    if (PREPARE_DENSITY) await clearSelectionStorage(page, projectId)
    const results = Object.fromEntries(ROUTES.map((route) => [route.key, {}]))
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        await setViewport(app, page, viewport)
        await navigate(page, projectId, route)
        const item = await measure(page, route, viewport)
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({ path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
        console.log(`[P2-08] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId, density)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P2-08] interactions ${JSON.stringify(interactions)}`)
      if (failed.length > 0) throw new Error(`P2-08 交互验收失败：${failed.join('、')}`)
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
    const report = buildReport(runId, projectId, results, staticContracts, interactions, density)
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
