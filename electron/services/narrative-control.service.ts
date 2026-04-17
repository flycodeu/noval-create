import type { ThemeVoiceDocument } from '../../src/shared/theme-voice'

export type NarrativeGateStatus = 'pass' | 'warning' | 'blocker' | 'rewrite'
export type NarrativeSenseKey = 'visual' | 'auditory' | 'tactile' | 'olfactory' | 'gustatory'
export type NarrativeFunctionProfile = 'climax' | 'reversal' | 'breather' | 'payoff'

export interface NarrativeControlSceneSnapshot {
  segmentId?: number
  segmentOrder?: number
  segmentTitle?: string
  pov?: string
}

export interface NarrativePromptGuidance {
  chapterFunction: NarrativeFunctionProfile
  chapterFunctionLabel: string
  povGuidance: string
  sensoryGuidance: string
  narrativeRatioGuidance: string
}

export interface PovBoundaryAnalysis {
  status: NarrativeGateStatus
  summary: string
  fixHint: string
  riskRate: number
  missingScenePovs: NarrativeControlSceneSnapshot[]
  uniqueScenePovs: string[]
  conflictingScene?: NarrativeControlSceneSnapshot | null
  directMindReadingHits: string[]
  impossibleKnowledgeHits: string[]
}

export interface SensoryBreakdownEntry {
  key: NarrativeSenseKey
  label: string
  hitCount: number
  sampleHits: string[]
}

export interface SensoryCoverageAnalysis {
  status: NarrativeGateStatus
  summary: string
  fixHint: string
  gapRate: number
  coverageCount: number
  coveredSenses: NarrativeSenseKey[]
  missingSenses: NarrativeSenseKey[]
  focusSummary: string
  breakdown: SensoryBreakdownEntry[]
}

export interface NarrativeRatioSnapshot {
  action: number
  dialogue: number
  interior: number
  environment: number
  exposition: number
}

export interface NarrativeRatioAnalysis {
  status: NarrativeGateStatus
  summary: string
  fixHint: string
  imbalanceRate: number
  chapterFunction: NarrativeFunctionProfile
  chapterFunctionLabel: string
  ratios: NarrativeRatioSnapshot
  deviationReasons: string[]
}

export interface NarrativeControlReport {
  promptGuidance: NarrativePromptGuidance
  pov: PovBoundaryAnalysis
  sensory: SensoryCoverageAnalysis
  narrativeRatio: NarrativeRatioAnalysis
}

interface AnalyzeNarrativeControlsInput {
  themeVoice?: ThemeVoiceDocument | null
  sceneSnapshots?: NarrativeControlSceneSnapshot[]
  content?: string | null
  chapterGoal?: string | null
  emotionTone?: string | null
  chapterFunction?: string | null
  genre?: string | null
}

interface NarrativeFunctionRule {
  label: string
  actionRange: [number, number]
  dialogueRange: [number, number]
  interiorMax: number
  environmentMax: number
  expositionMax: number
  ambientMax: number
}

const SENSE_LABELS: Record<NarrativeSenseKey, string> = {
  visual: '视觉',
  auditory: '听觉',
  tactile: '触觉',
  olfactory: '嗅觉',
  gustatory: '味觉',
}

const SENSE_TOKEN_MAP: Record<NarrativeSenseKey, string[]> = {
  visual: ['看', '看见', '看到', '望', '瞥', '目光', '颜色', '光', '影', '亮', '暗', '形状', '轮廓', '远处', '近处'],
  auditory: ['听', '听见', '声音', '声响', '脚步', '回声', '震动', '耳边', '喊', '吼', '低语', '沉默', '停顿', '嗡'],
  tactile: ['冷', '热', '痛', '麻', '湿', '汗', '粗糙', '锋利', '钝', '压力', '发烫', '发凉', '刺', '压', '抓', '推', '撞'],
  olfactory: ['闻', '气味', '味道', '血腥', '烟味', '药味', '霉味', '潮气', '焦糊', '腥', '香'],
  gustatory: ['尝', '苦', '甜', '咸', '涩', '辣', '铁锈味', '入口', '舌尖'],
}

