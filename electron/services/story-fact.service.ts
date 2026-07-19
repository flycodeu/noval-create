import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { novels, storyFacts } from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'
import { throwUserFacingError } from '../utils/user-facing-error'

type StoryFactKind = 'puzzle' | 'clue' | 'truth' | 'red_herring'
type StoryFactStatus = 'introduced' | 'partial_reveal' | 'pending_payoff' | 'explained'

interface StoryFactCharacterKnowledge {
  characterId: number
  knownChapterId: number | null
}

interface StoryFactInput {
  volumeId?: number | null
  relatedPuzzleId?: number | null
  kind?: StoryFactKind
  title?: string
  summary?: string
  status?: StoryFactStatus
  readerKnownChapterId?: number | null
  protagonistKnownChapterId?: number | null
  characterKnowledgeJson?: string | StoryFactCharacterKnowledge[]
  forbiddenBeforeVolume?: number | null
  plannedRevealVolume?: number | null
  targetRevealChapterId?: number | null
  isKeyTruth?: number | boolean
  notes?: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function normalizeKind(value: unknown): StoryFactKind {
  const text = asText(value)
  if (text === 'puzzle' || text === 'truth' || text === 'red_herring') return text
  return 'clue'
}

function normalizeStatus(value: unknown): StoryFactStatus {
  const text = asText(value)
  if (text === 'partial_reveal' || text === 'pending_payoff' || text === 'explained') return text
  return 'introduced'
}

function normalizeFlag(value: unknown, fallback: 0 | 1): 0 | 1 {
  if (typeof value === 'boolean') return value ? 1 : 0
  const numeric = asNumber(value)
  if (numeric === 0 || numeric === 1) return numeric
  return fallback
}

function parseCharacterKnowledgeArray(raw: unknown): StoryFactCharacterKnowledge[] {
  if (!Array.isArray(raw)) return []
  const normalized: StoryFactCharacterKnowledge[] = []
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    const record = entry as Record<string, unknown>
    const characterId = asNumber(record.characterId)
    if (typeof characterId !== 'number' || characterId <= 0) return
    const knownChapterId = asNumber(record.knownChapterId)
    normalized.push({
      characterId,
      knownChapterId: typeof knownChapterId === 'number' && knownChapterId > 0 ? knownChapterId : null,
    })
  })
  const dedup = new Map<number, StoryFactCharacterKnowledge>()
  normalized.forEach((entry) => dedup.set(entry.characterId, entry))
  return [...dedup.values()]
}

function normalizeCharacterKnowledgeJson(raw: unknown): string {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return JSON.stringify(parseCharacterKnowledgeArray(parsed))
    } catch {
      return '[]'
    }
  }
  if (Array.isArray(raw)) {
    return JSON.stringify(parseCharacterKnowledgeArray(raw))
  }
  return '[]'
}

function sanitizeStoryFactPayload(
  input: StoryFactInput,
): Partial<typeof storyFacts.$inferInsert> {
  const next: Partial<typeof storyFacts.$inferInsert> = {}

  if ('volumeId' in input) next.volumeId = asNumber(input.volumeId)
  if ('relatedPuzzleId' in input) next.relatedPuzzleId = asNumber(input.relatedPuzzleId)
  if ('kind' in input) next.kind = normalizeKind(input.kind)
  if ('title' in input) next.title = asText(input.title)
  if ('summary' in input) next.summary = asText(input.summary)
  if ('status' in input) next.status = normalizeStatus(input.status)
  if ('readerKnownChapterId' in input) next.readerKnownChapterId = asNumber(input.readerKnownChapterId)
  if ('protagonistKnownChapterId' in input) next.protagonistKnownChapterId = asNumber(input.protagonistKnownChapterId)
  if ('characterKnowledgeJson' in input) next.characterKnowledgeJson = normalizeCharacterKnowledgeJson(input.characterKnowledgeJson)
  if ('forbiddenBeforeVolume' in input) next.forbiddenBeforeVolume = asNumber(input.forbiddenBeforeVolume)
  if ('plannedRevealVolume' in input) next.plannedRevealVolume = asNumber(input.plannedRevealVolume)
  if ('targetRevealChapterId' in input) next.targetRevealChapterId = asNumber(input.targetRevealChapterId)
  if ('isKeyTruth' in input) next.isKeyTruth = normalizeFlag(input.isKeyTruth, 1)
  if ('notes' in input) next.notes = asText(input.notes)

  return next
}

function ensureNovelExists(novelId: number) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  return novel
}

export function listStoryFacts(novelId: number) {
  ensureNovelExists(novelId)
  const db = getDb()
  return db.select().from(storyFacts)
    .where(eq(storyFacts.novelId, novelId))
    .orderBy(asc(storyFacts.kind), asc(storyFacts.id))
    .all()
}

export function getStoryFact(id: number) {
  const db = getDb()
  return db.select().from(storyFacts).where(eq(storyFacts.id, id)).all()[0] || null
}

export function createStoryFact(
  novelId: number,
  input: StoryFactInput,
  options: { skipContextTracking?: boolean } = {},
) {
  ensureNovelExists(novelId)
  const db = getDb()
  const payload = sanitizeStoryFactPayload(input)
  const result = db.insert(storyFacts).values({
    novelId,
    kind: normalizeKind(payload.kind),
    title: asText(payload.title) || '未命名信息点',
    summary: payload.summary || '',
    status: normalizeStatus(payload.status),
    volumeId: payload.volumeId ?? null,
    relatedPuzzleId: payload.relatedPuzzleId ?? null,
    readerKnownChapterId: payload.readerKnownChapterId ?? null,
    protagonistKnownChapterId: payload.protagonistKnownChapterId ?? null,
    characterKnowledgeJson: payload.characterKnowledgeJson || '[]',
    forbiddenBeforeVolume: payload.forbiddenBeforeVolume ?? null,
    plannedRevealVolume: payload.plannedRevealVolume ?? null,
    targetRevealChapterId: payload.targetRevealChapterId ?? null,
    isKeyTruth: normalizeFlag(payload.isKeyTruth, 1),
    notes: payload.notes || '',
  }).run()

  if (!options.skipContextTracking) markNovelContextChanged(novelId, 'Info gap board changed')
  return Number(result.lastInsertRowid)
}

export function updateStoryFact(
  id: number,
  input: StoryFactInput,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const current = db.select().from(storyFacts).where(eq(storyFacts.id, id)).all()[0]
  if (!current) throwUserFacingError('common.loadFailed')

  const payload = sanitizeStoryFactPayload(input)
  const patch: Partial<typeof storyFacts.$inferInsert> = {
    ...payload,
    updatedAt: new Date().toISOString(),
  }

  if ('title' in payload && !payload.title) {
    patch.title = current.title
  }

  db.update(storyFacts).set(patch).where(eq(storyFacts.id, id)).run()
  if (!options.skipContextTracking) markNovelContextChanged(current.novelId, 'Info gap board changed')
}

export function deleteStoryFact(id: number) {
  const db = getDb()
  const current = db.select().from(storyFacts).where(eq(storyFacts.id, id)).all()[0]
  if (!current) return
  db.delete(storyFacts).where(eq(storyFacts.id, id)).run()
  markNovelContextChanged(current.novelId, 'Info gap board changed')
}
