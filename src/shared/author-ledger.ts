export const AUTHOR_PROTECTED_FIELDS = [
  { value: 'name', label: '姓名' },
  { value: 'attributes.origin', label: '出身' },
  { value: 'attributes.abilityLimits', label: '能力边界' },
] as const
export type AuthorProtectedField = typeof AUTHOR_PROTECTED_FIELDS[number]['value']
export interface AuthorClue {
  id: number; title: string; detail: string | null; status: string; targetPayoffChapter: number | null
  sourceChapterId: number | null; actualPayoffChapterId: number | null; requiredEvidence: string | null
  authorCorrectedAt: string | null; linkedThreadId: number | null; linkedEndgameCommitmentId: number | null
  relatedCharacters?: string[]
  mergedIntoId?: number | null
  mergeInfoJson?: string | null
}
export const CLUE_STATUSES = [{ value: 'draft', label: '待安排' }, { value: 'planted', label: '已埋下' }, { value: 'resolved', label: '已回收' }, { value: 'abandoned', label: '已放弃' }]
