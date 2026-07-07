import { asc, eq } from 'drizzle-orm'
import type {
  ChapterContractValidationResult,
  ContractValidationItem,
  ContractValidationVerdict,
  ThreadProgressSemanticState,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  characterArcs,
  characters,
  foreshadowLedger,
  novels,
  relationshipArcs,
  sceneContracts,
  storyThreads,
} from '../database/schema'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import {
  deriveChapterContractValidationStatus,
  isContractValidationBlockerVerdict,
  isContractValidationWarningVerdict,
  isHardContractValidationItem,
} from '../../src/shared/contract-validation'
import { throwUserFacingError } from '../utils/user-facing-error'
import { analyzeForeshadowProgress, analyzeStoryThreadProgress } from './thread-progress.service'

interface ChapterContractValidationSceneSnapshot {
  segmentId?: number
  segmentTitle: string
  sceneGoal: string
  obstacle: string
  resultState: string
}

interface ContractValidationContext {
  currentChapterNum: number
  chapterTitle: string
  chapterGoal: string
  hookType: string
  sceneSnapshots: ChapterContractValidationSceneSnapshot[]
  threadRows: typeof storyThreads.$inferSelect[]
  foreshadowRows: typeof foreshadowLedger.$inferSelect[]
  characterRows: typeof characters.$inferSelect[]
  characterArcRows: typeof characterArcs.$inferSelect[]
  relationshipArcRows: typeof relationshipArcs.$inferSelect[]
  scenePlanHooks: string[]
  theme: string
  themeChapterTest: string
}

interface ParagraphEvidence {
  excerpt: string
  score: number
  hitCount: number
}

interface ReviewSignalSnapshot {
  readerHookRisks: string[]
}

const PROGRESS_MARKERS = [
  '发现',
  '找到',
  '确认',
  '逼近',
  '推进',
  '暴露',
  '揭开',
  '得知',
  '拿到',
  '夺回',
  '追到',
  '拦下',
  '谈妥',
  '和解',
  '破裂',
  '救出',
  '抓住',
  '承认',
  '决定',
  '交换',
  '交出',
  '失去',
  '升级',
]

const CONFLICT_MARKERS = [
  '拦',
  '追',
  '逼',
  '压',
  '争',
  '抢',
  '拒',
  '阻',
  '威胁',
  '怀疑',
  '质问',
  '审问',
  '埋伏',
  '袭',
  '打',
  '伤',
  '逃',
  '躲',
  '骗',
  '失手',
  '冲突',
]

const HOOK_MARKERS = [
  '却',
  '但',
  '然而',
  '忽然',
  '突然',
  '脚步',
  '敲门',
  '消息',
  '未完',
  '还没',
  '尚未',
  '下一刻',
  '门外',
  '背后',
  '?',
  '？',
]

const OPENING_SCENE_MARKERS = [
  '门外',
  '门内',
  '窗外',
  '街口',
  '巷口',
  '桥头',
  '车厢',
  '屋里',
  '屋内',
  '房间',
  '楼梯',
  '仓库',
  '旧仓',
  '店门',
  '院门',
  '城门',
  '船舱',
  '雨声',
  '雪地',
  '风声',
  '夜色',
  '晨光',
  '灯光',
  '血迹',
  '烟尘',
  '尘土',
  '船底',
  '船板',
  '船舷',
  '船舱',
  '舱口',
  '水下',
  '水道',
  '桅灯',
  '炉前',
  '炉膛',
  '风压表',
  '表盘',
  '操作台',
  '出渣口',
  '工册股',
  '誊录室',
  '档案架',
]

const OPENING_ACTION_MARKERS = [
  '推开',
  '拉住',
  '抓住',
  '攥住',
  '按住',
  '敲',
  '撞',
  '跑',
  '追',
  '拦',
  '挡',
  '躲',
  '递',
  '拔',
  '砸',
  '翻',
  '扯',
  '问',
  '答',
  '盯',
  '听见',
  '喊',
  '盘问',
  '确认',
  '发现',
  '攥',
  '扳',
  '盯',
  '合上',
  '掀开',
  '取出',
  '伸手',
  '缩回',
  '滑进',
  '游',
  '沉',
  '刺',
  '拔',
  '倒',
  '誊',
  '抄',
  '写',
  '翻',
]

const OPENING_PRESSURE_MARKERS = [
  '忽然',
  '突然',
  '下一刻',
  '门外',
  '背后',
  '来不及',
  '还没',
  '威胁',
  '逼近',
  '质问',
  '审问',
  '埋伏',
  '失手',
  '受伤',
  '追上',
  '拦住',
  '?',
  '？',
  '哭声',
  '发冷',
  '白烟',
  '烫',
  '压差',
  '红线',
  '过三格',
  '骤降',
  '喘',
  '裂',
  '痉挛',
  '扣',
  '收走',
]

const OPENING_ABSTRACT_SETUP_MARKERS = [
  '很多年前',
  '很久以前',
  '曾经',
  '命运',
  '时代',
  '秩序',
  '信念',
  '牺牲',
  '意义',
  '棋局',
  '早有安排',
  '过去的恩怨',
  '未被说出',
  '被隐藏的真相',
  '遥远的因果',
  '历史深处',
  '来龙去脉',
  '格局',
]

const OPENING_SCENE_DELAY_MARKERS = [
  '还没有一个人进入现场',
  '没有一个人进入现场',
  '没有任何当下正在发生',
  '还没有任何当下正在发生',
  '没有当下正在发生的动作',
  '还没有当下正在发生的动作',
]

const CHARACTER_SCENE_MARKERS = [
  '选择',
  '决定',
  '拒绝',
  '承认',
  '交出',
  '留下',
  '放弃',
  '行动',
  '追',
  '拦',
  '救',
  '骗',
  '失去',
  '代价',
  '受伤',
  '破裂',
  '和解',
  '相信',
  '怀疑',
  '动摇',
  '裂缝',
  '误信',
]

