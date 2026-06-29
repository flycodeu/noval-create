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
  protagonist: {
    fullName: string
    roleType: 'protagonist'
    background: string
    goals: string
    innerConflict: string
    speechPattern: string
  }
  antagonist: {
    fullName: string
    roleType: 'antagonist'
    background: string
    goals: string
    innerConflict: string
    speechPattern: string
  }
  chapters: Array<{
    chapterNum: number
    title: string
    outline: string
    targetWords: number
  }>
  timelineEvents: Array<{
    sortOrder: number
    eventTitle: string
    eventSummary: string
    timeLabel: string
    timeSortValue: number
    eventCause: string
    eventResult: string
    status: 'planned'
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
    badge: '先开写',
    description: '只填最关键的 6 项，系统自动补出第一卷、开篇前三章框架和主要角色，让你尽快开写。',
  },
]

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function deriveTitle({ genreLabel, protagonistStart, coreHook }: Pick<FastLaunchDraftInput, 'genreLabel' | 'protagonistStart' | 'coreHook'>) {
  const preferred = normalizeLine(coreHook).split(/[，。,；：!！?？]/)[0]?.trim()
  if (preferred && preferred.length >= 4) return clipText(preferred, 14)

  const fallback = normalizeLine(protagonistStart).split(/[，。,；：!！?？]/)[0]?.trim()
  if (fallback && fallback.length >= 4) return clipText(fallback, 14)

  return `${genreLabel}开篇计划`
}

