const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-03'))
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
  { key: 'glossary', route: 'glossary', root: '.novel-glossary-page', label: '设定词典' },
  { key: 'scene-templates', route: 'scene-templates', root: '.novel-scene-templates-page', label: '场景模板' },
]
const DENSITY_TARGET = 105

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
  const glossary = read('src/pages/Novel/Glossary/index.tsx')
  const glossaryCss = read('src/pages/Novel/Glossary/index.css')
  const templates = read('src/pages/Novel/SceneTemplates/index.tsx')
  const templatesCss = read('src/pages/Novel/SceneTemplates/index.css')
  const checks = [
    ['设定词典接入共享信息栏和动作契约', glossary.includes('chrome="shared"') && glossary.includes('actionContract={{')],
    ['设定词典使用虚拟化紧凑列表', glossary.includes('VirtualList') && glossary.includes('novel-glossary__list-row') && glossary.includes('pageSize: 200') && glossaryCss.includes('min-height: 88px')],
    ['设定词典详情按需展开', glossary.includes('novel-glossary__advanced') && glossary.includes('<details') && glossaryCss.includes('novel-glossary__advanced')],
    ['设定词典具备深链和离开保护', glossary.includes('glossaryId') && glossary.includes('addEventListener(\'beforeunload\'') && glossary.includes('当前术语还有未保存修改')],
    ['场景模板接入共享信息栏和动作契约', templates.includes('chrome="shared"') && templates.includes('actionContract={{')],
    ['场景模板使用虚拟化紧凑列表', templates.includes('VirtualList') && templates.includes('novel-scene-templates__list-row') && templates.includes('pageSize: 200') && templatesCss.includes('min-height: 88px')],
    ['场景模板详情按需展开', templates.includes('novel-scene-templates__advanced') && templates.includes('<details') && templatesCss.includes('novel-scene-templates__advanced')],
    ['内置模板保持只读', templates.includes('selectedIsBuiltin') && templates.includes('disabled={selectedIsBuiltin || (!selectedItem && !creating)}') && templates.includes('内置模板 · 只读')],
    ['场景模板支持复制为自定义', templates.includes('CopyOutlined') && templates.includes('handleCopy') && templates.includes('isBuiltin: 0')],
    ['危险删除操作需要确认', [glossary, templates].every((source) => source.includes('Modal.confirm(') && source.includes("okType: 'danger'"))],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-03 静态契约失败：${failed.join('、')}`)
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
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: `#/novels/${projectId}/${route.route}`, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ selector }) => {
    const root = document.querySelector(selector)
    return Boolean(root)
      && !root.querySelector('.ant-spin')
      && (Boolean(root.querySelector('[class*="__list-row"]')) || root.textContent?.includes('当前筛选下没有'))
  }, { selector: route.root }, { timeout: 20000 })
  await page.waitForTimeout(450)
}

