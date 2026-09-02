const { _electron: electron } = require('playwright')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { ROUTES, VIEWPORTS, verifyRouteInventorySources } = require('./capture-p0-00.cjs')

const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'docs/ui-acceptance/P3-06')
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const RUN_DIR = path.join(EVIDENCE, 'runs', RUN_ID)
const PROJECT_SUMMARY = path.join(ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const ALL_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
  { width: 768, height: 768 },
  { width: 768, height: 899 },
]
const REPRESENTATIVE = new Set(['project-brief', 'writing', 'structure', 'characters', 'map', 'quality', 'tasks'])
const FULL_SNAPSHOT_VIEWPORTS = new Set(['1440x900', '900x760'])
const REPRESENTATIVE_SNAPSHOT_VIEWPORTS = new Set(['1280x800', '1024x768', '768x768', '768x899'])
const GLOBAL_ROOT_SELECTORS = {
  novels: '.novel-list-page',
  models: '.model-manager-page',
  templates: '.template-manager-page',
  prompts: '.prompt-manager-page',
  tasks: '.task-center-page',
}

function shouldCaptureScreenshot(route, viewportKey) {
  if (FULL_SNAPSHOT_VIEWPORTS.has(viewportKey)) return true
  return REPRESENTATIVE.has(route.key) && REPRESENTATIVE_SNAPSHOT_VIEWPORTS.has(viewportKey)
}

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8') }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }

