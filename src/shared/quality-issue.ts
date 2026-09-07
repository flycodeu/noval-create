export type QualityIssueCategory = 'fact' | 'format' | 'narrative' | 'style'

export type QualityIssueLevel = 'blocker' | 'repair' | 'advice'

export type QualityIssueDetector = 'deterministic' | 'model' | 'heuristic'

export type QualityIssueScope = 'span' | 'scene' | 'chapter'

export interface QualityIssueEvidence {
  artifactHash: string
  start: number
  end: number
  quote: string
}

/**
 * C-07 的统一质量问题；`sources`/`diagnostics` 是兼容性扩展，供多个检查器
 * 合并后保留来源和降级原因，不改变 C-07 的核心字段。
 */
export interface QualityIssueV1 {
  id: string
  ruleId: string
  category: QualityIssueCategory
  level: QualityIssueLevel
  detector: QualityIssueDetector
  confidence: number | null
  evidence: QualityIssueEvidence[]
  scope: QualityIssueScope
  message: string
  sources?: string[]
  diagnostics?: string[]
}

export interface QualityIssueRuleSpec {
  category: QualityIssueCategory
  defaultLevel: QualityIssueLevel
  requiresEvidence?: boolean
}

export const QUALITY_ISSUE_RULE_SPECS: Readonly<Record<string, QualityIssueRuleSpec>> = {
  // Deterministic fact/format/contract gates. These entries are intentionally
  // explicit: an unknown rule must never enter this blocker channel.
  object_category_mismatch: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  unknown_character_fact: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  knowledge_boundary_violation: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  hallucination_fact: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  id_pollution: { category: 'format', defaultLevel: 'blocker', requiresEvidence: true },
  prompt_leak: { category: 'format', defaultLevel: 'blocker', requiresEvidence: true },
  ai_process_leak: { category: 'format', defaultLevel: 'blocker', requiresEvidence: true },
  format_noise: { category: 'format', defaultLevel: 'blocker', requiresEvidence: true },
  contract_validation: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  chapter_contract: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  scene_contract: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  chapter_goal_contract: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  required_atom_missing: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  unknown_person_knowledge: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  typed_ref_unresolved: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  source_grounding_missing: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  operating_mode_contract: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  step_memory_contract: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  chapter_goal: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  story_thread_progress: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  theme_chapter_response: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  character_scene_payoff: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  relationship_arc_gate: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  chapter_hook: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  foreshadow_delivery: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  scene_result_state: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  scene_conflict: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  chapter_title_alignment: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  golden_three_opening: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },
  golden_three_state_delivery: { category: 'fact', defaultLevel: 'blocker', requiresEvidence: true },

  // Concrete, evidence-backed narrative defects are repairable rather than
  // factual blockers.
  zero_cost_resolution: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },
  missing_payoff: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },
  forced_reversal: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },
  continuity_break: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },
  motivation_irrational: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },
  semantic_gate_blocker: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },
  opening_hook_defect: { category: 'narrative', defaultLevel: 'repair', requiresEvidence: true },

  // Dialogue/fingerprint statistics are suggestions until a concrete span is
  // supplied. This keeps one-off similarity counts author-overridable.
  genre_register_drift: { category: 'style', defaultLevel: 'advice' },
  exposition_density: { category: 'style', defaultLevel: 'advice' },
  long_window_homogenization: { category: 'style', defaultLevel: 'advice' },
  dialogue_similarity: { category: 'style', defaultLevel: 'advice' },
  dialogue_drift: { category: 'style', defaultLevel: 'advice' },
  dialogue_homogenization: { category: 'style', defaultLevel: 'advice' },
  dialogue_filler: { category: 'style', defaultLevel: 'advice' },
  dialogue_info_density: { category: 'style', defaultLevel: 'advice' },

  // Automatic anti-AI/style rules stay soft. A user-pinned hard contract is
  // represented by a separate contract issue, not by changing this table.
  ai_slogan: { category: 'style', defaultLevel: 'advice' },
  ai_opener: { category: 'style', defaultLevel: 'advice' },
  ai_action_cliche: { category: 'style', defaultLevel: 'advice' },
  ai_emotional_cliche: { category: 'style', defaultLevel: 'advice' },
  ai_description_cliche: { category: 'style', defaultLevel: 'advice' },
  ai_dialogue_filler: { category: 'style', defaultLevel: 'advice' },
  relation_labelization: { category: 'style', defaultLevel: 'advice' },
  abstract_emotion_packaging: { category: 'style', defaultLevel: 'advice' },
  world_rules_hollowing: { category: 'style', defaultLevel: 'advice' },
  ai_symmetry: { category: 'style', defaultLevel: 'advice' },
  ai_pseudo_philosophy: { category: 'style', defaultLevel: 'advice' },
  template_emotion: { category: 'style', defaultLevel: 'advice' },
  ai_transition_cliche: { category: 'style', defaultLevel: 'advice' },
  ai_ending_summary: { category: 'style', defaultLevel: 'advice' },
  ai_repetitive_structure: { category: 'style', defaultLevel: 'advice' },
  genre_hollowing: { category: 'style', defaultLevel: 'advice' },
  high_frequency_repetition: { category: 'style', defaultLevel: 'advice' },
  dash_abuse: { category: 'style', defaultLevel: 'advice' },
  parenthetical_explanation_abuse: { category: 'style', defaultLevel: 'advice' },
  not_but_definition_pattern: { category: 'style', defaultLevel: 'advice' },
  double_metaphor_or_simile_stack: { category: 'style', defaultLevel: 'advice' },
  paragraph_simile_stacking: { category: 'style', defaultLevel: 'advice' },
  ending_lonely_imagery: { category: 'style', defaultLevel: 'advice' },
  parallelism_overuse: { category: 'style', defaultLevel: 'advice' },
  low_value_body_detail: { category: 'style', defaultLevel: 'advice' },
  eye_open_close_standalone_paragraph: { category: 'style', defaultLevel: 'advice' },
  soft_voice_cliche: { category: 'style', defaultLevel: 'advice' },
  atmospheric_imagery_overuse: { category: 'style', defaultLevel: 'advice' },
  uniform_paragraph_rhythm: { category: 'style', defaultLevel: 'advice' },
  abstract_token_density_high: { category: 'style', defaultLevel: 'advice' },
  sentence_pattern_repeat_high: { category: 'style', defaultLevel: 'advice' },
  ending_summary_rate_high: { category: 'style', defaultLevel: 'advice' },
  ornament_overload_rate_high: { category: 'style', defaultLevel: 'advice' },
  non_human_collocation_high: { category: 'style', defaultLevel: 'advice' },
  dash_density_high: { category: 'style', defaultLevel: 'advice' },
  parenthetical_explanation_density_high: { category: 'style', defaultLevel: 'advice' },
  metaphor_stack_rate_high: { category: 'style', defaultLevel: 'advice' },
  parallelism_rate_high: { category: 'style', defaultLevel: 'advice' },
  body_detail_cliche_rate_high: { category: 'style', defaultLevel: 'advice' },
  isolated_template_paragraph_rate_high: { category: 'style', defaultLevel: 'advice' },
  system_settlement_wall: { category: 'style', defaultLevel: 'advice' },
  appearance_ad: { category: 'style', defaultLevel: 'advice' },
  style_forbidden_pattern: { category: 'style', defaultLevel: 'advice' },
  template_connector: { category: 'style', defaultLevel: 'advice' },
  explanatory_narration: { category: 'style', defaultLevel: 'advice' },
  ornament_overload: { category: 'style', defaultLevel: 'advice' },
  sensory_anchor_missing: { category: 'style', defaultLevel: 'advice' },
  weak_stance: { category: 'style', defaultLevel: 'advice' },
  transition_density: { category: 'style', defaultLevel: 'advice' },
  emotion_monotony: { category: 'style', defaultLevel: 'advice' },
  world_exposition_dump: { category: 'style', defaultLevel: 'advice' },
  reading_experience: { category: 'style', defaultLevel: 'advice' },
  uniform_sentence_rhythm: { category: 'style', defaultLevel: 'advice' },
  clean_paragraph_beat: { category: 'style', defaultLevel: 'advice' },
  dialogue_too_efficient: { category: 'style', defaultLevel: 'advice' },
  no_verbal_impurity: { category: 'style', defaultLevel: 'advice' },
}

