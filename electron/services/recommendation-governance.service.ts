import { createHash } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import {
  RECOMMENDATION_POLICY,
  RECOMMENDATION_PREFLIGHT_PROFILE,
  resolveRecommendationGateStatus,
  resolveRecommendationWorkState,
  type LockRecommendationCandidateInput,
  type RecommendationAttemptState,
  type RecommendationCandidate,
  type RecommendationEvaluationAttempt,
  type RecommendationPolicySnapshot,
  type RecommendationPreflightEvidence,
  type RecommendationPreflightResult,
  type RecommendationWorkspaceSnapshot,
  type RecordRecommendationEvaluationInput,
  type RecordRecommendationEvaluationResult,
  type RunRecommendationPreflightInput,
} from '../../src/shared/recommendation-governance'
import {
  RecommendationGovernanceError,
  type RecommendationAuditContext,
} from '../application/recommendation-governance-error'
import { assessRecommendationPreflight } from '../application/recommendation-preflight'
import { getDb, getSqlite } from '../database/db'
import { chapters, novels } from '../database/schema'
import { getQualityDashboardData } from './quality-dashboard.service'

export { RecommendationGovernanceError }
export type { RecommendationAuditContext }

interface RecommendationChapterSnapshot {
  id: number
  chapterNum: number
  title: string
  outline: string
  content: string
  wordCount: number
  status: string
  contextVersion: number
  qualityScoresJson: string
  aiScoreJson: string
}

interface RecommendationSourceSnapshot {
  novel: {
    id: number
    title: string
    synopsis: string
    status: string
    targetWords: number
    totalWords: number
    contextVersion: number
    projectBriefJson: string
    settingsJson: string
    themeVoiceJson: string
    worldRulesJson: string
    projectCanonProfileJson: string
    canonConstraintSetJson: string
  }
  chapters: RecommendationChapterSnapshot[]
  contentHash: string
}

interface PreflightRow {
  id: number
  novel_id: number
  profile_version: string
  status: 'ready' | 'blocked'
  score: number
  confidence_lower_bound: number
  coverage_rate: number
  blockers_json: string
  warnings_json: string
  evidence_json: string
  context_version: number
  content_hash: string
  counted_external_attempt: number
  created_at: string | null
}

interface CandidateRow {
  id: number
  novel_id: number
  preflight_run_id: number
  status: 'locked'
  context_version: number
  content_hash: string
  snapshot_json: string
  actor_type: string
  actor_id: string
  client_id: string
  approval_id: string
  locked_at: string
  created_at: string | null
}

interface AttemptRow {
  id: number
  novel_id: number
  candidate_id: number
  source: 'author_requested' | 'platform_auto'
  outcome: 'passed' | 'failed'
  work_state_at_evaluation: 'serializing' | 'completed'
  failure_reason: string | null
  evidence_completeness: 'complete' | 'partial'
  evidence_json: string
  policy_id: string
  policy_snapshot_json: string
  actor_type: string
  actor_id: string
  client_id: string
  approval_id: string
  confirmed_by: string
  idempotency_key: string
  occurred_at: string
  created_at: string | null
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function stableTimestamp(value: string | null | undefined): string {
  return value || new Date(0).toISOString()
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function buildContentHash(snapshot: Omit<RecommendationSourceSnapshot, 'contentHash'>): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(snapshot.novel))
  snapshot.chapters.forEach((chapter) => {
    hash.update('\u001e')
    hash.update(JSON.stringify(chapter))
  })
  return `sha256:${hash.digest('hex')}`
}

