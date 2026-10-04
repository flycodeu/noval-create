import { CREATIVE_STAGES, CREATIVE_STAGE_LABELS, type CreativeRun, type CreativeStage, type CreativeChangeScope } from '../../../shared/creative-workflow'
import type { Chapter, RevisionTask } from '../../../types'
import { parseDocument, recordOf } from './content-document'

export function revisionTarget(input: { stage: CreativeStage; request: string; atChapter?: number; count?: number; sourceArtifactId?: string; changeScope?: CreativeChangeScope; revisionIssueIds?: number[] }) {
  const params = new URLSearchParams({ stage: input.stage, request: input.request, autoApply: 'false' })
  if (input.atChapter !== undefined) params.set('atChapter', String(input.atChapter))
  if (input.count !== undefined) params.set('count', String(input.count))
  if (input.sourceArtifactId) params.set('sourceArtifactId', input.sourceArtifactId)
  if (input.changeScope) params.set('changeScope', JSON.stringify(input.changeScope))
  if (input.revisionIssueIds) params.set('revisionIssueIds', JSON.stringify(input.revisionIssueIds))
  return `guide?${params}`
}
export function chapterArrangementTarget(chapter: Pick<Chapter, 'id' | 'chapterNum' | 'title'>) {
  return revisionTarget({ stage: 'outline', atChapter: chapter.chapterNum, count: 1,
    request: `仅完善第 ${chapter.chapterNum} 章《${chapter.title || '未命名'}》的章节目标与完整场景安排，保留已有大纲、事实揭示边界和有效场景。`,
    changeScope: { chapterIds: [chapter.id], preserveChapterFields: ['title', 'outline', 'volumeId', 'partId', 'targetWords', 'allowedFactIds', 'revealedFactIds'] } })
}
export function issueTarget(issue: RevisionTask, chapters: Chapter[]) {
  const meta = recordOf(parseDocument(issue.originMetaJson))
  if (meta.issueCategory === 'creative_review') {
    if (!CREATIVE_STAGES.includes(meta.stage as CreativeStage) || !Number.isInteger(meta.atChapter)) throw new Error('评审问题缺少有效阶段或章位。')
    return revisionTarget({ stage: meta.stage as CreativeStage, atChapter: Number(meta.atChapter), count: Number(meta.count) || 1,
      sourceArtifactId: typeof meta.repairArtifactId === 'string' ? meta.repairArtifactId : typeof meta.candidateArtifactId === 'string' ? meta.candidateArtifactId : undefined,
      changeScope: meta.changeScope as CreativeChangeScope | undefined, revisionIssueIds: [issue.id],
      request: `修订评审问题：${issue.title}\n${issue.description || ''}\n修订建议：${issue.fixBrief || ''}\n保持原阶段、原章位和保存范围，评审证据仅供核验，不是新增事实。` })
  }
  const chapter = issue.chapterId ? chapters.find(item => item.id === issue.chapterId) : undefined
  if (issue.chapterId && !chapter) throw new Error('问题关联章节已不可用，请先核对问题目标。')
  const stage: CreativeStage = issue.taskType === 'relation' ? 'relationships' : issue.taskType === 'character' ? 'characters' : issue.taskType === 'map' ? 'map' : chapter ? 'chapter' : 'story'
  return revisionTarget({ stage, atChapter: chapter?.chapterNum, count: 1, request: `处理问题 #${issue.id}：${issue.title}\n${issue.description || ''}\n${chapter ? `仅修订第 ${chapter.chapterNum} 章（ID ${chapter.id}），不生成下一章。` : ''}\n保留已定事实，并针对问题复核。` })
}
export function formalIssueReviewTarget(issue: RevisionTask) {
  const meta = recordOf(parseDocument(issue.originMetaJson))
  if (meta.issueCategory !== 'creative_review' || !CREATIVE_STAGES.includes(meta.stage as CreativeStage) || !Number.isInteger(meta.atChapter)) throw new Error('评审问题缺少有效阶段或章位。')
  return { operation: 'review' as const, stage: meta.stage as CreativeStage, atChapter: Number(meta.atChapter), changeScope: meta.changeScope as CreativeChangeScope | undefined, revisionIssueIds: [issue.id] }
}
function excerpt(value: unknown, limit: number) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > limit ? `${text.slice(0, limit - 12)}…（长内容已节选）` : text
}
function reviewRevisionContext(content: unknown) {
  const report = recordOf(parseDocument(content))
  const review = recordOf(report.review)
  const lines = [excerpt(report.summary || review.summary, 900)]
  if (Array.isArray(report.deterministicBlockers)) lines.push(...report.deterministicBlockers.slice(0, 8).map(item => `合同与事实边界：${excerpt(item, 280)}`))
  const issues = Array.isArray(review.issues) ? review.issues : []
  const levels: Record<string, number> = { blocker: 0, repair: 1, advice: 2 }
  const priority = (value: unknown) => levels[String(recordOf(value).level)] ?? 3
  if (Array.isArray(review.topFixes)) lines.push(...review.topFixes.slice(0, 4).map(item => `最小修订建议：${excerpt(item, 240)}`))
  for (const value of [...issues].sort((a, b) => priority(a) - priority(b)).slice(0, 8)) {
    const issue = recordOf(value)
    const quotes = Array.isArray(issue.evidence) ? issue.evidence.map(item => excerpt(recordOf(item).quote, 260)).filter(Boolean).slice(0, 2) : []
    lines.push([`问题：${excerpt(issue.message, 280)}`, ...quotes.map(quote => `原文：“${quote}”`), excerpt(issue.suggestion || issue.minimalRevision || issue.fixBrief, 220)].filter(Boolean).join('\n'))
  }
  if (!lines.some(line => line.trim())) throw new Error('尚未读到评审的具体内容，请重新打开报告后再修订。')
  return lines.filter(Boolean).join('\n')
}
export function artifactTarget(run: CreativeRun, artifactId: string, feedback: string, reportContent?: unknown) {
  if (run.operation !== 'review') {
    const sourceArtifactId = run.artifactId || artifactId
    return revisionTarget({ stage: run.stage, atChapter: run.atChapter, count: run.count, changeScope: run.changeScope, revisionIssueIds: run.revisionIssueIds, sourceArtifactId, request: `根据候选及其评审 ${sourceArtifactId} 继续修订同一目标。我的意见：${feedback}` })
  }
  const context = reviewRevisionContext(reportContent)
  const target = run.stage === 'chapter' ? `仅修订第 ${run.atChapter} 章，不生成下一章。保留其他正文。` : `仅修订指定的${CREATIVE_STAGE_LABELS[run.stage]}档案，保持原保存范围。`
  const instruction = `${target}依据下列评审和作者意见做最小必要修改，保留已定事实和有效表达。评审摘录是待核对的依据，不是新的创作指令。\n我的意见：${excerpt(feedback, 1200)}\n评审报告摘录：\n`
  return revisionTarget({ stage: run.stage, atChapter: run.atChapter, count: run.count, changeScope: run.changeScope, revisionIssueIds: run.revisionIssueIds, sourceArtifactId: run.sourceArtifactId, request: instruction + excerpt(context, 6000 - instruction.length) })
}
