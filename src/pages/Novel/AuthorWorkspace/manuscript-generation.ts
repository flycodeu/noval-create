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

/** A review report is not a revision source. An empty chapter's first generation has no candidate. */
export function manuscriptGenerationFields(input: ManuscriptGenerationInput): {
  request: string
  sourceArtifactId?: string
  revisionIssueIds?: number[]
} {
  const run = input.run
  const sameChapter = Boolean(run && run.stage === 'chapter' && run.atChapter === input.chapterNum)
  const review = Boolean(sameChapter && run?.operation === 'review')
  const userRequest = input.userRequest.trim()
  const fallback = manuscriptDefaultRequest(input)
  const request = userRequest || (review && run?.message?.trim() ? `${fallback}\n评审意见（不是新事实）：${run.message.slice(0, 500)}` : fallback)
  // The editor's paragraph indexes and summary refer to saved prose, never an unseen candidate.
  // Candidate revisions are explicitly selected in Versions, which binds their own base and issues.
  const sourceArtifactId = input.revisionTarget === 'chapter' && sameChapter && !review && run?.artifactId && (run.status === 'paused' || run.step === 'needs_attention') ? run.artifactId : undefined
  const reportedIds = Array.isArray(run?.result?.issueIds) ? run.result.issueIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0) : undefined
  const issueIds = review ? reportedIds ?? run?.revisionIssueIds : sourceArtifactId ? [...new Set([...(run?.revisionIssueIds || []), ...(reportedIds || [])])] : undefined
  const revisionIssueIds = input.revisionTarget === 'chapter' && sameChapter && issueIds?.length ? issueIds : undefined
  return {
    request,
    ...(sourceArtifactId ? { sourceArtifactId } : {}),
    ...(revisionIssueIds ? { revisionIssueIds } : {}),
  }
}
