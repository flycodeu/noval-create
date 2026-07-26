/**
 * 节奏模板接线服务。
 *
 * 内置节奏模板是纯 TS 常量（src/shared/rhythm-templates.ts），不 seed 进 templates 表；
 * 本服务负责三件事：
 * 1. 按题材列出可用模板（IPC rhythm:listTemplates）；
 * 2. 把模板 key 挂到 story_arcs.rhythm_template_key（IPC rhythm:attachToArc）；
 * 3. 把弧上的模板物化成 prompt 段——弧级全节拍段（章节细纲规划用）与
 *    单章节拍段（章节流水线 planner 用）。
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { genres, novels, storyArcs } from '../database/schema'
import {
  buildRhythmConstraintSection,
  findRhythmBeatForChapter,
  getRhythmTemplateByKey,
  listRhythmTemplatesForGenre,
  type RhythmTemplate,
} from '../../src/shared/rhythm-templates'
import { markNovelContextChanged } from './context-impact.service'
import { throwUserFacingError } from '../utils/user-facing-error'

export interface RhythmTemplateOption {
  key: string
  name: string
  scope: RhythmTemplate['scope']
  summary: string
  beatCount: number
  checklist: string[]
  genreHints: string[]
}

/** 只暴露 UI/prompt 需要的轻量字段，避免整份 beats 结构进渲染层。 */
export function toRhythmTemplateOption(template: RhythmTemplate): RhythmTemplateOption {
  return {
    key: template.key,
    name: template.name,
    scope: template.scope,
    summary: template.summary,
    beatCount: template.beats.length,
    checklist: template.checklist,
    genreHints: template.genreHints,
  }
}

export function listRhythmTemplates(genreName?: string | null): RhythmTemplateOption[] {
  return listRhythmTemplatesForGenre(genreName).map(toRhythmTemplateOption)
}

export function listRhythmTemplatesForNovel(novelId: number): RhythmTemplateOption[] {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  const genre = novel.genreId
    ? db.select().from(genres).where(eq(genres.id, novel.genreId)).all()[0]
    : null
  return listRhythmTemplates(genre?.name || null)
}

export function attachRhythmTemplateToArc(arcId: number, templateKey: string | null): void {
  const normalizedKey = typeof templateKey === 'string' && templateKey.trim() ? templateKey.trim() : null
  if (normalizedKey && !getRhythmTemplateByKey(normalizedKey)) {
    throwUserFacingError('rhythm.templateNotFound')
  }

  const db = getDb()
  const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
  if (!arc) throwUserFacingError('storyArc.notFound')

  db.update(storyArcs).set({ rhythmTemplateKey: normalizedKey }).where(eq(storyArcs.id, arcId)).run()
  markNovelContextChanged(arc.novelId, 'Story outline changed')
}

export interface RhythmArcLike {
  rhythmTemplateKey?: string | null
  chapterStart?: number | null
  chapterEnd?: number | null
}

function resolveArcRhythm(arc: RhythmArcLike | null | undefined): {
  template: RhythmTemplate
  chapterStart: number
  chapterEnd: number
} | null {
  if (!arc?.rhythmTemplateKey) return null
  const template = getRhythmTemplateByKey(arc.rhythmTemplateKey)
  if (!template) return null
  const chapterStart = typeof arc.chapterStart === 'number' ? arc.chapterStart : null
  const chapterEnd = typeof arc.chapterEnd === 'number' ? arc.chapterEnd : null
  if (!chapterStart || !chapterEnd || chapterEnd < chapterStart) return null
  return { template, chapterStart, chapterEnd }
}

/** 弧级节奏段：模板全部节拍换算成本弧具体章节区间（章节细纲规划 prompt 用）。 */
export function buildArcRhythmSection(arc: RhythmArcLike | null | undefined): string {
  const resolved = resolveArcRhythm(arc)
  if (!resolved) return ''
  return buildRhythmConstraintSection(resolved.template, {
    chapterStart: resolved.chapterStart,
    chapterEnd: resolved.chapterEnd,
  })
}

/** 单章节奏段：定位本章落在哪个节拍，只输出该节拍的目标/必须落地/禁止（planner prompt 用）。 */
export function buildChapterRhythmSection(arc: RhythmArcLike | null | undefined, chapterNum: number): string {
  const resolved = resolveArcRhythm(arc)
  if (!resolved) return ''
  const beat = findRhythmBeatForChapter(resolved.template, {
    chapterStart: resolved.chapterStart,
    chapterEnd: resolved.chapterEnd,
  }, chapterNum)
  if (!beat) return ''
  return [
    `【节奏模板 · ${resolved.template.name}】第${chapterNum}章处于「${beat.phase}」节拍（张力:${beat.tensionLevel}）。`,
    `本拍目标：${beat.goal}`,
    beat.requiredBeats.length > 0 ? `必须落地：${beat.requiredBeats.join('；')}` : '',
    beat.forbidden.length > 0 ? `禁止：${beat.forbidden.join('；')}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * 章节流水线 planner 注入口：按 arcId（或章节号落区兜底）取弧，弧挂了模板则输出单章节拍段。
 * 节奏传导是增强项，任何查询失败都静默降级为空串，绝不阻塞正文生成。
 */
export function getChapterRhythmSection(novelId: number, chapterNum: number, arcId?: number | null): string {
  try {
    const db = getDb()
    let arc: typeof storyArcs.$inferSelect | null = null
    if (arcId) {
      arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0] || null
    }
    if (!arc) {
      arc = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
        .find((row) => typeof row.chapterStart === 'number' && typeof row.chapterEnd === 'number'
          && chapterNum >= row.chapterStart && chapterNum <= row.chapterEnd) || null
    }
    if (!arc) return ''
    return buildChapterRhythmSection(arc, chapterNum)
  } catch {
    return ''
  }
}
