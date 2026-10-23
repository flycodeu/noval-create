import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { collectReviewRequirements, normalizeContractChecks, reviewIssues, type ChapterReviewView } from '../../src/shared/chapter-review-view'
import { getSqlite } from '../database/db'
import { getChapter } from './chapter.service'
import { getChapterContract, listSceneContracts } from './endgame-asset.service'
import { getNovel } from './novel.service'
import { hashArtifactContent, requireArtifact } from './artifact.service'

export function chapterReviewSnapshot(chapterId: number) {
  const chapter = getChapter(chapterId)
  if (!chapter) throw new Error(formatUserFacingMessage('services.zhuque.chapterMissing'))
  return { outline: chapter.outline || '', requirements: collectReviewRequirements(getChapterContract(chapterId), listSceneContracts(chapterId)) }
}

export function getChapterReviewView(novelId: number, chapterId: number, reportId?: string): ChapterReviewView | null {
  const chapter = getChapter(chapterId)
  if (!chapter || chapter.novelId !== novelId) throw new Error(formatUserFacingMessage('author.review.chapterWrongProject'))
  const latest = reportId || (getSqlite().prepare("SELECT id FROM artifacts WHERE novel_id=? AND kind='quality_report' AND json_valid(content_json) AND json_extract(content_json,'$.chapterId')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(novelId, chapterId) as { id: string } | undefined)?.id
  if (!latest) return null
  const artifact = requireArtifact<Record<string, unknown>>(latest)
  if (artifact.novelId !== novelId || artifact.kind !== 'quality_report' || artifact.content.chapterId !== chapterId) throw new Error(formatUserFacingMessage('author.review.reportWrongChapter'))
  const report = artifact.content
  const review = report.review && typeof report.review === 'object' ? report.review as Record<string, unknown> : {}
  const snapshot = chapterReviewSnapshot(chapterId)
  const frozen = report.contractSnapshot as ReturnType<typeof chapterReviewSnapshot> | undefined
  const stale = report.contentHash !== hashArtifactContent(chapter.content || '')
    || Boolean(frozen && report.contractHash !== hashArtifactContent(snapshot)) || artifact.contextVersion !== getNovel(novelId)?.contextVersion
  const checks = normalizeContractChecks(review.contractChecks, chapter.content || '')
  return { reportId: artifact.id, summary: String(report.summary || review.summary || ''), status: String(report.status || '待核对'), stale,
    contractVersionUnknown: !frozen, requirements: (frozen?.requirements || snapshot.requirements).map(requirement => ({ ...requirement, check: checks.find(item => item.contractItemId === requirement.id) })),
    issues: reviewIssues(review.issues, chapter.content || ''), deterministicBlockers: Array.isArray(report.deterministicBlockers) ? report.deterministicBlockers.map(String) : [] }
}