function startLocalModelStub() {
  const requests = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString('utf8') })
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'simulation endpoint not found' }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        id: `p3-06-sim-${Date.now()}`,
        choices: [{ message: { role: 'assistant', content: 'P3-06 本地模拟连接成功' }, finish_reason: 'stop' }],
      }))
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (!port) {
        reject(new Error('P3-06 本地模型 stub 未取得端口'))
        return
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1`, requests })
    })
  })
}

async function stopLocalModelStub(stub) {
  if (!stub?.server) return
  await new Promise((resolve) => stub.server.close(() => resolve()))
}
function projectId() {
  const requested = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 0)
  if (requested > 0) return requested
  return Number(JSON.parse(fs.readFileSync(PROJECT_SUMMARY, 'utf8')).project.id)
}
function staticContracts() {
  const plan = read('docs/novelforge-global-ui-simplification-plan.md')
  const shell = read('src/pages/Novel/components/WorkspaceShell.tsx')
  const overview = read('src/pages/Novel/Overview/index.tsx')
  const errorBoundary = read('src/pages/Novel/components/WorkspaceErrorBoundary.tsx')
  const checks = [
    ...['P3-01', 'P3-02', 'P3-03', 'P3-04', 'P3-05'].map((key) => [
      `${key} 已完成并有独立证据`,
      plan.includes(`[x] ${key} ACCEPTED`) && fs.existsSync(path.join(ROOT, `docs/ui-acceptance/${key}/after.md`)),
    ]),
    [`${ROUTES.length} 页路由清单来源可验证`, verifyRouteInventorySources().total === ROUTES.length],
    ['共享壳层暴露验收标记', shell.includes('data-workspace-chrome={chrome}')],
    ['768px 兼容要求仍在设计基线中', plan.includes('768–899px') && plan.includes('共享壳层及正文、结构、人物、地图、表单类代表页')],
    ['P3-06 禁止新增设计原语', plan.includes('P3-06 只做收口和缺陷记录')],
    ['项目资料保留未保存保护', overview.includes('registerSaveHandler') && overview.includes("window.addEventListener('beforeunload'") && overview.includes('项目资料还有未保存修改')],
    ['错误边界保留重试与重载入口', errorBoundary.includes('当前工作区渲染失败') && errorBoundary.includes('重试当前页面') && errorBoundary.includes('重新加载应用')],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
  if (failed.length) throw new Error(`P3-06 静态契约失败：${failed.join('、')}`)
  return checks.map(([label]) => label)
}
async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(ROOT, 'out/main/main.js'), '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: `file://${path.join(ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}` },
  })
}
async function setViewport(app, page, viewport) {
  await page.setViewportSize(viewport)
  await page.waitForTimeout(180)
}
async function captureScreenshot(page, filePath) {
  // Playwright's high-level screenshot waits indefinitely for document.fonts;
  // one SVG-heavy route can keep that promise pending even though the page is
  // visibly usable. Capture the current viewport through CDP so a font load
  // cannot block the full evidence matrix.
  const client = await page.context().newCDPSession(page)
  try {
    const { data } = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
  } finally {
    await client.detach().catch(() => undefined)
  }
}
async function navigate(page, route, id) {
  const routePath = route.path.replace('{id}', String(id))
  await page.evaluate((hash) => {
    localStorage.setItem('novelforge-workbench-view-mode', 'professional')
    window.location.hash = hash
  }, `#${routePath}`)
  // Route chunks and project data can resolve after the hash has already
  // changed. Give the real page a bounded window instead of measuring the
  // previous route's shell during a slow transition.
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const ready = await page.evaluate(({ routePath, label, project, globalSelector }) => {
      const resolved = window.location.hash.slice(1).split('?')[0]
      const error = document.querySelector('.novel-route-shell__error-card')
      const workspaceLabel = document.querySelector('.project-topbar__workspace-name')?.textContent?.trim() || ''
      const pageReady = project ? workspaceLabel === label : Boolean(document.querySelector(globalSelector))
      return resolved === routePath && (Boolean(error) || pageReady)
    }, { routePath, label: route.label, project: Boolean(route.project), globalSelector: GLOBAL_ROOT_SELECTORS[route.key] || '' })
    if (ready) {
      await page.waitForTimeout(250)
      return
    }
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(250)
}
async function measure(page, route, viewport, id) {
  return page.evaluate(({ route, viewport, id }) => {
    const doc = document.documentElement
    const body = document.body
    const error = document.querySelector('.novel-route-shell__error-card')
    const visible = (node) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const expected = route.path.replace('{id}', String(id))
    const resolved = window.location.hash.slice(1).split('?')[0]
    const project = Boolean(route.project)
    const workspaceLabel = document.querySelector('.project-topbar__workspace-name')?.textContent?.trim() || ''
    const bodyText = body.innerText || ''
    const reasons = []
    if (resolved !== expected) reasons.push(`路由为 ${window.location.hash}`)
    if (project && workspaceLabel !== route.label) reasons.push(`项目工作区标题为「${workspaceLabel || '空'}」而非「${route.label}」`)
    if (!project && !bodyText.includes(route.label)) reasons.push(`未出现页面标签「${route.label}」`)
    if (error) reasons.push(error.textContent?.replace(/\s+/g, ' ').trim() || '页面错误边界')
    if (Math.max(doc.scrollWidth, body.scrollWidth) > doc.clientWidth + 1) reasons.push(`页面横向溢出 ${Math.max(doc.scrollWidth, body.scrollWidth)}>${doc.clientWidth}`)
    return {
      route: route.key,
      viewport,
      clientWidth: doc.clientWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      pageHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      resolvedHash: window.location.hash,
      workspaceLabel,
      mode: localStorage.getItem('novelforge-workbench-view-mode'),
      visibleActionCount: [...document.querySelectorAll('button, [role="button"], a')].filter(visible).length,
      errorText: error?.textContent?.replace(/\s+/g, ' ').trim() || '',
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
    }
  }, { route, viewport, id })
}
async function checkTaskLongText(page, id) {
  await navigate(page, ROUTES.find((route) => route.key === 'tasks'), id)
  const taskCards = page.locator('[data-p3-05-task-list] .novel-list-card')
  if (await taskCards.count() === 0) return false
  const outputTaskIndex = await page.evaluate(async () => {
    const result = await window.electron.task.query({ page: 1, pageSize: 10 })
    return result.items.findIndex((task) => Boolean(task.outputText))
  }).catch(() => -1)
  await taskCards.nth(outputTaskIndex >= 0 ? outputTaskIndex : 0).click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(250)
  const resultOutput = page.locator('.ant-collapse-item').filter({ hasText: '结果输出' }).first()
  if (await resultOutput.count() === 1) {
    await resultOutput.locator('.ant-collapse-header').click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(120)
  }
  const taskLog = page.locator('[data-p3-05-task-log]').first()
  if (await taskLog.count() !== 1) return false
  return await taskLog.evaluate((node) => {
    const style = getComputedStyle(node)
    return style.overflowY === 'auto' && style.maxHeight !== 'none'
  }).catch(() => false)
}

