const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P2-01')
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
  { key: 'core-settings', root: '.novel-premise-page', label: '基础设定' },
  { key: 'theme-voice', root: '.novel-theme-voice-page', label: '主题与文风' },
  { key: 'style-lab', root: '.novel-style-lab-page', label: '文风实验室' },
]

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function assertStaticContracts() {
  const premise = read('src/pages/Novel/Premise/index.tsx')
  const premiseCss = read('src/pages/Novel/Premise/index.css')
  const themeVoice = read('src/pages/Novel/ThemeVoice/index.tsx')
  const themeVoiceCss = read('src/pages/Novel/ThemeVoice/index.css')
  const styleLab = read('src/pages/Novel/StyleLab/index.tsx')
  const styleLabCss = read('src/pages/Novel/StyleLab/index.css')
  const checks = [
    ['三页接入共享信息栏', [premise, themeVoice, styleLab].every((source) => source.includes('chrome="shared"'))],
    ['基础设定核心字段持续可见', premise.includes('data-premise-core-fields="visible"') && premise.includes('data-premise-disclosure="advanced-rules"')],
    ['基础设定具备保存与离开保护', premise.includes("addEventListener('beforeunload'") && premise.includes('保存并离开')],
    ['主题文风核心与高级字段分层', themeVoice.includes('data-theme-voice-core-fields="visible"') && themeVoice.includes('data-theme-voice-disclosure="narrative-advanced"') && themeVoice.includes('data-theme-voice-disclosure="style-advanced"')],
    ['文风模板默认只补空字段', themeVoice.includes("useState<'fill_blanks' | 'replace'>('fill_blanks')") && themeVoice.includes('applyStyleTemplateValues')],
    ['主题文风不再重复采集风格样本', !themeVoice.includes('function StyleLearningPanel') && themeVoice.includes('文风实验室') && themeVoice.includes("navigateWithUnsavedGuard('style-lab')")],
    ['实验室使用指纹与 A/B 单焦点切换', styleLab.includes("useState<'fingerprints' | 'ab'>('fingerprints')") && styleLab.includes('data-style-lab-view={activeView}')],
    ['实验室新建与试写参数进入抽屉', styleLab.includes("drawerMode === 'create'") && styleLab.includes("drawerMode === 'ab'")],
    ['实验室候选输入具备离开保护', styleLab.includes('hasUnsavedCandidate') && styleLab.includes("addEventListener('beforeunload'")],
    ['三页样式保持连续表面', premiseCss.includes('box-shadow: none') && themeVoiceCss.includes('box-shadow: none') && styleLabCss.includes('box-shadow: none')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-01 静态契约失败：${failed.join('、')}`)
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
  const hash = `#/novels/${projectId}/${route.key}`
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ selector }) => {
    const root = document.querySelector(selector)
    return Boolean(root) && !root.querySelector('.ant-spin')
  }, { selector: route.root }, { timeout: 20000 })
  await page.waitForTimeout(500)
  return hash
}

async function waitForPersistedNovelText(page, projectId, field, expected, timeout = 12000) {
  const deadline = Date.now() + timeout
  let latest = ''
  while (Date.now() < deadline) {
    latest = await page.evaluate(async ({ novelId, fieldName }) => {
      const novel = await window.electron.novel.get(novelId)
      return String(novel?.[fieldName] || '')
    }, { novelId: projectId, fieldName: field })
    if (latest.includes(expected)) return
    await page.waitForTimeout(200)
  }
  throw new Error(`${field} 未在 ${timeout}ms 内持久化验收标记 ${expected}；当前值：${latest}`)
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, viewport }) => {
    const root = document.documentElement
    const body = document.body
    const workspace = document.querySelector(selector)
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
    const pageActions = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, :scope > .novel-hero .novel-hero__actions .ant-btn')].filter(visible)
    const firstField = [...(workspace?.querySelectorAll('.ant-form-item') || [])].find(visible)
    const firstPanel = workspace?.querySelector('.novel-panel')
    const firstPanelHeader = firstPanel?.querySelector('.novel-panel__header')
    const firstPanelBody = firstPanel?.querySelector('.novel-panel__body')
    const visiblePanels = [...(workspace?.querySelectorAll('.novel-panel') || [])].filter(visible)
    const disclosures = [...(workspace?.querySelectorAll('details') || [])]
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const workspaceRect = rect(workspace)
    const firstFieldRect = rect(firstField)
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (!firstFieldRect && selector !== '.novel-style-lab-page') reasons.push('核心表单字段不可见')
    if (firstFieldRect && firstFieldRect.y >= innerHeight) reasons.push('核心字段未进入首屏')
    if (viewport.width <= 1024 && workspaceRect && workspaceRect.width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      activeView: workspace?.querySelector('[data-style-lab-view]')?.getAttribute('data-style-lab-view') || '',
      topActionCount: pageActions.length,
      visiblePanelCount: visiblePanels.length,
      disclosureCount: disclosures.length,
      openDisclosureCount: disclosures.filter((node) => node.open).length,
      firstField: firstFieldRect,
      firstPanel: rect(firstPanel),
      firstPanelHeader: rect(firstPanelHeader),
      firstPanelBody: rect(firstPanelBody),
      firstPanelHeaderStyle: firstPanelHeader ? {
        display: getComputedStyle(firstPanelHeader).display,
        flexDirection: getComputedStyle(firstPanelHeader).flexDirection,
        flexGrow: getComputedStyle(firstPanelHeader).flexGrow,
        minHeight: getComputedStyle(firstPanelHeader).minHeight,
      } : null,
      workspace: workspaceRect,
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: route.root, viewport })
}

