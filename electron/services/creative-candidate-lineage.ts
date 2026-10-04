import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type { GenericAssetDraftContent, GenericAssetReviewContent } from '../../src/shared/generic-asset-workflow'
import { getSqlite } from '../database/db'
import { getArtifact, updateArtifactLifecycle } from './artifact.service'
import { getTaskRecord } from './task.service'

interface AcceptedCandidate { artifactId: string; runId: number }

/** A model PASS alone is insufficient: the workflow must have completed its hard checks. */
function acceptedCandidate(novelId: number, draft: AgentArtifact<GenericAssetDraftContent>): AcceptedCandidate | null {
  if (draft.novelId !== novelId || draft.kind !== 'generic_draft' || !['reviewed', 'approved', 'committed', 'superseded'].includes(draft.status) || !draft.reviewArtifactId || !draft.taskId) return null
  const review = getArtifact<GenericAssetReviewContent>(draft.reviewArtifactId)
  if (!review || review.novelId !== novelId || review.kind !== 'quality_report' || !['reviewed', 'approved'].includes(review.status)
    || review.content.schemaVersion !== 'generic-asset-review-v1' || review.content.status !== 'passed'
    || review.content.effectiveArtifactId !== draft.id || review.content.effectiveContentHash !== draft.contentHash) return null
  const generation = getTaskRecord(draft.taskId)
  const run = generation?.parentTaskId ? getTaskRecord(generation.parentTaskId) : null
  if (!run || run.novelId !== novelId || run.relatedEntityType !== 'creative_workflow' || !['running', 'paused', 'success', 'cancelled'].includes(run.status || '')) return null
  try {
    const state = JSON.parse(run.progressJson || '{}') as { artifactId?: string; reviewArtifactId?: string; reviewStatus?: string }
    return state.artifactId === draft.id && state.reviewArtifactId === review.id && state.reviewStatus === 'passed' ? { artifactId: draft.id, runId: run.id } : null
  } catch { return null }
}

/** Read-only protection for candidates saved by releases that did not retire revised ancestors. */
export function findAcceptedCreativeSuccessor(novelId: number, artifactId: string): AcceptedCandidate | null {
  const original = getArtifact<GenericAssetDraftContent>(artifactId)
  if (!original || original.novelId !== novelId || original.kind !== 'generic_draft' || original.status === 'committed') return null
  const rows = getSqlite().prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM artifacts WHERE novel_id = ? AND kind = 'generic_draft' AND parent_artifact_id = ?
      UNION
      SELECT child.id FROM artifacts child JOIN descendants parent ON child.parent_artifact_id = parent.id
      WHERE child.novel_id = ? AND child.kind = 'generic_draft'
    )
    SELECT draft.id FROM descendants JOIN artifacts draft ON draft.id = descendants.id
    ORDER BY draft.created_at DESC, draft.rowid DESC
  `).all(novelId, artifactId, novelId) as Array<{ id: string }>
  for (const row of rows) {
    const draft = getArtifact<GenericAssetDraftContent>(row.id)
    if (!draft || draft.content.assetType !== original.content.assetType) continue
    const accepted = acceptedCandidate(novelId, draft)
    if (accepted) return accepted
  }
  return null
}

/** Called only after the new candidate passed all hard checks, before waiting for Apply. */
export function supersedeCreativeDraftAncestors(novelId: number, artifactId: string): string[] {
  const draft = getArtifact<GenericAssetDraftContent>(artifactId)
  if (!draft || !acceptedCandidate(novelId, draft)) return []
  return getSqlite().transaction(() => {
    const superseded: string[] = []
    const seen = new Set([artifactId])
    let parentId = draft.parentArtifactId
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = getArtifact<GenericAssetDraftContent>(parentId)
      if (!parent || parent.novelId !== novelId || parent.kind !== 'generic_draft' || parent.content.assetType !== draft.content.assetType) break
      if (parent.status !== 'committed' && parent.status !== 'superseded') {
        updateArtifactLifecycle(parent.id, { status: 'superseded' })
        superseded.push(parent.id)
      }
      parentId = parent.parentArtifactId
    }
    return superseded
  }).immediate()
}
