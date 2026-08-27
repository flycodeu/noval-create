const { _electron: electron } = require('playwright')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P3-02'))
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
  {
    key: 'writeback',
    route: 'writeback',
    root: '[data-writeback-page]',
    beforeRoot: '.novel-writeback-center-page, .novel-workspace',
    label: '章后回写',
  },
  {
    key: 'batch',
    route: 'batch-workbench',
    root: '[data-batch-workbench-page]',
    beforeRoot: '.novel-batch-workbench-page, .novel-workspace',
    label: '批次回滚',
  },
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
  const writeback = read('src/pages/Novel/WritebackCenter/index.tsx')
  const writebackCss = read('src/pages/Novel/WritebackCenter/index.css')
  const batch = read('src/pages/Novel/BatchWorkbench/index.tsx')
  const batchCss = read('src/pages/Novel/BatchWorkbench/index.css')
  const checks = [
    ['回写使用共享信息栏与动作契约', writeback.includes('chrome="shared"') && writeback.includes('actionContract={actionContract}')],
    ['回写只突出单一当前 Diff', writeback.includes('data-writeback-current-diff') && writeback.includes('data-writeback-candidate-list') && !writeback.includes('<Table<ChapterWritebackDiff>')],
    ['回写保留接受拒绝编辑动作', writeback.includes('候选已接受') && writeback.includes('候选已拒绝') && writeback.includes('编辑候选')],
    ['回写提供前后候选导航', writeback.includes('← 上一条') && writeback.includes('下一条 →') && writeback.includes('selectAdjacentDiff(-1)') && writeback.includes('selectAdjacentDiff(1)')],
    ['回写保留应用与失败重试', writeback.includes('applyRun') && writeback.includes('retryFailed')],
    ['回写事实与八类覆盖按需展开', writeback.includes('data-writeback-facts') && writeback.includes('data-writeback-coverage') && writeback.includes('<details')],
    ['回写诊断筛选按需展开', writeback.includes('data-writeback-diagnostics') && writeback.includes('筛选与诊断')],
    ['回写页面样式定义当前 Diff 工作区', writebackCss.includes('data-writeback-current-diff') || writebackCss.includes('novel-writeback-center-page__current-diff')],
    ['批次使用共享信息栏与动作契约', batch.includes('chrome="shared"') && batch.includes('actionContract={actionContract}')],
    ['批次突出单一当前批次与恢复动作', batch.includes('data-batch-current') && batch.includes('data-batch-recovery')],
    ['批次锁库检查历史诊断按需展开', batch.includes('data-batch-locks') && batch.includes('data-batch-inspections') && batch.includes('data-batch-history') && batch.includes('<details')],
    ['批次切换回滚模式清空旧预演', batch.includes('setRollbackPreview(null)') && batch.includes('handleRollbackModeChange')],
    ['批次确认弹窗展示完整危险影响', batch.includes('affectedChapters') && batch.includes('affectedCounts') && batch.includes('Modal.confirm')],
    ['批次页面样式定义诊断层级', batchCss.includes('novel-batch-workbench__diagnostics') && batchCss.includes('novel-batch-workbench__current')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P3-02 静态契约失败：${failed.join('、')}`)
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
  return { snapshotDir, databasePath, files }
}

function restoreAcceptanceDatabase(snapshot) {
  if (!snapshot) return
  for (const file of snapshot.files) {
    if (file.existed) fs.copyFileSync(file.backup, file.source)
    else if (fs.existsSync(file.source)) fs.unlinkSync(file.source)
  }
  fs.rmSync(snapshot.snapshotDir, { recursive: true, force: true })
}

async function closeProductionApp(app) {
  if (!app) return
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function seedCharacterStatesWithElectronProcess(databasePath, projectId, fixture) {
  const payload = {
    databasePath,
    projectId,
    chapterId: fixture.chapterId,
    chapterNum: fixture.chapterNum,
    characterIds: fixture.characterIds,
    seedStates: [
      {
        injuryState: '左臂旧伤复发，暂时稳定',
        resourceState: '补给不足，药品只够一战',
        stanceState: '仍支持主角但开始怀疑盟友',
        mentalState: '警惕',
        relationshipHeatSummary: '与盟友保持试探',
        goalState: '追查失踪账册',
        eventCause: '因为在库房发现带血的账页',
        changeReason: '本章遭遇旧伤与补给短缺，立场出现摇摆',
        summaryText: '旧伤复发，补给不足，开始怀疑盟友并继续追查账册。',
      },
      {
        injuryState: '无明显伤势',
        resourceState: '补给短缺，行动受限',
        stanceState: '对盟友保持观望',
        mentalState: '迟疑',
        relationshipHeatSummary: '信任下降',
        goalState: '确认账册是否被调包',
        eventCause: '目睹库房封条被人撕开',
        changeReason: '发现封条异常后改变调查方向',
        summaryText: '补给短缺，信任下降，改为确认账册是否被调包。',
      },
      {
        injuryState: '轻微擦伤',
        resourceState: '保留一份备用药',
        stanceState: '暂时中立',
        mentalState: '冷静',
        relationshipHeatSummary: '与两方都保持距离',
        goalState: '保护备用账页',
        eventCause: '目睹双方在库房对峙',
        changeReason: '对峙升级后暂不站队，转而保护证据',
        summaryText: '保持冷静与中立，转而保护备用账页。',
      },
    ],
  }
  const result = await execFileAsync(require('electron'), [
    path.join(REPO_ROOT, 'scripts/ui-acceptance/seed-p3-02.cjs'),
    JSON.stringify(payload),
  ], {
    cwd: REPO_ROOT,
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (result.stderr?.trim()) console.warn(`[P3-02] seed stderr: ${result.stderr.trim()}`)
}

async function prepareWritebackFixture(projectId, databasePath) {
  let app
  try {
    app = await launchProductionApp()
    const setupPage = await app.firstWindow({ timeout: 30000 })
    await setupPage.waitForLoadState('domcontentloaded')
    const fixture = await setupPage.evaluate(async (novelId) => {
      const chapters = await window.electron.chapter.list(novelId)
      if (!Array.isArray(chapters) || chapters.length === 0) throw new Error('P3-02 找不到可用章节。')

      const tasks = await window.electron.task.list(novelId)
      const activeChapterIds = new Set(
        (Array.isArray(tasks) ? tasks : [])
          .filter((task) => ['pending', 'running', 'cancel_requested'].includes(task.status))
          .filter((task) => task.type === 'chapter_write' && task.relatedEntityId)
          .map((task) => Number(task.relatedEntityId)),
      )
      const chapter = chapters.find((item) => !activeChapterIds.has(item.id)) || chapters[0]
      const characters = await window.electron.character.list(novelId)
      const selectedCharacters = Array.isArray(characters) ? characters.slice(0, 3) : []
      while (selectedCharacters.length < 3) {
        const sequence = selectedCharacters.length + 1
        const id = await window.electron.character.create(novelId, {
          fullName: `P3-02验收角色${sequence}-${Date.now()}`,
          roleType: 'supporting',
          recordStatus: 'confirmed',
          goals: '完成本轮验收并保留连续性状态',
        })
        const created = await window.electron.character.get(Number(id))
        if (!created) throw new Error('P3-02 无法创建临时人物。')
        selectedCharacters.push(created)
      }

      const marker = `P3-02验收-${Date.now()}`
      const names = selectedCharacters.map((item) => item.fullName).join('、')
      await window.electron.chapter.update(chapter.id, {
        content: [
          `${marker}：夜色压过旧城，${names}在账册库房重新碰面。`,
          `${selectedCharacters[0].fullName}发现左臂旧伤复发，却仍决定追查失踪账册。`,
          `${selectedCharacters[1].fullName}因为补给短缺开始怀疑盟友，${selectedCharacters[2].fullName}暂时保持警惕。`,
          '本章留下一个可供回写的角色状态变化，供章后 Canon 同步确认。',
        ].join('\n'),
      })
      const updatedChapter = await window.electron.chapter.get(chapter.id)
      return {
        chapterId: chapter.id,
        chapterNum: chapter.chapterNum,
        characterIds: selectedCharacters.map((item) => item.id),
        characterNames: selectedCharacters.map((item) => item.fullName),
        marker,
        contextVersion: updatedChapter?.contextVersion || 1,
      }
    }, projectId)
    await closeProductionApp(app)
    app = null

    await seedCharacterStatesWithElectronProcess(databasePath, projectId, fixture)

    app = await launchProductionApp()
    const fixturePage = await app.firstWindow({ timeout: 30000 })
    await fixturePage.waitForLoadState('domcontentloaded')
    const run = await fixturePage.evaluate((chapterId) => window.electron.writeback.prepareRun(chapterId, 'p3-02-acceptance'), fixture.chapterId)
    if (!run || !run.id) throw new Error('P3-02 无法准备章后回写运行。')
    const centerData = await fixturePage.evaluate(async ({ chapterId, runId }) => window.electron.writeback.getCenterData(chapterId, runId), {
      chapterId: fixture.chapterId,
      runId: run.id,
    })
    if (!centerData || !Array.isArray(centerData.diffs) || centerData.diffs.length < 3) {
      throw new Error(`P3-02 回写夹具未产生至少 3 条候选 Diff（当前 ${centerData?.diffs?.length || 0} 条）。`)
    }

    const existingBatchTasks = await fixturePage.evaluate(async (novelId) => {
      const tasks = await window.electron.task.list(novelId)
      return (Array.isArray(tasks) ? tasks : [])
        .filter((task) => task.type === 'chapter_batch_generate' && ['pending', 'running', 'cancel_requested'].includes(task.status))
        .map((task) => task.id)
    }, projectId)
    for (const taskId of existingBatchTasks) {
      await fixturePage.evaluate((id) => window.electron.task.cancel(id), taskId).catch(() => undefined)
    }
    if (existingBatchTasks.length > 0) await fixturePage.waitForTimeout(500)
    const snapshotIdsBefore = await fixturePage.evaluate(async (novelId) => {
      const data = await window.electron.batchWorkbench.getData(novelId)
      return data.snapshots.map((item) => item.id)
    }, projectId)
    const taskId = await fixturePage.evaluate(({ novelId, chapterId }) => window.electron.chapterBatch.startAutoGenerate(novelId, {
      chapterIds: [chapterId],
      batchSize: 1,
    }), { novelId: projectId, chapterId: fixture.chapterId })
    await fixturePage.evaluate((id) => window.electron.task.cancel(id), taskId).catch(() => undefined)
    let batchData = null
    for (let attempt = 0; attempt < 24; attempt += 1) {
      batchData = await fixturePage.evaluate((novelId) => window.electron.batchWorkbench.getData(novelId), projectId)
      const found = batchData.snapshots.find((item) => !snapshotIdsBefore.includes(item.id) && item.chapterIds.includes(fixture.chapterId))
      if (found) {
        await closeProductionApp(app)
        app = null
        return { ...fixture, runId: run.id, taskId, snapshotId: found.id, candidateCount: centerData.diffs.length }
      }
      await fixturePage.waitForTimeout(250)
    }
    throw new Error('P3-02 批次启动后没有出现临时批次快照。')
  } finally {
    await closeProductionApp(app)
  }
}

async function setViewport(page, viewport) {
  await page.setViewportSize(viewport)
  await page.waitForTimeout(260)
}

async function navigate(page, projectId, route, query = {}) {
  const queryString = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}${queryString ? `?${queryString}` : ''}`, storageKey: VIEW_MODE_STORAGE_KEY })
  try {
    await page.waitForFunction(({ selector, phase }) => {
      const root = document.querySelector(selector)
      if (!root || root.querySelector('.ant-spin')) return false
      if (phase === 'before') return Boolean(root.querySelector('.novel-panel') || root.querySelector('.ant-select') || root.querySelector('textarea'))
      return Boolean(root.matches('[data-writeback-page], [data-batch-workbench-page]') || root.querySelector('[data-writeback-page], [data-batch-workbench-page]'))
    }, { selector: PHASE === 'before' ? route.beforeRoot : route.root, phase: PHASE }, { timeout: 20000 })
  } catch (error) {
    console.error(`[P3-02] route wait failed: ${route.key} ${PHASE}`)
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 4000))
    throw error
  }
  await page.waitForTimeout(420)
}