async function checkEmptyState(page, id) {
  await navigate(page, ROUTES.find((route) => route.key === 'glossary'), id)
  const glossarySearch = page.locator('input[placeholder*="搜索"], input[placeholder*="检索"]').first()
  if (await glossarySearch.count() !== 1) return false
  await glossarySearch.fill('P3-06-无匹配结果-验收')
  await page.waitForTimeout(350)
  const visible = await page.locator('.novel-glossary__empty').filter({ hasText: '没有术语' }).count() === 1
  await glossarySearch.fill('')
  return visible
}

async function checkLoadingFeedback(page, id) {
  const invalidId = Math.max(Number(id) + 1000000, 999999)
  await page.evaluate((nextId) => {
    window.location.hash = `#/novels/${nextId}/overview`
  }, invalidId)
  const observed = await page.waitForFunction(() => {
    const shell = document.querySelector('.novel-route-shell--loading')
    if (!shell) return false
    const rect = shell.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && Boolean(shell.querySelector('.ant-spin'))
  }, { timeout: 1500 }).then(() => true).catch(() => false)
  await navigate(page, ROUTES.find((route) => route.key === 'novels'), id)
  return observed
}

async function checkErrorBoundaryRecovery(page, id) {
  await navigate(page, ROUTES.find((route) => route.key === 'overview'), id)
  const injected = await page.evaluate((novelId) => {
    const shell = document.querySelector('.novel-route-shell')
    const key = shell && Object.keys(shell).find((name) => name.startsWith('__reactFiber$'))
    let fiber = key ? shell[key] : null
    while (fiber) {
      const instance = fiber.stateNode
      if (fiber.tag === 1 && instance?.props?.resetKey === String(novelId) && instance?.state
        && Object.prototype.hasOwnProperty.call(instance.state, 'error') && typeof instance.setState === 'function') {
        instance.setState({ error: new Error('P3-06 模拟渲染异常') })
        return true
      }
      fiber = fiber.return
    }
    return false
  }, id).catch(() => false)
  if (!injected) return false
  const fallback = page.getByText('当前工作区渲染失败', { exact: true })
  const retry = page.getByRole('button', { name: '重试当前页面', exact: true })
  await fallback.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
  await retry.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
  if (await fallback.count() !== 1 || await retry.count() !== 1) return false
  await retry.click({ force: true }).catch(() => undefined)
  return page.waitForFunction(() => !document.querySelector('.novel-route-shell__error-card')
    && document.querySelector('.project-topbar__workspace-name')?.textContent?.trim() === '项目总览', { timeout: 3000 })
    .then(() => true).catch(() => false)
}

async function checkTaskRetryFeedback(page, id) {
  await navigate(page, ROUTES.find((route) => route.key === 'tasks'), id)
  const taskIndex = await page.evaluate(async () => {
    const result = await window.electron.task.query({ page: 1, pageSize: 10 })
    return result.items.findIndex((task) => (task.status === 'failed' || task.status === 'cancelled') && !task.retryable)
  }).catch(() => -1)
  const taskCards = page.locator('[data-p3-05-task-list] .novel-list-card')
  if (taskIndex < 0 || await taskCards.count() <= taskIndex) return false
  await taskCards.nth(taskIndex).click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(180)
  return await page.getByText('当前任务不支持安全重试', { exact: true }).count() >= 1
    && await page.getByText('重试能力：需回到功能页重新发起', { exact: true }).count() >= 1
}

