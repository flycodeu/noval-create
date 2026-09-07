import { createHash } from 'node:crypto'
import { estimateTokens } from './context-token-budget'

/**
 * A hard context segment that must be injected as a whole.  The first
 * implementation intentionally keeps this shape small: upstream selection
 * still decides which segments are candidates, while this module only owns
 * deterministic, all-or-nothing budget allocation.
 */
export interface RequiredContextAtom {
  id: string
  sourceKey: string
  label: string
  text: string
  required: true
  priority: number
  tokenEstimate: number
}

export interface RequiredContextAtomInput {
  sourceKey: string
  label: string
  text: string
  priority?: number
  tokenEstimate?: number
}

export interface RequiredContextAtomAllocation {
  included: RequiredContextAtom[]
  dropped: RequiredContextAtom[]
  budget: number
  requiredTokens: number
  usedTokens: number
  deficitTokens: number
  missingAtomIds: string[]
}

function normalizeBudget(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function normalizeTokenEstimate(value: number | undefined, text: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.ceil(value))
  return estimateTokens(text)
}

function buildLegacyAtomId(label: string, sourceKey: string, text: string): string {
  const hash = createHash('sha256')
    .update(`${sourceKey}\u0000${text}`, 'utf8')
    .digest('hex')
  return `legacy:${label}:${hash}`
}

export function createRequiredContextAtom(input: RequiredContextAtomInput): RequiredContextAtom {
  const text = typeof input.text === 'string' ? input.text : ''
  const sourceKey = typeof input.sourceKey === 'string' && input.sourceKey.trim()
    ? input.sourceKey
    : `context:${input.label}`
  const label = typeof input.label === 'string' && input.label.trim() ? input.label : sourceKey

  return {
    id: buildLegacyAtomId(label, sourceKey, text),
    sourceKey,
    label,
    text,
    required: true,
    priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
    tokenEstimate: normalizeTokenEstimate(input.tokenEstimate, text),
  }
}

/**
 * Allocate required atoms in caller-provided priority order.  An atom is
 * either included with its complete original text or reported in dropped;
 * there is deliberately no partial/truncated branch.
 */
export function allocateRequiredContextAtoms(
  atoms: RequiredContextAtom[],
  budget: number,
): RequiredContextAtomAllocation {
  const safeBudget = normalizeBudget(budget)
  const requiredAtoms = atoms.filter((atom) => atom.required)
  const requiredTokens = requiredAtoms.reduce((sum, atom) => sum + atom.tokenEstimate, 0)
  const included: RequiredContextAtom[] = []
  const dropped: RequiredContextAtom[] = []
  let remaining = safeBudget

  for (const atom of requiredAtoms) {
    if (atom.tokenEstimate <= remaining) {
      included.push(atom)
      remaining -= atom.tokenEstimate
    } else {
      dropped.push(atom)
    }
  }

  return {
    included,
    dropped,
    budget: safeBudget,
    requiredTokens,
    usedTokens: included.reduce((sum, atom) => sum + atom.tokenEstimate, 0),
    deficitTokens: Math.max(0, requiredTokens - safeBudget),
    missingAtomIds: dropped.map((atom) => atom.id),
  }
}
