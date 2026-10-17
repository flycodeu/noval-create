import type { StoryAtlasEntity } from '../../../shared/story-atlas'
import { ATLAS_PORTRAIT_MAX_LENGTH } from '../../../shared/story-atlas-portrait'
import { atlasFieldLabel } from './atlas-profile'
import { displayValue } from './atlas-presentation'
export { atlasPortraitImage } from '../../../shared/story-atlas-portrait'

export function buildAtlasPortraitPrompt(entity: StoryAtlasEntity): string {
  const fields = ['species', 'age', 'gender', 'occupation', 'appearance', 'clothing', 'carriedItems', 'physicalHabits']
    .filter(key => entity.attributes[key] != null && displayValue(entity.attributes[key]).trim())
    .map(key => `${atlasFieldLabel(key)}：${displayValue(entity.attributes[key])}`)
  return [`人物：${entity.name}`, ...fields, '单人角色参考像，清晰呈现脸部、服装材质和轮廓；不加文字和水印。', '只使用上述已定资料。未定的外貌、服饰、标志性物件先由作者确认；不将画面中的临时细节视为小说事实。'].join('\n')
}

export async function importAtlasPortrait(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。')
  if (file.size > 5 * 1024 * 1024) throw new Error('原始头像图片不能超过 5MB。')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('图片尺寸过大或无法读取，请选择较小的头像。')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法处理头像。')
    for (const edge of [320, 256, 192, 128]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.86, 0.7, 0.52]) {
        const encoded = canvas.toDataURL('image/webp', quality)
        if (encoded.length <= ATLAS_PORTRAIT_MAX_LENGTH) return encoded
      }
    }
    throw new Error('图片压缩后仍然过大，请选择更简洁的头像。')
  } finally { bitmap.close() }
}