async function seedDensity(page, projectId) {
  const marker = `P2-03-${Date.now()}`
  return page.evaluate(async ({ novelId, target, seedMarker }) => {
    const novel = await window.electron.novel.get(novelId)
    const glossary = await window.electron.glossary.list(novelId)
    let glossaryCount = glossary.length
    await window.electron.glossary.create(novelId, {
      term: `${seedMarker}-搜索定位术语`,
      category: 'concept',
      definition: `${seedMarker} 非生产搜索定位验收条目`,
      aliasesJson: JSON.stringify([`${seedMarker}-别名`]),
      firstAppearChapter: 1,
      isCanonical: 1,
    })
    glossaryCount += 1
    let glossaryCreated = 1
    while (glossaryCount < target) {
      const index = glossaryCount + 1
      await window.electron.glossary.create(novelId, {
        term: `${seedMarker}-术语-${String(index).padStart(3, '0')}`,
        category: index % 2 ? 'concept' : 'lore',
        definition: `${seedMarker} 非生产密度验收条目 ${index}`,
        aliasesJson: JSON.stringify([`${seedMarker}-别名-${index}`]),
        firstAppearChapter: index,
        isCanonical: 1,
      })
      glossaryCount += 1
      glossaryCreated += 1
    }

    const templates = await window.electron.sceneTemplate.list({ novelId, genreId: novel?.genreId })
    let templateCount = templates.filter((item) => item.novelId === novelId).length
    await window.electron.sceneTemplate.create({
      novelId,
      genreId: novel?.genreId,
      name: `${seedMarker}-搜索定位模板`,
      category: 'revelation',
      description: `${seedMarker} 非生产搜索定位验收模板`,
      typicalBeatsJson: JSON.stringify(['搜索', '定位', '确认']),
      suggestedCharacterRolesJson: JSON.stringify(['主角']),
      emotionArc: '疑惑 -> 确认',
      isBuiltin: 0,
    })
    templateCount += 1
    let templatesCreated = 1
    while (templateCount < target) {
      const index = templateCount + 1
      await window.electron.sceneTemplate.create({
        novelId,
        genreId: novel?.genreId,
        name: `${seedMarker}-模板-${String(index).padStart(3, '0')}`,
        category: index % 2 ? 'conflict' : 'transition',
        description: `${seedMarker} 非生产密度验收模板 ${index}`,
        typicalBeatsJson: JSON.stringify(['触发', '升级', '留下后果']),
        suggestedCharacterRolesJson: JSON.stringify(['主角', '对手']),
        emotionArc: '警觉 -> 压迫 -> 未完',
        isBuiltin: 0,
      })
      templateCount += 1
      templatesCreated += 1
    }
    if (!templates.some((item) => item.isBuiltin > 0)) {
      await window.electron.sceneTemplate.create({
        novelId,
        genreId: novel?.genreId,
        name: `${seedMarker}-内置模板`,
        category: 'revelation',
        description: `${seedMarker} 非生产只读模板验收样本`,
        typicalBeatsJson: JSON.stringify(['发现', '验证', '留下新问题']),
        suggestedCharacterRolesJson: JSON.stringify(['主角', '见证者']),
        emotionArc: '疑惑 -> 确认 -> 不安',
        isBuiltin: 1,
      })
    }
    return { marker: seedMarker, glossaryCount, templateCount, glossaryCreated, templatesCreated }
  }, { novelId: projectId, target: DENSITY_TARGET, seedMarker: marker })
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
    const pageActions = [...document.querySelectorAll('.workspace-contract-actions .ant-btn, .novel-hero__actions .ant-btn')].filter(visible)
    const listRows = [...(workspace?.querySelectorAll('[class*="__list-row"]') || [])].filter(visible)
    const disclosures = [...(workspace?.querySelectorAll('details') || [])]
    const scrollableBodies = [...(workspace?.querySelectorAll('.rc-virtual-list-holder') || [])].filter(visible)
    const maxScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0)
    const workspaceRect = workspace?.getBoundingClientRect()
    const reasons = []
    if (!workspace) reasons.push('页面根节点不存在')
    if (maxScrollWidth > root.clientWidth + 1) reasons.push('页面根节点存在横向溢出')
    if (workspaceRect && viewport.width <= 1024 && workspaceRect.width > root.clientWidth + 1) reasons.push('工作区宽度超过视口')
    if (viewport.width >= 1024 && listRows.length === 0) reasons.push('紧凑列表没有可见行')
    return {
      status: reasons.length ? 'BLOCKED' : 'PASS',
      reasons,
      viewport,
      chrome: workspace?.getAttribute('data-workspace-chrome') || '',
      actionCount: pageActions.length,
      listRowCount: listRows.length,
      disclosureCount: disclosures.length,
      scrollableCount: scrollableBodies.length,
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: route.root, viewport })
}

function readHashParam(page, name) {
  return page.evaluate((key) => new URLSearchParams(window.location.hash.split('?')[1] || '').get(key), name)
}

async function selectScope(page, label) {
  await page.locator('.novel-scene-templates__filters .ant-select').click()
  await page.getByText(label, { exact: true }).last().click()
  await page.waitForTimeout(500)
}

