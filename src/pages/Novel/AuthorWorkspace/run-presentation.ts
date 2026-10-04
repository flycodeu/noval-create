import { CREATIVE_STAGE_LABELS, type CreativeRun } from '../../../shared/creative-workflow'
import type { AgentArtifact } from '../../../shared/agent-artifacts'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))] : []
}
function candidate(content: unknown): Record<string, unknown> {
  const output = record(content).output ?? content
  if (typeof output !== 'string') return record(output)
  try { return record(JSON.parse(output)) } catch { return {} }
}

/** Keep execution budgets and hashes in the stored report, not in the reading view. */
export function formalReviewPresentation(content: unknown): unknown {
  const report = record(content)
  if (report.schemaVersion === 'generic-asset-review-v1') {
    const modelReview = { ...record(report.modelReview) }
    if (modelReview.initialModelReviewSkipped) delete modelReview.review
    return { ...Object.fromEntries(['status', 'summary', 'hardBlockers', 'warnings', 'checks'].filter(key => report[key] !== undefined).map(key => [key, report[key]])), modelReview }
  }
  if (!['chapter-review-v1', 'atlas-review-v1', 'creative-assets-review-v1'].includes(String(report.schemaVersion))) return content
  return Object.fromEntries(['status', 'summary', 'snapshot', 'review', 'deterministicBlockers'].filter(key => report[key] !== undefined).map(key => [key, report[key]]))
}
export function reviewReportTitle(content?: unknown, run?: CreativeRun): string {
  const report = record(content)
  const failureStage = record(report.modelReview).failureStage || run?.result?.reviewFailureStage
  return failureStage === 'contract' ? '结构校验未通过' : '评审报告'
}

/** A completed step or a passed review alone is not evidence of a writeback. */
export function hasSavedRunResult(run: CreativeRun): boolean {
  const result = run.result
  return run.operation !== 'review' && Boolean(run.artifactId && result?.artifactId === run.artifactId
    && Array.isArray(result.chapterIds) && result.chapterIds.every(id => Number.isInteger(id) && Number(id) > 0)
    && Number.isInteger(result.contextVersion) && Number(result.contextVersion) > 0)
}
export function canApplyRunCandidate(run: CreativeRun | null | undefined, artifact: Pick<AgentArtifact, 'id' | 'kind' | 'status' | 'reviewArtifactId'> | null | undefined): boolean {
  return Boolean(run && artifact && run.operation !== 'review' && !hasSavedRunResult(run)
    && !run.result?.supersededByArtifactId
    && run.artifactId === artifact.id && artifact.kind === 'generic_draft'
    && ['reviewed', 'approved'].includes(artifact.status)
    && artifact.reviewArtifactId && artifact.reviewArtifactId === run.reviewArtifactId
    && run.reviewStatus === 'passed' && run.status === 'paused' && run.step === 'needs_attention')
}
export function runRecoveryAction(run: CreativeRun): 'inspect' | 'retry' | 'resume' | null {
  if (run.recoveryPending && ['paused', 'failed'].includes(run.status)) return 'resume'
  if (hasSavedRunResult(run) || !['needs_attention', 'cancelled'].includes(run.step) && run.status !== 'failed') return null
  if (run.status === 'paused' && run.artifactId && run.reviewStatus === 'passed' && run.operation !== 'review') return 'inspect'
  return 'retry'
}

export function runStatusLabel(run: CreativeRun): string {
  if (hasSavedRunResult(run)) return '已保存'
  if (run.recoveryPending && ['paused', 'failed'].includes(run.status)) return '已暂停 · 可继续'
  if (run.result?.supersededByArtifactId) return '已有修订版'
  if (run.step === 'cancelled' || run.status === 'cancelled') return '已停止'
  if (run.result?.reviewFailureStage === 'contract') return '结构校验未通过'
  if (run.status === 'failed') return '运行失败'
  if (run.operation === 'review' && run.step === 'completed') return '仅评审完成'
  if (run.artifactId && run.reviewStatus === 'passed' && ['needs_attention', 'completed'].includes(run.step)) return '候选待确认'
  if (run.step === 'needs_attention' || run.status === 'blocked') return '已阻断'
  if (run.step === 'completed') return '已结束 · 保存未确认'
  return ({ context: '读取依据', generating: '生成中', reviewing: '评审中', revising: '修订中', applying: '保存中' } as Record<string, string>)[run.step] || '处理中'
}

