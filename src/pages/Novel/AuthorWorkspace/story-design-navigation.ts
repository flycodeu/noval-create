import type { Novel } from '../../../types'
import { buildProjectBriefPayload, type ProjectBriefDocument } from '../../../shared/project-brief'
import { buildStorySettingsPayload } from '../../../shared/story-settings'
import { buildThemeVoicePayload, type ThemeVoiceDocument } from '../../../shared/theme-voice'
import { mergeCanonicalDocument, parseDocument, recordOf } from './content-document'

export const STORY_DESIGN_TABS = [
  { key: 'background', label: '背景与定位' }, { key: 'story', label: '故事方向' },
  { key: 'world', label: '世界规则' }, { key: 'constraints', label: '写作边界' },
  { key: 'style', label: '叙事与文风' }, { key: 'structure', label: '卷章与场景' },
]

export const STORY_DESIGN_TOPICS: Record<string, Array<{ key: string; label: string }>> = {
  background: [{ key: 'background', label: '故事背景' }, { key: 'brief', label: '作品定位' }],
  story: [{ key: 'premise', label: '故事起点' }, { key: 'storyDesign', label: '主线与支线' }, { key: 'endgameDesign', label: '结局与兑现' }, { key: 'facts', label: '信息点与秘密' }],
  world: [
    { key: 'world:genreProfile', label: '世界基调' }, { key: 'world:powerSystems', label: '能力与限制' },
    { key: 'world:speciesSystem', label: '种属规则' }, { key: 'world:factionSystem', label: '组织与社会' },
    { key: 'world:characterEcology', label: '人物生态' }, { key: 'world:mapBlueprint', label: '地域层级' },
    { key: 'world:worldDynamics', label: '环境与生计' }, { key: 'world:timelineConfig', label: '历法与时间' },
  ],
  constraints: [{ key: 'writingRules', label: '写作边界' }, { key: 'world:writingConstraints', label: '世界与常识' }],
  style: [{ key: 'style:theme', label: '主题与情感' }, { key: 'style:viewpoint', label: '视角与叙述' }, { key: 'style:sequence', label: '时间与开篇' }, { key: 'style:voice', label: '语言与对话' }, { key: 'style:samples', label: '文风参考' }],
  structure: [],
}

export const STORY_VOICE_FIELDS: Record<string, Array<keyof ThemeVoiceDocument>> = {
  'style:theme': ['theme', 'themeChapterTest', 'motifs', 'emotionalCore'],
  'style:viewpoint': ['pov', 'tense', 'protagonistCount', 'viewpointMode', 'narratorDistance'],
  'style:sequence': ['parallelTimelines', 'openingStyle', 'flashbackPolicy'],
  'style:voice': ['voiceKeywords', 'styleRules', 'dialogueRules', 'descriptionRules', 'forbiddenPhrases', 'writingContractTags'],
  'style:samples': ['targetWorkSampleGuide', 'humanStyleSampleLock'],
}

export function resolveStoryDesignLocation(params: URLSearchParams) {
  const section = STORY_DESIGN_TABS.some(item => item.key === params.get('section')) ? params.get('section')! : 'background'
  const topics = STORY_DESIGN_TOPICS[section]
  const topic = topics.find(item => item.key === params.get('topic'))?.key || topics[0]?.key || ''
  return { section, topic, topics }
}

export function storyDesignParams(current: URLSearchParams, section: string, topic?: string) {
  const next = new URLSearchParams(current)
  next.set('section', section)
  if (topic) next.set('topic', topic)
  else next.delete('topic')
  return next
}

/** Each editor owns one topic; saving it must preserve the other topics and extension fields. */
export function buildStoryDesignPatch(latest: Pick<Novel, 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson' | 'projectBriefJson'>, key: string, draft: unknown): Record<string, unknown> {
  if (key === 'background') return recordOf(draft)
  if (key === 'brief') return { projectBriefJson: JSON.stringify(mergeCanonicalDocument(parseDocument(latest.projectBriefJson), parseDocument(buildProjectBriefPayload({}, latest.projectBriefJson)), parseDocument(buildProjectBriefPayload(draft as ProjectBriefDocument, latest.projectBriefJson)))) }
  if (key.startsWith('style:')) {
    const values = recordOf(draft)
    const patch = Object.fromEntries((STORY_VOICE_FIELDS[key] || []).filter(field => field in values).map(field => [field, values[field]]))
    return { themeVoiceJson: JSON.stringify(mergeCanonicalDocument(parseDocument(latest.themeVoiceJson), parseDocument(buildThemeVoicePayload({}, latest.themeVoiceJson)), parseDocument(buildThemeVoicePayload(patch, latest.themeVoiceJson)))) }
  }
  if (key.startsWith('world:')) return { worldRulesJson: JSON.stringify({ ...recordOf(parseDocument(latest.worldRulesJson)), [key.slice(6)]: draft }) }
  return { settingsJson: JSON.stringify(mergeCanonicalDocument(parseDocument(latest.settingsJson), buildStorySettingsPayload({}, latest.settingsJson), buildStorySettingsPayload({ [key]: draft }, latest.settingsJson))) }
}