function loadSourceSnapshot(novelId: number): RecommendationSourceSnapshot {
  const db = getDb()
  const novel = db.select({
    id: novels.id,
    title: novels.title,
    synopsis: novels.synopsis,
    status: novels.status,
    targetWords: novels.targetWords,
    totalWords: novels.totalWords,
    contextVersion: novels.contextVersion,
    projectBriefJson: novels.projectBriefJson,
    settingsJson: novels.settingsJson,
    themeVoiceJson: novels.themeVoiceJson,
    worldRulesJson: novels.worldRulesJson,
    projectCanonProfileJson: novels.projectCanonProfileJson,
    canonConstraintSetJson: novels.canonConstraintSetJson,
  }).from(novels).where(eq(novels.id, novelId)).get()
  if (!novel) {
    throw new RecommendationGovernanceError('PROJECT_NOT_FOUND', `项目 ${novelId} 不存在。`)
  }

  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    title: chapters.title,
    outline: chapters.outline,
    content: chapters.content,
    wordCount: chapters.wordCount,
    status: chapters.status,
    contextVersion: chapters.contextVersion,
    qualityScoresJson: chapters.qualityScoresJson,
    aiScoreJson: chapters.aiScoreJson,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()

  const base = {
    novel: {
      id: novel.id,
      title: novel.title,
      synopsis: novel.synopsis || '',
      status: novel.status || 'draft',
      targetWords: novel.targetWords || 0,
      totalWords: novel.totalWords || 0,
      contextVersion: novel.contextVersion || 1,
      projectBriefJson: novel.projectBriefJson || '',
      settingsJson: novel.settingsJson || '',
      themeVoiceJson: novel.themeVoiceJson || '',
      worldRulesJson: novel.worldRulesJson || '',
      projectCanonProfileJson: novel.projectCanonProfileJson || '',
      canonConstraintSetJson: novel.canonConstraintSetJson || '',
    },
    chapters: chapterRows.map((chapter) => ({
      id: chapter.id,
      chapterNum: chapter.chapterNum,
      title: chapter.title || '',
      outline: chapter.outline || '',
      content: chapter.content || '',
      wordCount: chapter.wordCount || 0,
      status: chapter.status || 'outline',
      contextVersion: chapter.contextVersion || 1,
      qualityScoresJson: chapter.qualityScoresJson || '',
      aiScoreJson: chapter.aiScoreJson || '',
    })),
  }
  return { ...base, contentHash: buildContentHash(base) }
}

function mapPreflight(row: PreflightRow): RecommendationPreflightResult {
  return {
    runId: row.id,
    novelId: row.novel_id,
    profileVersion: row.profile_version,
    status: row.status,
    score: row.score,
    confidenceLowerBound: row.confidence_lower_bound,
    coverageRate: row.coverage_rate,
    blockers: safeParseJson<string[]>(row.blockers_json, []),
    warnings: safeParseJson<string[]>(row.warnings_json, []),
    evidence: safeParseJson<RecommendationPreflightEvidence[]>(row.evidence_json, []),
    contextVersion: row.context_version,
    contentHash: row.content_hash,
    countedExternalAttempt: false,
    createdAt: stableTimestamp(row.created_at),
  }
}

function mapCandidate(row: CandidateRow): RecommendationCandidate {
  return {
    id: row.id,
    novelId: row.novel_id,
    preflightRunId: row.preflight_run_id,
    status: 'locked',
    contextVersion: row.context_version,
    contentHash: row.content_hash,
    snapshot: safeParseJson<Record<string, unknown>>(row.snapshot_json, {}),
    actorType: row.actor_type,
    actorId: row.actor_id,
    clientId: row.client_id,
    approvalId: row.approval_id,
    lockedAt: row.locked_at,
    createdAt: stableTimestamp(row.created_at),
  }
}

function normalizePolicy(raw: string): RecommendationPolicySnapshot {
  const parsed = safeParseJson<Partial<RecommendationPolicySnapshot>>(raw, {})
  return parsed.policyId === RECOMMENDATION_POLICY.policyId
    ? { ...RECOMMENDATION_POLICY, ...parsed } as RecommendationPolicySnapshot
    : RECOMMENDATION_POLICY
}

function mapAttempt(row: AttemptRow): RecommendationEvaluationAttempt {
  return {
    id: row.id,
    novelId: row.novel_id,
    candidateId: row.candidate_id,
    source: row.source,
    outcome: row.outcome,
    workStateAtEvaluation: row.work_state_at_evaluation === 'completed' ? 'completed' : 'serializing',
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    evidenceCompleteness: row.evidence_completeness,
    evidence: safeParseJson<Record<string, unknown>>(row.evidence_json, {}),
    policy: normalizePolicy(row.policy_snapshot_json),
    actorType: row.actor_type,
    actorId: row.actor_id,
    clientId: row.client_id,
    approvalId: row.approval_id,
    confirmedBy: row.confirmed_by,
    occurredAt: row.occurred_at,
    createdAt: stableTimestamp(row.created_at),
  }
}

