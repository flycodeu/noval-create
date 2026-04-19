import type { RevisionTask } from '../../../types'
import type { AiExecutionMode } from '../../../shared/ai-execution'
import { normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from './ai-draft'
import { buildPlanningLintWarnings, summarizeDraftMessages } from './planning-observability'

type Message = { role: 'user' | 'assistant'; content: string }
type GenerationInput = {
  messages: Message[]
  count: number
  modelConfigId?: number
  novelId?: number
  executionMode?: AiExecutionMode
}

interface DraftGenerationOptions {
  genre?: string
}

interface DraftSanitizeResult<T extends object> {
  data: T
  warnings: string[]
}

export interface DraftGenerationObservability {
  inputSummary: string
  lintWarnings: string[]
  rawOutputs: string[]
}

interface DraftGenerationResult<T extends object> {
  outputs: string[]
  payloads: T[]
  warnings: string[]
  observability: DraftGenerationObservability
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function runPageDraftGeneration<T extends object>(
  input: GenerationInput,
  sanitize: (draft: Record<string, unknown>) => DraftSanitizeResult<T>,
  options?: DraftGenerationOptions,
): Promise<DraftGenerationResult<T>> {
  const rawOutputs = await window.electron.ai.runPrompt(input)
  const payloads = rawOutputs.map((raw) => sanitize(parseDraftJson<Record<string, unknown>>(raw)))
  const lintWarnings = buildPlanningLintWarnings(payloads.map((item) => item.data), options?.genre)

  return {
    outputs: payloads.map((item) => JSON.stringify(item.data)),
    payloads: payloads.map((item) => item.data),
    warnings: dedupeStrings([...payloads.flatMap((item) => item.warnings), ...lintWarnings]),
    observability: {
      inputSummary: summarizeDraftMessages(input.messages),
      lintWarnings,
      rawOutputs,
    },
  }
}

export interface OverviewDraftPayload {
  title: string
  synopsis: string
  userBackground: string
  expandedBackground: string
  targetWords?: number
}

export function generateOverviewDraft(input: GenerationInput, options?: DraftGenerationOptions) {
  return runPageDraftGeneration<OverviewDraftPayload>(input, (draft) => {
    const warnings: string[] = []
    const title = typeof draft.title === 'string' ? draft.title.trim() : ''
    if (!title) warnings.push('书名为空，已保留原值。')

    const synopsis = typeof draft.synopsis === 'string' ? draft.synopsis.trim() : ''
    if (!synopsis) warnings.push('一句话简介为空，已保留原值。')

    return {
      data: {
        title,
        synopsis,
        userBackground: typeof draft.userBackground === 'string' ? draft.userBackground.trim() : '',
        expandedBackground: typeof draft.expandedBackground === 'string' ? draft.expandedBackground.trim() : '',
        targetWords: normalizeOptionalNumber(draft.targetWords),
      },
      warnings,
    }
  }, options)
}

export interface OutlineArcDraftPayload {
  arcName: string
  chapterStart?: number
  chapterEnd?: number
  arcGoal: string
  arcSummary: string
  growthLedger: string
  costLedger: string
}

export function generateOutlineArcDraft(input: GenerationInput, existingArcNames: string[], options?: DraftGenerationOptions) {
  const existingKeys = new Set(existingArcNames.map((item) => item.trim()).filter(Boolean))
  return runPageDraftGeneration<OutlineArcDraftPayload>(input, (draft) => {
    const warnings: string[] = []
    const arcName = typeof draft.arcName === 'string' ? draft.arcName.trim() : ''
    if (!arcName) warnings.push('故事弧名称为空，已保留原值。')
    if (arcName && existingKeys.has(arcName)) warnings.push(`故事弧名称“${arcName}”与现有故事弧重名，请复核。`)

    return {
      data: {
        arcName,
        chapterStart: normalizeOptionalNumber(draft.chapterStart),
        chapterEnd: normalizeOptionalNumber(draft.chapterEnd),
        arcGoal: typeof draft.arcGoal === 'string' ? draft.arcGoal.trim() : '',
        arcSummary: typeof draft.arcSummary === 'string' ? draft.arcSummary.trim() : '',
        growthLedger: typeof draft.growthLedger === 'string' ? draft.growthLedger.trim() : '',
        costLedger: typeof draft.costLedger === 'string' ? draft.costLedger.trim() : '',
      },
      warnings,
    }
  }, options)
}

export interface StructureChapterDraftPayload {
  title: string
  outline: string
  targetWords?: number
}

export function generateStructureChapterDraft(input: GenerationInput, options?: DraftGenerationOptions) {
  return runPageDraftGeneration<StructureChapterDraftPayload>(input, (draft) => ({
    data: {
      title: typeof draft.title === 'string' ? draft.title.trim() : '',
      outline: typeof draft.outline === 'string' ? draft.outline.trim() : '',
      targetWords: normalizeOptionalNumber(draft.targetWords),
    },
    warnings: [],
  }), options)
}

export interface StructureSegmentDraftPayload {
  title: string
  segmentType: string
  purpose: string
  timeAnchor: string
  locationName: string
  inputState: string
  outputState: string
  summary: string
  content: string
}

export function generateStructureSegmentDraft(input: GenerationInput, options?: DraftGenerationOptions) {
  return runPageDraftGeneration<StructureSegmentDraftPayload>(input, (draft) => ({
    data: {
      title: typeof draft.title === 'string' ? draft.title.trim() : '',
      segmentType: typeof draft.segmentType === 'string' ? draft.segmentType.trim() : '',
      purpose: typeof draft.purpose === 'string' ? draft.purpose.trim() : '',
      timeAnchor: typeof draft.timeAnchor === 'string' ? draft.timeAnchor.trim() : '',
      locationName: typeof draft.locationName === 'string' ? draft.locationName.trim() : '',
      inputState: typeof draft.inputState === 'string' ? draft.inputState.trim() : '',
      outputState: typeof draft.outputState === 'string' ? draft.outputState.trim() : '',
      summary: typeof draft.summary === 'string' ? draft.summary.trim() : '',
      content: typeof draft.content === 'string' ? draft.content.trim() : '',
    },
    warnings: [],
  }), options)
}

export interface StructureHierarchyPlanSegmentPayload extends StructureSegmentDraftPayload {}

export interface StructureHierarchyPlanChapterPayload {
  title: string
  outline: string
  targetWords?: number
  segments: StructureHierarchyPlanSegmentPayload[]
}

export interface StructureHierarchyPlanPartPayload {
  title: string
  summary: string
  targetWords?: number
  chapters: StructureHierarchyPlanChapterPayload[]
}

export interface StructureHierarchyPlanVolumePayload {
  title: string
  summary: string
  targetWords?: number
  parts: StructureHierarchyPlanPartPayload[]
}

export interface StructureHierarchyPlanPayload {
  summary: string
  volumes: StructureHierarchyPlanVolumePayload[]
}

function sanitizeStructureHierarchyPlan(draft: Record<string, unknown>): DraftSanitizeResult<StructureHierarchyPlanPayload> {
  const warnings: string[] = []
  const rawVolumes = Array.isArray(draft.volumes) ? draft.volumes : []

  const volumes = rawVolumes
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((volume, volumeIndex) => {
      const rawParts = Array.isArray(volume.parts) ? volume.parts : []
      if (!Array.isArray(volume.parts)) warnings.push(`第 ${volumeIndex + 1} 卷缺少 parts，已按空列表处理。`)

      return {
        title: typeof volume.title === 'string' ? volume.title.trim() : `第 ${volumeIndex + 1} 卷`,
        summary: typeof volume.summary === 'string' ? volume.summary.trim() : '',
        targetWords: normalizeOptionalNumber(volume.targetWords),
        parts: rawParts
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
          .map((part, partIndex) => {
            const rawChapters = Array.isArray(part.chapters) ? part.chapters : []

            return {
              title: typeof part.title === 'string' ? part.title.trim() : `第 ${partIndex + 1} 部`,
              summary: typeof part.summary === 'string' ? part.summary.trim() : '',
              targetWords: normalizeOptionalNumber(part.targetWords),
              chapters: rawChapters
                .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
                .map((chapter, chapterIndex) => {
                  const rawSegments = Array.isArray(chapter.segments) ? chapter.segments : []

                  return {
                    title: typeof chapter.title === 'string' ? chapter.title.trim() : `第 ${chapterIndex + 1} 章`,
                    outline: typeof chapter.outline === 'string' ? chapter.outline.trim() : '',
                    targetWords: normalizeOptionalNumber(chapter.targetWords),
                    segments: rawSegments
                      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
                      .map((segment, segmentIndex) => ({
                        title: typeof segment.title === 'string' ? segment.title.trim() : `场景 ${segmentIndex + 1}`,
                        segmentType: typeof segment.segmentType === 'string' ? segment.segmentType.trim() : 'scene',
                        purpose: typeof segment.purpose === 'string' ? segment.purpose.trim() : '',
                        timeAnchor: typeof segment.timeAnchor === 'string' ? segment.timeAnchor.trim() : '',
                        locationName: typeof segment.locationName === 'string' ? segment.locationName.trim() : '',
                        inputState: typeof segment.inputState === 'string' ? segment.inputState.trim() : '',
                        outputState: typeof segment.outputState === 'string' ? segment.outputState.trim() : '',
                        summary: typeof segment.summary === 'string' ? segment.summary.trim() : '',
                        content: typeof segment.content === 'string' ? segment.content.trim() : '',
                      })),
                  }
                }),
            }
          }),
      }
    })

  if (volumes.length === 0) warnings.push('AI 没有返回有效的卷规划，请重试或改小批量。')

  return {
    data: {
      summary: typeof draft.summary === 'string' ? draft.summary.trim() : '',
      volumes,
    },
    warnings,
  }
}

export function generateStructureHierarchyPlan(input: GenerationInput, options?: DraftGenerationOptions) {
  return runPageDraftGeneration<StructureHierarchyPlanPayload>(input, sanitizeStructureHierarchyPlan, options)
}

export interface TimelineDraftPayload {
  eventTitle: string
  eventSummary: string
  timeLabel: string
  timeSortValue?: number
  eventType: string
  protagonistAction: string
  eventCause: string
  eventProcess: string
  eventResult: string
  directConsequences: string[]
  openThreads: string[]
  notes: string
}

export function generateTimelineDraft(input: GenerationInput, options?: DraftGenerationOptions) {
  return runPageDraftGeneration<TimelineDraftPayload>(input, (draft) => ({
    data: {
      eventTitle: typeof draft.eventTitle === 'string' ? draft.eventTitle.trim() : '',
      eventSummary: typeof draft.eventSummary === 'string' ? draft.eventSummary.trim() : '',
      timeLabel: typeof draft.timeLabel === 'string' ? draft.timeLabel.trim() : '',
      timeSortValue: normalizeOptionalNumber(draft.timeSortValue),
      eventType: typeof draft.eventType === 'string' ? draft.eventType.trim() : '',
      protagonistAction: typeof draft.protagonistAction === 'string' ? draft.protagonistAction.trim() : '',
      eventCause: typeof draft.eventCause === 'string' ? draft.eventCause.trim() : '',
      eventProcess: typeof draft.eventProcess === 'string' ? draft.eventProcess.trim() : '',
      eventResult: typeof draft.eventResult === 'string' ? draft.eventResult.trim() : '',
      directConsequences: dedupeStrings(normalizeStringArray(draft.directConsequences)),
      openThreads: dedupeStrings(normalizeStringArray(draft.openThreads)),
      notes: typeof draft.notes === 'string' ? draft.notes.trim() : '',
    },
    warnings: [],
  }), options)
}

export interface RevisionDraftPayload {
  taskType: string
  title: string
  description: string
  fixBrief: string
  status: RevisionTask['status']
  severity: RevisionTask['severity']
  relatedPage: string
}

export function generateRevisionDraft(input: GenerationInput, options?: DraftGenerationOptions) {
  return runPageDraftGeneration<RevisionDraftPayload>(input, (draft) => ({
    data: {
      taskType: typeof draft.taskType === 'string' ? draft.taskType.trim() : '',
      title: typeof draft.title === 'string' ? draft.title.trim() : '',
      description: typeof draft.description === 'string' ? draft.description.trim() : '',
      fixBrief: typeof draft.fixBrief === 'string' ? draft.fixBrief.trim() : '',
      status: (typeof draft.status === 'string' ? draft.status : 'open') as RevisionTask['status'],
      severity: (typeof draft.severity === 'string' ? draft.severity : 'medium') as RevisionTask['severity'],
      relatedPage: typeof draft.relatedPage === 'string' ? draft.relatedPage.trim() : 'writing',
    },
    warnings: [],
  }), options)
}
