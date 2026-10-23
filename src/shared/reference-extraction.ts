import { normalizeCreativeResearchDraft, type CreativeResearchDraft } from './creative-research'

export const REFERENCE_TEXT_LIMIT = 20_000
export const REFERENCE_CARD_LIMIT = 10

export interface ReferenceExtractionInput {
  novelId: number
  text: string
  sourceTitle: string
  sourceLabel?: string
  request: string
  idempotencyKey: string
}

export interface ReferenceCandidate {
  id: string
  draft: CreativeResearchDraft
  start: number
  end: number
  quote: string
  error?: string
}

export interface ReferenceExtractionResult {
  source: { text: string; hash: string; title: string; label: string }
  candidates: ReferenceCandidate[]
}

/** Offsets are always measured against the unchanged input, in JS UTF-16 units. */
export function parseReferenceCandidates(value: unknown, source: string): ReferenceCandidate[] {
  const cards = value && typeof value === 'object' && 'cards' in value ? value.cards : null
  if (!Array.isArray(cards) || !cards.length || cards.length > REFERENCE_CARD_LIMIT) {
    throw new Error(`提炼结果需要包含 1–${REFERENCE_CARD_LIMIT} 张资料卡。`)
  }
  return cards.map((raw: unknown, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('提炼卡片格式不完整。')
    const card = raw as Record<string, unknown>
    const quote = typeof card.quote === 'string' ? card.quote : ''
    // Unique literal quotes can be located deterministically; ambiguous quotes need exact offsets.
    const first = quote ? source.indexOf(quote) : -1
    const start = Number.isInteger(card.start) ? Number(card.start) : first
    const end = Number.isInteger(card.end) ? Number(card.end) : start + quote.length
    const valid = quote.trim().length >= 4 && start >= 0 && end > start && end <= source.length && source.slice(start, end) === quote
      && (Number.isInteger(card.start) || source.indexOf(quote, first + 1) === -1)
    return {
      id: `card-${index + 1}`,
      draft: normalizeCreativeResearchDraft(card), start, end, quote,
      ...(!valid ? { error: '引文无法唯一对应所选原文，请重新提炼；此卡不能直接保存。' } : {}),
    }
  })
}
