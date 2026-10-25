import type { CreativeRun } from '../../../shared/creative-workflow'

export type ManuscriptRevisionTarget = 'chapter' | 'paragraphs' | 'summary'

type ManuscriptRun = Pick<CreativeRun, 'stage' | 'atChapter' | 'operation' | 'artifactId' | 'status' | 'step' | 'message' | 'revisionIssueIds' | 'result'>

export interface ManuscriptGenerationInput {
  chapterNum: number
  title?: string
  hasSavedProse: boolean
  revisionTarget: ManuscriptRevisionTarget
  userRequest: string
  run?: ManuscriptRun | null
}

export function manuscriptDefaultRequest(input: Pick<ManuscriptGenerationInput, 'chapterNum' | 'title' | 'hasSavedProse' | 'revisionTarget'>): string {
  if (input.revisionTarget === 'summary') return '根据本章已保存正文修订摘要，准确概括动作主语、事件先后和结果，不改变正文。'
  return `结合本章安排、现有设定与前文，${input.hasSavedProse ? '审阅并修订' : '生成'}第 ${input.chapterNum} 章《${input.title?.trim() || '未命名'}》，保留已确定事实，完成连续性与叙事评审。`
}

function isSameChapterRun(run: ManuscriptRun | null | undefined, chapterNum: number): run is ManuscriptRun {
  return Boolean(run && run.stage === 'chapter' && run.atChapter === chapterNum)
}

function extractReportedIssueIds(run: ManuscriptRun | null | undefined): number[] | undefined {
  if (!Array.isArray(run?.result?.issueIds)) return undefined
  return run.result.issueIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
}

function resolveCandidateSourceId(input: ManuscriptGenerationInput, sameChapter: boolean, review: boolean): string | undefined {
  const run = input.run
  if (input.revisionTarget !== 'chapter' || !sameChapter || review || !run?.artifactId) return undefined
  return run.status === 'paused' || run.step === 'needs_attention' ? run.artifactId : undefined
}

function resolveRevisionIssueIds(input: ManuscriptGenerationInput, sameChapter: boolean, review: boolean, sourceArtifactId?: string): number[] | undefined {
  if (input.revisionTarget !== 'chapter' || !sameChapter) return undefined
  const run = input.run
  const reportedIds = extractReportedIssueIds(run)
  const issueIds = review ? reportedIds ?? run?.revisionIssueIds : sourceArtifactId ? [...new Set([...(run?.revisionIssueIds || []), ...(reportedIds || [])])] : undefined
  return issueIds?.length ? issueIds : undefined
}

/** A review report is not a revision source. An empty chapter's first generation has no candidate. */
export function manuscriptGenerationFields(input: ManuscriptGenerationInput): {
  request: string
  sourceArtifactId?: string
  revisionIssueIds?: number[]
} {
  const run = input.run
  const sameChapter = isSameChapterRun(run, input.chapterNum)
  const review = Boolean(sameChapter && run?.operation === 'review')
  const userRequest = input.userRequest.trim()
  const fallback = manuscriptDefaultRequest(input)
  const reviewMessage = review ? run?.message?.trim() : ''
  const request = userRequest || (reviewMessage ? `${fallback}\n评审意见（不是新事实）：${reviewMessage.slice(0, 500)}` : fallback)
  // The editor's paragraph indexes and summary refer to saved prose, never an unseen candidate.
  // Candidate revisions are explicitly selected in Versions, which binds their own base and issues.
  const sourceArtifactId = resolveCandidateSourceId(input, sameChapter, review)
  const revisionIssueIds = resolveRevisionIssueIds(input, sameChapter, review, sourceArtifactId)
  return {
    request,
    ...(sourceArtifactId ? { sourceArtifactId } : {}),
    ...(revisionIssueIds ? { revisionIssueIds } : {}),
  }
}
