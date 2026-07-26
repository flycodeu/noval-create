import type {
  ChapterBridgePlan,
  ChapterContractAudit,
  ExpressionDedupReport,
  HookContinuitySnapshot,
  StoryFactCharacterKnowledge,
  SummaryHealthReport,
  WritebackSyncStatus,
} from '../../../../types'
import { normalizeWritebackSyncStatus } from '../../../../shared/writeback-status'
import { safeParse } from './safe-parse'
import type {
  AiCheckPayload,
  ContinuityPayload,
  ReviewNotes,
  ScenePlanStep,
  WritingPipelineSnapshot,
} from './types'

export { safeParse, resetSafeParseWarnings } from './safe-parse'
export * from './types'

export const parseNumberArray = (raw?: string | null): number[] => safeParse(
  'parseNumberArray',
  raw,
  (parsed) => Array.isArray(parsed) ? parsed.map((v) => Number(v)).filter(Number.isFinite) : null,
  [],
)

export const parseStringArray = (raw?: string | null): string[] => safeParse(
  'parseStringArray',
  raw,
  (parsed) => Array.isArray(parsed)
    ? parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    : null,
  [],
)

export const parsePipelineSnapshot = (raw?: string | null): WritingPipelineSnapshot | null => safeParse(
  'parsePipelineSnapshot',
  raw,
  (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return record.kind === 'chapter_pipeline' ? record as unknown as WritingPipelineSnapshot : null
  },
  null,
)

export const parseCharacterKnowledgeJson = (raw?: string | null): StoryFactCharacterKnowledge[] => safeParse(
  'parseCharacterKnowledgeJson',
  raw,
  (parsed) => {
    if (!Array.isArray(parsed)) return null
    const normalized: StoryFactCharacterKnowledge[] = []
    parsed.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const record = entry as Record<string, unknown>
      const characterId = Number(record.characterId)
      if (!Number.isFinite(characterId) || characterId <= 0) return
      const knownChapterId = Number(record.knownChapterId)
      normalized.push({
        characterId,
        knownChapterId: Number.isFinite(knownChapterId) && knownChapterId > 0
          ? knownChapterId
          : null,
      })
    })
    return normalized
  },
  [],
)

export const parseContinuity = (raw?: string | null): ContinuityPayload | null => safeParse(
  'parseContinuity',
  raw,
  (parsed) => parsed as ContinuityPayload,
  null,
)

export const parseScenePlan = (raw?: string | null): ScenePlanStep[] => safeParse(
  'parseScenePlan',
  raw,
  (parsed) => Array.isArray(parsed) ? parsed as ScenePlanStep[] : null,
  [],
)

export const parseReviewNotes = (raw?: string | null): ReviewNotes | null => safeParse(
  'parseReviewNotes',
  raw,
  (parsed) => parsed as ReviewNotes,
  null,
)

export function normalizeContractAudit(value: unknown): ChapterContractAudit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<ChapterContractAudit>
  return {
    ...record,
    summary: typeof record.summary === 'string' ? record.summary : '',
    items: Array.isArray(record.items) ? record.items : [],
  } as ChapterContractAudit
}

export const parseContractAudit = (raw?: string | null): ChapterContractAudit | null => safeParse(
  'parseContractAudit',
  raw,
  normalizeContractAudit,
  null,
)

export const parseBridgePlan = (raw?: string | null): ChapterBridgePlan | null => safeParse(
  'parseBridgePlan',
  raw,
  (parsed) => parsed as ChapterBridgePlan,
  null,
)

export const parseSummaryHealth = (raw?: string | null): SummaryHealthReport | null => safeParse(
  'parseSummaryHealth',
  raw,
  (parsed) => parsed as SummaryHealthReport,
  null,
)

export const parseExpressionDedup = (raw?: string | null): ExpressionDedupReport | null => safeParse(
  'parseExpressionDedup',
  raw,
  (parsed) => parsed as ExpressionDedupReport,
  null,
)

export const parseHookContinuity = (raw?: string | null): HookContinuitySnapshot | null => safeParse(
  'parseHookContinuity',
  raw,
  (parsed) => parsed as HookContinuitySnapshot,
  null,
)

function validateAiCheck(parsed: unknown): AiCheckPayload | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const overallScore = Number(record.score ?? record.overall_score)
  const aiLikeRate = Number(record.ai_like_rate)
  const hasScore = Number.isFinite(overallScore)
  const hasFeedback = typeof record.overall_feedback === 'string' && record.overall_feedback.trim().length > 0
  if (!hasScore && !hasFeedback && !Number.isFinite(aiLikeRate)) return null

  const rawIssues = Array.isArray(record.issues)
    ? record.issues
    : Array.isArray(record.top_fixes)
      ? record.top_fixes.map((item) => ({ type: '重点修复', location: '', suggestion: String(item) }))
      : []
  const issues = rawIssues
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => ({
      type: typeof item.type === 'string' ? item.type : '重点修复',
      location: typeof item.location === 'string' ? item.location : '',
      suggestion: typeof item.suggestion === 'string' ? item.suggestion : String(item.detail || item.fix || ''),
      ...(item.severity === 'high' || item.severity === 'medium' || item.severity === 'low'
        ? { severity: item.severity as 'high' | 'medium' | 'low' }
        : {}),
    }))
    .filter((item) => item.suggestion.trim().length > 0)

  return {
    score: hasScore ? Math.max(0, Math.min(100, overallScore)) : Math.max(0, Math.min(100, 100 - aiLikeRate)),
    issues,
    overall_feedback: hasFeedback ? String(record.overall_feedback) : '已保存章节 AI 体检结果。',
    ...(Number.isFinite(aiLikeRate) ? { ai_like_rate: Math.max(0, Math.min(100, aiLikeRate)) } : {}),
    ...(record.repetition_risk === '低' || record.repetition_risk === '中' || record.repetition_risk === '高'
      ? { repetition_risk: record.repetition_risk }
      : {}),
  }
}

export const parseAiCheck = (raw?: unknown): AiCheckPayload | null => {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'string') return safeParse('parseAiCheck', raw, validateAiCheck, null)
  try {
    return validateAiCheck(raw)
  } catch {
    return null
  }
}

export const parseWritebackStatus = (raw?: string | null): WritebackSyncStatus | null => safeParse(
  'parseWritebackStatus',
  raw,
  (parsed) => normalizeWritebackSyncStatus(parsed),
  null,
)

export const getWorldRulesSummary = (raw?: string | null): string[] => safeParse(
  'getWorldRulesSummary',
  raw,
  (parsed) => {
    const rules = parsed as Record<string, unknown>
    const power = rules.power_system && typeof rules.power_system === 'object' ? (rules.power_system as Record<string, unknown>).name : ''
    return [
      typeof power === 'string' && power.trim() ? `力量体系：${power.trim()}` : '',
      typeof rules.social_structure === 'string' && rules.social_structure.trim() ? `社会结构：${rules.social_structure.trim()}` : '',
      Array.isArray(rules.forbidden_elements) && rules.forbidden_elements.length > 0 ? `禁用元素：${rules.forbidden_elements.slice(0, 3).join('、')}` : '',
    ].filter(Boolean)
  },
  [],
)
