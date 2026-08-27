const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-01')
const P0_00_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]

// P0-01 的全局页面不是项目工作区，不应被 shared/legacy portal 规则误判。
// 这里保留独立的根节点与页面级溢出检查，确保全局入口也能承接同一套壳层密度。
const GLOBAL_ROUTES = [
  { key: 'models', hash: '#/models', selector: '.model-manager-page', label: '模型与搜索管理' },
  { key: 'templates', hash: '#/templates', selector: '.template-manager-page', label: '文风与世界模板' },
  { key: 'prompts', hash: '#/prompts', selector: '.prompt-manager-page', label: '提示词管理' },
  { key: 'tasks', hash: '#/tasks', selector: '.task-center-page', label: '任务中心' },
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
  if (!fs.existsSync(P0_00_SUMMARY)) {
    throw new Error('缺少 P0-00 capture-summary.json，请先运行 npm run acceptance:p0-00。')
  }
  const summary = JSON.parse(fs.readFileSync(P0_00_SUMMARY, 'utf8'))
  const projectId = Number(summary?.project?.id || 0)
  if (projectId <= 0) throw new Error('P0-00 摘要中没有有效项目 ID。')
  return projectId
}

async function setViewport(app, page, viewport) {
  await page.setViewportSize(viewport)
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setContentSize(size.width, size.height)
  }, viewport)
  await page.waitForTimeout(300)
}

async function navigate(page, hash, workspaceLabel) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ label, expectedPath }) => {
    const actualPath = window.location.hash.split('?')[0]
    const currentLabel = document.querySelector('.project-topbar__workspace-name')?.textContent?.trim()
    return actualPath === expectedPath && currentLabel === label
  }, { label: workspaceLabel, expectedPath: hash }, { timeout: 12000 })
  await page.waitForTimeout(500)
}

async function navigateGlobal(page, route) {
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: route.hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ expectedPath, selector }) => {
    const actualPath = window.location.hash.split('?')[0]
    return actualPath === expectedPath && Boolean(document.querySelector(selector))
  }, { expectedPath: route.hash, selector: route.selector }, { timeout: 12000 })
  await page.waitForTimeout(500)
}

async function measure(page, kind) {
  return page.evaluate((pageKind) => {
    const root = document.documentElement
    const body = document.body
    const informationSlot = document.querySelector('.project-topbar__information-slot')
    const actionSlot = document.querySelector('.project-topbar__page-actions')
    const workspaceRoot = document.querySelector('.novel-workspace')
    const localHero = document.querySelector('.novel-workspace > .novel-hero')
    const errorCard = document.querySelector('.novel-route-shell__error-card')
    const sharedTitle = informationSlot?.querySelector('.workspace-information-rail__heading h1')?.textContent?.trim() || ''
    const primaryActions = [...(actionSlot?.querySelectorAll('.workspace-contract-action--primary') || [])]
    const visibleSecondary = [...(actionSlot?.querySelectorAll('.workspace-contract-actions__secondary .ant-btn') || [])]
      .filter((node) => {
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })
    const desktopMore = actionSlot?.querySelector('.workspace-contract-actions__more--desktop')
    const compactMore = actionSlot?.querySelector('.workspace-contract-actions__more--compact')
    const isVisible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const reasons = []
    if (errorCard) reasons.push(errorCard.textContent?.replace(/\s+/g, ' ').trim() || '错误边界已触发')
    if (root.scrollWidth > root.clientWidth || (body?.scrollWidth || 0) > root.clientWidth) reasons.push('页面存在横向溢出')

    if (pageKind === 'shared') {
      if (workspaceRoot?.dataset.workspaceChrome !== 'shared') reasons.push('共享迁移页未声明 data-workspace-chrome=shared')
      if (workspaceRoot?.dataset.workspaceInformationMounted !== 'true') reasons.push('共享信息栏 portal 未挂载')
      if (workspaceRoot?.dataset.workspaceActionsMounted !== 'true') reasons.push('共享动作 portal 未挂载')
      if (sharedTitle !== '项目立项') reasons.push(`共享信息栏标题异常：${sharedTitle || '空'}`)
      if (localHero) reasons.push('迁移页仍渲染本地 Hero')
      if (primaryActions.length !== 1) reasons.push(`主动作数量为 ${primaryActions.length}`)
      if (visibleSecondary.length > 2) reasons.push(`可见次动作超过 2 个：${visibleSecondary.length}`)
      if (innerWidth > 1200 && !isVisible(desktopMore)) reasons.push('桌面更多操作未显示')
      if (innerWidth <= 1200 && !isVisible(compactMore)) reasons.push('窄屏页面操作菜单未显示')
    } else {
      if (workspaceRoot?.dataset.workspaceChrome !== 'legacy') reasons.push('对照页未保持 legacy chrome')
      if (workspaceRoot?.dataset.workspaceInformationMounted !== 'legacy') reasons.push('legacy 页信息 portal 标记异常')
      if (workspaceRoot?.dataset.workspaceActionsMounted !== 'legacy') reasons.push('legacy 页动作 portal 标记异常')
      if (informationSlot?.childElementCount) reasons.push('未迁移页污染了共享信息栏')
      if (actionSlot?.childElementCount) reasons.push('未迁移页污染了共享动作槽')
      if (!localHero) reasons.push('未迁移页本地 Hero 消失')
      if (!localHero?.querySelector('.novel-hero__actions')) reasons.push('未迁移页本地动作消失')
    }

    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth || 0),
      sharedTitle,
      localHeroPresent: Boolean(localHero),
      primaryActionCount: primaryActions.length,
      visibleSecondaryActionCount: visibleSecondary.length,
      desktopMoreVisible: isVisible(desktopMore),
      compactMoreVisible: isVisible(compactMore),
      informationSlotChildren: informationSlot?.childElementCount || 0,
      actionSlotChildren: actionSlot?.childElementCount || 0,
    }
  }, kind)
}

