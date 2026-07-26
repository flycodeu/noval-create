/**
 * 弧 → 章 设计校验 gate（P0）
 *
 * 目的：防止章节大纲退化成“史实/大事记时间线”。每个故事弧承载的是原创设计
 * （arc_goal / arc_summary / 成长账本 / 代价账本里点名的独有目标、组织、地点、
 * 人物、筹码）。如果一批章节大纲里出现大量“纯史实节点、零弧推进”的章，说明
 * 下游把弧的设计架空了，必须打回重写。
 *
 * 判定（analyzeOutlineDesignAlignment）完全离线（无模型、无 DB），可单测。
 * 文件尾部另有结果落库与“未消解 flagged 记录”查询：持久化到
 * outline_design_gate_results，供章节流水线把设计词元与矫正指令传导到正文生成。
 */

import { desc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { outlineDesignGateResults } from '../database/schema'

export interface OutlineDesignGateArc {
  arcName?: string | null
  arcGoal?: string | null
  arcSummary?: string | null
  growthLedger?: string | null
  costLedger?: string | null
}

export interface OutlineDesignGateChapter {
  chapterNum: number
  title?: string | null
  goal?: string | null
  plotPoints?: string | null
  growthLedger?: string | null
  costLedger?: string | null
}

export interface OutlineChapterFinding {
  chapterNum: number
  title: string
  hitTerms: string[]
  ledgerStrength: number
  historyRecitalRisk: boolean
}

export interface OutlineDesignGateResult {
  /** 是否有足够的原创设计词元来做判定；不足时 gate 自动放行（degrade to pass）。*/
  judgeable: boolean
  passed: boolean
  designTerms: string[]
  findings: OutlineChapterFinding[]
  flaggedChapters: number[]
  /** 给下一轮大纲生成用的矫正指令；passed 时为空串。*/
  correctiveDirective: string
  summary: string
}

// 抽象/通用叙事词，不能算“原创设计”命中，否则任何章都能靠套话蒙混过关。
// 抽词时也用它们做切分边界，把弧文本切成有信息量的专有名词块。
const GENERIC_STOPWORDS = [
  '主角', '故事', '推进', '冲突', '矛盾', '目标', '成长', '代价', '变化', '关系',
  '能力', '认知', '责任', '资源', '选择', '秩序', '相信', '证明', '经营', '整合',
  '开始', '结束', '之间', '第一次', '第一', '一次', '有限', '暂时', '愿意', '空名',
  '事件', '战役', '大战', '朝廷', '朝堂', '局面', '压力', '危机', '决定', '命运',
  '真相', '力量', '世界', '规则', '背景', '人物', '登场', '铺垫', '升级', '高潮',
  '收束', '回收', '伏笔', '支线', '主线', '节奏', '阶段', '重建', '发展', '过程',
  '因为', '所以', '如果', '然后', '并且', '但是', '不是', '就是', '这个', '那个',
  '一个', '他们', '自己', '必须', '可以', '需要', '通过', '成为', '面对', '完成',
  '逐步', '蜕变', '胜利', '接任', '仍可', '宗室', '军民', '暂时',
]

// 助词/虚词单字，也用作切分边界。
const PARTICLE_CHARS_SOURCE = '的了在与和及以为对把被从向到之其此这那些是就都要将会已还也又不没有很更最并让把使令'
const PARTICLE_CHAR_SET = new Set(PARTICLE_CHARS_SOURCE.split(''))
const SPLIT_REGEX = new RegExp(`[^一-鿿]+|[${PARTICLE_CHARS_SOURCE}]`, 'g')

function asText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isTrivialLedger(value?: string | null): boolean {
  const text = asText(value)
  if (!text) return true
  const stripped = text.replace(/[\s、,，。;；:：\-—·]/g, '')
  return stripped.length < 3
}

function isDistinctiveTerm(term: string): boolean {
  if (term.length < 2 || term.length > 4) return false
  if (GENERIC_STOPWORDS.includes(term)) return false
  // 纯虚词组合（如“室空”“成江”这类碎片）：首尾都是助词/虚词字，大概率是切分残渣。
  if (term.length === 2 && PARTICLE_CHAR_SET.has(term[0]) && PARTICLE_CHAR_SET.has(term[1])) return false
  return true
}

/**
 * 从弧文本抽取“原创设计词元”。策略：先用通用套话词 + 助词 + 标点把弧文本切成专有名词块
 * （如“新旌”“涡口”“义军”“查粮”“立旗”），块长 <=4 直接留，>4 再切非重叠 2-gram 兜底。
 */
export function extractDesignTerms(arc: OutlineDesignGateArc): string[] {
  const source = [arc.arcName, arc.arcGoal, arc.arcSummary, arc.growthLedger, arc.costLedger]
    .map(asText)
    .filter(Boolean)
    .join('\n')
  if (!source) return []

  // 先用多字通用词打断，再用助词/标点正则切分。
  let normalized = source
  for (const stop of [...GENERIC_STOPWORDS].sort((a, b) => b.length - a.length)) {
    normalized = normalized.split(stop).join('|')
  }
  const segments = normalized.split(SPLIT_REGEX).filter((seg) => seg.length >= 2)

  const freq = new Map<string, number>()
  const bump = (term: string) => {
    if (!isDistinctiveTerm(term)) return
    freq.set(term, (freq.get(term) || 0) + 1)
  }
  for (const seg of segments) {
    if (seg.length <= 4) {
      bump(seg)
    } else {
      for (let i = 0; i + 2 <= seg.length; i += 2) bump(seg.slice(i, i + 2))
    }
  }

  // 频次高、词更长的排前面（信息量优先），收敛到一批。
  return [...freq.keys()]
    .sort((a, b) => (freq.get(b)! - freq.get(a)!) || (b.length - a.length))
    .slice(0, 24)
}

function chapterText(chapter: OutlineDesignGateChapter): string {
  return [chapter.title, chapter.goal, chapter.plotPoints, chapter.growthLedger, chapter.costLedger]
    .map(asText)
    .filter(Boolean)
    .join('\n')
}

export function analyzeOutlineDesignAlignment(
  arc: OutlineDesignGateArc,
  chapters: OutlineDesignGateChapter[],
): OutlineDesignGateResult {
  const designTerms = extractDesignTerms(arc)
  const total = chapters.length

  // 弧本身没有足够的原创设计词元（<3），无法可靠判定“史实 vs 设计”，放行以免误伤。
  if (designTerms.length < 3 || total === 0) {
    return {
      judgeable: false,
      passed: true,
      designTerms,
      findings: chapters.map((c) => ({
        chapterNum: c.chapterNum,
        title: asText(c.title),
        hitTerms: [],
        ledgerStrength: 0,
        historyRecitalRisk: false,
      })),
      flaggedChapters: [],
      correctiveDirective: '',
      summary: designTerms.length < 3
        ? '故事弧缺少可判定的原创设计词元，已跳过设计校验（建议先把 arc_goal / 概述写出独有目标、组织、地点、筹码）。'
        : '本批没有可校验的章节。',
    }
  }

  const findings: OutlineChapterFinding[] = chapters.map((chapter) => {
    const text = chapterText(chapter)
    const hitTerms = designTerms.filter((term) => text.includes(term))
    const ledgerStrength = (isTrivialLedger(chapter.growthLedger) ? 0 : 1) + (isTrivialLedger(chapter.costLedger) ? 0 : 1)
    // 零设计词命中即判为史实复述嫌疑；账本充实（2条）可豁免（说明至少有真实弧推进）。
    const historyRecitalRisk = hitTerms.length === 0 && ledgerStrength < 2
    return {
      chapterNum: chapter.chapterNum,
      title: asText(chapter.title),
      hitTerms,
      ledgerStrength,
      historyRecitalRisk,
    }
  })

  const flagged = findings.filter((f) => f.historyRecitalRisk)
  const flaggedChapters = flagged.map((f) => f.chapterNum)
  // 打回阈值：命中数 >= 2 且占比 >= 40%（单章误报不打回整批）。
  const failThreshold = Math.max(2, Math.ceil(total * 0.4))
  const passed = flagged.length < failThreshold

  let correctiveDirective = ''
  if (!passed) {
    const flaggedList = flagged
      .map((f) => `第${f.chapterNum}章《${f.title || '无标题'}》`)
      .join('、')
    correctiveDirective = [
      `上一轮生成的以下章节只是在复述史实/既定事件，没有承载本弧的原创设计，必须重写：${flaggedList}。`,
      `本弧的原创设计词元（章节必须围绕它们展开，而不是围绕历史事件的时间顺序）：${designTerms.slice(0, 12).join('、')}。`,
      '重写要求：',
      '1. 每一章的 goal 和 plot_points 都要显式推进上述至少一个原创设计元素；只写“某场战役/某个历史事件发生了”不算数。',
      '2. 戏剧含量高的大事件跨 2-4 章拆解，中间插入朝堂博弈、人物关系、支线发酵或后方治理场景，不要一章办完一个历史节点。',
      '3. 章节之间要有轻重节奏差（设置/交锋/反转/兑现/喘息），不要等重事件平铺成编年体。',
    ].join('\n')
  }

  const summary = passed
    ? `设计校验通过：${total} 章中 ${flagged.length} 章有史实复述嫌疑（阈值 ${failThreshold}）。`
    : `设计校验未通过：${total} 章中 ${flagged.length} 章为纯史实节点、零弧推进（阈值 ${failThreshold}），已要求重写。`

  return {
    judgeable: true,
    passed,
    designTerms,
    findings,
    flaggedChapters,
    correctiveDirective,
    summary,
  }
}

// ---------------------------------------------------------------------------
// 结果落库与未消解 flagged 查询（唯一的 DB 访问入口；判定纯函数不依赖以下代码）
// ---------------------------------------------------------------------------

/** outline_design_gate_results 行的最小只读形状（便于纯函数判定与单测）。 */
export interface StoredOutlineDesignGateRow {
  id: number
  arcId: number
  batchStart: number
  batchEnd: number
  passed: number
  designTermsJson: string | null
  findingsJson: string | null
  correctiveDirective: string | null
}

export interface UnresolvedDesignGateFlag {
  arcId: number
  batchStart: number
  batchEnd: number
  designTerms: string[]
  correctiveDirective: string
  flaggedChapters: number[]
}

function parseJsonArraySafe(raw?: string | null): unknown[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseFlaggedChaptersFromFindings(findingsJson?: string | null): number[] {
  return parseJsonArraySafe(findingsJson)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter((item) => item.historyRecitalRisk === true)
    .map((item) => (typeof item.chapterNum === 'number' ? item.chapterNum : 0))
    .filter((num) => num > 0)
}

/**
 * “未消解”判定（纯函数）：取覆盖该章的最新一条记录（同批次重试轮 id 更大，
 * 自然覆盖首轮），该记录 passed=0 且 findings 里本章 historyRecitalRisk=true
 * 时返回 flag；记录已 passed 或本章未被点名则视为已消解。
 */
export function resolveUnresolvedDesignGateFlag(
  rows: StoredOutlineDesignGateRow[],
  chapterNum: number,
): UnresolvedDesignGateFlag | null {
  const latest = [...rows]
    .sort((left, right) => right.id - left.id)
    .find((row) => chapterNum >= row.batchStart && chapterNum <= row.batchEnd)
  if (!latest || latest.passed) return null

  const flaggedChapters = parseFlaggedChaptersFromFindings(latest.findingsJson)
  if (!flaggedChapters.includes(chapterNum)) return null

  return {
    arcId: latest.arcId,
    batchStart: latest.batchStart,
    batchEnd: latest.batchEnd,
    designTerms: parseJsonArraySafe(latest.designTermsJson)
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
    correctiveDirective: (latest.correctiveDirective || '').trim(),
    flaggedChapters,
  }
}

/** 每轮（首轮 retryCount=0 / 重试 retryCount=1）判定结果落库；失败只告警不阻断。 */
export function persistOutlineDesignGateResult(input: {
  novelId: number
  arcId: number
  batchStart: number
  batchEnd: number
  retryCount: number
  result: OutlineDesignGateResult
}): void {
  try {
    const db = getDb()
    db.insert(outlineDesignGateResults).values({
      novelId: input.novelId,
      arcId: input.arcId,
      batchStart: input.batchStart,
      batchEnd: input.batchEnd,
      judgeable: input.result.judgeable ? 1 : 0,
      passed: input.result.passed ? 1 : 0,
      retryCount: input.retryCount,
      designTermsJson: JSON.stringify(input.result.designTerms),
      findingsJson: JSON.stringify(input.result.findings),
      correctiveDirective: input.result.correctiveDirective,
    }).run()
  } catch (error) {
    console.warn('[outline-design-gate] 校验结果落库失败', error)
  }
}

/**
 * 章节流水线入口：本章是否仍处于未消解的设计校验 flagged 记录中。
 * 查询失败一律返回 null（设计传导是增强项，绝不阻断正文生成）。
 */
export function getUnresolvedDesignGateFlags(novelId: number, chapterNum: number): UnresolvedDesignGateFlag | null {
  try {
    const db = getDb()
    const rows = db.select().from(outlineDesignGateResults)
      .where(eq(outlineDesignGateResults.novelId, novelId))
      .orderBy(desc(outlineDesignGateResults.id))
      .all()
    return resolveUnresolvedDesignGateFlag(rows, chapterNum)
  } catch {
    return null
  }
}
