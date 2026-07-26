import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapterSegments, chapters, sceneContracts } from '../database/schema'
import type { SceneContractSeed } from './scene-plan-reconciliation'
import { asText, toStringArray } from './chapter-review-notes'

export interface ScenePlanStep {
  scene_order: number
  scene_title: string
  purpose: string
  location: string
  time_anchor: string
  present_characters: string[]
  key_items: string[]
  conflict: string
  beat: string
  must_cover: string[]
  climax_variant: string
  exit_hook: string
  // 设计维度（P1）：把场景从“陈述事件”推向“设计博弈”。
  hidden_agendas: string[]
  irony_gap: string
  audience: string
}

export function getDefaultChapterTitle(chapterNum: number): string {
  return `第${chapterNum}章`
}

export function extractChapterGoal(outline?: string | null): string {
  if (!outline) return ''
  const match = outline.match(/(?:^|\n)(?:目标|本章目标)[:：]?\s*(.+)/)
  if (match?.[1]) return match[1].trim()

  const firstLine = outline.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || ''
}

export function normalizeScenePlan(raw: unknown, fallback: ScenePlanStep[]): ScenePlanStep[] {
  if (!Array.isArray(raw)) return fallback

  const normalized = raw
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const purpose = asText(record.purpose)
      const beat = asText(record.beat)
      const title = asText(record.scene_title)
      if (!purpose && !beat && !title) return null

      return {
        scene_order: typeof record.scene_order === 'number' ? Math.round(record.scene_order) : index + 1,
        scene_title: title || `场景 ${index + 1}`,
        purpose,
        location: asText(record.location),
        time_anchor: asText(record.time_anchor),
        present_characters: toStringArray(record.present_characters),
        key_items: toStringArray(record.key_items),
        conflict: asText(record.conflict),
        beat,
        must_cover: toStringArray(record.must_cover),
        climax_variant: asText(record.climax_variant),
        exit_hook: asText(record.exit_hook),
        hidden_agendas: toStringArray(record.hidden_agendas),
        irony_gap: asText(record.irony_gap),
        audience: asText(record.audience),
      }
    })
    .filter((item): item is ScenePlanStep => Boolean(item))

  return normalized.length > 0 ? normalized : fallback
}

export function loadScenePlanContractSeeds(chapterId: number): SceneContractSeed[] {
  const db = getDb()
  const segments = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const contracts = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const contractBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  contracts.forEach((contract) => {
    if (typeof contract.segmentId === 'number' && !contractBySegmentId.has(contract.segmentId)) {
      contractBySegmentId.set(contract.segmentId, contract)
    }
  })

  const seeds = segments.map((segment, index) => {
    const contract = contractBySegmentId.get(segment.id)
    return {
      sceneOrder: typeof segment.segmentOrder === 'number' ? segment.segmentOrder : index + 1,
      sceneTitle: segment.title || `场景 ${index + 1}`,
      sceneGoal: contract?.sceneGoal || segment.purpose || '',
      location: contract?.timeLocation || '',
      obstacle: contract?.obstacle || '',
      conflictType: contract?.conflictType || '',
      resultState: contract?.resultState || segment.outputState || '',
    }
  })

  contracts
    .filter((contract) => contract.segmentId == null || !segments.some((segment) => segment.id === contract.segmentId))
    .forEach((contract, index) => {
      seeds.push({
        sceneOrder: segments.length + index + 1,
        sceneTitle: `场景合同 ${contract.id}`,
        sceneGoal: contract.sceneGoal || '',
        location: contract.timeLocation || '',
        obstacle: contract.obstacle || '',
        conflictType: contract.conflictType || '',
        resultState: contract.resultState || '',
      })
    })

  return seeds
}

export function buildFallbackScenePlan(chapter: typeof chapters.$inferSelect): ScenePlanStep[] {
  const outlineLines = (chapter.outline || '')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)

  const seeds = outlineLines.length > 0
    ? outlineLines
    : [extractChapterGoal(chapter.outline) || `完成${getDefaultChapterTitle(chapter.chapterNum)}的核心推进`]

  return seeds.map((line, index) => ({
    scene_order: index + 1,
    scene_title: `场景 ${index + 1}`,
    purpose: line,
    location: '',
    time_anchor: '',
    present_characters: [],
    key_items: [],
    conflict: '',
    beat: line,
    must_cover: [line],
    climax_variant: '',
    exit_hook: index === seeds.length - 1 ? '把本章推进到自然收束点。' : '把当前冲突继续推向下一段。',
    hidden_agendas: [],
    irony_gap: '',
    audience: '',
  }))
}

export function formatScenePlan(scenePlan: ScenePlanStep[]): string {
  return scenePlan
    .map((step) => {
      const parts = [
        `目标=${step.purpose}`,
        step.location ? `地点=${step.location}` : '',
        step.time_anchor ? `时间=${step.time_anchor}` : '',
        step.present_characters.length > 0 ? `人物=${step.present_characters.join('、')}` : '',
        step.key_items.length > 0 ? `物品=${step.key_items.join('、')}` : '',
        step.conflict ? `冲突=${step.conflict}` : '',
        step.hidden_agendas.length > 0 ? `各方心思=${step.hidden_agendas.join('；')}` : '',
        step.irony_gap ? `信息差(读者知/角色不知)=${step.irony_gap}` : '',
        step.audience ? `这场戏演给谁看=${step.audience}` : '',
        step.beat ? `动作=${step.beat}` : '',
        step.must_cover.length > 0 ? `必须交代=${step.must_cover.join('；')}` : '',
        step.climax_variant ? `高潮变体=${step.climax_variant}` : '',
        step.exit_hook ? `收尾=${step.exit_hook}` : '',
      ].filter(Boolean)
      return `${step.scene_order}. ${step.scene_title}\n${parts.join('\n')}`
    })
    .join('\n\n')
}