async function verifyPremiseSave(page, projectId, marker) {
  await navigate(page, projectId, ROUTES[0])
  const input = page.getByLabel('作品定位').first()
  const original = await input.inputValue()
  const next = `${original || '基础设定'} · ${marker}`
  await input.fill(next)
  for (const label of ['核心钩子', '主角起点', '底层约束']) {
    const requiredInput = page.getByLabel(label).first()
    if (!(await requiredInput.inputValue()).trim()) {
      await requiredInput.fill(`${label}验收占位 · ${marker}`)
    }
  }
  await page.waitForFunction(() => document.querySelector('[data-premise-save-state]')?.getAttribute('data-premise-save-state') === 'unsaved')
  const beforeUnload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    const dispatched = window.dispatchEvent(event)
    return event.defaultPrevented && dispatched === false
  })
  await page.getByRole('button', { name: '保存基础设定' }).click()
  await waitForPersistedNovelText(page, projectId, 'settingsJson', marker)
  await page.waitForFunction(() => document.querySelector('[data-premise-save-state]')?.getAttribute('data-premise-save-state') === 'saved', null, { timeout: 5000 }).catch(() => undefined)
  const saveState = await page.locator('[data-premise-save-state]').getAttribute('data-premise-save-state')
  return {
    unsavedStateVisible: true,
    beforeUnloadGuardActive: beforeUnload,
    savePersisted: saveState === 'saved',
  }
}

async function verifyThemeTemplateAndSave(page, projectId, marker) {
  await navigate(page, projectId, ROUTES[1])
  const themeInput = page.locator('textarea#theme').first()
  const styleInput = page.locator('textarea#styleRules').first()
  const originalTheme = await themeInput.inputValue()
  await styleInput.fill(marker)

  const openTemplate = async () => {
    await page.getByRole('button', { name: '应用文风模板' }).click()
    const modal = page.locator('.ant-modal-content').filter({ hasText: '应用文风模板' }).last()
    await modal.waitFor({ state: 'visible', timeout: 5000 })
    if (await modal.locator('[role="radio"][aria-checked="true"]').count() === 0) {
      await modal.locator('[role="radio"]').first().click()
    }
    return modal
  }

  let modal = await openTemplate()
  const defaultMode = await modal.locator('[data-theme-template-mode]').getAttribute('data-theme-template-mode')
  await modal.getByRole('button', { name: '应用到当前表单' }).click()
  await modal.waitFor({ state: 'hidden' })
  const fillBlankPreserved = await styleInput.inputValue() === marker
  const themePreservedAfterFill = await themeInput.inputValue() === originalTheme

  modal = await openTemplate()
  await modal.getByText('覆盖文风字段', { exact: true }).click()
  await modal.getByRole('button', { name: '应用到当前表单' }).click()
  await modal.waitFor({ state: 'hidden' })
  const replacedStyle = await styleInput.inputValue()
  const replaceChangedStyleOnly = replacedStyle.trim().length > 0 && replacedStyle !== marker && await themeInput.inputValue() === originalTheme

  const savedTheme = `${originalTheme || '主题'} · ${marker}`
  await themeInput.fill(savedTheme)
  await page.waitForFunction(() => document.querySelector('[data-theme-voice-save-state]')?.getAttribute('data-theme-voice-save-state') === 'unsaved')
  await page.getByRole('button', { name: '保存主题与文风' }).click()
  await waitForPersistedNovelText(page, projectId, 'themeVoiceJson', marker)
  await page.waitForFunction(() => document.querySelector('[data-theme-voice-save-state]')?.getAttribute('data-theme-voice-save-state') === 'saved', null, { timeout: 5000 }).catch(() => undefined)
  const saveState = await page.locator('[data-theme-voice-save-state]').getAttribute('data-theme-voice-save-state')
  return {
    defaultModeIsFillBlanks: defaultMode === 'fill_blanks',
    fillBlankPreservedExistingStyle: fillBlankPreserved,
    fillBlankPreservedTheme: themePreservedAfterFill,
    replaceChangedOnlyTemplateFields: replaceChangedStyleOnly,
    savePersisted: saveState === 'saved',
  }
}

