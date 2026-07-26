import type { SemanticGateDimension } from './semantic-gate'

/**
 * Per-novel semantic gate policy, persisted inside novels.settingsJson under
 * the `qualityGates` key. Rollout modes:
 *
 * - off:     semantic gate never runs; keyword heuristics keep their original
 *            blocking behavior (pre-upgrade behavior).
 * - shadow:  semantic gate runs and its reviews are persisted for divergence
 *            analysis, but blocking decisions still come from the heuristics.
 * - enforce: semantic verdicts drive blocking; heuristics degrade to hints.
 */
export type SemanticGateMode = 'off' | 'shadow' | 'enforce'
export type SemanticGateFallbackMode = 'heuristic' | 'warn-pass'

export interface SemanticGatePolicy {
  mode: SemanticGateMode
  /** Behavior when the LLM review fails (parse error / all evidence rejected / network). */
  fallbackMode: SemanticGateFallbackMode
  goldenChapterNums: number[]
  /** Upper bound of extra semantic LLM calls per chapter (repair re-reviews + golden finals). */
  maxSemanticCallsPerChapter: number
}

export const DEFAULT_SEMANTIC_GATE_POLICY: SemanticGatePolicy = {
  mode: 'shadow',
  fallbackMode: 'heuristic',
  goldenChapterNums: [2, 3],
  maxSemanticCallsPerChapter: 2,
}

/** Baseline dimensions reviewed on every chapter when the gate is active. */
export const CORE_SEMANTIC_GATE_DIMENSIONS: SemanticGateDimension[] = [
  'contract_delivery',
  'structural_beat',
  'cost_and_choice',
  'supporting_agency',
  'dialogue_voice',
]

function toMode(value: unknown): SemanticGateMode | null {
  return value === 'off' || value === 'shadow' || value === 'enforce' ? value : null
}

function toFallbackMode(value: unknown): SemanticGateFallbackMode | null {
  return value === 'heuristic' || value === 'warn-pass' ? value : null
}

function toChapterNums(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const nums = value
    .filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0)
    .slice(0, 12)
  return nums.length > 0 ? [...new Set(nums)].sort((left, right) => left - right) : null
}

/**
 * Parse a novels.settingsJson string into an effective policy. Unknown or
 * malformed fields fall back to defaults — a corrupted settings blob must
 * never disable generation.
 */
export function resolveSemanticGatePolicy(settingsJson: string | null | undefined): SemanticGatePolicy {
  if (!settingsJson?.trim()) return DEFAULT_SEMANTIC_GATE_POLICY
  try {
    const parsed = JSON.parse(settingsJson) as { qualityGates?: unknown }
    const gates = parsed && typeof parsed === 'object' && parsed.qualityGates && typeof parsed.qualityGates === 'object'
      ? parsed.qualityGates as Record<string, unknown>
      : {}
    const maxCalls = typeof gates.maxSemanticCallsPerChapter === 'number' && Number.isSafeInteger(gates.maxSemanticCallsPerChapter)
      ? Math.max(0, Math.min(gates.maxSemanticCallsPerChapter, 6))
      : null
    return {
      mode: toMode(gates.semanticGate) ?? DEFAULT_SEMANTIC_GATE_POLICY.mode,
      fallbackMode: toFallbackMode(gates.fallbackMode) ?? DEFAULT_SEMANTIC_GATE_POLICY.fallbackMode,
      goldenChapterNums: toChapterNums(gates.goldenChapterNums) ?? DEFAULT_SEMANTIC_GATE_POLICY.goldenChapterNums,
      maxSemanticCallsPerChapter: maxCalls ?? DEFAULT_SEMANTIC_GATE_POLICY.maxSemanticCallsPerChapter,
    }
  } catch {
    return DEFAULT_SEMANTIC_GATE_POLICY
  }
}
