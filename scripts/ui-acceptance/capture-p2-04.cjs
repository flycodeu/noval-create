const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_REPO_ROOT || path.resolve(__dirname, '../..'))
const EVIDENCE_ROOT = path.resolve(process.env.NOVELFORGE_UI_ACCEPTANCE_EVIDENCE_ROOT || path.join(REPO_ROOT, 'docs/ui-acceptance/P2-04'))
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
  { key: 'characters', route: 'characters', root: '.novel-characters-page', list: '[data-character-list-row]', label: '角色系统' },
  { key: 'arc-center', route: 'arc-center?tab=characters', root: '.novel-character-arc-center', list: '[data-character-arc-list-row]', label: '人物弧线中心' },
  { key: 'resistance', route: 'resistance', root: '.novel-resistance-page', list: '[data-resistance-list-row]', label: '反派与阻力系统' },
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
  const characters = read('src/pages/Novel/Characters/CharacterWorkspace.tsx')
  const charactersCss = read('src/pages/Novel/Characters/character-workspace.css')
  const arc = read('src/pages/Novel/CharacterArcCenter/index.tsx')
  const arcCss = read('src/pages/Novel/CharacterArcCenter/index.css')
  const resistance = read('src/pages/Novel/Resistance/index.tsx')
  const resistanceCss = read('src/pages/Novel/Resistance/index.css')
  const checks = [
    ['角色页接入共享动作契约', characters.includes('chrome="shared"') && characters.includes('actionContract={{')],
    ['角色页具备紧凑定位行和筛选', characters.includes('data-character-list-row') && characters.includes('Pagination') && charactersCss.includes('novel-characters__list-row')],
    ['角色详情按需展开', characters.includes('novel-characters__advanced') && characters.includes('<details') && charactersCss.includes('novel-characters__advanced')],
    ['角色页具备未保存保护', characters.includes('当前人物还有未保存修改') && characters.includes("addEventListener('beforeunload'")],
    ['人物弧页接入共享动作契约', arc.includes('chrome="shared"') && arc.includes('actionContract={{')],
    ['人物弧支持人物和关系选择', arc.includes('data-character-arc-list-row') && arc.includes('filteredRelations') && arc.includes('switchTab')],
    ['人物弧详情按需展开', arc.includes('novel-character-arc-center__advanced') && arc.includes('<details') && arcCss.includes('novel-character-arc-center__advanced')],
    ['人物弧推进登记保持现有接口', arc.includes('upsertCharacterArcBeat') && arc.includes('登记推进')],
    ['阻力页接入共享动作契约', resistance.includes('chrome="shared"') && resistance.includes('actionContract={{')],
    ['阻力支持来源筛选与推进登记', resistance.includes('data-resistance-list-row') && resistance.includes('filterTracks') && resistance.includes('upsertBeat')],
    ['阻力详情按需展开和未保存保护', resistance.includes('novel-resistance-page__advanced') && resistance.includes('<details') && resistance.includes('当前阻力线还有未保存修改') && resistanceCss.includes('novel-resistance-page__advanced')],
  ]
  const failed = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failed.length > 0) throw new Error(`P2-04 静态契约失败：${failed.join('、')}`)
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
  await page.waitForFunction(({ selector, list }) => {
    const root = document.querySelector(selector)
    return Boolean(root)
      && !root.querySelector('.ant-spin')
      && (Boolean(root.querySelector(list)) || root.textContent?.includes('还没有') || root.textContent?.includes('当前搜索'))
  }, { selector: route.root, list: route.list }, { timeout: 20000 })
  await page.waitForTimeout(450)
}

