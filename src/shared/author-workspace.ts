export const AUTHOR_WORKSPACE_PAGES = [
  { key: 'guide', label: '创作台', description: '提出要求，查看 AI 推进与待讨论事项。', route: 'guide' },
  { key: 'story-design', label: '故事设计', description: '故事的方向、约束与章节安排。', route: 'story-design' },
  { key: 'narrative-board', label: '世界与人物', description: '探索地点、人物关系和发生的事件。', route: 'narrative-board' },
  { key: 'writing', label: '正文', description: '阅读、修改与评审章节。', route: 'writing/editor' },
  { key: 'revision', label: '版本与问题', description: '查看候选、审校结果和历史版本。', route: 'revision' },
] as const

export type AuthorWorkspaceKey = typeof AUTHOR_WORKSPACE_PAGES[number]['key']
const WORLD_ROUTES = new Set(['world-rules', 'map', 'narrative-board', 'characters', 'arc-center', 'resistance', 'factions', 'items', 'glossary', 'growth-system'])
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
