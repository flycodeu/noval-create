import { COVER_MAX_LENGTH } from '../../shared/novel-cover'
import { getUserFacingMessage } from '../../utils/user-facing-message'

export async function importCover(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error(getUserFacingMessage('cover.invalidImage'))
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error(getUserFacingMessage('cover.invalidImage'))
    const scale = Math.min(1, 960 / bitmap.width, 1440 / bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error(getUserFacingMessage('cover.importFailed'))
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/jpeg', .88)
    if (result.length > COVER_MAX_LENGTH) throw new Error(getUserFacingMessage('cover.invalidImage'))
    return result
  } finally { bitmap.close() }
}
