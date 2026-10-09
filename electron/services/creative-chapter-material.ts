import type { ContextPackSource } from '../../src/shared/context-pack'

/** Drop only exact duplicate aliases; differing segment constraints remain intact. */
export function compactChapterScenes<T extends object>(scenes: T[]): Record<string, unknown>[] {
  return scenes.map(scene => {
    const result: Record<string, unknown> = Object.fromEntries(Object.entries(scene))
    for (const [primary, alias] of [['sceneGoal', 'segmentPurpose'], ['resultState', 'segmentOutputState']]) {
      if (typeof result[primary] === 'string' && result[primary] !== '' && result[primary] === result[alias]) delete result[alias]
    }
    return result
  })
}

/** Select causal/character material before incidental prose; this never sets reading order. */
export function chapterMaterialPriority(source: Pick<Partial<ContextPackSource>, 'key' | 'sourceKind' | 'start' | 'end'>, previousLength = 0): number {
  const key = source.key || ''
  if (key.startsWith('fact:')) return 120
  // Keep the immediate handoff before optional setting detail, without making it a hard budget gate.
  if (source.sourceKind === 'previous_chapter_original') {
    const offset = source.end ?? source.start ?? 0
    if (previousLength > 0 && offset > Math.max(0, previousLength - 1000)) return 110
    return 20 + (previousLength > 0 ? Math.min(1, offset / previousLength) : 0)
  }
  if (/^(?:characters?:|relation:)/u.test(key)) return 100
  if (/^(?:voice:|world_rules:|writing_rules:|premise:|story_design:)/u.test(key)) return 80
  if (key.startsWith('author_reference:')) return 60
  if (source.sourceKind === 'recalled_chapter_original') return 40
  return 70
}