async function measureGlobal(page, route) {
  return page.evaluate(({ routeKey, selector }) => {
    const root = document.querySelector(selector)
    const documentRoot = document.documentElement
    const body = document.body
    const visible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
    }
    const reasons = []
    if (!root) reasons.push(`全局页面根节点不存在：${routeKey}`)
    const scrollWidth = Math.max(documentRoot.scrollWidth, body?.scrollWidth || 0)
    if (scrollWidth > documentRoot.clientWidth + 1) reasons.push('页面存在横向溢出')
    if (document.querySelector('.novel-route-shell__error-card')) reasons.push('页面错误边界已触发')
    const actions = [...document.querySelectorAll('.novel-hero__actions .ant-btn, .admin-toolbar__actions .ant-btn, .task-center-detail__actions .ant-btn')]
      .filter(visible)
    const boundedOverflow = [...(root?.querySelectorAll('[class*="list-scroll"], [class*="list-body"], [class*="log"], .ant-table-body') || [])]
      .filter((node) => node.scrollHeight > node.clientHeight + 1).length
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      routeKey,
      clientWidth: documentRoot.clientWidth,
      scrollWidth,
      pageHeight: Math.max(documentRoot.scrollHeight, body?.scrollHeight || 0),
      actionCount: actions.length,
      itemCount: root?.querySelectorAll('[data-model-config-card], [data-template-builtin], [data-p3-05-prompt-list] .prompt-manager-card, [data-p3-05-task-list] .novel-list-card').length || 0,
      disclosureCount: root?.querySelectorAll('details, .ant-collapse-item').length || 0,
      boundedOverflow,
    }
  }, { routeKey: route.key, selector: route.selector })
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