const CHARACTER_ACTION_MARKERS = [
  '决定',
  '拒绝',
  '承认',
  '交出',
  '留下',
  '放弃',
  '行动',
  '追',
  '拦',
  '救',
  '骗',
]

const CHARACTER_PAYOFF_MARKERS = [
  '失去',
  '代价',
  '受伤',
  '破裂',
  '和解',
  '相信',
  '怀疑',
  '动摇',
  '裂缝',
  '误信',
  '信任',
  '不再',
  '开始',
]

const THEME_RESPONSE_MARKERS = [
  '选择',
  '代价',
  '底线',
  '信念',
  '妥协',
  '背叛',
  '相信',
  '怀疑',
  '牺牲',
  '放弃',
  '守住',
  '证明',
  '反问',
  '为什么',
]

const HISTORICAL_EXECUTION_CHAIN_MARKERS = [
  ['炉', '风压', '工册', '誊', '工', '班', '操作', '闸', '档案', '劳动'],
  ['值长', '班组', '调令', '规程', '纪律', '组织', '夜校', '抚恤', '粮饷', '记录', '条例'],
  ['扣', '调离', '失去', '顶嘴', '撕', '作废', '羞', '不识字', '停工', '损失', '搡开'],
  ['夜校', '识字', '补录', '意识', '规程', '责任', '追问', '不对', '问题', '学'],
]

const ZHIGUAI_EXECUTION_CHAIN_MARKERS = [
  ['妖', '鳃', '病帖', '哭声', '病', '疹', '瘘', '症'],
  ['人间', '亏欠', '规矩', '食言', '许', '诺', '欠', '忘', '误解', '船家', '老周'],
  ['诊', '针', '药', '治', '取出', '刺', '拔', '只诊', '判断', '病根', '银'],
  ['代价', '剩', '裂纹', '记忆', '药引', '耗', '痛', '苦', '麻'],
  ['余味', '账本', '别问', '病簿', '旧页', '继续走', '没再', '灯下', '微光'],
]

const RELATION_TRIGGER_MARKERS = ['因为', '当', '发现', '得知', '逼', '质问', '拒绝', '背叛', '救', '交出', '暴露']
const RELATION_INTERACTION_MARKERS = ['说', '问', '答', '看', '盯', '拉住', '推开', '挡', '递', '沉默', '握', '避开', '靠近']
const RELATION_CONSEQUENCE_MARKERS = ['于是', '因此', '从此', '不再', '开始', '决定', '留下', '离开', '破裂', '和解', '信任', '怀疑', '欠', '代价']

const GENERIC_TITLE_PATTERNS = [
  /^第[\d一二三四五六七八九十百千万零〇两]+[章节回卷幕集]?$/u,
  /^(序章|楔子|引子|正文|开端|开始|新的开始|转折|危机|真相|选择|决定|尾声)$/u,
]

function normalizeText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCompactText(value?: string | null): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, '')
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function parseUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

