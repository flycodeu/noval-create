import type { CreativeResearchDraft, CreativeResearchEntry } from './creative-research'
import { normalizeCreativeResearchDraft } from './creative-research'

export type PersonalResearchContent = Omit<CreativeResearchDraft, 'sourceKey' | 'novelConnection'> & Pick<CreativeResearchEntry, 'provenance'>
export interface PersonalResearchCard {
  id: string; revision: number; content: PersonalResearchContent; archived: boolean; createdAt: string; updatedAt: string
}

/** The project adaptation never belongs to the personal library. */
export function personalResearchContent(value: unknown): PersonalResearchContent {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const { category, title, content, interpretation, sourceTitle, sourceUrl, tags } = normalizeCreativeResearchDraft({ ...record, sourceKey: undefined, novelConnection: '个人资料' })
  return { category, title, content, interpretation, sourceTitle, sourceUrl, tags }
}
