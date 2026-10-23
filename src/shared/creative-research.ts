export const CREATIVE_RESEARCH_CATEGORIES = [
  { value: 'daoism', label: '道教与哲学' },
  { value: 'buddhism', label: '佛教与因果' },
  { value: 'politics', label: '政治与制度' },
  { value: 'warfare', label: '战争与谋略' },
  { value: 'folk_life', label: '民俗与生活' },
  { value: 'strange_tales', label: '志怪与妖异' },
  { value: 'humanity', label: '人性与伦理' },
  { value: 'narrative', label: '叙事与意象' },
  { value: 'other', label: '其他' },
] as const

export type CreativeResearchCategory = typeof CREATIVE_RESEARCH_CATEGORIES[number]['value']

export interface CreativeResearchDraft {
  sourceKey?: string
  category: CreativeResearchCategory
  title: string
  sourceTitle?: string
  sourceUrl?: string
  tags?: string[]
  content: string
  interpretation?: string
  novelConnection?: string
}

export interface CreativeResearchEntry extends CreativeResearchDraft {
  sourceKey: string
  sourceType: 'author_created'
  assetType: 'creative_reference'
  factTitle: string
  sourceText: string
  verificationStatus: 'pending'
  canonDecision: 'reference_only'
  recordedAt: string
  updatedAt: string
  sharedReference?: { cardId: string; revision: number }
  provenance?: { artifactId: string; candidateId: string; sourceHash: string; sourceLabel: string; start: number; end: number; quote: string }
}

export class CreativeResearchValidationError extends Error {
  readonly code = 'CREATIVE_RESEARCH_INVALID'
}

const CATEGORY_VALUES = new Set<string>(CREATIVE_RESEARCH_CATEGORIES.map(item => item.value))

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedText(value: unknown, field: string, maxLength: number, required = false): string {
  const normalized = text(value)
  if (required && !normalized) throw new CreativeResearchValidationError(`${field}不能为空。`)
  if (normalized.length > maxLength) throw new CreativeResearchValidationError(`${field}不能超过 ${maxLength} 个字符。`)
  return normalized
}

export function isCreativeResearchEntry(value: unknown): value is Record<string, unknown> & CreativeResearchEntry {
  const entry = asRecord(value)
  return entry?.sourceType === 'author_created'
    && entry.assetType === 'creative_reference'
    && typeof entry.sourceKey === 'string'
    && typeof entry.factTitle === 'string'
    && typeof entry.sourceText === 'string'
}

export function normalizeCreativeResearchDraft(value: unknown): CreativeResearchDraft {
  const input = asRecord(value)
  if (!input) throw new CreativeResearchValidationError('资料内容必须是一个对象。')

  const rawCategory = text(input.category)
  if (!CATEGORY_VALUES.has(rawCategory)) throw new CreativeResearchValidationError('请选择有效的资料分类。')
  const title = boundedText(input.title, '标题', 120, true)
  const content = boundedText(input.content, '核心内容', 4000, true)
  const sourceTitle = boundedText(input.sourceTitle, '参考出处', 160)
  const sourceUrl = boundedText(input.sourceUrl, '出处链接', 500)
  const interpretation = boundedText(input.interpretation, '深层含义', 1200, true)
  const novelConnection = boundedText(input.novelConnection, '本作转化方向', 1200, true)
  const sourceKey = boundedText(input.sourceKey, '资料编号', 160)
  if (sourceKey && !/^author:[A-Za-z0-9._:-]+$/u.test(sourceKey)) {
    throw new CreativeResearchValidationError('资料编号只能使用 author: 前缀和字母、数字、点、下划线、冒号或连字符。')
  }
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
    } catch {
      throw new CreativeResearchValidationError('出处链接必须是有效的 http 或 https 地址。')
    }
  }

  const rawTags = Array.isArray(input.tags) ? input.tags : []
  if (rawTags.length > 12) throw new CreativeResearchValidationError('每条资料最多添加 12 个标签。')
  const tags = [...new Set(rawTags.map(item => boundedText(item, '标签', 30)).filter(Boolean))]

  return {
    ...(sourceKey ? { sourceKey } : {}),
    category: rawCategory as CreativeResearchCategory,
    title,
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    tags,
    content,
    interpretation,
    novelConnection,
  }
}

export function parseCreativeResearchEntries(sourceLedgerJson?: string | null): CreativeResearchEntry[] {
  if (!sourceLedgerJson?.trim()) return []
  try {
    const parsed: unknown = JSON.parse(sourceLedgerJson)
    return Array.isArray(parsed)
      ? parsed.filter(isCreativeResearchEntry).map(entry => ({
        ...entry,
        tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      }))
      : []
  } catch {
    return []
  }
}

export function getCreativeResearchCategoryLabel(category: string): string {
  return CREATIVE_RESEARCH_CATEGORIES.find(item => item.value === category)?.label || '其他'
}