const LEVEL_RANK: Record<QualityIssueLevel, number> = { advice: 1, repair: 2, blocker: 3 }

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfidence(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null
}

function isCategory(value: unknown): value is QualityIssueCategory {
  return value === 'fact' || value === 'format' || value === 'narrative' || value === 'style'
}

function isLevel(value: unknown): value is QualityIssueLevel {
  return value === 'blocker' || value === 'repair' || value === 'advice'
}

function isDetector(value: unknown): value is QualityIssueDetector {
  return value === 'deterministic' || value === 'model' || value === 'heuristic'
}

function isScope(value: unknown): value is QualityIssueScope {
  return value === 'span' || value === 'scene' || value === 'chapter'
}

export function getQualityIssueRuleSpec(ruleId: string): QualityIssueRuleSpec | null {
  return QUALITY_ISSUE_RULE_SPECS[ruleId] || null
}

export function qualityIssueArtifactHash(content: string): string {
  // FNV-1a is deliberately synchronous and platform-neutral so IDs are the
  // same in Electron and renderer tests without importing Node crypto.
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildQualityIssueId(
  artifactHash: string,
  ruleId: string,
  start?: number,
  end?: number,
): string {
  const range = Number.isInteger(start) && Number.isInteger(end)
    ? `${start}:${end}`
    : 'none'
  return `quality:${artifactHash || 'unknown'}:${ruleId}:${range}`
}

function normalizeEvidence(value: unknown): QualityIssueEvidence[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.reduce<QualityIssueEvidence[]>((result, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return result
    const record = item as Record<string, unknown>
    const artifactHash = asText(record.artifactHash)
    const quote = typeof record.quote === 'string' ? record.quote : ''
    const start = typeof record.start === 'number' ? Math.trunc(record.start) : Number(record.start)
    const end = typeof record.end === 'number' ? Math.trunc(record.end) : Number(record.end)
    if (!artifactHash || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || !quote) return result
    const key = `${artifactHash}:${start}:${end}:${quote}`
    if (seen.has(key)) return result
    seen.add(key)
    result.push({ artifactHash, start, end, quote })
    return result
  }, [])
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
}

function resolveLevel(
  spec: QualityIssueRuleSpec | null,
  requested: unknown,
  evidence: QualityIssueEvidence[],
  detector: QualityIssueDetector,
): QualityIssueLevel {
  if (!spec) return 'advice'
  const requestedLevel = isLevel(requested) ? requested : spec.defaultLevel
  // A style rule cannot become blocker simply because an upstream detector
  // called it critical. Concrete narrative repair requires a quote; without
  // that quote it is only a diagnosis/advice.
  if (spec.category === 'style') return 'advice'
  if (spec.requiresEvidence && evidence.length === 0) {
    // Deterministic contract/fact validators retain their original blocker
    // even when the validator has no quote (the missing quote is diagnosed).
    // Model/heuristic judgement without a quote is never promoted here.
    if (detector === 'deterministic' && spec.defaultLevel === 'blocker' && requestedLevel === 'blocker') {
      return 'blocker'
    }
    return 'advice'
  }
  if (spec.defaultLevel === 'blocker') {
    return requestedLevel === 'blocker' ? 'blocker' : requestedLevel === 'repair' ? 'repair' : 'advice'
  }
  if (spec.defaultLevel === 'repair') {
    return requestedLevel === 'blocker' ? 'repair' : requestedLevel === 'repair' ? 'repair' : 'advice'
  }
  return 'advice'
}

export function normalizeQualityIssue(raw: unknown): QualityIssueV1 | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const ruleId = asText(record.ruleId)
  const message = asText(record.message)
  if (!ruleId || !message) return null
  const spec = getQualityIssueRuleSpec(ruleId)
  const evidence = normalizeEvidence(record.evidence)
  const artifactHash = evidence[0]?.artifactHash || 'unknown'
  const detector = isDetector(record.detector) ? record.detector : 'heuristic'
  const level = resolveLevel(spec, record.level, evidence, detector)
  const category = spec?.category || (isCategory(record.category) ? record.category : 'style')
  const scope = isScope(record.scope) ? record.scope : evidence.length > 0 ? 'span' : 'chapter'
  const firstEvidence = evidence[0]
  const id = asText(record.id) || buildQualityIssueId(artifactHash, ruleId, firstEvidence?.start, firstEvidence?.end)
  const diagnostics = normalizeStringList(record.diagnostics)
  if (!spec) diagnostics.push('unknown ruleId: defaulted to advice')
  if (spec?.requiresEvidence && evidence.length === 0) {
    diagnostics.push(level === 'advice'
      ? 'missing exact正文 evidence: downgraded to advice'
      : 'missing exact正文 evidence: deterministic blocker retained')
  }
  return {
    id,
    ruleId,
    category,
    level,
    detector,
    confidence: normalizeConfidence(record.confidence),
    evidence,
    scope,
    message,
    ...(normalizeStringList(record.sources).length > 0 ? { sources: normalizeStringList(record.sources) } : {}),
    ...(diagnostics.length > 0 ? { diagnostics: [...new Set(diagnostics)] } : {}),
  }
}