async function seedDensity(page, projectId) {
  const marker = `P2-04-${Date.now()}`
  return page.evaluate(async ({ novelId, target, seedMarker }) => {
    const created = { characters: 0, relations: 0, arcs: 0, resistance: 0 }
    let characters = await window.electron.character.list(novelId)
    while (created.characters < target) {
      const seq = characters.length + created.characters + 1
      await window.electron.character.create(novelId, {
        fullName: `${seedMarker}-人物-${String(seq).padStart(2, '0')}`,
        roleType: seq === 1 ? 'protagonist' : 'major',
        recordStatus: 'confirmed',
        background: `${seedMarker} 非生产人物密度验收样本。`,
        goals: `${seedMarker} 验证人物定位与弧线选择。`,
        innerConflict: '必须在压力中做出可见选择。',
        sortOrder: seq,
      })
      created.characters += 1
      characters = await window.electron.character.list(novelId)
    }
    const seededCharacters = characters.filter((item) => item.fullName.startsWith(seedMarker))
    const lead = seededCharacters[0]
    const second = seededCharacters[1]
    const third = seededCharacters[2]
    if (!lead || !second || !third) throw new Error('P2-04 无法准备人物样本。')

    for (const character of seededCharacters) {
      await window.electron.characterArc.upsertCharacterArc({
        novelId,
        characterId: character.id,
        startState: '相信只要控制信息就能控制局面。',
        surfaceWant: '拿回失去的账本。',
        deepNeed: '承认自己必须信任他人。',
        coreFear: '再次成为被牺牲的人。',
        misbelief: '所有关系都只是交换。',
        changeEvent: `${seedMarker} 人物弧改变事件`,
        endState: '愿意承担共同选择的代价。',
        currentStatus: 'active',
        notes: 'P2-04 非生产人物弧样本。',
      })
      created.arcs += 1
    }

    await window.electron.character.upsertRelation({
      novelId,
      charAId: lead.id,
      charBId: second.id,
      relationType: 'rival',
      relationLabel: `${seedMarker} 对手关系`,
      description: '两人争夺同一份证据，但无法彻底切断合作。',
      bilateral: 1,
      intimacyLevel: 2,
      tensionLevel: 5,
    })
    await window.electron.character.upsertRelation({
      novelId,
      charAId: lead.id,
      charBId: third.id,
      relationType: 'ally',
      relationLabel: `${seedMarker} 临时同盟`,
      description: '临时同盟，目标一致但方法冲突。',
      bilateral: 1,
      intimacyLevel: 3,
      tensionLevel: 3,
    })
    const relations = await window.electron.character.getRelations(novelId)
    const seededRelations = relations.filter((item) => item.relationLabel?.startsWith(seedMarker))
    for (const relation of seededRelations) {
      await window.electron.characterArc.upsertRelationshipArc({
        novelId,
        charAId: relation.charAId,
        charBId: relation.charBId,
        relationLabelSnapshot: relation.relationLabel,
        relationTypeSnapshot: relation.relationType,
        startState: '双方暂时站在同一条线两侧。',
        crackPoint: `${seedMarker} 关系裂缝`,
        changeEvent: `${seedMarker} 关系改变事件`,
        endState: '合作或决裂都必须付出明确代价。',
        currentStatus: 'active',
        notes: 'P2-04 非生产关系弧样本。',
      })
      created.relations += 1
    }

    for (const character of seededCharacters) {
      await window.electron.resistance.upsertTrack({
        novelId,
        sourceType: 'character',
        sourceId: character.id,
        resistanceKind: 'antagonist',
        title: `${seedMarker} ${character.fullName}阻力线`,
        goal: '夺回关键证据并迫使主角暴露。',
        intelSource: '旧案线人网络。',
        resourcePool: '人手、假身份和舆论压力。',
        escalationPlan: '先切断退路，再公开证据。',
        currentPressureMode: '持续追踪主角的行动路线。',
        currentStatus: 'active',
        notes: 'P2-04 非生产阻力线样本。',
      })
      created.resistance += 1
    }
    return { marker: seedMarker, target, ...created }
  }, { novelId: projectId, target: DENSITY_TARGET, seedMarker: marker })
}

async function measure(page, route, viewport) {
  return page.evaluate(({ selector, list, viewport }) => {
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
    const listRows = [...(workspace?.querySelectorAll(list) || [])].filter(visible)
    const disclosures = [...(workspace?.querySelectorAll('details') || [])]
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
      clientWidth: root.clientWidth,
      scrollWidth: maxScrollWidth,
      pageHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0, workspace?.scrollHeight || 0),
    }
  }, { selector: route.root, list: route.list, viewport })
}

async function expectVisible(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 12000 })
  if (!(await locator.isVisible())) throw new Error(`P2-04 未看到：${label}`)
}

