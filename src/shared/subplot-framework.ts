export interface SubPlotDraft {
  name: string
  characters: string
  conflict: string
  mainlineLink: string
  endChapter: string
}

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface SubplotGenerationRequest {
  novelId: number
  messages: PromptMessage[]
  expectedCount: number
  existingSubplots: SubPlotDraft[]
  modelConfigId?: number
  batchIndex?: number
  totalBatches?: number
}

export interface SubplotRejection {
  code: 'missing_field' | 'duplicate_name' | 'duplicate_signature' | 'conflict_too_long' | 'mainline_link_too_long'
  message: string
  subplot?: SubPlotDraft
}

export interface SubplotGenerationResult {
  taskId: number
  accepted: SubPlotDraft[]
  rejectedCount: number
  rejectionReasons: string[]
  rawOutput: string
  warningMessage?: string
}

export interface SubplotValidationOptions {
  existingSubplots: SubPlotDraft[]
  expectedCount: number
  maxConflictLength: number
  maxMainlineLinkLength: number
}

export interface SubplotValidationResult {
  accepted: SubPlotDraft[]
  rejected: SubplotRejection[]
  rejectionReasons: string[]
  warningMessage?: string
  fatalMessage?: string
}

export function asSubPlotText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function normalizeSubPlot(item: unknown): SubPlotDraft | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null

  const raw = item as Record<string, unknown>
  const subplot: SubPlotDraft = {
    name: asSubPlotText(raw.name),
    characters: asSubPlotText(raw.characters),
    conflict: asSubPlotText(raw.conflict),
    mainlineLink: asSubPlotText(raw.mainlineLink),
    endChapter: asSubPlotText(raw.endChapter),
  }

  return Object.values(subplot).some(Boolean) ? subplot : null
}

export function stripJsonCodeFence(raw: string): string {
  return raw.replace(/```json|```/gi, '').trim()
}

export function parseSubPlotFrameworkResponse(raw: string): SubPlotDraft[] {
  const cleaned = stripJsonCodeFence(raw)
  const parsed = JSON.parse(cleaned)
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.subPlots)
      ? record.subPlots as unknown[]
      : Array.isArray(record?.items)
        ? record.items as unknown[]
        : [parsed]

  return candidates
    .map(normalizeSubPlot)
    .filter((subplot): subplot is SubPlotDraft => Boolean(subplot))
}

export function normalizeSubplotIdentity(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，。、“”‘’"'？！!?:：;；、（）()《》【】\[\]<>…—\-]/g, '')
}

export function getSubplotSignature(subplot: SubPlotDraft): string {
  return [
    normalizeSubplotIdentity(subplot.name),
    normalizeSubplotIdentity(subplot.conflict),
    normalizeSubplotIdentity(subplot.mainlineLink),
  ].join('|')
}

function aggregateRejectionReasons(rejections: SubplotRejection[]): string[] {
  const counts = new Map<string, number>()
  for (const rejection of rejections) {
    counts.set(rejection.message, (counts.get(rejection.message) || 0) + 1)
  }

  return Array.from(counts.entries()).map(([message, count]) =>
    count > 1 ? `${message} x${count}` : message,
  )
}

function validateSubplotFields(
  subplot: SubPlotDraft,
  options: Pick<SubplotValidationOptions, 'maxConflictLength' | 'maxMainlineLinkLength'>,
): SubplotRejection | null {
  if (!subplot.name || !subplot.characters || !subplot.conflict || !subplot.mainlineLink || !subplot.endChapter) {
    return { code: 'missing_field', message: '字段不完整', subplot }
  }

  if (subplot.conflict.length > options.maxConflictLength) {
    return {
      code: 'conflict_too_long',
      message: `核心冲突过长（>${options.maxConflictLength}字）`,
      subplot,
    }
  }

  if (subplot.mainlineLink.length > options.maxMainlineLinkLength) {
    return {
      code: 'mainline_link_too_long',
      message: `与主线关联过长（>${options.maxMainlineLinkLength}字）`,
      subplot,
    }
  }

  return null
}

export function validateGeneratedSubplots(
  candidates: SubPlotDraft[],
  options: SubplotValidationOptions,
): SubplotValidationResult {
  const accepted: SubPlotDraft[] = []
  const rejected: SubplotRejection[] = []
  const seenNames = new Set(
    options.existingSubplots
      .map((subplot) => normalizeSubplotIdentity(subplot.name))
      .filter(Boolean),
  )
  const seenSignatures = new Set(
    options.existingSubplots
      .map(getSubplotSignature)
      .filter(Boolean),
  )

  for (const subplot of candidates) {
    const fieldIssue = validateSubplotFields(subplot, options)
    if (fieldIssue) {
      rejected.push(fieldIssue)
      continue
    }

    const normalizedName = normalizeSubplotIdentity(subplot.name)
    if (normalizedName && seenNames.has(normalizedName)) {
      rejected.push({ code: 'duplicate_name', message: '名称重复', subplot })
      continue
    }

    const signature = getSubplotSignature(subplot)
    if (signature && seenSignatures.has(signature)) {
      rejected.push({ code: 'duplicate_signature', message: '核心冲突或主线作用重复', subplot })
      continue
    }

    if (normalizedName) seenNames.add(normalizedName)
    if (signature) seenSignatures.add(signature)
    accepted.push(subplot)
  }

  const rejectionReasons = aggregateRejectionReasons(rejected)

  if (accepted.length === 0) {
    return {
      accepted,
      rejected,
      rejectionReasons,
      fatalMessage: rejectionReasons.length > 0
        ? `未找到可保留的支线结果：${rejectionReasons.join('；')}`
        : '未找到可保留的支线结果',
    }
  }

  const warningParts: string[] = []
  if (accepted.length < options.expectedCount) {
    warningParts.push(`仅保留 ${accepted.length}/${options.expectedCount} 条`)
  }
  if (rejectionReasons.length > 0) {
    warningParts.push(`拒绝原因：${rejectionReasons.join('；')}`)
  }

  return {
    accepted,
    rejected,
    rejectionReasons,
    warningMessage: warningParts.length > 0 ? `部分接受：${warningParts.join('；')}` : undefined,
  }
}
