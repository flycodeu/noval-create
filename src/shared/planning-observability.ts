import { collectQualityGuardrailFindings, formatQualityGuardrailSummary } from './content-guardrails'

function compact(value: string, max = 80): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectStrings(item))
  }

  return []
}

function buildPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key
}

function stringifyComparable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value && typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function diffObjects(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix = '',
  changes: string[] = [],
) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])

  for (const key of keys) {
    const path = buildPath(prefix, key)
    const left = previous[key]
    const right = next[key]

    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      diffObjects(left as Record<string, unknown>, right as Record<string, unknown>, path, changes)
      continue
    }

    const leftValue = stringifyComparable(left)
    const rightValue = stringifyComparable(right)
    if (leftValue === rightValue) continue

    changes.push(`${path}: ${compact(leftValue || '空')} -> ${compact(rightValue || '空')}`)
  }

  return changes
}

export function summarizeDraftMessages(messages: Array<{ role: string; content: string }>, max = 520): string {
  const userMessages = messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .map((message) => message.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const summary = userMessages[userMessages.length - 1] || userMessages[0] || ''
  if (!summary) return ''
  return summary.length > max ? `${summary.slice(0, max)}...` : summary
}

export function buildPlanningLintWarnings(payloads: unknown[], genre?: string): string[] {
  const text = collectStrings(payloads).join('\n')
  if (!text.trim()) return []
  return formatQualityGuardrailSummary(collectQualityGuardrailFindings(text, genre))
}

export function buildPlanningDiffSummary(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  limit = 12,
): string[] {
  return diffObjects(previous, next).slice(0, limit)
}
