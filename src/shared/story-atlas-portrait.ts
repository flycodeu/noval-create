/** Small embedded portraits travel with backups and atlas revisions without remote file dependencies. */
export const ATLAS_PORTRAIT_MAX_LENGTH = 12000
export const ATLAS_PORTRAIT_PATTERN = '^data:image/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
export function atlasPortraitImage(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= ATLAS_PORTRAIT_MAX_LENGTH && new RegExp(ATLAS_PORTRAIT_PATTERN).test(value) ? value : undefined
}
