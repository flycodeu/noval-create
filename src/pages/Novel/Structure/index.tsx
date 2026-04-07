import React from 'react'
import { Button, Form, Input, InputNumber, Modal, Space, Spin, Tag, message } from 'antd'
import {
  ApartmentOutlined,
  BranchesOutlined,
  BuildOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { parseSceneTemplateStringList } from '../../../shared/scene-templates'
import { useNovelStore } from '../../../stores/novel.store'
import type { SceneTemplate } from '../../../types'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import {
  generateStructureChapterDraft,
  generateStructureHierarchyPlan,
  generateStructureSegmentDraft,
} from '../shared/planning-ai-service'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import {
  ChapterEditorPanel,
  SegmentEditorPanel,
  StructureAsideTip,
  StructureChaptersPanel,
  StructureCheckpointsPanel,
  StructureLinkedEventsPanel,
  StructurePartsPanel,
  StructureSegmentsPanel,
  StructureVolumesPanel,
} from './StructurePanels'
import { useStructureWorkspace } from './useStructureWorkspace'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage } from '../components/WorkspaceShell'
import { getChapterLabel, getPartLabel, getSegmentLabel, getVolumeLabel } from '../shared/workspace-utils'
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

export default function StructurePage({ novelId }: { novelId: number }) {
  const workspace = useStructureWorkspace(novelId)
  const { currentNovel } = useNovelStore()
  const [plannerForm] = Form.useForm<StructurePlannerFormValues>()
  const [draftWarnings, setDraftWarnings] = React.useState<string[]>([])
  const draftWarningsRef = React.useRef<string[]>([])
  const draftObservabilityRef = React.useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)
  const [batchCreateCount, setBatchCreateCount] = React.useState(3)
  const [plannerOpen, setPlannerOpen] = React.useState(false)
  const [plannerGenerating, setPlannerGenerating] = React.useState(false)
  const [sceneTemplateOpen, setSceneTemplateOpen] = React.useState(false)
  const [sceneTemplateLoading, setSceneTemplateLoading] = React.useState(false)
  const [sceneTemplates, setSceneTemplates] = React.useState<SceneTemplate[]>([])

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
    refreshing,
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
      return
    }

    const currentValues = chapterForm.getFieldsValue(true)
    chapterForm.setFieldsValue({
      ...currentValues,
      title: typeof draft.title === 'string' ? draft.title : currentValues.title,
      outline: typeof draft.outline === 'string' ? draft.outline : currentValues.outline,
      targetWords: normalizeOptionalNumber(draft.targetWords ?? currentValues.targetWords) || currentValues.targetWords,
    })
  }, [chapterForm, segmentForm])
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<Record<string, unknown>>({
    novelId,
    pageKey: 'structure',
    applyDraft: applyStructureDraft,
  })

  React.useEffect(() => {
    plannerForm.setFieldsValue({
      volumeCount: 1,
      partsPerVolume: 2,
      chaptersPerPart: 4,
      segmentsPerChapter: 3,
      focus: '',
    })
  }, [plannerForm])

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
    setSceneTemplateOpen(false)
    message.success('场景模板已套用到当前场景草稿。')
  }, [segmentForm])

  const applyHierarchyPlan = React.useCallback(async (values: StructurePlannerFormValues) => {
    setPlannerGenerating(true)

    try {
      const result = await generateStructureHierarchyPlan({
        count: 1,
        messages: buildDraftMessages({
          task: '长篇结构批量规划',
          mode: 'replace',
          context: [
            { label: '书名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '小说简介', value: currentNovel?.synopsis || '' },
            { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
            { label: '当前卷数', value: volumes.length },
            { label: '当前部数', value: parts.total },
            { label: '当前章数', value: chapters.total },
            { label: '当前场景数', value: segments.total },
          ],
          fields: [
            { key: 'summary', label: '规划摘要', value: '', hint: '先用几句话概括整套卷部章场景结构。' },
            { key: 'volumes', label: '卷结构', value: '', hint: '按卷 > 部 > 章 > 场景输出完整嵌套 JSON。' },
          ],
          requirements: [
            `严格输出 ${values.volumeCount} 卷，每卷 ${values.partsPerVolume} 部，每部 ${values.chaptersPerPart} 章，每章 ${values.segmentsPerChapter} 个场景。`,
            '所有标题必须像人类编辑写的工作标题，不要写“命运交汇”“最终抉择”这类空泛词。',
            '章节目标和场景作用必须具体，能直接指导后续写作。',
            '这是追加规划，不要重写已经存在的卷部章。',
            values.focus.trim() ? `额外聚焦：${values.focus.trim()}` : '',
            'JSON 结构必须是 { "summary": "", "volumes": [{ "title": "", "summary": "", "targetWords": 0, "parts": [{ "title": "", "summary": "", "targetWords": 0, "chapters": [{ "title": "", "outline": "", "targetWords": 0, "segments": [{ "title": "", "segmentType": "", "purpose": "", "timeAnchor": "", "locationName": "", "inputState": "", "outputState": "", "summary": "", "content": "" }] }] }] }] }。',
          ],
        }),
      }, { genre: currentNovel?.genreName })

      setDraftWarnings(result.warnings)
      const plan = result.payloads[0]
      if (!plan || plan.volumes.length === 0) {
        message.warning(getUserFacingMessage('structure.batchPlanEmpty'))
        return
      }

      let firstChapterId: number | null = null

      for (const volume of plan.volumes.slice(0, values.volumeCount)) {
        const volumeId = await window.electron.structure.createVolume(novelId, {
          title: volume.title,
          summary: volume.summary,
          targetWords: volume.targetWords || values.partsPerVolume * values.chaptersPerPart * values.segmentsPerChapter * 3000,
          status: 'planning',
        })

        for (const part of volume.parts.slice(0, values.partsPerVolume)) {
          const partId = await window.electron.structure.createPart(volumeId, {
            title: part.title,
            summary: part.summary,
            targetWords: part.targetWords || values.chaptersPerPart * values.segmentsPerChapter * 3000,
            status: 'planning',
          })

          for (const chapter of part.chapters.slice(0, values.chaptersPerPart)) {
            const chapterId = await window.electron.chapter.create(novelId, {
              volumeId,
              partId,
              title: chapter.title,
              outline: chapter.outline,
              targetWords: chapter.targetWords || values.segmentsPerChapter * 3000,
              status: 'outline',
            })

            if (!firstChapterId) firstChapterId = chapterId

            for (const segment of chapter.segments.slice(0, values.segmentsPerChapter)) {
              await window.electron.structure.createSegment(chapterId, {
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
              })
            }
          }
        }
      }

      await refreshStructure()
      if (firstChapterId) {
        await selectChapter(firstChapterId)
      }
      setPlannerOpen(false)
      message.success(getUserFacingMessage('structure.batchPlanApplied'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'structure.batchPlanFailed'))
    } finally {
      setPlannerGenerating(false)
    }
  }, [
    chapters.total,
    currentNovel?.expandedBackground,
    currentNovel?.genreName,
    currentNovel?.synopsis,
    currentNovel?.title,
    novelId,
    parts.total,
    refreshStructure,
    segments.total,
    selectChapter,
    volumes.length,
  ])

  const chapterAiActions = chapterDetail ? (
    <AIGenerateButton
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

  return (
    <WorkspacePage
      className="novel-structure-page"
      layout="wide"
      eyebrow="结构工程"
      title="卷 / 部 / 章 / 场景"
      description="按路径管理结构，再逐层补全章节和场景。"
      actions={(
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => void addVolume()}>
            新建卷
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setPlannerOpen(true)}>
            AI 批量规划
          </Button>
          <div className="novel-pill" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>新增数量</span>
            <InputNumber
              min={1}
              max={20}
              value={batchCreateCount}
              onChange={(value) => setBatchCreateCount(Math.max(1, Math.min(20, Number(value) || 1)))}
              style={{ width: 88 }}
            />
          </div>
          <Button icon={<PlusOutlined />} onClick={() => void addVolumes(batchCreateCount)}>
            批量加卷
          </Button>
          <Button icon={<PlusOutlined />} disabled={!selection.volumeId} onClick={() => selection.volumeId && void addParts(selection.volumeId, batchCreateCount)}>
            批量加部
          </Button>
          <Button icon={<PlusOutlined />} disabled={!selection.partId} onClick={() => void addChapters(batchCreateCount)}>
            批量加章
          </Button>
          <Button icon={<PlusOutlined />} disabled={!selection.chapterId} onClick={() => void addSegments(batchCreateCount)}>
            批量加场景
          </Button>
          <Button icon={<BuildOutlined />} loading={refreshing} onClick={() => void refreshMemory()}>
            刷新检查点
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshStructure()}>
            刷新结构
          </Button>
          <Button
            type="primary"
            icon={<LinkOutlined />}
            disabled={!selection.volumeId}
            onClick={openCreateEvent}
          >
            创建事件
          </Button>
          <Button
            type="primary"
            icon={<BranchesOutlined />}
            disabled={!selection.chapterId}
            onClick={() => void compileChapter()}
          >
            编译章节
          </Button>
          <Button icon={<ApartmentOutlined />} disabled={!selection.chapterId} onClick={openWritingPage}>
            去正文页
          </Button>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="卷数" value={volumes.length} tone="warm" hint="按阶段组织长篇。" />
          <WorkspaceMetric label="当前部章节" value={chapters.total} hint="当前窗口内的章节数。" />
          <WorkspaceMetric label="当前章场景" value={segments.total} tone="cool" hint="当前章节的最小结构单元。" />
          <WorkspaceMetric label="关联事件" value={linked.total} hint="当前路径上的时间轴事件。" />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前卷', value: getVolumeLabel(currentVolume) },
            { label: '当前部', value: getPartLabel(currentPart) },
            { label: '当前章', value: getChapterLabel(chapterDetail) },
            { label: '当前场景', value: getSegmentLabel(segmentDetail) },
            { label: '定位方式', value: '按路径自动恢复' },
          ]}
        />
      )}
      aside={(
        <>
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
          <StructureAsideTip />
        </>
      )}
    >
      {draftWarnings.length > 0 ? (
        <div className="novel-note-list" style={{ marginBottom: 16 }}>
          {draftWarnings.map((warning) => <div key={warning} className="novel-note-list__item">{warning}</div>)}
        </div>
      ) : null}
      {draft?.appliedAt ? (
        <div className="novel-note-list" style={{ marginBottom: 16 }}>
          <div className="novel-note-list__item">最近一次已应用但未保存的结构草稿已恢复。保存章节或场景后会自动清除。</div>
        </div>
      ) : null}
      {loading ? (
        <div className="novel-empty">
          <Spin />
        </div>
      ) : (
        <>
          <div className="novel-split novel-split--sidebar">
            <StructureVolumesPanel
              volumes={volumes}
              selectedVolumeId={selection.volumeId}
              editingVolumeId={editingVolumeId}
              editingTitle={editingTitle}
              onEditingTitleChange={setEditingTitle}
              onSelectVolume={(volumeId) => void selectVolume(volumeId)}
              onStartRenameVolume={startRenameVolume}
              onCancelRename={cancelRename}
              onSaveRename={() => void saveRename()}
              onAddPart={(volumeId) => void addPart(volumeId)}
              onDeleteVolume={(volume) => void deleteVolume(volume)}
              onDragEnd={(result) => void handleVolumeDragEnd(result)}
            />
            <StructurePartsPanel
              currentVolume={currentVolume}
              parts={parts}
              selectedPartId={selection.partId}
              editingPartId={editingPartId}
              editingTitle={editingTitle}
              onEditingTitleChange={setEditingTitle}
              onSelectPart={(partId) => void selectPart(partId)}
              onStartRenamePart={startRenamePart}
              onCancelRename={cancelRename}
              onSaveRename={() => void saveRename()}
              onDeletePart={(part) => void deletePart(part)}
              onPageChange={(page) => {
                if (selection.volumeId) void loadParts(selection.volumeId, page)
              }}
              onDragEnd={(result) => void handlePartDragEnd(result)}
            />
          </div>

          <div className="novel-split novel-split--sidebar">
            <StructureChaptersPanel
              currentPart={currentPart}
              chapters={chapters}
              selectedChapterId={selection.chapterId}
              onSelectChapter={(chapterId) => void selectChapter(chapterId)}
              onAddChapter={() => void addChapter()}
              onPageChange={(page) => {
                if (selection.partId) void loadChapters(selection.partId, page)
              }}
            />
            <StructureSegmentsPanel
              chapterDetail={chapterDetail}
              segments={segments}
              selectedSegmentId={selection.segmentId}
              canReorderSegments={canReorderSegments}
              onSelectSegment={(segmentId) => void selectSegment(segmentId)}
              onAddSegment={() => void addSegment()}
              onCreateEvent={openCreateEvent}
              onDragEnd={(result) => void handleSegmentDragEnd(result)}
              onPageChange={(page) => {
                if (selection.chapterId) void loadSegments(selection.chapterId, page)
              }}
            />
          </div>

          <div className="novel-split novel-split--sidebar">
            <ChapterEditorPanel
              chapterDetail={chapterDetail}
              parts={parts}
              chapterForm={chapterForm}
              savingChapter={savingChapter}
              onSaveChapter={() => void (async () => {
                const finalData = chapterForm.getFieldsValue(true) as Record<string, unknown>
                await saveChapter()
                await finalizeDraft(finalData)
                await clearDraft()
              })()}
              onDeleteChapter={() => void deleteChapter()}
              aiActions={chapterAiActions}
            />
            <SegmentEditorPanel
              segmentDetail={segmentDetail}
              selectionSegmentId={selection.segmentId}
              visibleSegments={segments.items}
              segmentForm={segmentForm}
              savingSegment={savingSegment}
              onSaveSegment={() => void (async () => {
                const finalData = segmentForm.getFieldsValue(true) as Record<string, unknown>
                await saveSegment()
                await finalizeDraft(finalData)
                await clearDraft()
              })()}
              onDeleteSegment={() => void deleteSegment()}
              aiActions={segmentAiActions}
            />
          </div>
        </>
      )}
      <Modal
        open={plannerOpen}
        title="AI 批量规划卷 / 部 / 章 / 场景"
        okText="追加规划"
        cancelText="取消"
        confirmLoading={plannerGenerating}
        onCancel={() => setPlannerOpen(false)}
        onOk={() => void plannerForm.validateFields().then((values) => applyHierarchyPlan(values)).catch(() => undefined)}
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
          <Form.Item name="volumeCount" label="卷数" rules={[{ required: true }]}>
            <InputNumber min={1} max={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="partsPerVolume" label="每卷部数" rules={[{ required: true }]}>
            <InputNumber min={1} max={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="chaptersPerPart" label="每部章节数" rules={[{ required: true }]}>
            <InputNumber min={1} max={12} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="segmentsPerChapter" label="每章场景数" rules={[{ required: true }]}>
            <InputNumber min={1} max={8} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="focus" label="额外聚焦">
            <Input.TextArea
              rows={4}
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
          <div style={{ display: 'grid', gap: 12, maxHeight: 520, overflow: 'auto' }}>
            {sceneTemplates.map((template) => {
              const beats = parseSceneTemplateStringList(template.typicalBeatsJson)
              return (
                <section key={template.id} className="novel-panel" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <Space wrap>
                      <strong>{template.name}</strong>
                      <Tag>{template.category}</Tag>
                      {template.isBuiltin > 0 ? <Tag color="gold">内置</Tag> : <Tag color="blue">自定义</Tag>}
                    </Space>
                    <Button type="primary" onClick={() => applySceneTemplate(template)}>套用</Button>
                  </div>
                  <div style={{ color: 'var(--workspace-ink-soft)', marginBottom: 8 }}>
                    {template.description || '还没有模板说明。'}
                  </div>
                  {beats.length > 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--workspace-ink-soft)' }}>
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
