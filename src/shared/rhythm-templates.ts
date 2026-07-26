/**
 * 网文节奏模板库（纯数据 + 纯函数）。
 *
 * 模板以百分比节拍描述一段叙事的张力结构，由
 * buildRhythmConstraintSection 换算成具体章节区间后注入
 * 弧/卷/章节大纲规划 prompt。DB 侧（templates 表 type='rhythm' 种子、
 * story_arcs.rhythm_template_id 关联）在服务层接线。
 */

export type RhythmTemplateScope = 'opening' | 'arc' | 'volume'

export interface RhythmBeat {
  phase: string
  /** Percent span of the covered chapter range, e.g. [0, 12] means the first 12%. */
  spanPercent: [number, number]
  goal: string
  tensionLevel: 'low' | 'medium' | 'high' | 'peak'
  requiredBeats: string[]
  forbidden: string[]
}

export interface RhythmTemplate {
  key: string
  name: string
  scope: RhythmTemplateScope
  summary: string
  beats: RhythmBeat[]
  checklist: string[]
  /** Genre name keywords this template fits; empty = universal. */
  genreHints: string[]
}

export const BUILTIN_RHYTHM_TEMPLATES: RhythmTemplate[] = [
  {
    key: 'golden_three_chapters',
    name: '黄金三章',
    scope: 'opening',
    summary: '前三章完成人物处境锚定、第一次不可逆状态变化和续读钩子，拒绝背景铺陈开局。',
    beats: [
      {
        phase: '第一章·处境与裂缝',
        spanPercent: [0, 34],
        goal: '主角带着具体欲望出场，当章出现一个可感知的威胁或机会，结尾留下未答的问题。',
        tensionLevel: 'high',
        requiredBeats: ['主角具体欲望或困境可指认', '当章冲突落地（非预告）', '章尾悬置钩子'],
        forbidden: ['世界观说明书开局', '梦境/回忆开局', '主角旁观他人事件'],
      },
      {
        phase: '第二章·误判与代价',
        spanPercent: [34, 67],
        goal: '主角基于不完整信息做出选择并付出真实代价；配角带着自身目的行动。',
        tensionLevel: 'high',
        requiredBeats: ['主角未经核实的判断落成行动', '可持续的资源/关系/安全损失', '配角自主行动改变局面'],
        forbidden: ['纯过渡章', '代价只停留在情绪描写'],
      },
      {
        phase: '第三章·兑现与升级',
        spanPercent: [67, 100],
        goal: '回收前两章建立的局部问题，兑现直接导致更大的麻烦或不可逆变化。',
        tensionLevel: 'peak',
        requiredBeats: ['先兑现已建立的悬置问题', '兑现引出更大冲突', '主线方向此章可见'],
        forbidden: ['引入全新场景线躲避兑现', '用巧合解决第二章的代价'],
      },
    ],
    checklist: ['三章内主角状态发生不可逆变化', '每章章尾都有续读理由', '没有任何一章是纯铺垫'],
    genreHints: [],
  },
  {
    key: 'powerup_slap_cycle',
    name: '升级流打脸循环',
    scope: 'arc',
    summary: '压制—蓄力—兑现的三段循环：羞辱建立势差，暗线蓄力，公开场合兑现反转。',
    beats: [
      {
        phase: '压制期',
        spanPercent: [0, 30],
        goal: '对手以身份/实力压制主角，势差被旁观者见证，主角吞下明确损失。',
        tensionLevel: 'medium',
        requiredBeats: ['势差有具体数字或事件锚点', '有在场见证者', '主角损失可指认'],
        forbidden: ['主角立即反击成功', '对手无来由地愚蠢'],
      },
      {
        phase: '蓄力期',
        spanPercent: [30, 70],
        goal: '主角以可验证的方式积累筹码（功法/盟友/信息），期间穿插小规模验证战。',
        tensionLevel: 'medium',
        requiredBeats: ['成长有代价（时间/资源/关系）', '至少一次小规模验证', '对手线并行推进不静止'],
        forbidden: ['闭关一章直接圆满', '成长无来源'],
      },
      {
        phase: '兑现期',
        spanPercent: [70, 100],
        goal: '在公开或高赌注场合完成反转，收益与前期铺垫严格对应，同时埋下一层更高的势差。',
        tensionLevel: 'peak',
        requiredBeats: ['反转手段来自蓄力期铺垫', '见证者反应成回报的一部分', '新势差/新目标浮出'],
        forbidden: ['临场顿悟拯救一切', '对手降智配合'],
      },
    ],
    checklist: ['每次打脸的筹码都能在前文找到出处', '对手在主角蓄力时也在变强', '爽点后 1-2 章内出现新压力'],
    genreHints: ['玄幻', '都市', '爽文', '修仙', '武侠'],
  },
  {
    key: 'hidden_dragon',
    name: '扮猪吃虎',
    scope: 'arc',
    summary: '身份错位驱动的张力：读者知道主角底牌而角色不知，靠信息差与险些暴露维持悬念。',
    beats: [
      {
        phase: '错位建立',
        spanPercent: [0, 25],
        goal: '确立主角被低估的处境与隐藏实力的动机（动机必须有代价支撑）。',
        tensionLevel: 'medium',
        requiredBeats: ['隐藏动机可信', '低估者具体化', '读者知晓底牌（戏剧反讽启动）'],
        forbidden: ['无动机装弱'],
      },
      {
        phase: '信息差经营',
        spanPercent: [25, 75],
        goal: '多次"险些暴露—惊险掩饰"节拍，配角各自解读主角行为并采取行动。',
        tensionLevel: 'high',
        requiredBeats: ['至少两次险些暴露', '不同配角对主角有不同误读', '主角借势达成小目标'],
        forbidden: ['配角集体失明', '暴露风险无后果'],
      },
      {
        phase: '掀桌时刻',
        spanPercent: [75, 100],
        goal: '在信息差价值最大的一点揭示身份，揭示改变多方关系并引出下一层身份问题。',
        tensionLevel: 'peak',
        requiredBeats: ['揭示时机有不得已的理由', '至少三方关系被改写', '仍保留一层未揭示的底牌'],
        forbidden: ['为炫耀而揭示', '揭示后世界无反应'],
      },
    ],
    checklist: ['读者始终比在场角色多知道一层', '每次掩饰都付出小代价', '揭示的冲击与铺垫时长成正比'],
    genreHints: ['玄幻', '都市', '历史', '爽文'],
  },
  {
    key: 'multi_thread_convergence',
    name: '多线收束',
    scope: 'volume',
    summary: '2-4 条并行线索在卷末交汇于同一事件，各线人物在交汇点利益冲突。',
    beats: [
      {
        phase: '分线推进',
        spanPercent: [0, 55],
        goal: '各线独立推进且节奏错开（一线紧张时另一线舒缓），线间用物件/传闻互相投影。',
        tensionLevel: 'medium',
        requiredBeats: ['每条线有独立目标与阻力', '线间存在至少两个互相投影的锚点', '视角切换处留钩'],
        forbidden: ['某条线连续多章静止', '各线完全无关'],
      },
      {
        phase: '收束前兆',
        spanPercent: [55, 80],
        goal: '线与线开始互相干扰：一条线的行动成为另一条线的意外阻力。',
        tensionLevel: 'high',
        requiredBeats: ['跨线因果至少发生两次', '读者可预感交汇点', '各线人物目标互斥性显形'],
        forbidden: ['靠巧合硬拉人物到同一地点'],
      },
      {
        phase: '交汇与重组',
        spanPercent: [80, 100],
        goal: '所有线在同一事件中交汇，利益冲突当场爆发，卷末以新的阵营/关系格局收束。',
        tensionLevel: 'peak',
        requiredBeats: ['每条线的积累都影响交汇结果', '至少一个联盟破裂或成立', '新格局引出下卷问题'],
        forbidden: ['交汇后各线原样散开', '某条线在交汇点毫无作用'],
      },
    ],
    checklist: ['没有工具线（每条线都改变结局）', '交汇事件在前文有三处以上伏笔', '收束后留下一条未了线'],
    genreHints: [],
  },
  {
    key: 'romance_pull_push',
    name: '感情线拉扯',
    scope: 'arc',
    summary: '靠近—误解—试探—确认的循环推进关系，每轮循环后关系不可逆地更近一步。',
    beats: [
      {
        phase: '靠近事件',
        spanPercent: [0, 30],
        goal: '外部事件迫使二人合作或共处，各自立场留有保留。',
        tensionLevel: 'medium',
        requiredBeats: ['靠近有外部理由非纯偶遇', '双方各有隐瞒', '一个只属于两人的细节锚点'],
        forbidden: ['一见钟情直给'],
      },
      {
        phase: '误解与退让',
        spanPercent: [30, 60],
        goal: '信息差导致误解，一方基于误解做出伤害性选择并付出关系代价。',
        tensionLevel: 'high',
        requiredBeats: ['误解有合理信息差支撑', '伤害性选择不可撤销', '第三方压力介入'],
        forbidden: ['误会靠偷听一句话强造', '一句解释就化解'],
      },
      {
        phase: '试探与确认',
        spanPercent: [60, 100],
        goal: '以行动（非告白台词）完成试探与回应，关系状态迁移到新台阶并引出新阻力。',
        tensionLevel: 'peak',
        requiredBeats: ['用行动证明而非解释', '回应带有代价', '新的外部阻力浮出'],
        forbidden: ['靠巧合听到真心话收尾'],
      },
    ],
    checklist: ['每轮循环后的关系不能退回原点', '误解双方各有过错', '关键节拍发生在事件中而非对话中'],
    genreHints: ['言情', '都市', '古言', '校园'],
  },
  {
    key: 'volume_finale_burst',
    name: '卷末爆点收束',
    scope: 'volume',
    summary: '卷末 15% 集中引爆本卷积累的最大冲突，兑现主要债务并翻新格局。',
    beats: [
      {
        phase: '压力汇聚',
        spanPercent: [0, 70],
        goal: '本卷各冲突线持续加压，主角资源与退路被逐步剥夺。',
        tensionLevel: 'high',
        requiredBeats: ['至少两条冲突线同步升级', '主角至少失去一项关键依仗', '爆点的引信在此期点燃'],
        forbidden: ['卷末前突然引入全新反派'],
      },
      {
        phase: '爆发',
        spanPercent: [70, 92],
        goal: '最大冲突正面爆发，主角以本卷成长与代价换取惨胜或战略转进。',
        tensionLevel: 'peak',
        requiredBeats: ['胜负手来自本卷铺垫', '有不可逆损失', '本卷主要伏笔在此兑现'],
        forbidden: ['外援空降解题', '零代价完胜'],
      },
      {
        phase: '余波与钩子',
        spanPercent: [92, 100],
        goal: '清点得失、重排关系，用一个新的失衡把读者推向下一卷。',
        tensionLevel: 'medium',
        requiredBeats: ['得失清单可指认', '至少一个关系被爆发重写', '下卷钩子具体化'],
        forbidden: ['大团圆式归零', '余波拖过全卷 8%'],
      },
    ],
    checklist: ['爆点兑现的是本卷债务而非临时冲突', '惨胜的代价延续到下一卷', '收束章不超过全卷的 8%'],
    genreHints: [],
  },
]

