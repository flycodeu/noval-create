import React from 'react'
import { Alert, Button, Drawer, Dropdown, Form, Input, InputNumber, Modal, Progress, Segmented, Space, Spin, Tag, message } from 'antd'
import {
  EllipsisOutlined,
  LinkOutlined,
  MenuOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { parseSceneTemplateStringList } from '../../../shared/scene-templates'
import { useNovelStore } from '../../../stores/novel.store'
import type { SceneTemplate, StructureBatchPlan } from '../../../types'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import {
  generateStructureChapterDraft,
  generateStructureHierarchyPlan,
  generateStructureSegmentDraft,
} from '../shared/planning-ai-service'
import type { StructureHierarchyPlanPayload } from '../shared/planning-ai-service'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import {
  ChapterEditorPanel,
  SegmentEditorPanel,
  StructureChaptersPanel,
  StructureCheckpointsPanel,
  StructureLinkedEventsPanel,
  StructurePartsPanel,
  StructureSegmentsPanel,
  StructureVolumesPanel,
} from './StructurePanels'
import AiPatchEditor from '../components/AiPatchEditor'
import { STRUCTURE_BATCH_CREATE_MAX, useStructureWorkspace } from './useStructureWorkspace'
import { WorkspacePage } from '../components/WorkspaceShell'
import { getChapterLabel, getPartLabel, getSegmentLabel, getVolumeLabel } from '../shared/workspace-utils'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import './index.css'

function summarizeSegments(items: Array<{ segmentOrder: number; title?: string | null; purpose?: string | null }>) {
  return items
    .slice(0, 8)
    .map((item) => `场景 ${item.segmentOrder}：${item.title || item.purpose || '待补充'}`)
    .join('\n')
}

interface StructurePlannerFormValues {
  volumeCount: number
  partsPerVolume: number
  chaptersPerPart: number
  segmentsPerChapter: number
  focus: string
}

type StructurePlannerLimitValues = Pick<
  StructurePlannerFormValues,
  'volumeCount' | 'partsPerVolume' | 'chaptersPerPart' | 'segmentsPerChapter'
>

interface StructurePlannerChunk {
  volumeIndex: number
  partStart: number
  partCount: number
}

interface StructurePlannerProgress {
  current: number
  total: number
  label: string
  createdChapters: number
  createdSegments: number
}

function resolveStructurePlannerLimits(targetWords?: number | null): StructurePlannerLimitValues {
  const words = Number(targetWords || 0)
  if (words >= 1000000) {
    return { volumeCount: 12, partsPerVolume: 8, chaptersPerPart: 24, segmentsPerChapter: 10 }
  }
  if (words >= 500000) {
    return { volumeCount: 10, partsPerVolume: 8, chaptersPerPart: 20, segmentsPerChapter: 10 }
  }
  return { volumeCount: 6, partsPerVolume: 6, chaptersPerPart: 12, segmentsPerChapter: 8 }
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

function resolvePlannerPartChunkSize(values: StructurePlannerLimitValues, targetWords?: number | null): number {
  const words = Number(targetWords || 0)
  const nestedSceneCount = values.chaptersPerPart * values.segmentsPerChapter
  if (words >= 1000000 || nestedSceneCount >= 160) return 1
  if (words >= 500000 || nestedSceneCount >= 90) return 2
  return values.partsPerVolume
}

function buildPlannerChunks(values: StructurePlannerLimitValues, targetWords?: number | null): StructurePlannerChunk[] {
  const partChunkSize = Math.max(1, resolvePlannerPartChunkSize(values, targetWords))
  const chunks: StructurePlannerChunk[] = []
  for (let volumeIndex = 0; volumeIndex < values.volumeCount; volumeIndex += 1) {
    for (let partStart = 0; partStart < values.partsPerVolume; partStart += partChunkSize) {
      chunks.push({
        volumeIndex,
        partStart,
        partCount: Math.min(partChunkSize, values.partsPerVolume - partStart),
      })
    }
  }
  return chunks
}

function describePlannerChunk(chunk: StructurePlannerChunk, isChunked: boolean): string {
  if (!isChunked) return '完整结构'
  const partEnd = chunk.partStart + chunk.partCount
  return `第 ${chunk.volumeIndex + 1} 卷 / 第 ${chunk.partStart + 1}-${partEnd} 部`
}

function clampPlannerValues(
  values: StructurePlannerFormValues,
  limits: StructurePlannerLimitValues,
): StructurePlannerFormValues {
  return {
    ...values,
    volumeCount: Math.max(1, Math.min(limits.volumeCount, Number(values.volumeCount || 1))),
    partsPerVolume: Math.max(1, Math.min(limits.partsPerVolume, Number(values.partsPerVolume || 1))),
    chaptersPerPart: Math.max(1, Math.min(limits.chaptersPerPart, Number(values.chaptersPerPart || 1))),
    segmentsPerChapter: Math.max(1, Math.min(limits.segmentsPerChapter, Number(values.segmentsPerChapter || 1))),
  }
}

function useNarrowStructureLayout() {
  const [narrow, setNarrow] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches)
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 960px)')
    const sync = () => setNarrow(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return narrow
}

export default function StructurePage({ novelId }: { novelId: number }) {
  const workspace = useStructureWorkspace(novelId)
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [plannerForm] = Form.useForm<StructurePlannerFormValues>()
  const [draftWarnings, setDraftWarnings] = React.useState<string[]>([])
  const draftWarningsRef = React.useRef<string[]>([])
  const draftObservabilityRef = React.useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)
  const [batchCreateCount, setBatchCreateCount] = React.useState(3)
  const [plannerOpen, setPlannerOpen] = React.useState(false)
  const [plannerGenerating, setPlannerGenerating] = React.useState(false)
  const [plannerProgress, setPlannerProgress] = React.useState<StructurePlannerProgress | null>(null)
  const [sceneTemplateOpen, setSceneTemplateOpen] = React.useState(false)
  const [sceneTemplateLoading, setSceneTemplateLoading] = React.useState(false)
  const [sceneTemplates, setSceneTemplates] = React.useState<SceneTemplate[]>([])
  const [linkageSummary, setLinkageSummary] = React.useState<Awaited<ReturnType<typeof window.electron.structure.getLinkageSummary>> | null>(null)
  const [linkageSyncing, setLinkageSyncing] = React.useState(false)
  const [editorMode, setEditorMode] = React.useState<'chapter' | 'segment'>('chapter')
  const [navigatorOpen, setNavigatorOpen] = React.useState(false)
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const [batchDrawerOpen, setBatchDrawerOpen] = React.useState(false)
  const [chapterDirty, setChapterDirty] = React.useState(false)
  const [segmentDirty, setSegmentDirty] = React.useState(false)
  const narrowLayout = useNarrowStructureLayout()
  const plannerLimits = React.useMemo(
    () => resolveStructurePlannerLimits(currentNovel?.targetWords),
    [currentNovel?.targetWords],
  )
  const plannerWatchedValues = Form.useWatch([], plannerForm) as Partial<StructurePlannerFormValues> | undefined
  const plannerPreview = React.useMemo(() => {
    const values = clampPlannerValues({
      volumeCount: 1,
      partsPerVolume: 2,
      chaptersPerPart: 4,
      segmentsPerChapter: 3,
      focus: '',
      ...(plannerWatchedValues || {}),
    }, plannerLimits)
    const chunks = buildPlannerChunks(values, currentNovel?.targetWords)
    return {
      values,
      chunkCount: chunks.length,
      chapterCount: values.volumeCount * values.partsPerVolume * values.chaptersPerPart,
      segmentCount: values.volumeCount * values.partsPerVolume * values.chaptersPerPart * values.segmentsPerChapter,
    }
  }, [currentNovel?.targetWords, plannerLimits, plannerWatchedValues])

  const {
    chapterDetail,
    chapterForm,
    chapters,
    checkpointPanelTitle,
    checkpoints,
    currentPart,
    currentVolume,
    editingPartId,
    editingTitle,
    editingVolumeId,
    linked,
    loading,
    parts,
    savingChapter,
    savingSegment,
    segmentDetail,
    segmentForm,
    segments,
    selection,
    timelineFilters,
    volumes,
    canReorderSegments,
    setEditingTitle,
    addChapter,
    addChapters,
    addPart,
    addParts,
    addSegment,
    addSegments,
    addVolume,
    addVolumes,
    cancelRename,
    compileChapter,
    deleteChapter,
    deletePart,
    deleteSegment,
    deleteVolume,
    loadCheckpoints,
    loadLinked,
    loadParts,
    loadChapters,
    loadSegments,
    openCreateEvent,
    openLinkedEvent,
    openWritingPage,
    refreshMemory,
    refreshStructure,
    saveChapter,
    saveRename,
    saveSegment,
    selectChapter,
    selectPart,
    selectSegment,
    selectVolume,
    startRenamePart,
    startRenameVolume,
    handlePartDragEnd,
    handleSegmentDragEnd,
    handleVolumeDragEnd,
  } = workspace
  const applyStructureDraft = React.useCallback((draft: Record<string, unknown>) => {
    if (draft.draftKind === 'segment') {
      const currentValues = segmentForm.getFieldsValue(true)
      segmentForm.setFieldsValue({
        ...currentValues,
        title: typeof draft.title === 'string' ? draft.title : currentValues.title,
        segmentType: typeof draft.segmentType === 'string' ? draft.segmentType : currentValues.segmentType,
        purpose: typeof draft.purpose === 'string' ? draft.purpose : currentValues.purpose,
        timeAnchor: typeof draft.timeAnchor === 'string' ? draft.timeAnchor : currentValues.timeAnchor,
        locationName: typeof draft.locationName === 'string' ? draft.locationName : currentValues.locationName,
        inputState: typeof draft.inputState === 'string' ? draft.inputState : currentValues.inputState,
        outputState: typeof draft.outputState === 'string' ? draft.outputState : currentValues.outputState,
        summary: typeof draft.summary === 'string' ? draft.summary : currentValues.summary,
        content: typeof draft.content === 'string' ? draft.content : currentValues.content,
      })
      setSegmentDirty(true)
      return
    }

    const currentValues = chapterForm.getFieldsValue(true)
    chapterForm.setFieldsValue({
      ...currentValues,
      title: typeof draft.title === 'string' ? draft.title : currentValues.title,
      outline: typeof draft.outline === 'string' ? draft.outline : currentValues.outline,
      targetWords: normalizeOptionalNumber(draft.targetWords ?? currentValues.targetWords) || currentValues.targetWords,
    })
    setChapterDirty(true)
  }, [chapterForm, segmentForm])
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<Record<string, unknown>>({
    novelId,
    pageKey: 'structure',
    applyDraft: applyStructureDraft,
  })

  const loadSceneTemplates = React.useCallback(async () => {
    setSceneTemplateLoading(true)
    try {
      const result = await window.electron.sceneTemplate.query({
        novelId,
        genreId: currentNovel?.genreId,
        page: 1,
        pageSize: 60,
      })
      setSceneTemplates(result.items)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setSceneTemplateLoading(false)
    }
  }, [currentNovel?.genreId, novelId])

  const loadLinkageSummary = React.useCallback(async () => {
    const summary = await window.electron.structure.getLinkageSummary(novelId)
    setLinkageSummary(summary)
    return summary
  }, [novelId])

  React.useEffect(() => {
    if (loading) return
    void loadLinkageSummary().catch(console.error)
  }, [chapters.total, loadLinkageSummary, linked.total, loading, segments.total, volumes.length])

  const applySceneTemplate = React.useCallback((template: SceneTemplate) => {
    const beats = parseSceneTemplateStringList(template.typicalBeatsJson)
    const currentValues = segmentForm.getFieldsValue(true)
    const categoryToSegmentType: Record<SceneTemplate['category'], string> = {
      conflict: 'scene',
      transition: 'bridge',
      revelation: 'reveal',
      bonding: 'scene',
      crisis: 'turn',
      climax: 'climax',
    }
    segmentForm.setFieldsValue({
      ...currentValues,
      title: currentValues.title || template.name,
      segmentType: currentValues.segmentType || categoryToSegmentType[template.category],
      purpose: currentValues.purpose || template.description,
      inputState: currentValues.inputState || beats[0] || '',
      outputState: currentValues.outputState || beats.at(-1) || '',
      summary: currentValues.summary || beats.join(' -> ') || template.description,
    })
    setSegmentDirty(true)
    setSceneTemplateOpen(false)
    message.success(getUserFacingMessage('structure.sceneTemplateApplied'))
  }, [segmentForm])

  const applyHierarchyPlan = React.useCallback(async (values: StructurePlannerFormValues) => {
    const planValues = clampPlannerValues(values, plannerLimits)
    setPlannerGenerating(true)
    setPlannerProgress(null)

    try {
      const chunks = buildPlannerChunks(planValues, currentNovel?.targetWords)
      const isChunked = chunks.length > 1
      const warnings: string[] = []
      const lintWarnings: string[] = []
      const rawOutputs: string[] = []
      let plannedChapterCount = 0
      let plannedSegmentCount = 0
      const combinedPlan: StructureBatchPlan = {
        summary: isChunked ? `分块结构规划：${chunks.length} 个请求` : '',
        volumes: [],
      }

      const countCombinedPlan = () => {
        plannedChapterCount = combinedPlan.volumes.reduce((chapterSum, volume) => (
          chapterSum + volume.parts.reduce((partSum, part) => partSum + part.chapters.length, 0)
        ), 0)
        plannedSegmentCount = combinedPlan.volumes.reduce((segmentSum, volume) => (
          segmentSum + volume.parts.reduce((partSum, part) => (
            partSum + part.chapters.reduce((chapterSum, chapter) => chapterSum + chapter.segments.length, 0)
          ), 0)
        ), 0)
      }

      const normalizePlanVolume = (
        volume: StructureHierarchyPlanPayload['volumes'][number],
        partLimit: number,
      ): StructureBatchPlan['volumes'][number] => ({
        title: volume.title,
        summary: volume.summary,
        targetWords: volume.targetWords,
        status: 'planning',
        parts: volume.parts.slice(0, partLimit).map((part) => ({
          title: part.title,
          summary: part.summary,
          targetWords: part.targetWords,
          status: 'planning',
          chapters: part.chapters.slice(0, planValues.chaptersPerPart).map((chapter) => ({
            title: chapter.title,
            outline: chapter.outline,
            targetWords: chapter.targetWords,
            status: 'outline',
            segments: chapter.segments.slice(0, planValues.segmentsPerChapter).map((segment) => ({
              title: segment.title,
              segmentType: segment.segmentType || 'scene',
              purpose: segment.purpose,
              timeAnchor: segment.timeAnchor,
              locationName: segment.locationName,
              inputState: segment.inputState,
              outputState: segment.outputState,
              summary: segment.summary,
              content: segment.content,
              status: 'planned',
            })),
          })),
        })),
      })

      const collectPlan = (plan: StructureHierarchyPlanPayload | null, chunk: StructurePlannerChunk) => {
        if (!plan || plan.volumes.length === 0) return
        const selectedVolumes = isChunked ? plan.volumes.slice(0, 1) : plan.volumes.slice(0, planValues.volumeCount)

        if (!isChunked) {
          combinedPlan.summary = plan.summary || combinedPlan.summary
          combinedPlan.volumes = selectedVolumes.map((volume) => normalizePlanVolume(volume, planValues.partsPerVolume))
          countCombinedPlan()
          return
        }

        const volume = selectedVolumes[0]
        if (!volume) return
        const normalizedVolume = normalizePlanVolume(volume, chunk.partCount)
        const existingVolume = combinedPlan.volumes[chunk.volumeIndex]
        if (!existingVolume) {
          combinedPlan.volumes[chunk.volumeIndex] = {
            title: normalizedVolume.title || `第 ${chunk.volumeIndex + 1} 卷`,
            summary: normalizedVolume.summary,
            targetWords: normalizedVolume.targetWords,
            status: 'planning',
            parts: normalizedVolume.parts,
          }
        } else {
          existingVolume.title = existingVolume.title || normalizedVolume.title
          existingVolume.summary = [existingVolume.summary, normalizedVolume.summary].filter(Boolean).join('\n')
          existingVolume.targetWords = existingVolume.targetWords || normalizedVolume.targetWords
          existingVolume.parts.push(...normalizedVolume.parts)
        }
        combinedPlan.summary = [combinedPlan.summary, plan.summary].filter(Boolean).join('\n')
        countCombinedPlan()
      }

      const runPlannerChunk = async (chunk: StructurePlannerChunk) => {
        const partEnd = chunk.partStart + chunk.partCount
        const batchLabel = describePlannerChunk(chunk, isChunked)
        const result = await generateStructureHierarchyPlan({
          count: 1,
          messages: buildDraftMessages({
            task: isChunked ? `长篇结构分块规划 · ${batchLabel}` : '长篇结构批量规划',
            mode: 'replace',
            context: [
              { label: '书名', value: currentNovel?.title || '' },
              { label: '题材', value: currentNovel?.genreName || '' },
              { label: '小说简介', value: currentNovel?.synopsis || '' },
              { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
              { label: '目标总字数', value: currentNovel?.targetWords || '' },
              { label: '当前卷数', value: volumes.length },
              { label: '当前部数', value: parts.total },
              { label: '当前章数', value: chapters.total },
              { label: '当前场景数', value: segments.total },
              isChunked ? { label: '全书结构规模', value: `${planValues.volumeCount} 卷，每卷 ${planValues.partsPerVolume} 部，每部 ${planValues.chaptersPerPart} 章，每章 ${planValues.segmentsPerChapter} 场景。` } : { label: '全书结构规模', value: '' },
              isChunked ? { label: '本次分块', value: batchLabel } : { label: '本次分块', value: '' },
            ],
            fields: [
              { key: 'summary', label: '规划摘要', value: '', hint: isChunked ? '概括本分块在全书中的功能，不要概括全书全部细节。' : '先用几句话概括整套卷部章场景结构。' },
              { key: 'volumes', label: '卷结构', type: 'object[]', value: '', hint: '按卷 > 部 > 章 > 场景输出嵌套 JSON。' },
            ],
            requirements: [
              isChunked
                ? `只输出第 ${chunk.volumeIndex + 1} 卷的第 ${chunk.partStart + 1} 至第 ${partEnd} 部；volumes 数组长度必须是 1，parts 数组长度必须是 ${chunk.partCount}。`
                : `严格输出 ${planValues.volumeCount} 卷，每卷 ${planValues.partsPerVolume} 部，每部 ${planValues.chaptersPerPart} 章，每章 ${planValues.segmentsPerChapter} 个场景。`,
              `每部严格输出 ${planValues.chaptersPerPart} 章，每章严格输出 ${planValues.segmentsPerChapter} 个场景。`,
              '所有标题必须像人类编辑写的工作标题，不要写“命运交汇”“最终抉择”这类空泛词。',
              '章节目标和场景作用必须具体，能直接指导后续写作。',
              '这是追加规划，不要重写已经存在的卷部章。',
              isChunked ? '本次只规划指定分块，不要补全其他卷或其他部。' : '',
              values.focus.trim() ? `额外聚焦：${values.focus.trim()}` : '',
              'JSON 结构必须是 { "summary": "", "volumes": [{ "title": "", "summary": "", "targetWords": 0, "parts": [{ "title": "", "summary": "", "targetWords": 0, "chapters": [{ "title": "", "outline": "", "targetWords": 0, "segments": [{ "title": "", "segmentType": "", "purpose": "", "timeAnchor": "", "locationName": "", "inputState": "", "outputState": "", "summary": "", "content": "" }] }] }] }] }。',
            ],
          }),
        }, { genre: currentNovel?.genreName })
        warnings.push(...result.warnings)
        lintWarnings.push(...result.observability.lintWarnings)
        rawOutputs.push(...result.observability.rawOutputs)
        return result.payloads[0] || null
      }

      for (const [chunkIndex, chunk] of chunks.entries()) {
        setPlannerProgress({
          current: chunkIndex,
          total: chunks.length,
          label: describePlannerChunk(chunk, isChunked),
          createdChapters: plannedChapterCount,
          createdSegments: plannedSegmentCount,
        })
        const plan = await runPlannerChunk(chunk)
        collectPlan(plan, chunk)
        setPlannerProgress({
          current: chunkIndex + 1,
          total: chunks.length,
          label: describePlannerChunk(chunk, isChunked),
          createdChapters: plannedChapterCount,
          createdSegments: plannedSegmentCount,
        })
      }

      const combinedWarnings = dedupeStrings(warnings)
      draftWarningsRef.current = combinedWarnings
      draftObservabilityRef.current = {
        inputSummary: isChunked ? `分块结构规划：${chunks.length} 个请求` : '完整结构规划：1 个请求',
        lintWarnings: dedupeStrings(lintWarnings),
        rawOutputs,
      }
      setDraftWarnings(combinedWarnings)

      const appendablePlan: StructureBatchPlan = {
        summary: combinedPlan.summary,
        volumes: combinedPlan.volumes.filter((volume) => volume && volume.parts.length > 0),
      }

      if (plannedChapterCount === 0 || appendablePlan.volumes.length === 0) {
        message.warning(getUserFacingMessage('structure.batchPlanEmpty'))
        return
      }

      setPlannerProgress({
        current: chunks.length,
        total: chunks.length,
        label: '事务落库中',
        createdChapters: plannedChapterCount,
        createdSegments: plannedSegmentCount,
      })
      const applied = await window.electron.structure.applyBatchPlan(novelId, appendablePlan)

      await refreshStructure()
      if (applied.firstChapterId) {
        await selectChapter(applied.firstChapterId)
      }
      setPlannerOpen(false)
      message.success(getUserFacingMessage('structure.batchPlanApplied'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'structure.batchPlanFailed'))
    } finally {
      setPlannerGenerating(false)
      setPlannerProgress(null)
    }
  }, [
    chapters.total,
    currentNovel?.expandedBackground,
    currentNovel?.genreName,
    currentNovel?.synopsis,
    currentNovel?.targetWords,
    currentNovel?.title,
    novelId,
    parts.total,
    plannerLimits,
    refreshStructure,
    segments.total,
    selectChapter,
    volumes.length,
  ])

  const chapterAiActions = chapterDetail ? (
    <Space wrap>
      <AIGenerateButton
        novelId={novelId}
        label="AI 生成章节"
        isJson
        runGeneration={async (input) => {
          const result = await generateStructureChapterDraft(input, { genre: currentNovel?.genreName })
          draftWarningsRef.current = result.warnings
          draftObservabilityRef.current = result.observability
          setDraftWarnings(result.warnings)
          return result.outputs
        }}
        buildMessages={() => {
          const values = chapterForm.getFieldsValue(true)

          return buildDraftMessages({
            task: '章节结构草稿',
            mode: 'replace',
            context: [
              { label: '书名', value: currentNovel?.title || '' },
              { label: '题材', value: currentNovel?.genreName || '' },
              { label: '小说简介', value: currentNovel?.synopsis || '' },
              { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
              { label: '当前卷', value: getVolumeLabel(currentVolume) },
              { label: '当前部', value: getPartLabel(currentPart) },
              { label: '已有场景', value: summarizeSegments(segments.items) },
            ],
            fields: [
              { key: 'title', label: '章节标题', value: values.title, hint: '短而明确，能体现本章推进。' },
              { key: 'outline', label: '章节目标', value: values.outline, hint: '写清本章推进、转折和留下的问题。' },
              { key: 'targetWords', label: '目标字数', type: 'number', value: values.targetWords, hint: '给出合理整数。' },
            ],
            requirements: [
              '不要改动当前卷和当前部的定位。',
              '如果已有场景列表，章节目标必须能覆盖这些场景。',
            ],
          })
        }}
        onResult={(raw) => {
          const draftPayload = parseDraftJson<{ title?: string; outline?: string; targetWords?: number }>(raw)
          const currentValues = chapterForm.getFieldsValue(true)

          const mergedDraft = {
            ...currentValues,
            title: typeof draftPayload.title === 'string' ? draftPayload.title : currentValues.title,
            outline: typeof draftPayload.outline === 'string' ? draftPayload.outline : currentValues.outline,
            targetWords: normalizeOptionalNumber(draftPayload.targetWords ?? currentValues.targetWords) || currentValues.targetWords,
            draftKind: 'chapter',
          }
          applyStructureDraft(mergedDraft)
          void saveAppliedDraft(mergedDraft, draftWarningsRef.current, 'structure', draftObservabilityRef.current || undefined).catch(console.error)
        }}
      />
    </Space>
  ) : null

  const chapterPatchEditor = chapterDetail ? (
    <AiPatchEditor
      compact
      target={{ type: 'structure_chapter', id: chapterDetail.id, novelId }}
      title="定向 AI 修改章节"
      description="只改当前章节标题、目标、摘要或目标字数；确认后写入结构。"
      placeholder="例如：保留章节位置，把本章目标改成更明确的转折：主角救下伤员但暴露补给路线。"
      onApplied={async () => {
        await refreshStructure()
        setChapterDirty(false)
      }}
    />
  ) : null

  const segmentAiActions = segmentDetail ? (
    <Space wrap>
      <Button
        onClick={() => {
          void loadSceneTemplates()
          setSceneTemplateOpen(true)
        }}
      >
        套用场景模板
      </Button>
      <AIGenerateButton
        novelId={novelId}
        label="AI 生成场景"
        isJson
        runGeneration={async (input) => {
          const result = await generateStructureSegmentDraft(input, { genre: currentNovel?.genreName })
          draftWarningsRef.current = result.warnings
          draftObservabilityRef.current = result.observability
          setDraftWarnings(result.warnings)
          return result.outputs
        }}
        buildMessages={() => {
          const values = segmentForm.getFieldsValue(true)

          return buildDraftMessages({
            task: '场景结构草稿',
            mode: 'replace',
            context: [
              { label: '书名', value: currentNovel?.title || '' },
              { label: '题材', value: currentNovel?.genreName || '' },
              { label: '小说简介', value: currentNovel?.synopsis || '' },
              { label: '当前章节', value: getChapterLabel(chapterDetail) },
              { label: '章节目标', value: chapterForm.getFieldValue('outline') },
              { label: '当前场景序号', value: segmentDetail.segmentOrder },
              { label: '同章场景列表', value: summarizeSegments(segments.items) },
            ],
            fields: [
              { key: 'title', label: '场景标题', value: values.title, hint: '一句话点出场景焦点。' },
              { key: 'segmentType', label: '片段类型', value: values.segmentType, hint: '只使用 scene、bridge、turn、reveal、climax 之一。' },
              { key: 'purpose', label: '场景作用', value: values.purpose, hint: '写清这一场为什么存在。' },
              { key: 'timeAnchor', label: '时间锚点', value: values.timeAnchor, hint: '写成可回查的时间描述。' },
              { key: 'locationName', label: '地点', value: values.locationName, hint: '使用当前世界里真实可写的地点。' },
              { key: 'inputState', label: '进入状态', value: values.inputState, hint: '角色进入场景前的状态。' },
              { key: 'outputState', label: '离开状态', value: values.outputState, hint: '场景结束后的状态变化。' },
              { key: 'summary', label: '片段摘要', value: values.summary, hint: '2-3 句写完因果。' },
              { key: 'content', label: '场景正文', value: values.content, hint: '写成可直接进入正文的短场景。' },
            ],
            requirements: [
              '正文必须自然，不要模板腔。',
              '场景内容必须服务当前章节目标。',
            ],
          })
        }}
        onResult={(raw) => {
          const draftPayload = parseDraftJson<{
            title?: string
            segmentType?: string
            purpose?: string
            timeAnchor?: string
            locationName?: string
            inputState?: string
            outputState?: string
            summary?: string
            content?: string
          }>(raw)
          const currentValues = segmentForm.getFieldsValue(true)
          const mergedDraft = {
            ...currentValues,
            title: typeof draftPayload.title === 'string' ? draftPayload.title : currentValues.title,
            segmentType: typeof draftPayload.segmentType === 'string' ? draftPayload.segmentType : currentValues.segmentType,
            purpose: typeof draftPayload.purpose === 'string' ? draftPayload.purpose : currentValues.purpose,
            timeAnchor: typeof draftPayload.timeAnchor === 'string' ? draftPayload.timeAnchor : currentValues.timeAnchor,
            locationName: typeof draftPayload.locationName === 'string' ? draftPayload.locationName : currentValues.locationName,
            inputState: typeof draftPayload.inputState === 'string' ? draftPayload.inputState : currentValues.inputState,
            outputState: typeof draftPayload.outputState === 'string' ? draftPayload.outputState : currentValues.outputState,
            summary: typeof draftPayload.summary === 'string' ? draftPayload.summary : currentValues.summary,
            content: typeof draftPayload.content === 'string' ? draftPayload.content : currentValues.content,
            draftKind: 'segment',
          }
          applyStructureDraft(mergedDraft)
          void saveAppliedDraft(mergedDraft, draftWarningsRef.current, 'structure', draftObservabilityRef.current || undefined).catch(console.error)
        }}
      />
    </Space>
  ) : null

  const segmentPatchEditor = segmentDetail ? (
    <AiPatchEditor
      compact
      target={{ type: 'structure_segment', id: segmentDetail.id, novelId }}
      title="定向 AI 修改场景"
      description="只改当前场景字段；确认后写入结构。"
      placeholder="例如：把这个场景改成更有压迫感的临时救治场面，强化地点、进入状态和离开状态。"
      onApplied={async () => {
        await refreshStructure()
        setSegmentDirty(false)
      }}
    />
  ) : null

  const saveChapterEditor = React.useCallback(async () => {
    const finalData = chapterForm.getFieldsValue(true) as Record<string, unknown>
    const saved = await saveChapter()
    if (!saved) return false
    await finalizeDraft(finalData)
    await clearDraft()
    setChapterDirty(false)
    return true
  }, [chapterForm, clearDraft, finalizeDraft, saveChapter])

  const saveSegmentEditor = React.useCallback(async () => {
    const finalData = segmentForm.getFieldsValue(true) as Record<string, unknown>
    const saved = await saveSegment()
    if (!saved) return false
    await finalizeDraft(finalData)
    await clearDraft()
    setSegmentDirty(false)
    return true
  }, [clearDraft, finalizeDraft, saveSegment, segmentForm])

  const hasUnsavedChanges = editorMode === 'chapter' ? chapterDirty : segmentDirty
  const saveActiveEditor = React.useCallback(
    () => editorMode === 'chapter' ? saveChapterEditor() : saveSegmentEditor(),
    [editorMode, saveChapterEditor, saveSegmentEditor],
  )

  const runGuardedAction = React.useCallback((action: () => void | Promise<void>) => {
    if (!hasUnsavedChanges) {
      void Promise.resolve(action()).catch((error) => {
        console.error(error)
        message.error(getErrorMessage(error, 'common.loadFailed'))
      })
      return
    }
    Modal.confirm({
      title: `${editorMode === 'chapter' ? '章节' : '场景'}还有未保存修改`,
      content: '保存当前对象后再继续，避免刚填写的结构字段丢失。',
      okText: '保存并继续',
      cancelText: '留在当前对象',
      onOk: async () => {
        const saved = await saveActiveEditor()
        if (!saved) throw new Error(getUserFacingMessage('structure.currentObjectSaveFailed'))
        await action()
      },
    })
  }, [editorMode, hasUnsavedChanges, saveActiveEditor])

  const handleEditorModeChange = React.useCallback((value: string | number) => {
    const nextMode = value === 'segment' ? 'segment' : 'chapter'
    if (nextMode === editorMode || (nextMode === 'segment' && !segmentDetail)) return
    runGuardedAction(() => setEditorMode(nextMode))
  }, [editorMode, runGuardedAction, segmentDetail])

  const handleSelectVolume = React.useCallback((volumeId: number) => {
    runGuardedAction(async () => {
      await selectVolume(volumeId)
      setEditorMode('chapter')
    })
  }, [runGuardedAction, selectVolume])

  const handleSelectPart = React.useCallback((partId: number) => {
    runGuardedAction(async () => {
      await selectPart(partId)
      setEditorMode('chapter')
    })
  }, [runGuardedAction, selectPart])

  const handleSelectChapter = React.useCallback((chapterId: number) => {
    runGuardedAction(async () => {
      await selectChapter(chapterId)
      setEditorMode('chapter')
      if (narrowLayout) setNavigatorOpen(false)
    })
  }, [narrowLayout, runGuardedAction, selectChapter])

  const handleSelectSegment = React.useCallback((segmentId: number) => {
    runGuardedAction(async () => {
      await selectSegment(segmentId)
      setEditorMode('segment')
      if (narrowLayout) setNavigatorOpen(false)
    })
  }, [narrowLayout, runGuardedAction, selectSegment])

  React.useEffect(() => {
    setChapterDirty(false)
  }, [chapterDetail?.id])

  React.useEffect(() => {
    setSegmentDirty(false)
  }, [segmentDetail?.id])

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  const handleClear = React.useCallback(() => {
    Modal.confirm({
      title: '清空整套结构？',
      content: '会删除当前小说下的全部卷、部、章、场景和结构检查点。正文不会被删除，但结构锚点会被清空。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.structure.clear(novelId)
          await window.electron.planningDraft.clear(novelId, 'structure')
          setDraftWarnings([])
          draftWarningsRef.current = []
          draftObservabilityRef.current = null
          await clearDraft()
          await refreshStructure()
          notifyWorkspaceMutation()
          message.success(getUserFacingMessage('structure.cleared'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }, [clearDraft, novelId, notifyWorkspaceMutation, refreshStructure])

  const handleSyncLinkage = React.useCallback(async () => {
    setLinkageSyncing(true)
    try {
      const result = await window.electron.structure.syncLinkage(novelId)
      await Promise.all([
        refreshStructure(),
        loadLinkageSummary(),
      ])
      notifyWorkspaceMutation()
      message.success(result.message)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setLinkageSyncing(false)
    }
  }, [loadLinkageSummary, novelId, notifyWorkspaceMutation, refreshStructure])

  React.useEffect(() => {
    registerClearHandler(() => {
      runGuardedAction(handleClear)
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler, runGuardedAction])

  const saveState = (editorMode === 'chapter' ? savingChapter : savingSegment)
    ? 'saving'
    : hasUnsavedChanges ? 'unsaved' : 'saved'

  const navigatorPanel = (
    <div className="novel-structure-navigator" data-structure-hierarchy="volume-part-chapter-segment">
      <div className="novel-structure-navigator__path">
        <span>{getVolumeLabel(currentVolume)}</span>
        <i>›</i>
        <span>{getPartLabel(currentPart)}</span>
        <i>›</i>
        <span>{getChapterLabel(chapterDetail)}</span>
        <i>›</i>
        <span>{getSegmentLabel(segmentDetail)}</span>
      </div>
      <div className="novel-structure-navigator__scroll">
        <StructureVolumesPanel
          volumes={volumes}
          selectedVolumeId={selection.volumeId}
          editingVolumeId={editingVolumeId}
          editingTitle={editingTitle}
          onEditingTitleChange={setEditingTitle}
          onSelectVolume={handleSelectVolume}
          onStartRenameVolume={(volume) => runGuardedAction(() => startRenameVolume(volume))}
          onCancelRename={cancelRename}
          onSaveRename={() => void saveRename()}
          onAddPart={(volumeId) => runGuardedAction(async () => {
            await addPart(volumeId)
            setEditorMode('chapter')
          })}
          onDeleteVolume={(volume) => runGuardedAction(async () => {
            await deleteVolume(volume)
            setEditorMode('chapter')
          })}
          onDragEnd={(result) => runGuardedAction(() => handleVolumeDragEnd(result))}
        />
        <StructurePartsPanel
          currentVolume={currentVolume}
          parts={parts}
          selectedPartId={selection.partId}
          editingPartId={editingPartId}
          editingTitle={editingTitle}
          onEditingTitleChange={setEditingTitle}
          onSelectPart={handleSelectPart}
          onStartRenamePart={(part) => runGuardedAction(() => startRenamePart(part))}
          onCancelRename={cancelRename}
          onSaveRename={() => void saveRename()}
          onDeletePart={(part) => runGuardedAction(async () => {
            await deletePart(part)
            setEditorMode('chapter')
          })}
          onPageChange={(page) => {
            if (selection.volumeId) void loadParts(selection.volumeId, page)
          }}
          onDragEnd={(result) => runGuardedAction(() => handlePartDragEnd(result))}
        />
        <StructureChaptersPanel
          currentPart={currentPart}
          chapters={chapters}
          selectedChapterId={selection.chapterId}
          onSelectChapter={handleSelectChapter}
          onAddChapter={() => runGuardedAction(async () => {
            await addChapter()
            setEditorMode('chapter')
          })}
          onPageChange={(page) => {
            if (selection.partId) void loadChapters(selection.partId, page)
          }}
        />
        <StructureSegmentsPanel
          chapterDetail={chapterDetail}
          segments={segments}
          selectedSegmentId={selection.segmentId}
          canReorderSegments={canReorderSegments}
          onSelectSegment={handleSelectSegment}
          onAddSegment={() => runGuardedAction(async () => {
            await addSegment()
            setEditorMode('segment')
          })}
          onCreateEvent={() => runGuardedAction(openCreateEvent)}
          onDragEnd={(result) => runGuardedAction(() => handleSegmentDragEnd(result))}
          onPageChange={(page) => {
            if (selection.chapterId) void loadSegments(selection.chapterId, page)
          }}
        />
      </div>
    </div>
  )

  const inspectorPanel = (
    <div className="novel-structure-inspector" data-structure-inspector="on-demand">
      <section className="novel-structure-inspector__summary">
        <div>
          <span>结构联动</span>
          <strong>{linkageSummary?.totalGapCount ?? 0}</strong>
          <small>个待处理缺口</small>
        </div>
        <Button size="small" loading={linkageSyncing} onClick={() => void handleSyncLinkage()}>
          一键补齐
        </Button>
      </section>
      {linkageSummary?.totalGapCount ? (
        <details className="novel-structure-inspector__issues">
          <summary>查看联动缺口</summary>
          <div className="novel-note-list">
            {linkageSummary.missingChapterContractLabels.length ? <div className="novel-note-list__item">{`缺章节合同：${linkageSummary.missingChapterContractLabels.join('；')}`}</div> : null}
            {linkageSummary.missingSceneContractLabels.length ? <div className="novel-note-list__item">{`缺场景合同：${linkageSummary.missingSceneContractLabels.join('；')}`}</div> : null}
            {linkageSummary.uncoveredChapterLabels.length ? <div className="novel-note-list__item">{`缺章节锚点：${linkageSummary.uncoveredChapterLabels.join('；')}`}</div> : null}
            {linkageSummary.uncoveredSegmentLabels.length ? <div className="novel-note-list__item">{`缺场景锚点：${linkageSummary.uncoveredSegmentLabels.join('；')}`}</div> : null}
            {linkageSummary.anchorInvalidEventTitles.length ? <div className="novel-note-list__item">{`锚点失效事件：${linkageSummary.anchorInvalidEventTitles.join('；')}`}</div> : null}
          </div>
        </details>
      ) : null}
      <StructureLinkedEventsPanel
        linked={linked}
        timelineFilters={timelineFilters}
        onOpenEvent={openLinkedEvent}
        onPageChange={(page) => void loadLinked(page)}
      />
      <StructureCheckpointsPanel
        title={checkpointPanelTitle}
        checkpoints={checkpoints}
        onPageChange={(page) => void loadCheckpoints(page)}
      />
    </div>
  )

  return (
    <WorkspacePage
      className="novel-structure-page"
      layout="wide"
      title="卷章结构"
      heroVariant="compact"
      actions={(
        <Space wrap className="novel-structure-page__top-actions">
          <Button icon={<PlusOutlined />} onClick={() => runGuardedAction(async () => {
            await addVolume()
            setEditorMode('chapter')
          })}>
            新建卷
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'batch', label: '批量新增' },
                { key: 'planner', label: 'AI 批量规划' },
                { key: 'compile', label: '编译当前章节', disabled: !selection.chapterId },
                { key: 'event', label: '创建关联事件', disabled: !selection.volumeId },
                { key: 'linkage', label: '补齐结构联动' },
                { key: 'memory', label: '刷新检查点' },
                { key: 'refresh', label: '刷新结构' },
                { type: 'divider' },
                { key: 'writing', label: '去正文页', disabled: !selection.chapterId },
              ],
              onClick: ({ key }) => {
                if (key === 'batch') setBatchDrawerOpen(true)
                if (key === 'planner') setPlannerOpen(true)
                if (key === 'compile') runGuardedAction(compileChapter)
                if (key === 'event') runGuardedAction(openCreateEvent)
                if (key === 'linkage') runGuardedAction(handleSyncLinkage)
                if (key === 'memory') runGuardedAction(refreshMemory)
                if (key === 'refresh') runGuardedAction(refreshStructure)
                if (key === 'writing') runGuardedAction(openWritingPage)
              },
            }}
          >
            <Button icon={<EllipsisOutlined />}>更多</Button>
          </Dropdown>
        </Space>
      )}
    >
      {loading ? (
        <div className="novel-empty">
          <Spin />
        </div>
      ) : (
        <div
          className="novel-structure-master-detail"
          data-structure-master-detail="active"
          data-structure-navigator-mode={narrowLayout ? 'drawer' : 'rail'}
          data-structure-unsaved-guard={hasUnsavedChanges ? 'active' : 'inactive'}
        >
          {!narrowLayout ? <aside className="novel-structure-master-detail__rail">{navigatorPanel}</aside> : null}
          <section className="novel-structure-master-detail__detail">
            <header className="novel-structure-detail-bar">
              <div className="novel-structure-detail-bar__identity">
                {narrowLayout ? (
                  <Button data-structure-navigator-trigger icon={<MenuOutlined />} onClick={() => setNavigatorOpen(true)}>
                    层级
                  </Button>
                ) : null}
                <div>
                  <strong>{editorMode === 'chapter' ? getChapterLabel(chapterDetail) : getSegmentLabel(segmentDetail)}</strong>
                  <span>{editorMode === 'chapter' ? getPartLabel(currentPart) : getChapterLabel(chapterDetail)}</span>
                </div>
              </div>
              <div className="novel-structure-detail-bar__actions">
                <span className={`novel-structure-save-state is-${saveState}`} data-structure-save-state={saveState}>
                  {saveState === 'saving' ? '正在保存' : saveState === 'unsaved' ? '有未保存修改' : '已保存'}
                </span>
                <Segmented
                  size="small"
                  value={editorMode}
                  options={[
                    { value: 'chapter', label: '章节' },
                    { value: 'segment', label: '场景', disabled: !segmentDetail },
                  ]}
                  onChange={handleEditorModeChange}
                />
                <Button data-structure-inspector-trigger icon={<LinkOutlined />} onClick={() => setInspectorOpen(true)}>
                  检查器{linkageSummary?.totalGapCount ? ` · ${linkageSummary.totalGapCount}` : ''}
                </Button>
              </div>
            </header>

            {linkageSummary?.totalGapCount ? (
              <button type="button" className="novel-structure-gap-strip" onClick={() => setInspectorOpen(true)}>
                <Tag color="warning">{linkageSummary.totalGapCount} 个联动缺口</Tag>
                <span>{linkageSummary.summary}</span>
              </button>
            ) : null}
            {draftWarnings.length > 0 ? (
              <details className="novel-structure-warning-disclosure">
                <summary>{`${draftWarnings.length} 条 AI 规划提醒`}</summary>
                <div className="novel-note-list">{draftWarnings.map((warning) => <div key={warning} className="novel-note-list__item">{warning}</div>)}</div>
              </details>
            ) : null}
            {draft?.appliedAt ? <div className="novel-structure-draft-state">已恢复未保存结构草稿</div> : null}

            <div className="novel-structure-editor-viewport" data-structure-editor-mode={editorMode}>
              {editorMode === 'chapter' ? (
                <ChapterEditorPanel
                  chapterDetail={chapterDetail}
                  parts={parts}
                  chapterForm={chapterForm}
                  savingChapter={savingChapter}
                  onSaveChapter={() => void saveChapterEditor().catch((error) => {
                    console.error(error)
                    message.error(getErrorMessage(error, 'common.saveFailed'))
                  })}
                  onDeleteChapter={() => runGuardedAction(async () => {
                    await deleteChapter()
                    setEditorMode('chapter')
                  })}
                  onFormChange={() => setChapterDirty(true)}
                  aiActions={chapterAiActions}
                  patchEditor={chapterPatchEditor}
                />
              ) : (
                <SegmentEditorPanel
                  segmentDetail={segmentDetail}
                  selectionSegmentId={selection.segmentId}
                  visibleSegments={segments.items}
                  segmentForm={segmentForm}
                  savingSegment={savingSegment}
                  onSaveSegment={() => void saveSegmentEditor().catch((error) => {
                    console.error(error)
                    message.error(getErrorMessage(error, 'common.saveFailed'))
                  })}
                  onDeleteSegment={() => runGuardedAction(async () => {
                    await deleteSegment()
                    setEditorMode('chapter')
                  })}
                  onFormChange={() => setSegmentDirty(true)}
                  aiActions={segmentAiActions}
                  patchEditor={segmentPatchEditor}
                />
              )}
            </div>
          </section>
        </div>
      )}

      <Drawer
        className="novel-structure-drawer"
        title="卷 / 部 / 章 / 场景"
        placement="left"
        width="min(92vw, 380px)"
        open={narrowLayout && navigatorOpen}
        onClose={() => setNavigatorOpen(false)}
        destroyOnHidden={false}
      >
        {navigatorPanel}
      </Drawer>
      <Drawer
        className="novel-structure-drawer novel-structure-drawer--inspector"
        title="结构检查器"
        placement="right"
        width="min(94vw, 440px)"
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        destroyOnHidden={false}
      >
        {inspectorPanel}
      </Drawer>
      <Drawer
        className="novel-structure-drawer novel-structure-drawer--batch"
        title="批量新增结构"
        placement="right"
        width="min(92vw, 420px)"
        open={batchDrawerOpen}
        onClose={() => setBatchDrawerOpen(false)}
      >
        <div className="novel-structure-batch-drawer">
          <label htmlFor="structure-batch-count">每次新增数量</label>
          <InputNumber
            id="structure-batch-count"
            min={1}
            max={STRUCTURE_BATCH_CREATE_MAX}
            value={batchCreateCount}
            onChange={(value) => setBatchCreateCount(Math.max(1, Math.min(STRUCTURE_BATCH_CREATE_MAX, Number(value) || 1)))}
            className="novel-structure-input-full"
          />
          <div className="novel-structure-batch-drawer__actions">
            <Button icon={<PlusOutlined />} onClick={() => runGuardedAction(async () => {
              await addVolumes(batchCreateCount)
              setEditorMode('chapter')
            })}>批量加卷</Button>
            <Button
              icon={<PlusOutlined />}
              disabled={!selection.volumeId}
              onClick={() => {
                const volumeId = selection.volumeId
                if (volumeId) runGuardedAction(async () => {
                  await addParts(volumeId, batchCreateCount)
                  setEditorMode('chapter')
                })
              }}
            >
              批量加部
            </Button>
            <Button icon={<PlusOutlined />} disabled={!selection.partId} onClick={() => runGuardedAction(async () => {
              await addChapters(batchCreateCount)
              setEditorMode('chapter')
            })}>批量加章</Button>
            <Button icon={<PlusOutlined />} disabled={!selection.chapterId} onClick={() => runGuardedAction(async () => {
              await addSegments(batchCreateCount)
              setEditorMode('segment')
            })}>批量加场景</Button>
          </div>
        </div>
      </Drawer>
      <Modal
        open={plannerOpen}
        title="AI 批量规划卷 / 部 / 章 / 场景"
        forceRender
        okText="追加规划"
        cancelText="取消"
        confirmLoading={plannerGenerating}
        onCancel={() => setPlannerOpen(false)}
        onOk={() => void plannerForm.validateFields().then((values) => runGuardedAction(async () => {
          await applyHierarchyPlan(values)
          setEditorMode('chapter')
        })).catch(() => undefined)}
      >
        <Form
          form={plannerForm}
          layout="vertical"
          initialValues={{
            volumeCount: 1,
            partsPerVolume: 2,
            chaptersPerPart: 4,
            segmentsPerChapter: 3,
            focus: '',
          }}
        >
          <Alert
            className="novel-structure-planner-preview"
            type="info"
            showIcon
            message={`预计生成 ${plannerPreview.chapterCount} 章 / ${plannerPreview.segmentCount} 场景`}
            description={`当前上限：${plannerLimits.volumeCount} 卷、每卷 ${plannerLimits.partsPerVolume} 部、每部 ${plannerLimits.chaptersPerPart} 章、每章 ${plannerLimits.segmentsPerChapter} 场景。将拆成 ${plannerPreview.chunkCount} 个规划请求。`}
          />
          {plannerGenerating && plannerProgress ? (
            <div className="novel-structure-planner-progress">
              <Progress
                percent={Math.round((plannerProgress.current / Math.max(1, plannerProgress.total)) * 100)}
                size="small"
              />
              <div>
                已完成 {plannerProgress.current}/{plannerProgress.total} 个规划请求；当前：{plannerProgress.label}；已生成计划 {plannerProgress.createdChapters} 章 / {plannerProgress.createdSegments} 场景。
              </div>
            </div>
          ) : null}
          <Form.Item name="volumeCount" label="卷数" rules={[{ required: true }]}>
            <InputNumber min={1} max={plannerLimits.volumeCount} className="novel-structure-input-full" />
          </Form.Item>
          <Form.Item name="partsPerVolume" label="每卷部数" rules={[{ required: true }]}>
            <InputNumber min={1} max={plannerLimits.partsPerVolume} className="novel-structure-input-full" />
          </Form.Item>
          <Form.Item name="chaptersPerPart" label="每部章节数" rules={[{ required: true }]}>
            <InputNumber min={1} max={plannerLimits.chaptersPerPart} className="novel-structure-input-full" />
          </Form.Item>
          <Form.Item name="segmentsPerChapter" label="每章场景数" rules={[{ required: true }]}>
            <InputNumber min={1} max={plannerLimits.segmentsPerChapter} className="novel-structure-input-full" />
          </Form.Item>
          <Form.Item name="focus" label="额外聚焦">
            <Input.TextArea
              rows={6}
              placeholder="例如：前两卷重点压主角资源链和关系线，场景必须体现地点/代价/后果，避免空洞标题。"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={sceneTemplateOpen}
        title="套用场景模板"
        footer={null}
        onCancel={() => setSceneTemplateOpen(false)}
        width={720}
      >
        {sceneTemplateLoading ? (
          <Spin />
        ) : (
          <div className="novel-structure-scroll-list">
            {sceneTemplates.map((template) => {
              const beats = parseSceneTemplateStringList(template.typicalBeatsJson)
              return (
                <section key={template.id} className="novel-panel novel-structure-template-card">
                  <div className="novel-structure-template-card__head">
                    <Space wrap>
                      <strong>{template.name}</strong>
                      <Tag>{template.category}</Tag>
                      {template.isBuiltin > 0 ? <Tag color="gold">内置</Tag> : <Tag color="blue">自定义</Tag>}
                    </Space>
                    <Button type="primary" onClick={() => applySceneTemplate(template)}>套用</Button>
                  </div>
                  <div className="novel-structure-template-card__desc">
                    {template.description || '还没有模板说明。'}
                  </div>
                  {beats.length > 0 ? (
                    <div className="novel-structure-template-card__beats">
                      {`典型节拍：${beats.join(' -> ')}`}
                    </div>
                  ) : null}
                </section>
              )
            })}
            {sceneTemplates.length === 0 ? <div className="novel-empty">当前没有可用模板。</div> : null}
          </div>
        )}
      </Modal>
    </WorkspacePage>
  )
}
