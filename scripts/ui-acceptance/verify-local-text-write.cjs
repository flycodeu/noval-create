const { _electron: electron } = require('playwright')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const SUMMARY_PATH = path.join(ROOT, 'docs/ui-acceptance/P0-00/capture-summary.json')
const EVIDENCE_ROOT = path.join(ROOT, 'docs/ui-acceptance/LOCAL-TEXT-WRITE')
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const RUN_DIR = path.join(EVIDENCE_ROOT, 'runs', RUN_ID)
const VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const TEXT = [
  '临时文本验证：雨停后，沈砚把最后一盏值夜灯移到窗边。',
  '他先确认章节正文已经写入，再回到编辑器检查刷新后的内容。',
].join('\n\n')

function normalizeRenderedText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function resolveProjectId() {
  const requested = Number(process.env.NOVELFORGE_UI_ACCEPTANCE_NOVEL_ID || 0)
  if (requested > 0) return requested
  if (!fs.existsSync(SUMMARY_PATH)) throw new Error('缺少 P0-00 capture-summary.json，请先运行 npm run acceptance:p0-00。')
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'))
  const projectId = Number(summary?.project?.id || 0)
  if (projectId <= 0) throw new Error('P0-00 摘要中没有有效项目 ID。')
  return projectId
}

async function launchApp() {
  return electron.launch({
    executablePath: require('electron'),
    args: [path.join(ROOT, 'out/main/main.js'), '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_RENDERER_URL: `file://${path.join(ROOT, 'out/renderer/index.html').replace(/\\/g, '/')}`,
    },
  })
}

async function closeApp(app) {
  if (!app) return
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function snapshotDatabase() {
  const probe = await launchApp()
  let userDataPath
  try {
    userDataPath = await probe.evaluate(({ app }) => app.getPath('userData'))
  } finally {
    await closeApp(probe)
  }
  const databasePath = path.join(userDataPath, 'novelforge.db')
  if (!fs.existsSync(databasePath)) throw new Error(`找不到验收数据库：${databasePath}`)
  const snapshotDir = path.join(RUN_DIR, '.database-snapshot')
  fs.mkdirSync(snapshotDir, { recursive: true })
  const files = ['', '-wal', '-shm'].map((suffix) => {
    const source = `${databasePath}${suffix}`
    const backup = path.join(snapshotDir, `novelforge.db${suffix}`)
    const existed = fs.existsSync(source)
    if (existed) fs.copyFileSync(source, backup)
    return { source, backup, existed }
  })
  return { databasePath, snapshotDir, files }
}

function restoreDatabase(snapshot) {
  if (!snapshot) return
  for (const file of snapshot.files) {
    if (file.existed) fs.copyFileSync(file.backup, file.source)
    else if (fs.existsSync(file.source)) fs.unlinkSync(file.source)
  }
  fs.rmSync(snapshot.snapshotDir, { recursive: true, force: true })
}

async function navigateToEditor(page, projectId, chapterId) {
  const hash = `#/novels/${projectId}/writing/editor?chapterId=${chapterId}`
  await page.evaluate(({ nextHash, storageKey }) => {
    localStorage.setItem(storageKey, 'professional')
    window.location.hash = nextHash
  }, { nextHash: hash, storageKey: VIEW_MODE_STORAGE_KEY })
  await page.waitForFunction(({ expectedHash }) => (
    window.location.hash === expectedHash
      && Boolean(document.querySelector('.novel-writing-console-page'))
      && Boolean(document.querySelector('[contenteditable="true"]'))
  ), { expectedHash: hash }, { timeout: 20000 })
}

async function createChapter(page, projectId) {
  const title = `本地文本验证章-${Date.now()}`
  const chapterId = await page.evaluate(({ novelId, chapterTitle }) => window.electron.chapter.create(novelId, {
    title: chapterTitle,
    status: 'draft',
    outline: '仅用于本地写入链路验证，运行后会恢复数据库。',
  }), { novelId: projectId, chapterTitle: title })
  const created = await page.evaluate((id) => window.electron.chapter.get(id), chapterId)
  if (!created || created.title !== title || created.content) throw new Error('临时章节创建结果不符合预期。')
  return { chapterId, title }
}

async function writeAndVerify(page, projectId, chapterId) {
  await navigateToEditor(page, projectId, chapterId)
  const editor = page.locator('[contenteditable="true"]').first()
  const emptyEditorHeight = await editor.evaluate((element) => Math.round(element.getBoundingClientRect().height))
  if (emptyEditorHeight > 400) throw new Error(`空章节编辑区仍然过高：${emptyEditorHeight}px`)
  await editor.fill(TEXT)
  const editorDomText = String(await editor.innerText()).replace(/\r\n?/g, '\n')
  await page.waitForFunction(async ({ id, text }) => {
    const chapter = await window.electron.chapter.get(id)
    return chapter?.content === text && Number(chapter.wordCount || 0) > 0
  }, { id: chapterId, text: TEXT }, { timeout: 15000 })
  await page.locator('[data-writing-save-state="saved"]').first().waitFor({ state: 'visible', timeout: 15000 })
  const stored = await page.evaluate((id) => window.electron.chapter.get(id), chapterId)
  const versions = await page.evaluate((id) => window.electron.chapter.listVersions(id), chapterId)
  const rendered = await page.locator('.novel-writing-shell__editor-sheet').first().innerText()
  if (normalizeRenderedText(rendered) !== normalizeRenderedText(TEXT)) throw new Error('写入后编辑器未显示完整临时文本。')
  if (!stored || stored.content !== TEXT || Number(stored.wordCount || 0) <= 0) {
    throw new Error('章节正文未按编辑器输入写入数据库。')
  }
  if (!versions.some((version) => version.content === TEXT && version.versionSource === 'manual-save')) {
    throw new Error('章节正文写入后没有留下 manual-save 版本。')
  }
  return {
    checks: {
      emptyEditorCompact: true,
      editorRenderedExact: true,
      databaseContentExact: true,
      manualSaveVersion: true,
    },
    emptyEditorHeight,
    editorDomText,
    persistedText: stored.content,
    wordCount: Number(stored.wordCount || 0),
  }
}

async function verifyReload(page, projectId, chapterId) {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(document.querySelector('.novel-writing-console-page')))
  await page.locator('.novel-writing-shell__editor-sheet').first().waitFor({ state: 'visible', timeout: 20000 })
  const rendered = await page.locator('.novel-writing-shell__editor-sheet').first().innerText()
  return normalizeRenderedText(rendered) === normalizeRenderedText(TEXT)
}

