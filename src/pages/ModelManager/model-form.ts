import type { ModelConfig } from '../../types'

const MASKED_KEY = '已设置'

export function parseModelExtraParams(raw?: string | null): { kimiThinking?: 'enabled' | 'disabled'; deepseekReasoningEffort?: 'none' | 'low' | 'high' | 'max' } {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      ...(record.kimiThinking === 'enabled' || record.kimiThinking === 'disabled' ? { kimiThinking: record.kimiThinking } : {}),
      ...(['none', 'low', 'high', 'max'].includes(String(record.deepseekReasoningEffort)) ? { deepseekReasoningEffort: record.deepseekReasoningEffort as 'none' | 'low' | 'high' | 'max' } : {}),
    }
  } catch {
    return {}
  }
}


export function hasModelFormChanges(config: ModelConfig, values: Record<string, unknown>): boolean {
  const fields = ['name', 'provider', 'modelId', 'baseUrl', 'temperature', 'maxTokens', 'maxConcurrency'] as const
  if (fields.some(field => values[field] !== config[field])) return true
  if ((values.maxContextTokens ?? undefined) !== (config.maxContextTokens ?? undefined)) return true
  const keyChanged = config.apiKey ? values.apiKey !== MASKED_KEY : Boolean(typeof values.apiKey === 'string' && values.apiKey.trim())
  if (keyChanged) return true
  const extra = parseModelExtraParams(config.extraParamsJson)
  if (values.provider === 'deepseek') return values.deepseekReasoningEffort !== (extra.deepseekReasoningEffort || 'low')
  if (values.provider === 'kimi') return values.kimiThinking !== (extra.kimiThinking || 'disabled')
  return false
}
