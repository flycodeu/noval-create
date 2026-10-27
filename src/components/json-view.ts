const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|client[_-]?secret)$/i

export function prepareJsonView(raw?: string | null) {
  const text = raw || ''
  // Do not fall back to unmasked source when bounded parsing is skipped.
  if (text.length > 1_000_000) return { structured: false as const, text: '内容超过 1 MB，已停止预览；原始记录仍保留。' }
  try {
    const value: unknown = JSON.parse(text, (key, item: unknown) => SECRET_KEY.test(key) && item ? '[已隐藏]' : item)
    if (value === null || typeof value !== 'object') return { structured: false as const, text }
    return { structured: true as const, value, text: JSON.stringify(value, null, 2) }
  } catch { return { structured: false as const, text } }
}