export function getRecommendationAttemptState(novelId: number): RecommendationAttemptState {
  const sqlite = getSqlite()
  const novel = sqlite.prepare('SELECT id, status FROM novels WHERE id = ?').get(novelId) as { id: number; status: string | null } | undefined
  if (!novel) throw new RecommendationGovernanceError('PROJECT_NOT_FOUND', `项目 ${novelId} 不存在。`)
  const rows = sqlite.prepare(`
    SELECT * FROM external_evaluation_attempts
    WHERE novel_id = ?
    ORDER BY occurred_at ASC, id ASC
  `).all(novelId) as AttemptRow[]
  const attempts = rows.map(mapAttempt)
  const failedEvaluationCount = attempts.filter((attempt) => attempt.outcome === 'failed').length
  const completedFailureCount = attempts.filter((attempt) => (
    attempt.outcome === 'failed' && attempt.workStateAtEvaluation === 'completed'
  )).length
  const passedEvaluationCount = attempts.filter((attempt) => attempt.outcome === 'passed').length
  const workState = resolveRecommendationWorkState(novel.status)
  const gate = resolveRecommendationGateStatus({
    workState,
    totalEvaluationCount: attempts.length,
    failedEvaluationCount,
    passedEvaluationCount,
    completedFailureCount,
    policy: RECOMMENDATION_POLICY,
  })
  return {
    novelId,
    novelStatus: novel.status || 'draft',
    workState,
    policy: RECOMMENDATION_POLICY,
    totalEvaluationCount: attempts.length,
    failedEvaluationCount,
    passedEvaluationCount,
    ...gate,
    canRunInternalPreflight: true,
    attempts,
  }
}

