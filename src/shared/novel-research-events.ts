export const NOVEL_RESEARCH_CHANGED_CHANNEL = 'novel:research-changed'

export interface NovelResearchChangedEvent { novelId: number }

export function parseNovelResearchChangedEvent(value: unknown): NovelResearchChangedEvent | null {
  if (!value || typeof value !== 'object' || !('novelId' in value)) return null
  const novelId = value.novelId
  return typeof novelId === 'number' && Number.isSafeInteger(novelId) && novelId > 0 ? { novelId } : null
}
