import { stableHash, stableSerialize } from './context-pack'

export type ReaderFeedbackSentiment = 'keep' | 'reduce'
export type ReaderFeedbackStatus = 'approved' | 'revoked'
export type ReaderFeedbackScope =
  | { type: 'passage' }
  | { type: 'scene'; sceneOrder: number }
  | { type: 'character'; characterId?: number; characterName: string }
  | { type: 'book' }

export interface ReaderFeedbackSourceRef {
  chapterId: number
  contentHash: string
  start: number
  end: number
  excerptHash: string
}

export interface ReaderFeedbackItem {
  id: string
  novelId: number
  source: ReaderFeedbackSourceRef
  note: string
  topic: string
  sentiment: ReaderFeedbackSentiment
  scope: ReaderFeedbackScope
  status: ReaderFeedbackStatus
  version: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export interface ReaderFeedbackSettings {
  schemaVersion: 1
  revision: number
  items: ReaderFeedbackItem[]
}

export type ReaderFeedbackSourceState =
  | 'selected'
  | 'out_of_scope'
  | 'revoked'
  | 'source_changed'
  | 'source_deleted'
  | 'duplicate'
  | 'omitted_limit'

export interface ReaderFeedbackStateEntry {
  id: string
  state: ReaderFeedbackSourceState
}

export interface ReaderFeedbackConflict {
  scopeKey: string
  topic: string
  itemIds: string[]
}

export interface ResolvedReaderFeedback {
  settingsRevision: number
  selected: ReaderFeedbackItem[]
  states: ReaderFeedbackStateEntry[]
  conflicts: ReaderFeedbackConflict[]
  omittedCount: number
  diagnostics: string[]
}

export interface ReaderFeedbackTargetContext {
  novelId: number
  chapterId: number
  sceneOrders?: number[]
  characterIds?: number[]
  characterNames?: string[]
  sourceContentsByChapterId: Record<string, string>
  limit?: number
}

export interface SaveReaderFeedbackInput {
  expectedRevision: number
  chapterId: number
  start: number
  end: number
  expectedContentHash?: string
  note: string
  topic: string
  sentiment: ReaderFeedbackSentiment
  scope: ReaderFeedbackScope
}

export interface ReaderFeedbackMutationResult {
  settingsJson: string
  feedback: ReaderFeedbackSettings
  changed: boolean
  item: ReaderFeedbackItem
}

export type ReaderFeedbackErrorCode =
  | 'RF_FEEDBACK_INVALID'
  | 'RF_FEEDBACK_REVISION_CONFLICT'
  | 'RF_FEEDBACK_NOT_FOUND'
  | 'RF_FEEDBACK_INVALID_SELECTION'
  | 'RF_FEEDBACK_CHARACTER_SCOPE_MISMATCH'
  | 'RF_FEEDBACK_SCENE_SCOPE_MISMATCH'
  | 'RF_FEEDBACK_CHAPTER_SCOPE_MISMATCH'

const READER_FEEDBACK_ERROR_MESSAGES: Record<ReaderFeedbackErrorCode, string> = {
  RF_FEEDBACK_INVALID: '作者反馈内容、来源或作用范围无效。',
  RF_FEEDBACK_REVISION_CONFLICT: '作者反馈版本已变化，请刷新后重试。',
  RF_FEEDBACK_NOT_FOUND: '找不到要撤销的作者反馈。',
  RF_FEEDBACK_INVALID_SELECTION: '作者反馈选区无效。',
  RF_FEEDBACK_CHARACTER_SCOPE_MISMATCH: '作者反馈角色不属于当前作品。',
  RF_FEEDBACK_SCENE_SCOPE_MISMATCH: '作者反馈场景不在来源章节的当前场景计划中。',
  RF_FEEDBACK_CHAPTER_SCOPE_MISMATCH: '作者反馈来源章节不属于当前作品。',
}

export class ReaderFeedbackError extends Error {
  constructor(readonly code: ReaderFeedbackErrorCode) {
    super(READER_FEEDBACK_ERROR_MESSAGES[code])
    this.name = 'ReaderFeedbackError'
  }
}

export function throwReaderFeedbackError(code: ReaderFeedbackErrorCode): never {
  throw new ReaderFeedbackError(code)
}

const EMPTY_FEEDBACK: ReaderFeedbackSettings = { schemaVersion: 1, revision: 0, items: [] }
const DEFAULT_SELECTION_LIMIT = 6

function parseObject(raw?: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function normalizeScope(value: unknown): ReaderFeedbackScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const scope = value as Record<string, unknown>
  if (scope.type === 'passage' || scope.type === 'book') return { type: scope.type }
  if (scope.type === 'scene' && isPositiveInteger(scope.sceneOrder)) {
    return { type: 'scene', sceneOrder: scope.sceneOrder }
  }
  if (scope.type === 'character') {
    const characterName = cleanText(scope.characterName, 80)
    const characterId = isPositiveInteger(scope.characterId) ? scope.characterId : undefined
    if (characterName || characterId) return { type: 'character', ...(characterId ? { characterId } : {}), characterName }
  }
  return null
}

function normalizeItem(value: unknown): ReaderFeedbackItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const source = item.source as Record<string, unknown> | undefined
  const scope = normalizeScope(item.scope)
  const note = cleanText(item.note, 240)
  const topic = cleanText(item.topic, 80)
  if (!cleanText(item.id, 120) || !isPositiveInteger(item.novelId) || !source || !scope || !note || !topic) return null
  if (!isPositiveInteger(source.chapterId) || typeof source.contentHash !== 'string'
    || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end)
    || Number(source.start) < 0 || Number(source.end) <= Number(source.start)
    || typeof source.excerptHash !== 'string') return null
  if (item.sentiment !== 'keep' && item.sentiment !== 'reduce') return null
  if (item.status !== 'approved' && item.status !== 'revoked') return null
  if (!isPositiveInteger(item.version) || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') return null
  return {
    id: cleanText(item.id, 120),
    novelId: item.novelId,
    source: {
      chapterId: source.chapterId,
      contentHash: source.contentHash,
      start: Number(source.start),
      end: Number(source.end),
      excerptHash: source.excerptHash,
    },
    note,
    topic,
    sentiment: item.sentiment,
    scope,
    status: item.status,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(typeof item.revokedAt === 'string' ? { revokedAt: item.revokedAt } : {}),
  }
}

