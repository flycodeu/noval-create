export interface SubPlotDraft {
  name: string
  characters: string
  conflict: string
  mainlineLink: string
  endChapter: string
}

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface SubplotGenerationRequest {
  novelId: number
  messages: PromptMessage[]
  expectedCount: number
  existingSubplots: SubPlotDraft[]
  modelConfigId?: number
  batchIndex?: number
  totalBatches?: number
}

export interface SubplotRejection {
  code: 'missing_field' | 'duplicate_name' | 'duplicate_signature' | 'conflict_too_long' | 'mainline_link_too_long'
  message: string
  subplot?: SubPlotDraft
}

export interface SubplotGenerationResult {
  taskId: number
  accepted: SubPlotDraft[]
  rejectedCount: number
  rejectionReasons: string[]
  rawOutput: string
  warningMessage?: string
}

export interface SubplotValidationOptions {
  existingSubplots: SubPlotDraft[]
  expectedCount: number
  maxConflictLength: number
  maxMainlineLinkLength: number
}

export interface SubplotValidationResult {
  accepted: SubPlotDraft[]
  rejected: SubplotRejection[]
  rejectionReasons: string[]
  warningMessage?: string
  fatalMessage?: string
}

export type SubplotParseMode = 'direct_json' | 'json_fragment' | 'field_recovery'

export interface ParsedSubplotFrameworkResponse {
  subplots: SubPlotDraft[]
  mode: SubplotParseMode
  repaired: boolean
  notes: string[]
}

type SubplotFieldKey = keyof SubPlotDraft

interface LooseObjectSegment {
  start: number
  text: string
}

const SUBPLOT_FIELD_ALIASES: Record<string, SubplotFieldKey> = {
  name: 'name',
  title: 'name',
  characters: 'characters',
  character: 'characters',
  conflict: 'conflict',
  coreConflict: 'conflict',
  core_conflict: 'conflict',
  mainlineLink: 'mainlineLink',
  mainline_link: 'mainlineLink',
  mainline: 'mainlineLink',
  endChapter: 'endChapter',
  end_chapter: 'endChapter',
}

const WRAPPER_ARRAY_KEYS = ['subPlots', 'subplots', 'items', 'data'] as const
const LOOSE_FIELD_PATTERN = /(?:\"|')?(name|title|characters|character|conflict|coreConflict|core_conflict|mainlineLink|mainline_link|mainline|endChapter|end_chapter)(?:\"|')?\s*[:\uFF1A]/g

export function asSubPlotText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function normalizeSubPlot(item: unknown): SubPlotDraft | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null

  const raw = item as Record<string, unknown>
  const subplot: SubPlotDraft = {
    name: asSubPlotText(raw.name ?? raw.title),
    characters: asSubPlotText(raw.characters ?? raw.character),
    conflict: asSubPlotText(raw.conflict ?? raw.coreConflict ?? raw.core_conflict),
    mainlineLink: asSubPlotText(raw.mainlineLink ?? raw.mainline_link ?? raw.mainline),
    endChapter: asSubPlotText(raw.endChapter ?? raw.end_chapter),
  }

  return Object.values(subplot).some(Boolean) ? subplot : null
}

export function stripJsonCodeFence(raw: string): string {
  return raw.replace(/```json|```/gi, '').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPotentialSubplotValue(value: unknown): boolean {
  return Boolean(normalizeSubPlot(value))
}

function findWrappedCandidateArray(record: Record<string, unknown>): unknown[] | null {
  for (const key of WRAPPER_ARRAY_KEYS) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[]
    }
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.some(isPotentialSubplotValue)) {
      return value
    }

    if (!isRecord(value)) continue
    for (const key of WRAPPER_ARRAY_KEYS) {
      if (Array.isArray(value[key])) {
        return value[key] as unknown[]
      }
    }
  }

  return null
}

function extractSubplotCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (!isRecord(parsed)) return [parsed]

  const wrapped = findWrappedCandidateArray(parsed)
  return wrapped ?? [parsed]
}

function parseStructuredSubplots(parsed: unknown): SubPlotDraft[] {
  return extractSubplotCandidates(parsed)
    .map(normalizeSubPlot)
    .filter((subplot): subplot is SubPlotDraft => Boolean(subplot))
}

