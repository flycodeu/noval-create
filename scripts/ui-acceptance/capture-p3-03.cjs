const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'docs/ui-acceptance/P3-03')
const PROJECT_SUMMARY = path.join(ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const RUN_DIR = path.join(EVIDENCE, 'runs', RUN_ID)

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8') }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function projectId() {
  const requested = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 0)
  if (requested > 0) return requested
  return Number(JSON.parse(fs.readFileSync(PROJECT_SUMMARY, 'utf8')).project.id)
}
function staticContracts() {
  const revision = read('src/pages/Novel/RevisionCenter/index.tsx')
  const revisionCss = read('src/pages/Novel/RevisionCenter/RevisionCenter.css')
  const quality = read('src/pages/Novel/QualityDashboard/index.tsx')
  const priority = read('src/pages/Novel/QualityDashboard/sections/QualityPriorityPanel.tsx')
  const checks = [
    ['修订队列使用单一当前任务', revision.includes('data-revision-workspace') && revision.includes('data-revision-current-task')],
    ['修订诊断按需展开', revision.includes('data-revision-diagnostics') && revision.includes('<details')],
    ['修订保留定位与状态动作', revision.includes('openRelatedPage') && revision.includes('handleQuickStatus')],
    ['修订工作区具备主从响应式样式', revisionCss.includes('revision-workspace') && revisionCss.includes('@media')],
    ['质量页首屏聚焦重点风险', quality.includes('QualityPriorityPanel') && quality.includes('key: \'overview\'')],
    ['质量页完整诊断按需进入', quality.includes("key: 'analysis'") && quality.includes('data-quality-analysis')],
    ['最高风险限制为三项', priority.includes('.slice(0, 3)') && priority.includes('data-quality-priority-risks')],
    ['质量风险可进入修订队列', priority.includes('onOpenRevisionQueue') && quality.includes('openRevisionQueue')],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
  if (failed.length) throw new Error(`P3-03 静态契约失败：${failed.join('、')}`)
  return checks.map(([label]) => label)
}
async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(ROOT, 'out/main/main.js'), '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: `file://${path.join(ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}` },
  })
}
async function navigate(page, id, route) {
  await page.evaluate(({ hash }) => { localStorage.setItem('novelforge-workbench-view-mode', 'professional'); window.location.hash = hash }, { hash: `#/novels/${id}/${route}` })
  await page.waitForTimeout(900)
}
async function measure(page, selector, viewport) {
  return page.evaluate(({ selector, viewport }) => {
    const root = document.querySelector(selector)
    const visible = (node) => { if (!node) return false; const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(node).display !== 'none' }
    const body = document.body
    const doc = document.documentElement
    const details = root ? [...root.querySelectorAll('details')] : []
    return {
      status: root && doc.scrollWidth <= doc.clientWidth + 1 && body.scrollWidth <= doc.clientWidth + 1 ? 'PASS' : 'BLOCKED',
      viewport,
      clientWidth: doc.clientWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      pageHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      actionCount: [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(visible).length,
      currentCount: root?.querySelectorAll('[data-revision-current-task], [data-quality-priority]').length || 0,
      disclosureCount: details.length,
      openDisclosureCount: details.filter((item) => item.open).length,
      boundedScrollCount: root ? [...root.querySelectorAll('[class*="list"], [class*="chapter"]')].filter((node) => node.scrollHeight > node.clientHeight + 2).length : 0,
    }
  }, { selector, viewport })
}
async function interactions(page, id) {
  const result = {}
  await navigate(page, id, 'quality')
  const quality = page.locator('[data-quality-dashboard-page], .quality-dashboard-page, .novel-workspace').last()
  result.qualityPriorityPresent = await page.locator('[data-quality-priority]').count() === 1
  result.qualityRiskLimit = await page.locator('[data-quality-priority-risks] article').count().then((count) => count <= 3)
  result.qualityAnalysisDeferred = await page.locator('[data-quality-analysis]').count() === 0
  const revisionButton = page.getByRole('button', { name: '进入修订队列', exact: true })
  result.qualityRevisionAction = await revisionButton.count() === 1
  if (result.qualityRevisionAction) {
    await revisionButton.click()
    await page.waitForTimeout(650)
    result.qualityRevisionNavigation = await page.locator('[data-revision-workspace]').count() === 1
  } else result.qualityRevisionNavigation = false
  await navigate(page, id, 'quality')
  const analysisTab = page.getByRole('tab', { name: '完整诊断', exact: true })
  result.qualityAnalysisAction = await analysisTab.count() === 1
  if (result.qualityAnalysisAction) {
    await analysisTab.click()
    result.qualityAnalysisRevealed = await page.locator('[data-quality-analysis]').count() === 1
    result.qualityFilterPresent = await page.locator('[data-quality-analysis] .quality-dashboard-page__filter-bar').count() === 1
  } else { result.qualityAnalysisRevealed = false; result.qualityFilterPresent = false }
  await navigate(page, id, 'revision')
  const revision = page.locator('[data-revision-workspace]')
  result.revisionQueuePresent = await revision.count() === 1
  result.revisionCurrentTaskPresent = await page.locator('[data-revision-current-task]').count() === 1
  result.revisionDiagnosticsCollapsed = await page.locator('[data-revision-diagnostics]').evaluate((node) => !node.open).catch(() => false)
  result.revisionTaskActions = await page.locator('[data-revision-task-actions]').count() === 1
  if (result.revisionDiagnosticsCollapsed) {
    await page.locator('[data-revision-diagnostics] summary').click()
    result.revisionDiagnosticsRevealed = await page.locator('[data-revision-diagnostics][open]').count() === 1
  } else result.revisionDiagnosticsRevealed = false
  return result
}
function report(id, metrics, staticList, interactionResult) {
  const lines = [`# P3-03 改后 Electron 验收`, '', `- 运行编号：\`${RUN_ID}\``, `- 项目 ID：\`${id}\``, '', '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |', '| --- | --- | --- | --- | --- |']
  for (const [key, values] of Object.entries(metrics)) {
    lines.push(`| ${key === 'revision' ? '修订中心' : '质量监控'} | ${VIEWPORTS.map((v) => { const item = values[`${v.width}x${v.height}`]; return `${item.clientWidth}/${item.scrollWidth}; H${Math.round(item.pageHeight)}; A${item.actionCount}; C${item.currentCount}; D${item.disclosureCount}; ${item.status}` }).join(' | ')} |`)
  }
  lines.push('', `- 静态契约：${staticList.length}/${staticList.length} PASS`, `- 交互检查：${Object.values(interactionResult).filter(Boolean).length}/${Object.keys(interactionResult).length} PASS`, '- 数据保护：本轮仅执行只读导航与展开检查，未写入业务数据。')
  return lines.join('\n')
}
async function main() {
  const id = projectId()
  const staticList = staticContracts()
  fs.mkdirSync(path.join(RUN_DIR, 'screenshots'), { recursive: true })
  let app
  try {
    app = await launch()
    const page = await app.firstWindow({ timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    const metrics = { revision: {}, quality: {} }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await navigate(page, id, 'revision')
      metrics.revision[`${viewport.width}x${viewport.height}`] = await measure(page, '[data-revision-page], .novel-revision-center-page', viewport)
      await page.screenshot({ path: path.join(RUN_DIR, 'screenshots', `revision-${viewport.width}x${viewport.height}.png`), fullPage: true })
      await navigate(page, id, 'quality')
      metrics.quality[`${viewport.width}x${viewport.height}`] = await measure(page, '[data-quality-dashboard-page], .quality-dashboard-page', viewport)
      await page.screenshot({ path: path.join(RUN_DIR, 'screenshots', `quality-${viewport.width}x${viewport.height}.png`), fullPage: true })
    }
    const interactionResult = await interactions(page, id)
    write(path.join(RUN_DIR, 'metrics.json'), metrics)
    write(path.join(RUN_DIR, 'interactions.json'), interactionResult)
    fs.writeFileSync(path.join(RUN_DIR, 'after.md'), `${report(id, metrics, staticList, interactionResult)}\n`, 'utf8')
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE, 'after.md'), fs.readFileSync(path.join(RUN_DIR, 'after.md')), 'utf8')
    fs.writeFileSync(path.join(EVIDENCE, 'after-interactions.json'), fs.readFileSync(path.join(RUN_DIR, 'interactions.json')), 'utf8')
    fs.writeFileSync(path.join(EVIDENCE, 'latest-run.json'), `${JSON.stringify({ runId: RUN_ID, runDir: path.relative(ROOT, RUN_DIR) }, null, 2)}\n`, 'utf8')
    const failed = Object.entries(interactionResult).filter(([, value]) => !value).map(([key]) => key)
    const blocked = Object.values(metrics).flatMap((group) => Object.values(group)).filter((item) => item.status !== 'PASS')
    console.log(`[P3-03] ${blocked.length ? 'BLOCKED' : 'PASS'}; static ${staticList.length}/${staticList.length}; interactions ${Object.keys(interactionResult).length - failed.length}/${Object.keys(interactionResult).length}; run=${RUN_ID}`)
    if (failed.length || blocked.length) { console.error(`失败项：${failed.join('、')}`); process.exitCode = 1 }
  } finally {
    if (app) await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
    if (app) await app.close().catch(() => undefined)
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
