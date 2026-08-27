const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'docs/ui-acceptance/P3-05')
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const RUN_DIR = path.join(EVIDENCE, 'runs', RUN_ID)
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8') }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }

function staticContracts() {
  const prompts = read('src/pages/PromptManager/index.tsx')
  const promptCss = read('src/pages/PromptManager/index.css')
  const tasks = read('src/pages/TaskCenter/index.tsx')
  const taskCss = read('src/pages/TaskCenter/index.css')
  const checks = [
    ['提示词目录使用可选择的紧凑列表', prompts.includes('data-p3-05-prompt-list') && prompts.includes('prompt-manager-card__summary')],
    ['提示词高级信息默认折叠', prompts.includes('data-p3-05-prompt-details') && prompts.includes('<details')],
    ['提示词保留编辑与全文预览入口', prompts.includes('setPreviewModalOpen(true)') && prompts.includes('setEditModalOpen(true)')],
    ['提示词本地样式限制目录密度', promptCss.includes('prompt-manager-card-grid') && promptCss.includes('grid-template-columns: minmax(0, 1fr) auto')],
    ['任务中心保留任务选择与恢复动作', tasks.includes('setSelectedId(task.id)') && tasks.includes('handleResume') && tasks.includes('handleRetry')],
    ['任务输出具有局部滚动标记', tasks.includes('data-p3-05-task-log') && taskCss.includes('overscroll-behavior: contain')],
    ['任务列表具有验收定位标记', tasks.includes('data-p3-05-task-list')],
    ['任务页在桌面保持主从布局', taskCss.includes('@media (min-width: 1100px)') && taskCss.includes('grid-template-columns: minmax(300px, 0.76fr) minmax(0, 1.24fr)')],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
  if (failed.length) throw new Error(`P3-05 静态契约失败：${failed.join('、')}`)
  return checks.map(([label]) => label)
}

async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(ROOT, 'out/main/main.js'), '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: `file://${path.join(ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}` },
  })
}

async function navigate(page, route) {
  await page.evaluate(({ hash }) => {
    localStorage.setItem('novelforge-workbench-view-mode', 'professional')
    window.location.hash = hash
  }, { hash: `#${route}` })
  await page.waitForTimeout(900)
}

async function measure(page, selector, viewport) {
  return page.evaluate(({ selector, viewport }) => {
    const root = document.querySelector(selector)
    const doc = document.documentElement
    const body = document.body
    const visible = (node) => {
      if (!node) return false
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).display !== 'none'
    }
    const logs = root ? [...root.querySelectorAll('[data-p3-05-task-log]')] : []
    return {
      status: root && Math.max(doc.scrollWidth, body.scrollWidth) <= doc.clientWidth + 1 ? 'PASS' : 'BLOCKED',
      viewport,
      clientWidth: doc.clientWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      pageHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      actionCount: [...document.querySelectorAll('.novel-hero__actions .ant-btn, .prompt-manager-inspector-actions .ant-btn, .task-center-detail__actions .ant-btn')].filter(visible).length,
      itemCount: root?.querySelectorAll('[data-p3-05-prompt-list] .prompt-manager-card, [data-p3-05-task-list] .novel-list-card').length || 0,
      disclosureCount: root?.querySelectorAll('details, .ant-collapse-item').length || 0,
      boundedLogCount: logs.filter((node) => node.scrollHeight > node.clientHeight + 1).length,
    }
  }, { selector, viewport })
}

async function selectOption(page, index, label) {
  const control = page.locator('.task-center-filter-control').nth(index)
  await control.click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).first().click()
  await page.waitForTimeout(650)
}

async function interactions(page) {
  const result = {}

  await navigate(page, '/prompts')
  const promptList = page.locator('[data-p3-05-prompt-list]')
  result.promptListPresent = await promptList.count() === 1 && await promptList.locator('.prompt-manager-card').count() > 0
  result.promptCardsCompact = await promptList.locator('.prompt-manager-card__preview').count() === 0
  if (result.promptListPresent) await promptList.locator('button.prompt-manager-card').first().click()
  const promptDetails = page.locator('[data-p3-05-prompt-details]')
  result.promptDetailsCollapsed = await promptDetails.count() === 1 && await promptDetails.evaluate((node) => !node.open).catch(() => false)
  if (result.promptDetailsCollapsed) {
    await promptDetails.locator('summary').click()
    result.promptDetailsReveal = await promptDetails.evaluate((node) => node.open).catch(() => false)
  } else result.promptDetailsReveal = false
  const preview = page.getByRole('button', { name: '展开全文', exact: true })
  result.promptPreviewEntry = await preview.count() === 1
  if (result.promptPreviewEntry) {
    await preview.click()
    result.promptPreviewOpen = await page.locator('.ant-modal:visible .prompt-manager-template-preview--modal').count() === 1
    await page.locator('.ant-modal-close:visible').last().click().catch(() => undefined)
  } else result.promptPreviewOpen = false
  const edit = page.locator('.prompt-manager-inspector-actions button').filter({ hasText: '编辑' }).first()
  result.promptEditEntry = await edit.count() === 1
  if (result.promptEditEntry) {
    await edit.click()
    result.promptEditPreview = await page.locator('.ant-modal:visible textarea').inputValue().then((value) => value.length > 0).catch(() => false)
    await page.locator('.ant-modal-close:visible').last().click().catch(() => undefined)
  } else result.promptEditPreview = false

  await navigate(page, '/tasks')
  const taskList = page.locator('[data-p3-05-task-list]')
  result.taskListPresent = await taskList.count() === 1 && await taskList.locator('.novel-list-card').count() > 0
  if (result.taskListPresent) {
    const cards = taskList.locator('.novel-list-card')
    const count = await cards.count()
    await cards.nth(Math.min(1, count - 1)).click()
    await page.waitForTimeout(250)
  }
  result.taskDetailSelection = await page.locator('.task-center-detail-panel .task-center-detail').count() === 1
  const outputSection = page.locator('.ant-collapse-item').filter({ hasText: '请求上下文' }).first()
  if (await outputSection.count()) await outputSection.locator('.ant-collapse-header').click().catch(() => undefined)
  const outputLog = page.locator('[data-p3-05-task-log]').first()
  result.taskLongLogLocalScroll = await outputLog.count() === 1 && await outputLog.evaluate((node) => {
    const style = getComputedStyle(node)
    return style.overflowY === 'auto' && style.maxHeight !== 'none'
  }).catch(() => false)

  // Move to the second page where the real fixture contains a retryable failed task.
  const pageTwo = page.locator('.ant-pagination-item').filter({ hasText: '2' }).first()
  if (await pageTwo.count()) {
    await pageTwo.click()
    await page.waitForTimeout(700)
  }
  const retryableCard = page.locator('[data-p3-05-task-list] .novel-list-card').filter({ hasText: '可重试' }).first()
  result.taskRecoveryEntry = await retryableCard.count() === 1
  if (result.taskRecoveryEntry) {
    await retryableCard.click()
    await page.waitForTimeout(200)
    result.taskRecoveryAction = await page.locator('.task-center-detail__actions button').filter({ hasText: '重试' }).count() === 1
  } else result.taskRecoveryAction = false
  return result
}

