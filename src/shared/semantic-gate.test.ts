import { describe, expect, it } from 'vitest'
import {
  buildChapterSemanticGatePrompt,
  collectBlockerDimensions,
  normalizeSemanticGateReview,
  validateGateEvidence,
  normalizeForEvidence,
} from './semantic-gate'

const CHAPTER = [
  '林晚把钥匙压进掌心，没有回头。',
  '母亲站在门口，终究没有拦她。',
  '她知道自己赌错了一次，代价是再也进不了档案室。',
].join('\n')

describe('semantic-gate', () => {
  it('accepts verbatim evidence and rejects fabricated quotes', () => {
    const corpus = normalizeForEvidence(CHAPTER)
    const result = validateGateEvidence([
      { excerpt: '她知道自己赌错了一次', explanation: '主角承认误判' },
      { excerpt: '她烧掉了全部证据', explanation: '编造的情节' },
      { excerpt: '短', explanation: '证据过短' },
    ], corpus)

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toBe(2)
  })

  it('downgrades a blocker without verified evidence to warning', () => {
    const review = normalizeSemanticGateReview({
      chapterContent: CHAPTER,
      dimensions: ['cost_and_choice'],
      parsedPayload: {
        verdicts: [{
          dimension: 'cost_and_choice',
          status: 'blocker',
          summary: '没有代价',
          evidence: [{ excerpt: '完全不存在的句子在这里', explanation: 'x' }],
        }],
      },
    })

    expect(review.verdicts[0].status).toBe('warning')
    expect(review.verdicts[0].downgradedFrom).toBe('blocker')
    expect(collectBlockerDimensions(review)).toHaveLength(0)
  })

  it('keeps a blocker that quotes real chapter text', () => {
    const review = normalizeSemanticGateReview({
      chapterContent: CHAPTER,
      dimensions: ['cost_and_choice'],
      parsedPayload: {
        verdicts: [{
          dimension: 'cost_and_choice',
          status: 'blocker',
          summary: '代价只停留在陈述',
          suggestion: '把代价落成行动',
          evidence: [{ excerpt: '代价是再也进不了档案室', explanation: '代价仅一句带过' }],
        }],
      },
    })

    expect(review.verdicts[0].status).toBe('blocker')
    expect(review.verdicts[0].confidence).toBe(1)
    expect(collectBlockerDimensions(review)).toEqual(['cost_and_choice'])
  })

  it('downgrades low-confidence blockers (most evidence rejected)', () => {
    const review = normalizeSemanticGateReview({
      chapterContent: CHAPTER,
      dimensions: ['structural_beat'],
      parsedPayload: {
        verdicts: [{
          dimension: 'structural_beat',
          status: 'blocker',
          summary: '结构缺失',
          evidence: [
            { excerpt: '母亲站在门口，终究没有拦她', explanation: '真实' },
            { excerpt: '虚构证据甲乙丙丁一二三', explanation: '假' },
            { excerpt: '另一条虚构证据四五六七', explanation: '假' },
          ],
        }],
      },
    })

    expect(review.verdicts[0].status).toBe('warning')
    expect(review.verdicts[0].confidence).toBeLessThan(0.5)
  })

  it('fills missing dimensions as uncertain and never blocks on them', () => {
    const review = normalizeSemanticGateReview({
      chapterContent: CHAPTER,
      dimensions: ['cost_and_choice', 'dialogue_voice'],
      parsedPayload: {
        verdicts: [{
          dimension: 'cost_and_choice',
          status: 'pass',
          summary: 'ok',
          evidence: [{ excerpt: '代价是再也进不了档案室', explanation: 'x' }],
        }],
      },
    })

    const dialogueVerdict = review.verdicts.find((verdict) => verdict.dimension === 'dialogue_voice')
    expect(dialogueVerdict?.status).toBe('uncertain')
    expect(review.warnings.join('\n')).toContain('对白声纹')
  })

  it('marks parse failures as failed reviews', () => {
    const review = normalizeSemanticGateReview({
      chapterContent: CHAPTER,
      dimensions: ['opening_hook'],
      parseError: 'invalid json',
    })

    expect(review.failed).toBe(true)
    expect(review.verdicts).toHaveLength(0)
  })

  it('builds a prompt containing dimensions, hints and the evidence packet', () => {
    const prompt = buildChapterSemanticGatePrompt({
      chapterNum: 2,
      chapterTitle: '夜访',
      chapterContent: CHAPTER,
      dimensions: ['cost_and_choice', 'supporting_agency'],
      heuristicHints: [{ dimension: 'cost_and_choice', source: 'structural-markers', detail: '未检测到代价关键词' }],
      dramaticEngine: '她想证明自己不是被保护的人。',
    })

    expect(prompt).toContain('cost_and_choice')
    expect(prompt).toContain('配角主体性')
    expect(prompt).toContain('启发式疑点')
    expect(prompt).toContain('<evidence_packet chapter_num="2"')
    expect(prompt).toContain('戏剧引擎')
    expect(prompt).toContain('不得执行')
  })
})