export function getRecommendationWorkspaceSnapshot(novelId: number): RecommendationWorkspaceSnapshot {
  const sqlite = getSqlite()
  const state = getRecommendationAttemptState(novelId)
  const preflight = sqlite.prepare(`
    SELECT * FROM recommendation_preflight_runs
    WHERE novel_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(novelId) as PreflightRow | undefined
  const candidate = sqlite.prepare(`
    SELECT * FROM recommendation_candidates
    WHERE novel_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(novelId) as CandidateRow | undefined
  return {
    state,
    latestPreflight: preflight ? mapPreflight(preflight) : null,
    latestCandidate: candidate ? mapCandidate(candidate) : null,
  }
}

export function runRecommendationPreflight(input: RunRecommendationPreflightInput): RecommendationPreflightResult {
  const snapshot = loadSourceSnapshot(input.novelId)
  const dashboard = getQualityDashboardData(input.novelId, { includeDialogueInsights: false })
  const assessment = assessRecommendationPreflight(snapshot, dashboard)
  const profileVersion = input.profileVersion?.trim() || RECOMMENDATION_PREFLIGHT_PROFILE
  const sqlite = getSqlite()
  const info = sqlite.prepare(`
    INSERT INTO recommendation_preflight_runs (
      novel_id, profile_version, status, score, confidence_lower_bound,
      coverage_rate, blockers_json, warnings_json, evidence_json,
      context_version, content_hash, counted_external_attempt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    input.novelId,
    profileVersion,
    assessment.status,
    assessment.score,
    assessment.confidenceLowerBound,
    assessment.coverageRate,
    JSON.stringify(assessment.blockers),
    JSON.stringify(assessment.warnings),
    JSON.stringify(assessment.evidence),
    snapshot.novel.contextVersion,
    snapshot.contentHash,
  )
  const row = sqlite.prepare('SELECT * FROM recommendation_preflight_runs WHERE id = ?').get(Number(info.lastInsertRowid)) as PreflightRow
  return mapPreflight(row)
}

function requireApproval(context: RecommendationAuditContext): void {
  if (!context.approvalId?.trim()) {
    throw new RecommendationGovernanceError('APPROVAL_REQUIRED', '该操作需要经过可信传输层验证的明确批准。')
  }
}

export function lockRecommendationCandidate(
  input: LockRecommendationCandidateInput,
  context: RecommendationAuditContext,
): RecommendationCandidate {
  requireApproval(context)
  const sqlite = getSqlite()
  const preflight = sqlite.prepare(`
    SELECT * FROM recommendation_preflight_runs WHERE id = ? AND novel_id = ?
  `).get(input.preflightRunId, input.novelId) as PreflightRow | undefined
  if (!preflight) throw new RecommendationGovernanceError('PREFLIGHT_NOT_FOUND', '找不到指定的推荐预检记录。')
  if (preflight.status !== 'ready') {
    throw new RecommendationGovernanceError('PREFLIGHT_BLOCKED', '预检尚未通过，不能锁定推荐候选稿。')
  }
  const state = getRecommendationAttemptState(input.novelId)
  if (!state.canRecordExternalEvaluation) {
    throw new RecommendationGovernanceError('RECOMMENDATION_LOCKED', state.lockReason || '推荐评估已锁定。')
  }
  if (preflight.context_version !== input.expectedContextVersion || preflight.content_hash !== input.expectedContentHash) {
    throw new RecommendationGovernanceError('PREFLIGHT_STALE', '调用方提供的候选版本与预检记录不一致。')
  }
  const current = loadSourceSnapshot(input.novelId)
  if (current.novel.contextVersion !== preflight.context_version || current.contentHash !== preflight.content_hash) {
    throw new RecommendationGovernanceError('PREFLIGHT_STALE', '项目内容在预检后已变化，请重新执行预检。')
  }

  const existing = sqlite.prepare(`
    SELECT * FROM recommendation_candidates WHERE preflight_run_id = ? ORDER BY id ASC LIMIT 1
  `).get(preflight.id) as CandidateRow | undefined
  if (existing) return mapCandidate(existing)

  const now = new Date().toISOString()
  const chapterManifest = current.chapters.map((chapter) => ({
    id: chapter.id,
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    wordCount: chapter.wordCount,
    status: chapter.status,
    contextVersion: chapter.contextVersion,
    contentHash: `sha256:${createHash('sha256').update(chapter.content).digest('hex')}`,
  }))
  const candidateSnapshot = {
    version: 'recommendation-candidate-manifest-v1',
    title: current.novel.title,
    novelStatus: current.novel.status,
    novelContextVersion: current.novel.contextVersion,
    targetWords: current.novel.targetWords,
    totalWords: current.novel.totalWords,
    chapterCount: current.chapters.length,
    contentHash: current.contentHash,
    chapterManifest,
    preflight: {
      runId: preflight.id,
      profileVersion: preflight.profile_version,
      score: preflight.score,
      confidenceLowerBound: preflight.confidence_lower_bound,
      coverageRate: preflight.coverage_rate,
      evidence: safeParseJson<RecommendationPreflightEvidence[]>(preflight.evidence_json, []),
    },
    policyAtLock: RECOMMENDATION_POLICY,
  }
  const info = sqlite.prepare(`
    INSERT INTO recommendation_candidates (
      novel_id, preflight_run_id, status, context_version, content_hash,
      snapshot_json, actor_type, actor_id, client_id, approval_id, locked_at
    ) VALUES (?, ?, 'locked', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.novelId,
    preflight.id,
    current.novel.contextVersion,
    current.contentHash,
    JSON.stringify(candidateSnapshot),
    context.actor.type,
    context.actor.actorId,
    context.actor.clientId,
    context.approvalId,
    now,
  )
  return mapCandidate(sqlite.prepare('SELECT * FROM recommendation_candidates WHERE id = ?').get(Number(info.lastInsertRowid)) as CandidateRow)
}

function assertRecordInput(input: RecordRecommendationEvaluationInput): void {
  if (input.outcome === 'failed' && !input.failureReason?.trim()) {
    throw new RecommendationGovernanceError('VALIDATION_FAILED', '失败评估必须记录失败原因。')
  }
  if (!input.confirmedBy.trim()) {
    throw new RecommendationGovernanceError('VALIDATION_FAILED', '必须记录确认外部结果的人员或系统标识。')
  }
  if (!input.idempotencyKey.trim()) {
    throw new RecommendationGovernanceError('VALIDATION_FAILED', '必须提供幂等键，防止重试被重复计次。')
  }
  if (input.occurredAt) {
    const occurred = Date.parse(input.occurredAt)
    if (!Number.isFinite(occurred) || occurred > Date.now() + (5 * 60 * 1000)) {
      throw new RecommendationGovernanceError('VALIDATION_FAILED', '评估发生时间必须是有效且不晚于当前时间的 ISO 时间。')
    }
  }
}

function mapSqlitePolicyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('RECOMMENDATION_ATTEMPTS_EXHAUSTED')) {
    throw new RecommendationGovernanceError('RECOMMENDATION_ATTEMPTS_EXHAUSTED', '外部推荐评估已达到最多三次。')
  }
  if (message.includes('RECOMMENDATION_ALREADY_PASSED')) {
    throw new RecommendationGovernanceError('RECOMMENDATION_ALREADY_PASSED', '作品已有通过记录，不能继续追加评估。')
  }
  if (message.includes('RECOMMENDATION_COMPLETED_WORK_LOCKED') || message.includes('RECOMMENDATION_SERIALIZING_WORK_LOCKED')) {
    throw new RecommendationGovernanceError('RECOMMENDATION_LOCKED', '作品已达到失败锁定阈值。')
  }
  if (message.includes('RECOMMENDATION_CANDIDATE_INVALID')) {
    throw new RecommendationGovernanceError('CANDIDATE_INVALID', '候选稿与项目不匹配或未处于锁定状态。')
  }
  throw error
}