export function parseReaderFeedbackSettings(raw?: string | null): ReaderFeedbackSettings {
  const root = parseObject(raw)
  const readerFirst = root.readerFirst && typeof root.readerFirst === 'object' && !Array.isArray(root.readerFirst)
    ? root.readerFirst as Record<string, unknown> : {}
  const value = readerFirst.authorFeedback
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(EMPTY_FEEDBACK)
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0) {
    return structuredClone(EMPTY_FEEDBACK)
  }
  return {
    schemaVersion: 1,
    revision: Number(record.revision),
    items: Array.isArray(record.items) ? record.items.map(normalizeItem).filter((item): item is ReaderFeedbackItem => Boolean(item)) : [],
  }
}

function writeReaderFeedbackSettings(raw: string | null | undefined, feedback: ReaderFeedbackSettings): string {
  const root = parseObject(raw)
  const readerFirst = root.readerFirst && typeof root.readerFirst === 'object' && !Array.isArray(root.readerFirst)
    ? root.readerFirst as Record<string, unknown> : {}
  return JSON.stringify({ ...root, readerFirst: { ...readerFirst, authorFeedback: feedback } })
}

/** Generic settings forms may keep current feedback but cannot manufacture, overwrite, or erase it. */
export function preserveReaderFeedbackSettings(currentRaw: string | null | undefined, incomingRaw: string): string {
  const current = parseObject(currentRaw)
  const incoming = parseObject(incomingRaw)
  if (!Object.prototype.hasOwnProperty.call(incoming, 'readerFirst')) return JSON.stringify(incoming)
  const currentReaderFirst = current.readerFirst && typeof current.readerFirst === 'object' && !Array.isArray(current.readerFirst)
    ? current.readerFirst as Record<string, unknown> : {}
  const incomingReaderFirst = incoming.readerFirst && typeof incoming.readerFirst === 'object' && !Array.isArray(incoming.readerFirst)
    ? incoming.readerFirst as Record<string, unknown> : {}
  const nextReaderFirst = { ...incomingReaderFirst }
  delete nextReaderFirst.authorFeedback
  if (currentReaderFirst.authorFeedback !== undefined) nextReaderFirst.authorFeedback = currentReaderFirst.authorFeedback
  return JSON.stringify({ ...incoming, readerFirst: nextReaderFirst })
}