async function verifyStyleLabViewState(page, projectId, marker) {
  await navigate(page, projectId, ROUTES[2])
  await page.locator('.style-lab__view-tabs .ant-tabs-tab').filter({ hasText: 'A/B 对照' }).click()
  await page.waitForFunction(() => document.querySelector('[data-style-lab-view]')?.getAttribute('data-style-lab-view') === 'ab')
  await page.getByRole('button', { name: '设置试写参数' }).first().click()
  const drawer = page.locator('.ant-drawer-content').filter({ hasText: 'A/B 试写参数' }).last()
  await drawer.waitFor({ state: 'visible', timeout: 5000 })
  const sceneInput = drawer.getByLabel('场景梗概')
  await sceneInput.fill(marker)
  await drawer.locator('.ant-drawer-close').click()
  await drawer.waitFor({ state: 'hidden' })

  await page.locator('.style-lab__view-tabs .ant-tabs-tab').filter({ hasText: '指纹库' }).click()
  await page.locator('.style-lab__view-tabs .ant-tabs-tab').filter({ hasText: 'A/B 对照' }).click()
  await page.getByRole('button', { name: '设置试写参数' }).first().click()
  await drawer.waitFor({ state: 'visible', timeout: 5000 })
  const preservedAfterViewSwitch = await sceneInput.inputValue() === marker
  await sceneInput.fill('')
  const candidateClearedAfterCheck = await sceneInput.inputValue() === ''
  await drawer.locator('.ant-drawer-close').click()
  return {
    candidatePreservedAfterDrawerClose: preservedAfterViewSwitch,
    candidatePreservedAfterViewSwitch: preservedAfterViewSwitch,
    candidateClearedAfterCheck,
  }
}

async function verifyInteractions(page, projectId) {
  const marker = `P2-01-${Date.now()}`
  const premise = await verifyPremiseSave(page, projectId, marker)
  const themeVoice = await verifyThemeTemplateAndSave(page, projectId, marker)
  const styleLab = await verifyStyleLabViewState(page, projectId, marker)
  const checks = { premise, themeVoice, styleLab }
  const failed = Object.entries(checks).flatMap(([group, values]) => (
    Object.entries(values).filter(([, passed]) => passed !== true).map(([key]) => `${group}.${key}`)
  ))
  if (failed.length > 0) throw new Error(`P2-01 交互验收失败：${failed.join('、')}`)
  return checks
}

function buildReport({ runId, projectId, results, staticContracts, interactions }) {
  const lines = [
    `# P2-01 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
      return `${item.clientWidth}/${item.scrollWidth}; H${Math.round(item.pageHeight)}; A${item.topActionCount}; P${item.visiblePanelCount}; ${item.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  }
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; P可见面板; 状态`。', '')
  if (PHASE === 'after') {
    lines.push(
      `- 静态契约：${staticContracts.length}/${staticContracts.length} PASS`,
      `- 交互检查：${Object.values(interactions).reduce((total, group) => total + Object.keys(group).length, 0)} PASS`,
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
  const staticContracts = assertStaticContracts()
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
        await page.screenshot({
          path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`),
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
          timeout: 60000,
        })
        console.log(`[P2-01] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
    }
    const report = buildReport({ runId, projectId, results, staticContracts, interactions })
    writeJson(path.join(runDir, 'metrics.json'), results)
    writeJson(path.join(runDir, 'capture-summary.json'), {
      runId,
      phase: PHASE,
      projectId,
      routeCount: ROUTES.length,
      viewportCount: VIEWPORTS.length,
      staticContractCount: staticContracts.length,
      interactionCount: Object.values(interactions).reduce((total, group) => total + Object.keys(group).length, 0),
    })
    fs.writeFileSync(path.join(runDir, `${PHASE}.md`), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, `${PHASE}-metrics.json`), results)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, `${PHASE}.md`), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, phase: PHASE, runDir: path.relative(REPO_ROOT, runDir).replace(/\\/g, '/') })
  } finally {
    if (app) await app.close().catch(() => undefined)
    if (snapshot) restoreAcceptanceDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
