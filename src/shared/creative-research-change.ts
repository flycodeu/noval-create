import { isCreativeResearchEntry, normalizeCreativeResearchDraft } from './creative-research'

type LedgerRecord = Record<string, unknown>
export type CreativeResearchLedgerChange = 'unchanged' | 'references_only' | 'context'

const authorFields = new Set(['sourceKey', 'sourceType', 'assetType', 'category', 'title', 'factTitle', 'sourceTitle', 'sourceUrl', 'tags', 'content', 'interpretation', 'novelConnection', 'sourceText', 'verificationStatus', 'canonDecision', 'recordedAt', 'updatedAt'])
const webFields = new Set(['sourceKey', 'sourceType', 'assetType', 'chapterId', 'chapterNum', 'provider', 'query', 'sourceUrl', 'factTitle', 'sourceText', 'excerptKind', 'confidence', 'verificationStatus', 'publishedAt', 'recordedAt', 'updatedAt', 'researchTopics', 'researchRequestKeys', 'canonDecision'])

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
  return value
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

function parseLedger(raw: string | null | undefined): LedgerRecord[] | null {
  try {
    const parsed: unknown = JSON.parse(raw?.trim() || '[]')
    if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return null
    const rows = parsed as LedgerRecord[]
    const keys = rows.map(row => row.sourceKey).filter(key => typeof key === 'string' && key.length > 0)
    return new Set(keys).size === keys.length ? rows : null
  } catch { return null }
}

function validDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function optionalStrings(value: unknown) {
  return value === undefined || Array.isArray(value) && value.every(item => typeof item === 'string')
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

/** Only known, unadopted reference shapes can avoid invalidating narrative dependencies. */
function isReferenceOnly(row: LedgerRecord) {
  if (isCreativeResearchEntry(row) && Object.keys(row).every(key => authorFields.has(key))) {
    try {
      const normalized = normalizeCreativeResearchDraft(row)
      const fields = ['sourceKey', 'category', 'title', 'sourceTitle', 'sourceUrl', 'tags', 'content', 'interpretation', 'novelConnection']
      const authored = Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]))
      authored.tags ??= []
      return sameValue(normalized, authored) && row.factTitle === row.title
        && row.sourceText === [`核心机制：${row.content}`, `深层含义：${row.interpretation}`, `本作转化：${row.novelConnection}`].join('\n')
        && validDate(row.recordedAt) && validDate(row.updatedAt)
    } catch { return false }
  }
  return row.sourceType === 'web_search' && row.assetType === 'external_web'
    && typeof row.sourceKey === 'string' && /^web:[A-Za-z0-9._:-]+$/u.test(row.sourceKey)
    && row.canonDecision === 'reference_only' && row.verificationStatus === 'web_found'
    && Object.keys(row).every(key => webFields.has(key))
    && typeof row.factTitle === 'string' && Boolean(row.factTitle.trim()) && typeof row.sourceText === 'string' && Boolean(row.sourceText.trim())
    && typeof row.query === 'string' && Boolean(row.query.trim()) && typeof row.provider === 'string' && Boolean(row.provider.trim()) && safeUrl(row.sourceUrl)
    && validDate(row.recordedAt) && (row.updatedAt === undefined || validDate(row.updatedAt))
    && (row.publishedAt === undefined || validDate(row.publishedAt))
    && ['chapterId', 'chapterNum'].every(key => row[key] === undefined || Number.isSafeInteger(row[key]) && Number(row[key]) >= 0)
    && (row.confidence === undefined || typeof row.confidence === 'number' && Number.isFinite(row.confidence) && row.confidence >= 0 && row.confidence <= 1)
    && (row.excerptKind === undefined || row.excerptKind === 'source_metadata')
    && optionalStrings(row.researchTopics) && optionalStrings(row.researchRequestKeys)
}

/** Unknown fields, adoption, audit evidence and malformed ledgers retain conservative invalidation. */
export function classifyCreativeResearchLedgerChange(before: string | null | undefined, after: string | null | undefined): CreativeResearchLedgerChange {
  const previous = parseLedger(before), next = parseLedger(after)
  if (!previous || !next) return 'context'
  if (sameValue(previous, next)) return 'unchanged'
  return sameValue(previous.filter(row => !isReferenceOnly(row)), next.filter(row => !isReferenceOnly(row))) ? 'references_only' : 'context'
}
