import { AuthorLibraryError } from './author-library-error'
import type Database from 'better-sqlite3'
import { AUTHOR_PROTECTED_FIELDS, type AuthorProtectedField } from '../../src/shared/author-ledger'
import type { StoryAtlasEntity } from '../../src/shared/story-atlas'

export function validateProtectedFields(fields: string[]): asserts fields is AuthorProtectedField[] {
  if (!Array.isArray(fields) || fields.length > 3 || fields.some(field => !AUTHOR_PROTECTED_FIELDS.some(item => item.value === field))) throw new AuthorLibraryError('只能保护姓名、出身和能力边界。')
}
export function readAuthorProtection(sqlite: Database.Database, novelId: number, recordId: string) {
  const row = sqlite.prepare('SELECT author_protection_json,snapshot_json FROM story_atlas_revisions WHERE novel_id=? AND record_id=? ORDER BY id DESC LIMIT 1').get(novelId, recordId) as { author_protection_json: string; snapshot_json: string } | undefined
  return row ? { fields: JSON.parse(row.author_protection_json || '[]') as AuthorProtectedField[], record: JSON.parse(row.snapshot_json) as StoryAtlasEntity } : undefined
}
export function protectedValue(record: StoryAtlasEntity, field: AuthorProtectedField): unknown {
  return field === 'name' ? record.name : record.attributes[field.slice(11)] ?? null
}
