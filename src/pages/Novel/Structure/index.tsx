import React from 'react'
import { Button, Space, Spin } from 'antd'
import {
  ApartmentOutlined,
  BranchesOutlined,
  BuildOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
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

export default function StructurePage({ novelId }: { novelId: number }) {
  const workspace = useStructureWorkspace(novelId)
  const { currentNovel } = useNovelStore()

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
    addPart,
    addSegment,
    addVolume,
    cancelRename,
    compileChapter,
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

  const chapterAiActions = chapterDetail ? (
    <AIGenerateButton
      label="AI 生成章节"
      isJson
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
        const draft = parseDraftJson<{ title?: string; outline?: string; targetWords?: number }>(raw)
        const currentValues = chapterForm.getFieldsValue(true)

        chapterForm.setFieldsValue({
          ...currentValues,
          title: typeof draft.title === 'string' ? draft.title : currentValues.title,
          outline: typeof draft.outline === 'string' ? draft.outline : currentValues.outline,
          targetWords: normalizeOptionalNumber(draft.targetWords ?? currentValues.targetWords) || currentValues.targetWords,
        })
      }}
    />
  ) : null

  const segmentAiActions = segmentDetail ? (
    <AIGenerateButton
      label="AI 生成场景"
      isJson
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
        const draft = parseDraftJson<{
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
      }}
    />
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
              onSaveChapter={() => void saveChapter()}
              aiActions={chapterAiActions}
            />
            <SegmentEditorPanel
              segmentDetail={segmentDetail}
              selectionSegmentId={selection.segmentId}
              visibleSegments={segments.items}
              segmentForm={segmentForm}
              savingSegment={savingSegment}
              onSaveSegment={() => void saveSegment()}
              aiActions={segmentAiActions}
            />
          </div>
        </>
      )}
    </WorkspacePage>
  )
}
