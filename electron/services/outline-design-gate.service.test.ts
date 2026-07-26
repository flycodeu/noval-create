import { describe, it, expect, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  analyzeOutlineDesignAlignment,
  extractDesignTerms,
  getUnresolvedDesignGateFlags,
  resolveUnresolvedDesignGateFlag,
  type OutlineDesignGateArc,
  type OutlineDesignGateChapter,
  type StoredOutlineDesignGateRow,
} from './outline-design-gate.service'

// 真实回归案例：novelId 34《淮上新旌》。弧设计的是原创戏（新旌/涡口/义军/查粮/立旗），
// 但章节大纲退化成建炎四年史事编年体（黄天荡/建康/李纲），gate 必须打回。
const shaoSongArc: OutlineDesignGateArc = {
  arcName: '淮上立旌',
  arcGoal: '让新旌从宗室空名变成江北军民愿意暂时相信的秩序。',
  arcSummary: '主角接任、查粮、立旗、整合义军，并以涡口有限胜利证明江北仍可经营。',
  growthLedger: '主角从空头宗室学会用查粮与立旗建立信用。',
  costLedger: '涡口一战折损义军旧部，粮秣被豪强扣押。',
}

const chronicleChapters: OutlineDesignGateChapter[] = [
  { chapterNum: 1, title: '海上回銮', goal: '赵构从海上回到越州，第一次没有下令撤船。', plotPoints: '张浚呈韩世忠折子；赵构不撤船。' },
  { chapterNum: 2, title: '金山设伏', goal: '韩世忠在金山、黄天荡设伏，梁氏擂鼓。', plotPoints: '拒绝完颜宗弼使者；江面拦金军。' },
  { chapterNum: 3, title: '黄天荡裂帆', goal: '完颜宗弼凿渠火攻脱身，韩世忠败中有功。', plotPoints: '赵构赐忠勇；关注岳飞。' },
  { chapterNum: 4, title: '牛头山火起', goal: '岳飞伏击撕开金军退路，收复建康。', plotPoints: '赵构把军纪粮饷写入诏令。' },
]

describe('extractDesignTerms', () => {
  it('从弧文本抽出原创设计词元，过滤通用套话', () => {
    const terms = extractDesignTerms(shaoSongArc)
    expect(terms).toContain('新旌')
    expect(terms).toContain('涡口')
    expect(terms).toContain('义军')
    // 通用词不应作为设计词元
    expect(terms).not.toContain('秩序')
    expect(terms).not.toContain('推进')
    expect(terms).not.toContain('主角')
  })
})

describe('analyzeOutlineDesignAlignment', () => {
  it('史实编年体章节：零设计词命中，gate 打回并给矫正指令', () => {
    const result = analyzeOutlineDesignAlignment(shaoSongArc, chronicleChapters)
    expect(result.judgeable).toBe(true)
    expect(result.passed).toBe(false)
    expect(result.flaggedChapters.length).toBeGreaterThanOrEqual(3)
    expect(result.correctiveDirective).toContain('新旌')
    expect(result.correctiveDirective).toContain('重写')
  })

  it('围绕原创设计展开的章节：gate 放行', () => {
    const designedChapters: OutlineDesignGateChapter[] = [
      { chapterNum: 1, title: '接印查粮', goal: '主角接任新旌，先查江北粮册。', plotPoints: '发现豪强扣粮；立第一条军约。', growthLedger: '学会以查粮建立信用。', costLedger: '得罪本地豪强。' },
      { chapterNum: 2, title: '立旗招抚', goal: '在涡口立新旌旗，招抚散落义军。', plotPoints: '义军旧部试探；主角以粮换忠。', growthLedger: '整合首批义军。', costLedger: '粮秣见底。' },
      { chapterNum: 3, title: '涡口小胜', goal: '以有限兵力在涡口打退金军游骑。', plotPoints: '证明江北可经营；豪强态度松动。', growthLedger: '涡口胜利换来民心。', costLedger: '折损义军旧部十余人。' },
      { chapterNum: 4, title: '信用初立', goal: '新旌从空名变成江北愿意相信的秩序雏形。', plotPoints: '各村送粮；旧官来投。', growthLedger: '建立初步秩序。', costLedger: '树敌更多。' },
    ]
    const result = analyzeOutlineDesignAlignment(shaoSongArc, designedChapters)
    expect(result.judgeable).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.flaggedChapters.length).toBe(0)
    expect(result.correctiveDirective).toBe('')
  })

  it('弧缺少可判定的原创设计词元时，degrade 放行（不误伤）', () => {
    const thinArc: OutlineDesignGateArc = {
      arcName: '成长',
      arcGoal: '主角推进主线，完成成长与蜕变。',
      arcSummary: '主角面对冲突，逐步成长。',
    }
    const result = analyzeOutlineDesignAlignment(thinArc, chronicleChapters)
    expect(result.judgeable).toBe(false)
    expect(result.passed).toBe(true)
  })

  it('账本充实（成长+代价双列）可豁免单章零命中', () => {
    const oneOffChapter: OutlineDesignGateChapter[] = [
      { chapterNum: 1, title: '史实穿插', goal: '一段真实历史事件。', plotPoints: '历史推进。', growthLedger: '主角认知发生真实变化。', costLedger: '付出实打实的资源代价。' },
    ]
    const findings = analyzeOutlineDesignAlignment(
      { ...shaoSongArc },
      [...oneOffChapter, ...chronicleChapters],
    )
    const first = findings.findings.find((f) => f.chapterNum === 1)
    expect(first?.historyRecitalRisk).toBe(false)
  })
})