const ACTION_TOKENS = ['走', '跑', '冲', '扑', '抓', '推', '拉', '撞', '抬', '落', '站', '坐', '转身', '挥', '砸', '踢', '追', '拽', '压', '摸']
const INTERIOR_TOKENS = ['心里', '心中', '脑海', '想着', '意识到', '明白', '知道', '猜到', '怀疑', '后悔', '希望', '害怕', '以为', '忽然懂了', '记起']
const ENVIRONMENT_TOKENS = ['墙', '门', '窗', '风', '雨', '雪', '夜色', '空气', '走廊', '街', '屋', '仓库', '地面', '灯', '阴影', '雾']
const EXPLANATORY_TOKENS = ['意味着', '代表着', '说明了', '体现了', '展现了', '本质上', '某种程度上', '换句话说', '其实就是', '这说明']
const DIRECT_MIND_READING_PATTERNS = [
  /(他|她|他们|她们|对方|别人|守卫|队长|敌人).{0,8}(心里|心中|脑海|想着|知道|意识到|明白|后悔|希望|害怕|盘算|认定|觉得)/,
  /(心里|心中|脑海|想着|知道|意识到|明白|后悔|希望|害怕|盘算|认定|觉得).{0,8}(他|她|他们|她们|对方|别人|守卫|队长|敌人)/,
]
const IMPOSSIBLE_KNOWLEDGE_PATTERNS = [
  /与此同时/,
  /而在另一边/,
  /他不知道的是/,
  /她不知道的是/,
  /没人知道/,
  /此时.{0,12}(已经|正在)/,
]

const FUNCTION_RULES: Record<NarrativeFunctionProfile, NarrativeFunctionRule> = {
  climax: {
    label: '高潮章',
    actionRange: [35, 55],
    dialogueRange: [15, 35],
    interiorMax: 15,
    environmentMax: 12,
    expositionMax: 8,
    ambientMax: 20,
  },
  reversal: {
    label: '反转章',
    actionRange: [25, 45],
    dialogueRange: [20, 40],
    interiorMax: 20,
    environmentMax: 15,
    expositionMax: 10,
    ambientMax: 25,
  },
  breather: {
    label: '过渡 / 喘息章',
    actionRange: [15, 30],
    dialogueRange: [25, 45],
    interiorMax: 25,
    environmentMax: 22,
    expositionMax: 15,
    ambientMax: 35,
  },
  payoff: {
    label: '兑现章',
    actionRange: [20, 40],
    dialogueRange: [20, 40],
    interiorMax: 20,
    environmentMax: 15,
    expositionMax: 10,
    ambientMax: 25,
  },
}

function asText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

function splitSentences(text: string): string[] {
  return asText(text)
    .replace(/\r\n/g, '\n')
    .split(/[。！？!?；\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function hasAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token))
}

function findMatchingSentences(sentences: string[], patterns: RegExp[]): string[] {
  return sentences
    .filter((sentence) => patterns.some((pattern) => pattern.test(sentence)))
    .slice(0, 3)
}

function formatSceneLabel(scene: NarrativeControlSceneSnapshot): string {
  if (scene.segmentTitle) return scene.segmentTitle
  if (typeof scene.segmentOrder === 'number') return `场景 ${scene.segmentOrder}`
  if (typeof scene.segmentId === 'number') return `场景 #${scene.segmentId}`
  return '未命名场景'
}

function resolveNarrativeFunctionProfile(input: AnalyzeNarrativeControlsInput): NarrativeFunctionProfile {
  const explicit = asText(input.chapterFunction).toLowerCase()
  if (explicit.includes('climax') || explicit.includes('高潮')) return 'climax'
  if (explicit.includes('reversal') || explicit.includes('反转')) return 'reversal'
  if (explicit.includes('breather') || explicit.includes('过渡') || explicit.includes('喘息')) return 'breather'
  if (explicit.includes('payoff') || explicit.includes('兑现')) return 'payoff'

  const emotionTone = asText(input.emotionTone).toLowerCase()
  const chapterGoal = asText(input.chapterGoal).toLowerCase()
  if (emotionTone.includes('高潮') || emotionTone.includes('爆发') || emotionTone.includes('climax') || chapterGoal.includes('决战')) {
    return 'climax'
  }
  if (emotionTone.includes('反转') || chapterGoal.includes('反转') || chapterGoal.includes('翻盘') || chapterGoal.includes('误导')) {
    return 'reversal'
  }
  if (emotionTone.includes('过渡') || emotionTone.includes('平缓') || emotionTone.includes('日常') || chapterGoal.includes('喘口气')) {
    return 'breather'
  }
  return 'payoff'
}