async function verifyGlossary(page, projectId, marker) {
  await navigate(page, projectId, ROUTES[0])
  const firstRow = page.locator('.novel-glossary__list-row').first()
  await page.waitForFunction(() => document.querySelectorAll('.novel-glossary__list-row').length > 0, null, { timeout: 12000 })
  await firstRow.click({ force: true })
  const glossaryId = await readHashParam(page, 'glossaryId')
  await page.locator('.novel-glossary__advanced summary').click()
  const detailsOpened = await page.locator('.novel-glossary__advanced[open]').isVisible().catch(() => false)

  const search = page.getByPlaceholder('搜索术语、定义或别名')
  await search.fill(marker)
  const searchRows = page.locator('.novel-glossary__list-row')
  const searchLocated = await page.waitForFunction(({ seedMarker }) => [...document.querySelectorAll('.novel-glossary__list-row')].some((row) => row.textContent?.includes(seedMarker)), { seedMarker: marker }, { timeout: 12000 }).then(() => true).catch(() => false)
  await search.fill('__p2_03_no_match__')
  await page.waitForTimeout(600)
  const emptyState = await page.getByText('当前筛选下没有术语', { exact: true }).isVisible().catch(() => false)
  await search.fill('')
  await page.waitForTimeout(600)

  const rowCount = await page.locator('.novel-glossary__list-row').count()
  const termInput = page.locator('.novel-glossary__detail-form').getByLabel('术语', { exact: true }).first()
  await termInput.fill(`P2-03-dirty-${Date.now()}`)
  const saveStateBefore = await page.evaluate(() => document.querySelector('[data-glossary-save-state]')?.getAttribute('data-glossary-save-state') || '')
  await page.locator('.novel-glossary__list-row').first().click()
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前术语还有未保存修改' }).last()
  const leaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (leaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await page.getByRole('button', { name: '保存术语' }).last().click()
  await page.waitForFunction(() => document.querySelector('[data-glossary-save-state]')?.getAttribute('data-glossary-save-state') === 'saved', null, { timeout: 8000 })

  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '删除术语' }).click()
  const deleteDialog = page.getByRole('dialog').filter({ hasText: '删除术语' }).last()
  const deleteConfirmation = await deleteDialog.isVisible().catch(() => false)
  if (deleteConfirmation) await deleteDialog.getByRole('button', { name: /取\s*消/ }).click()
  return {
    selectedRoute: Boolean(glossaryId),
    detailsOpened,
    densitySearchLocated: searchLocated,
    searchEmptyState: emptyState,
    denseRowsRendered: rowCount > 0,
    unsavedStateVisible: saveStateBefore === 'unsaved',
    leaveProtection,
    deleteConfirmation,
  }
}

