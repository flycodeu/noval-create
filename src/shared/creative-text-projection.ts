/** Saved portrait media and image prompts do not belong in text-generation or review windows. */
export function creativeTextProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(creativeTextProjection)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^portrait(?:Image|Prompt|GeneratedAt|ModelId)$/iu.test(key))
    .map(([key, item]) => [key, creativeTextProjection(item)]))
}