function feedbackScopeKey(item: Pick<ReaderFeedbackItem, 'source' | 'scope'>): string {
  switch (item.scope.type) {
    case 'passage': return `passage:${item.source.chapterId}:${item.source.start}:${item.source.end}`
    case 'scene': return `scene:${item.source.chapterId}:${item.scope.sceneOrder}`
    case 'character': return `character:${item.scope.characterId || 0}:${item.scope.characterName.toLocaleLowerCase()}`
    case 'book': return 'book'
  }
}

function feedbackFingerprint(item: Pick<ReaderFeedbackItem, 'novelId' | 'source' | 'note' | 'topic' | 'sentiment' | 'scope'>): string {
  return stableHash({ novelId: item.novelId, source: item.source, note: cleanText(item.note, 240).toLocaleLowerCase(),
    topic: cleanText(item.topic, 80).toLocaleLowerCase(), sentiment: item.sentiment, scope: item.scope })
}

export function appendReaderFeedbackSettings(
  currentRaw: string | null | undefined,
  expectedRevision: number,
  item: ReaderFeedbackItem,
): ReaderFeedbackMutationResult {
  const current = parseReaderFeedbackSettings(currentRaw)
  const normalized = normalizeItem(item)
  if (!normalized) throwReaderFeedbackError('RF_FEEDBACK_INVALID')
  const fingerprint = feedbackFingerprint(normalized)
  const duplicate = current.items.find((entry) => entry.status === 'approved' && feedbackFingerprint(entry) === fingerprint)
  if (duplicate) return { settingsJson: currentRaw || '{}', feedback: current, changed: false, item: duplicate }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    throwReaderFeedbackError('RF_FEEDBACK_REVISION_CONFLICT')
  }
  const feedback: ReaderFeedbackSettings = { schemaVersion: 1, revision: current.revision + 1, items: [...current.items, normalized] }
  return { settingsJson: writeReaderFeedbackSettings(currentRaw, feedback), feedback, changed: true, item: normalized }
}

export function revokeReaderFeedbackSettings(
  currentRaw: string | null | undefined,
  input: { id: string; expectedRevision: number; revokedAt: string },
): ReaderFeedbackMutationResult {
  const current = parseReaderFeedbackSettings(currentRaw)
  const existing = current.items.find((item) => item.id === input.id)
  if (!existing) throwReaderFeedbackError('RF_FEEDBACK_NOT_FOUND')
  if (existing.status === 'revoked') return { settingsJson: currentRaw || '{}', feedback: current, changed: false, item: existing }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== current.revision) {
    throwReaderFeedbackError('RF_FEEDBACK_REVISION_CONFLICT')
  }
  const revoked: ReaderFeedbackItem = { ...existing, status: 'revoked', version: existing.version + 1,
    updatedAt: input.revokedAt, revokedAt: input.revokedAt }
  const feedback: ReaderFeedbackSettings = { schemaVersion: 1, revision: current.revision + 1,
    items: current.items.map((item) => item.id === input.id ? revoked : item) }
  return { settingsJson: writeReaderFeedbackSettings(currentRaw, feedback), feedback, changed: true, item: revoked }
}

function sourceState(item: ReaderFeedbackItem, sources: Record<string, string>): ReaderFeedbackSourceState | null {
  if (item.status === 'revoked') return 'revoked'
  const key = String(item.source.chapterId)
  if (!Object.prototype.hasOwnProperty.call(sources, key)) return 'source_deleted'
  const content = sources[key]
  if (stableHash(content) !== item.source.contentHash
    || stableHash(content.slice(item.source.start, item.source.end)) !== item.source.excerptHash) return 'source_changed'
  return null
}

function scopeApplies(item: ReaderFeedbackItem, target: ReaderFeedbackTargetContext): boolean {
  switch (item.scope.type) {
    case 'book': return true
    case 'passage': return item.source.chapterId === target.chapterId
    case 'scene': return item.source.chapterId === target.chapterId && (target.sceneOrders || []).includes(item.scope.sceneOrder)
    case 'character': {
      const scope = item.scope
      return (scope.characterId !== undefined && (target.characterIds || []).includes(scope.characterId))
        || Boolean(scope.characterName && (target.characterNames || []).some((name) => name === scope.characterName))
    }
  }
}