async function verifyCharacters(page, projectId, marker) {
  const route = ROUTES[0]
  await navigate(page, projectId, route)
  const search = page.getByPlaceholder('搜索姓名、目标、职业或矛盾')
  await search.fill(marker)
  await page.waitForFunction(({ target }) => document.querySelectorAll('[data-character-list-row]').length >= target, { target: DENSITY_TARGET }, { timeout: 12000 })
  const rows = page.locator(route.list)
  await expectVisible(page, rows.first(), '人物列表行')
  const initialCount = await rows.count()
  await rows.first().click({ force: true })
  await page.locator('.novel-characters__advanced summary').click()
  const detailsOpened = await page.locator('.novel-characters__advanced[open]').isVisible()
  const located = await page.waitForFunction(({ seedMarker }) => [...document.querySelectorAll('[data-character-list-row]')].some((row) => row.textContent?.includes(seedMarker)), { seedMarker: marker }, { timeout: 12000 }).then(() => true).catch(() => false)
  const nameInput = page.getByLabel('姓名', { exact: true }).first()
  await nameInput.fill(`P2-04-dirty-${Date.now()}`)
  const unsaved = await page.evaluate(() => document.querySelector('[data-character-save-state]')?.getAttribute('data-character-save-state') === 'unsaved')
  await rows.nth(Math.min(1, initialCount - 1)).click({ force: true })
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前人物还有未保存修改' }).last()
  const leaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (leaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await page.locator('.novel-character-studio__editor').getByRole('button', { name: '保存并确认' }).last().click()
  await page.waitForFunction(() => document.querySelector('[data-character-save-state]')?.getAttribute('data-character-save-state') === 'saved', null, { timeout: 8000 })
  return { initialCount, detailsOpened, located, unsaved, leaveProtection }
}

async function verifyArc(page, projectId, marker) {
  const route = ROUTES[1]
  await navigate(page, projectId, route)
  await page.getByRole('button', { name: '关键角色弧', exact: true }).click()
  const search = page.getByPlaceholder('搜索姓名、目标或矛盾')
  await search.fill(marker)
  const rows = page.locator(route.list)
  await expectVisible(page, rows.first(), '关键角色弧列表行')
  const characterCount = await rows.count()
  await rows.first().click({ force: true })
  await page.locator('.novel-character-arc-center__advanced summary').click()
  const detailsOpened = await page.locator('.novel-character-arc-center__advanced[open]').isVisible()
  const characterId = await page.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('characterId'))
  await page.getByRole('button', { name: '关系弧', exact: true }).click()
  await page.getByPlaceholder('搜索人物、关系或描述').fill(marker)
  await expectVisible(page, rows.first(), '关系弧列表行')
  const relationCount = await rows.count()
  await rows.first().click({ force: true })
  const pair = await page.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('pair'))
  await page.getByRole('button', { name: '关键角色弧', exact: true }).click()
  await page.getByPlaceholder('搜索姓名、目标或矛盾').fill(marker)
  await expectVisible(page, page.locator(route.list).first(), '切回人物弧列表')
  await page.locator(route.list).first().click({ force: true })
  await page.getByRole('button', { name: '登记推进', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await expectVisible(page, dialog, '人物弧推进登记弹窗')
  await dialog.locator('input:not(.ant-select-selection-search-input)').first().fill(`P2-04-人物推进-${Date.now()}`)
  await dialog.locator('textarea').first().fill('记录一次真实的心理或关系位移。')
  await page.locator('.ant-modal-footer .ant-btn-primary').last().click()
  await page.waitForTimeout(600)
  const dirtyField = page.locator('.novel-character-arc-center__field-grid--core textarea').first()
  await dirtyField.fill(`P2-04-dirty-${Date.now()}`)
  const unsaved = await page.evaluate(() => document.querySelector('[data-character-arc-save-state]')?.getAttribute('data-character-arc-save-state') === 'unsaved')
  if (characterCount > 1) {
    await page.locator(route.list).nth(1).click({ force: true })
  } else {
    await page.getByRole('button', { name: '关系弧', exact: true }).click()
  }
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前弧线还有未保存修改' }).last()
  const leaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (leaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  return { characterCount, relationCount, characterId: Boolean(characterId), pair: Boolean(pair), detailsOpened, unsaved, leaveProtection }
}

async function verifyResistance(page, projectId, marker) {
  const route = ROUTES[2]
  await navigate(page, projectId, route)
  await page.getByPlaceholder('搜索人物、阻力或目标').fill(marker)
  const rows = page.locator(route.list)
  await expectVisible(page, rows.first(), '人物阻力列表行')
  const rowCount = await rows.count()
  await rows.first().click({ force: true })
  await page.locator('.novel-resistance-page__advanced summary').click()
  const detailsOpened = await page.locator('.novel-resistance-page__advanced[open]').isVisible()
  const titleInput = page.locator('.novel-resistance-page__field-grid--core input').first()
  await titleInput.fill(`P2-04-dirty-${Date.now()}`)
  const unsaved = await page.evaluate(() => document.querySelector('[data-resistance-save-state]')?.getAttribute('data-resistance-save-state') === 'unsaved')
  if (rowCount > 1) await rows.nth(1).click({ force: true })
  const leaveDialog = page.getByRole('dialog').filter({ hasText: '当前阻力线还有未保存修改' }).last()
  const leaveProtection = await leaveDialog.isVisible().catch(() => false)
  if (leaveProtection) await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click()
  await page.getByRole('button', { name: '保存当前阻力线', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-resistance-save-state]')?.getAttribute('data-resistance-save-state') === 'saved', null, { timeout: 8000 })
  await page.getByRole('button', { name: '登记阻力推进', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await expectVisible(page, dialog, '阻力推进登记弹窗')
  const beatTitle = `P2-04-阻力推进-${Date.now()}`
  await dialog.locator('input:not(.ant-select-selection-search-input)').first().fill(beatTitle)
  await dialog.locator('textarea').first().fill('记录阻力方本章如何出手、得失与后续压力。')
  await page.locator('.ant-modal-footer .ant-btn-primary').last().click()
  await expectVisible(page, page.getByText(beatTitle, { exact: true }), '已登记的阻力推进')
  return { rowCount, detailsOpened, unsaved, leaveProtection, beatSaved: true }
}

function buildReport(runId, projectId, results, staticContracts, interactions, density) {
  const lines = [
    `# P2-04 ${PHASE === 'before' ? '改前' : '改后'} Electron 对比`,
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
  lines.push('', '格式：`clientWidth/scrollWidth; H页面高度; A顶部动作; L可见选择行; D按需详情; 状态`。', '')
  if (PHASE === 'after') {
    lines.push(
      `- 临时密度：${density.characters} 名人物、${density.relations} 条关系、${density.arcs} 条人物弧、${density.resistance} 条阻力线（运行结束已恢复）。`,
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
    const density = PHASE === 'after' ? await seedDensity(page, projectId) : { marker: '', characters: 0, relations: 0, arcs: 0, resistance: 0 }
    const results = {}
    for (const viewport of VIEWPORTS) {
      await setViewport(app, page, viewport)
      for (const route of ROUTES) {
        await navigate(page, projectId, route)
        const item = await measure(page, route, viewport)
        if (!results[route.key]) results[route.key] = {}
        results[route.key][`${viewport.width}x${viewport.height}`] = item
        await page.screenshot({ path: path.join(screenshotsDir, `${route.key}-${viewport.width}x${viewport.height}.png`), fullPage: false, animations: 'disabled', caret: 'hide', timeout: 60000 })
        console.log(`[P2-04] ${item.status.padEnd(7)} ${route.key} ${viewport.width}x${viewport.height}${item.reasons.length ? ` - ${item.reasons.join('; ')}` : ''}`)
      }
    }
    let interactions = {}
    if (PHASE === 'after') {
      await setViewport(app, page, VIEWPORTS[0])
      interactions = {
        characters: await verifyCharacters(page, projectId, density.marker),
        arcCenter: await verifyArc(page, projectId, density.marker),
        resistance: await verifyResistance(page, projectId, density.marker),
      }
      const failed = [
        interactions.characters.initialCount < DENSITY_TARGET ? 'characters.initialCount' : '',
        !interactions.characters.detailsOpened ? 'characters.detailsOpened' : '',
        !interactions.characters.located ? 'characters.located' : '',
        !interactions.characters.unsaved ? 'characters.unsaved' : '',
        !interactions.characters.leaveProtection ? 'characters.leaveProtection' : '',
        interactions.arcCenter.characterCount < DENSITY_TARGET - 1 ? 'arcCenter.characterCount' : '',
        interactions.arcCenter.relationCount < 2 ? 'arcCenter.relationCount' : '',
        !interactions.arcCenter.characterId ? 'arcCenter.characterId' : '',
        !interactions.arcCenter.pair ? 'arcCenter.pair' : '',
        !interactions.arcCenter.detailsOpened ? 'arcCenter.detailsOpened' : '',
        !interactions.arcCenter.unsaved ? 'arcCenter.unsaved' : '',
        !interactions.arcCenter.leaveProtection ? 'arcCenter.leaveProtection' : '',
        interactions.resistance.rowCount < DENSITY_TARGET ? 'resistance.rowCount' : '',
        !interactions.resistance.detailsOpened ? 'resistance.detailsOpened' : '',
        !interactions.resistance.unsaved ? 'resistance.unsaved' : '',
        !interactions.resistance.leaveProtection ? 'resistance.leaveProtection' : '',
        !interactions.resistance.beatSaved ? 'resistance.beatSaved' : '',
      ].filter(Boolean)
      console.log(`[P2-04] interactions ${JSON.stringify(interactions)}`)
      if (failed.length > 0) throw new Error(`P2-04 交互验收失败：${failed.join('、')}`)
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
    restoreAcceptanceDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