function parseScenePlanHooks(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => normalizeText(typeof item.exit_hook === 'string' ? item.exit_hook : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

function splitIntoParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function chunkParagraphs(paragraphs: string[], chunkCount: number): string[][] {
  if (chunkCount <= 0) return [paragraphs]
  if (paragraphs.length === 0) return Array.from({ length: chunkCount }, () => [])
  const size = Math.max(1, Math.ceil(paragraphs.length / chunkCount))
  return Array.from({ length: chunkCount }, (_, index) =>
    paragraphs.slice(index * size, (index + 1) * size))
}

function clipExcerpt(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function buildKeywordCandidates(...values: Array<string | null | undefined>): string[] {
  const pool = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
  const fragments = pool.flatMap((value) => value
    .split(/[，。；、,\s/：:（）()\-]+/)
    .map((item) => item.trim())
    .filter(Boolean))
  const cjkFragments = [...pool, ...fragments].flatMap((value) => {
    if (!/^[\u4e00-\u9fff]{4,18}$/.test(value)) return []
    const windows = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1) {
      windows.add(value.slice(index, index + 2))
    }
    if (value.length >= 4) {
      windows.add(value.slice(0, 4))
      windows.add(value.slice(-4))
    }
    return [...windows]
  })
  return [...new Set([
    ...pool.filter((value) => value.length >= 2 && value.length <= 18),
    ...fragments.filter((value) => value.length >= 2 && value.length <= 12),
    ...cjkFragments.filter((value) => value.length >= 2 && value.length <= 4),
  ])]
}

function buildTitleKeywordCandidates(...values: Array<string | null | undefined>): string[] {
  return buildKeywordCandidates(...values)
    .filter((value) =>
      value.length >= 2
      && !/^[第章节回卷幕集\d一二三四五六七八九十百千万零〇两]+$/u.test(value)
      && !['本章', '主线', '推进', '一步', '场景', '线索', '升级', '悬念', '真相'].includes(value))
}

function countMatchedKeywords(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0
  const haystack = normalizeCompactText(text)
  return keywords.reduce((count, keyword) =>
    haystack.includes(normalizeCompactText(keyword)) ? count + 1 : count, 0)
}

function countMarkers(text: string, markers: string[]): number {
  if (!text) return 0
  const haystack = normalizeCompactText(text)
  return markers.reduce((count, marker) =>
    haystack.includes(normalizeCompactText(marker)) ? count + 1 : count, 0)
}

function findBestEvidence(
  paragraphs: string[],
  keywords: string[],
  markers: string[] = [],
): ParagraphEvidence {
  return paragraphs.reduce<ParagraphEvidence>((best, paragraph) => {
    const hitCount = countMatchedKeywords(paragraph, keywords)
    const markerCount = countMarkers(paragraph, markers)
    const score = hitCount * 10 + markerCount * 3 + Math.min(paragraph.length, 160) / 160
    if (score <= best.score) return best
    return {
      excerpt: clipExcerpt(paragraph),
      score,
      hitCount,
    }
  }, {
    excerpt: '',
    score: 0,
    hitCount: 0,
  })
}

function getEvidenceParagraphs(
  paragraphs: string[],
  keywords: string[],
): string[] {
  return paragraphs.filter((paragraph) => countMatchedKeywords(paragraph, keywords) > 0)
}

function hasAllMarkerGroups(paragraph: string, groups: string[][]): boolean {
  return groups.every((markers) => countMarkers(paragraph, markers) > 0)
}

function isGenericChapterTitle(title: string): boolean {
  const normalized = normalizeCompactText(title)
  if (!normalized) return true
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  return normalized.length <= 2
}

function buildLocalEvidenceWindows(
  paragraphs: string[],
  keywords: string[],
  radius = 1,
): string[] {
  if (paragraphs.length === 0) return []
  const anchorIndexes = paragraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => keywords.length === 0 || countMatchedKeywords(paragraph, keywords) > 0)
    .map(({ index }) => index)

  return [...new Set(anchorIndexes.map((index) => {
    const start = Math.max(0, index - radius)
    const end = Math.min(paragraphs.length, index + radius + 1)
    return paragraphs.slice(start, end).join('\n')
  }))]
}

function buildSummary(items: ContractValidationItem[]): string {
  const hardItems = items.filter(isHardContractValidationItem)
  const hardBlockerCount = hardItems.filter((item) => isContractValidationBlockerVerdict(item.verdict)).length
  const hardWarningCount = hardItems.filter((item) => isContractValidationWarningVerdict(item.verdict)).length
  const softIssueCount = items
    .filter((item) => !isHardContractValidationItem(item) && item.verdict !== 'pass')
    .length
  if (hardBlockerCount > 0) {
    return `正文合同硬性验证命中 ${hardBlockerCount} 项阻塞，${hardWarningCount} 项预警${softIssueCount > 0 ? `；另有 ${softIssueCount} 项吸引力专项问题。` : '。'}`
  }
  if (hardWarningCount > 0) {
    return `正文合同硬性验证通过，但仍有 ${hardWarningCount} 项预警${softIssueCount > 0 ? `；另有 ${softIssueCount} 项吸引力专项问题。` : '。'}`
  }
  if (softIssueCount > 0) return `正文合同硬性验证已通过；标题贴合与黄金三章开篇由专项门禁处理，共 ${softIssueCount} 项。`
  return `正文合同验证已通过，共核对 ${items.length} 项。`
}

function buildStatus(items: ContractValidationItem[]): ChapterContractValidationResult['status'] {
  return deriveChapterContractValidationStatus(items)
}

function buildRewriteHints(items: ContractValidationItem[]): string[] {
  return [...new Set(items
    .filter((item) => item.verdict !== 'pass')
    .map((item) => item.rewriteHint.trim())
    .filter(Boolean))]
}

function verdictScore(verdict: ContractValidationVerdict): number {
  switch (verdict) {
    case 'pass':
      return 100
    case 'weak':
      return 65
    case 'overdelivered':
      return 55
    case 'contradicted':
      return 20
    case 'missing':
    default:
      return 15
  }
}

function makeItem(input: ContractValidationItem): ContractValidationItem {
  return {
    ...input,
    evidenceExcerpt: input.evidenceExcerpt || '',
    rewriteHint: input.rewriteHint || '',
  }
}

function normalizeContractValidationItem(raw: unknown): ContractValidationItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const verdict = normalizeText(typeof record.verdict === 'string' ? record.verdict : '') as ContractValidationVerdict
  if (!['pass', 'weak', 'missing', 'contradicted', 'overdelivered'].includes(verdict)) return null
  return {
    contractItemType: normalizeText(typeof record.contractItemType === 'string' ? record.contractItemType : ''),
    contractItemId: typeof record.contractItemId === 'number' ? record.contractItemId : undefined,
    expected: normalizeText(typeof record.expected === 'string' ? record.expected : ''),
    verdict,
    semanticState: normalizeText(typeof record.semanticState === 'string' ? record.semanticState : '') as ThreadProgressSemanticState || undefined,
    semanticReason: normalizeText(typeof record.semanticReason === 'string' ? record.semanticReason : ''),
    evidenceExcerpt: normalizeText(typeof record.evidenceExcerpt === 'string' ? record.evidenceExcerpt : ''),
    segmentId: typeof record.segmentId === 'number' ? record.segmentId : undefined,
    segmentTitle: normalizeText(typeof record.segmentTitle === 'string' ? record.segmentTitle : '') || undefined,
    rewriteHint: normalizeText(typeof record.rewriteHint === 'string' ? record.rewriteHint : ''),
  }
}

export function normalizeChapterContractValidationResult(raw: unknown): ChapterContractValidationResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const rawStatus = normalizeText(typeof record.status === 'string' ? record.status : '')
  if (!['pass', 'warning', 'blocker'].includes(rawStatus)) return null
  const itemResults = Array.isArray(record.itemResults)
    ? record.itemResults
      .map((item) => normalizeContractValidationItem(item))
      .filter((item): item is ContractValidationItem => Boolean(item))
    : []
  const status = itemResults.length > 0
    ? deriveChapterContractValidationStatus(itemResults)
    : rawStatus as ChapterContractValidationResult['status']
  return {
    status,
    summary: normalizeText(typeof record.summary === 'string' ? record.summary : ''),
    itemResults,
    rewriteHints: parseUnknownStringArray(record.rewriteHints),
  }
}

