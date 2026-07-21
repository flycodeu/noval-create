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
  characterArcs: Array<{
    characterRole: 'protagonist' | 'antagonist'
    startState: string
    surfaceWant: string
    deepNeed: string
    coreFear: string
    misbelief: string
    changeEvent: string
    endState: string
    notes: string
  }>
  relationshipArc: {
    relationLabelSnapshot: string
    relationTypeSnapshot: string
    startState: string
    crackPoint: string
    changeEvent: string
    endState: string
    notes: string
  }
  resistanceTrack: {
    title: string
    goal: string
    intelSource: string
    resourcePool: string
    escalationPlan: string
    heroKnowledgeShift: string
    stageVictory: string
    counterMove: string
    currentPressureMode: string
    notes: string
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
  chapterContracts: Array<{
    chapterNum: number
    chapterGoal: string
    openingStyle: string
    endingStyle: string
    expositionMode: string
    emotionFocus: string
    requiredArcProgress: string[]
    requiredResistanceActions: string[]
    hookType: string
    forbiddenActions: string[]
    acceptanceNotes: string[]
  }>
  sceneContracts: Array<{
    chapterNum: number
    segmentTitle: string
    purpose: string
    timeLocation: string
    sceneGoal: string
    obstacle: string
    conflictType: string
    emotionShift: string
    resultState: string
    linkageMode: string
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
  const sourceIdea = normalizeLine(input.sourceIdea || '')
  const writingContractTags = normalizeWritingContractTags(input.writingContractTags)
  const title = clipText(normalizeLine(input.titleHint || '') || deriveTitle({ genreLabel, protagonistStart, coreHook }), 40)
  const synopsis = clipText(
    normalizeLine(input.synopsisHint || '') || `${protagonistStart}，因 ${coreHook} 被迫卷入 ${coreConflict}，最终走向 ${endgameDirection}。`,
    240,
  )
  const structuredBackground = [
    `题材：${genreLabel}`,
    `主角起点：${protagonistStart}`,
    `核心钩子：${coreHook}`,
    `核心冲突：${coreConflict}`,
    `终局方向：${endgameDirection}`,
  ].join('\n')
  const userBackground = sourceIdea
    ? [`作者原始描述：\n${sourceIdea}`, `开书卡提取：\n${structuredBackground}`].join('\n\n')
    : structuredBackground
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
  const chapterReferenceWords = [
    Math.max(1000, Math.round(operatingModePolicy.chapterWords.recommended * 0.8)),
    operatingModePolicy.chapterWords.recommended,
    Math.round(operatingModePolicy.chapterWords.recommended * 1.2),
  ]

  const chapters = [
    {
      chapterNum: 1,
      title: '钩子引爆',
      outline: `让主角以“${protagonistStart}”状态登场，并在本章内被“${coreHook}”直接击中，结尾必须进入不可回退的新局面。`,
      targetWords: chapterReferenceWords[0],
    },
    {
      chapterNum: 2,
      title: '阻力落地',
      outline: `把“${coreConflict}”落成具体阻力，展示主角第一次试图应对时碰到的失败、代价或关系裂缝。`,
      targetWords: chapterReferenceWords[1],
    },
    {
      chapterNum: 3,
      title: '方向确认',
      outline: `确认第一卷方向与代价链，让主角看见通往“${endgameDirection}”的代价，并给出足够强的继续追读钩子。`,
      targetWords: chapterReferenceWords[2],
    },
  ]

  const timelineEvents = [
    {
      sortOrder: 1,
      eventTitle: '钩子事件触发',
      eventSummary: coreHook,
      timeLabel: '第1章前后',
      timeSortValue: 10,
      eventCause: protagonistStart,
      eventResult: '主角无法继续停留在原有处境。',
      status: 'planned' as const,
    },
    {
      sortOrder: 2,
      eventTitle: '主线阻力显形',
      eventSummary: coreConflict,
      timeLabel: '第2章前后',
      timeSortValue: 20,
      eventCause: coreHook,
      eventResult: '第一轮阻力和代价被明确看见。',
      status: 'planned' as const,
    },
    {
      sortOrder: 3,
      eventTitle: '第一卷方向锁定',
      eventSummary: endgameDirection,
      timeLabel: '第3章结尾',
      timeSortValue: 30,
      eventCause: coreConflict,
      eventResult: '第一卷目标被正式锁定。',
      status: 'planned' as const,
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
      title: '第一卷 起势与代价',
      summary: `第一卷目标：把“${coreHook}”从噱头推进成无法回避的主线压力，并让主角第一次为“${coreConflict}”支付代价。`,
      targetWords: Math.max(30000, Math.round(input.targetWords * 0.18)),
    },
    outlineArc: {
      arcName: '第一卷主线',
      arcOrder: 1,
      arcGoal: coreConflict,
      arcSummary: `围绕“${coreHook}”起势，在前三章建立冲突、阻力与代价，并把故事推向“${endgameDirection}”。`,
      chapterStart: 1,
      chapterEnd: 3,
      targetWords: Math.max(9000, chapterReferenceWords.reduce((sum, words) => sum + words, 0)),
    },
    thread: {
      title: '主线线程',
      summary: coreConflict,
      premise: `${coreHook} 将主角从“${protagonistStart}”推入不可回避的主线。`,
    },
    protagonist: {
      fullName: '主角',
      roleType: 'protagonist',
      background: protagonistStart,
      goals: endgameDirection,
      innerConflict: coreConflict,
      speechPattern: '谨慎、克制、被逼到角落时会变得直接。',
    },
    antagonist: {
      fullName: '主要阻力',
      roleType: 'antagonist',
      background: `主线阻力围绕“${coreConflict}”持续施压。`,
      goals: `阻止主角完成“${endgameDirection}”。`,
      innerConflict: `既要维持自身立场，又被“${coreHook}”牵出新的压力。`,
      speechPattern: '说话留后手，习惯把代价推给别人承担。',
    },
    characterArcs: [
      {
        characterRole: 'protagonist' as const,
        startState: protagonistStart,
        surfaceWant: endgameDirection,
        deepNeed: `学会在失去旧归属后仍主动承担“${coreConflict}”的代价。`,
        coreFear: '再次被抛下或证明自己不值得被留下。',
        misbelief: '只要把事情做对，就能换回原来的归属。',
        changeEvent: `主角第一次为“${coreConflict}”主动承担不可逆代价。`,
        endState: endgameDirection,
        notes: '极速开书最小人物弧：先锁定起点、欲望、误念和第一阶段转折。',
      },
      {
        characterRole: 'antagonist' as const,
        startState: `主要阻力围绕“${coreConflict}”控制局面。`,
        surfaceWant: `阻止主角抵达“${endgameDirection}”。`,
        deepNeed: '维持旧秩序对自身价值的证明。',
        coreFear: '失去对局势和代价分配的控制。',
        misbelief: '只要把代价推给别人，秩序就不会崩塌。',
        changeEvent: `主要阻力第一次因“${coreHook}”被迫升级行动。`,
        endState: `阻力被迫暴露“${coreConflict}”背后的真正代价。`,
        notes: '极速开书最小对抗弧：确保阻力不是静态标签，而是会主动出手。',
      },
    ],
    relationshipArc: {
      relationLabelSnapshot: '主角与主要阻力的不可回避对抗',
      relationTypeSnapshot: '对抗',
      startState: `主角试图摆脱“${coreConflict}”，主要阻力掌握主动权。`,
      crackPoint: `核心钩子迫使双方在前三章内正面碰撞。`,
      changeEvent: '一次失败的应对让双方都确认对方无法被忽略。',
      endState: `主角选择继续追向“${endgameDirection}”，主要阻力开始提高代价。`,
      notes: '极速开书最小关系弧：把两名初始角色绑定到同一条推进线上。',
    },
    resistanceTrack: {
      title: '主要阻力轨道',
      goal: `阻止主角完成“${endgameDirection}”。`,
      intelSource: `主要阻力掌握与“${coreHook}”有关的关键信息。`,
      resourcePool: '旧秩序、人情网络和对主角处境的先手了解。',
      escalationPlan: `先封锁主角的选择，再把“${coreConflict}”升级为必须付费的现实代价。`,
      heroKnowledgeShift: '主角确认眼前异常不是偶然，而是有人主动维持的局面。',
      stageVictory: '主角在第一章末保住继续追查的资格。',
      counterMove: '主要阻力制造一次看似合理、实际不可逆的反制。',
      currentPressureMode: '信息封锁与关系施压',
      notes: '极速开书最小阻力轨道：至少登记一次前三章内的主动出手。',
    },
    chapters,
    timelineEvents,
    chapterContracts: chapters.map((chapter, index) => ({
      chapterNum: chapter.chapterNum,
      chapterGoal: chapter.outline,
      openingStyle: index === 0 ? '从具体异常或即时危机切入' : '承接上一章代价，立即落到行动',
      endingStyle: index === 2 ? '锁定第一卷方向并留下继续追读压力' : '以不可逆选择或新阻力收束',
      expositionMode: '只通过行动、冲突和可验证细节释放设定',
      emotionFocus: index === 0 ? '惊疑与被迫应对' : index === 1 ? '受压与反抗' : '确认方向后的决绝',
      requiredArcProgress: [
        index === 0 ? '主角从被动处境转入主动追查' : '主角继续承担核心冲突带来的代价',
        '主要阻力必须因主角行动而升级',
      ],
      requiredResistanceActions: [
        index === 0 ? '主要阻力第一次封锁信息或选择' : '主要阻力针对主角当前行动做出反制',
      ],
      hookType: index === 0 ? '异常揭示' : index === 1 ? '代价升级' : '方向锁定',
      forbiddenActions: tabooRules ? [tabooRules] : [],
      acceptanceNotes: [
        '本章必须推进一个新事实或新压力。',
        '本章结尾不得把核心冲突恢复成原状。',
      ],
    })),
    sceneContracts: chapters.map((chapter, index) => ({
      chapterNum: chapter.chapterNum,
      segmentTitle: index === 0 ? '异常现场' : index === 1 ? '阻力交锋' : '方向确认',
      purpose: chapter.outline,
      timeLocation: `第${chapter.chapterNum}章前后 · 开篇主线现场`,
      sceneGoal: index === 0 ? `让主角看见“${coreHook}”并无法置身事外` : index === 1 ? `让“${coreConflict}”变成具体阻力` : `让主角确认必须走向“${endgameDirection}”`,
      obstacle: index === 0 ? '信息不完整且退路正在关闭' : index === 1 ? `主要阻力利用“${coreConflict}”限制主角选择` : '继续前进需要接受明确代价',
      conflictType: '外部阻力与内在选择同时推进',
      emotionShift: index === 0 ? '从日常转为警觉' : index === 1 ? '从受压转为反抗' : '从犹疑转为决断',
      resultState: index === 0 ? '主角获得必须追查的线索' : index === 1 ? '主角付出代价但保住行动资格' : '第一卷主线方向被锁定',
      linkageMode: '承接上一章压力并为下一章留下可执行行动',
    })),
  }
}
