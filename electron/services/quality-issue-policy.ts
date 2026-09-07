import {
  createQualityIssue,
  dedupeQualityIssues,
  normalizeQualityIssue,
  qualityIssueHasActionableLevel,
  qualityIssueHasBlockerLevel,
  type QualityIssueCategory,
  type QualityIssueDetector,
  type QualityIssueLevel,
  type QualityIssueScope,
  type QualityIssueV1,
} from '../../src/shared/quality-issue'

export interface QualityFindingLike {
  content?: string
  ruleId?: string
  ruleCode?: string
  code?: string
  title?: string
  message?: string
  detail?: string
  excerpt?: string
  severity?: string
  source?: string
  detector?: QualityIssueDetector
  level?: QualityIssueLevel
  category?: QualityIssueCategory
  scope?: QualityIssueScope | string
  confidence?: number | null
  diagnostics?: string[]
}

export interface QualityIssueReviewNotesLike {
  issues?: QualityIssueV1[]
  critical_fixes: string[]
  severity: 'low' | 'medium' | 'high'
  rewrite_required: boolean
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRuleId(raw: QualityFindingLike): string {
  const candidate = asText(raw.ruleId || raw.code || raw.ruleCode)
  if (candidate.startsWith('style_forbidden_pattern')) return 'style_forbidden_pattern'
  return candidate || 'unknown_quality_rule'
}

function isDeterministicRule(ruleId: string): boolean {
  return new Set([
    'object_category_mismatch',
    'unknown_character_fact',
    'knowledge_boundary_violation',
    'hallucination_fact',
    'id_pollution',
    'prompt_leak',
    'ai_process_leak',
    'format_noise',
    'contract_validation',
    'chapter_contract',
    'scene_contract',
    'chapter_goal_contract',
    'golden_three_state_delivery',
    'required_atom_missing',
    'unknown_person_knowledge',
    'typed_ref_unresolved',
    'source_grounding_missing',
    'operating_mode_contract',
    'step_memory_contract',
    'chapter_goal',
    'story_thread_progress',
    'theme_chapter_response',
    'character_scene_payoff',
    'relationship_arc_gate',
    'chapter_hook',
    'foreshadow_delivery',
    'scene_result_state',
    'scene_conflict',
    'chapter_title_alignment',
    'golden_three_opening',
    'golden_three_state_delivery',
  ]).has(ruleId)
}

function resolveDetector(raw: QualityFindingLike, ruleId: string): QualityIssueDetector {
  if (raw.detector) return raw.detector
  if (raw.source === 'model' || raw.source === 'semantic-gate') return 'model'
  return isDeterministicRule(ruleId) ? 'deterministic' : 'heuristic'
}

function resolveRequestedLevel(raw: QualityFindingLike, ruleId: string): QualityIssueLevel | undefined {
  if (raw.level) return raw.level
  if (ruleId === 'zero_cost_resolution' || ruleId === 'missing_payoff' || ruleId === 'forced_reversal' || ruleId === 'continuity_break') {
    return 'repair'
  }
  if (isDeterministicRule(ruleId)) return 'blocker'
  return undefined
}

function findingMessage(raw: QualityFindingLike, ruleId: string): string {
  return asText(raw.message || raw.detail || raw.title) || `检测到质量规则 ${ruleId}。`
}

export function buildQualityIssueFromFinding(
  content: string,
  finding: QualityFindingLike,
  defaultSource: string,
): QualityIssueV1 | null {
  const ruleId = normalizeRuleId(finding)
  const source = asText(finding.source) || defaultSource
  const scope = finding.scope === 'span' || finding.scope === 'scene' || finding.scope === 'chapter'
    ? finding.scope
    : undefined
  return createQualityIssue({
    ruleId,
    message: findingMessage(finding, ruleId),
    detector: resolveDetector(finding, ruleId),
    confidence: finding.confidence,
    scope,
    content: finding.content || content,
    excerpt: finding.excerpt,
    level: resolveRequestedLevel(finding, ruleId),
    category: finding.category,
    source,
    diagnostics: finding.diagnostics,
  })
}

export function buildQualityIssuesFromFindings(
  content: string,
  findings: QualityFindingLike[],
  source: string,
): QualityIssueV1[] {
  return dedupeQualityIssues(findings
    .map((finding) => buildQualityIssueFromFinding(content, finding, source))
    .filter((issue): issue is QualityIssueV1 => Boolean(issue)))
}

export function buildQualityIssuesFromAntiAiHits(
  content: string,
  hits: QualityFindingLike[],
  source = 'enforcer',
): QualityIssueV1[] {
  return buildQualityIssuesFromFindings(content, hits.map((hit) => ({
    ...hit,
    ruleId: hit.ruleId || hit.code,
    source: hit.source || source,
    message: hit.message || hit.detail || hit.title,
  })), source)
}

export function buildQualityIssuesFromDialogueReview(
  content: string,
  review: {
    risks?: string[]
    drifts?: Array<{ characterName?: string; driftRate?: number; reason?: string }>
    similarities?: Array<{ characterAName?: string; characterBName?: string; similarity?: number; reason?: string }>
    fillerRisks?: string[]
    infoDensityRisks?: string[]
  },
  source = 'enforcer',
): QualityIssueV1[] {
  const findings: QualityFindingLike[] = [
    ...(review.similarities || []).map((item) => ({
      ruleId: 'dialogue_similarity',
      message: `${item.characterAName || '角色 A'} 与 ${item.characterBName || '角色 B'} 对白相似度 ${item.similarity ?? '未知'}：${item.reason || '句长、停顿和重复短语过于接近。'}`,
      source,
    })),
    ...(review.drifts || []).map((item) => ({
      ruleId: 'dialogue_drift',
      message: `${item.characterName || '角色'}对白漂移 ${item.driftRate ?? '未知'}：${item.reason || '本章语气和既有说话习惯差异偏大。'}`,
      source,
    })),
    ...(review.risks || []).map((message) => ({ ruleId: 'dialogue_homogenization', message, source })),
    ...(review.fillerRisks || []).map((message) => ({ ruleId: 'dialogue_filler', message, source })),
    ...(review.infoDensityRisks || []).map((message) => ({ ruleId: 'dialogue_info_density', message, source })),
  ]
  return buildQualityIssuesFromFindings(content, findings, source)
}

export function buildQualityIssuesFromSemanticVerdicts(
  content: string,
  verdicts: Array<{ dimension?: string; status?: string; summary?: string; suggestion?: string; evidence?: Array<{ excerpt?: string }> }>,
  source = 'semantic-gate',
): QualityIssueV1[] {
  return buildQualityIssuesFromFindings(content, verdicts
    .filter((verdict) => verdict.status === 'blocker' || verdict.status === 'uncertain')
    .map((verdict) => {
      const reportedExcerpt = verdict.evidence?.find((item) => item.excerpt)?.excerpt
      const excerpt = reportedExcerpt && content.includes(reportedExcerpt) ? reportedExcerpt : undefined
      return {
      ruleId: 'semantic_gate_blocker',
      message: `${verdict.dimension || '语义门'}：${verdict.summary || '模型判定存在语义风险。'}${verdict.suggestion ? ` 修复方向：${verdict.suggestion}` : ''}`,
      excerpt,
      source,
      detector: 'model',
      level: 'repair',
      ...(reportedExcerpt && !excerpt
        ? { diagnostics: ['semantic evidence does not exist in current artifact'] }
        : {}),
    }
    }), source)
}

export function mergeQualityIssues(...groups: Array<QualityIssueV1[] | undefined>): QualityIssueV1[] {
  return dedupeQualityIssues(groups.flatMap((group) => group || []))
}

function issueLegacyText(issue: QualityIssueV1): string {
  const evidence = issue.evidence[0]
  const evidenceText = evidence ? `【证据】${evidence.quote}` : '【缺少正文回指证据】'
  return `【质量问题/${issue.level}/${issue.ruleId}】${issue.message}（${evidenceText}；来源：${(issue.sources || []).join('、') || '未记录'}）`
}

export function qualityIssuesToLegacyCriticalFixes(issues: QualityIssueV1[]): string[] {
  return issues.filter(qualityIssueHasActionableLevel).map(issueLegacyText)
}

export function applyQualityIssuesToReviewNotes<T extends QualityIssueReviewNotesLike>(
  notes: T,
  incoming: QualityIssueV1[],
): T {
  const issues = mergeQualityIssues(notes.issues, incoming)
  const actionable = issues.filter(qualityIssueHasActionableLevel)
  const hasBlocker = actionable.some(qualityIssueHasBlockerLevel)
  const currentCriticalFixes = Array.isArray(notes.critical_fixes) ? notes.critical_fixes : []
  const currentSeverity = notes.severity || 'low'
  return {
    ...notes,
    issues,
    critical_fixes: [...new Set([
      ...currentCriticalFixes,
      ...qualityIssuesToLegacyCriticalFixes(incoming),
    ])],
    severity: hasBlocker
      ? 'high'
      : actionable.length > 0 && currentSeverity === 'low'
        ? 'medium'
        : currentSeverity,
    rewrite_required: Boolean(notes.rewrite_required) || actionable.length > 0,
  }
}

export function normalizeStoredQualityIssues(raw: unknown): QualityIssueV1[] {
  if (!Array.isArray(raw)) return []
  return dedupeQualityIssues(raw
    .map((item) => normalizeQualityIssue(item))
    .filter((issue): issue is QualityIssueV1 => Boolean(issue)))
}

export function readQualityIssuesFromReviewNotesJson(raw: string | null | undefined): QualityIssueV1[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return normalizeStoredQualityIssues((parsed as Record<string, unknown>).issues)
  } catch {
    return []
  }
}

export function classifyQualityIssueLevels(issues: QualityIssueV1[]): {
  blocker: QualityIssueV1[]
  repair: QualityIssueV1[]
  advice: QualityIssueV1[]
} {
  return {
    blocker: issues.filter((issue) => issue.level === 'blocker'),
    repair: issues.filter((issue) => issue.level === 'repair'),
    advice: issues.filter((issue) => issue.level === 'advice'),
  }
}
