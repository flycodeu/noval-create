const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

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