export function parseChapterContractValidationFromReviewNotes(raw?: string | null): ChapterContractValidationResult | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return normalizeChapterContractValidationResult(parsed.contract_validation)
  } catch {
    return null
  }
}

function parseReviewSignals(raw?: unknown): ReviewSignalSnapshot {
  const fallback: ReviewSignalSnapshot = {
    readerHookRisks: [],
  }
  if (!raw) return fallback
  const parsed = typeof raw === 'string'
    ? (() => {
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return null
      }
    })()
    : raw
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
  return {
    readerHookRisks: parseUnknownStringArray((parsed as Record<string, unknown>).reader_hook_risks),
  }
}

function loadValidationContext(chapterId: number): ContractValidationContext {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }
  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0] || null

  const chapterContractRow = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const segmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const sceneContractBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  sceneRows.forEach((row) => {
    if (typeof row.segmentId === 'number' && !sceneContractBySegmentId.has(row.segmentId)) {
      sceneContractBySegmentId.set(row.segmentId, row)
    }
  })

  const sceneSnapshots: ChapterContractValidationSceneSnapshot[] = [
    ...segmentRows.map((segment) => {
      const contract = sceneContractBySegmentId.get(segment.id) || null
      return {
        segmentId: segment.id,
        segmentTitle: normalizeText(segment.title) || `场景 ${segment.segmentOrder}`,
        sceneGoal: normalizeText(contract?.sceneGoal) || normalizeText(segment.purpose),
        obstacle: normalizeText(contract?.obstacle),
        resultState: normalizeText(contract?.resultState) || normalizeText(segment.outputState),
      }
    }),
    ...sceneRows
      .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
      .map((row) => ({
        segmentId: row.segmentId ?? undefined,
        segmentTitle: `场景合同 ${row.id}`,
        sceneGoal: normalizeText(row.sceneGoal),
        obstacle: normalizeText(row.obstacle),
        resultState: normalizeText(row.resultState),
      })),
  ]

  const servedThreadIds = parseNumberArray(chapterContractRow?.servedThreadIdsJson)
  const requiredForeshadowIds = parseNumberArray(chapterContractRow?.requiredForeshadowIdsJson)
  const requiredCharacterArcIds = parseNumberArray(chapterContractRow?.requiredCharacterArcIdsJson)
  const requiredRelationshipArcIds = parseNumberArray(chapterContractRow?.requiredRelationshipArcIdsJson)

  const threadRows = servedThreadIds.length > 0
    ? db.select().from(storyThreads).where(eq(storyThreads.novelId, chapter.novelId)).all()
      .filter((row) => servedThreadIds.includes(row.id))
    : []
  const foreshadowRows = requiredForeshadowIds.length > 0
    ? db.select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, chapter.novelId)).all()
      .filter((row) => requiredForeshadowIds.includes(row.id))
    : []
  const characterArcRows = requiredCharacterArcIds.length > 0
    ? db.select().from(characterArcs).where(eq(characterArcs.novelId, chapter.novelId)).all()
      .filter((row) => requiredCharacterArcIds.includes(row.id))
    : []
  const relationshipArcRows = requiredRelationshipArcIds.length > 0
    ? db.select().from(relationshipArcs).where(eq(relationshipArcs.novelId, chapter.novelId)).all()
      .filter((row) => requiredRelationshipArcIds.includes(row.id))
    : []
  const needsCharacterRows = characterArcRows.length > 0 || relationshipArcRows.length > 0
  const characterRows = needsCharacterRows
    ? db.select().from(characters).where(eq(characters.novelId, chapter.novelId)).all()
    : []
  const themeVoice = parseThemeVoiceDocument(novel?.themeVoiceJson)

  return {
    currentChapterNum: chapter.chapterNum,
    chapterTitle: normalizeText(chapter.title),
    chapterGoal: normalizeText(chapterContractRow?.chapterGoal),
    hookType: normalizeText(chapterContractRow?.hookType),
    sceneSnapshots,
    threadRows,
    foreshadowRows,
    characterRows,
    characterArcRows,
    relationshipArcRows,
    scenePlanHooks: parseScenePlanHooks(chapter.scenePlanJson),
    theme: themeVoice.theme,
    themeChapterTest: themeVoice.themeChapterTest,
  }
}

function validateChapterGoal(paragraphs: string[], context: ContractValidationContext): ContractValidationItem | null {
  if (!context.chapterGoal) return null
  const keywords = buildKeywordCandidates(context.chapterGoal)
  const evidence = findBestEvidence(paragraphs, keywords, PROGRESS_MARKERS)
  const progressHits = paragraphs.reduce((count, paragraph) => count + countMarkers(paragraph, PROGRESS_MARKERS), 0)
  const verdict: ContractValidationVerdict = evidence.hitCount >= Math.max(1, Math.min(2, keywords.length))
    && progressHits > 0
    ? 'pass'
    : evidence.hitCount > 0 || progressHits > 1
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'chapter_goal',
    expected: context.chapterGoal,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : '补一段能直接兑现本章目标的关键动作、结果或关系变化，不要只保留铺垫。',
  })
}

