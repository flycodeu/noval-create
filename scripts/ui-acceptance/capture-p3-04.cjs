const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'docs/ui-acceptance/P3-04')
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
  const novels = read('src/pages/NovelList/index.tsx')
  const model = read('src/pages/ModelManager/index.tsx')
  const template = read('src/pages/TemplateManager/index.tsx')
  const checks = [
    ['项目目录保留搜索与状态筛选', novels.includes('搜索小说、简介或题材') && novels.includes('全部状态')],
    ['项目卡网格具备密度标记', novels.includes('data-p3-04-project-grid') && novels.includes('ProjectCard')],
    ['模型目录为列表加当前详情', model.includes('data-p3-04-model-list') && model.includes('model-manager-overview-panel')],
    ['模型 API Key 不展示密钥内容', model.includes('data-model-api-key-status') && model.includes("selected.apiKey ? '已保存' : '未配置'")],
    ['模型来源诊断按需展开', model.includes('data-model-source-disclosure') && model.includes('<details')],
    ['模板目录支持文风与世界切换', template.includes('TYPE_LABELS') && template.includes('Tabs')],
    ['内置模板标记为只读', template.includes('data-template-builtin') && template.includes('内置模板为只读资源')],
    ['内置模板不提供删除动作', template.includes('!tmpl.isBuiltin') && template.includes("tmpl.isBuiltin ? '查看' : '编辑'"),],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
  if (failed.length) throw new Error(`P3-04 静态契约失败：${failed.join('、')}`)
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
  await page.evaluate(({ hash }) => { localStorage.setItem('novelforge-workbench-view-mode', 'professional'); window.location.hash = hash }, { hash: `#${route}` })
  await page.waitForTimeout(850)
}
async function measure(page, selector, viewport) {
  return page.evaluate(({ selector, viewport }) => {
    const root = document.querySelector(selector)
    const doc = document.documentElement
    const body = document.body
    const visible = (node) => { if (!node) return false; const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(node).display !== 'none' }
    return {
      status: root && Math.max(doc.scrollWidth, body.scrollWidth) <= doc.clientWidth + 1 ? 'PASS' : 'BLOCKED',
      viewport,
      clientWidth: doc.clientWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      pageHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      actionCount: [...document.querySelectorAll('.novel-hero__actions .ant-btn, .admin-toolbar__actions .ant-btn, .novel-list-page__header .ant-btn')].filter(visible).length,
      cardCount: root?.querySelectorAll('[data-template-builtin], [data-model-config-card], .novel-project-card').length || 0,
      disclosureCount: root?.querySelectorAll('details').length || 0,
      openDisclosureCount: root ? [...root.querySelectorAll('details')].filter((item) => item.open).length : 0,
    }
  }, { selector, viewport })
}
async function interactions(page) {
  const result = {}
  await navigate(page, '/novels')
  result.projectGridPresent = await page.locator('[data-p3-04-project-grid]').count() === 1
  result.projectCardsDense = await page.locator('[data-p3-04-project-grid] .novel-project-card').count() > 0
  result.projectSearchPresent = await page.getByPlaceholder('搜索小说、简介或题材').count() === 1
  await navigate(page, '/models')
  result.modelListPresent = await page.locator('[data-p3-04-model-list]').count() === 1
  const modelCard = page.locator('[data-model-config-card]').first()
  if (await modelCard.count()) await modelCard.click()
  await page.waitForTimeout(250)
  result.modelKeyProtected = await page.locator('[data-model-api-key-status]').count() > 0
    && (await page.locator('[data-model-api-key-status]').allInnerTexts()).every((text) => /已保存|未配置/.test(text))
  const sourceDisclosure = page.locator('[data-model-source-disclosure]')
  result.modelSourceCollapsed = await sourceDisclosure.count() === 1 && await sourceDisclosure.evaluate((node) => !node.open).catch(() => false)
  if (result.modelSourceCollapsed) {
    await sourceDisclosure.locator('summary').click()
    result.modelSourceRevealed = await sourceDisclosure.locator('.model-manager-source-panel').count() === 1
  } else result.modelSourceRevealed = false
  await navigate(page, '/templates')
  result.templateGridPresent = await page.locator('[data-p3-04-template-grid]').count() === 1
  const builtin = page.locator('[data-template-builtin="true"]').first()
  result.templateBuiltinPresent = await builtin.count() === 1
  if (result.templateBuiltinPresent) {
    await builtin.getByRole('button', { name: /查看内置模板/ }).click()
    const modal = page.locator('.ant-modal:visible').last()
    result.templateBuiltinReadonly = await modal.getByText('内置模板为只读资源').count() === 1
      && await modal.locator('input:disabled, textarea:disabled, .ant-select-disabled').count() >= 3
    await modal.getByRole('button', { name: '关闭', exact: true }).click().catch(() => undefined)
  } else result.templateBuiltinReadonly = false
  return result
}
function buildReport(staticList, interactionsResult, metrics) {
  const lines = [`# P3-04 改后 Electron 验收`, '', `- 运行编号：\`${RUN_ID}\``, '', '| 页面 | 1440×900 | 1280×800 | 1024×768 | 900×760 |', '| --- | --- | --- | --- | --- |']
  for (const [key, values] of Object.entries(metrics)) {
    lines.push(`| ${key === 'novels' ? '项目目录' : key === 'models' ? '模型管理' : '模板管理'} | ${VIEWPORTS.map((v) => { const item = values[`${v.width}x${v.height}`]; return `${item.clientWidth}/${item.scrollWidth}; H${Math.round(item.pageHeight)}; A${item.actionCount}; C${item.cardCount}; D${item.disclosureCount}; ${item.status}` }).join(' | ')} |`)
  }
  lines.push('', `- 静态契约：${staticList.length}/${staticList.length} PASS`, `- 交互检查：${Object.values(interactionsResult).filter(Boolean).length}/${Object.keys(interactionsResult).length} PASS`, '- 数据保护：本轮仅执行只读导航、展开和内置模板查看，未写入业务数据。')
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
    const metrics = { novels: {}, models: {}, templates: {} }
    const routes = { novels: ['/novels', '.novel-list-page'], models: ['/models', '.model-manager-page'], templates: ['/templates', '.template-manager-page'] }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      for (const [key, [route, selector]] of Object.entries(routes)) {
        await navigate(page, route)
        metrics[key][`${viewport.width}x${viewport.height}`] = await measure(page, selector, viewport)
        await page.screenshot({ path: path.join(RUN_DIR, 'screenshots', `${key}-${viewport.width}x${viewport.height}.png`), fullPage: true })
      }
    }
    const interactionsResult = await interactions(page)
    writeJson(path.join(RUN_DIR, 'metrics.json'), metrics)
    writeJson(path.join(RUN_DIR, 'interactions.json'), interactionsResult)
    fs.writeFileSync(path.join(RUN_DIR, 'after.md'), `${buildReport(staticList, interactionsResult, metrics)}\n`, 'utf8')
    fs.mkdirSync(EVIDENCE, { recursive: true })
    fs.copyFileSync(path.join(RUN_DIR, 'after.md'), path.join(EVIDENCE, 'after.md'))
    fs.copyFileSync(path.join(RUN_DIR, 'interactions.json'), path.join(EVIDENCE, 'after-interactions.json'))
    fs.writeFileSync(path.join(EVIDENCE, 'latest-run.json'), `${JSON.stringify({ runId: RUN_ID, runDir: path.relative(ROOT, RUN_DIR) }, null, 2)}\n`, 'utf8')
    const failed = Object.entries(interactionsResult).filter(([, value]) => !value).map(([key]) => key)
    const blocked = Object.values(metrics).flatMap((group) => Object.values(group)).filter((item) => item.status !== 'PASS')
    console.log(`[P3-04] ${failed.length || blocked.length ? 'BLOCKED' : 'PASS'}; static ${staticList.length}/${staticList.length}; interactions ${Object.keys(interactionsResult).length - failed.length}/${Object.keys(interactionsResult).length}; run=${RUN_ID}`)
    if (failed.length || blocked.length) { console.error(`失败项：${failed.join('、')}`); process.exitCode = 1 }
  } finally {
    if (app) await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
    if (app) await app.close().catch(() => undefined)
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