export function findQualityIssueEvidence(
  content: string,
  excerpt: string,
  artifactHash = qualityIssueArtifactHash(content),
): QualityIssueEvidence[] {
  const quote = excerpt.trim()
  if (!quote) return []
  const start = content.indexOf(quote)
  if (start < 0) return []
  return [{ artifactHash, start, end: start + quote.length, quote }]
}

export function createQualityIssue(input: {
  ruleId: string
  message: string
  detector: QualityIssueDetector
  confidence?: number | null
  scope?: QualityIssueScope
  content?: string
  artifactHash?: string
  excerpt?: string
  evidence?: QualityIssueEvidence[]
  level?: QualityIssueLevel
  category?: QualityIssueCategory
  source?: string
  diagnostics?: string[]
}): QualityIssueV1 | null {
  const content = input.content || ''
  const artifactHash = input.artifactHash || qualityIssueArtifactHash(content)
  const evidence = input.evidence && input.evidence.length > 0
    ? input.evidence
    : findQualityIssueEvidence(content, input.excerpt || '', artifactHash)
  return normalizeQualityIssue({
    id: buildQualityIssueId(artifactHash, input.ruleId, evidence[0]?.start, evidence[0]?.end),
    ruleId: input.ruleId,
    category: input.category,
    level: input.level,
    detector: input.detector,
    confidence: input.confidence ?? null,
    evidence,
    scope: input.scope || (evidence.length > 0 ? 'span' : 'chapter'),
    message: input.message,
    sources: input.source ? [input.source] : [],
    diagnostics: input.diagnostics || [],
  })
}