export function buildFastLaunchBootstrapPlan(input: FastLaunchDraftInput): FastLaunchBootstrapPlan {
  const genreLabel = normalizeLine(input.genreLabel)
  const protagonistStart = normalizeLine(input.protagonistStart)
  const coreHook = normalizeLine(input.coreHook)
  const coreConflict = normalizeLine(input.coreConflict)
  const tabooRules = normalizeLine(input.tabooRules)
  const endgameDirection = normalizeLine(input.endgameDirection)
  const writingContractTags = normalizeWritingContractTags(input.writingContractTags)
  const title = deriveTitle({ genreLabel, protagonistStart, coreHook })
  const synopsis = `${protagonistStart}，因 ${coreHook} 被迫卷入 ${coreConflict}，最终走向 ${endgameDirection}。`
  const userBackground = [
    `题材：${genreLabel}`,
    `主角起点：${protagonistStart}`,
    `核心钩子：${coreHook}`,
  ].join('\n')
  const expandedBackground = [
    `核心冲突：${coreConflict}`,
    `创作禁区：${tabooRules}`,
    `终局方向：${endgameDirection}`,
    '当前采用极速开书路径，允许边写边补资产，但不能偏离已锁定的冲突、禁区和终局方向。',
  ].join('\n')

  const projectBriefJson = buildProjectBriefPayload({
    platformMode: 'web_serial',
    targetAudience: genreLabel,
    targetReader: `偏好 ${genreLabel}、强钩子与持续推进的连载读者`,
    readerPromise: `${coreHook}，并在前三章内把主线压力落地。`,
    sellingPoints: `${coreHook} / ${coreConflict} / ${endgameDirection}`,
    tabooRules,
    deliveryRhythm: '先产出前三章骨架，再边写边扩资产。',
  })

  const settingsJson = JSON.stringify(buildStorySettingsPayload({
    premise: {
      positioning: `${genreLabel}长篇，采用极速开书路径先起稿再回补资产。`,
      coreHook,
      protagonistStart,
      constraints: tabooRules,
      languageGuardrails: '优先具体动作、明确冲突与可验证代价，避免空泛总结和模板化口号。',
    },
    storyDesign: {
      storyGoal: `围绕“${coreConflict}”持续推进并逼近“${endgameDirection}”。`,
      coreConflict,
      mainPlot: `主角从“${protagonistStart}”出发，先被“${coreHook}”引爆，再在前三章内看见不可回避的主线代价。`,
      ending: endgameDirection,
      rhythmSetup: 35,
      rhythmConflict: 45,
      rhythmEnding: 20,
      endingType: 'HE_BE',
    },
    endgameDesign: {
      endingMode: 'costly_victory',
      finalConflict: coreConflict,
      themeAnswer: endgameDirection,
      mustDeliverPromises: `${coreHook}；${coreConflict}`,
      payoffChecklist: '主角代价、核心阻力来源、第一卷承诺兑现',
      deliberateUnknowns: '允许在正文推进后再扩充世界细节与支线空间。',
      finalImage: clipText(endgameDirection, 30),
      lastScene: `主角为抵达“${endgameDirection}”付出明确代价。`,
    },
    writingRules: {
      antiAiFlavor: '禁用空泛总结、堆概念和自我解释。',
      commonSenseRules: '每一章至少推进一个新事实或压力，不用设定说明替代事件。',
      bannedTerms: tabooRules,
    },
  }))

  const themeVoiceJson = buildThemeVoicePayload({
    writingContractTags: writingContractTags.length > 0 ? writingContractTags : ['强剧情', '长篇'],
    theme: endgameDirection,
    emotionalCore: coreConflict,
    pov: 'third_limited',
    tense: 'past',
    styleRules: '短句优先，动作和选择先于解释，段落里必须能看见局势变化。',
    dialogueRules: '对白围绕立场冲突、代价和隐藏信息展开，不替角色总结情绪。',
    descriptionRules: '描写服务当下冲突，只保留会影响决策和代价的环境细节。',
    forbiddenPhrases: tabooRules,
  })

  const operatingModePolicy = getOperatingModePolicy({
    launchMode: 'fast_launch',
    targetWords: input.targetWords,
  })
  const chapterTargetWords = operatingModePolicy.chapterWords.recommended

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
      title: '第一卷 起势与代价',
      summary: `第一卷目标：把“${coreHook}”从噱头推进成无法回避的主线压力，并让主角第一次为“${coreConflict}”支付代价。`,
      targetWords: Math.max(30000, Math.round(input.targetWords * 0.18)),
    },
    outlineArc: {
      arcName: '第一卷主线',
      arcGoal: coreConflict,
      arcSummary: `围绕“${coreHook}”起势，在前三章建立冲突、阻力与代价，并把故事推向“${endgameDirection}”。`,
      chapterStart: 1,
      chapterEnd: 3,
      targetWords: Math.max(9000, chapterTargetWords * 3),
    },
    thread: {
      title: '主线线程',
      summary: coreConflict,
      premise: `${coreHook} 将主角从“${protagonistStart}”推入不可回避的主线。`,
    },
    protagonist: {
      fullName: '主角（待命名）',
      roleType: 'protagonist',
      background: protagonistStart,
      goals: endgameDirection,
      innerConflict: coreConflict,
      speechPattern: '谨慎、克制、被逼到角落时会变得直接。',
    },
    antagonist: {
      fullName: '主要阻力（待命名）',
      roleType: 'antagonist',
      background: `主线阻力围绕“${coreConflict}”持续施压。`,
      goals: `阻止主角完成“${endgameDirection}”。`,
      innerConflict: `既要维持自身立场，又被“${coreHook}”牵出新的压力。`,
      speechPattern: '说话留后手，习惯把代价推给别人承担。',
    },
    chapters: [
      {
        chapterNum: 1,
        title: '钩子引爆',
        outline: `让主角以“${protagonistStart}”状态登场，并在本章内被“${coreHook}”直接击中，结尾必须进入不可回退的新局面。`,
        targetWords: chapterTargetWords,
      },
      {
        chapterNum: 2,
        title: '阻力落地',
        outline: `把“${coreConflict}”落成具体阻力，展示主角第一次试图应对时碰到的失败、代价或关系裂缝。`,
        targetWords: chapterTargetWords,
      },
      {
        chapterNum: 3,
        title: '方向确认',
        outline: `确认第一卷方向与代价链，让主角看见通往“${endgameDirection}”的代价，并给出足够强的继续追读钩子。`,
        targetWords: chapterTargetWords,
      },
    ],
    timelineEvents: [
      {
        sortOrder: 1,
        eventTitle: '钩子事件触发',
        eventSummary: coreHook,
        timeLabel: '第1章前后',
        timeSortValue: 10,
        eventCause: protagonistStart,
        eventResult: '主角无法继续停留在原有处境。',
        status: 'planned',
      },
      {
        sortOrder: 2,
        eventTitle: '主线阻力显形',
        eventSummary: coreConflict,
        timeLabel: '第2章前后',
        timeSortValue: 20,
        eventCause: coreHook,
        eventResult: '第一轮阻力和代价被明确看见。',
        status: 'planned',
      },
      {
        sortOrder: 3,
        eventTitle: '第一卷方向锁定',
        eventSummary: endgameDirection,
        timeLabel: '第3章结尾',
        timeSortValue: 30,
        eventCause: coreConflict,
        eventResult: '第一卷目标被正式锁定。',
        status: 'planned',
      },
    ],
  }
}
