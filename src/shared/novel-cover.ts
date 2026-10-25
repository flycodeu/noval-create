import { formatUserFacingMessage } from './user-facing-messages'

// Two covers (candidate + compare value) must fit the existing 4 MiB web RPC limit.
export const COVER_MAX_LENGTH = 1_800_000
export const COVER_SIZES = ['1024x1536', '1024x1792', '1024x1024'] as const
export interface GenerateNovelCoverInput {
  configId: number
  modelId: string
  prompt: string
  size: typeof COVER_SIZES[number]
}
export interface SaveNovelCoverInput {
  image: string | null
  expectedCoverImage: string | null
}
export function isNovelCoverImage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= COVER_MAX_LENGTH
    && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
}
export function validateCoverRequest(value: GenerateNovelCoverInput): GenerateNovelCoverInput {
  if (!value || !Number.isSafeInteger(value.configId) || value.configId < 1
    || typeof value.modelId !== 'string' || !value.modelId.trim() || value.modelId.length > 200
    || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 6000
    || !COVER_SIZES.includes(value.size)) throw new Error(formatUserFacingMessage('cover.invalidRequest'))
  return { configId: value.configId, modelId: value.modelId.trim(), prompt: value.prompt.trim(), size: value.size }
}
export function buildCoverPrompt(title: string, synopsis?: string | null) {
  return `为小说《${title.slice(0, 100)}》绘制一张正式出版风格的封面插画。\n${synopsis?.trim() ? `故事氛围：${synopsis.trim().slice(0, 900)}\n` : ''}突出一个与故事有关的视觉意象，构图简洁，有空间感和叙事张力。竖版构图，上部留出排版空间。不要绘制书名、文字、水印或立体书模型。`
}