function specificity(item: ReaderFeedbackItem): number {
  return item.scope.type === 'passage' ? 4 : item.scope.type === 'scene' ? 3 : item.scope.type === 'character' ? 2 : 1
}

export function resolveReaderFeedbackForContext(
  settings: ReaderFeedbackSettings,
  target: ReaderFeedbackTargetContext,
): ResolvedReaderFeedback {
  const limit = Number.isSafeInteger(target.limit) && Number(target.limit) > 0 ? Number(target.limit) : DEFAULT_SELECTION_LIMIT
  const states = new Map<string, ReaderFeedbackSourceState>()
  const eligible = settings.items.filter((item) => {
    if (item.novelId !== target.novelId) {
      states.set(item.id, 'out_of_scope')
      return false
    }
    const invalidSource = sourceState(item, target.sourceContentsByChapterId)
    if (invalidSource) {
      states.set(item.id, invalidSource)
      return false
    }
    if (!scopeApplies(item, target)) {
      states.set(item.id, 'out_of_scope')
      return false
    }
    return true
  }).sort((left, right) => specificity(right) - specificity(left)
    || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  const seenFingerprints = new Set<string>()
  const deduplicated = eligible.filter((item) => {
    const fingerprint = feedbackFingerprint(item)
    if (seenFingerprints.has(fingerprint)) {
      states.set(item.id, 'duplicate')
      return false
    }
    seenFingerprints.add(fingerprint)
    return true
  })
  const selected = deduplicated.slice(0, limit)
  selected.forEach((item) => states.set(item.id, 'selected'))
  deduplicated.slice(limit).forEach((item) => states.set(item.id, 'omitted_limit'))

  const conflictBuckets = new Map<string, ReaderFeedbackItem[]>()
  selected.forEach((item) => {
    const key = `${feedbackScopeKey(item)}:${item.topic.toLocaleLowerCase()}`
    conflictBuckets.set(key, [...(conflictBuckets.get(key) || []), item])
  })
  const conflicts = [...conflictBuckets.entries()].flatMap(([key, items]) => {
    if (new Set(items.map((item) => item.sentiment)).size < 2) return []
    return [{ scopeKey: key.slice(0, key.lastIndexOf(':')), topic: items[0].topic, itemIds: items.map((item) => item.id) }]
  })
  const stateList = settings.items.map((item) => ({ id: item.id, state: states.get(item.id) || 'out_of_scope' }))
  const omittedCount = stateList.filter((entry) => entry.state !== 'selected').length
  return {
    settingsRevision: settings.revision,
    selected,
    states: stateList,
    conflicts,
    omittedCount,
    diagnostics: [
      ...(conflicts.length > 0 ? [`有 ${conflicts.length} 组同范围同主题反馈方向相反，已并列保留，等待作者取舍。`] : []),
      ...(stateList.some((entry) => entry.state === 'source_changed') ? ['部分反馈来源已变化，未注入。'] : []),
      ...(stateList.some((entry) => entry.state === 'source_deleted') ? ['部分反馈来源已删除，未注入。'] : []),
      ...(stateList.some((entry) => entry.state === 'revoked') ? ['已撤销反馈保留记录但未注入。'] : []),
      ...(stateList.some((entry) => entry.state === 'duplicate') ? ['重复反馈已合并，本次只注入一次。'] : []),
      ...(stateList.some((entry) => entry.state === 'omitted_limit') ? [`反馈超过单次 ${limit} 条上限，较低相关项未注入。`] : []),
    ],
  }
}

export function createReaderFeedbackSourceRef(content: string, chapterId: number, start: number, end: number): ReaderFeedbackSourceRef {
  if (!isPositiveInteger(chapterId) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > content.length) throwReaderFeedbackError('RF_FEEDBACK_INVALID_SELECTION')
  return { chapterId, contentHash: stableHash(content), start, end, excerptHash: stableHash(content.slice(start, end)) }
}

export function readerFeedbackSettingsDigest(settings: ReaderFeedbackSettings): string {
  return stableHash(stableSerialize(settings))
}