export function dedupeQualityIssues(issues: QualityIssueV1[]): QualityIssueV1[] {
  const byId = new Map<string, QualityIssueV1>()
  issues.forEach((raw) => {
    const issue = normalizeQualityIssue(raw)
    if (!issue) return
    const existing = byId.get(issue.id)
    if (!existing) {
      byId.set(issue.id, issue)
      return
    }
    const evidence = [...existing.evidence, ...issue.evidence]
    const evidenceKeys = new Set<string>()
    const mergedEvidence = evidence.filter((entry) => {
      const key = `${entry.artifactHash}:${entry.start}:${entry.end}:${entry.quote}`
      if (evidenceKeys.has(key)) return false
      evidenceKeys.add(key)
      return true
    })
    const sources = [...new Set([...(existing.sources || []), ...(issue.sources || [])])]
    const diagnostics = [...new Set([...(existing.diagnostics || []), ...(issue.diagnostics || [])])]
    const stronger = LEVEL_RANK[issue.level] > LEVEL_RANK[existing.level] ? issue : existing
    byId.set(issue.id, {
      ...stronger,
      evidence: mergedEvidence,
      confidence: existing.confidence == null
        ? issue.confidence
        : issue.confidence == null
          ? existing.confidence
          : Math.max(existing.confidence, issue.confidence),
      ...(sources.length > 0 ? { sources } : {}),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    })
  })
  return [...byId.values()]
}

export function qualityIssueHasActionableLevel(issue: QualityIssueV1): boolean {
  return issue.level === 'blocker' || issue.level === 'repair'
}

export function qualityIssueHasBlockerLevel(issue: QualityIssueV1): boolean {
  return issue.level === 'blocker'
}