function buildPromptGuidance(input: AnalyzeNarrativeControlsInput): NarrativePromptGuidance {
  const chapterFunction = resolveNarrativeFunctionProfile(input)
  const functionRule = FUNCTION_RULES[chapterFunction]
  const themeVoice = input.themeVoice || null
  const sceneSnapshots = Array.isArray(input.sceneSnapshots) ? input.sceneSnapshots : []
  const uniqueScenePovs = [...new Set(sceneSnapshots.map((scene) => asText(scene.pov)).filter(Boolean))]
  const missingScenePovs = sceneSnapshots.filter((scene) => !asText(scene.pov))
  const fixedNovelPov = Boolean(themeVoice?.pov && themeVoice.pov !== 'multi_pov')
  const scenePovSummary = sceneSnapshots.length > 0
    ? sceneSnapshots
      .map((scene) => `${formatSceneLabel(scene)}=${asText(scene.pov) || '缺失 POV'}`)
      .join('；')
    : '当前没有可用的场景 POV 快照。'
  const sensoryFocus = chapterFunction === 'climax'
    ? '优先写动作、触觉和听觉冲击，环境说明只保留支撑冲突的部分。'
    : chapterFunction === 'reversal'
      ? '优先写异常视觉、声音变化和角色试探动作，让反转先被感知，再被解释。'
      : chapterFunction === 'breather'
        ? '优先写环境触感、视线停留和对白停顿，让场景真正落地，而不是空谈。'
        : '动作、对白、视觉和听觉尽量均衡，兑现结果时不要被解释腔盖住。'
  const genreText = asText(input.genre)
  const genreFocus = genreText.includes('悬疑')
    ? '悬疑章额外注意视觉异常、脚步声、停顿和气味线索。'
    : genreText.includes('惊悚')
      ? '惊悚章额外注意声音、触觉压迫和空气变化。'
      : ''

  return {
    chapterFunction,
    chapterFunctionLabel: functionRule.label,
    povGuidance: [
      `章节功能按 ${functionRule.label} 控制。`,
      `场景 POV 快照：${scenePovSummary}`,
      fixedNovelPov
        ? '固定视角规则：只能写 POV 角色此刻能看见、听见、感到、回忆或合理推测的信息。'
        : '多视角规则：每次切 POV 必须以场景边界为单位完成，段内禁止漂移。',
      fixedNovelPov
        ? '非 POV 角色的心理变化只能通过动作、表情、对白和停顿外显。'
        : '多视角场景也不能同时并列读取多个人的内心。',
      uniqueScenePovs.length > 1
        ? `当前章节已涉及 ${uniqueScenePovs.join('、')} 多个 POV，生成时必须显式收束切换边界。`
        : '',
      missingScenePovs.length > 0
        ? `仍有 ${missingScenePovs.length} 个场景缺 POV，生成前必须先补齐。`
        : '',
    ].filter(Boolean).join('\n'),
    sensoryGuidance: [
      '每章至少覆盖 3 类感官，不要只有视觉和对白。',
      sensoryFocus,
      genreFocus,
      '优先把感官细节绑到动作、风险和结果上，不要机械凑词。',
    ].filter(Boolean).join('\n'),
    narrativeRatioGuidance: [
      `${functionRule.label}推荐比例：动作 ${functionRule.actionRange[0]}-${functionRule.actionRange[1]}%，对白 ${functionRule.dialogueRange[0]}-${functionRule.dialogueRange[1]}%，内心 <=${functionRule.interiorMax}%，环境 <=${functionRule.environmentMax}%，解释 <=${functionRule.expositionMax}%，环境+解释 <=${functionRule.ambientMax}%。`,
      '对白过满时要补动作和环境反应；内心过满时要把判断改回外部事件；解释过满时要删掉作者代说。',
    ].join('\n'),
  }
}

