import type { ThreadProgressSemanticState } from '../../src/types'

const PROGRESS_MARKERS = [
  '发现',
  '找到',
  '确认',
  '逼近',
  '推进',
  '暴露',
  '揭开',
  '得知',
  '拿到',
  '夺回',
  '追到',
  '拦下',
  '谈妥',
  '和解',
  '破裂',
  '救出',
  '抓住',
  '承认',
  '决定',
  '交换',
  '交出',
  '失去',
  '升级',
  '兑现',
  '回收',
]

const DELAY_MARKERS = [
  '暂缓',
  '押后',
  '以后',
  '改日',
  '之后',
  '容后',
  '先不',
  '暂时',
  '还不是时候',
  '延后',
  '延期',
  '拖到',
  '等到',
]

function normalizeText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCompactText(value?: string | null): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, '')
}

export function splitIntoParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function clipExcerpt(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function buildKeywordCandidates(...values: Array<string | null | undefined>): string[] {
  const pool = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
  const fragments = pool.flatMap((value) => value
    .split(/[，。；、,\s/：:（）()\-]+/)
    .map((item) => item.trim())
    .filter(Boolean))
  const cjkFragments = [...pool, ...fragments].flatMap((value) => {
    if (!/^[\u4e00-\u9fff]{4,18}$/.test(value)) return []
    const windows = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1) {
      windows.add(value.slice(index, index + 2))
    }
    if (value.length >= 4) {
      windows.add(value.slice(0, 4))
      windows.add(value.slice(-4))
    }
    return [...windows]
  })
  return [...new Set([
    ...pool.filter((value) => value.length >= 2 && value.length <= 18),
    ...fragments.filter((value) => value.length >= 2 && value.length <= 12),
    ...cjkFragments.filter((value) => value.length >= 2 && value.length <= 4),
  ])]
}

function buildDirectiveKeywords(...values: Array<string | null | undefined>): string[] {
  const pool = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
  const fragments = pool.flatMap((value) => value
    .split(/[，。；、,\s/：:（）()\-]+/)
    .map((item) => item.trim())
    .filter(Boolean))
  return [...new Set([
    ...pool.filter((value) => value.length >= 4 && value.length <= 28),
    ...fragments.filter((value) => value.length >= 3 && value.length <= 16),
  ])]
}

function countMatchedKeywords(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0
  const haystack = normalizeCompactText(text)
  return keywords.reduce((count, keyword) =>
    haystack.includes(normalizeCompactText(keyword)) ? count + 1 : count, 0)
}

function countMarkers(text: string, markers: string[]): number {
  if (!text) return 0
  const haystack = normalizeCompactText(text)
  return markers.reduce((count, marker) =>
    haystack.includes(normalizeCompactText(marker)) ? count + 1 : count, 0)
}

function countSignals(paragraphs: string[], primaryKeywords: string[], actionKeywords: string[], delayKeywords: string[]) {
  return paragraphs.reduce((result, paragraph) => {
    const mentionHits = countMatchedKeywords(paragraph, primaryKeywords)
    if (mentionHits <= 0) {
      return result
    }

    const progressHits = countMarkers(paragraph, PROGRESS_MARKERS)
    const actionHits = countMatchedKeywords(paragraph, actionKeywords)
    const delayHits = countMarkers(paragraph, DELAY_MARKERS) + countMatchedKeywords(paragraph, delayKeywords)
    const score = mentionHits * 10 + progressHits * 6 + actionHits * 7 + delayHits * 5 + Math.min(paragraph.length, 160) / 160
    if (score > result.bestScore) {
      result.bestScore = score
      result.evidenceExcerpt = clipExcerpt(paragraph)
    }
    result.mentionHits += mentionHits
    result.progressHits += progressHits
    result.actionHits += actionHits
    result.delayHits += delayHits
    return result
  }, {
    mentionHits: 0,
    progressHits: 0,
    actionHits: 0,
    delayHits: 0,
    evidenceExcerpt: '',
    bestScore: 0,
  })
}

export interface ThreadProgressSemanticAnalysis {
  state: ThreadProgressSemanticState
  evidenceExcerpt: string
  reason: string
  mentionHits: number
  progressHits: number
  actionHits: number
  delayHits: number
  overdue: boolean
}