function buildStoredRow(overrides: Partial<StoredOutlineDesignGateRow> = {}): StoredOutlineDesignGateRow {
  return {
    id: 1,
    arcId: 5,
    batchStart: 1,
    batchEnd: 4,
    passed: 0,
    designTermsJson: JSON.stringify(['新旌', '涡口', '义军']),
    findingsJson: JSON.stringify([
      { chapterNum: 1, title: '海上回銮', hitTerms: [], ledgerStrength: 0, historyRecitalRisk: true },
      { chapterNum: 2, title: '金山设伏', hitTerms: ['新旌'], ledgerStrength: 2, historyRecitalRisk: false },
    ]),
    correctiveDirective: '必须围绕新旌/涡口/义军重写。',
    ...overrides,
  }
}

describe('resolveUnresolvedDesignGateFlag（未消解判定）', () => {
  it('最新记录 passed=0 且本章被点名 → 返回 flag（含设计词元与矫正指令）', () => {
    const flag = resolveUnresolvedDesignGateFlag([buildStoredRow()], 1)
    expect(flag).not.toBeNull()
    expect(flag?.designTerms).toEqual(['新旌', '涡口', '义军'])
    expect(flag?.correctiveDirective).toContain('重写')
    expect(flag?.flaggedChapters).toEqual([1])
  })

  it('本章在批次内但未被点名 → 视为已消解', () => {
    expect(resolveUnresolvedDesignGateFlag([buildStoredRow()], 2)).toBeNull()
  })

  it('同批次重试轮（id 更大）passed=1 覆盖首轮 flagged', () => {
    const rows = [
      buildStoredRow({ id: 1, passed: 0 }),
      buildStoredRow({ id: 2, passed: 1 }),
    ]
    expect(resolveUnresolvedDesignGateFlag(rows, 1)).toBeNull()
  })

  it('章节不在任何批次范围内 → null；损坏的 findings JSON 安全降级为 null', () => {
    expect(resolveUnresolvedDesignGateFlag([buildStoredRow()], 9)).toBeNull()
    expect(resolveUnresolvedDesignGateFlag([buildStoredRow({ findingsJson: '不是JSON' })], 1)).toBeNull()
  })

  it('不同批次的记录互不干扰：取覆盖该章的最新记录', () => {
    const rows = [
      buildStoredRow({ id: 1, batchStart: 1, batchEnd: 4, passed: 0 }),
      buildStoredRow({
        id: 2,
        batchStart: 5,
        batchEnd: 8,
        passed: 1,
        findingsJson: JSON.stringify([]),
      }),
    ]
    expect(resolveUnresolvedDesignGateFlag(rows, 1)).not.toBeNull()
    expect(resolveUnresolvedDesignGateFlag(rows, 5)).toBeNull()
  })
})

describe('getUnresolvedDesignGateFlags（DB 包装）', () => {
  it('查询失败时返回 null（设计传导不阻断正文生成）', () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db unavailable')
    })
    expect(getUnresolvedDesignGateFlags(1, 1)).toBeNull()
  })

  it('从落库记录解析未消解 flag', () => {
    const rows = [buildStoredRow()]
    const query = {
      where: () => query,
      orderBy: () => query,
      all: () => rows,
    }
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => query }),
    } as never)
    const flag = getUnresolvedDesignGateFlags(1, 1)
    expect(flag?.designTerms).toContain('新旌')
  })
})
