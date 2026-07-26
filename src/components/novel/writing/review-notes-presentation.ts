/**
 * Three-tier information architecture for chapter review notes.
 *
 * Every field present on the notes object MUST surface in exactly one tier:
 * - critical: must be handled before finalizing the chapter
 * - advisory: recommended follow-ups
 * - reference: statistics / markers / anything unknown (field name preserved)
 *
 * Unknown fields are never silently dropped — they fall into `reference`
 * with their raw field name as the label, so new backend fields degrade
 * gracefully instead of disappearing.
 */

export type ReviewNoteSeverity = 'critical' | 'advisory' | 'reference'

export interface ReviewNotesViewItem {
  /** 原始字段名，保证未知字段可追溯。 */
  key: string
  label: string
  texts: string[]
  severity: ReviewNoteSeverity
}

export interface ReviewNotesViewModel {
  critical: ReviewNotesViewItem[]
  advisory: ReviewNotesViewItem[]
  reference: ReviewNotesViewItem[]
}

const CRITICAL_FIELDS = [
  'critical_fixes',
  'continuity_risks',
  'context_drift_risks',
  'coherence_risks',
  'realism_risks',
  'arc_progress_risks',
] as const

const ADVISORY_FIELDS = [
  'language_risks',
  'human_language_repairs',
  'reader_hook_risks',
  'genre_hollowing_risks',
  'dialogue_filler_risks',
  'dialogue_info_density_risks',
  'dialogue_drift_alerts',
  'cross_character_similarity',
] as const

const FIELD_LABELS: Record<string, string> = {
  summary: '审校摘要',
  critical_fixes: '关键修订',
  continuity_risks: '连续性风险',
  arc_progress_risks: '弧推进风险',
  context_drift_risks: '上下文漂移',
  realism_risks: '真实度风险',
  coherence_risks: '连贯性风险',
  reader_hook_risks: '追读风险',
  language_risks: '语言提示',
  human_language_repairs: '语言替换',
  genre_hollowing_risks: '体裁空心化',
  revision_brief: '修订摘要',
  protagonist_setback: '主角受挫',
  setback_summary: '受挫说明',
  cost_present: '代价出现',
  cost_summary: '代价说明',
  cost_resolution_state: '代价状态',
  reversal_marker: '反转标记',
  reversal_summary: '反转说明',
  reversal_support_state: '反转支撑',
  pace_marker: '节奏标签',
  reward_state: '阶段回报',
  protagonist_pressure: '主角压力',
  dialogue_homogenization_risks: '对白同质化',
  dialogue_fingerprint_summary: '对白辨识度',
  dialogue_voice_lock_summary: '声线锁定',
  dialogue_filler_risks: '对白灌水',
  dialogue_info_density_risks: '对白信息密度',
  required_voice_lock_character_ids: '需锁定声线角色',
  cross_character_similarity: '角色声线相似',
  dialogue_drift_alerts: '对白漂移告警',
  humanization_signals: '人味信号',
  contract_validation: '合同兑现',
}

function stringifyEntry(entry: unknown): string {
  if (entry === null || entry === undefined) return ''
  if (typeof entry === 'string') return entry.trim()
  if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry)
  try {
    return JSON.stringify(entry)
  } catch {
    return String(entry)
  }
}

function formatObjectEntry(key: string, entry: Record<string, unknown>): string {
  if (key === 'cross_character_similarity') {
    const a = stringifyEntry(entry.characterAName) || `#${stringifyEntry(entry.characterAId)}`
    const b = stringifyEntry(entry.characterBName) || `#${stringifyEntry(entry.characterBId)}`
    const similarity = typeof entry.similarity === 'number' ? `相似度 ${entry.similarity}` : ''
    const reason = stringifyEntry(entry.reason)
    return [`${a} × ${b}`, similarity, reason].filter(Boolean).join('，')
  }
  if (key === 'dialogue_drift_alerts') {
    const name = stringifyEntry(entry.characterName) || `#${stringifyEntry(entry.characterId)}`
    const drift = typeof entry.driftRate === 'number' ? `漂移率 ${entry.driftRate}` : ''
    const reason = stringifyEntry(entry.reason)
    return [name, drift, reason].filter(Boolean).join('，')
  }
  if (key === 'humanization_signals') {
    const severity = stringifyEntry(entry.severity)
    const title = stringifyEntry(entry.title)
    const detail = stringifyEntry(entry.detail)
    const avoid = stringifyEntry(entry.avoid)
    const prefer = stringifyEntry(entry.prefer)
    return [
      severity ? `[${severity}]` : '',
      title,
      detail,
      avoid ? `避免：${avoid}` : '',
      prefer ? `建议：${prefer}` : '',
    ].filter(Boolean).join(' · ')
  }
  return stringifyEntry(entry)
}

/** Convert any field value into display lines. Empty values yield []. */
export function reviewNoteValueToTexts(key: string, value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) {
    return value
      .map((entry) => (
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? formatObjectEntry(key, entry as Record<string, unknown>)
          : stringifyEntry(entry)
      ))
      .filter(Boolean)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (key === 'contract_validation') {
      const summary = stringifyEntry(record.summary)
      const rewriteHints = Array.isArray(record.rewriteHints)
        ? record.rewriteHints.map(stringifyEntry).filter(Boolean).map((hint) => `修补建议：${hint}`)
        : []
      const lines = [summary, ...rewriteHints].filter(Boolean)
      if (lines.length > 0) return lines
    }
    const serialized = stringifyEntry(record)
    return serialized && serialized !== '{}' ? [serialized] : []
  }
  return [stringifyEntry(value)].filter(Boolean)
}

function classifyField(key: string): ReviewNoteSeverity {
  if ((CRITICAL_FIELDS as readonly string[]).includes(key)) return 'critical'
  if ((ADVISORY_FIELDS as readonly string[]).includes(key)) return 'advisory'
  return 'reference'
}

export function buildReviewNotesViewModel(notes: Record<string, unknown> | null | undefined): ReviewNotesViewModel {
  const model: ReviewNotesViewModel = { critical: [], advisory: [], reference: [] }
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return model

  const orderedKeys = [
    ...CRITICAL_FIELDS.filter((key) => key in notes),
    ...ADVISORY_FIELDS.filter((key) => key in notes),
    ...Object.keys(notes).filter((key) => classifyField(key) === 'reference'),
  ]

  orderedKeys.forEach((key) => {
    const severity = classifyField(key)
    const texts = reviewNoteValueToTexts(key, notes[key])
    if (texts.length === 0) return
    model[severity].push({
      key,
      label: FIELD_LABELS[key] || key,
      texts,
      severity,
    })
  })

  return model
}
