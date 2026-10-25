import type { Chapter } from '../../../types'
import type { StoryAtlasEntity } from '../../../shared/story-atlas'
import { atlasTabFor, ATLAS_KIND_LABELS } from './atlas-profile'

export type WorkspaceSearchEntry = { key: string; label: string; category: string; route: string; searchText: string }
export function workspaceSearchEntries(chapters: Chapter[], entities: StoryAtlasEntity[]): WorkspaceSearchEntry[] {
  return [
    ...entities.map(entity => ({ key: entity.id, label: entity.name, category: `${ATLAS_KIND_LABELS[entity.kind]}${entity.status === 'planned' ? ' · 作者规划' : ''}`, route: `narrative-board?${new URLSearchParams({ tab: atlasTabFor(entity), entity: entity.id, ...(entity.status === 'planned' ? { includePlanned: 'true' } : {}) })}`, searchText: entity.name })),
    ...chapters.map(chapter => ({ key: `chapter:${chapter.id}`, label: chapter.title || '未命名', category: `第 ${chapter.chapterNum} 章`, route: `writing/editor?chapterId=${chapter.id}`, searchText: `${chapter.chapterNum} ${chapter.title}` })),
    ...[{ label: '世界规则', category: '规则与限制', route: 'narrative-board?tab=rules', terms: '种属 能力 代价 地域 生计 世界规则' },
      { label: '联网参考', category: '外部来源', route: 'narrative-board?tab=research', terms: '来源 联网 检索 参考资料 搜索 外部资料' },
      { label: '作者资料卡', category: '创作参考', route: 'story-design?section=sources', terms: '作者自建 灵感 创作资料 资料卡 世界观素材' },
      { label: '故事背景与定位', category: '故事设计', route: 'story-design?section=background', terms: '背景 简介 定位' },
      { label: '主线、支线与结局', category: '故事设计', route: 'story-design?section=story', terms: '主线 支线 结局 承诺 秘密' },
      { label: '全书卷章大纲', category: '故事大纲', route: 'outline', terms: '大纲 细纲 卷章 伏笔 情绪 关系 叙事线' },
      { label: '卷级时间线', category: '时间轴', route: 'timeline?view=volumes', terms: '时间轴 并行 多线 年月 回叙 行程' },
      { label: '叙事与文风', category: '故事设计', route: 'story-design?section=style', terms: '叙事 视角 文风' },
    ].map(item => ({ key: item.route, label: item.label, category: item.category, route: item.route, searchText: item.terms })),
  ]
}
