export type ProjectPlatformMode = 'web_serial' | 'publishing' | 'general'

export interface ProjectBriefDocument {
  platformMode: ProjectPlatformMode | ''
  targetAudience: string
  targetReader: string
  readerPromise: string
  sellingPoints: string
  compTitles: string
  tabooRules: string
  deliveryRhythm: string
}

export interface ProjectBriefSnapshot extends ProjectBriefDocument {
  readyCount: number
}

const EMPTY_PROJECT_BRIEF: ProjectBriefDocument = {
  platformMode: '',
  targetAudience: '',
  targetReader: '',
  readerPromise: '',
  sellingPoints: '',
  compTitles: '',
  tabooRules: '',
  deliveryRhythm: '',
}

const PROJECT_PLATFORM_LABELS: Record<ProjectPlatformMode, string> = {
  general: '通用长篇',
  web_serial: '网文连载',
  publishing: '出版小说',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}

  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return {}
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

export function parseProjectBriefDocument(raw?: string | null): ProjectBriefDocument {
  const root = parseJsonObject(raw)

  return {
    platformMode: asText(root.platform_mode ?? root.platformMode) as ProjectPlatformMode | '',
    targetAudience: asText(root.target_audience ?? root.targetAudience),
    targetReader: asText(root.target_reader ?? root.targetReader),
    readerPromise: asText(root.reader_promise ?? root.readerPromise),
    sellingPoints: asText(root.selling_points ?? root.sellingPoints),
    compTitles: asText(root.comp_titles ?? root.compTitles),
    tabooRules: asText(root.taboo_rules ?? root.tabooRules),
    deliveryRhythm: asText(root.delivery_rhythm ?? root.deliveryRhythm),
  }
}

export function parseProjectBriefSnapshot(raw?: string | null): ProjectBriefSnapshot {
  const document = parseProjectBriefDocument(raw)
  const readyCount = [
    document.platformMode,
    document.targetAudience,
    document.targetReader,
    document.readerPromise,
    document.sellingPoints,
    document.compTitles,
  ].filter(Boolean).length

  return {
    ...EMPTY_PROJECT_BRIEF,
    ...document,
    readyCount,
  }
}

export function buildProjectBriefPayload(
  patch: Partial<ProjectBriefDocument>,
  existingRaw?: string | null,
): string {
  const current = parseProjectBriefDocument(existingRaw)
  const next = {
    ...current,
    ...patch,
  }

  return JSON.stringify(compactObject({
    platform_mode: next.platformMode,
    target_audience: next.targetAudience,
    target_reader: next.targetReader,
    reader_promise: next.readerPromise,
    selling_points: next.sellingPoints,
    comp_titles: next.compTitles,
    taboo_rules: next.tabooRules,
    delivery_rhythm: next.deliveryRhythm,
  }))
}

export function buildProjectBriefSummary(projectBrief: ProjectBriefDocument): string {
  return [
    projectBrief.platformMode ? `产品模式：${PROJECT_PLATFORM_LABELS[projectBrief.platformMode]}` : '',
    projectBrief.targetAudience ? `目标赛道：${projectBrief.targetAudience}` : '',
    projectBrief.targetReader ? `目标读者：${projectBrief.targetReader}` : '',
    projectBrief.readerPromise ? `读者承诺：${projectBrief.readerPromise}` : '',
    projectBrief.sellingPoints ? `卖点：${projectBrief.sellingPoints}` : '',
    projectBrief.compTitles ? `参考作品：${projectBrief.compTitles}` : '',
    projectBrief.tabooRules ? `禁区：${projectBrief.tabooRules}` : '',
    projectBrief.deliveryRhythm ? `交付节奏：${projectBrief.deliveryRhythm}` : '',
  ].filter(Boolean).join('\n')
}