export function runChapterLabel(run: Pick<CreativeRun, 'atChapter'>): string {
  return run.atChapter === 0 ? '初始设定' : `第 ${run.atChapter} 章`
}

export function runResultPresentation(run: CreativeRun, content?: unknown, names: Record<string, string> = {}) {
  const stage = CREATIVE_STAGE_LABELS[run.stage] || '创作'
  const saved = hasSavedRunResult(run)
  const appliedIds = saved ? ids(run.result?.appliedIds) : []
  const chapterIds = saved && Array.isArray(run.result?.chapterIds) ? [...new Set(run.result.chapterIds as number[])] : []
  const count = appliedIds.length + chapterIds.length
  const data = candidate(content)
  const idMap = record(run.result?.idMap)
  const changedNames = Array.isArray(data.changes) ? data.changes.flatMap(raw => {
    const change = record(raw)
    const id = typeof change.id === 'string' ? change.id : idMap[String(change.clientId)]
    if (saved && (typeof id !== 'string' || !appliedIds.includes(id))) return []
    const name = change.name || change.label
    return typeof name === 'string' && name.trim() ? [name.trim()] : []
  }) : []
  const savedNames = saved && Array.isArray(run.result?.savedEntities) ? run.result.savedEntities.flatMap(raw => {
    const entity = record(raw)
    return typeof entity.id === 'string' && appliedIds.includes(entity.id) && typeof entity.name === 'string' && entity.name.trim() ? [entity.name.trim()] : []
  }) : []
  const displayNames = [...new Set([...savedNames, ...changedNames, ...appliedIds.map(id => names[id]).filter(Boolean)])]
  const nameSummary = displayNames.length ? `${displayNames.slice(0, 3).join('、')}${displayNames.length > 3 ? `等 ${displayNames.length} 项` : ''}` : ''
  const title = run.operation === 'review' ? `${runChapterLabel(run)} · ${stage}评审`
    : saved ? `${stage} · ${count ? `${count} 项变更已保存` : '已保存'}`
      : run.result?.reviewFailureStage === 'contract' ? `${stage} · 结构校验未通过`
      : `${stage} · ${runChapterLabel(run)}`
  let summary: string
  if (saved) summary = nameSummary || (count ? `已保存 ${count} 项变更。` : `${stage}结果已保存到项目。`)
  else if (run.result?.supersededByArtifactId) summary = '已有通过检查的后续修订版，请查看新版。'
  else if (run.result?.reviewFailureStage === 'contract' && run.step !== 'cancelled') summary = '生成结果未满足保存格式，请查看具体问题并修订。'
  else if (run.operation === 'review' && run.step === 'completed') summary = run.reviewStatus === 'passed' ? `模型评审通过，${run.stage === 'chapter' ? '正文' : '正式资料'}未修改。` : `评审发现待处理问题，${run.stage === 'chapter' ? '正文' : '正式资料'}未修改。`
  else if (runStatusLabel(run) === '候选待确认') summary = nameSummary ? `${nameSummary}。模型评审通过，候选待确认保存。` : '模型评审通过，候选待确认保存。'
  else if (run.step === 'cancelled' || run.status === 'cancelled') summary = '任务已停止。'
  else if (run.status === 'failed') summary = '本轮执行失败，请查看任务详情。'
  else if (run.step === 'needs_attention' || run.status === 'blocked') summary = '本轮未通过检查，请查看评审并修订。'
  else if (run.step === 'completed') summary = '未找到可核实的保存结果，请查看任务详情。'
  else summary = run.message || '正在处理本轮内容。'
  return { title, summary, saved }
}