function finalizeState(input: {
  mentionHits: number
  progressHits: number
  actionHits: number
  delayHits: number
  overdue: boolean
  payoffReady: boolean
}): ThreadProgressSemanticAnalysis['state'] {
  if (input.mentionHits <= 0) {
    return input.overdue ? 'stale' : 'missing'
  }
  if (input.payoffReady && (input.progressHits > 0 || input.actionHits > 0)) {
    return 'paid_off'
  }
  if (input.progressHits > 0) {
    return 'advanced'
  }
  if (input.delayHits > 0) {
    return 'blocked'
  }
  return input.overdue ? 'stale' : 'mentioned'
}

function buildReason(state: ThreadProgressSemanticState, overdue: boolean): string {
  switch (state) {
    case 'paid_off':
      return '正文已出现可见动作、证据或结果，形成明确回收。'
    case 'advanced':
      return '正文不止提及该线，还给出了新的行动、信息或后果。'
    case 'blocked':
      return overdue
        ? '正文没有回收，但给出了可见延期原因，可暂视为受阻推进。'
        : '正文明确说明了延期原因或阻碍。'
    case 'mentioned':
      return '正文只提到该线，没有形成新的动作、信息或结果。'
    case 'stale':
      return '该线已超期，但正文仍未推进、未回收，也没有有效延期理由。'
    case 'missing':
    default:
      return '正文没有触及该线。'
  }
}

export function analyzeStoryThreadProgress(input: {
  title?: string | null
  currentState?: string | null
  payoffCondition?: string | null
  summary?: string | null
  targetPayoffChapter?: number | null
  currentChapterNum?: number
  paragraphs: string[]
}): ThreadProgressSemanticAnalysis {
  const primaryKeywords = buildKeywordCandidates(input.title, input.currentState, input.payoffCondition, input.summary)
  const actionKeywords = buildKeywordCandidates(input.payoffCondition, input.currentState)
  const overdue = typeof input.targetPayoffChapter === 'number'
    && typeof input.currentChapterNum === 'number'
    && input.currentChapterNum > input.targetPayoffChapter
  const signals = countSignals(input.paragraphs, primaryKeywords, actionKeywords, [])
  const state = finalizeState({
    ...signals,
    overdue,
    payoffReady: false,
  })
  return {
    state,
    evidenceExcerpt: signals.evidenceExcerpt,
    reason: buildReason(state, overdue),
    mentionHits: signals.mentionHits,
    progressHits: signals.progressHits,
    actionHits: signals.actionHits,
    delayHits: signals.delayHits,
    overdue,
  }
}

export function analyzeForeshadowProgress(input: {
  title?: string | null
  detail?: string | null
  plantMethod?: string | null
  payoffMethod?: string | null
  payoffSceneAction?: string | null
  requiredEvidence?: string | null
  readerVisibleOutcome?: string | null
  allowedDelayReason?: string | null
  targetPayoffChapter?: number | null
  currentChapterNum?: number
  paragraphs: string[]
}): ThreadProgressSemanticAnalysis {
  const primaryKeywords = buildKeywordCandidates(
    input.title,
    input.detail,
    input.plantMethod,
    input.payoffMethod,
    input.payoffSceneAction,
    input.requiredEvidence,
    input.readerVisibleOutcome,
  )
  const actionKeywords = buildDirectiveKeywords(
    input.payoffMethod,
    input.payoffSceneAction,
    input.requiredEvidence,
    input.readerVisibleOutcome,
  )
  const delayKeywords = buildDirectiveKeywords(input.allowedDelayReason)
  const overdue = typeof input.targetPayoffChapter === 'number'
    && typeof input.currentChapterNum === 'number'
    && input.currentChapterNum > input.targetPayoffChapter
  const signals = countSignals(input.paragraphs, primaryKeywords, actionKeywords, delayKeywords)
  let state: ThreadProgressSemanticState
  if (signals.mentionHits <= 0) {
    state = overdue ? 'stale' : 'missing'
  } else if (signals.actionHits > 0) {
    state = 'paid_off'
  } else if (signals.delayHits > 0) {
    state = 'blocked'
  } else if (signals.progressHits > 0) {
    state = 'advanced'
  } else {
    state = overdue ? 'stale' : 'mentioned'
  }
  return {
    state,
    evidenceExcerpt: signals.evidenceExcerpt,
    reason: buildReason(state, overdue),
    mentionHits: signals.mentionHits,
    progressHits: signals.progressHits,
    actionHits: signals.actionHits,
    delayHits: signals.delayHits,
    overdue,
  }
}