function analyzePovBoundary(input: AnalyzeNarrativeControlsInput, sentences: string[]): PovBoundaryAnalysis {
  const themeVoice = input.themeVoice || null
  const sceneSnapshots = Array.isArray(input.sceneSnapshots) ? input.sceneSnapshots : []
  const uniqueScenePovs = [...new Set(sceneSnapshots.map((scene) => asText(scene.pov)).filter(Boolean))]
  const missingScenePovs = sceneSnapshots.filter((scene) => !asText(scene.pov))
  const fixedNovelPov = Boolean(themeVoice?.pov && themeVoice.pov !== 'multi_pov')
  const conflictingScene = fixedNovelPov && uniqueScenePovs.length > 1
    ? sceneSnapshots.find((scene) => {
      const pov = asText(scene.pov)
      return Boolean(pov && pov !== uniqueScenePovs[0])
    }) || null
    : null
  const directMindReadingHits = findMatchingSentences(sentences, DIRECT_MIND_READING_PATTERNS)
  const impossibleKnowledgeHits = fixedNovelPov
    ? findMatchingSentences(sentences, IMPOSSIBLE_KNOWLEDGE_PATTERNS)
    : []
  const leakCount = directMindReadingHits.length + impossibleKnowledgeHits.length
  const riskRate = clampPercent(
    (fixedNovelPov && uniqueScenePovs.length > 1 ? 35 : 0)
    + Math.min(missingScenePovs.length, 2) * 20
    + directMindReadingHits.length * 20
    + impossibleKnowledgeHits.length * 12,
  )

  let status: NarrativeGateStatus = 'pass'
  if (fixedNovelPov && uniqueScenePovs.length > 1) {
    status = 'rewrite'
  } else if (missingScenePovs.length > 0) {
    status = fixedNovelPov ? 'blocker' : 'warning'
  } else if (directMindReadingHits.length >= 2 || (directMindReadingHits.length > 0 && impossibleKnowledgeHits.length > 0)) {
    status = 'rewrite'
  } else if (leakCount > 0) {
    status = 'warning'
  }

  const summary = status === 'rewrite'
    ? fixedNovelPov && uniqueScenePovs.length > 1
      ? `固定视角作品当前混用了 ${uniqueScenePovs.join('、')} 多个场景 POV。`
      : `当前稿件命中了 ${leakCount} 处明显 POV 越界，已经影响视角纯度。`
    : status === 'blocker'
      ? `仍有 ${missingScenePovs.length} 个场景缺少 POV，生成前无法锁定视角边界。`
      : status === 'warning'
        ? leakCount > 0
          ? `当前稿件出现 ${leakCount} 处可能的 POV 越界或全知泄露。`
          : `当前章节涉及 ${uniqueScenePovs.length} 个 POV，建议确认是否真的需要切换。`
        : uniqueScenePovs.length > 0
          ? `当前 POV 边界基本稳定：${uniqueScenePovs.join('、')}。`
          : '当前没有识别到明显的 POV 越界问题。'

  const fixHint = fixedNovelPov && uniqueScenePovs.length > 1
    ? `退回 ${formatSceneLabel(conflictingScene || sceneSnapshots[0] || {})}，统一 POV 后再继续生成。`
    : leakCount > 0
      ? '删掉对非 POV 角色心理和场外信息的直写，把它们改回动作、对白、表情和现场线索。'
      : missingScenePovs.length > 0
        ? '先补齐缺失场景的 POV，再重新启动生成。'
        : '继续保持场景级 POV 边界，不要在段内切视角。'

  return {
    status,
    summary,
    fixHint,
    riskRate,
    missingScenePovs,
    uniqueScenePovs,
    conflictingScene,
    directMindReadingHits,
    impossibleKnowledgeHits,
  }
}

