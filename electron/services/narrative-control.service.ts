import type { ThemeVoiceDocument } from '../../src/shared/theme-voice'

export type NarrativeGateStatus = 'pass' | 'warning' | 'blocker' | 'rewrite'
export type NarrativeSenseKey = 'visual' | 'auditory' | 'tactile' | 'olfactory' | 'gustatory'
export type NarrativeFunctionProfile = 'climax' | 'reversal' | 'breather' | 'payoff'

export interface NarrativeControlSceneSnapshot {
  segmentId?: number
  segmentOrder?: number
  segmentTitle?: string
  pov?: string
  emotionShift?: string
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

export interface TransitionDensityAnalysis {
  status: NarrativeGateStatus
  summary: string
  fixHint: string
  riskRate: number
  paragraphCount: number
  denseParagraphCount: number
  thinParagraphCount: number
  maxDenseRun: number
  releasedDenseClusters: number
}

export interface EmotionFocusAnalysis {
  status: NarrativeGateStatus
  summary: string
  fixHint: string
  riskRate: number
  expectedFocus: string
  dominantEmotion: string
  dominantShare: number
  contrastEmotionCount: number
  matchedFocus: boolean
}

export interface ExpositionDeliveryAnalysis {
  status: NarrativeGateStatus
  summary: string
  fixHint: string
  riskRate: number
  consecutiveBlockLength: number
  explanatorySentenceCount: number
  worldSentenceCount: number
}

export interface NarrativeControlReport {
  promptGuidance: NarrativePromptGuidance
  pov: PovBoundaryAnalysis
  sensory: SensoryCoverageAnalysis
  narrativeRatio: NarrativeRatioAnalysis
  transitionDensity: TransitionDensityAnalysis
  emotionFocus: EmotionFocusAnalysis
  exposition: ExpositionDeliveryAnalysis
}

interface AnalyzeNarrativeControlsInput {
  themeVoice?: ThemeVoiceDocument | null
  sceneSnapshots?: NarrativeControlSceneSnapshot[]
  content?: string | null
  chapterGoal?: string | null
  emotionTone?: string | null
  emotionFocus?: string | null
  expositionMode?: string | null
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

const ACTION_TOKENS = [
  '走',
  '跑',
  '冲',
  '扑',
  '抓',
  '推',
  '拉',
  '撞',
  '抬',
  '落',
  '站',
  '坐',
  '转身',
  '挥',
  '砸',
  '踢',
  '追',
  '拽',
  '压',
  '摸',
  '攥',
  '扳',
  '敲',
  '盯',
  '看',
  '听',
  '问',
  '说',
  '写',
  '誊',
  '抄',
  '翻',
  '合',
  '掀',
  '取',
  '塞',
  '递',
  '拿',
  '铲',
  '清',
  '扣',
  '游',
  '沉',
  '刺',
  '拔',
  '倒',
  '跪',
  '搁',
]
const INTERIOR_TOKENS = ['心里', '心中', '脑海', '想着', '意识到', '明白', '知道', '猜到', '怀疑', '后悔', '希望', '害怕', '以为', '忽然懂了', '记起']
const ENVIRONMENT_TOKENS = [
  '墙',
  '门',
  '窗',
  '风',
  '雨',
  '雪',
  '夜色',
  '空气',
  '走廊',
  '街',
  '屋',
  '仓库',
  '地面',
  '灯',
  '阴影',
  '雾',
  '船',
  '水',
  '河',
  '舱',
  '桨',
  '炉',
  '表',
  '闸',
  '纸',
  '药箱',
  '针',
  '砖',
  '档案',
  '工册',
]
const EXPLANATORY_TOKENS = ['意味着', '代表着', '说明了', '体现了', '展现了', '本质上', '某种程度上', '换句话说', '其实就是', '这说明']
const EXPLANATION_PATTERN_TOKENS = ['是', '属于', '分为', '由', '构成', '规定', '制度', '规则', '法则', '通常', '一般', '负责', '需要', '必须']
const WORLD_EXPOSITION_TOKENS = ['体系', '制度', '规则', '法则', '位阶', '宗门', '门派', '帝国', '联邦', '学院', '派系', '军规', '法令', '历史', '传统', '边境', '血脉', '术式', '灵脉', '晶核', '资源', '配额', '教会', '祭司']
const EMOTION_BUCKET_LABELS = {
  pressure: '压抑/警觉',
  fear: '惊惧',
  anger: '愤怒/对抗',
  sorrow: '悲伤/失落',
  warmth: '回暖/亲近',
  desire: '欲望/躁动',
} as const
const EMOTION_TOKEN_MAP: Record<keyof typeof EMOTION_BUCKET_LABELS, string[]> = {
  pressure: ['压', '绷', '紧', '发紧', '屏息', '戒备', '警觉', '提防', '不安', '冷意', '沉着脸'],
  fear: ['怕', '惧', '惊', '发抖', '寒意', '心慌', '胆寒', '后背发凉', '毛骨悚然'],
  anger: ['怒', '火', '恼', '烦', '咬牙', '发狠', '憋火', '拍桌', '砸', '顶回去'],
  sorrow: ['悲', '悲伤', '酸', '涩', '疼', '空', '失落', '难过', '哽', '鼻尖发酸', '沉下去', '发闷'],
  warmth: ['暖', '松', '笑', '软', '安稳', '放松', '松了口气', '安心', '心口一热'],
  desire: ['热', '渴', '躁', '心痒', '想要', '贪', '念头烧', '燥', '兴奋'],
}
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

function splitParagraphs(text: string): string[] {
  return asText(text)
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length
  return Math.sqrt(variance)
}

function hasAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token))
}

