export interface LaunchIdeaExtractionResult {
  title: string
  synopsis: string
  protagonistStart: string
  coreHook: string
  coreConflict: string
  tabooRules: string
  endgameDirection: string
  missing: string[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function normalizeMissing(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
}

export function normalizeLaunchIdeaResult(value: unknown): LaunchIdeaExtractionResult {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    title: clip(asText(record.title), 40),
    synopsis: clip(asText(record.synopsis), 240),
    protagonistStart: clip(asText(record.protagonistStart), 180),
    coreHook: clip(asText(record.coreHook), 180),
    coreConflict: clip(asText(record.coreConflict), 220),
    tabooRules: clip(asText(record.tabooRules), 220),
    endgameDirection: clip(asText(record.endgameDirection), 220),
    missing: normalizeMissing(record.missing),
  }
}

export function buildLaunchIdeaMessages(params: {
  genre: string
  idea: string
}): Array<{ role: 'user'; content: string }> {
  return [{
    role: 'user',
    content: [
      '你是一个尊重作者原话的开书编辑。请把作者的一段自然语言灵感，整理成一张可人工复核的开书卡。',
      '这一步是信息抽取和轻整理，不是代作者创作：只使用原文明确提供的信息；没有依据的字段必须留空，并把缺口写进 missing。',
      '保留作者独特的职业、物件、地点、口头表达和具体观察，不要改成“命运、成长、拯救世界”这类泛化文案。',
      '不要擅自新增人名、组织名、能力名、世界规则、反转或结局；不要为了让字段完整而编造。',
      '',
      `题材：${params.genre}`,
      `作者原始描述：${params.idea.trim()}`,
      '',
      '字段说明：',
      '- title：从原文已有的意象、地点、职业或冲突中提炼一个短标题；没有依据就留空。',
      '- synopsis：用 1-2 句说明开局处境、驱动力和眼前阻力；不能扩写后续剧情。',
      '- protagonistStart：主角故事开始时的身份、处境或手上正在做的事。',
      '- coreHook：最早把读者和主角拉进故事的异常、秘密、资源或具体事件。',
      '- coreConflict：主角想要什么，以及谁/什么现实压力阻止他。',
      '- tabooRules：作者明确说“不想出现”“必须避免”的写法或设定；没有就留空。',
      '- endgameDirection：作者明确说出的终局方向或代价；没有就留空。',
      '- missing：仍需要作者决定的关键缺口，只写字段名或简短问题。',
      '',
      '只输出 JSON，不要 Markdown：',
      JSON.stringify({
        title: '',
        synopsis: '',
        protagonistStart: '',
        coreHook: '',
        coreConflict: '',
        tabooRules: '',
        endgameDirection: '',
        missing: [],
      }),
    ].join('\n'),
  }]
}