async function inspectPageActionMenu(page, viewportWidth) {
  const selector = viewportWidth > 1200
    ? '.workspace-contract-actions__more--desktop'
    : '.workspace-contract-actions__more--compact'
  await page.locator(selector).click()
  await page.waitForTimeout(200)
  const labels = await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-title-content').allTextContents()
  await page.keyboard.press('Escape')
  return labels.map((label) => label.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

async function verifyCoreSettingsNavigation(page, viewportWidth, projectId) {
  const selector = viewportWidth > 1200
    ? '.workspace-contract-actions__more--desktop'
    : '.workspace-contract-actions__more--compact'
  await page.locator(selector).click()
  const navigationItem = page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')
    .filter({ hasText: '去基础设定' })
  await navigationItem.click()
  const expectedPath = `#/novels/${projectId}/core-settings`
  await page.waitForFunction((path) => window.location.hash.split('?')[0] === path, expectedPath, { timeout: 12000 })
  return expectedPath
}

function buildReport({ runId, projectId, results }) {
  const lines = [
    '# P0-01 共享信息栏、动作契约与迁移隔离验收',
    '',
    `- 运行编号：\`${runId}\``,
    `- Electron 项目：ID ${projectId}`,
    '- 迁移样板：`project-brief`；隔离对照：`structure`；全局入口：`/models`、`/templates`、`/prompts`、`/tasks`。',
    '- 契约：1 个主动作；桌面最多 2 个可见次动作；其余进入更多；窄屏次动作统一进入页面操作菜单。',
    '',
    '| 页面 | 视口 | 结果 | 共享标题 | 本地 Hero | 主动作 | 可见次动作 | 桌面更多 | 窄屏菜单 | 导航动作 | client/scroll | 截图 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const [key, viewports] of Object.entries(results)) {
    for (const [viewport, metric] of Object.entries(viewports)) {
      const result = metric.status === 'PASS' ? 'PASS' : `BLOCKED：${metric.reasons.join('；')}`
      if (metric.kind === 'global') {
        lines.push(`| ${key}（全局） | ${viewport} | ${result} | - | - | ${metric.actionCount} | ${metric.itemCount} | - | - | - | ${metric.clientWidth}/${metric.scrollWidth} | [截图](runs/${runId}/screenshots/${key}-${viewport}.png) |`)
      } else {
        lines.push(`| ${key} | ${viewport} | ${result} | ${metric.sharedTitle || '-'} | ${metric.localHeroPresent ? '是' : '否'} | ${metric.primaryActionCount} | ${metric.visibleSecondaryActionCount} | ${metric.desktopMoreVisible ? '是' : '否'} | ${metric.compactMoreVisible ? '是' : '否'} | ${metric.navigationActionVerified ? '通过' : '-'} | ${metric.clientWidth}/${metric.scrollWidth} | [截图](runs/${runId}/screenshots/${key}-${viewport}.png) |`)
      }
    }
  }
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const runId = timestampId()
  const projectId = resolveProjectId()
  const runDir = path.join(EVIDENCE_ROOT, 'runs', runId)
  const screenshotsDir = path.join(runDir, 'screenshots')
  fs.mkdirSync(screenshotsDir, { recursive: true })
  let app
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(REPO_ROOT, 'out/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RENDERER_URL: `file://${path.join(REPO_ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}`,
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2500)
    const results = { 'project-brief': {}, structure: {} }
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      const size = `${viewport.width}x${viewport.height}`
      console.log(`[P0-01] ${size} project-brief`)
      await navigate(page, `#/novels/${projectId}/project-brief`, '项目简报')
      results['project-brief'][size] = await measure(page, 'shared')
      const menuLabels = await inspectPageActionMenu(page, viewport.width)
      results['project-brief'][size].menuLabels = menuLabels
      const expectedMenuLabels = viewport.width > 1200
        ? ['去基础设定']
        : ['AI 生成·首版', 'AI 补全·空白字段', '去基础设定']
      const missingMenuLabels = expectedMenuLabels.filter((label) => !menuLabels.includes(label))
      if (missingMenuLabels.length > 0) {
        results['project-brief'][size].status = 'BLOCKED'
        results['project-brief'][size].reasons.push(`页面操作菜单缺少：${missingMenuLabels.join('、')}`)
      }
      if (missingMenuLabels.length === 0) {
        results['project-brief'][size].navigationTarget = await verifyCoreSettingsNavigation(page, viewport.width, projectId)
        results['project-brief'][size].navigationActionVerified = true
        await navigate(page, `#/novels/${projectId}/project-brief`, '项目简报')
      }
      await captureScreenshot(page, path.join(screenshotsDir, `project-brief-${size}.png`))
      console.log(`[P0-01] ${size} structure`)
      await navigate(page, `#/novels/${projectId}/structure`, '卷章结构')
      results.structure[size] = await measure(page, 'legacy')
      await captureScreenshot(page, path.join(screenshotsDir, `structure-${size}.png`))

      for (const route of GLOBAL_ROUTES) {
        const size = `${viewport.width}x${viewport.height}`
        console.log(`[P0-01] ${size} ${route.key}`)
        await navigateGlobal(page, route)
        const metric = await measureGlobal(page, route)
        metric.kind = 'global'
        results[route.key] ||= {}
        results[route.key][size] = metric
        await captureScreenshot(page, path.join(screenshotsDir, `${route.key}-${size}.png`))
      }
    }
    const measurements = Object.values(results).flatMap((item) => Object.values(item))
    const blocked = measurements.filter((item) => item.status !== 'PASS')
    const summary = {
      runId,
      capturedAt: new Date().toISOString(),
      projectId,
      pageCount: 2 + GLOBAL_ROUTES.length,
      viewportCount: VIEWPORTS.length,
      measurementCount: measurements.length,
      passCount: measurements.length - blocked.length,
      blockedCount: blocked.length,
      runtime: 'Electron production build',
    }
    const report = buildReport({ runId, projectId, results })
    writeJson(path.join(runDir, 'metrics.json'), results)
    writeJson(path.join(runDir, 'capture-summary.json'), summary)
    fs.writeFileSync(path.join(runDir, 'baseline.md'), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, 'latest-run.json'), { runId, runDirectory: `runs/${runId}`, capturedAt: summary.capturedAt })
    writeJson(path.join(EVIDENCE_ROOT, 'metrics.json'), results)
    writeJson(path.join(EVIDENCE_ROOT, 'capture-summary.json'), summary)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, 'baseline.md'), report, 'utf8')
    console.log(`[P0-01] ${summary.passCount} PASS / ${summary.blockedCount} BLOCKED`)
    if (blocked.length > 0) throw new Error(blocked.flatMap((item) => item.reasons).join('；'))
  } finally {
    if (app) await app.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error('[P0-01] FAILED', error)
  process.exitCode = 1
})
