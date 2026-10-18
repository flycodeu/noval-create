import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import type { AgentToolJsonSchema as Schema } from '../../src/shared/tool-contracts'
import { validateJsonSchema } from '../../src/shared/tool-contracts'
import { getSqlite } from '../database/db'
import { readAtlasRecords } from '../database/story-atlas-store'
import { getChapter, listChapters } from './chapter.service'
import { listSceneContracts } from './endgame-asset.service'
import { createStoryFact, listStoryFacts, updateStoryFact } from './story-fact.service'
import { markNovelContextChanged } from './context-impact.service'
import { matchesCreativeEvidenceQuote } from './creative-evidence-quote'

const text: Schema = { type: 'string', minLength: 1, maxLength: 12000 }
const id: Schema = { type: 'integer', minimum: 1 }
export const CREATIVE_FACT_PLANS_SCHEMA: Schema = { type: 'array', maxItems: 50, items: {
  type: 'object', additionalProperties: false, required: ['title', 'summary'], properties: {
    id, clientId: { type: 'string', minLength: 1, maxLength: 200 }, title: { ...text, maxLength: 200 }, summary: text,
    kind: { enum: ['puzzle', 'clue', 'truth', 'red_herring'] }, relatedPuzzleId: { anyOf: [id, { type: 'string', minLength: 1 }] },
    plannedRevealChapterNum: id, plannedRevealVolume: id, forbiddenBeforeVolume: id, isKeyTruth: { type: 'boolean' },
    knownFromStartCharacterIds: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1 } }, notes: text,
  },
} }
export const CREATIVE_FACT_REVEALS_SCHEMA: Schema = { type: 'array', maxItems: 50, items: {
  type: 'object', additionalProperties: false, required: ['factId', 'characterIds', 'evidenceQuote'], properties: {
    factId: id, characterIds: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1 } }, evidenceQuote: { ...text, minLength: 4 },
  },
} }
type FactPlan = { id?: number; clientId?: string; title: string; summary: string; kind?: 'puzzle' | 'clue' | 'truth' | 'red_herring'; relatedPuzzleId?: number | string; plannedRevealChapterNum?: number; plannedRevealVolume?: number; forbiddenBeforeVolume?: number; isKeyTruth?: boolean; knownFromStartCharacterIds?: string[]; notes?: string }
export interface CreativeFactReveal { factId: number; characterIds: string[]; evidenceQuote: string }
interface Knowledge { characterId: number; knownChapterId: number | null; knownFromStart?: boolean; sourceArtifactId?: string; evidenceQuote?: string }
function knowledge(raw: string | null | undefined): Knowledge[] { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
function ids(raw: string | null | undefined): number[] { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
function characters(novelId: number, atChapter?: number) {
  return readAtlasRecords(getSqlite(), novelId, atChapter, false).filter(item => !item.retired && item.record.kind === 'character' && item.nativeId)
    .map(item => ({ id: item.record.id, nativeId: item.nativeId!, name: 'name' in item.record ? item.record.name : '', roleType: item.record.attributes.roleType }))
}
// Keep existing identities at the opening state while admitting confirmed first appearances.
function chapterCharacters(novelId: number, chapterNum: number) {
  const cast = new Map(characters(novelId, chapterNum - 1).map(character => [character.id, character]))
  for (const character of characters(novelId, chapterNum)) if (!cast.has(character.id)) cast.set(character.id, character)
  return cast
}
function schema(value: unknown, expected: Schema): void {
  const result = validateJsonSchema(value, expected)
  if (!result.valid) throw new Error(formatUserFacingMessage('services.facts.structureInvalid', { issues: `${result.issues.join('；')}` }))
}

export function queryCreativeFacts(novelId: number) {
  const cast = new Map(characters(novelId).map(character => [character.nativeId, character]))
  const chapterNums = new Map(listChapters(novelId).map(chapter => [chapter.id, chapter.chapterNum]))
  const sources = new Map((getSqlite().prepare("SELECT CAST(f.value AS INTEGER) AS factId,a.parent_artifact_id AS artifactId FROM artifacts a,json_each(a.content_json,'$.factIds') f WHERE a.novel_id=? AND a.kind='creative_commit' ORDER BY a.created_at,a.rowid").all(novelId) as Array<{ factId: number; artifactId: string }>).map(row => [row.factId, row.artifactId]))
  return listStoryFacts(novelId).map(fact => {
    return { id: fact.id, title: fact.title, summary: fact.summary, kind: fact.kind, status: fact.status,
      relatedPuzzleId: fact.relatedPuzzleId, isKeyTruth: Boolean(fact.isKeyTruth),
      plannedRevealChapterNum: fact.plannedRevealChapterNum ?? (fact.targetRevealChapterId ? chapterNums.get(fact.targetRevealChapterId) ?? null : null),
      plannedRevealVolume: fact.plannedRevealVolume, forbiddenBeforeVolume: fact.forbiddenBeforeVolume,
      readerKnownChapterId: fact.readerKnownChapterId, protagonistKnownChapterId: fact.protagonistKnownChapterId,
      characterKnowledge: knowledge(fact.characterKnowledgeJson).map(entry => ({ ...entry, characterId: cast.get(entry.characterId)?.id || null, nativeId: entry.characterId, knownFromStart: entry.knownFromStart === true && entry.knownChapterId === null })),
      sourceArtifactId: sources.get(fact.id) || null, notes: fact.notes || '',
    }
  })
}

export function validateCreativeFactPlans(novelId: number, raw: unknown): asserts raw is FactPlan[] {
  schema(raw, CREATIVE_FACT_PLANS_SCHEMA)
  const plans = raw as FactPlan[]
  const existing = listStoryFacts(novelId)
  const existingIds = new Set(existing.map(fact => fact.id))
  const cast = new Map(characters(novelId).map(character => [character.id, character]))
  const seen = new Set<string>(), clients = new Set<string>(), names = new Set<string>()
  for (const fact of plans) {
    if (!fact.title.trim() || !fact.summary.trim()) throw new Error(formatUserFacingMessage('services.facts.titleAndContentRequired'))
    if (fact.id && !existingIds.has(fact.id)) throw new Error(formatUserFacingMessage('services.facts.wrongProject'))
    const previous = fact.id ? existing.find(row => row.id === fact.id) : undefined
    if (previous && (previous.readerKnownChapterId || previous.protagonistKnownChapterId || knowledge(previous.characterKnowledgeJson).some(entry => entry.knownFromStart || entry.knownChapterId))
      && (previous.summary || '').trim() !== fact.summary.trim()) {
      throw new Error(formatUserFacingMessage('services.facts.revealedContentImmutable'))
    }
    if (fact.id && seen.has(String(fact.id))) throw new Error(formatUserFacingMessage('services.facts.duplicateUpdates'))
    if (fact.id) seen.add(String(fact.id))
    if (fact.clientId) { if (clients.has(fact.clientId)) throw new Error(formatUserFacingMessage('services.facts.duplicateClientId')); clients.add(fact.clientId) }
    if (names.has(fact.title.trim()) || existing.some(row => row.title.trim() === fact.title.trim() && row.id !== fact.id)) throw new Error(formatUserFacingMessage('services.facts.nameExists'))
    names.add(fact.title.trim())
    for (const characterId of fact.knownFromStartCharacterIds || []) {
      const character = cast.get(characterId)
      if (!character) throw new Error(formatUserFacingMessage('services.facts.initialKnowledgeCharacterInvalid'))
      const priorKnowledge = knowledge(previous?.characterKnowledgeJson).find(entry => entry.characterId === character.nativeId)
      if (priorKnowledge?.knownFromStart === true && priorKnowledge.knownChapterId === null) continue
      if (priorKnowledge?.knownChapterId || previous?.protagonistKnownChapterId && character.roleType === 'protagonist') {
        throw new Error(formatUserFacingMessage('services.facts.laterKnowledgeCannotBackfill'))
      }
    }
  }
  for (const fact of plans) if (fact.relatedPuzzleId !== undefined) {
    if (typeof fact.relatedPuzzleId === 'number' ? !existingIds.has(fact.relatedPuzzleId) || fact.relatedPuzzleId === fact.id : !clients.has(fact.relatedPuzzleId) || fact.relatedPuzzleId === fact.clientId) throw new Error(formatUserFacingMessage('services.facts.puzzleReferenceInvalid'))
  }
}

/** Called only inside the reviewed workflow commit transaction. Plans never set an observed chapter. */
export function applyCreativeFactPlans(novelId: number, raw: unknown, sourceArtifactId: string) {
  validateCreativeFactPlans(novelId, raw)
  const existing = new Map(listStoryFacts(novelId).map(fact => [fact.id, fact]))
  const cast = new Map(characters(novelId).map(character => [character.id, character]))
  const chapters = listChapters(novelId)
  const factIds: number[] = [], factIdMap: Record<string, number> = {}
  for (const plan of raw) {
    const previous = plan.id ? existing.get(plan.id) : undefined
    const known = new Map(knowledge(previous?.characterKnowledgeJson).map(entry => [entry.characterId, entry]))
    for (const characterId of plan.knownFromStartCharacterIds || []) {
      const character = cast.get(characterId)!
      if (known.get(character.nativeId)?.knownFromStart === true) continue
      known.set(character.nativeId, { characterId: character.nativeId, knownChapterId: null, knownFromStart: true, sourceArtifactId })
    }
    const patch = { title: plan.title.trim(), summary: plan.summary.trim(), ...(plan.kind ? { kind: plan.kind } : {}),
      ...(plan.plannedRevealVolume !== undefined ? { plannedRevealVolume: plan.plannedRevealVolume } : {}),
      ...(plan.forbiddenBeforeVolume !== undefined ? { forbiddenBeforeVolume: plan.forbiddenBeforeVolume } : {}),
      ...(plan.isKeyTruth !== undefined ? { isKeyTruth: plan.isKeyTruth } : {}),
      ...(plan.plannedRevealChapterNum !== undefined ? { plannedRevealChapterNum: plan.plannedRevealChapterNum, targetRevealChapterId: chapters.find(chapter => chapter.chapterNum === plan.plannedRevealChapterNum)?.id ?? null } : {}),
      characterKnowledgeJson: [...known.values()], ...(plan.notes !== undefined ? { notes: plan.notes } : {}),
    }
    const factId = plan.id || createStoryFact(novelId, patch, { skipContextTracking: true })
    if (plan.id) updateStoryFact(plan.id, patch, { skipContextTracking: true })
    factIds.push(factId)
    if (plan.clientId) factIdMap[plan.clientId] = factId
  }
  for (const [index, plan] of raw.entries()) if (plan.relatedPuzzleId !== undefined) updateStoryFact(factIds[index], { relatedPuzzleId: typeof plan.relatedPuzzleId === 'string' ? factIdMap[plan.relatedPuzzleId] : plan.relatedPuzzleId }, { skipContextTracking: true })
  return { factIds, factIdMap }
}

export function validateCreativeFactReveals(novelId: number, chapterNum: number, content: string, raw: unknown): asserts raw is CreativeFactReveal[] {
  schema(raw, CREATIVE_FACT_REVEALS_SCHEMA)
  const chapter = listChapters(novelId).find(row => row.chapterNum === chapterNum)
  if (!chapter) throw new Error(formatUserFacingMessage('services.facts.revealChapterPlanRequired'))
  const allowed = new Set(ids(chapter.allowedFactIdsJson)), required = new Set(ids(chapter.revealedFactIdsJson))
  const facts = new Map(listStoryFacts(novelId).map(fact => [fact.id, fact]))
  const cast = chapterCharacters(novelId, chapterNum)
  const scenes = listSceneContracts(chapter.id)
  const seen = new Set<number>()
  for (const reveal of raw as CreativeFactReveal[]) {
    const fact = facts.get(reveal.factId)
    if (!fact) throw new Error(formatUserFacingMessage('services.facts.revealWrongProject'))
    if (seen.has(fact.id)) throw new Error(formatUserFacingMessage('services.facts.duplicateReveals'))
    seen.add(fact.id)
    if (!allowed.has(fact.id) || !required.has(fact.id)) throw new Error(formatUserFacingMessage('services.facts.revealUnauthorized', { id: `${fact.id}` }))
    const quote = reveal.evidenceQuote.trim()
    if (!matchesCreativeEvidenceQuote(content, quote)) throw new Error(formatUserFacingMessage('services.facts.revealEvidenceMissing', { id: `${fact.id}` }))
    const authorizedScenes = scenes.filter(scene => scene.revealPayload.some(value => [`fact:${fact.id}`, `#${fact.id}`, fact.title, fact.summary].includes(value.trim())))
    if (!authorizedScenes.length) throw new Error(formatUserFacingMessage('services.facts.sceneRevealMissing', { id: `${fact.id}` }))
    if (new Set(reveal.characterIds).size !== reveal.characterIds.length) throw new Error(formatUserFacingMessage('services.facts.duplicateKnowledgeCharacters'))
    for (const characterId of reveal.characterIds) {
      const character = cast.get(characterId)
      if (!character) throw new Error(formatUserFacingMessage('services.facts.knowledgeCharacterInvalid'))
      if (!authorizedScenes.some(scene => scene.pov === character.name) && !quote.includes(character.name)) throw new Error(formatUserFacingMessage('services.facts.characterEvidenceMissing', { name: `${character.name}` }))
    }
  }
  for (const factId of required) if (!seen.has(factId)) throw new Error(formatUserFacingMessage('services.facts.plannedRevealEvidenceMissing', { id: `${factId}` }))
}

export function applyCreativeFactReveals(novelId: number, chapterId: number, content: string, reveals: CreativeFactReveal[], sourceArtifactId: string) {
  const chapter = getChapter(chapterId)
  if (!chapter || chapter.novelId !== novelId) throw new Error(formatUserFacingMessage('services.facts.revealChapterWrongProject'))
  validateCreativeFactReveals(novelId, chapter.chapterNum, content, reveals)
  const rows = listChapters(novelId), numbers = new Map(rows.map(row => [row.id, row.chapterNum]))
  const earlier = (old: number | null) => old && (numbers.get(old) ?? Infinity) <= chapter.chapterNum ? old : chapterId
  const cast = chapterCharacters(novelId, chapter.chapterNum)
  const facts = new Map(listStoryFacts(novelId).map(fact => [fact.id, fact]))
  for (const reveal of reveals) {
    const fact = facts.get(reveal.factId)!
    const known = new Map(knowledge(fact.characterKnowledgeJson).map(entry => [entry.characterId, entry]))
    for (const characterId of reveal.characterIds) {
      const character = cast.get(characterId)!, previous = known.get(character.nativeId)
      if (previous?.knownFromStart === true && previous.knownChapterId === null) continue
      if (previous?.knownChapterId && (numbers.get(previous.knownChapterId) ?? Infinity) < chapter.chapterNum) continue
      known.set(character.nativeId, { ...previous, characterId: character.nativeId, knownChapterId: earlier(previous?.knownChapterId ?? null), sourceArtifactId, evidenceQuote: reveal.evidenceQuote.trim() })
    }
    const protagonistLearned = reveal.characterIds.some(characterId => cast.get(characterId)?.roleType === 'protagonist')
    updateStoryFact(fact.id, { readerKnownChapterId: earlier(fact.readerKnownChapterId),
      ...(protagonistLearned ? { protagonistKnownChapterId: earlier(fact.protagonistKnownChapterId) } : {}),
      characterKnowledgeJson: [...known.values()], status: fact.status === 'explained' || fact.status === 'pending_payoff' ? fact.status : 'partial_reveal',
    }, { skipContextTracking: true })
  }
  if (reveals.length) markNovelContextChanged(novelId, 'Info gap board changed')
  return { revealedFactIds: reveals.map(reveal => reveal.factId) }
}