function analyzeSensoryCoverage(input: AnalyzeNarrativeControlsInput, sentences: string[]): SensoryCoverageAnalysis {
  const chapterFunction = resolveNarrativeFunctionProfile(input)
  const breakdown = (Object.keys(SENSE_TOKEN_MAP) as NarrativeSenseKey[]).map((key) => {
    const sampleHits = sentences.filter((sentence) => hasAnyToken(sentence, SENSE_TOKEN_MAP[key])).slice(0, 2)
    return {
      key,
      label: SENSE_LABELS[key],
      hitCount: sampleHits.length,
      sampleHits,
    }
  })
  const coveredSenses = breakdown.filter((entry) => entry.hitCount > 0).map((entry) => entry.key)
  const missingSenses = (Object.keys(SENSE_TOKEN_MAP) as NarrativeSenseKey[]).filter((key) => !coveredSenses.includes(key))
  const coverageCount = coveredSenses.length
  const gapRate = clampPercent(((5 - coverageCount) / 5) * 100)
  const missingTouchAndHearing = !coveredSenses.includes('tactile') && !coveredSenses.includes('auditory')

  let status: NarrativeGateStatus = 'pass'
  if (sentences.length >= 6 && coverageCount <= 1) {
    status = 'rewrite'
  } else if (coverageCount < 3 || (chapterFunction === 'climax' && missingTouchAndHearing)) {
    status = 'warning'
  }

  const focusSummary = chapterFunction === 'climax'
    ? '高潮章优先保证动作、触觉和听觉一起工作。'
    : chapterFunction === 'reversal'
      ? '反转章优先保证视觉异常、声音变化和气味线索。'
      : chapterFunction === 'breather'
        ? '过渡章也要补环境触感和人物停顿，避免只有对白。'
        : '兑现章建议让动作、视觉和听觉同时落地结果。'

  const summary = status === 'rewrite'
    ? `当前正文只覆盖了 ${coverageCount} 类感官，现场感明显不足。`
    : status === 'warning'
      ? `当前正文覆盖了 ${coverageCount} 类感官，仍缺 ${missingSenses.map((key) => SENSE_LABELS[key]).join('、')}。`
      : `当前正文已覆盖 ${coverageCount} 类感官：${coveredSenses.map((key) => SENSE_LABELS[key]).join('、')}。`

  return {
    status,
    summary,
    fixHint: coverageCount < 3
      ? `优先补 ${missingSenses.slice(0, 2).map((key) => SENSE_LABELS[key]).join('、')}，并把感官细节绑到冲突动作上。`
      : '保持感官覆盖，不要让感官描写脱离动作与结果。',
    gapRate,
    coverageCount,
    coveredSenses,
    missingSenses,
    focusSummary,
    breakdown,
  }
}

function classifySentence(sentence: string): keyof NarrativeRatioSnapshot {
  const dialogueScore = sentence.includes('“') || sentence.includes('"') ? 3 : 0
  const actionScore = ACTION_TOKENS.filter((token) => sentence.includes(token)).length
  const interiorScore = INTERIOR_TOKENS.filter((token) => sentence.includes(token)).length
  const environmentScore = ENVIRONMENT_TOKENS.filter((token) => sentence.includes(token)).length
    + (Object.values(SENSE_TOKEN_MAP).some((tokens) => hasAnyToken(sentence, tokens)) ? 1 : 0)
  const expositionScore = EXPLANATORY_TOKENS.filter((token) => sentence.includes(token)).length * 2

  const scored: Array<[keyof NarrativeRatioSnapshot, number]> = [
    ['dialogue', dialogueScore],
    ['action', actionScore],
    ['interior', interiorScore],
    ['environment', environmentScore],
    ['exposition', expositionScore],
  ]
  scored.sort((left, right) => right[1] - left[1])
  return scored[0][1] > 0 ? scored[0][0] : 'exposition'
}

function roundRatio(count: number, total: number): number {
  if (total <= 0) return 0
  return clampPercent((count / total) * 100)
}

