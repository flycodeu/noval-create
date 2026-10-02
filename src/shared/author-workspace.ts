export const AUTHOR_WORKSPACE_PAGES = [
  { key: 'guide', label: '创作台', description: '提出要求，查看 AI 推进与待讨论事项。', route: 'guide' },
  { key: 'story-design', label: '故事设计', description: '故事的方向、约束与章节安排。', route: 'story-design' },
  { key: 'narrative-board', label: '世界与人物', description: '探索地点、人物关系和发生的事件。', route: 'narrative-board' },
  { key: 'writing', label: '正文', description: '阅读、修改与评审章节。', route: 'writing/editor' },
  { key: 'revision', label: '版本与问题', description: '查看候选、审校结果和历史版本。', route: 'revision' },
] as const

export type AuthorWorkspaceKey = typeof AUTHOR_WORKSPACE_PAGES[number]['key']
const WORLD_ROUTES = new Set(['map', 'narrative-board', 'characters', 'arc-center', 'resistance', 'factions', 'items', 'glossary', 'growth-system', 'timeline'])
const WRITING_ROUTES = new Set(['contracts', 'writing', 'writeback'])
const HISTORY_ROUTES = new Set(['revision', 'quality', 'batch-workbench'])

export function getAuthorWorkspaceKey(route: string): AuthorWorkspaceKey {
  const key = route.replace(/^\/novels\/\d+\//, '').split(/[/?#:]/)[0]
  if (key === 'guide' || key === 'stage-planner') return 'guide'
  if (WORLD_ROUTES.has(key)) return 'narrative-board'
  if (WRITING_ROUTES.has(key)) return 'writing'
  if (HISTORY_ROUTES.has(key)) return 'revision'
  return 'story-design'
}

export function chapterPositionLabel(atChapter: number | null | undefined) {
  return atChapter == null ? '全部已知设定' : `截至第 ${atChapter} 章`
}

const LEGACY_DESTINATIONS: Record<string, string> = {
  overview: 'story-design?section=background', 'project-brief': 'story-design?section=background',
  'core-settings': 'story-design?section=story', premise: 'story-design?section=story', endgame: 'story-design?section=story', threads: 'story-design?section=story',
  'theme-voice': 'story-design?section=style', 'style-lab': 'story-design?section=style',
  'world-rules': 'story-design?section=world', 'growth-system': 'story-design?section=world',
  outline: 'story-design?section=structure', structure: 'story-design?section=structure', 'volume-design': 'story-design?section=structure', contracts: 'story-design?section=structure', 'scene-templates': 'story-design?section=structure',
  'stage-planner': 'guide', map: 'narrative-board?view=locations', characters: 'narrative-board?view=characters&kind=character', 'arc-center': 'narrative-board?view=characters&kind=character', resistance: 'narrative-board?view=characters&kind=character',
  factions: 'narrative-board?kind=faction', items: 'narrative-board?kind=item', timeline: 'narrative-board?kind=event', glossary: 'narrative-board',
  writeback: 'writing/editor?panel=changes', 'writing/review': 'writing/editor?panel=review', 'writing/context': 'writing/editor?panel=arrangement', 'writing/history': 'writing/editor?panel=history',
  quality: 'revision?view=issues', 'batch-workbench': 'revision?view=runs', 'foreshadow-ledger': 'story-design?section=story', 'info-gap-board': 'story-design?section=story',
}

export function resolveAuthorWorkspaceRoute(route: string, search = ''): string | null {
  const destination = LEGACY_DESTINATIONS[route]
  if (!destination) return null
  const [path, defaults] = destination.split('?')
  const params = new URLSearchParams(search)
  new URLSearchParams(defaults).forEach((value, key) => params.set(key, value))
  return `${path}${params.size ? `?${params}` : ''}`
}