async function verifyRestored(projectId, chapterId) {
  const app = await launchApp()
  try {
    const page = await app.firstWindow({ timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    const restored = await page.evaluate(async ({ novelId, id }) => {
      const [chapter, chapters] = await Promise.all([
        window.electron.chapter.get(id),
        window.electron.chapter.list(novelId),
      ])
      return { chapter, existsInList: chapters.some((item) => item.id === id) }
    }, { novelId: projectId, id: chapterId })
    return restored.chapter === null && restored.existsInList === false
  } finally {
    await closeApp(app)
  }
}

async function main() {
  fs.mkdirSync(RUN_DIR, { recursive: true })
  const projectId = resolveProjectId()
  const snapshot = await snapshotDatabase()
  let app
  let chapterId = null
  let databaseRestored = false
  try {
    app = await launchApp()
    const page = await app.firstWindow({ timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    const chapter = await createChapter(page, projectId)
    chapterId = chapter.chapterId
    const write = await writeAndVerify(page, projectId, chapterId)
    const reloadRenderedExact = await verifyReload(page, projectId, chapterId)
    const report = {
      runId: RUN_ID,
      projectId,
      chapterId,
      method: 'Electron bridge chapter.create + editor input + chapter.update; no configured model call',
      temporaryText: TEXT,
      emptyEditorHeight: write.emptyEditorHeight,
      editorDomText: write.editorDomText,
      persistedText: write.persistedText,
      wordCount: write.wordCount,
      checks: { ...write.checks, reloadRenderedExact },
    }
    writeJson(path.join(RUN_DIR, 'verification.json'), report)
    await closeApp(app)
    app = null
    restoreDatabase(snapshot)
    databaseRestored = true
    const restored = await verifyRestored(projectId, chapterId)
    report.checks.databaseRestored = restored
    writeJson(path.join(RUN_DIR, 'verification.json'), report)
    fs.mkdirSync(EVIDENCE_ROOT, { recursive: true })
    writeJson(path.join(EVIDENCE_ROOT, 'latest.json'), { runId: RUN_ID, runDirectory: `runs/${RUN_ID}` })
    console.log(`[LOCAL-TEXT-WRITE] ${Object.values(report.checks).every(Boolean) ? 'PASS' : 'BLOCKED'}; checks=${Object.values(report.checks).filter(Boolean).length}/${Object.keys(report.checks).length}; chapter=${chapterId}`)
    if (!Object.values(report.checks).every(Boolean)) throw new Error('本地临时文本写入验证未全部通过。')
  } finally {
    await closeApp(app)
    if (!databaseRestored) restoreDatabase(snapshot)
  }
}

main().catch((error) => {
  console.error('[LOCAL-TEXT-WRITE] FAILED', error)
  process.exitCode = 1
})
