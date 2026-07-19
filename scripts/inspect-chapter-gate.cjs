const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  }
  if (request.startsWith('@main/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  }
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    for (const ext of ['.ts', '.tsx', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function parseJson(value, fallback = null) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

async function main() {
  const chapterId = Number(process.argv[2])
  const phase = process.argv[3] === 'final' ? 'final' : 'pipeline'
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    throw new Error('Usage: electron scripts/inspect-chapter-gate.cjs <chapterId> [pipeline|final]')
  }

  await app.whenReady()
  const { initDb } = requireProject('electron/database/db.ts')
  initDb()
  const chapterService = requireProject('electron/services/chapter.service.ts')
  const dialogueService = requireProject('electron/services/dialogue-fingerprint.service.ts')
  const chapter = chapterService.getChapter(chapterId)
  if (!chapter) throw new Error(`Chapter ${chapterId} not found`)

  const publishCheck = chapterService.runChapterPublishCheck(chapterId, { phase })
  const reviewNotes = parseJson(chapter.reviewNotesJson, {}) || {}
  const contractValidation = publishCheck.contractValidation || reviewNotes.contract_validation || null
  const dialogueAnalysis = dialogueService.analyzeChapterDialogueAgainstNovel(
    chapter.novelId,
    chapter.chapterNum,
    chapter.content || '',
  )
  const failedContractItems = (contractValidation?.itemResults || [])
    .filter((item) => item.verdict && item.verdict !== 'pass')
    .map((item) => ({
      type: item.contractItemType || item.key || '',
      verdict: item.verdict,
      expected: item.expected || '',
      evidence: item.evidenceExcerpt || '',
      rewriteHint: item.rewriteHint || '',
    }))
  const output = {
    chapterId,
    novelId: chapter.novelId,
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    status: chapter.status,
    wordCount: chapter.wordCount,
    publishCheck: {
      phase,
      ready: publishCheck.ready,
      gateLevel: publishCheck.gateLevel,
      summary: publishCheck.summary,
      checklist: publishCheck.checklist,
      scoreBreakdown: publishCheck.scoreBreakdown,
    },
    contractValidation: contractValidation
      ? {
        status: contractValidation.status,
        summary: contractValidation.summary,
        failedItems: failedContractItems,
        rewriteHints: contractValidation.rewriteHints || [],
      }
      : null,
    dialogueAnalysis: {
      risks: dialogueAnalysis.risks || [],
      similarities: dialogueAnalysis.similarities || [],
      drifts: dialogueAnalysis.drifts || [],
      fillerRisks: dialogueAnalysis.fillerRisks || [],
      infoDensityRisks: dialogueAnalysis.infoDensityRisks || [],
      requiredVoiceLockCharacterIds: dialogueAnalysis.requiredVoiceLockCharacterIds || [],
    },
    reviewNotes: {
      severity: reviewNotes.severity || '',
      rewriteRequired: Boolean(reviewNotes.rewrite_required),
      summary: reviewNotes.summary || '',
      revisionBrief: reviewNotes.revision_brief || '',
      criticalFixes: reviewNotes.critical_fixes || [],
      rewriteDelta: reviewNotes.rewrite_delta || null,
      rewriteRecheck: reviewNotes.rewrite_recheck || null,
      readerHookRisks: reviewNotes.reader_hook_risks || [],
      stepMemoryRisks: reviewNotes.step_memory_risks || [],
      arcProgressRisks: reviewNotes.arc_progress_risks || [],
    },
  }
  console.log(JSON.stringify(output, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    if (app.isReady()) app.quit()
  })
