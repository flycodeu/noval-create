import { getSqlite } from '../database/db'
import { listChapters } from './chapter.service'
import { hashArtifactContent } from './artifact.service'
import { getArtifact } from './artifact.service'
import type { GenericAssetReviewContent, GenericAssetQualitySnapshot } from '../../src/shared/generic-asset-workflow'
import type { AssetReviewResult } from '../../src/types'
import type { CreativeWorkflowInput, CreativeChangeScope } from '../../src/shared/creative-workflow'
import { PROSE_ONLY_CHANGE_SCOPE } from '../../src/shared/creative-workflow'

export class CreativeReviewTargetError extends Error {
  readonly code = 'CREATIVE_REVIEW_TARGET_INVALID'
}
function scopeIdentity(scope?: CreativeChangeScope, chapter = false): string {
  if (chapter) scope = { ...PROSE_ONLY_CHANGE_SCOPE, ...scope }
  if (!scope) return 'null'
  return hashArtifactContent(Object.fromEntries(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value])))
}
function isRepairDescendant(input: CreativeWorkflowInput, issueId: number, sourceId: string): boolean {
  const candidate = input.sourceArtifactId && getArtifact(input.sourceArtifactId)
  if (!candidate || candidate.novelId !== input.novelId || candidate.kind !== 'generic_draft') return false
  // A paused repair can be revised before saving. Only an issue-bound workflow may
  // extend its lineage; an unrelated draft with the same parent is insufficient.
  let taskId = candidate.taskId
  let bound = false
  for (let depth = 0; taskId && depth < 8; depth++) {
    const task = getSqlite().prepare('SELECT parent_task_id,input_json,related_entity_type FROM tasks WHERE id=? AND novel_id=?').get(taskId, input.novelId) as { parent_task_id: number | null; input_json: string; related_entity_type: string } | undefined
    if (!task) break
    if (task.related_entity_type === 'creative_workflow') {
      const request = (JSON.parse(task.input_json || '{}') as { request?: CreativeWorkflowInput }).request
      bound = Boolean(request && request.stage === input.stage && request.atChapter === input.atChapter && request.revisionIssueIds?.includes(issueId) && scopeIdentity(request.changeScope, input.stage === 'chapter') === scopeIdentity(input.changeScope, input.stage === 'chapter'))
      break
    }
    taskId = task.parent_task_id
  }
  if (!bound) return false
  let parentId = candidate.parentArtifactId
  const seen = new Set<string>()
  for (let depth = 0; parentId && depth < 100 && !seen.has(parentId); depth++) {
    if (parentId === sourceId) return true
    seen.add(parentId)
    const parent = getArtifact(parentId)
    if (!parent || parent.novelId !== input.novelId || parent.kind !== 'generic_draft') return false
    parentId = parent.parentArtifactId
  }
  return false
}
export function validateCreativeRevisionTargets(input: CreativeWorkflowInput): void {
  const ids = input.revisionIssueIds
  if (!ids) return
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new CreativeReviewTargetError('修订问题 ID 必须为不重复的正整数，最多50项。')
  for (const id of ids) {
    const row = getSqlite().prepare('SELECT novel_id,origin_meta_json FROM revision_tasks WHERE id=?').get(id) as { novel_id: number; origin_meta_json: string } | undefined
    if (!row || row.novel_id !== input.novelId) throw new CreativeReviewTargetError(`修订问题 ${id} 不属于当前项目。`)
    const meta = JSON.parse(row.origin_meta_json || '{}')
    if (meta.issueCategory !== 'creative_review' || meta.stage !== input.stage || meta.atChapter !== input.atChapter) throw new CreativeReviewTargetError(`修订问题 ${id} 的阶段或章位与本次任务不同。`)
    if (scopeIdentity(meta.changeScope, input.stage === 'chapter') !== scopeIdentity(input.changeScope, input.stage === 'chapter')) throw new CreativeReviewTargetError(`修订问题 ${id} 的保存范围与本次任务不同。`)
    const sourceId = meta.repairArtifactId || meta.candidateArtifactId
    if (input.operation === 'review') {
      if (input.sourceArtifactId) throw new CreativeReviewTargetError('正式复核不能将候选作为待评内容。')
      if (sourceId && getArtifact(sourceId)?.status !== 'committed') throw new CreativeReviewTargetError(`修订问题 ${id} 的候选尚未保存，不能用正式资料将其关闭。`)
    } else if (sourceId !== input.sourceArtifactId && !(sourceId && isRepairDescendant(input, id, sourceId))) throw new CreativeReviewTargetError(`修订问题 ${id} 必须沿用最新候选依据。`)
  }
}
export function creativeRevisionIssueSources(input: CreativeWorkflowInput) {
  if (!input.revisionIssueIds?.length) return []
  validateCreativeRevisionTargets(input)
  return input.revisionIssueIds.map(id => {
    const row = getSqlite().prepare('SELECT title,description,fix_brief AS fixBrief FROM revision_tasks WHERE novel_id=? AND id=?').get(input.novelId, id) as { title: string; description: string | null; fixBrief: string | null } | undefined
    if (!row) throw new CreativeReviewTargetError(`修订问题 ${id} 已不存在。`)
    return { id, ...row, usage: '评审意见用于定位待修订问题，不是新事实；不能将评审所举错误、推断或未来计划写成正史。' }
  })
}