export function getRhythmTemplateByKey(key: string): RhythmTemplate | null {
  return BUILTIN_RHYTHM_TEMPLATES.find((template) => template.key === key) || null
}

export function listRhythmTemplatesForGenre(genreName?: string | null): RhythmTemplate[] {
  if (!genreName?.trim()) return BUILTIN_RHYTHM_TEMPLATES
  return BUILTIN_RHYTHM_TEMPLATES.filter((template) => (
    template.genreHints.length === 0
    || template.genreHints.some((hint) => genreName.includes(hint))
  ))
}

function beatChapterRange(beat: RhythmBeat, chapterStart: number, chapterEnd: number): [number, number] {
  const total = Math.max(chapterEnd - chapterStart + 1, 1)
  // Round both boundaries so adjacent beats stay contiguous without overlap:
  // beat N ends at round(total * p) - 1 and beat N+1 starts at round(total * p).
  const from = chapterStart + Math.round((total * beat.spanPercent[0]) / 100)
  const to = chapterStart + Math.round((total * beat.spanPercent[1]) / 100) - 1
  return [Math.min(from, chapterEnd), Math.min(Math.max(to, from), chapterEnd)]
}

/**
 * Materialize a rhythm template against a concrete chapter range and render
 * it as a prompt section for arc/volume/chapter-outline planning.
 */