function tryParseStructuredJson(text: string): SubPlotDraft[] | null {
  try {
    return parseStructuredSubplots(JSON.parse(text))
  } catch {
    return null
  }
}

function extractBalancedJsonSegment(text: string): string | null {
  const start = text.search(/[\[{]/)
  if (start === -1) return null

  const stack: string[] = [text[start] === '[' ? ']' : '}']
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '[') {
      stack.push(']')
      continue
    }

    if (char === '{') {
      stack.push('}')
      continue
    }

    if ((char === ']' || char === '}') && stack.length > 0) {
      if (char !== stack[stack.length - 1]) {
        return null
      }

      stack.pop()
      if (stack.length === 0) {
        return text.slice(start, index + 1)
      }
    }
  }

  return null
}

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['\u201c', '\u201d'],
    ['\u2018', '\u2019'],
    ['\u300c', '\u300d'],
    ['\u300e', '\u300f'],
  ]

  for (const [open, close] of pairs) {
    if (value.startsWith(open) && value.endsWith(close) && value.length >= open.length + close.length) {
      return value.slice(open.length, value.length - close.length).trim()
    }
  }

  return value.replace(/^["'`\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]+|["'`\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]+$/g, '').trim()
}

function parseLooseArrayValue(value: string): string | null {
  const normalized = value
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/'/g, '"')

  try {
    const parsed = JSON.parse(normalized)
    if (!Array.isArray(parsed)) return null
    return parsed.map(asSubPlotText).filter(Boolean).join(',')
  } catch {
    const inner = value.slice(1, -1).trim()
    if (!inner) return ''
    return inner
      .split(/[,\uFF0C]/)
      .map((item) => stripWrappingQuotes(item.trim()))
      .filter(Boolean)
      .join(',')
  }
}

function parseLooseFieldValue(rawValue: string, key: SubplotFieldKey): string {
  let value = rawValue
    .trim()
    .replace(/^[,\uFF0C]+/, '')
    .replace(/[,\uFF0C]+$/, '')
    .trim()

  if (!value) return ''

  if (value.startsWith('[') && value.endsWith(']')) {
    const arrayValue = parseLooseArrayValue(value)
    if (arrayValue !== null) {
      return arrayValue
    }
  }

  value = stripWrappingQuotes(value)
    .replace(/^[,\uFF0C]+/, '')
    .replace(/[,\uFF0C]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (key === 'endChapter') {
    const matched = value.match(/\d+/)
    return matched?.[0] || value
  }

  return value
}

function normalizeLooseFieldKey(rawKey: string): SubplotFieldKey | null {
  return SUBPLOT_FIELD_ALIASES[rawKey] || null
}

function countLooseSubplotKeys(segment: string): number {
  const keys = new Set<SubplotFieldKey>()
  for (const match of segment.matchAll(LOOSE_FIELD_PATTERN)) {
    const normalized = normalizeLooseFieldKey(match[1])
    if (normalized) keys.add(normalized)
  }
  return keys.size
}

function isLeafObjectSegment(segment: string): boolean {
  const inner = segment.slice(1, -1)
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '{') {
      return false
    }
  }

  return true
}

function extractLooseObjectSegments(text: string): LooseObjectSegment[] {
  const segments: Array<LooseObjectSegment & { end: number }> = []
  const stack: number[] = []
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '{') {
      stack.push(index)
      continue
    }

    if (char === '}' && stack.length > 0) {
      const start = stack.pop() as number
      segments.push({
        start,
        end: index,
        text: text.slice(start, index + 1),
      })
    }
  }

  return segments
    .filter((segment) => isLeafObjectSegment(segment.text) && countLooseSubplotKeys(segment.text) >= 2)
    .sort((left, right) => left.start - right.start)
    .map(({ start, text }) => ({ start, text }))
}