export function advanceCreativeRevisionIssues(input: CreativeWorkflowInput, artifactId: string, cleanFormalReview = false, appliedScope?: CreativeChangeScope): void {
  validateCreativeRevisionTargets(input)
  const db = getSqlite(), now = new Date().toISOString()
  for (const id of input.revisionIssueIds || []) {
    const row = db.prepare('SELECT status,origin_meta_json FROM revision_tasks WHERE id=?').get(id) as { status: string; origin_meta_json: string }
    if (row.status === 'ignored') continue
    const meta = { ...JSON.parse(row.origin_meta_json), ...(cleanFormalReview ? { recheckArtifactId: artifactId } : { repairArtifactId: artifactId, ...(appliedScope ? { changeScope: appliedScope } : {}) }) }
    db.prepare('UPDATE revision_tasks SET status=?,resolved_at=?,origin_meta_json=?,updated_at=? WHERE id=?').run(cleanFormalReview ? 'resolved' : 'in_progress', cleanFormalReview ? now : null, JSON.stringify(meta), now, id)
  }
}

/** Model findings keep their own lifecycle; consistency scans cannot resolve them. */
export function recordCreativeReviewIssues(input: CreativeWorkflowInput, runId: number, artifactId: string, review: AssetReviewResult, blockers: string[] = [], candidateId?: string): number[] {
  const db = getSqlite(), now = new Date().toISOString()
  const chapter = input.stage === 'chapter' ? listChapters(input.novelId).find(row => row.chapterNum === input.atChapter)
    : input.stage === 'outline' && input.changeScope?.chapterIds?.length === 1 ? listChapters(input.novelId).find(row => row.id === input.changeScope!.chapterIds![0]) : undefined
  const findings = [...(review.issues || []).map(issue => ({ title: issue.message, severity: issue.level === 'blocker' ? 'high' : issue.level === 'advice' ? 'low' : 'medium', evidence: issue.evidence, ruleId: issue.ruleId })),
    ...blockers.map(title => ({ title, severity: 'high', evidence: [], ruleId: 'deterministic_gate' }))]
  if (!findings.length && (review.rejectRequired || review.rewriteRequired)) findings.push({ title: review.summary, severity: review.severity, evidence: [], ruleId: 'model_summary' })
  const ids: number[] = []
  db.transaction(() => {
    for (const finding of findings) {
      const key = `creative_review:${artifactId}:${hashArtifactContent(finding).slice(0, 20)}`
      const previous = db.prepare('SELECT id FROM revision_tasks WHERE novel_id=? AND issue_key=?').get(input.novelId, key) as { id: number } | undefined
      if (previous) { ids.push(previous.id); continue }
      const meta = { issueCategory: 'creative_review', autoFixable: false, stage: input.stage, atChapter: input.atChapter, runId, reviewArtifactId: artifactId, candidateArtifactId: candidateId, evidence: finding.evidence, ruleId: finding.ruleId, changeScope: input.changeScope, count: input.count }
      const result = db.prepare(`INSERT INTO revision_tasks(novel_id,task_source,issue_key,task_type,status,severity,title,description,fix_brief,chapter_id,origin_meta_json,last_detected_at,created_at,updated_at)
        VALUES(?,'system',?,?,'open',?,?,?,?,?,?,?,?,?)`).run(input.novelId, key, input.stage, finding.severity, finding.title, finding.evidence.map(e => e.quote).join('\n') || review.summary, review.topFixes.join('\n'), chapter?.id ?? null, JSON.stringify(meta), now, now, now)
      ids.push(Number(result.lastInsertRowid))
    }
  }).immediate()
  return ids
}

