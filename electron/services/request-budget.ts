import type { Message } from '../adapters/base.adapter'
import { estimateTokens } from '../../src/shared/token-budget'

export const DEFAULT_TOKEN_SAFETY_MARGIN_PCT = 5

export type RequestBudgetStatus = 'allowed' | 'rejected' | 'unverified'

export type RequestBudgetReason =
  | 'within_budget'
  | 'model_window_unverified'
  | 'invalid_max_tokens'
  | 'invalid_stage_budget'
  | 'input_and_output_exceed_window'
  | 'input_and_output_exceed_stage_budget'

export interface RequestBudgetInput {
  messages: readonly Message[]
  systemPrompt?: string | null
  maxTokens: number
  modelContextTokens?: number | null
  tokenSafetyMarginPct?: number | null
  stageBudget?: number | null
}

export interface RequestBudgetReport {
  source: 'estimated'
  status: RequestBudgetStatus
  allowed: boolean
  reason: RequestBudgetReason
  estimatedInputTokens: number
  inputTokens: number
  outputReserveTokens: number
  outputTokens: number
  estimatedTotalTokens: number
  modelContextTokens: number | null
  safeModelContextTokens: number | null
  tokenSafetyMarginPct: number
  stageBudget: number | null
  effectiveBudget: number | null
  diagnostics?: Record<string, unknown>
}

export class RequestBudgetExceededError extends Error {
  code = 'NF_REQUEST_BUDGET_EXCEEDED'
  report: RequestBudgetReport

  constructor(report: RequestBudgetReport) {
    super(formatRequestBudgetFailure(report))
    this.name = 'RequestBudgetExceededError'
    this.report = report
  }
}

function normalizeLimit(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

function normalizeSafetyMargin(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOKEN_SAFETY_MARGIN_PCT
  return Math.max(0, Math.min(95, value))
}

/**
 * Render the same complete input package that is handed to an adapter. The
 * role markers are deliberately included so a message-only estimate cannot
 * accidentally hide routing/system-message overhead.
 */
export function serializeRequestInput(messages: readonly Message[], systemPrompt?: string | null): string {
  const system = typeof systemPrompt === 'string' ? systemPrompt : ''
  const transcript = messages.map((message) => {
    const role = typeof message?.role === 'string' ? message.role : ''
    const content = typeof message?.content === 'string' ? message.content : String(message?.content || '')
    return `${role}\n${content}`
  })
  return [system, ...transcript].filter((part) => part.length > 0).join('\n')
}

export function estimateRequestBudget(input: RequestBudgetInput): RequestBudgetReport {
  const maxTokens = normalizeLimit(input.maxTokens)
  const stageBudgetProvided = input.stageBudget !== undefined && input.stageBudget !== null
  const stageBudget = normalizeLimit(input.stageBudget)
  const modelContextTokens = normalizeLimit(input.modelContextTokens)
  const tokenSafetyMarginPct = normalizeSafetyMargin(input.tokenSafetyMarginPct)
  const safeModelContextTokens = modelContextTokens === null
    ? null
    : Math.max(0, Math.floor(modelContextTokens * (1 - tokenSafetyMarginPct / 100)))
  const effectiveBudget = safeModelContextTokens === null
    ? stageBudget
    : stageBudget === null
      ? safeModelContextTokens
      : Math.min(safeModelContextTokens, stageBudget)
  const estimatedInputTokens = estimateTokens(serializeRequestInput(input.messages || [], input.systemPrompt))
  const inputTokens = estimatedInputTokens
  const outputReserveTokens = maxTokens || 0
  const outputTokens = outputReserveTokens
  const estimatedTotalTokens = estimatedInputTokens + outputReserveTokens

  if (maxTokens === null) {
    return {
      source: 'estimated',
      status: 'rejected',
      allowed: false,
      reason: 'invalid_max_tokens',
      estimatedInputTokens,
      inputTokens,
      outputReserveTokens,
      outputTokens,
      estimatedTotalTokens,
      modelContextTokens,
      safeModelContextTokens,
      tokenSafetyMarginPct,
      stageBudget,
      effectiveBudget,
    }
  }

  if (stageBudgetProvided && stageBudget === null) {
    return {
      source: 'estimated',
      status: 'rejected',
      allowed: false,
      reason: 'invalid_stage_budget',
      estimatedInputTokens,
      inputTokens,
      outputReserveTokens,
      outputTokens,
      estimatedTotalTokens,
      modelContextTokens,
      safeModelContextTokens,
      tokenSafetyMarginPct,
      stageBudget,
      effectiveBudget,
    }
  }

  if (stageBudget !== null && estimatedTotalTokens > stageBudget) {
    return {
      source: 'estimated',
      status: 'rejected',
      allowed: false,
      reason: 'input_and_output_exceed_stage_budget',
      estimatedInputTokens,
      inputTokens,
      outputReserveTokens,
      outputTokens,
      estimatedTotalTokens,
      modelContextTokens,
      safeModelContextTokens,
      tokenSafetyMarginPct,
      stageBudget,
      effectiveBudget,
    }
  }

  if (safeModelContextTokens !== null && estimatedTotalTokens > safeModelContextTokens) {
    return {
      source: 'estimated',
      status: 'rejected',
      allowed: false,
      reason: 'input_and_output_exceed_window',
      estimatedInputTokens,
      inputTokens,
      outputReserveTokens,
      outputTokens,
      estimatedTotalTokens,
      modelContextTokens,
      safeModelContextTokens,
      tokenSafetyMarginPct,
      stageBudget,
      effectiveBudget,
    }
  }

  const unverifiedWindow = modelContextTokens === null
  return {
    source: 'estimated',
    status: unverifiedWindow ? 'unverified' : 'allowed',
    allowed: true,
    reason: unverifiedWindow ? 'model_window_unverified' : 'within_budget',
    estimatedInputTokens,
    inputTokens,
    outputReserveTokens,
    outputTokens,
    estimatedTotalTokens,
    modelContextTokens,
    safeModelContextTokens,
    tokenSafetyMarginPct,
    stageBudget,
    effectiveBudget,
  }
}

export function formatRequestBudgetFailure(report: RequestBudgetReport): string {
  const limit = report.effectiveBudget === null ? 'unknown' : String(report.effectiveBudget)
  return `NF_REQUEST_BUDGET_EXCEEDED: estimated input ${report.estimatedInputTokens} + output ${report.outputReserveTokens} = ${report.estimatedTotalTokens}, effective limit ${limit} (${report.reason})`
}