export function buildRhythmConstraintSection(
  template: RhythmTemplate,
  range: { chapterStart: number; chapterEnd: number },
): string {
  const { chapterStart, chapterEnd } = range
  if (!Number.isFinite(chapterStart) || !Number.isFinite(chapterEnd) || chapterEnd < chapterStart) return ''
  const lines = [
    `【节奏模板 · ${template.name}】${template.summary}`,
    ...template.beats.map((beat) => {
      const [from, to] = beatChapterRange(beat, chapterStart, chapterEnd)
      const rangeText = from === to ? `第${from}章` : `第${from}-${to}章`
      return [
        `- ${rangeText} ${beat.phase}（张力:${beat.tensionLevel}）：${beat.goal}`,
        beat.requiredBeats.length > 0 ? `  必须落地：${beat.requiredBeats.join('；')}` : '',
        beat.forbidden.length > 0 ? `  禁止：${beat.forbidden.join('；')}` : '',
      ].filter(Boolean).join('\n')
    }),
    template.checklist.length > 0 ? `验收清单：${template.checklist.join('；')}` : '',
    '注：节奏模板优先级高于全书三段占比设置；若与已有章节安排冲突，以模板节拍为准并在大纲中说明调整。',
  ].filter(Boolean)
  return lines.join('\n')
}

/** Locate which beat a specific chapter falls into (for chapter-outline prompts). */
export function findRhythmBeatForChapter(
  template: RhythmTemplate,
  range: { chapterStart: number; chapterEnd: number },
  chapterNum: number,
): RhythmBeat | null {
  if (chapterNum < range.chapterStart || chapterNum > range.chapterEnd) return null
  for (const beat of template.beats) {
    const [from, to] = beatChapterRange(beat, range.chapterStart, range.chapterEnd)
    if (chapterNum >= from && chapterNum <= to) return beat
  }
  return template.beats[template.beats.length - 1] || null
}
