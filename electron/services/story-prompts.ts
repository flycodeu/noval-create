import {
  buildStoryArcPlanningPrompt as rawBuildStoryArcPlanningPrompt,
  buildChapterOutlinePlanningPrompt as rawBuildChapterOutlinePlanningPrompt,
  buildTimelineEventsPrompt as rawBuildTimelineEventsPrompt,
  buildScenePlanPrompt as rawBuildScenePlanPrompt,
  buildChapterDraftPrompt as rawBuildChapterDraftPrompt,
  buildChapterWritingPrompt as rawBuildChapterWritingPrompt,
  buildChapterReviewPrompt as rawBuildChapterReviewPrompt,
  buildChapterRewritePrompt as rawBuildChapterRewritePrompt,
  buildContinuityStatePrompt as rawBuildContinuityStatePrompt,
  type StoryArcPromptInput,
  type ChapterOutlinePromptInput,
  type TimelineEventPromptInput,
  type ScenePlanPromptInput,
  type ChapterWritingPromptInput,
  type ChapterReviewPromptInput,
  type ChapterRewritePromptInput,
  type ContinuityPromptInput,
} from '../../src/shared/prompt-library'
import { applyPromptOverride } from './prompt-override.service'

export type {
  StoryArcPromptInput,
  ChapterOutlinePromptInput,
  TimelineEventPromptInput,
  ScenePlanPromptInput,
  ChapterWritingPromptInput,
  ChapterReviewPromptInput,
  ChapterRewritePromptInput,
  ContinuityPromptInput,
}

function appendPromptSection(prompt: string, title: string, lines: string[]): string {
  const body = lines.map((line) => line.trim()).filter(Boolean).join('\n')
  if (!body) return prompt
  return `${prompt}\n\n【${title}】\n${body}`
}

function appendPromptText(prompt: string, text: string): string {
  const normalized = text.trim()
  if (!normalized) return prompt
  return `${prompt}\n\n${normalized}`
}

export function buildStoryArcPlanningPrompt(params: StoryArcPromptInput): string {
  const fallback = appendPromptSection(rawBuildStoryArcPlanningPrompt(params), '生产补充要求', [
    '- 故事弧不是展示概念，而是后续章节的事件生产线。',
    '- 每条弧线都要能回收到具体章节冲突、人物关系变化或资源代价，不要停在抽象主题。',
    '- 如果某段设计无法明显推动后续章节，就视为弱设计并主动压缩。',
  ])
  return applyPromptOverride('storyArcs', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterOutlinePlanningPrompt(params: ChapterOutlinePromptInput): string {
  const fallback = appendPromptSection(rawBuildChapterOutlinePlanningPrompt(params), '生产补充要求', [
    '- 章节细纲要优先保证读者能顺着看下去，再保证结构漂亮。',
    '- 每章至少明确一项推进、一项阻力和一个代价落点，避免只有概述没有事件。',
    '- 章节之间的钩子要自然，不要用空悬念硬吊读者。',
  ])
  return applyPromptOverride('chapterOutline', fallback, params as unknown as Record<string, unknown>)
}

export function buildTimelineEventsPrompt(params: TimelineEventPromptInput): string {
  const fallback = appendPromptSection(rawBuildTimelineEventsPrompt(params), '生产补充要求', [
    '- 时间轴事件必须能反向服务章节承接、人物状态追踪和读者理解，不要只做资料库条目。',
    '- 如果事件缺少主角动作、直接后果或后续遗留问题，就补足后再输出。',
  ])
  return applyPromptOverride('timelineEvents', fallback, params as unknown as Record<string, unknown>)
}

export function buildScenePlanPrompt(params: ScenePlanPromptInput): string {
  const fallback = appendPromptSection(rawBuildScenePlanPrompt(params), '生产补充要求', [
    '- 这份场景计划会直接进入 AI 主写流程，所以每段都必须可落成正文。',
    '- 先保证场景连贯、动作清楚、冲突具体，再考虑节奏和文气。',
    '- 场景说明用自然中文写，不要夹解释腔、策划黑话或翻译腔。',
  ])
  return applyPromptOverride('scenePlan', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterDraftPrompt(params: ChapterRewritePromptInput): string {
  const fallback = appendPromptSection(rawBuildChapterDraftPrompt(params), '生产补充要求', [
    '- 当前目标是交出可审校的初稿，不是一次性追求终稿腔调。',
    '- 先把事件、状态、关系、物品去向和代价写准，后续再精修语言。',
    '- 行文必须贴中文小说语感，不要露出提示词腔、翻译腔和说明书味。',
  ])
  return applyPromptOverride('chapterDraft', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterWritingPrompt(params: ChapterWritingPromptInput): string {
  const fallback = appendPromptSection(rawBuildChapterWritingPrompt(params), '生产补充要求', [
    '- 正文必须像给真实读者看的成稿，不要保留策划腔、提示词腔或解释腔。',
    '- 如果某个转折不能提高理解度或追读欲，就不要硬加。',
    '- 避免不合中文语境的搭配、书面翻译句式和为了显高级而生造的表达。',
  ])
  return applyPromptOverride('chapterWriting', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterReviewPrompt(params: ChapterReviewPromptInput): string {
  const fallback = appendPromptText(
    appendPromptSection(rawBuildChapterReviewPrompt(params), '补充审校要求', [
      '- coherence_risks 只写会让读者读乱的地方，例如指代不明、信息顺序失衡、情绪跳变、动机断层。',
      '- reader_hook_risks 只写会削弱追读意愿的问题，例如冲突太虚、转折太轻、结果无代价、悬念不成立。',
      '- human_language_repairs 只列最值得先改的 1 到 3 处生硬表达，尽量直接给出“原说法 -> 更自然说法”。',
      '- revision_brief 先讲承接和真实度，再讲语言和追读感。',
      '- 如果出现翻译腔、搭配不成立、伪文艺句或明显 AI 套话，要优先列进 language_risks 和 human_language_repairs。',
    ]),
    '只输出 JSON：{"summary":"总体判断","critical_fixes":["必改 1"],"continuity_risks":["连续性风险 1"],"context_drift_risks":["漂移风险 1"],"realism_risks":["真实度风险 1"],"coherence_risks":["连贯性风险 1"],"reader_hook_risks":["追读风险 1"],"language_risks":["语言风险 1"],"human_language_repairs":["原说法 -> 更自然说法"],"genre_hollowing_risks":["体裁空心化风险 1"],"missing_payoffs":["未落地伏笔 1"],"strengths":["优点 1"],"severity":"medium","rewrite_required":true,"revision_brief":"修订方向摘要"}',
  )
  return applyPromptOverride('chapterReview', fallback, params as unknown as Record<string, unknown>)
}

export function buildChapterRewritePrompt(params: ChapterRewritePromptInput): string {
  const fallback = appendPromptSection(rawBuildChapterRewritePrompt(params), '最终成稿补充要求', [
    '- 优先采纳审校里列出的关键修订、连贯性风险、追读风险和语言替换建议。',
    '- 目标是交付可入稿的最终版，不要留下明显模板腔、解释腔或人机味。',
  ])
  return applyPromptOverride('chapterRewrite', fallback, params as unknown as Record<string, unknown>)
}

export function buildContinuityStatePrompt(params: ContinuityPromptInput): string {
  const fallback = rawBuildContinuityStatePrompt(params)
  return applyPromptOverride('continuityState', fallback, params as unknown as Record<string, unknown>)
}
