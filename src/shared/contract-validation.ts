import type {
  ChapterContractValidationResult,
  ContractValidationItem,
  ContractValidationVerdict,
} from '../types'

export const SOFT_CONTRACT_VALIDATION_ITEM_TYPES = new Set([
  'chapter_title_alignment',
  'golden_three_opening',
])

export function isSoftContractValidationItemType(contractItemType?: string | null): boolean {
  return SOFT_CONTRACT_VALIDATION_ITEM_TYPES.has(String(contractItemType || '').trim())
}

export function isContractValidationBlockerVerdict(verdict: ContractValidationVerdict): boolean {
  return verdict === 'missing' || verdict === 'contradicted'
}

export function isContractValidationWarningVerdict(verdict: ContractValidationVerdict): boolean {
  return verdict === 'weak' || verdict === 'overdelivered'
}

export function isHardContractValidationItem(item: Pick<ContractValidationItem, 'contractItemType'>): boolean {
  return !isSoftContractValidationItemType(item.contractItemType)
}

export function getHardContractValidationItems(items: ContractValidationItem[]): ContractValidationItem[] {
  return items.filter(isHardContractValidationItem)
}

export function deriveChapterContractValidationStatus(
  items: ContractValidationItem[],
): ChapterContractValidationResult['status'] {
  const hardItems = getHardContractValidationItems(items)
  if (hardItems.some((item) => isContractValidationBlockerVerdict(item.verdict))) return 'blocker'
  if (items.some((item) => item.verdict !== 'pass')) return 'warning'
  return 'pass'
}

export function hasHardContractValidationBlocker(result?: ChapterContractValidationResult | null): boolean {
  if (!result) return false
  return getHardContractValidationItems(result.itemResults)
    .some((item) => isContractValidationBlockerVerdict(item.verdict))
}