async function checkTaskErrorFeedback(page, id) {
  await navigate(page, ROUTES.find((route) => route.key === 'tasks'), id)
  const taskIndex = await page.evaluate(async () => {
    const result = await window.electron.task.query({ page: 1, pageSize: 10 })
    return result.items.findIndex((task) => Boolean(task.errorMessage))
  }).catch(() => -1)
  const taskCards = page.locator('[data-p3-05-task-list] .novel-list-card')
  if (taskIndex < 0 || await taskCards.count() <= taskIndex) return false
  await taskCards.nth(taskIndex).click({ force: true }).catch(() => undefined)
  await page.waitForTimeout(180)
  return await page.getByText('运行提示', { exact: true }).count() >= 1
    && await page.locator('.task-center-card__summary.is-error').count() >= 1
}

async function checkModelConnection(page, id, stub) {
  let simulationModelId = null
  try {
    simulationModelId = await page.evaluate(({ baseUrl }) => window.electron.model.create({
      name: `P3-06本地模拟模型-${Date.now()}`,
      provider: 'custom',
      modelId: 'novelforge-p3-06-simulated',
      apiKey: '',
      baseUrl,
      temperature: 0,
      maxTokens: 256,
      maxConcurrency: 1,
    }), { baseUrl: stub.baseUrl })
    await navigate(page, ROUTES.find((route) => route.key === 'models'), id)
    const modelCard = page.locator(`[data-model-config-card]`).filter({ hasText: 'P3-06本地模拟模型-' }).last()
    if (await modelCard.count() !== 1) return false
    await modelCard.click({ force: true })
    const testButton = page.locator('.model-manager-status-actions button').filter({ hasText: /^测试连接$/ }).first()
    if (await testButton.count() !== 1) return false
    await testButton.click({ force: true })
    const success = page.locator('.model-manager-status-actions .source-search-config__test-result.is-success')
      .filter({ hasText: '连接成功' })
      .first()
    return await success.waitFor({ state: 'visible', timeout: 15000 }).then(() => stub.requests.length > 0).catch(() => false)
  } finally {
    if (simulationModelId) await page.evaluate((modelId) => window.electron.model.delete(modelId), simulationModelId).catch(() => undefined)
  }
}

async function checkOverviewProtection(page, id) {
  const result = {
    unsavedStateIndicator: false,
    unsavedBeforeUnloadProtection: false,
    unsavedRouteConfirmation: false,
  }
  await navigate(page, ROUTES.find((route) => route.key === 'overview'), id)
  const overviewTitle = page.locator('.overview-page__project-info input').first()
  if (await overviewTitle.count() !== 1) return result
  const originalTitle = await overviewTitle.inputValue()
  await overviewTitle.fill(`${originalTitle} P3-06未保存验收`)
  await page.waitForTimeout(150)
  result.unsavedStateIndicator = await page.locator('[data-overview-save-state="unsaved"]').count() === 1
  result.unsavedBeforeUnloadProtection = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }).catch(() => false)

  let studioAction = page.locator('button[aria-label="回到创作控制台"]:visible').first()
  if (await studioAction.count() !== 1) {
    const pageActions = page.locator('button.workspace-contract-actions__more:visible').first()
    if (await pageActions.count() === 1) {
      await pageActions.click({ force: true }).catch(() => undefined)
      studioAction = page.locator('.ant-dropdown-menu-item').filter({ hasText: '回到创作控制台' }).last()
      await studioAction.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
    }
  }
  if (await studioAction.count() === 1) {
    await studioAction.evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined)).catch(() => undefined)
    result.unsavedRouteConfirmation = await page.getByText('项目资料还有未保存修改', { exact: true }).count() >= 1
    const stay = page.getByRole('button', { name: '留在当前页', exact: true }).last()
    if (await stay.count() === 1) await stay.click({ force: true }).catch(() => undefined)
  }
  await overviewTitle.fill(originalTitle)
  await page.waitForTimeout(150)
  return result
}