function analyzeNarrativeRatio(input: AnalyzeNarrativeControlsInput, sentences: string[]): NarrativeRatioAnalysis {
  const chapterFunction = resolveNarrativeFunctionProfile(input)
  const rule = FUNCTION_RULES[chapterFunction]
  const categoryCounts: Record<keyof NarrativeRatioSnapshot, number> = {
    action: 0,
    dialogue: 0,
    interior: 0,
    environment: 0,
    exposition: 0,
  }
  sentences.forEach((sentence) => {
    categoryCounts[classifySentence(sentence)] += 1
  })
  const total = Math.max(sentences.length, 1)
  const ratios: NarrativeRatioSnapshot = {
    action: roundRatio(categoryCounts.action, total),
    dialogue: roundRatio(categoryCounts.dialogue, total),
    interior: roundRatio(categoryCounts.interior, total),
    environment: roundRatio(categoryCounts.environment, total),
    exposition: roundRatio(categoryCounts.exposition, total),
  }

  const deviationReasons: string[] = []
  if (ratios.action < rule.actionRange[0]) deviationReasons.push(`动作占比只有 ${ratios.action}%，低于 ${rule.actionRange[0]}%。`)
  if (ratios.action > rule.actionRange[1]) deviationReasons.push(`动作占比达到 ${ratios.action}%，高于 ${rule.actionRange[1]}%。`)
  if (ratios.dialogue < rule.dialogueRange[0]) deviationReasons.push(`对白占比只有 ${ratios.dialogue}%，低于 ${rule.dialogueRange[0]}%。`)
  if (ratios.dialogue > rule.dialogueRange[1]) deviationReasons.push(`对白占比达到 ${ratios.dialogue}%，高于 ${rule.dialogueRange[1]}%。`)
  if (ratios.interior > rule.interiorMax) deviationReasons.push(`内心占比达到 ${ratios.interior}%，高于 ${rule.interiorMax}%。`)
  if (ratios.environment > rule.environmentMax) deviationReasons.push(`环境描写占比达到 ${ratios.environment}%，高于 ${rule.environmentMax}%。`)
  if (ratios.exposition > rule.expositionMax) deviationReasons.push(`解释旁白占比达到 ${ratios.exposition}%，高于 ${rule.expositionMax}%。`)
  if (ratios.environment + ratios.exposition > rule.ambientMax) {
    deviationReasons.push(`环境+解释总占比达到 ${clampPercent(ratios.environment + ratios.exposition)}%，高于 ${rule.ambientMax}%。`)
  }

  const severeDeviation = ratios.dialogue >= 75
    || ratios.interior >= 45
    || ratios.exposition >= 35
    || (chapterFunction === 'climax' && ratios.action < 20)
  const imbalanceRate = clampPercent(
    Math.min(100, deviationReasons.length * 18 + Math.max(0, ratios.dialogue - rule.dialogueRange[1]) + Math.max(0, ratios.interior - rule.interiorMax)),
  )

  let status: NarrativeGateStatus = 'pass'
  if (sentences.length >= 6 && (severeDeviation || deviationReasons.length >= 4)) {
    status = 'rewrite'
  } else if (deviationReasons.length > 0) {
    status = 'warning'
  }

  const summary = status === 'rewrite'
    ? `${rule.label}的叙事比例已经明显失衡：动作 ${ratios.action}% / 对白 ${ratios.dialogue}% / 内心 ${ratios.interior}% / 环境 ${ratios.environment}% / 解释 ${ratios.exposition}%。`
    : status === 'warning'
      ? `${rule.label}比例存在偏移：动作 ${ratios.action}% / 对白 ${ratios.dialogue}% / 内心 ${ratios.interior}% / 环境 ${ratios.environment}% / 解释 ${ratios.exposition}%。`
      : `${rule.label}比例基本可控：动作 ${ratios.action}% / 对白 ${ratios.dialogue}% / 内心 ${ratios.interior}% / 环境 ${ratios.environment}% / 解释 ${ratios.exposition}%。`

  return {
    status,
    summary,
    fixHint: status === 'pass'
      ? '继续保持动作、对白、内心和环境的平衡，不要让解释性旁白反客为主。'
      : `优先处理：${deviationReasons.slice(0, 2).join('；') || '把失衡段落改回动作、对白和可见结果。'}`,
    imbalanceRate,
    chapterFunction,
    chapterFunctionLabel: rule.label,
    ratios,
    deviationReasons,
  }
}

export function analyzeNarrativeControls(input: AnalyzeNarrativeControlsInput): NarrativeControlReport {
  const promptGuidance = buildPromptGuidance(input)
  const sentences = splitSentences(asText(input.content))
  const pov = analyzePovBoundary(input, sentences)
  const sensory = analyzeSensoryCoverage(input, sentences)
  const narrativeRatio = analyzeNarrativeRatio({
    ...input,
    chapterFunction: input.chapterFunction || promptGuidance.chapterFunction,
  }, sentences)

  return {
    promptGuidance,
    pov,
    sensory,
    narrativeRatio,
  }
}
