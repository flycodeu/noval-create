const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-02')
const P0_00_SUMMARY = path.join(REPO_ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 900, height: 760 },
]
// P0-02 的“首屏可编辑”只验收方案明确要求的四个核心输入：
// 目标平台、读者承诺、核心卖点、禁区。受屏幕高度影响的补充画像字段不计入首屏门槛。
const CORE_FIELDS = ['platformMode', 'readerPromise', 'sellingPoints', 'tabooRules']

const phase = process.env.NOVELFORGE_P0_02_PHASE || 'after'

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

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function assertStaticContracts() {
  const page = read('src/pages/Novel/ProjectBrief/index.tsx')
  const css = read('src/pages/Novel/ProjectBrief/index.css')
  const checks = [
    ['顶部移除重复上下文和指标', !page.includes('contextSummary={') && !page.includes('metrics={')],
    ['平台策略使用按需 disclosure', page.includes('project-brief__strategy-disclosure') && page.includes('project-brief__platform-detail')],
    ['参考作品默认折叠', page.includes('project-brief__references-disclosure') && page.includes('summary>参考作品')],
    ['保存状态持续可见', page.includes('project-brief__save-state') && page.includes('hasUnsavedChanges')],
    ['核心字段使用聚焦表单标记', ['platformMode', 'readerPromise', 'sellingPoints', 'tabooRules'].every((field) => page.includes(`data-project-brief-field="${field}"`))],
    ['保存包含 loading、失败反馈和重试', page.includes('setSaving(true)') && page.includes('projectBrief.saveFailed') && page.includes('projectBrief.saved') && page.includes('重试保存')],
    ['快捷保存与未保存离开保护', page.includes('registerSaveHandler') && page.includes("beforeunload") && page.includes('event.preventDefault()')],
    ['页面样式提供无卡片表单分组', css.includes('.project-brief__section {') && css.includes('box-shadow: none')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P0-02 静态契约失败：${failed.join('、')}`)
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
  await page.evaluate(() => {
    const contentBody = document.querySelector('.novel-route-shell__content-body')
    if (contentBody) contentBody.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(150)
}

async function measure(page, viewport, kind) {
  return page.evaluate(({ viewport, pageKind, coreFields }) => {
    const root = document.documentElement
    const body = document.body
    const informationSlot = document.querySelector('.project-topbar__information-slot')
    const actionSlot = document.querySelector('.project-topbar__page-actions')
    const errorCard = document.querySelector('.novel-route-shell__error-card')
    const workspace = document.querySelector('.novel-project-brief-page')
    const isVisible = (node) => {
      if (!node) return false
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const withinViewport = (node) => {
      if (!isVisible(node)) return false
      const rect = node.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= innerHeight + 1
    }
    const field = (name) => document.querySelector(`[data-project-brief-field="${name}"]`)
    const visibleCoreFields = coreFields
      .filter((name) => withinViewport(field(name)))
    const reasons = []
    if (errorCard) reasons.push(errorCard.textContent?.replace(/\s+/g, ' ').trim() || '错误边界已触发')
    if (root.scrollWidth > root.clientWidth || (body?.scrollWidth || 0) > root.clientWidth) reasons.push('页面存在横向溢出')
    const result = {
      status: 'PASS',
      reasons,
      viewport,
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth || 0),
      informationChildren: informationSlot?.childElementCount || 0,
      contextCount: informationSlot?.querySelectorAll('.novel-context-summary__item').length || 0,
      metricCount: informationSlot?.querySelectorAll('.novel-metric').length || 0,
      visibleCoreFields,
      strategyDisclosurePresent: Boolean(workspace?.querySelector('.project-brief__strategy-disclosure')),
      strategyDisclosureOpen: workspace?.querySelector('.project-brief__strategy-disclosure')?.hasAttribute('open') || false,
      referencesDisclosurePresent: Boolean(workspace?.querySelector('.project-brief__references-disclosure')),
      referencesDisclosureOpen: workspace?.querySelector('.project-brief__references-disclosure')?.hasAttribute('open') || false,
      saveStateVisible: isVisible(workspace?.querySelector('.project-brief__save-state')),
      saveActionVisible: isVisible(actionSlot?.querySelector('.workspace-contract-action--primary')),
      legacyFieldCardCount: workspace?.querySelectorAll('.guided-step__field-card').length || 0,
      pageKind,
    }
    if (pageKind === 'after') {
      if (result.contextCount !== 0 || result.metricCount !== 0) reasons.push('共享栏仍有重复上下文或指标')
      if (!result.strategyDisclosurePresent || result.strategyDisclosureOpen) reasons.push('平台策略未按需折叠')
      if (!result.referencesDisclosurePresent || result.referencesDisclosureOpen) reasons.push('参考作品未默认折叠')
      if (visibleCoreFields.length !== coreFields.length) reasons.push(`首屏核心字段仅 ${visibleCoreFields.length}/${coreFields.length} 可见`)
      if (!result.saveStateVisible || !result.saveActionVisible) reasons.push('保存状态或保存动作未持续可见')
      if (result.legacyFieldCardCount > 0) reasons.push(`仍有 ${result.legacyFieldCardCount} 个旧表单卡片`) 
    }
    result.status = reasons.length > 0 ? 'BLOCKED' : 'PASS'
    result.reasons = reasons
    return result
  }, { viewport, pageKind: kind, coreFields: CORE_FIELDS })
}

async function inspectDisclosure(page) {
  const references = page.locator('.project-brief__references-disclosure')
  await references.locator('summary').click()
  await page.waitForFunction(() => document.querySelector('.project-brief__references-disclosure')?.hasAttribute('open') === true)
  const referencesOpen = await references.locator('[data-project-brief-field="compTitles"]').isVisible()
  await references.locator('summary').click()
  await page.waitForFunction(() => document.querySelector('.project-brief__references-disclosure')?.hasAttribute('open') === false)
  return referencesOpen
}

async function verifySaveLifecycle(app, page, projectId) {
  console.log('[P0-02] lifecycle start')
  const originalNovel = await page.evaluate((id) => window.electron.novel.get(id), projectId)
  console.log('[P0-02] original brief', originalNovel?.projectBriefJson)
  const field = page.locator('[data-project-brief-field="targetAudience"] input')
  const saveButton = page.locator('.workspace-contract-action--primary')
  await field.waitFor({ state: 'visible' })
  const original = await field.inputValue()
  const marker = '验收赛道 · P0-02验收'
  const platform = page.locator('[data-project-brief-field="platformMode"] .ant-select')
  if (!(await platform.locator('.ant-select-selection-item').textContent())?.trim()) {
    await platform.click()
    console.log('[P0-02] platform options', await page.locator('.ant-select-item-option').allTextContents())
    await page.locator('.ant-select-item-option').filter({ hasText: '番茄小说' }).last().click()
  }
  await field.fill(marker)
  for (const name of ['targetReader', 'readerPromise', 'sellingPoints']) {
    const control = page.locator(`[data-project-brief-field="${name}"] textarea`)
    if (await control.count()) await control.fill(`P0-02 验收临时内容：${name}`)
  }
  console.log('[P0-02] lifecycle controls', await page.evaluate(() => ({
    platform: document.querySelector('[data-project-brief-field="platformMode"] .ant-select-selection-item')?.textContent,
    inputs: [...document.querySelectorAll('[data-project-brief-field] input, [data-project-brief-field] textarea')].map((node) => ({ name: node.getAttribute('name'), value: node.value })),
    saveDisabled: document.querySelector('.workspace-contract-action--primary')?.hasAttribute('disabled'),
  })))
  console.log('[P0-02] lifecycle dirty')
  await page.waitForTimeout(350)
  try {
    await page.waitForFunction(() => document.querySelector('.project-brief__save-state')?.textContent?.includes('有未保存修改'))
  } catch (error) {
    console.log('[P0-02] lifecycle dirty state', await page.evaluate(() => ({
      state: document.querySelector('.project-brief__save-state')?.textContent,
      guard: document.querySelector('.project-brief__form')?.getAttribute('data-project-brief-unsaved-guard'),
    })))
    throw error
  }
  const moreButton = page.locator('.workspace-contract-actions__more--desktop')
  console.log('[P0-02] lifecycle opening more actions')
  await moreButton.click()
  console.log('[P0-02] lifecycle more actions open')
  console.log('[P0-02] lifecycle menu items', await page.getByRole('menuitem').allTextContents())
  await page.getByRole('menuitem', { name: '去基础设定' }).click()
  console.log('[P0-02] lifecycle leave action clicked')
  const routeLeaveGuardVisible = await page.locator('.ant-modal-confirm').filter({ hasText: '项目立项还有未保存修改' }).isVisible({ timeout: 5000 }).catch(() => false)
  console.log('[P0-02] lifecycle route guard', routeLeaveGuardVisible)
  await page.getByRole('button', { name: '留在当前页' }).click({ timeout: 5000 })
  const unloadState = await page.locator('.project-brief__form').getAttribute('data-project-brief-unsaved-guard')
  await page.evaluate(() => {
    const handler = window.__p0BeforeUnloadHandler
    if (handler) window.removeEventListener('beforeunload', handler)
  })

  await app.evaluate(({ ipcMain }) => {
    const originalHandler = ipcMain._invokeHandlers?.get('novel:update')
    if (typeof originalHandler !== 'function') throw new Error('无法读取 novel:update 原始 IPC handler')
    const handlers = ipcMain._invokeHandlers
    let failOnce = true
    handlers.set('novel:update', (_event, id, data) => {
      if (failOnce) {
        failOnce = false
        handlers.set('novel:update', originalHandler)
        throw new Error('P0-02 验收模拟保存失败')
      }
      return originalHandler(_event, id, data)
    })
  })
  await saveButton.click()
  console.log('[P0-02] lifecycle failure requested')
  try {
    await page.locator('.project-brief__save-error').waitFor({ state: 'visible', timeout: 12000 })
  } catch (error) {
    console.log('[P0-02] lifecycle after failure', await page.evaluate(() => ({
      saveState: document.querySelector('.project-brief__save-state')?.textContent,
      errorText: document.querySelector('.project-brief__save-error')?.textContent,
      bodyTail: document.body.innerText.slice(-800),
    })))
    throw error
  }
  console.log('[P0-02] lifecycle failure visible')
  const failureVisible = await page.locator('.project-brief__save-error').isVisible()
  await page.getByRole('button', { name: '重试保存' }).click()
  console.log('[P0-02] lifecycle retry clicked')
  await page.waitForFunction(() => document.querySelector('.project-brief__save-error') === null)
  await page.waitForFunction(() => document.querySelector('.project-brief__save-state')?.textContent?.includes('已保存'))
  console.log('[P0-02] lifecycle retry succeeded')

  // Restore the real value so the acceptance run leaves the project unchanged.
  await page.evaluate(async ({ id, projectBriefJson }) => {
    await window.electron.novel.update(id, { projectBriefJson })
  }, { id: projectId, projectBriefJson: originalNovel?.projectBriefJson || '' })
  const restoredNovel = await page.evaluate((id) => window.electron.novel.get(id), projectId)
  const restored = restoredNovel?.projectBriefJson === (originalNovel?.projectBriefJson || '')
  console.log('[P0-02] lifecycle restore verified', restored)
  if (!restored) {
    throw new Error('P0-02 验收结束后项目立项数据未恢复到测试前快照。')
  }
  // Unmount the form before the Electron window closes so the browser's
  // beforeunload listener is removed without invoking a native dialog.
  await page.evaluate(() => { window.location.hash = window.location.hash.replace('/project-brief', '/core-settings') })
  await page.waitForFunction(() => window.location.hash.includes('/core-settings'), { timeout: 12000 })
  return {
    unsavedStateVisible: true,
    beforeUnloadGuardActive: unloadState === 'active',
    routeLeaveGuardVisible,
    saveFailureVisible: failureVisible,
    retrySucceeded: true,
    restored,
  }
}

function buildReport({ runId, projectId, phaseName, results, lifecycle }) {
  const lines = [
    `# P0-02 项目立项聚焦表单样板（${phaseName}）`,
    '',
    `- 运行编号：\`${runId}\``,
    `- Electron 项目：ID ${projectId}`,
    '- 固定路由：`project-brief`。',
    '- 目标：核心字段首屏可编辑；策略和参考作品渐进披露；保存持续可见；顶部不重复展示上下文/指标。',
    '',
    '| 视口 | 结果 | 首屏核心字段 | 顶部上下文 | 顶部指标 | 策略折叠 | 参考折叠 | 保存状态 | 旧卡片数 | client/scroll | 截图 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const [viewport, metric] of Object.entries(results)) {
    const result = metric.status === 'PASS' ? 'PASS' : `BLOCKED：${metric.reasons.join('；')}`
    lines.push(`| ${viewport} | ${result} | ${metric.visibleCoreFields.length}/${CORE_FIELDS.length} | ${metric.contextCount} | ${metric.metricCount} | ${metric.strategyDisclosureOpen ? '否' : '是'} | ${metric.referencesDisclosureOpen ? '否' : '是'} | ${metric.saveStateVisible && metric.saveActionVisible ? '是' : '否'} | ${metric.legacyFieldCardCount} | ${metric.clientWidth}/${metric.scrollWidth} | [截图](runs/${runId}/screenshots/project-brief-${viewport}.png) |`)
  }
  if (lifecycle) {
    lines.push(
      '',
      '## 交互验收',
      '',
      `- 未保存状态可见：${lifecycle.unsavedStateVisible ? 'PASS' : 'BLOCKED'}`,
      `- 未保存离开守卫：${lifecycle.beforeUnloadGuardActive ? 'PASS' : 'BLOCKED'}`,
      `- 应用内路由离开守卫：${lifecycle.routeLeaveGuardVisible ? 'PASS' : 'BLOCKED'}`,
      `- 保存失败反馈：${lifecycle.saveFailureVisible ? 'PASS' : 'BLOCKED'}`,
      `- 失败后重试保存：${lifecycle.retrySucceeded ? 'PASS' : 'BLOCKED'}`,
      `- 验收数据恢复：${lifecycle.restored ? 'PASS' : 'BLOCKED'}`,
    )
  }
  lines.push('')
  return lines.join('\n')
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

async function main() {
  const runId = timestampId()
  const projectId = resolveProjectId()
  if (phase === 'after') assertStaticContracts()
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
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined)
    })
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => {
      const originalAddEventListener = window.addEventListener
      window.addEventListener = function (type, listener, options) {
        if (type === 'beforeunload') window.__p0BeforeUnloadHandler = listener
        return originalAddEventListener.call(this, type, listener, options)
      }
    })
    await page.waitForTimeout(2500)
    const results = {}
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      const size = `${viewport.width}x${viewport.height}`
      console.log(`[P0-02] ${phase} ${size}`)
      await navigate(page, `#/novels/${projectId}/project-brief`, '项目简报')
      results[size] = await measure(page, viewport, phase)
      if (phase === 'after') {
        results[size].referencesInteractionVerified = await inspectDisclosure(page)
        if (!results[size].referencesInteractionVerified) {
          results[size].status = 'BLOCKED'
          results[size].reasons.push('参考作品 disclosure 打开后字段不可见')
        }
        await navigate(page, `#/novels/${projectId}/project-brief`, '项目简报')
      }
      await captureScreenshot(page, path.join(screenshotsDir, `project-brief-${size}.png`))
    }
    await setViewport(app, page, VIEWPORTS[0])
    await navigate(page, `#/novels/${projectId}/project-brief`, '项目简报')
    const lifecycle = phase === 'after' ? await verifySaveLifecycle(app, page, projectId) : null
    console.log('[P0-02] lifecycle result', JSON.stringify(lifecycle))
    const measurements = Object.values(results)
    const blocked = measurements.filter((item) => item.status !== 'PASS')
    const summary = {
      runId,
      phase,
      capturedAt: new Date().toISOString(),
      projectId,
      route: 'project-brief',
      viewportCount: VIEWPORTS.length,
      measurementCount: measurements.length,
      passCount: measurements.length - blocked.length,
      blockedCount: blocked.length,
      runtime: 'Electron production build',
      lifecycle,
    }
    const report = buildReport({ runId, projectId, phaseName: phase === 'after' ? '改后' : '改前', results, lifecycle })
    writeJson(path.join(runDir, 'metrics.json'), results)
    writeJson(path.join(runDir, 'lifecycle.json'), lifecycle)
    writeJson(path.join(runDir, 'capture-summary.json'), summary)
    fs.writeFileSync(path.join(runDir, 'baseline.md'), report, 'utf8')
    writeJson(path.join(EVIDENCE_ROOT, `${phase}-latest-run.json`), { runId, runDirectory: `runs/${runId}`, capturedAt: summary.capturedAt })
    writeJson(path.join(EVIDENCE_ROOT, `${phase}-metrics.json`), results)
    writeJson(path.join(EVIDENCE_ROOT, `${phase}-capture-summary.json`), summary)
    writeJson(path.join(EVIDENCE_ROOT, `${phase}-lifecycle.json`), lifecycle)
    fs.writeFileSync(path.join(EVIDENCE_ROOT, `${phase}.md`), report, 'utf8')
    console.log(`[P0-02] ${phase} ${summary.passCount} PASS / ${summary.blockedCount} BLOCKED`)
    if (blocked.length > 0) throw new Error(blocked.flatMap((item) => item.reasons).join('；'))
  } finally {
    if (app) await app.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error('[P0-02] FAILED', error)
  process.exitCode = 1
})