function parseLooseSubplotObject(segment: string): SubPlotDraft | null {
  const matches = Array.from(segment.matchAll(LOOSE_FIELD_PATTERN))
  if (matches.length === 0) return null

  const raw: Partial<Record<SubplotFieldKey, string>> = {}
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const normalizedKey = normalizeLooseFieldKey(match[1])
    if (!normalizedKey || raw[normalizedKey]) continue

    const valueStart = (match.index || 0) + match[0].length
    const valueEnd = matches[index + 1]?.index ?? segment.length - 1
    raw[normalizedKey] = parseLooseFieldValue(segment.slice(valueStart, valueEnd), normalizedKey)
  }

  return normalizeSubPlot(raw)
}

function recoverSubplotsFromLooseText(text: string): ParsedSubplotFrameworkResponse | null {
  const candidateSource = extractBalancedJsonSegment(text) || text
  const segments = extractLooseObjectSegments(candidateSource)
  if (segments.length === 0) return null

  const subplots = segments
    .map((segment) => parseLooseSubplotObject(segment.text))
    .filter((subplot): subplot is SubPlotDraft => Boolean(subplot))

  if (subplots.length === 0) return null

  return {
    subplots,
    mode: 'field_recovery',
    repaired: true,
    notes: [
      segments.length === subplots.length
        ? `\u5df2\u81ea\u52a8\u4fee\u590d\u975e\u6807\u51c6 JSON\uff0c\u6062\u590d ${subplots.length} \u6761\u652f\u7ebf`
        : `\u5df2\u81ea\u52a8\u4fee\u590d\u975e\u6807\u51c6 JSON\uff0c\u6062\u590d ${subplots.length}/${segments.length} \u6761\u652f\u7ebf`,
    ],
  }
}

function buildParsePreview(text: string): string {
  const preview = text.replace(/\s+/g, ' ').trim()
  return preview.length > 120 ? `${preview.slice(0, 120)}...` : preview
}

function createParseError(text: string, reason: string): SyntaxError {
  return new SyntaxError(`\u652f\u7ebf JSON \u89e3\u6790\u5931\u8d25\uff1a${reason}\u3002\u7247\u6bb5\uff1a${buildParsePreview(text)}`)
}

export function parseSubPlotFrameworkResponseDetailed(raw: string): ParsedSubplotFrameworkResponse {
  const cleaned = stripJsonCodeFence(raw)
  const directSubplots = tryParseStructuredJson(cleaned)
  if (directSubplots && directSubplots.length > 0) {
    return {
      subplots: directSubplots,
      mode: 'direct_json',
      repaired: false,
      notes: [],
    }
  }

  const fragment = extractBalancedJsonSegment(cleaned)
  if (fragment && fragment !== cleaned) {
    const fragmentSubplots = tryParseStructuredJson(fragment)
    if (fragmentSubplots && fragmentSubplots.length > 0) {
      return {
        subplots: fragmentSubplots,
        mode: 'json_fragment',
        repaired: true,
        notes: ['\u5df2\u81ea\u52a8\u5ffd\u7565 JSON \u524d\u540e\u7684\u8bf4\u660e\u6587\u5b57'],
      }
    }
  }

  const recovered = recoverSubplotsFromLooseText(fragment || cleaned)
  if (recovered) {
    return recovered
  }

  const target = fragment || cleaned
  if (!target.trim()) {
    throw createParseError(raw, 'AI \u672a\u8fd4\u56de\u53ef\u89e3\u6790\u5185\u5bb9')
  }

  throw createParseError(target, '\u672a\u627e\u5230\u53ef\u6062\u590d\u7684\u652f\u7ebf\u5bf9\u8c61')
}

export function parseSubPlotFrameworkResponse(raw: string): SubPlotDraft[] {
  return parseSubPlotFrameworkResponseDetailed(raw).subplots
}

export function normalizeSubplotIdentity(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\uFF0C\u3002\u3001\u201c\u201d\u2018\u2019"'\uFF1F\uFF01!?:\uFF1A;\uFF1B\u3001\uFF08\uFF09()\u300a\u300b\u3010\u3011\[\]<>\u2026\u2014\-]/g, '')
}

export function getSubplotSignature(subplot: SubPlotDraft): string {
  return [
    normalizeSubplotIdentity(subplot.name),
    normalizeSubplotIdentity(subplot.conflict),
    normalizeSubplotIdentity(subplot.mainlineLink),
  ].join('|')
}