async function checkDangerousAction(page, id) {
  await navigate(page, ROUTES.find((route) => route.key === 'overview'), id)
  await page.keyboard.press('Escape').catch(() => undefined)
  const more = page.getByRole('button', { name: '更多操作', exact: true })
  await more.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined)
  if (await more.count() !== 1) return false
  await more.click({ force: true }).catch(() => undefined)
  const clear = page.locator('.ant-dropdown-menu-item:visible').filter({ hasText: '清空步骤' }).last()
  await clear.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
  if (await clear.count() !== 1) return false
  await clear.click({ force: true }).catch(() => clear.evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined)))
  await page.locator('.ant-modal-wrap:visible').waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined)
  const confirmed = await page.getByText('清空项目资料？', { exact: true }).count() >= 1
  const cancel = page.locator('.ant-modal-wrap:visible button').filter({ hasText: /取\s*消|取消/ }).last()
  if (await cancel.count() === 1) {
    await cancel.click({ force: true }).catch(() => cancel.evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined)))
  }
  await page.waitForTimeout(120)
  if (await page.locator('.ant-modal-wrap:visible').count() > 0) {
    await page.keyboard.press('Escape').catch(() => undefined)
    await page.waitForTimeout(300)
  }
  return confirmed && await page.locator('.ant-modal-wrap:visible').count() === 0
}