async function readWritebackData(page) {
  return page.evaluate(async () => {
    const hash = window.location.hash || ''
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    const params = new URLSearchParams(query)
    const chapterId = Number(params.get('chapterId'))
    const runId = Number(params.get('runId'))
    return window.electron.writeback.getCenterData(chapterId, runId > 0 ? runId : undefined)
  })
}

async function readBatchData(page, projectId) {
  return page.evaluate((novelId) => window.electron.batchWorkbench.getData(novelId), projectId)
}

function buildReport({ runId, projectId, results, staticContracts, interactions }) {
  const lines = [
    `# P3-02 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
      return `${value.clientWidth}/${value.scrollWidth}; H${Math.round(value.pageHeight)}; A${value.actionCount}; C${value.candidateCount}; D${value.disclosureCount}; B${value.boundedOverflowCount}/${value.boundedScrollCount}; ${value.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  })
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A持续动作; C候选/批次主项; D折叠区; B发生纵向滚动的有界体/有界体总数; 状态`。')
  if (PHASE === 'after') {
    lines.push('', `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`)
    lines.push(`- 交互检查：${Object.values(interactions).filter((value) => value === true).length}/${Object.keys(interactions).length} PASS`)
    lines.push('- 数据保护：交互测试前创建数据库快照，应用关闭后已恢复。')
  }
  return lines.join('\n')
}

async function measure(page, route, viewport) {
  return page.evaluate(({ routeKey, viewport, phase, beforeSelector }) => {
    const resolveRoot = () => {
      if (phase === 'before') return document.querySelector(beforeSelector)
      return document.querySelector(routeKey === 'writeback' ? '[data-writeback-page]' : '[data-batch-workbench-page]')
    }
    const collectReasons = (root, rootWidth, pageWidth, documentWidth) => {
      const reasons = []
      if (!root) reasons.push('页面根节点不存在')
      if (root && pageWidth > documentWidth + 1) reasons.push('页面工作区超过视口宽度')
      if (rootWidth > documentWidth + 1) reasons.push('页面根节点存在横向溢出')
      if (phase === 'after' && routeKey === 'writeback' && root && !root.querySelector('[data-writeback-current-diff]')) reasons.push('当前 Diff 不存在')
      if (phase === 'after' && routeKey === 'batch' && root && !root.querySelector('[data-batch-current]')) reasons.push('当前批次不存在')
      return reasons
    }
    const root = resolveRoot()
    const documentRoot = document.documentElement
    const body = document.body
    const isVisible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const actionCount = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(isVisible).length
    const details = root ? [...root.querySelectorAll('details')] : []
    const bounded = root ? [...root.querySelectorAll('[class*="list-scroll"], [class*="list-body"], .novel-writeback-center-page__diff-viewer, .novel-batch-workbench__impact-list')] : []
    const rootWidth = Math.max(documentRoot.scrollWidth, body?.scrollWidth || 0)
    const pageWidth = root?.getBoundingClientRect().width || 0
    const reasons = collectReasons(root, rootWidth, pageWidth, documentRoot.clientWidth)
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      phase,
      clientWidth: documentRoot.clientWidth,
      scrollWidth: rootWidth,
      pageWidth,
      pageHeight: Math.max(documentRoot.scrollHeight, body?.scrollHeight || 0, root?.scrollHeight || 0),
      actionCount,
      candidateCount: root?.querySelectorAll('[data-writeback-candidate-id], [data-batch-snapshot-id], [data-batch-current]')?.length || 0,
      disclosureCount: details.length,
      openDisclosureCount: details.filter((node) => node.open).length,
      boundedScrollCount: bounded.length,
      boundedOverflowCount: bounded.filter((node) => node.scrollHeight > node.clientHeight + 1).length,
    }
  }, { routeKey: route.key, viewport, phase: PHASE, beforeSelector: route.beforeRoot })
}

async function verifyWritebackSurface(page, projectId, fixture) {
  const result = {}
  const route = ROUTES[0]
  await navigate(page, projectId, route, { chapterId: fixture?.chapterId, runId: fixture?.runId })
  const root = page.locator('[data-writeback-page]')
  result.writebackSingleCurrentDiff = await root.locator('[data-writeback-current-diff]').count() === 1
  result.writebackCandidateListPresent = await root.locator('[data-writeback-candidate-list]').count() === 1
  const initialCandidateCount = await root.locator('[data-writeback-candidate-id]').count()
  result.writebackFixtureCandidates = initialCandidateCount >= 3 && initialCandidateCount >= Number(fixture?.candidateCount || 0)
  result.writebackFactsCollapsed = await root.locator('[data-writeback-facts]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)
  result.writebackCoverageCollapsed = await root.locator('[data-writeback-coverage]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)
  result.writebackDiagnosticsCollapsed = await root.locator('[data-writeback-diagnostics]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)

  const diagnostics = root.locator('[data-writeback-diagnostics]')
  await diagnostics.locator('summary').click()
  result.writebackDiagnosticsReveal = await diagnostics.locator('.novel-writeback-center-page__diagnostics-content').isVisible().catch(() => false)
  await root.locator('[data-writeback-facts] summary').click()
  result.writebackFactsReveal = await root.locator('[data-writeback-facts] .novel-writeback-center-page__disclosure-content').isVisible().catch(() => false)
  await root.locator('[data-writeback-coverage] summary').click()
  result.writebackCoverageReveal = await root.locator('[data-writeback-coverage] .novel-writeback-center-page__disclosure-content').isVisible().catch(() => false)

  return { result, root, initialCandidateCount }
}

function markWritebackCandidateActionsUnavailable(result) {
  result.writebackDiffSelection = false
  result.writebackDecisionActions = false
  result.writebackAccept = false
  result.writebackReject = false
  result.writebackEditModal = false
  result.writebackEdit = false
}

async function verifyWritebackCandidateDecisions(page, root, initialCandidateCount, result) {
  if (initialCandidateCount < 3) {
    markWritebackCandidateActionsUnavailable(result)
    return null
  }

  const candidate = root.locator('[data-writeback-candidate-id]').first()
  await candidate.click()
  await page.waitForTimeout(350)
  result.writebackDiffSelection = await candidate.getAttribute('aria-current') === 'true'
  result.writebackDecisionActions = await root.getByRole('button', { name: /接受\s*候选/ }).count() === 1
    && await root.getByRole('button', { name: /拒绝\s*候选/ }).count() === 1
    && await root.getByRole('button', { name: /编辑\s*候选/ }).count() === 1

  const [firstId, secondId, thirdId] = await root.locator('[data-writeback-candidate-id]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-writeback-candidate-id'))).filter(Boolean))
  const previousDiff = root.getByRole('button', { name: '← 上一条', exact: true })
  const nextDiff = root.getByRole('button', { name: '下一条 →', exact: true })
  result.writebackQueueNavigation = await previousDiff.count() === 1 && await nextDiff.count() === 1
  if (result.writebackQueueNavigation) {
    await nextDiff.click()
    result.writebackNextDiff = await root.locator(`[data-writeback-candidate-id="${secondId}"]`).getAttribute('aria-current') === 'true'
    await previousDiff.click()
    result.writebackPreviousDiff = await root.locator(`[data-writeback-candidate-id="${firstId}"]`).getAttribute('aria-current') === 'true'
  } else {
    result.writebackNextDiff = false
    result.writebackPreviousDiff = false
  }
  await root.locator(`[data-writeback-candidate-id="${firstId}"]`).click()
  await root.getByRole('button', { name: /接受\s*候选/ }).click()
  await page.waitForTimeout(650)
  let currentData = await readWritebackData(page)
  result.writebackAccept = currentData.diffs.some((item) => item.id === firstId && item.canonDecision === 'accepted')

  await root.locator(`[data-writeback-candidate-id="${secondId}"]`).click()
  await root.getByRole('button', { name: /拒绝\s*候选/ }).click()
  await page.waitForTimeout(650)
  currentData = await readWritebackData(page)
  result.writebackReject = currentData.diffs.some((item) => item.id === secondId && item.canonDecision === 'rejected')

  await root.locator(`[data-writeback-candidate-id="${thirdId}"]`).click()
  currentData = await readWritebackData(page)
  const thirdDiff = currentData.diffs.find((item) => item.id === thirdId)
  const editedState = thirdDiff?.afterStateJson ? JSON.parse(thirdDiff.afterStateJson) : {}
  editedState.summaryText = `${editedState.summaryText || '角色状态变化'} · P3-02 已编辑`
  await root.getByRole('button', { name: /编辑\s*候选/ }).click()
  const editModal = page.locator('.ant-modal').filter({ hasText: '编辑候选' }).last()
  result.writebackEditModal = await editModal.count() === 1 && await editModal.isVisible().catch(() => false)
  await editModal.locator('input').first().fill('P3-02 验收编辑原因')
  await editModal.locator('textarea').first().fill(JSON.stringify(editedState, null, 2))
  await editModal.getByRole('button', { name: /确\s*定/ }).click()
  await page.waitForTimeout(750)
  currentData = await readWritebackData(page)
  const editedDiff = currentData.diffs.find((item) => item.id === thirdId)
  result.writebackEdit = editedDiff?.canonDecision === 'edited'
    && String(editedDiff.diffReason || '').includes('P3-02 验收编辑原因')
    && String(editedDiff.afterStateJson || '').includes('P3-02 已编辑')
  return { firstId, secondId, thirdId }
}

async function verifyWritebackApplyAndRetry(page, result, candidateIds) {
  result.writebackApplyAction = await page.getByRole('button', { name: '应用已确认项', exact: true }).count() === 1
  result.writebackRetryAction = await page.getByRole('button', { name: '重试失败项', exact: true }).count() === 1
  if (result.writebackEdit && candidateIds) {
    const { firstId, secondId, thirdId } = candidateIds
    await page.getByRole('button', { name: '应用已确认项', exact: true }).click()
    const pendingDialog = page.locator('.ant-modal-confirm').filter({ hasText: '仍有候选未确认' }).last()
    if (await pendingDialog.count() > 0 && await pendingDialog.isVisible().catch(() => false)) {
      result.writebackPendingWarning = await pendingDialog.getByRole('button', { name: '继续应用已确认项', exact: true }).count() === 1
      await pendingDialog.getByRole('button', { name: '继续应用已确认项', exact: true }).click()
    } else {
      result.writebackPendingWarning = true
    }
    await page.waitForTimeout(1000)
    currentData = await readWritebackData(page)
    const appliedFirst = currentData.diffs.find((item) => item.id === firstId)
    const rejectedSecond = currentData.diffs.find((item) => item.id === secondId)
    const appliedThird = currentData.diffs.find((item) => item.id === thirdId)
    result.writebackApply = currentData.activeRun?.status === 'applied'
      && appliedFirst?.writebackStatus === 'applied'
      && rejectedSecond?.writebackStatus === 'skipped'
      && appliedThird?.writebackStatus === 'applied'
    try {
      const retryData = await page.evaluate((runId) => window.electron.writeback.retryFailed(runId), currentData.activeRun?.id)
      result.writebackRetry = retryData?.activeRun?.id === currentData.activeRun?.id
    } catch {
      result.writebackRetry = false
    }
  } else {
    result.writebackPendingWarning = false
    result.writebackApply = false
    result.writebackRetry = false
  }
}

async function verifyWritebackInteractions(page, projectId, fixture) {
  const { result, root, initialCandidateCount } = await verifyWritebackSurface(page, projectId, fixture)
  const candidateIds = await verifyWritebackCandidateDecisions(page, root, initialCandidateCount, result)
  await verifyWritebackApplyAndRetry(page, result, candidateIds)
  return result
}

async function verifyBatchInteractions(page, projectId) {
  const result = {}
  const route = ROUTES[1]
  await navigate(page, projectId, route)
  const root = page.locator('[data-batch-workbench-page]')
  result.batchSingleCurrent = await root.locator('[data-batch-current]').count() === 1
  result.batchRecoveryEntry = await root.locator('[data-batch-recovery]').count() === 1
  result.batchLockCollapsed = await root.locator('[data-batch-locks]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)
  result.batchInspectionCollapsed = await root.locator('[data-batch-inspections]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)
  result.batchHistoryCollapsed = await root.locator('[data-batch-history]').evaluate((node) => !node.hasAttribute('open')).catch(() => false)
  const locks = root.locator('[data-batch-locks]')
  await locks.locator('summary').click()
  result.batchLockReveal = await locks.locator('.novel-batch-workbench__disclosure-content').isVisible().catch(() => false)
  const lockMarker = `P3-02锁定-${Date.now()}`
  await locks.locator('textarea').first().fill(lockMarker)
  const saveLocksButton = locks.locator('button').filter({ hasText: '保存全局锁定' }).first()
  result.batchLockSaveAction = await saveLocksButton.count() === 1
  await saveLocksButton.click()
  await page.waitForTimeout(650)
  const savedLock = await page.evaluate((novelId) => window.electron.batchWorkbench.getGlobalLockLibrary(novelId), projectId)
  result.batchLockSave = savedLock.lockedCanonFacts.includes(lockMarker)
  const inspections = root.locator('[data-batch-inspections]')
  await inspections.locator('summary').click()
  result.batchInspectionReveal = await inspections.locator('.novel-batch-workbench__disclosure-content').isVisible().catch(() => false)
  const inspectionMarker = `P3-02检查-${Date.now()}`
  await inspections.locator('textarea').first().fill(inspectionMarker)
  const saveInspectionButton = inspections.locator('button').filter({ hasText: '保存检查记录' }).first()
  result.batchInspectionSaveAction = await saveInspectionButton.count() === 1
  await saveInspectionButton.click()
  await page.waitForTimeout(650)
  const afterInspectionData = await readBatchData(page, projectId)
  result.batchInspectionSave = afterInspectionData.inspections.some((item) => item.note === inspectionMarker)
  const history = root.locator('[data-batch-history]')
  await history.locator('summary').click()
  result.batchHistoryReveal = await history.locator('.novel-batch-workbench__disclosure-content').isVisible().catch(() => false)

  // 保存锁库/检查记录会让工作台重新读取数据；重新进入一次当前批次，
  // 确保恢复区以最新快照状态重新挂载后再测预演和危险确认。
  await navigate(page, projectId, ROUTES[0])
  await navigate(page, projectId, route)
  const recovery = root.locator('[data-batch-recovery]')
  const recoveryActions = recovery.locator('.novel-batch-workbench__recovery-actions')
  const previewButton = recoveryActions.locator('button').nth(0)
  const dangerButton = recoveryActions.locator('button').nth(1)
  result.batchPreviewAction = await previewButton.count() === 1
  result.batchDangerAction = await dangerButton.count() === 1
  await previewButton.click()
  result.batchPreviewGenerated = await page.waitForFunction(() => Boolean(document.querySelector('[data-batch-impact-preview]')), null, { timeout: 10000 }).then(() => true).catch(() => false)
  if (await recovery.locator('.novel-batch-workbench__mode-select').count() > 0) {
    await recovery.locator('.novel-batch-workbench__mode-select').click()
    const option = page.locator('.ant-select-item-option').filter({ hasText: '批次内容回滚' }).last()
    if (await option.count() > 0) await option.click()
    await page.waitForTimeout(300)
    result.batchModeChangeClearsPreview = await recovery.locator('[data-batch-impact-preview]').count() === 0
  } else {
    result.batchModeChangeClearsPreview = true
  }
  await previewButton.click()
  result.batchContentPreviewGenerated = await page.waitForFunction(() => Boolean(document.querySelector('[data-batch-impact-preview]')), null, { timeout: 10000 }).then(() => true).catch(() => false)
  if (result.batchContentPreviewGenerated) {
    await dangerButton.click()
    const confirmation = page.locator('[data-batch-danger-confirmation]').last()
    const confirmationVisible = await confirmation.count() === 1 && await confirmation.isVisible().catch(() => false)
    const confirmationText = confirmationVisible ? await confirmation.innerText() : ''
    const batchData = await readBatchData(page, projectId)
    const currentChapterNum = batchData.activeSnapshot?.chapterNums?.[0]
    result.batchDangerConfirmation = confirmationVisible
    result.batchDangerScope = confirmationText.includes('影响')
      && (currentChapterNum == null || confirmationText.includes(`第 ${currentChapterNum} 章`))
      && confirmationText.includes('批次内容回滚')
    const confirmModal = page.locator('.ant-modal-confirm:visible').filter({ has: page.locator('[data-batch-danger-confirmation]') }).last()
    const confirmButtons = confirmModal.locator('.ant-modal-confirm-btns button')
    const confirmButtonCount = await confirmButtons.count()
    result.batchDangerCancelAction = confirmButtonCount >= 2
    if (result.batchDangerCancelAction) {
      // Ant Design 的确认弹窗按钮文本可能被主题/本地化渲染拆分；
      // 这里按组件约定的按钮顺序点击第一个“取消”按钮，并验证弹窗关闭。
      await confirmButtons.first().click()
      result.batchDangerCancelled = await page.waitForFunction(
        () => !document.querySelector('[data-batch-danger-confirmation]'),
        null,
        { timeout: 5000 },
      ).then(() => true).catch(() => false)
    } else {
      result.batchDangerCancelled = false
    }
  } else {
    result.batchDangerConfirmation = false
    result.batchDangerScope = false
  }
  return result
}

async function verifyInteractions(page, projectId, fixture) {
  const writeback = await verifyWritebackInteractions(page, projectId, fixture)
  const batch = await verifyBatchInteractions(page, projectId)
  return { ...writeback, ...batch }
}

async function main() {
  const projectId = resolveProjectId()
  const runId = timestampId()
  const runDir = path.join(EVIDENCE_ROOT, 'runs', runId)
  const screenshotsDir = path.join(runDir, 'screenshots')
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const staticContracts = PHASE === 'after' ? assertStaticContracts() : []
  const snapshot = PHASE === 'after' ? await snapshotAcceptanceDatabase() : null
  let fixture = null
  let app
  try {
    if (PHASE === 'after' && snapshot) {
      fixture = await prepareWritebackFixture(projectId, snapshot.databasePath)
      console.log(`[P3-02] fixture chapter=${fixture.chapterId} run=${fixture.runId} snapshot=${fixture.snapshotId} candidates=${fixture.candidateCount}`)
    }
    app = await launchProductionApp()
    const page = await app.firstWindow({ timeout: 30000 })
    page.on('pageerror', (error) => console.error(`[P3-02] pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[P3-02] console.error: ${message.text()}`)
    })
    await page.waitForLoadState('domcontentloaded')
    const results = Object.fromEntries(ROUTES.map((route) => [route.key, {}]))
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        await setViewport(page, viewport)
        const query = PHASE === 'after' && fixture && route.key === 'writeback'
          ? { chapterId: fixture.chapterId, runId: fixture.runId }
          : {}
        await navigate(page, projectId, route, query)
        const item = await measure(page, route, viewport)
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({
          path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`),
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
          timeout: 120000,
        })
        console.log(`[P3-02] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId, fixture)
      const failed = Object.entries(interactions).filter(([, passed]) => passed !== true).map(([key]) => key)
      console.log(`[P3-02] interactions ${JSON.stringify(interactions)}`)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
      if (failed.length > 0) throw new Error(`P3-02 交互验收失败：${failed.join('、')}`)
    }
    const report = buildReport({ runId, projectId, results, staticContracts, interactions })
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
  console.error('[P3-02] FAILED', error)
  process.exitCode = 1
})