function validateChapterTitleAlignment(paragraphs: string[], context: ContractValidationContext): ContractValidationItem {
  const expected = context.chapterGoal || context.sceneSnapshots.map((scene) => scene.resultState || scene.sceneGoal).filter(Boolean).join(' / ') || '标题需要贴合本章核心事件'
  const title = context.chapterTitle
  const titleKeywords = buildTitleKeywordCandidates(title)
  const contractKeywords = buildTitleKeywordCandidates(
    context.chapterGoal,
    ...context.sceneSnapshots.flatMap((scene) => [scene.sceneGoal, scene.obstacle, scene.resultState]),
    ...context.threadRows.map((row) => row.title),
    ...context.foreshadowRows.map((row) => row.title),
  )
  const evidence = findBestEvidence(paragraphs, titleKeywords.length > 0 ? titleKeywords : contractKeywords, [
    ...PROGRESS_MARKERS,
    ...CONFLICT_MARKERS,
  ])
  const titleIsGeneric = isGenericChapterTitle(title)
  const titleHitsInContent = titleKeywords.length > 0 ? evidence.hitCount : 0
  const contractHitsInTitle = countMatchedKeywords(title, contractKeywords)
  const hasConcreteTitle = !titleIsGeneric && titleKeywords.length > 0
  const verdict: ContractValidationVerdict = hasConcreteTitle && (titleHitsInContent > 0 || contractHitsInTitle > 0)
    ? 'pass'
    : hasConcreteTitle || contractHitsInTitle > 0
      ? 'weak'
      : 'missing'

  return makeItem({
    contractItemType: 'chapter_title_alignment',
    expected,
    verdict,
    evidenceExcerpt: evidence.excerpt || title,
    rewriteHint: verdict === 'pass'
      ? ''
      : '把章节标题改成能指向本章核心事件、关键物件、选择压力或反转点的具体短句，避免“第十二章/真相/转折”这类泛标题。',
  })
}

function validateGoldenThreeOpening(paragraphs: string[], context: ContractValidationContext): ContractValidationItem | null {
  if (context.currentChapterNum > 3) return null
  const openingText = paragraphs.join('\n').slice(0, 800)
  const firstBeatText = openingText.slice(0, 300)
  const firstParagraphStart = (paragraphs[0] || '').slice(0, 300)
  const openingKeywords = buildKeywordCandidates(
    context.chapterGoal,
    ...context.sceneSnapshots.slice(0, 2).flatMap((scene) => [scene.sceneGoal, scene.obstacle, scene.resultState]),
    ...context.threadRows.slice(0, 2).map((row) => row.title),
  )
  const hasConcreteScene = countMarkers(firstBeatText, OPENING_SCENE_MARKERS) > 0
  const hasAction = countMarkers(firstBeatText, OPENING_ACTION_MARKERS) > 0
  const hasPressure = countMarkers(firstBeatText, OPENING_PRESSURE_MARKERS) > 0
  const hasContractAnchor = openingKeywords.length === 0 || countMatchedKeywords(openingText, openingKeywords) > 0
  const startsWithConcreteScene = countMarkers(firstParagraphStart, OPENING_SCENE_MARKERS) > 0
    && (countMarkers(firstParagraphStart, OPENING_ACTION_MARKERS) > 0 || countMarkers(firstParagraphStart, OPENING_PRESSURE_MARKERS) > 0)
  const startsWithAbstractSetup = !startsWithConcreteScene && (
    countMarkers(firstParagraphStart, OPENING_SCENE_DELAY_MARKERS) > 0
    || countMarkers(firstParagraphStart, OPENING_ABSTRACT_SETUP_MARKERS) >= 3
  )
  const score = [hasConcreteScene, hasAction, hasPressure, hasContractAnchor].filter(Boolean).length
  const effectiveScore = startsWithAbstractSetup ? Math.min(score, 3) : score
  const verdict: ContractValidationVerdict = score >= 4
    ? (effectiveScore >= 4 ? 'pass' : 'weak')
    : effectiveScore >= 3
      ? 'weak'
      : 'missing'

  return makeItem({
    contractItemType: 'golden_three_opening',
    expected: '前三章开篇必须尽快进入具体现场、主角动作、可感压力和本章追问点。',
    verdict,
    evidenceExcerpt: clipExcerpt(openingText, 120),
    rewriteHint: verdict === 'pass'
      ? ''
      : '重排章首 800 字：先给具体现场和主角动作，再压入阻力/危险/追问点，不要用设定说明、抽象情绪或泛背景开场。',
  })
}

function matchExecutionChainSteps(text: string, stepMarkers: string[][]): boolean[] {
  return stepMarkers.map((markers) => countMarkers(text, markers) > 0)
}

function validateCoreExecutionThemeResponse(paragraphs: string[], expected: string): ContractValidationItem | null {
  if (!expected.includes('->')) return null
  const text = paragraphs.join('\n')
  const normalized = normalizeText(expected)
  const isZhiguai = /妖病|妖医|治妖|病帖|诊疗/.test(normalized)
  const isHistorical = /具体劳动|制度现场|组织关系|纪律反馈|工矿|炉前/.test(normalized)
  if (!isZhiguai && !isHistorical) return null

  const stepMarkers = isZhiguai ? ZHIGUAI_EXECUTION_CHAIN_MARKERS : HISTORICAL_EXECUTION_CHAIN_MARKERS
  const matchedSteps = matchExecutionChainSteps(text, stepMarkers)
  const matchedCount = matchedSteps.filter(Boolean).length
  const verdict: ContractValidationVerdict = matchedCount >= stepMarkers.length
    ? 'pass'
    : matchedCount >= Math.max(3, stepMarkers.length - 1)
      ? 'weak'
      : 'missing'

  return makeItem({
    contractItemType: 'theme_chapter_response',
    expected,
    verdict,
    evidenceExcerpt: clipExcerpt(text, 120),
    rewriteHint: verdict === 'pass'
      ? ''
      : '补齐题材核心执行链，让正文同时出现病例/劳动现场、人的亏欠或制度反馈、主角判断受挫、具体代价与病后/事后余味。',
  })
}

function getCharacterNameById(rows: typeof characters.$inferSelect[]): Map<number, string> {
  return new Map(rows.map((row) => [row.id, normalizeText(row.fullName) || `角色#${row.id}`]))
}