function aggregateRejectionReasons(rejections: SubplotRejection[]): string[] {
  const counts = new Map<string, number>()
  for (const rejection of rejections) {
    counts.set(rejection.message, (counts.get(rejection.message) || 0) + 1)
  }

  return Array.from(counts.entries()).map(([message, count]) =>
    count > 1 ? `${message} x${count}` : message,
  )
}

function validateSubplotFields(
  subplot: SubPlotDraft,
  options: Pick<SubplotValidationOptions, 'maxConflictLength' | 'maxMainlineLinkLength'>,
): SubplotRejection | null {
  if (!subplot.name || !subplot.characters || !subplot.conflict || !subplot.mainlineLink || !subplot.endChapter) {
    return { code: 'missing_field', message: '\u5b57\u6bb5\u4e0d\u5b8c\u6574', subplot }
  }

  if (subplot.conflict.length > options.maxConflictLength) {
    return {
      code: 'conflict_too_long',
      message: `\u6838\u5fc3\u51b2\u7a81\u8fc7\u957f\uff08>${options.maxConflictLength}\u5b57\uff09`,
      subplot,
    }
  }

  if (subplot.mainlineLink.length > options.maxMainlineLinkLength) {
    return {
      code: 'mainline_link_too_long',
      message: `\u4e0e\u4e3b\u7ebf\u5173\u8054\u8fc7\u957f\uff08>${options.maxMainlineLinkLength}\u5b57\uff09`,
      subplot,
    }
  }

  return null
}

export function validateGeneratedSubplots(
  candidates: SubPlotDraft[],
  options: SubplotValidationOptions,
): SubplotValidationResult {
  const accepted: SubPlotDraft[] = []
  const rejected: SubplotRejection[] = []
  const seenNames = new Set(
    options.existingSubplots
      .map((subplot) => normalizeSubplotIdentity(subplot.name))
      .filter(Boolean),
  )
  const seenSignatures = new Set(
    options.existingSubplots
      .map(getSubplotSignature)
      .filter(Boolean),
  )

  for (const subplot of candidates) {
    const fieldIssue = validateSubplotFields(subplot, options)
    if (fieldIssue) {
      rejected.push(fieldIssue)
      continue
    }

    const normalizedName = normalizeSubplotIdentity(subplot.name)
    if (normalizedName && seenNames.has(normalizedName)) {
      rejected.push({ code: 'duplicate_name', message: '\u540d\u79f0\u91cd\u590d', subplot })
      continue
    }

    const signature = getSubplotSignature(subplot)
    if (signature && seenSignatures.has(signature)) {
      rejected.push({ code: 'duplicate_signature', message: '\u6838\u5fc3\u51b2\u7a81\u6216\u4e3b\u7ebf\u4f5c\u7528\u91cd\u590d', subplot })
      continue
    }

    if (normalizedName) seenNames.add(normalizedName)
    if (signature) seenSignatures.add(signature)
    accepted.push(subplot)
  }

  const rejectionReasons = aggregateRejectionReasons(rejected)

  if (accepted.length === 0) {
    return {
      accepted,
      rejected,
      rejectionReasons,
      fatalMessage: rejectionReasons.length > 0
        ? `\u672a\u627e\u5230\u53ef\u4fdd\u7559\u7684\u652f\u7ebf\u7ed3\u679c\uff1a${rejectionReasons.join('\uff1b')}`
        : '\u672a\u627e\u5230\u53ef\u4fdd\u7559\u7684\u652f\u7ebf\u7ed3\u679c',
    }
  }

  const warningParts: string[] = []
  if (accepted.length < options.expectedCount) {
    warningParts.push(`\u4ec5\u4fdd\u7559 ${accepted.length}/${options.expectedCount} \u6761`)
  }
  if (rejectionReasons.length > 0) {
    warningParts.push(`\u62d2\u7edd\u539f\u56e0\uff1a${rejectionReasons.join('\uff1b')}`)
  }

  return {
    accepted,
    rejected,
    rejectionReasons,
    warningMessage: warningParts.length > 0 ? `\u90e8\u5206\u63a5\u53d7\uff1a${warningParts.join('\uff1b')}` : undefined,
  }
}