function detectPrimaryEmotionBucket(sentence: string): keyof typeof EMOTION_BUCKET_LABELS | null {
  const scored = (Object.entries(EMOTION_TOKEN_MAP) as Array<[keyof typeof EMOTION_BUCKET_LABELS, string[]]>)
    .map(([bucket, tokens]) => [bucket, tokens.filter((token) => sentence.includes(token)).length] as const)
    .sort((left, right) => right[1] - left[1])
  return scored[0]?.[1] ? scored[0][0] : null
}

function resolveExpectedEmotionBucket(focus: string): keyof typeof EMOTION_BUCKET_LABELS | null {
  const normalized = asText(focus)
  if (!normalized) return null
  const match = (Object.entries(EMOTION_TOKEN_MAP) as Array<[keyof typeof EMOTION_BUCKET_LABELS, string[]]>)
    .map(([bucket, tokens]) => [bucket, tokens.filter((token) => normalized.includes(token)).length] as const)
    .sort((left, right) => right[1] - left[1])[0]
  return match?.[1] ? match[0] : null
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

function isTextureHeavyGenre(input: AnalyzeNarrativeControlsInput): boolean {
  const themeVoice = input.themeVoice || null
  const haystack = [
    input.genre,
    input.chapterGoal,
    input.expositionMode,
    themeVoice?.theme,
    themeVoice?.themeChapterTest,
    themeVoice?.styleRules,
    themeVoice?.descriptionRules,
    themeVoice?.targetWorkSampleGuide,
    ...(Array.isArray(themeVoice?.writingContractTags) ? themeVoice.writingContractTags : []),
  ].map((item) => asText(item)).join('\n')
  return /历史正剧|工矿|工业|劳动|组织|纪律|炉前|钢铁|志怪|妖医|治妖|妖病|病帖|诊疗|水道/.test(haystack)
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
  const transitionGuide = chapterFunction === 'breather'
    ? '过渡/喘息章优先做出“2-3 段实质推进 + 1 段短释压”的疏密变化，不要整章平均铺陈。'
    : ''
  const emotionGuide = asText(input.emotionFocus)
    ? `情绪主基调锁定为：${asText(input.emotionFocus)}。允许局部温差，但不要把整章写成单一情绪颜色。`
    : '没有显式情绪主基调时，也要避免整章只剩一种情绪腔调。'
  const expositionGuide = asText(input.expositionMode)
    ? `设定/说明方式：${asText(input.expositionMode)}。禁止连续三句以上脱离人物动作与互动的纯说明。`
    : '世界观说明尽量绑到角色经历、动作和互动里，不要连写纯解释段。'

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
      transitionGuide,
      emotionGuide,
      expositionGuide,
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
  const textureHeavyGenre = isTextureHeavyGenre(input)
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
    || ratios.exposition >= (textureHeavyGenre ? 45 : 35)
    || (chapterFunction === 'climax' && ratios.action < 20)
  const tooManyDeviations = textureHeavyGenre
    ? deviationReasons.length >= 5 && ratios.exposition >= 25
    : deviationReasons.length >= 4
  const imbalanceRate = clampPercent(
    Math.min(100, deviationReasons.length * 18 + Math.max(0, ratios.dialogue - rule.dialogueRange[1]) + Math.max(0, ratios.interior - rule.interiorMax)),
  )

  let status: NarrativeGateStatus = 'pass'
  if (sentences.length >= 6 && (severeDeviation || tooManyDeviations)) {
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

function analyzeTransitionDensity(input: AnalyzeNarrativeControlsInput, paragraphs: string[]): TransitionDensityAnalysis {
  const chapterFunction = resolveNarrativeFunctionProfile(input)
  const lengths = paragraphs.map((paragraph) => paragraph.replace(/\s+/g, '').length)
  const denseThreshold = chapterFunction === 'breather' ? 70 : 120
  const thinThreshold = chapterFunction === 'breather' ? 32 : 24
  const denseFlags = lengths.map((length) => length >= denseThreshold)
  const thinFlags = lengths.map((length) => length <= thinThreshold)
  const denseParagraphCount = denseFlags.filter(Boolean).length
  const thinParagraphCount = thinFlags.filter(Boolean).length
  const variance = standardDeviation(lengths)

  let maxDenseRun = 0
  let currentDenseRun = 0
  let denseClusterCount = 0
  let releasedDenseClusters = 0

  denseFlags.forEach((isDense, index) => {
    if (!isDense) {
      if (currentDenseRun >= 2) {
        denseClusterCount += 1
        if (thinFlags[index] || thinFlags[index + 1]) releasedDenseClusters += 1
      }
      maxDenseRun = Math.max(maxDenseRun, currentDenseRun)
      currentDenseRun = 0
      return
    }
    currentDenseRun += 1
  })
  if (currentDenseRun >= 2) {
    denseClusterCount += 1
    const nextIndex = denseFlags.length
    if (thinFlags[nextIndex] || thinFlags[nextIndex + 1]) releasedDenseClusters += 1
  }
  maxDenseRun = Math.max(maxDenseRun, currentDenseRun)

  const transitionChapter = chapterFunction === 'breather'
    || asText(input.emotionTone).includes('过渡')
    || asText(input.emotionTone).includes('平缓')
    || asText(input.emotionTone).includes('喘息')
    || asText(input.chapterFunction).includes('breather')
  const overlyUniform = paragraphs.length >= 4 && variance < 18 && thinParagraphCount === 0
  const overloadedBridge = maxDenseRun >= 3 || (denseClusterCount > 0 && releasedDenseClusters === 0 && thinParagraphCount === 0)

  let status: NarrativeGateStatus = 'pass'
  if (transitionChapter && overloadedBridge) {
    status = 'rewrite'
  } else if ((transitionChapter && (overlyUniform || denseClusterCount > releasedDenseClusters)) || (!transitionChapter && maxDenseRun >= 4)) {
    status = 'warning'
  }

  const riskRate = clampPercent(
    Math.min(
      100,
      denseParagraphCount * 12
      + Math.max(0, maxDenseRun - 1) * 18
      + (overlyUniform ? 24 : 0)
      + (releasedDenseClusters === 0 && denseClusterCount > 0 ? 18 : 0),
    ),
  )

  const summary = status === 'rewrite'
    ? `过渡段连续出现 ${maxDenseRun} 段高密度段落，但没有形成短释压，节奏发闷。`
    : status === 'warning'
      ? `段落疏密变化偏弱：高密段 ${denseParagraphCount} 段，短释压段 ${thinParagraphCount} 段，长度方差 ${clampPercent(variance)}。`
      : transitionChapter
        ? `过渡段疏密基本成立：高密段 ${denseParagraphCount} 段，短释压段 ${thinParagraphCount} 段。`
        : '当前章节不是典型过渡/喘息章，段落疏密风险可控。'

  return {
    status,
    summary,
    fixHint: transitionChapter
      ? '把连续解释或铺陈拆成 2-3 段实质推进后，接一段更短的动作/停顿/观察释压，拉开呼吸。'
      : '避免连续堆叠同等重量的长段，适当插入短动作或短反馈切开节奏。',
    riskRate,
    paragraphCount: paragraphs.length,
    denseParagraphCount,
    thinParagraphCount,
    maxDenseRun,
    releasedDenseClusters,
  }
}

function analyzeEmotionFocus(input: AnalyzeNarrativeControlsInput, sentences: string[]): EmotionFocusAnalysis {
  const bucketCounts = new Map<keyof typeof EMOTION_BUCKET_LABELS, number>()
  sentences.forEach((sentence) => {
    const bucket = detectPrimaryEmotionBucket(sentence)
    if (!bucket) return
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
  })

  const ranked = [...bucketCounts.entries()].sort((left, right) => right[1] - left[1])
  const totalHits = ranked.reduce((sum, [, count]) => sum + count, 0)
  const dominantBucket = ranked[0]?.[0] || null
  const dominantCount = ranked[0]?.[1] || 0
  const dominantShare = totalHits > 0 ? clampPercent((dominantCount / totalHits) * 100) : 0
  const contrastEmotionCount = ranked.filter(([, count]) => count > 0).length
  const expectedFocus = asText(input.emotionFocus)
  const expectedBucket = resolveExpectedEmotionBucket(expectedFocus)
  const expectedCount = expectedBucket ? bucketCounts.get(expectedBucket) || 0 : 0
  const matchedFocus = !expectedBucket || expectedCount > 0
  const monotonyThreshold = resolveNarrativeFunctionProfile(input) === 'climax' ? 88 : 78
  const monochrome = totalHits >= 6 && dominantShare >= monotonyThreshold && contrastEmotionCount <= 1
  const sceneShiftSignals = (input.sceneSnapshots || [])
    .map((scene) => asText(scene.emotionShift))
    .filter(Boolean)
  const expectsShift = new Set(sceneShiftSignals).size >= 2

  let status: NarrativeGateStatus = 'pass'
  if (expectedFocus && !matchedFocus && totalHits >= 4) {
    status = 'warning'
  }
  if (monochrome || (expectsShift && contrastEmotionCount <= 1 && totalHits >= 5)) {
    status = status === 'warning' ? 'rewrite' : 'warning'
  }

  const dominantEmotion = dominantBucket ? EMOTION_BUCKET_LABELS[dominantBucket] : '未识别'
  const summary = status === 'rewrite'
    ? `当前章节情绪几乎被“${dominantEmotion}”单色占满，缺少必要的温差和回弹。`
    : status === 'warning'
      ? expectedFocus && !matchedFocus
        ? `合同主基调要求“${expectedFocus}”，但正文主要落在“${dominantEmotion}”。`
        : `当前章节主要压在“${dominantEmotion}”，情绪层次偏薄。`
      : expectedFocus
        ? `情绪主基调与合同基本对齐：${expectedFocus}。`
        : dominantBucket
          ? `当前章节主情绪以“${dominantEmotion}”为主，整体还算稳定。`
          : '当前正文没有明显的情绪跑焦或单色情绪问题。'

  return {
    status,
    summary,
    fixHint: expectedFocus && !matchedFocus
      ? `把关键反应拉回“${expectedFocus}”这条主线上，同时在局部插入一种次级情绪做温差。`
      : '保留主基调，但至少补一层次级情绪或反向反应，不要让整章只有一种情绪颜色。',
    riskRate: clampPercent(
      Math.min(
        100,
        (expectedFocus && !matchedFocus ? 32 : 0)
        + (monochrome ? 38 : 0)
        + Math.max(0, dominantShare - 60) * 0.8,
      ),
    ),
    expectedFocus,
    dominantEmotion,
    dominantShare,
    contrastEmotionCount,
    matchedFocus,
  }
}

function isPureExpositionSentence(sentence: string): boolean {
  const hasAction = hasAnyToken(sentence, ACTION_TOKENS)
  const hasDialogue = sentence.includes('“') || sentence.includes('"')
  const hasWorldToken = hasAnyToken(sentence, WORLD_EXPOSITION_TOKENS)
  const hasExplanationToken = hasAnyToken(sentence, EXPLANATORY_TOKENS) || hasAnyToken(sentence, EXPLANATION_PATTERN_TOKENS)
  return !hasAction && !hasDialogue && (hasWorldToken || hasExplanationToken)
}

function analyzeExpositionDelivery(input: AnalyzeNarrativeControlsInput, sentences: string[]): ExpositionDeliveryAnalysis {
  const expositionMode = asText(input.expositionMode)
  const directMode = expositionMode.includes('直述') || expositionMode.includes('direct')
  const pureExpositionFlags = sentences.map((sentence) => isPureExpositionSentence(sentence))
  const explanatorySentenceCount = pureExpositionFlags.filter(Boolean).length
  const worldSentenceCount = sentences.filter((sentence) => hasAnyToken(sentence, WORLD_EXPOSITION_TOKENS)).length
  let consecutiveBlockLength = 0
  let currentRun = 0
  pureExpositionFlags.forEach((isPure) => {
    if (isPure) {
      currentRun += 1
      consecutiveBlockLength = Math.max(consecutiveBlockLength, currentRun)
    } else {
      currentRun = 0
    }
  })

  let status: NarrativeGateStatus = 'pass'
  if (consecutiveBlockLength >= (directMode ? 5 : 4)) {
    status = 'rewrite'
  } else if (consecutiveBlockLength >= 3 || worldSentenceCount >= (directMode ? 6 : 4)) {
    status = 'warning'
  }

  const summary = status === 'rewrite'
    ? `世界观说明连续堆了 ${consecutiveBlockLength} 句纯解释，已经接近说明书。`
    : status === 'warning'
      ? `当前正文有 ${worldSentenceCount} 句偏世界观/规则说明，最长连续纯解释块 ${consecutiveBlockLength} 句。`
      : directMode
        ? '当前世界观说明量仍在“允许短直述”的范围内。'
        : '当前没有明显的世界观说明文堆积。'

  return {
    status,
    summary,
    fixHint: directMode
      ? '即使允许短直述，也把最长解释块拆开，改成“说明一句 + 动作/互动承接一句”的交替结构。'
      : '把设定说明拆进角色经历、对话、误判和动作结果里，避免连续纯解释。',
    riskRate: clampPercent(
      Math.min(100, explanatorySentenceCount * 12 + worldSentenceCount * 8 + Math.max(0, consecutiveBlockLength - 2) * 18),
    ),
    consecutiveBlockLength,
    explanatorySentenceCount,
    worldSentenceCount,
  }
}

export function analyzeNarrativeControls(input: AnalyzeNarrativeControlsInput): NarrativeControlReport {
  const promptGuidance = buildPromptGuidance(input)
  const content = asText(input.content)
  const sentences = splitSentences(content)
  const paragraphs = splitParagraphs(content)
  const pov = analyzePovBoundary(input, sentences)
  const sensory = analyzeSensoryCoverage(input, sentences)
  const narrativeRatio = analyzeNarrativeRatio({
    ...input,
    chapterFunction: input.chapterFunction || promptGuidance.chapterFunction,
  }, sentences)
  const transitionDensity = analyzeTransitionDensity(input, paragraphs)
  const emotionFocus = analyzeEmotionFocus(input, sentences)
  const exposition = analyzeExpositionDelivery(input, sentences)

  return {
    promptGuidance,
    pov,
    sensory,
    narrativeRatio,
    transitionDensity,
    emotionFocus,
    exposition,
  }
}