function validateThemeResponse(paragraphs: string[], context: ContractValidationContext): ContractValidationItem | null {
  const expected = context.themeChapterTest || context.theme
  if (!expected) return null
  const coreExecutionThemeResponse = validateCoreExecutionThemeResponse(paragraphs, expected)
  if (coreExecutionThemeResponse) return coreExecutionThemeResponse

  const themeKeywords = buildKeywordCandidates(context.theme, context.themeChapterTest)
  const evidenceWindows = buildLocalEvidenceWindows(paragraphs, themeKeywords, 1)
  const hasLocalThemeResponse = evidenceWindows.some((windowText) =>
    countMarkers(windowText, CONFLICT_MARKERS) > 0
    && countMarkers(windowText, THEME_RESPONSE_MARKERS) > 0)
  const hasPartialThemeResponse = evidenceWindows.some((windowText) =>
    countMarkers(windowText, CONFLICT_MARKERS) > 0
    || countMarkers(windowText, THEME_RESPONSE_MARKERS) > 0)
  const evidence = findBestEvidence(paragraphs, themeKeywords, [...CONFLICT_MARKERS, ...THEME_RESPONSE_MARKERS])
  const hasThemeText = themeKeywords.length === 0 || evidence.hitCount > 0
  const verdict: ContractValidationVerdict = hasThemeText && hasLocalThemeResponse
    ? 'pass'
    : hasThemeText && hasPartialThemeResponse
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'theme_chapter_response',
    expected,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : '补一场会迫使角色回答主题命题的冲突：让选择、底线、代价或妥协在现场发生，不要只推进事件。',
  })
}

function validateCharacterScenePayoff(
  row: typeof characterArcs.$inferSelect,
  paragraphs: string[],
  characterNameById: Map<number, string>,
): ContractValidationItem {
  const label = characterNameById.get(row.characterId) || `角色#${row.characterId}`
  const keywords = buildKeywordCandidates(
    label,
    row.surfaceWant,
    row.deepNeed,
    row.coreFear,
    row.misbelief,
    row.changeEvent,
    row.endState,
  )
  const evidence = findBestEvidence(paragraphs, keywords, CHARACTER_SCENE_MARKERS)
  const evidenceParagraphs = getEvidenceParagraphs(paragraphs, keywords)
  const evidenceWindows = buildLocalEvidenceWindows(paragraphs, keywords, 1)
  const hasScenePayoff = evidenceParagraphs.some((paragraph) =>
    countMarkers(paragraph, CHARACTER_ACTION_MARKERS) > 0
    && countMarkers(paragraph, CHARACTER_PAYOFF_MARKERS) > 0)
  const hasPartialPayoff = evidenceWindows.some((windowText) =>
    countMarkers(windowText, CHARACTER_ACTION_MARKERS) > 0
    || countMarkers(windowText, CHARACTER_PAYOFF_MARKERS) > 0
    || countMarkers(windowText, CHARACTER_SCENE_MARKERS) >= 2)
  const hasCharacterAnchor = evidence.hitCount > 0
  const verdict: ContractValidationVerdict = hasCharacterAnchor && hasScenePayoff
    ? 'pass'
    : hasCharacterAnchor && hasPartialPayoff
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'character_scene_payoff',
    contractItemId: row.id,
    expected: `${label} 必须在本章完成一次选择、行动、代价、关系变化或误信念裂缝。`,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : `补出“${label}”的场景化兑现：至少写清一次选择/行动，它带来的代价或关系变化，以及误信念是否出现裂缝。`,
  })
}

function validateRelationshipArcGate(
  row: typeof relationshipArcs.$inferSelect,
  paragraphs: string[],
  characterNameById: Map<number, string>,
): ContractValidationItem {
  const charAName = characterNameById.get(row.charAId) || `角色#${row.charAId}`
  const charBName = characterNameById.get(row.charBId) || `角色#${row.charBId}`
  const label = `${charAName} × ${charBName}`
  const keywords = buildKeywordCandidates(
    label,
    charAName,
    charBName,
    row.relationLabelSnapshot,
    row.startState,
    row.crackPoint,
    row.changeEvent,
    row.endState,
  )
  const evidence = findBestEvidence(paragraphs, keywords, [
    ...RELATION_TRIGGER_MARKERS,
    ...RELATION_INTERACTION_MARKERS,
    ...RELATION_CONSEQUENCE_MARKERS,
  ])
  const evidenceWindows = buildLocalEvidenceWindows(paragraphs, keywords, 1)
  const relationshipWindows = evidenceWindows.filter((windowText) =>
    countMatchedKeywords(windowText, [charAName]) > 0
    && countMatchedKeywords(windowText, [charBName]) > 0)
  const relationshipParagraphs = paragraphs.filter((paragraph) =>
    countMatchedKeywords(paragraph, [charAName]) > 0
    && countMatchedKeywords(paragraph, [charBName]) > 0
    && (countMatchedKeywords(paragraph, keywords) > 0
      || countMarkers(paragraph, [...RELATION_TRIGGER_MARKERS, ...RELATION_INTERACTION_MARKERS, ...RELATION_CONSEQUENCE_MARKERS]) > 0))
  const evidenceParagraphs = relationshipWindows.length > 0 ? relationshipWindows : getEvidenceParagraphs(paragraphs, keywords)
  const triggerHits = evidenceParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, RELATION_TRIGGER_MARKERS), 0)
  const interactionHits = evidenceParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, RELATION_INTERACTION_MARKERS), 0)
  const consequenceHits = evidenceParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, RELATION_CONSEQUENCE_MARKERS), 0)
  const hasTriggerInteractionParagraph = relationshipParagraphs.some((paragraph) =>
    countMarkers(paragraph, RELATION_TRIGGER_MARKERS) > 0
    && countMarkers(paragraph, RELATION_INTERACTION_MARKERS) > 0)
  const hasRelationshipConsequence = relationshipParagraphs.some((paragraph) =>
    countMarkers(paragraph, RELATION_CONSEQUENCE_MARKERS) > 0)
  const hasArcAnchor = evidence.hitCount > 0
  const hasBothCharacters = relationshipWindows.length > 0
  const verdict: ContractValidationVerdict = hasArcAnchor && hasBothCharacters && hasTriggerInteractionParagraph && hasRelationshipConsequence
    ? 'pass'
    : hasArcAnchor && (triggerHits > 0 || interactionHits > 0 || consequenceHits > 0)
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'relationship_arc_gate',
    contractItemId: row.id,
    expected: `${label} 的关系变化必须有触发事件、可见互动和后果。`,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : `补强关系弧“${label}”：先写触发事件，再写两人可见互动，最后写清关系后果，不要只登记状态变化。`,
  })
}