/** Request failures belong to task history; they are not findings about the novel. */
export function recordCreativeQualityIssues(input: CreativeWorkflowInput, runId: number, artifactId: string, quality: GenericAssetQualitySnapshot, blockers: string[] = [], candidateId?: string): number[] {
  if (quality.failureStage === 'review') return []
  const requestFailed = quality.failureStage === 'rewrite' || quality.failureStage === 'recheck'
  const review = requestFailed ? quality.review : quality.rewrittenReview || quality.review
  if (!quality.failureStage) {
    const db = getSqlite(), now = new Date().toISOString()
    const rows = db.prepare("SELECT id,origin_meta_json FROM revision_tasks WHERE novel_id=? AND status IN ('open','in_progress') AND json_valid(origin_meta_json) AND json_extract(origin_meta_json,'$.issueCategory')='creative_review' AND json_extract(origin_meta_json,'$.runId')=?").all(input.novelId, runId) as Array<{ id: number; origin_meta_json: string }>
    for (const row of rows) {
      const meta = JSON.parse(row.origin_meta_json)
      if (meta.reviewArtifactId === artifactId) continue
      const old = getArtifact<GenericAssetReviewContent>(meta.reviewArtifactId)
      if (old?.novelId !== input.novelId || old.kind !== 'quality_report' || old.content.schemaVersion !== 'generic-asset-review-v1' || old.content.modelReview.failureStage !== 'review') continue
      db.prepare('UPDATE revision_tasks SET status=?,resolved_at=?,origin_meta_json=?,updated_at=? WHERE id=?').run('resolved', now, JSON.stringify({ ...meta, recoveredByReviewArtifactId: artifactId }), now, row.id)
    }
  }
  return recordCreativeReviewIssues(input, runId, artifactId, review, requestFailed ? quality.contractValidation?.finalIssues || [] : blockers, candidateId)
}

/** Existing persisted final reports are recoverable without replaying old model calls. */
export function syncCreativeReviewIssues(novelId: number): void {
  const rows = getSqlite().prepare("SELECT id,input_json,progress_json FROM tasks WHERE novel_id=? AND related_entity_type='creative_workflow'").all(novelId) as Array<{ id: number; input_json: string; progress_json: string }>
  for (const row of rows) {
    const stored = JSON.parse(row.input_json || '{}') as { request?: CreativeWorkflowInput }
    const state = JSON.parse(row.progress_json || '{}') as { artifactId?: string; reviewArtifactId?: string }
    if (!stored.request || !state.reviewArtifactId) continue
    const artifact = getArtifact<GenericAssetReviewContent | { review: AssetReviewResult; deterministicBlockers: string[] }>(state.reviewArtifactId)
    if (!artifact || artifact.novelId !== novelId) continue
    if ('schemaVersion' in artifact.content && artifact.content.schemaVersion === 'generic-asset-review-v1') {
      const content = artifact.content
      recordCreativeQualityIssues(stored.request, row.id, artifact.id, content.modelReview, content.hardBlockers, state.artifactId)
    } else if ('review' in artifact.content && artifact.content.review) {
      recordCreativeReviewIssues(stored.request, row.id, artifact.id, artifact.content.review, artifact.content.deterministicBlockers || [])
    }
  }
}
