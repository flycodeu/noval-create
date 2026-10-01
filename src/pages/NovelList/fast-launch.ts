import { buildProjectBriefPayload } from '../../shared/project-brief'
import { getOperatingModePolicy } from '../../shared/operating-mode'
import { buildStorySettingsPayload } from '../../shared/story-settings'
import { buildThemeVoicePayload } from '../../shared/theme-voice'
import { normalizeWritingContractTags } from '../../shared/writing-contract'
import type { NovelLaunchMode } from '../../types'

export interface FastLaunchDraftInput {
  genreLabel: string
  protagonistStart: string
  coreHook: string
  coreConflict: string
  tabooRules: string
  endgameDirection: string
  sourceIdea?: string
  titleHint?: string
  synopsisHint?: string
  targetWords: number
  writingContractTags?: string[]
}

export interface FastLaunchBootstrapPlan {
  novel: {
    title: string
    synopsis: string
    userBackground: string
    expandedBackground: string
    projectBriefJson: string
    settingsJson: string
    themeVoiceJson: string
    targetWords: number
  }
  volume: {
    title: string
    summary: string
    targetWords: number
  }
  outlineArc: {
    arcName: string
    arcOrder: number
    arcGoal: string
    arcSummary: string
    chapterStart: number
    chapterEnd: number
    targetWords: number
  }
  thread: {
    title: string
    summary: string
    premise: string
  }
  chapters: Array<{
    chapterNum: number
    title: string
    outline: string
    targetWords: number
  }>
  chapterContracts: Array<{
    chapterNum: number
    chapterGoal: string
    forbiddenActions: string[]
  }>
}

export const NOVEL_LAUNCH_MODE_OPTIONS: Array<{
  value: NovelLaunchMode
  label: string
  badge: string
  description: string
}> = [
  {
    value: 'professional_longform',
    label: '专业长篇路径',
    badge: '完整规划',
    description: '完整保留设定、人物、结构和一致性检查流程，适合想认真规划长篇的作者。',
  },
  {
    value: 'fast_launch',
    label: '极速开书路径',
    badge: '先建草案',
    description: '填写开书卡后创建第一卷与前三章草案；人物姓名、情节细节由你确认。',
  },
]

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

export function buildFastLaunchBootstrapPlan(input: FastLaunchDraftInput): FastLaunchBootstrapPlan {
  const genreLabel = normalizeLine(input.genreLabel)
  const protagonistStart = normalizeLine(input.protagonistStart)
  const coreHook = normalizeLine(input.coreHook)
  const coreConflict = normalizeLine(input.coreConflict)
  const tabooRules = normalizeLine(input.tabooRules)
  const endgameDirection = normalizeLine(input.endgameDirection)
  const sourceIdea = normalizeLine(input.sourceIdea || '')
  const writingContractTags = normalizeWritingContractTags(input.writingContractTags)
  const title = clipText(normalizeLine(input.titleHint || '') || '未命名作品', 40)
  const synopsis = clipText(
    normalizeLine(input.synopsisHint || '') || sourceIdea || coreHook,
    240,
  )
  const structuredBackground = [
    `题材：${genreLabel}`,
    `主角起点：${protagonistStart}`,
    `核心钩子：${coreHook}`,
    `核心冲突：${coreConflict}`,
    `创作禁区：${tabooRules}`,
    `终局方向：${endgameDirection}`,
  ].join('\n')
  const userBackground = sourceIdea
    ? [`作者原始描述：\n${sourceIdea}`, `开书卡提取：\n${structuredBackground}`].join('\n\n')
    : structuredBackground
  const expandedBackground = structuredBackground

  const projectBriefJson = buildProjectBriefPayload({
    platformMode: 'general',
    targetAudience: genreLabel,
    readerPromise: coreHook,
    sellingPoints: coreConflict,
    tabooRules,
  })

  const settingsJson = JSON.stringify(buildStorySettingsPayload({
    premise: {
      coreHook,
      protagonistStart,
      constraints: tabooRules,
    },
    storyDesign: {
      coreConflict,
      ending: endgameDirection,
    },
    writingRules: {
      bannedTerms: tabooRules,
    },
  }))

  const themeVoiceJson = buildThemeVoicePayload({
    writingContractTags,
    forbiddenPhrases: tabooRules,
  })

  const operatingModePolicy = getOperatingModePolicy({
    launchMode: 'fast_launch',
    targetWords: input.targetWords,
  })
  const chapterReferenceWords = [
    Math.max(1000, Math.round(operatingModePolicy.chapterWords.recommended * 0.8)),
    operatingModePolicy.chapterWords.recommended,
    Math.round(operatingModePolicy.chapterWords.recommended * 1.2),
  ]

  const chapters = [
    {
      chapterNum: 1,
      title: '第1章（待拟题）',
      outline: `主角起点：${protagonistStart}\n核心钩子：${coreHook}\n具体行动与结果由作者确认。`,
      targetWords: chapterReferenceWords[0],
    },
    {
      chapterNum: 2,
      title: '第2章（待拟题）',
      outline: `承接第1章实际正文，围绕作者给出的核心冲突继续规划：${coreConflict}\n不预设人物、场景或结果。`,
      targetWords: chapterReferenceWords[1],
    },
    {
      chapterNum: 3,
      title: '第3章（待拟题）',
      outline: `承接第2章实际正文，继续处理核心冲突：${coreConflict}\n终局方向仅作长线边界：${endgameDirection}；不预设本章结果。`,
      targetWords: chapterReferenceWords[2],
    },
  ]

  return {
    novel: {
      title,
      synopsis,
      userBackground,
      expandedBackground,
      projectBriefJson,
      settingsJson,
      themeVoiceJson,
      targetWords: input.targetWords,
    },
    volume: {
      title: '第一卷（待拟题）',
      summary: coreConflict,
      targetWords: Math.max(30000, Math.round(input.targetWords * 0.18)),
    },
    outlineArc: {
      arcName: '第一卷主线',
      arcOrder: 1,
      arcGoal: coreConflict,
      arcSummary: coreHook,
      chapterStart: 1,
      chapterEnd: 3,
      targetWords: Math.max(9000, chapterReferenceWords.reduce((sum, words) => sum + words, 0)),
    },
    thread: {
      title: '主线线程',
      summary: coreConflict,
      premise: coreHook,
    },
    chapters,
    chapterContracts: chapters.map((chapter) => ({
      chapterNum: chapter.chapterNum,
      chapterGoal: chapter.outline,
      forbiddenActions: tabooRules ? [tabooRules] : [],
    })),
  }
}