function validateSceneConflict(
  scene: ChapterContractValidationSceneSnapshot,
  sceneParagraphs: string[],
  fallbackParagraphs: string[],
): ContractValidationItem {
  const targetParagraphs = sceneParagraphs.length > 0 ? sceneParagraphs : fallbackParagraphs
  const keywords = buildKeywordCandidates(scene.obstacle, scene.sceneGoal)
  const evidence = findBestEvidence(targetParagraphs, keywords, CONFLICT_MARKERS)
  const conflictHits = targetParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, CONFLICT_MARKERS), 0)
  const verdict: ContractValidationVerdict = evidence.hitCount >= Math.max(1, Math.min(2, keywords.length))
    && conflictHits > 0
    ? 'pass'
    : evidence.hitCount > 0 || conflictHits > 0
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'scene_conflict',
    contractItemId: scene.segmentId,
    expected: scene.obstacle || scene.sceneGoal || `${scene.segmentTitle} 需要可见冲突`,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    segmentId: scene.segmentId,
    segmentTitle: scene.segmentTitle,
    rewriteHint: verdict === 'pass'
      ? ''
      : `在“${scene.segmentTitle}”补出可见阻力，至少让角色遭遇一次明确拦截、质问、失手或代价。`,
  })
}

function validateSceneResult(
  scene: ChapterContractValidationSceneSnapshot,
  sceneParagraphs: string[],
  fallbackParagraphs: string[],
): ContractValidationItem {
  const targetParagraphs = sceneParagraphs.length > 0 ? sceneParagraphs : fallbackParagraphs
  const keywords = buildKeywordCandidates(scene.resultState)
  const evidence = findBestEvidence(targetParagraphs, keywords, PROGRESS_MARKERS)
  const verdict: ContractValidationVerdict = evidence.hitCount >= Math.max(1, Math.min(2, keywords.length))
    ? 'pass'
    : evidence.hitCount > 0
      ? 'weak'
      : 'missing'
  return makeItem({
    contractItemType: 'scene_result_state',
    contractItemId: scene.segmentId,
    expected: scene.resultState || `${scene.segmentTitle} 需要明确结果状态`,
    verdict,
    evidenceExcerpt: evidence.excerpt,
    segmentId: scene.segmentId,
    segmentTitle: scene.segmentTitle,
    rewriteHint: verdict === 'pass'
      ? ''
      : `在“${scene.segmentTitle}”结尾补出清晰结果状态，让读者知道这场戏之后到底改变了什么。`,
  })
}

function validateThreadProgress(
  row: typeof storyThreads.$inferSelect,
  paragraphs: string[],
  currentChapterNum: number,
): ContractValidationItem {
  const semantic = analyzeStoryThreadProgress({
    title: row.title,
    currentState: row.currentState,
    payoffCondition: row.payoffCondition,
    summary: row.summary,
    targetPayoffChapter: row.targetPayoffChapter,
    currentChapterNum,
    paragraphs,
  })
  const verdict: ContractValidationVerdict = semantic.state === 'advanced' || semantic.state === 'paid_off'
    ? 'pass'
    : semantic.state === 'mentioned' || semantic.state === 'blocked'
      ? 'weak'
      : 'missing'
  const label = normalizeText(row.title) || `支线 #${row.id}`
  return makeItem({
    contractItemType: 'story_thread_progress',
    contractItemId: row.id,
    expected: label,
    verdict,
    semanticState: semantic.state,
    semanticReason: semantic.reason,
    evidenceExcerpt: semantic.evidenceExcerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : semantic.state === 'blocked'
        ? `“${label}”本章只写了受阻或延期，仍未形成真实推进。补出新的行动、发现或关系后果，或者把它移出本章必须推进项。`
        : semantic.state === 'mentioned'
          ? `“${label}”本章只提及未推进。补一个会改变局面的动作、发现或关系后果，不要只点名。`
          : semantic.state === 'stale'
            ? `“${label}”已经超期且没有有效推进。下一版必须回收、实质推进，或重设目标章位。`
            : `补上“${label}”的真实推进动作，不要让它停留在背景提及。`,
  })
}