function buildReport(staticList, interactionsResult, metrics, taskData) {
  const lines = [
    '# P3-05 改后 Electron 验收',
    '',
    `- 运行编号：\`${RUN_ID}\``,
    `- 真实数据：提示词覆盖 ${taskData.promptOverrides} 条；任务记录 ${taskData.taskTotal} 条。`,
    '',
    '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const [key, values] of Object.entries(metrics)) {
    const title = key === 'prompts' ? '提示词控制台' : '任务中心'
    lines.push(`| ${title} | ${VIEWPORTS.map((viewport) => { const item = values[`${viewport.width}x${viewport.height}`]; return `${item.clientWidth}/${item.scrollWidth}; H${Math.round(item.pageHeight)}; A${item.actionCount}; I${item.itemCount}; D${item.disclosureCount}; L${item.boundedLogCount}; ${item.status}` }).join(' | ')} |`)
  }
  lines.push(
    '',
    `- 静态契约：${staticList.length}/${staticList.length} PASS`,
    `- 交互检查：${Object.values(interactionsResult).filter(Boolean).length}/${Object.keys(interactionsResult).length} PASS`,
    '- 数据保护：本轮仅执行筛选、选择、折叠与编辑预览；未保存提示词、未点击重试或恢复，不触发模型调用或业务写入。',
  )
  return lines.join('\n')
}

async function main() {
  const staticList = staticContracts()
  fs.mkdirSync(path.join(RUN_DIR, 'screenshots'), { recursive: true })
  let app
  try {
    app = await launch()
    const page = await app.firstWindow({ timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    const taskData = await page.evaluate(async () => {
      const [tasks, prompts] = await Promise.all([
        window.electron.task.query({ page: 1, pageSize: 10 }),
        window.electron.prompt.list(),
      ])
      return { taskTotal: tasks.total, promptOverrides: prompts.length }
    })
    const metrics = { prompts: {}, tasks: {} }
    const routes = { prompts: ['/prompts', '.prompt-manager-page'], tasks: ['/tasks', '.task-center-page'] }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      for (const [key, [route, selector]] of Object.entries(routes)) {
        await navigate(page, route)
        metrics[key][`${viewport.width}x${viewport.height}`] = await measure(page, selector, viewport)
        await page.screenshot({ path: path.join(RUN_DIR, 'screenshots', `${key}-${viewport.width}x${viewport.height}.png`), fullPage: false, timeout: 120000 })
      }
    }
    await page.setViewportSize(VIEWPORTS[0])
    const interactionsResult = await interactions(page)
    writeJson(path.join(RUN_DIR, 'metrics.json'), metrics)
    writeJson(path.join(RUN_DIR, 'interactions.json'), interactionsResult)
    fs.writeFileSync(path.join(RUN_DIR, 'after.md'), `${buildReport(staticList, interactionsResult, metrics, taskData)}\n`, 'utf8')
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.copyFileSync(path.join(RUN_DIR, 'after.md'), path.join(EVIDENCE, 'after.md'))
    fs.copyFileSync(path.join(RUN_DIR, 'interactions.json'), path.join(EVIDENCE, 'after-interactions.json'))
    fs.writeFileSync(path.join(EVIDENCE, 'latest-run.json'), `${JSON.stringify({ runId: RUN_ID, runDir: path.relative(ROOT, RUN_DIR) }, null, 2)}\n`, 'utf8')
    const failed = Object.entries(interactionsResult).filter(([, value]) => !value).map(([key]) => key)
    const blocked = Object.values(metrics).flatMap((group) => Object.values(group)).filter((item) => item.status !== 'PASS')
    console.log(`[P3-05] ${failed.length || blocked.length ? 'BLOCKED' : 'PASS'}; static ${staticList.length}/${staticList.length}; interactions ${Object.keys(interactionsResult).length - failed.length}/${Object.keys(interactionsResult).length}; run=${RUN_ID}`)
    if (failed.length || blocked.length) {
      console.error(`失败项：${failed.join('、')}`)
      process.exitCode = 1
    }
  } finally {
    if (app) await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
    if (app) await app.close().catch(() => undefined)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
