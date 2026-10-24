import { validateQualityIssuesForContent, normalizeQualityIssue, qualityIssueArtifactHash, type QualityIssueV1, type QualityIssueEvidence } from './quality-issue'

export interface ReviewRequirement { id: string; title: string; requirement: string }
export interface ContractCheck { contractItemId: string; status: 'met' | 'unmet' | 'uncertain'; reason: string; evidence: QualityIssueEvidence[] }
export interface ChapterReviewView {
  reportId: string; summary: string; status: string; stale: boolean; contractVersionUnknown: boolean
  reviewedContentHash?: string; currentContentHash?: string
  requirements: Array<ReviewRequirement & { check?: ContractCheck }>
  issues: QualityIssueV1[]; deterministicBlockers: string[]
}

export function normalizeContractChecks(raw: unknown, content: string): ContractCheck[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 100).flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    if (typeof row.contractItemId !== 'string' || typeof row.reason !== 'string') return []
    const evidence = Array.isArray(row.evidence) ? row.evidence.filter((item): item is QualityIssueEvidence => Boolean(item && typeof item === 'object'
      && Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start && item.end <= content.length
      && typeof item.quote === 'string' && item.quote.trim().length >= 4 && content.slice(item.start, item.end) === item.quote)).map(item => ({ start: item.start, end: item.end, quote: item.quote, artifactHash: qualityIssueArtifactHash(content) })) : []
    const allEvidenceValid = evidence.length === (Array.isArray(row.evidence) ? row.evidence.length : 0)
    const status = allEvidenceValid && row.status === 'unmet' ? 'unmet' : allEvidenceValid && row.status === 'met' && evidence.length > 0 ? 'met' : 'uncertain'
    return [{ contractItemId: row.contractItemId, status, reason: row.reason.slice(0, 2000), evidence }]
  })
}

export function reviewIssues(raw: unknown, content: string) {
  const issues = Array.isArray(raw) ? raw.map(normalizeQualityIssue).filter((item): item is QualityIssueV1 => Boolean(item)) : []
  return validateQualityIssuesForContent(issues, content)
}

export function collectReviewRequirements(contract: Record<string, unknown> | null, scenes: Array<Record<string, unknown>>): ReviewRequirement[] {
  const result: ReviewRequirement[] = []
  if (typeof contract?.chapterGoal === 'string' && contract.chapterGoal.trim()) result.push({ id: 'chapterGoal', title: '本章目标', requirement: contract.chapterGoal })
  for (const [key, title] of [['acceptanceNotes', '验收要求'], ['forbiddenActions', '禁止事项']] as const) {
    const values = contract?.[key]
    if (Array.isArray(values)) values.forEach((value, i) => { if (typeof value === 'string' && value.trim()) result.push({ id: `${key}.${i}`, title, requirement: value }) })
  }
  scenes.forEach((scene, i) => {
    for (const [key, title] of [['sceneGoal', '场景目标'], ['resultState', '场景落点'], ['pov', '叙事视角']] as const) {
      if (typeof scene[key] === 'string' && scene[key]) result.push({ id: `scene.${scene.id || i}.${key}`, title: `场景 ${i + 1} · ${title}`, requirement: String(scene[key]) })
    }
  })
  return result
}
