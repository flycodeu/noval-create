import type { StyleFingerprint } from '../../src/types'

/** Conservative global fingerprints used when a novel has no style fingerprint. */
export interface GenreVoiceFingerprintSeed {
  name: string
  genreName: string
  fingerprint: StyleFingerprint
}

export const GENRE_VOICE_FINGERPRINT_SEEDS: GenreVoiceFingerprintSeed[] = [
  {
    name: '题材默认 · 玄幻爽文声线',
    genreName: '玄幻修真',
    fingerprint: {
      avgSentenceLength: 16,
      avgParagraphLength: 72,
      dialogueLineRate: 35,
      abstractTokenDensity: 6,
      sentencePatterns: [
        '短句优先，动作句连续推进',
        '长短交替，关键爽点用短句收尾',
        '冲突节点直接落动作和结果，不绕铺垫',
      ],
      wordFrequencyProfile: {},
      narrativeTechniques: '动作驱动叙事，冲突当场兑现，反馈即时可见；少用心理独白，判断落在出手和结果上。',
      dialogueStyle: '对白干脆带锋芒，压制与反压制快速来回，不写寒暄空话。',
      descriptionDensity: '描写偏少，只保留最有压迫感或收益感的细节。',
      paceProfile: '快节奏，段落短促，钩子与爽点前置，章内至少一次可见兑现。',
      toneKeywords: ['利落', '直给', '紧凑', '有锋芒'],
      forbiddenPatterns: [
        '避免总结腔感慨',
        '少用"仿佛/似乎"式虚写',
        '不写空喊口号式燃句',
      ],
      exampleExcerpts: [],
    },
  },
  {
    name: '题材默认 · 历史正剧声线',
    genreName: '历史正剧',
    fingerprint: {
      avgSentenceLength: 26,
      avgParagraphLength: 110,
      dialogueLineRate: 20,
      abstractTokenDensity: 9,
      sentencePatterns: [
        '长句沉稳，从容铺陈',
        '句内多层修饰但层次清楚',
        '大事件前有铺垫，转折靠因果不靠巧合',
      ],
      wordFrequencyProfile: {},
      narrativeTechniques: '场景与制度并写，重因果与权力结构，情绪内收；人物命运镶嵌在时代秩序里。',
      dialogueStyle: '克制书面语，称谓礼制准确，锋芒藏在措辞和留白里。',
      descriptionDensity: '描写厚重，落在典章、器物、地理与人事格局上。',
      paceProfile: '慢热稳进，节奏克制，冲突以积累后爆发为主。',
      toneKeywords: ['沉稳', '克制', '庄重', '有分量'],
      forbiddenPatterns: [
        '避免现代口语与网络词',
        '不写直白心理喊话',
        '少用感叹号',
      ],
      exampleExcerpts: [],
    },
  },
  {
    name: '题材默认 · 都市现实声线',
    genreName: '现代都市',
    fingerprint: {
      avgSentenceLength: 20,
      avgParagraphLength: 90,
      dialogueLineRate: 30,
      abstractTokenDensity: 7,
      sentencePatterns: [
        '中等句长，口语与叙述自然混合',
        '生活化短句点缀，避免整段书面腔',
      ],
      wordFrequencyProfile: {},
      narrativeTechniques: '贴人物视角，用生活细节和利益关系推进事件；情绪从处境和选择里长出来。',
      dialogueStyle: '口语化，带身份差异和现实压力，回避统一腔调。',
      descriptionDensity: '聚焦生活细节锚点：通勤、房租、账单、办公室与饭桌。',
      paceProfile: '中速推进，日常与冲突交替，留出呼吸段。',
      toneKeywords: ['真实', '接地气', '微妙', '琐碎见真'],
      forbiddenPatterns: [
        '避免悬浮金句',
        '不写脱离收入水平的消费细节',
        '少用抽象人生感悟',
      ],
      exampleExcerpts: [],
    },
  },
  {
    name: '题材默认 · 悬疑推理声线',
    genreName: '悬疑推理',
    fingerprint: {
      avgSentenceLength: 17,
      avgParagraphLength: 65,
      dialogueLineRate: 25,
      abstractTokenDensity: 6,
      sentencePatterns: [
        '短段落，信息分段释放',
        '冷句收尾，段末留悬念',
        '异常细节先出现，解释延后',
      ],
      wordFrequencyProfile: {},
      narrativeTechniques: '信息控制优先：线索先于解释，冷叙述不替读者下判断，误导要公平。',
      dialogueStyle: '对白带试探、遮掩和信息差，不轻易翻底牌。',
      descriptionDensity: '环境描写服务线索、风险与不安，不写观光式场景说明。',
      paceProfile: '张弛交替，章节尾留钩，揭示节点前压慢节奏。',
      toneKeywords: ['冷静', '压抑', '警觉', '克制'],
      forbiddenPatterns: [
        '避免提前剧透真相',
        '不用故作玄虚的空悬念',
        '少用感叹式惊呼',
      ],
      exampleExcerpts: [],
    },
  },
]

export interface GenreVoiceSeedInsert {
  name: string
  genreId: number
  fingerprint: StyleFingerprint
}

/**
 * Pure planner for the genre voice seed: matches each seed to a genre id by
 * name and drops seeds whose name already exists among global (novel_id NULL)
 * fingerprints, so running the seed twice inserts nothing new.
 */
export function selectGenreVoiceSeedInserts(
  genres: Array<{ id: number; name: string }>,
  existingSeedNames: Iterable<string>,
): GenreVoiceSeedInsert[] {
  const genreIdByName = new Map(genres.map((genre) => [genre.name.trim(), genre.id]))
  const existing = new Set([...existingSeedNames].map((name) => name.trim()))

  const inserts: GenreVoiceSeedInsert[] = []
  for (const seed of GENRE_VOICE_FINGERPRINT_SEEDS) {
    if (existing.has(seed.name)) continue
    const genreId = genreIdByName.get(seed.genreName)
    if (!genreId) continue
    inserts.push({ name: seed.name, genreId, fingerprint: seed.fingerprint })
  }
  return inserts
}