function validateForeshadowDelivery(
  row: typeof foreshadowLedger.$inferSelect,
  paragraphs: string[],
  currentChapterNum: number,
): ContractValidationItem {
  const semantic = analyzeForeshadowProgress({
    title: row.title,
    detail: row.detail,
    plantMethod: row.plantMethod,
    payoffMethod: row.payoffMethod,
    payoffSceneAction: row.payoffSceneAction,
    requiredEvidence: row.requiredEvidence,
    readerVisibleOutcome: row.readerVisibleOutcome,
    allowedDelayReason: row.allowedDelayReason,
    targetPayoffChapter: row.targetPayoffChapter,
    currentChapterNum,
    paragraphs,
  })
  const verdict: ContractValidationVerdict = semantic.state === 'advanced' || semantic.state === 'paid_off' || semantic.state === 'blocked'
    ? 'pass'
    : semantic.state === 'mentioned'
      ? semantic.overdue ? 'missing' : 'weak'
      : 'missing'
  const label = normalizeText(row.title) || `伏笔 #${row.id}`
  const expected = [
    label,
    row.payoffSceneAction ? `动作=${normalizeText(row.payoffSceneAction)}` : '',
    row.requiredEvidence ? `证据=${normalizeText(row.requiredEvidence)}` : '',
    row.readerVisibleOutcome ? `结果=${normalizeText(row.readerVisibleOutcome)}` : '',
  ].filter(Boolean).join(' · ')
  return makeItem({
    contractItemType: 'foreshadow_delivery',
    contractItemId: row.id,
    expected: expected || label,
    verdict,
    semanticState: semantic.state,
    semanticReason: semantic.reason,
    evidenceExcerpt: semantic.evidenceExcerpt,
    rewriteHint: verdict === 'pass'
      ? ''
      : semantic.state === 'mentioned'
        ? semantic.overdue
          ? `“${label}”已经超期，但本章只提及未回收。必须兑现动作/证据/结果，或明确写出允许的延期原因。`
          : `“${label}”本章只提及未推进。补出具体回收动作、可见证据或读者可确认的结果。`
        : semantic.state === 'stale'
          ? `“${label}”已经超期且没有有效延期理由。下一版必须回收，或在账本里重设目标章位并补延期原因。`
          : `对“${label}”补一次可见处理：回收动作、证据结果，或明确延期原因。`,
  })
}

function validateChapterHook(
  paragraphs: string[],
  context: ContractValidationContext,
  reviewSignals: ReviewSignalSnapshot,
): ContractValidationItem {
  const tailParagraphs = paragraphs.slice(-Math.min(paragraphs.length, 3))
  const exitHook = context.scenePlanHooks[context.scenePlanHooks.length - 1] || ''
  const expected = exitHook || context.hookType || '章节结尾需要留下明确钩子'
  const hookKeywords = buildKeywordCandidates(exitHook, context.hookType)
  const evidence = findBestEvidence(tailParagraphs, hookKeywords, HOOK_MARKERS)
  const hookMarkerHits = tailParagraphs.reduce((count, paragraph) => count + countMarkers(paragraph, HOOK_MARKERS), 0)
  let verdict: ContractValidationVerdict = evidence.hitCount > 0 || hookMarkerHits >= 2
    ? 'pass'
    : hookMarkerHits > 0
      ? 'weak'
      : 'missing'
  if (verdict === 'pass' && reviewSignals.readerHookRisks.length > 0 && evidence.hitCount === 0) {
    verdict = 'weak'
  }
  return makeItem({
    contractItemType: 'chapter_hook',
    expected,
    verdict,
    evidenceExcerpt: evidence.excerpt || clipExcerpt(tailParagraphs.join(' ')),
    rewriteHint: verdict === 'pass'
      ? ''
      : '把章尾改成未完结的动作、悬念、威胁或新信息，不要平着收束。',
  })
}

export function validateChapterContractDelivery(input: {
  chapterId: number
  content: string
  reviewNotes?: unknown
}): ChapterContractValidationResult {
  const context = loadValidationContext(input.chapterId)
  const reviewSignals = parseReviewSignals(input.reviewNotes)
  const content = normalizeText(input.content)
  const paragraphs = splitIntoParagraphs(content)
  const sceneBuckets = chunkParagraphs(paragraphs, Math.max(context.sceneSnapshots.length, 1))
  const items: ContractValidationItem[] = []

  const goalItem = validateChapterGoal(paragraphs, context)
  if (goalItem) items.push(goalItem)

  items.push(validateChapterTitleAlignment(paragraphs, context))

  const goldenThreeOpeningItem = validateGoldenThreeOpening(paragraphs, context)
  if (goldenThreeOpeningItem) items.push(goldenThreeOpeningItem)

  const themeItem = validateThemeResponse(paragraphs, context)
  if (themeItem) items.push(themeItem)

  context.sceneSnapshots.forEach((scene, index) => {
    const sceneParagraphs = sceneBuckets[index] || []
    items.push(validateSceneConflict(scene, sceneParagraphs, paragraphs))
    items.push(validateSceneResult(scene, sceneParagraphs, paragraphs))
  })

  context.threadRows.forEach((row) => {
    items.push(validateThreadProgress(row, paragraphs, context.currentChapterNum))
  })

  context.foreshadowRows.forEach((row) => {
    items.push(validateForeshadowDelivery(row, paragraphs, context.currentChapterNum))
  })

  const characterNameById = getCharacterNameById(context.characterRows)
  context.characterArcRows.forEach((row) => {
    items.push(validateCharacterScenePayoff(row, paragraphs, characterNameById))
  })

  context.relationshipArcRows.forEach((row) => {
    items.push(validateRelationshipArcGate(row, paragraphs, characterNameById))
  })

  items.push(validateChapterHook(paragraphs, context, reviewSignals))

  const summary = buildSummary(items)
  const status = buildStatus(items)
  const rewriteHints = buildRewriteHints(items)
  return {
    status,
    summary,
    itemResults: items,
    rewriteHints,
  }
}

export function getContractValidationScore(result: ChapterContractValidationResult | null | undefined): number | null {
  if (!result || result.itemResults.length === 0) return null
  const base = Math.round(result.itemResults.reduce((sum, item) => sum + verdictScore(item.verdict), 0) / result.itemResults.length)
  if (result.status === 'blocker') return Math.min(base, 49)
  if (result.status === 'warning') return Math.min(base, 79)
  return base
}
