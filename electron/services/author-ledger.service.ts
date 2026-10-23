import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { AuthorLibraryError } from './author-library-error'
import { getSqlite } from '../database/db'
import { getNovel } from './novel.service'
import { readAtlasRecords } from '../database/story-atlas-store'
import { applyStoryAtlasChanges } from './story-atlas.service'
import { readAuthorProtection, validateProtectedFields } from './author-protection'
import { listForeshadowLedger, upsertForeshadowLedger } from './endgame-asset.service'
import { CLUE_STATUSES } from '../../src/shared/author-ledger'
import type { StoryAtlasEntity } from '../../src/shared/story-atlas'

function requireVersion(novelId: number, version: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new AuthorLibraryError(formatUserFacingMessage('author.project.notFound'))
  if (novel.contextVersion !== version) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.contextChanged'))
}
export function getAuthorLedger(novelId: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new AuthorLibraryError(formatUserFacingMessage('author.project.notFound'))
  const allClues = listForeshadowLedger(novelId, { readOnly: true, includeMerged: true })
  const clues = allClues.filter(clue => !clue.mergedIntoId)
  const normalize = (title: string) => title.normalize('NFKC').replace(/[\s\p{P}]/gu, '').toLocaleLowerCase()
  const duplicateGroups = [...new Set(clues.map(item => normalize(item.title)))].map(title => clues.filter(item => normalize(item.title) === title).map(item => item.id)).filter(ids => ids.length > 1)
  const characters = readAtlasRecords(getSqlite(), novelId).filter(item => !item.retired && item.record.kind === 'character').map(item => ({ entity: item.record as StoryAtlasEntity, protectedFields: readAuthorProtection(getSqlite(), novelId, item.record.id)?.fields || [] }))
  const threads = getSqlite().prepare('SELECT id,related_character_ids_json FROM story_threads WHERE novel_id=?').all(novelId) as Array<{ id: number; related_character_ids_json: string | null }>
  const related = new Map(threads.map(thread => {
    let ids: unknown = []
    try { ids = JSON.parse(thread.related_character_ids_json || '[]') } catch { /* An old malformed reference never creates a new character. */ }
    const names = Array.isArray(ids) ? ids.map(id => characters.find(item => item.entity.id === String(id) || item.entity.id === `character:${id}`)?.entity.name).filter((name): name is string => Boolean(name)) : []
    return [thread.id, names] as const
  }))
  return { contextVersion: novel.contextVersion, clues: clues.map(clue => ({ ...clue, relatedCharacters: clue.linkedThreadId ? related.get(clue.linkedThreadId) || [] : [] })), mergedClues: allClues.filter(clue => clue.mergedIntoId), duplicateGroups, characters }
}
export function correctAuthorCharacter(input: { novelId: number; entityId: string; expectedContextVersion: number; effectiveFromChapter: number; name: string; origin: string; abilityLimits: string; protectedFields: string[]; note: string; idempotencyKey: string }) {
  validateProtectedFields(input.protectedFields)
  if (!input.note.trim() || input.note.length > 1200 || input.origin.length > 2000 || input.abilityLimits.length > 2000) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.invalidCorrection'))
  const entity = readAtlasRecords(getSqlite(), input.novelId, input.effectiveFromChapter).find(item => !item.retired && item.record.id === input.entityId)?.record
  if (!entity || entity.kind !== 'character') throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.characterNotVisible'))
  return applyStoryAtlasChanges({ novelId: input.novelId, expectedContextVersion: input.expectedContextVersion, idempotencyKey: input.idempotencyKey, effectiveFromChapter: input.effectiveFromChapter,
    source: { kind: 'author_correction', note: input.note }, changes: [{ op: 'upsert_entity', id: entity.id, kind: 'character', name: input.name, attributes: { origin: input.origin, abilityLimits: input.abilityLimits } }] },
  { authorCorrections: { [entity.id]: input.protectedFields } })
}
export function correctAuthorClue(input: { novelId: number; expectedContextVersion: number; id: number; title: string; detail: string; status: string; sourceChapterId: number | null; targetPayoffChapter: number | null; actualPayoffChapterId: number | null; requiredEvidence: string }) {
  return getSqlite().transaction(() => {
    requireVersion(input.novelId, input.expectedContextVersion)
    if (!input.title.trim() || input.title.length > 200 || input.detail.length > 4000 || input.requiredEvidence.length > 2000) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.invalidClueFields'))
    if (input.targetPayoffChapter !== null && (!Number.isSafeInteger(input.targetPayoffChapter) || input.targetPayoffChapter < 1)) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.invalidPayoffChapter'))
    const current = listForeshadowLedger(input.novelId, { readOnly: true }).find(item => item.id === input.id)
    if (!current) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.wrongProject'))
    if (!CLUE_STATUSES.some(item => item.value === input.status) && current.status !== input.status) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.invalidClueStatus'))
    for (const chapterId of [input.sourceChapterId, input.actualPayoffChapterId]) {
      if (chapterId !== null && !getSqlite().prepare('SELECT 1 FROM chapters WHERE novel_id=? AND id=?').get(input.novelId, chapterId)) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.chapterWrongProject'))
    }
    if (input.status === 'resolved' && (!input.actualPayoffChapterId || !input.requiredEvidence.trim())) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.payoffEvidenceRequired'))
    if (input.status !== 'resolved' && input.actualPayoffChapterId) throw new AuthorLibraryError(formatUserFacingMessage('author.ledger.payoffStatusRequired'))
    upsertForeshadowLedger(input.novelId, input, { authorCorrection: true })
    return getAuthorLedger(input.novelId)
  })()
}