export function recordRecommendationEvaluation(
  input: RecordRecommendationEvaluationInput,
  context: RecommendationAuditContext,
): RecordRecommendationEvaluationResult {
  requireApproval(context)
  assertRecordInput(input)
  const sqlite = getSqlite()
  try {
    return sqlite.transaction(() => {
      const replay = sqlite.prepare(`
        SELECT * FROM external_evaluation_attempts WHERE novel_id = ? AND idempotency_key = ?
      `).get(input.novelId, input.idempotencyKey) as AttemptRow | undefined
      if (replay) {
        const replayEvidence = safeParseJson<Record<string, unknown>>(replay.evidence_json, {})
        const requestedOccurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : null
        const samePayload = replay.candidate_id === input.candidateId
          && replay.source === input.source
          && replay.outcome === input.outcome
          && replay.confirmed_by === input.confirmedBy.trim()
          && (replay.failure_reason || '') === (input.failureReason?.trim() || '')
          && replay.evidence_completeness === (input.evidenceCompleteness || 'complete')
          && canonicalJson(replayEvidence) === canonicalJson(input.evidence || {})
          && (!requestedOccurredAt || replay.occurred_at === requestedOccurredAt)
        if (!samePayload) {
          throw new RecommendationGovernanceError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已经用于不同的评估结果。')
        }
        return {
          attempt: mapAttempt(replay),
          state: getRecommendationAttemptState(input.novelId),
          idempotentReplay: true,
        }
      }

      const candidate = sqlite.prepare(`
        SELECT * FROM recommendation_candidates WHERE id = ? AND novel_id = ?
      `).get(input.candidateId, input.novelId) as CandidateRow | undefined
      if (!candidate) throw new RecommendationGovernanceError('CANDIDATE_NOT_FOUND', '找不到指定的推荐候选稿。')
      const state = getRecommendationAttemptState(input.novelId)
      if (!state.canRecordExternalEvaluation) {
        const code = state.status === 'passed' ? 'RECOMMENDATION_ALREADY_PASSED'
          : state.status === 'attempts_exhausted' ? 'RECOMMENDATION_ATTEMPTS_EXHAUSTED'
            : 'RECOMMENDATION_LOCKED'
        throw new RecommendationGovernanceError(code, state.lockReason || '推荐评估已锁定。')
      }

      const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString()
      const info = sqlite.prepare(`
        INSERT INTO external_evaluation_attempts (
          novel_id, candidate_id, source, outcome, work_state_at_evaluation, failure_reason,
          evidence_completeness, evidence_json, policy_id, policy_snapshot_json,
          actor_type, actor_id, client_id, approval_id, confirmed_by,
          idempotency_key, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.novelId,
        input.candidateId,
        input.source,
        input.outcome,
        state.workState,
        input.failureReason?.trim() || null,
        input.evidenceCompleteness || 'complete',
        JSON.stringify(input.evidence || {}),
        RECOMMENDATION_POLICY.policyId,
        JSON.stringify(RECOMMENDATION_POLICY),
        context.actor.type,
        context.actor.actorId,
        context.actor.clientId,
        context.approvalId,
        input.confirmedBy.trim(),
        input.idempotencyKey.trim(),
        occurredAt,
      )
      const row = sqlite.prepare('SELECT * FROM external_evaluation_attempts WHERE id = ?').get(Number(info.lastInsertRowid)) as AttemptRow
      return {
        attempt: mapAttempt(row),
        state: getRecommendationAttemptState(input.novelId),
        idempotentReplay: false,
      }
    })()
  } catch (error) {
    if (error instanceof RecommendationGovernanceError) throw error
    return mapSqlitePolicyError(error)
  }
}