async function verifySceneTemplates(page, projectId, marker) {
  await navigate(page, projectId, ROUTES[1])
  const firstRow = page.locator('.novel-scene-templates__list-row').first()
  await page.waitForFunction(() => document.querySelectorAll('.novel-scene-templates__list-row').length > 0, null, { timeout: 12000 })
  await selectScope(page, '仅内置')
  const builtinRow = page.locator('.novel-scene-templates__list-row').first()
  await page.waitForFunction(() => document.querySelectorAll('.novel-scene-templates__list-row').length > 0, null, { timeout: 12000 })
  await builtinRow.click({ force: true })
  const templateId = await readHashParam(page, 'templateId')
  const templateInput = page.locator('.novel-scene-templates__detail-form').getByLabel('模板名称', { exact: true }).first()
  const builtinReadonly = await templateInput.isDisabled()

  await page.getByRole('button', { name: '复制为自定义' }).click()
  await page.waitForFunction(() => new URLSearchParams(window.location.hash.split('?')[1] || '').has('templateId'))
  await page.waitForTimeout(600)
  const copiedName = await templateInput.inputValue()
  const copiedEditable = !(await templateInput.isDisabled()) && copiedName.includes('副本')

  await selectScope(page, '全部作用域')
  const search = page.getByPlaceholder('搜索模板名、描述或情绪弧线')
  await search.fill(marker)
  await page.waitForTimeout(600)
  const searchRows = page.locator('.novel-scene-templates__list-row')
  const searchLocated = await searchRows.count() > 0 && (await searchRows.first().innerText()).includes(marker)
  await search.fill('')
  await page.waitForTimeout(600)
  const detailsAlreadyOpen = await page.locator('.novel-scene-templates__advanced').evaluate((node) => node.hasAttribute('open')).catch(() => false)
  if (!detailsAlreadyOpen) await page.locator('.novel-scene-templates__advanced summary').click()
  const detailsOpened = await page.locator('.novel-scene-templates__advanced[open]').isVisible().catch(() => false)

  const rowCount = await page.locator('.novel-scene-templates__list-row').count()
  await templateInput.fill(`P2-03-dirty-${Date.now()}`)
  const saveStateBefore = await page.evaluate(() => document.querySelector('[data-scene-template-save-state]')?.getAttribute('data-scene-template-save-state') || '')
  await page.locator('.novel-scene-templates__list-row').first().click()
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前模板还有未保存修改' }).last()
  const leaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (leaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()

  await page.getByRole('button', { name: '保存模板' }).last().click()
  await page.waitForFunction(() => document.querySelector('[data-scene-template-save-state]')?.getAttribute('data-scene-template-save-state') === 'saved', null, { timeout: 8000 })
  await page.getByRole('button', { name: '更多页面操作' }).click()
  await page.getByRole('menuitem', { name: '删除模板' }).click()
  const deleteDialog = page.getByRole('dialog').filter({ hasText: '删除场景模板' }).last()
  const deleteConfirmation = await deleteDialog.isVisible().catch(() => false)
  if (deleteConfirmation) await deleteDialog.getByRole('button', { name: /取\s*消/ }).click()
  return {
    selectedRoute: Boolean(templateId),
    builtinReadonly,
    copiedEditable,
    densitySearchLocated: searchLocated,
    detailsOpened,
    denseRowsRendered: rowCount > 0,
    unsavedStateVisible: saveStateBefore === 'unsaved',
    leaveProtection,
    deleteConfirmation,
  }
}

async function verifyInteractions(page, projectId, marker) {
  const checks = {
    glossary: await verifyGlossary(page, projectId, marker),
    sceneTemplates: await verifySceneTemplates(page, projectId, marker),
  }
  const failed = Object.entries(checks).flatMap(([group, values]) => (
    Object.entries(values).filter(([, passed]) => passed !== true).map(([key]) => `${group}.${key}`)
  ))
  if (failed.length > 0) throw new Error(`P2-03 交互验收失败：${failed.join('、')}`)
  return checks
}

function buildReport(runId, projectId, results, staticContracts, interactions, density) {
  const lines = [
    `# P2-03 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
      return `${item.clientWidth}/${item.scrollWidth}; H${Math.round(item.pageHeight)}; A${item.actionCount}; L${item.listRowCount}; D${item.disclosureCount}; ${item.status}`
    })
    lines.push(`| ${route.label} | ${cells.join(' | ')} |`)
  }
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; L可见列表行; D按需详情; 状态`。', '')
  if (PHASE === 'after') {
    lines.push(
      `- 密度准备：${density.glossaryCount} 条术语 / ${density.templateCount} 条项目模板（新增仅用于验收，运行结束已恢复）。`,
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
  const staticContracts = PHASE === 'after' ? assertStaticContracts() : []
  const snapshot = PHASE === 'after' ? await snapshotAcceptanceDatabase() : null
  let app
  try {
    app = await launchProductionApp()
    const page = await app.firstWindow()
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined))
    await page.waitForLoadState('domcontentloaded')
    const density = PHASE === 'after' ? await seedDensity(page, projectId) : { marker: '', glossaryCount: 0, templateCount: 0 }
    const results = {}
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      for (const route of ROUTES) {
        await navigate(page, projectId, route)
        const item = await measure(page, route, viewport)
        if (!results[route.key]) results[route.key] = {}
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({ path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
        console.log(`[P2-03] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = await verifyInteractions(page, projectId, density.marker)
      writeJson(path.join(runDir, 'interactions.json'), interactions)
      writeJson(path.join(EVIDENCE_ROOT, 'after-interactions.json'), interactions)
    }
    const report = buildReport(runId, projectId, results, staticContracts, interactions, density)
    writeJson(path.join(runDir, 'metrics.json'), results)
    writeJson(path.join(runDir, 'density.json'), density)
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
