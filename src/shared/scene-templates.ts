export type SceneTemplateCategory =
  | 'conflict'
  | 'transition'
  | 'revelation'
  | 'bonding'
  | 'crisis'
  | 'climax'

export function parseSceneTemplateStringList(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

export function stringifySceneTemplateStringList(values: string[]): string {
  return JSON.stringify(values.map((value) => value.trim()).filter(Boolean))
}
