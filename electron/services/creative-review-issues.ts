import { getSqlite } from '../database/db'
import { listChapters } from './chapter.service'
import { hashArtifactContent } from './artifact.service'
import { getArtifact } from './artifact.service'
import type { GenericAssetReviewContent } from '../../src/shared/generic-asset-workflow'
import type { AssetReviewResult } from '../../src/types'
import type { CreativeWorkflowInput, CreativeChangeScope } from '../../src/shared/creative-workflow'

export function validateCreativeRevisionTargets(input: CreativeWorkflowInput): void {
  const ids = input.revisionIssueIds
  if (!ids) return
  if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new Error('修订问题 ID 必须为不重复的正整数，最多50项。')
  for (const id of ids) {
    const row = getSqlite().prepare('SELECT novel_id,origin_meta_json FROM revision_tasks WHERE id=?').get(id) as { novel_id: number; origin_meta_json: string } | undefined
    if (!row || row.novel_id !== input.novelId) throw new Error(`修订问题 ${id} 不属于当前项目。`)
    const meta = JSON.parse(row.origin_meta_json || '{}')
    if (meta.issueCategory !== 'creative_review' || meta.stage !== input.stage || meta.atChapter !== input.atChapter) throw new Error(`修订问题 ${id} 的阶段或章位与本次任务不同。`)
  }
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
  const chapter = input.stage === 'chapter' ? listChapters(input.novelId).find(row => row.chapterNum === input.atChapter) : undefined
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
      recordCreativeReviewIssues(stored.request, row.id, artifact.id, content.modelReview.rewrittenReview || content.modelReview.review, content.hardBlockers, state.artifactId)
    } else if ('review' in artifact.content && artifact.content.review) {
      recordCreativeReviewIssues(stored.request, row.id, artifact.id, artifact.content.review, artifact.content.deterministicBlockers || [])
    }
  }
}
