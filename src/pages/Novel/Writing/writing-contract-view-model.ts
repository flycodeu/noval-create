import type { ContractPanelSection } from '../../../components/novel/writing/ContractPanel'
import type { Chapter, ChapterContractAudit, ChapterPublishCheck } from '../../../types'
import type { ScenePlanStep } from './parsers'

function compact(items: Array<string | false | null | undefined>): string[] {
  return items.filter((item): item is string => Boolean(item))
}

export function buildSceneContractSections(scenePlan: ScenePlanStep[]): ContractPanelSection[] {
  return scenePlan.slice(0, 6).map((scene) => ({
    key: `${scene.scene_order}-${scene.scene_title}`,
    title: `场景 ${String(scene.scene_order).padStart(2, '0')} · ${scene.scene_title}`,
    items: compact([
      scene.purpose ? `目的：${scene.purpose}` : '',
      scene.location ? `地点：${scene.location}` : '',
      scene.time_anchor ? `时间：${scene.time_anchor}` : '',
      scene.present_characters?.length ? `人物：${scene.present_characters.join('、')}` : '',
      scene.key_items?.length ? `道具：${scene.key_items.join('、')}` : '',
      scene.must_cover?.length ? `必须覆盖：${scene.must_cover.join('、')}` : '',
      scene.climax_variant ? `高潮变体：${scene.climax_variant}` : '',
    ]),
    tone: 'soft',
  }))
}

export interface ChapterContractSectionInput {
  chapter: Chapter | null
  scenePlan: ScenePlanStep[]
  activeThreads: string[]
  dueForeshadowItems: string[]
  truthRevealOverLimit: boolean
  staleReasons: string[]
  publishCheck: ChapterPublishCheck | null
  contractAudit: ChapterContractAudit | null
}

function buildForbiddenItems(input: ChapterContractSectionInput): string[] {
  return compact([
    input.truthRevealOverLimit ? '当前卷真相揭示比例超限，避免提前泄露关键真相。' : '',
    ...input.staleReasons.map((item) => `上下文未同步：${item}`),
    ...(input.publishCheck?.checklist || [])
      .filter((item) => item.status === 'blocker' || item.status === 'rewrite')
      .slice(0, 4)
      .map((item) => `${item.label}：${item.detail}`),
  ])
}

function buildAcceptanceItems(input: ChapterContractSectionInput): string[] {
  return compact([
    input.contractAudit?.summary ? `合同对账：${input.contractAudit.summary}` : '',
    ...(input.contractAudit?.items || []).slice(0, 4).map((item) => `${item.label}：${item.detail}`),
    ...(input.publishCheck?.contractValidation?.rewriteHints || []).slice(0, 3).map((item) => `补齐：${item}`),
  ])
}

export function buildChapterContractSections(input: ChapterContractSectionInput): ContractPanelSection[] {
  const chapter = input.chapter
  return [
    {
      key: 'goal',
      title: '本章目标',
      items: compact([
        chapter?.summary ? `摘要：${chapter.summary}` : '',
        chapter?.outline ? `大纲：${chapter.outline}` : '',
        chapter?.targetWords ? `篇幅参考：${chapter.targetWords} 字（弹性）` : '',
        chapter?.nextChapterSeed ? `下一章接力：${chapter.nextChapterSeed}` : '',
      ]),
      tone: 'soft',
    },
    {
      key: 'scene-list',
      title: '场景列表',
      items: input.scenePlan.map((scene) => `${scene.scene_title} · ${scene.purpose}`),
    },
    {
      key: 'threads',
      title: '必须推进的线程',
      items: input.activeThreads.slice(0, 6),
    },
    {
      key: 'foreshadow',
      title: '必须服务的伏笔',
      items: input.dueForeshadowItems.slice(0, 6),
    },
    {
      key: 'forbidden',
      title: '禁止事项',
      items: buildForbiddenItems(input),
      tone: 'danger',
    },
    {
      key: 'acceptance',
      title: '验收标准',
      items: buildAcceptanceItems(input),
    },
  ]
}