export function getCreativeResearchBody(draft: Pick<CreativeResearchDraft, 'content' | 'interpretation' | 'novelConnection'>): string {
  return [
    draft.content.trim(),
    draft.interpretation?.trim() ? `深层含义：${draft.interpretation.trim()}` : '',
    draft.novelConnection?.trim() ? `本作转化：${draft.novelConnection.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function stableKey(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
  }
  return `author:${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

export function getCreativeResearchSourceKey(value: unknown): string {
  const draft = normalizeCreativeResearchDraft(value)
  return draft.sourceKey || stableKey(`${draft.category}\n${draft.title}\n${draft.sourceTitle || ''}`)
}

export function upsertCreativeResearchEntries(
  sourceLedgerJson: string | null | undefined,
  drafts: unknown[],
  recordedAt = new Date().toISOString(),
): Record<string, unknown>[] {
  const ledger: unknown[] = (() => {
    try {
      const parsed: unknown = JSON.parse(sourceLedgerJson || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      throw new CreativeResearchValidationError('来源账本格式损坏，未保存资料；请先刷新作品。')
    }
  })()
  const records = new Map<string, unknown>()
  ledger.forEach((entry, index) => {
    const record = asRecord(entry)
    const key = text(record?.sourceKey) || `unkeyed:${index}`
    records.set(key, entry)
  })

  const saved: CreativeResearchEntry[] = []
  for (const raw of drafts) {
    const draft = normalizeCreativeResearchDraft(raw)
    const sourceKey = getCreativeResearchSourceKey(draft)
    const previous = asRecord(records.get(sourceKey))
    if (previous && !isCreativeResearchEntry(previous)) {
      throw new CreativeResearchValidationError(`资料编号 ${sourceKey} 已属于其他来源，不能覆盖。`)
    }
    const entry: CreativeResearchEntry = {
      ...(previous && isCreativeResearchEntry(previous) && previous.sharedReference ? { sharedReference: previous.sharedReference as CreativeResearchEntry['sharedReference'] } : {}),
      ...(previous && isCreativeResearchEntry(previous) && previous.provenance ? { provenance: previous.provenance as CreativeResearchEntry['provenance'] } : {}),
      ...draft,
      sourceKey,
      sourceType: 'author_created',
      assetType: 'creative_reference',
      factTitle: draft.title,
      sourceText: getCreativeResearchBody(draft),
      verificationStatus: 'pending',
      canonDecision: 'reference_only',
      recordedAt: text(previous?.recordedAt) || recordedAt,
      updatedAt: recordedAt,
    }
    records.set(sourceKey, entry)
    saved.push(entry)
  }

  if (records.size > 1200) throw new CreativeResearchValidationError('单个项目的来源资料已达到 1200 条上限，请先整理或删除旧卡。')
  return [...records.values()].map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
}

export function removeCreativeResearchEntry(sourceLedgerJson: string | null | undefined, sourceKey: string): Record<string, unknown>[] {
  const entries = upsertCreativeResearchEntries(sourceLedgerJson, [])
  return entries.filter(entry => entry.sourceKey !== sourceKey)
}

function searchTerms(value: string): string[] {
  const normalized = value.toLocaleLowerCase()
  const chunks = normalized.split(/[\s,，、；;。！？!?：:“”"'（）()[\]{}<>《》|/\\]+/u).filter(term => term.length >= 2)
  const stopWords = new Set(['本章', '小说', '故事', '人物', '内容', '创作', '资料', '相关', '当前', '这一', '可以', '通过', '发生', '进行', '一个', '以及', '但是', '所以', '如果', '结合', '现有', '需要', '安排', '形成', '作为', '同时', '因为', '之后', '之前', '这个', '那个', '以及', '没有', '不是', '能够', '自己', '他们', '我们', '这里', '那里', '之中', '一种', '一些'])
  const terms = new Set<string>()
  for (const chunk of chunks) {
    if (stopWords.has(chunk)) continue
    if (chunk.length <= 8) terms.add(chunk)
    for (const cjk of chunk.match(/[\u4e00-\u9fff]{2,}/gu) || []) {
      for (let size = 2; size <= Math.min(4, cjk.length); size += 1) {
        for (let start = 0; start + size <= cjk.length; start += 1) {
          const term = cjk.slice(start, start + size)
          if (!stopWords.has(term)) terms.add(term)
          if (terms.size >= 96) return [...terms]
        }
      }
    }
  }
  return [...terms].slice(0, 96)
}

export function selectRelevantCreativeResearchEntries(
  entries: CreativeResearchEntry[],
  query: string,
  limit = 4,
): CreativeResearchEntry[] {
  const terms = searchTerms(query)
  return entries.map((entry, index) => {
    const title = `${entry.title} ${entry.category} ${(entry.tags || []).join(' ')} ${entry.sourceTitle || ''}`.toLocaleLowerCase()
    const body = `${entry.content} ${entry.interpretation || ''} ${entry.novelConnection || ''}`.toLocaleLowerCase()
    const score = terms.reduce((total, term) => total + (title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), 0)
    const date = Date.parse(entry.updatedAt || entry.recordedAt) || 0
    return { entry, score, date, index }
  }).sort((left, right) => right.score - left.score || right.date - left.date || right.index - left.index)
    .slice(0, Math.max(0, limit))
    .map(item => item.entry)
}

export function buildCreativeResearchContext(entry: CreativeResearchEntry): Record<string, unknown> {
  return {
    category: getCreativeResearchCategoryLabel(entry.category),
    title: entry.title,
    source: entry.sourceTitle || undefined,
    sourceUrl: entry.sourceUrl || undefined,
    tags: entry.tags || [],
    coreIdea: entry.content,
    deeperMeaning: entry.interpretation || undefined,
    possibleAdaptation: entry.novelConnection || undefined,
    usageBoundary: '作者创作参考：只用于主题、隐喻、人物选择与代价的启发，不是本书事实、史实或人物知识；不得照搬原作情节、设定或表达。',
  }
}
