export type AiExecutionMode = 'fast' | 'balanced' | 'premium' | 'review_first' | 'cost_saver'

export type AiTaskKind =
  | 'chapter_planning'
  | 'chapter_generation'
  | 'chapter_review'
  | 'chapter_rewrite'
  | 'chapter_finalize'
  | 'premise'
  | 'core_settings'
  | 'theme_voice'
  | 'world_rules'
  | 'outline_generation'
  | 'timeline_generation'
  | 'thread_generation'
  | 'revision_planning'
  | 'character_generation'
  | 'faction_generation'
  | 'item_generation'
  | 'map_generation'
  | 'workspace_repair'
  | 'generic_prompt'
  | 'paragraph_rewrite'

export const AI_EXECUTION_MODE_LABELS: Record<AiExecutionMode, string> = {
  fast: '极速',
  balanced: '均衡',
  premium: '精品',
  review_first: '审校优先',
  cost_saver: '成本优先',
}

export const AI_EXECUTION_MODE_OPTIONS = [
  { value: 'fast', label: AI_EXECUTION_MODE_LABELS.fast, hint: '更快返回，压缩预算与审校深度。' },
  { value: 'balanced', label: AI_EXECUTION_MODE_LABELS.balanced, hint: '默认模式，兼顾速度、质量和上下文覆盖。' },
  { value: 'premium', label: AI_EXECUTION_MODE_LABELS.premium, hint: '尽量拉满上下文与修订深度，适合关键正文。' },
  { value: 'review_first', label: AI_EXECUTION_MODE_LABELS.review_first, hint: '优先稳态与审校，适合重修和结构核查。' },
  { value: 'cost_saver', label: AI_EXECUTION_MODE_LABELS.cost_saver, hint: '限制输出预算与链路深度，适合低成本草拟。' },
] as const satisfies Array<{ value: AiExecutionMode; label: string; hint: string }>

export function normalizeAiExecutionMode(value: unknown): AiExecutionMode | undefined {
  return value === 'fast'
    || value === 'balanced'
    || value === 'premium'
    || value === 'review_first'
    || value === 'cost_saver'
    ? value
    : undefined
}

export function getAiExecutionModeLabel(mode: AiExecutionMode): string {
  return AI_EXECUTION_MODE_LABELS[mode]
}
