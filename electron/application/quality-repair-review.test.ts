import { describe, expect, it } from 'vitest'
import type {
  AgentQualityRepairDraftChapter,
  AgentRepairPlanItem,
} from '../../src/shared/quality-agent-workflow'
import {
  buildQualityRepairReviewPrompt,
  normalizeQualityRepairChapterReview,
} from './quality-repair-review'

const zeroDrift = {
  abstractTokenDensity: 0,
  sentencePatternRepeatRate: 0,
  endingSummaryRate: 0,
  ornamentOverloadRate: 0,
  nonHumanCollocationRate: 0,
  dashDensity: 0,
  parentheticalExplanationDensity: 0,
  metaphorStackRate: 0,
  parallelismRate: 0,
  bodyDetailClicheRate: 0,
  isolatedTemplateParagraphRate: 0,
}

function chapter(): AgentQualityRepairDraftChapter {
  return {
    chapterId: 7,
    chapterNum: 3,
    title: '门后的潮声',
    repairItemIds: ['repair_1'],
    originalContent: '他推开门。潮声很近。',
    originalContentHash: `sha256:${'a'.repeat(64)}`,
    optimizedContent: '他推开门，潮声从走廊尽头压来。他没有后退。',
    optimizedContentHash: `sha256:${'b'.repeat(64)}`,
    changed: true,
    issueSummary: ['补足行动后果'],
    warnings: [],
    factGuard: {
      safeToApply: true,
      warnings: [],
      introducedTrackedEntities: [],
      removedTrackedEntities: [],
      changedNumbers: [],
      endingHookChanged: false,
      aiProcessLeakCount: 0,
    },
    qualityGate: {
      safeToApply: true,
      warnings: [],
      originalGuardrailHits: [],
      optimizedGuardrailHits: [],
      originalStrongAiFlavorCount: 0,
      optimizedStrongAiFlavorCount: 0,
      originalHighSeverityCount: 0,
      optimizedHighSeverityCount: 0,
      originalDriftScore: 0,
      optimizedDriftScore: 0,
      languageDriftBefore: zeroDrift,
      languageDriftAfter: zeroDrift,
    },
    taskId: 10,
  }
}

function item(): AgentRepairPlanItem {
  return {
    id: 'repair_1',
    priority: 1,
    severity: 'critical',
    blocking: true,
    findingIds: ['finding_1'],
    objective: '补足主角面对威胁时的可见行动。',
    rationale: '原稿只有环境描述。',
    targetChapterNums: [3],
    actionRefs: [],
    acceptanceCriteria: ['候选稿出现主角面对威胁的具体行动。'],
    regressionGuards: ['不得改变既有地点与时间顺序。'],
    dependencies: [],
    requiresHumanApproval: true,
  }
}

function passingPayload(): {
  verdict: string
  score: number
  summary: string
  checks: Array<Record<string, unknown>>
  regressions: Array<Record<string, unknown>>
  strengths: string[]
} {
  return {
    verdict: 'pass',
    score: 94,
    summary: '目标完成且没有语义回归。',
    checks: [
      {
        check_id: 'repair_1:acceptance:1',
        status: 'satisfied',
        evidence: ['他没有后退。'],
        rationale: '候选稿补入了面对威胁的行动。',
        recommendation: '',
      },
      {
        check_id: 'repair_1:guard:1',
        status: 'satisfied',
        evidence: ['门与走廊仍处于同一连续场景。'],
        rationale: '地点和时序没有改变。',
        recommendation: '',
      },
    ],
    regressions: [],
    strengths: ['行动与环境压力绑定。'],
  }
}

describe('quality repair independent semantic review', () => {
  it('passes only when every contracted check has evidence from a separate task', () => {
    const result = normalizeQualityRepairChapterReview({
      chapter: chapter(),
      items: [item()],
      reviewTaskId: 20,
      parsedPayload: passingPayload(),
    })

    expect(result.status).toBe('passed')
    expect(result.evidenceCoverageRate).toBe(100)
    expect(result.separateReviewTask).toBe(true)
    expect(result.blockers).toEqual([])
  })

  it('downgrades omitted or evidence-free checks instead of trusting a pass verdict', () => {
    const payload = passingPayload()
    payload.checks = [
      { ...payload.checks[0], evidence: [] },
    ]
    const result = normalizeQualityRepairChapterReview({
      chapter: chapter(),
      items: [item()],
      reviewTaskId: 20,
      parsedPayload: payload,
    })

    expect(result.status).toBe('needs_revision')
    expect(result.evidenceCoverageRate).toBe(0)
    expect(result.checks.every((check) => check.status === 'uncertain')).toBe(true)
  })

  it('blocks critical regressions and incomplete deterministic fact gates', () => {
    const unsafeChapter = chapter()
    unsafeChapter.factGuard.safeToApply = false
    const payload = passingPayload()
    payload.regressions = [{
      category: 'fact',
      severity: 'critical',
      evidence: ['候选稿把第五封信改成第六封。'],
      recommendation: '恢复既有编号。',
    }]
    const result = normalizeQualityRepairChapterReview({
      chapter: unsafeChapter,
      items: [item()],
      reviewTaskId: 20,
      parsedPayload: payload,
    })

    expect(result.status).toBe('blocked')
    expect(result.score).toBeLessThanOrEqual(49)
    expect(result.blockers.join('\n')).toContain('事实差异门未通过')
    expect(result.blockers.join('\n')).toContain('critical fact 回归')

    const prompt = buildQualityRepairReviewPrompt({ chapter: unsafeChapter, items: [item()] })
    expect(prompt.prompt).toContain('不可信小说素材')
    expect(prompt.prompt).toContain('repair_1:guard:1')
    expect(prompt.prompt).toContain('按全文的时间顺序重建状态')
    expect(prompt.prompt).toContain('确定性事实/结构门结果')
  })
})