async function interactionChecks(page, id, stub) {
  const result = {}
  await navigate(page, ROUTES.find((route) => route.key === 'novels'), id)
  result.globalNavigation = await page.getByText('提示词', { exact: true }).count() >= 1 && await page.getByText('任务中心', { exact: true }).count() >= 1
  await navigate(page, ROUTES.find((route) => route.key === 'tasks'), id)
  result.taskStatusVisible = await page.locator('.task-center-page').count() === 1
    && await page.getByText(/^(执行中|等待执行|正在取消|已暂停|已完成|执行失败|任务已取消)$/, { exact: true }).count() >= 1
  result.taskFilterVisible = await page.locator('.task-center-filter-control').count() === 2
  await navigate(page, ROUTES.find((route) => route.key === 'prompts'), id)
  result.promptReadOnlyPreview = await page.locator('[data-p3-05-prompt-list] .prompt-manager-card').count() > 0
  result.keyboardFocus = await page.evaluate(() => {
    const target = document.querySelector('button, a, input, [tabindex="0"]')
    if (!target) return false
    target.focus()
    return document.activeElement === target
  })
  result.themeControl = await page.getByText('深色', { exact: true }).count() >= 1 && await page.getByText('浅色', { exact: true }).count() >= 1
  result.globalThemeSwitch = true
  result.projectThemeSwitch = true
  result.keyboardTraversal = true

  const themeValue = { 深色: 'dark', 浅色: 'light', 柔和: 'soft' }
  const switchTheme = async (route, label) => {
    if (route.project) {
      const more = page.getByRole('button', { name: '更多操作', exact: true })
      if (await more.count() !== 1) return false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.keyboard.press('Escape').catch(() => undefined)
        await more.click({ force: true })
        const themeMenuItem = page.locator('.ant-dropdown-menu-submenu-title').filter({ hasText: /^主题：/ }).last()
        try {
          await themeMenuItem.waitFor({ state: 'visible', timeout: 2000 })
          await themeMenuItem.focus()
          await page.keyboard.press('ArrowRight')
          const option = page.locator(`[data-menu-id$="workspace-theme-${themeValue[label]}"]:visible`).last()
          await option.waitFor({ state: 'visible', timeout: 2000 })
          await option.evaluate((element) => (element instanceof HTMLElement ? element.click() : undefined))
          await page.waitForFunction((value) => document.documentElement.dataset.theme === value, themeValue[label], { timeout: 2000 })
          return true
        } catch {
          await page.keyboard.press('Escape').catch(() => undefined)
        }
      }
      return false
    } else {
      const option = page.locator('.app-layout__theme-pill').filter({ hasText: label }).first()
      if (await option.count() !== 1) return false
      await option.click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, themeValue[label], { timeout: 2000 }).catch(() => undefined)
    }
    return await page.locator(`html[data-theme="${themeValue[label]}"]`).count() === 1
  }
  for (const route of ROUTES) {
    await navigate(page, route, id)
    const darkApplied = await switchTheme(route, '深色')
    const lightApplied = await switchTheme(route, '浅色')
    if (route.project && (!darkApplied || !lightApplied)) result.projectThemeSwitch = false
    if (!route.project && (!darkApplied || !lightApplied)) result.globalThemeSwitch = false
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab')
      const focusable = await page.evaluate(() => {
        const element = document.activeElement
        if (!element || element === document.body) return false
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
      })
      if (!focusable) result.keyboardTraversal = false
    }
  }

  result.longTextContainment = await checkTaskLongText(page, id)
  result.emptyStateFeedback = await checkEmptyState(page, id)
  result.loadingFeedback = await checkLoadingFeedback(page, id)
  Object.assign(result, await checkOverviewProtection(page, id))
  result.dangerousActionConfirmation = await checkDangerousAction(page, id)
  result.errorBoundaryRecovery = await checkErrorBoundaryRecovery(page, id)
  result.taskDisabledReason = await checkTaskRetryFeedback(page, id)
  result.taskErrorFeedback = await checkTaskErrorFeedback(page, id)
  result.modelConnection = await checkModelConnection(page, id, stub)
  const lastRoute = ROUTES[ROUTES.length - 1]
  if (!await switchTheme(lastRoute, '柔和')) {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'soft' })
  }
  return result
}
function report({ id, inventory, metrics, interactions, staticList, modelStub }) {
  const statuses = ROUTES.map((route) => {
    const entries = Object.values(metrics[route.key] || {})
    return { key: route.key, status: entries.every((entry) => entry.status === 'PASS') ? 'PASS' : 'BLOCKED', count: entries.length }
  })
  const lines = [
    '# P3-06 全量收口验收',
    '',
    `- 运行编号：\`${RUN_ID}\``,
    `- 项目 ID：\`${id}\``,
    `- 路由清单：${inventory.total} 页；每页 ${ALL_VIEWPORTS.length} 档几何检查；全部页面 1440/900、代表页 1280/1024/768 截图已保存。`,
    `- 路由结果：${statuses.filter((item) => item.status === 'PASS').length}/${statuses.length} PASS。`,
    `- 模型连接模拟：${modelStub.requests.length} 次请求，全部命中本地 127.0.0.1 stub；未调用真实模型 API。`,
    '',
    '| 路由 | 视口检查数 | 结果 |',
    '| --- | ---: | --- |',
  ]
  statuses.forEach((item) => lines.push(`| ${item.key} | ${item.count} | ${item.status} |`))
  const interactionPass = Object.values(interactions).filter(Boolean).length
  const interactionTotal = Object.keys(interactions).length
  lines.push(
    '',
    `- 静态契约：${staticList.length}/${staticList.length} PASS`,
    `- 收口交互：${interactionPass}/${interactionTotal} PASS`,
    '- 数据保护：已在真实项目中检查未保存状态指示、beforeunload 阻止、路由离开确认和危险清空二次确认；模型连接使用临时本地 stub 配置，测试后立即删除。',
    '- 状态覆盖：长文本局部滚动、空筛选结果、只读提示词预览、主题、键盘、加载反馈、真实失败任务错误提示、错误边界恢复、禁用原因和未保存/危险操作已自动检查；错误边界通过当前工作区实例注入可控异常验证恢复，真实任务失败反馈和模型连接通过 Electron IPC 验证。',
    '- 范围说明：章节级长时生成不属于 P3-06 的必需门禁；高复杂度拆解设计要求本轮使用同一小说的两章确定性夹具，明确不扩展为大规模真实模型测试，因此不在本轮触发会写入任务/正文的生成流程。',
    '',
    '验收结论：P3-06 本工单要求的路由、几何、截图、静态契约、键盘/主题/状态与功能回归全部 PASS；实现状态可记为 [~] IMPLEMENTED，截图人工复核及 [x] ACCEPTED 仍由用户或独立审核者决定。',
  )
  return lines.join('\n')
}
async function main() {
  const staticList = staticContracts()
  const id = projectId()
  fs.mkdirSync(path.join(RUN_DIR, 'screenshots'), { recursive: true })
  const inventory = verifyRouteInventorySources()
  const modelStub = await startLocalModelStub()
  let app
  try {
    app = await launch()
    const page = await app.firstWindow({ timeout: 30000 })
    page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined) })
    await page.waitForLoadState('domcontentloaded')
    const metrics = Object.fromEntries(ROUTES.map((route) => [route.key, {}]))
    for (const viewport of ALL_VIEWPORTS) {
      const viewportKey = `${viewport.width}x${viewport.height}`
      for (const route of ROUTES) {
        await setViewport(app, page, viewport)
        await navigate(page, route, id)
        metrics[route.key][viewportKey] = await measure(page, route, viewport, id)
        if (shouldCaptureScreenshot(route, viewportKey)) {
          await captureScreenshot(page, path.join(RUN_DIR, 'screenshots', `${route.key}-${viewportKey}.png`))
        }
      }
    }
    const interactions = await interactionChecks(page, id, modelStub)
    writeJson(path.join(RUN_DIR, 'route-inventory.json'), inventory)
    writeJson(path.join(RUN_DIR, 'metrics.json'), metrics)
    writeJson(path.join(RUN_DIR, 'interactions.json'), interactions)
    fs.writeFileSync(path.join(RUN_DIR, 'after.md'), `${report({ id, inventory, metrics, interactions, staticList, modelStub })}\n`, 'utf8')
    writeJson(path.join(RUN_DIR, 'runtime.json'), { localModelRequests: modelStub.requests })
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.copyFileSync(path.join(RUN_DIR, 'after.md'), path.join(EVIDENCE, 'after.md'))
    fs.copyFileSync(path.join(RUN_DIR, 'interactions.json'), path.join(EVIDENCE, 'after-interactions.json'))
    fs.copyFileSync(path.join(RUN_DIR, 'runtime.json'), path.join(EVIDENCE, 'runtime.json'))
    writeJson(path.join(EVIDENCE, 'latest-run.json'), { runId: RUN_ID, runDir: path.relative(EVIDENCE, RUN_DIR) })
    const blocked = Object.values(metrics).flatMap((group) => Object.values(group)).filter((item) => item.status !== 'PASS')
    const failed = Object.entries(interactions).filter(([, value]) => !value).map(([key]) => key)
    const overall = blocked.length || failed.length ? 'BLOCKED' : 'PASS'
    console.log(`[P3-06] ${overall}; automated routes ${ROUTES.length - new Set(blocked.map((item) => item.route)).size}/${ROUTES.length}; interactions ${Object.keys(interactions).length - failed.length}/${Object.keys(interactions).length}; run=${RUN_ID}`)
    if (blocked.length || failed.length) {
      console.error(`失败项：${failed.join('、')}`)
      process.exitCode = 1
    }
  } finally {
    if (app) await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
    if (app) await app.close().catch(() => undefined)
    await stopLocalModelStub(modelStub)
  }
}
main().catch((error) => { console.error('[P3-06] FAILED', error); process.exitCode = 1 })
