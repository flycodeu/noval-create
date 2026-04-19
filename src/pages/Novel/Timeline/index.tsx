import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Modal, Select, Space, Tag } from 'antd'
import {
  BarsOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage } from '../components/WorkspaceShell'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import { generateTimelineDraft } from '../shared/planning-ai-service'
import {
  TIMELINE_TEXT,
  type TimelinePageProps,
} from './helpers'
import {
  TimelineBoardPanel,
  TimelineEditorPanel,
  TimelineGenerateModal,
  TimelineListPanel,
} from './TimelinePanels'
import { useTimelineWorkspace } from './useTimelineWorkspace'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import '../components/boards.css'
import './index.css'

export default function TimelinePage({ novelId }: TimelinePageProps) {
  const navigate = useNavigate()
  const { mutationToken, notifyWorkspaceMutation, registerClearHandler, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const workspace = useTimelineWorkspace(novelId, {
    onCleared: notifyWorkspaceMutation,
  })
  const {
    clearSelection,
    creating,
    form,
    handleSave: saveTimelineEvent,
    refreshPage,
    selectedEvent,
  } = workspace
  const [draftWarnings, setDraftWarnings] = React.useState<string[]>([])
  const [batchStatus, setBatchStatus] = React.useState<'planned' | 'seeded' | 'written' | 'resolved'>('planned')
  const [batchMajorEvent, setBatchMajorEvent] = React.useState(1)
  const draftWarningsRef = React.useRef<string[]>([])
  const draftObservabilityRef = React.useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)
  const applyTimelineDraft = React.useCallback((draft: Record<string, unknown>) => {
    const currentValues = workspace.form.getFieldsValue(true)
    workspace.form.setFieldsValue({
      ...currentValues,
      eventTitle: typeof draft.eventTitle === 'string' ? draft.eventTitle : currentValues.eventTitle,
      eventSummary: typeof draft.eventSummary === 'string' ? draft.eventSummary : currentValues.eventSummary,
      timeLabel: typeof draft.timeLabel === 'string' ? draft.timeLabel : currentValues.timeLabel,
      timeSortValue: normalizeOptionalNumber(draft.timeSortValue ?? currentValues.timeSortValue) ?? currentValues.timeSortValue,
      eventType: typeof draft.eventType === 'string' ? draft.eventType : currentValues.eventType,
      protagonistAction: typeof draft.protagonistAction === 'string' ? draft.protagonistAction : currentValues.protagonistAction,
      eventCause: typeof draft.eventCause === 'string' ? draft.eventCause : currentValues.eventCause,
      eventProcess: typeof draft.eventProcess === 'string' ? draft.eventProcess : currentValues.eventProcess,
      eventResult: typeof draft.eventResult === 'string' ? draft.eventResult : currentValues.eventResult,
      directConsequences: normalizeStringArray(draft.directConsequences ?? currentValues.directConsequences),
      openThreads: normalizeStringArray(draft.openThreads ?? currentValues.openThreads),
      notes: typeof draft.notes === 'string' ? draft.notes : currentValues.notes,
    })
  }, [workspace.form])
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<Record<string, unknown>>({
    novelId,
    pageKey: 'timeline',
    applyDraft: applyTimelineDraft,
  })
  const eventDraftButton = workspace.selectedEvent || workspace.creating ? (
    <AIGenerateButton
      novelId={novelId}
      label="AI 生成·事件草稿"
      intent="generate"
      isJson
      runGeneration={async (input) => {
        const result = await generateTimelineDraft(input, { genre: workspace.currentNovel?.genreName })
        draftWarningsRef.current = result.warnings
        draftObservabilityRef.current = result.observability
        setDraftWarnings(result.warnings)
        return result.outputs
      }}
      buildMessages={() => {
        const values = workspace.form.getFieldsValue(true)
        return buildDraftMessages({
          task: 'timeline event draft',
          mode: values.eventTitle ? 'optimize' : 'replace',
          context: [
            { label: '书名', value: workspace.currentNovel?.title || '' },
            { label: '题材', value: workspace.currentNovel?.genreName || '' },
            { label: '一句话简介', value: workspace.currentNovel?.synopsis || '' },
            { label: '扩展背景', value: workspace.currentNovel?.expandedBackground || '' },
            { label: '时间模式', value: workspace.modeLabel },
            { label: '结构筛选', value: workspace.structureFilterSummary },
          ],
          fields: [
            { key: 'eventTitle', label: '事件标题', value: values.eventTitle, hint: '用一句话明确这件事是什么。' },
            { key: 'eventSummary', label: '事件摘要', value: values.eventSummary, hint: '说明它为什么重要。' },
            { key: 'timeLabel', label: '时间标签', value: values.timeLabel, hint: '保持项目当前采用的时间格式。' },
            { key: 'timeSortValue', label: '排序值', type: 'number', value: values.timeSortValue, hint: '填写合理的整数。' },
            { key: 'eventType', label: '事件类型', value: values.eventType, hint: '例如：冲突、反转、回收。' },
            { key: 'protagonistAction', label: '主角动作', value: values.protagonistAction, hint: '写清动作或决策。' },
            { key: 'eventCause', label: '起因', value: values.eventCause, hint: '把触发因素说清楚。' },
            { key: 'eventProcess', label: '过程', value: values.eventProcess, hint: '写清关键推进。' },
            { key: 'eventResult', label: '结果', value: values.eventResult, hint: '写清直接结果。' },
            { key: 'directConsequences', label: '直接后果', type: 'string[]', value: values.directConsequences, hint: '建议 2 到 5 条短句。' },
            { key: 'openThreads', label: '待回收线索', type: 'string[]', value: values.openThreads, hint: '没有就留空。' },
            { key: 'notes', label: '补充备注', value: values.notes, hint: '只保留必要上下文。' },
          ],
          requirements: [
            '不要改动已经选定的结构、地点、人物或物品关联。',
            '避免口号式总结、空泛概述和宣传腔。',
          ],
        })
      }}
      onResult={(raw) => {
        const parsedDraft = parseDraftJson<Record<string, unknown>>(raw)
        applyTimelineDraft(parsedDraft)
        void saveAppliedDraft(parsedDraft, draftWarningsRef.current, 'timeline', draftObservabilityRef.current || undefined).catch(console.error)
      }}
    />
  ) : null

  const handleSave = React.useCallback(async () => {
    const finalData = form.getFieldsValue(true) as Record<string, unknown>
    await saveTimelineEvent()
    await finalizeDraft(finalData)
    await clearDraft()
  }, [clearDraft, finalizeDraft, form, saveTimelineEvent])

  React.useEffect(() => {
    registerSaveHandler((selectedEvent || creating) ? () => { void handleSave() } : null)
    return () => registerSaveHandler(null)
  }, [creating, handleSave, registerSaveHandler, selectedEvent])

  React.useEffect(() => {
    registerEscapeHandler(() => {
      clearSelection()
    })
    return () => registerEscapeHandler(null)
  }, [clearSelection, registerEscapeHandler])

  React.useEffect(() => {
    registerClearHandler(() => {
      workspace.handleClear()
    })
    return () => registerClearHandler(null)
  }, [registerClearHandler, workspace.handleClear])

  React.useEffect(() => {
    void refreshPage()
  }, [mutationToken, refreshPage])

  const handleBatchStatusUpdate = React.useCallback(async () => {
    if (workspace.selectedIds.length === 0) return
    await window.electron.timeline.batchUpdate(workspace.selectedIds, { status: batchStatus })
    workspace.clearSelection()
    await workspace.refreshPage()
    notifyWorkspaceMutation()
  }, [batchStatus, notifyWorkspaceMutation, workspace])

  const handleBatchMajorUpdate = React.useCallback(async () => {
    if (workspace.selectedIds.length === 0) return
    await window.electron.timeline.batchUpdate(workspace.selectedIds, { isMajorEvent: batchMajorEvent })
    workspace.clearSelection()
    await workspace.refreshPage()
    notifyWorkspaceMutation()
  }, [batchMajorEvent, notifyWorkspaceMutation, workspace])

  const handleBatchDelete = React.useCallback(() => {
    if (workspace.selectedIds.length === 0) return
    Modal.confirm({
      title: `删除选中的 ${workspace.selectedIds.length} 条时间轴事件？`,
      content: '会创建恢复点，可通过“撤销最近操作”恢复。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.timeline.batchDelete(workspace.selectedIds)
        workspace.clearSelection()
        await workspace.refreshPage()
        notifyWorkspaceMutation()
      },
    })
  }, [notifyWorkspaceMutation, workspace])

  return (
    <WorkspacePage
      className="novel-timeline-page"
      eyebrow={TIMELINE_TEXT.pageEyebrow}
      title={TIMELINE_TEXT.pageTitle}
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void workspace.refreshPage()}>
            {TIMELINE_TEXT.refresh}
          </Button>
          <Button icon={<PlusOutlined />} onClick={workspace.handleNew}>
            {TIMELINE_TEXT.create}
          </Button>
          <Button icon={<BarsOutlined />} onClick={() => navigate(`/novels/${novelId}/resistance`)}>
            去反派与阻力
          </Button>
          {eventDraftButton}
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={workspace.generating}
            onClick={() => void workspace.openGenerateModal()}
          >
            {TIMELINE_TEXT.generate}
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={workspace.generating}
            onClick={workspace.handleClear}
          >
            {TIMELINE_TEXT.clear}
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: TIMELINE_TEXT.genre, value: workspace.currentNovel?.genreName || TIMELINE_TEXT.notConfigured },
            {
              label: TIMELINE_TEXT.timeSystem,
              value: `${workspace.modeLabel} / ${workspace.worldRules.timelineConfig.eraName || TIMELINE_TEXT.currentThemeTimeline}`,
            },
            {
              label: TIMELINE_TEXT.timeZero,
              value: workspace.worldRules.timelineConfig.relativeZeroLabel
                || workspace.worldRules.timelineConfig.baseYearLabel
                || TIMELINE_TEXT.notDefined,
            },
            { label: TIMELINE_TEXT.structureFilter, value: workspace.structureFilterSummary },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label={TIMELINE_TEXT.metricTotal} value={workspace.stats.total} tone="warm" hint={TIMELINE_TEXT.metricTotalHint} />
          <WorkspaceMetric label={TIMELINE_TEXT.metricMajor} value={workspace.stats.majorCount} tone="cool" hint={TIMELINE_TEXT.metricMajorHint} />
          <WorkspaceMetric label={TIMELINE_TEXT.metricResolved} value={workspace.stats.resolvedCount} hint={TIMELINE_TEXT.metricResolvedHint} />
          <WorkspaceMetric label={TIMELINE_TEXT.metricOpenThreads} value={workspace.stats.openThreadCount} hint={TIMELINE_TEXT.metricOpenThreadsHint} />
        </>
      )}
    >
      {draftWarnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="本轮 AI 草稿附带修补提示"
          description={draftWarnings.map((warning) => <div key={warning}>{warning}</div>)}
        />
      ) : null}
      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复最近一次未保存的 AI 草稿"
          description="当前时间轴编辑表单包含最近一次已应用但尚未保存的 AI 结果。保存后会自动清除。"
        />
      ) : null}
      {workspace.generationBlockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="当前前置条件还不足以生成时间轴"
          description={(
            <div>
              {workspace.generationBlockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      {workspace.selectedIds.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message={`已选 ${workspace.selectedIds.length} 条时间轴事件`}
          description={(
            <Space wrap>
              <Tag color="processing">批量工具条</Tag>
              <Select
                value={batchStatus}
                style={{ width: 160 }}
                options={[
                  { value: 'planned', label: '待规划' },
                  { value: 'seeded', label: '已埋点' },
                  { value: 'written', label: '已写入' },
                  { value: 'resolved', label: '已解决' },
                ]}
                onChange={(value) => setBatchStatus(value)}
              />
              <Button onClick={() => void handleBatchStatusUpdate()}>批量改状态</Button>
              <Select
                value={batchMajorEvent}
                style={{ width: 160 }}
                options={[
                  { value: 1, label: '标记重大事件' },
                  { value: 0, label: '标记普通事件' },
                ]}
                onChange={(value) => setBatchMajorEvent(value)}
              />
              <Button onClick={() => void handleBatchMajorUpdate()}>批量改重大级别</Button>
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
            </Space>
          )}
        />
      ) : null}

      <TimelineBoardPanel
        pageData={workspace.pageData}
        laneItems={workspace.laneItems}
        selectedId={workspace.selectedId}
        onSelect={(event) => void workspace.handleSelect(event)}
        getStructureTags={workspace.getStructureTagsForEvent}
      />

      <div className="novel-split novel-split--sidebar">
        <TimelineListPanel
          loading={workspace.loading}
          pageData={workspace.pageData}
          selectedId={workspace.selectedId}
          selectedIds={workspace.selectedIds}
          statusFilter={workspace.statusFilter}
          typeFilter={workspace.typeFilter}
          volumeFilter={workspace.volumeFilter}
          partFilter={workspace.partFilter}
          chapterFilter={workspace.chapterFilter}
          statusOptions={workspace.statusOptions}
          eventTypeOptions={workspace.eventTypeOptions}
          volumeOptions={workspace.filterVolumeOptions}
          partOptions={workspace.filterPartOptions}
          chapterOptions={workspace.filterChapterOptions}
          filterSummary={workspace.filterSummary}
          onStatusChange={(value) => {
            workspace.setStatusFilter(value)
            workspace.setPage(1)
          }}
          onTypeChange={(value) => {
            workspace.setTypeFilter(value)
            workspace.setPage(1)
          }}
          onVolumeChange={(value) => {
            workspace.setVolumeFilter(value)
            workspace.setPartFilter('all')
            workspace.setChapterFilter('all')
            workspace.setSegmentFilter('all')
            workspace.setPage(1)
          }}
          onPartChange={(value) => {
            workspace.setPartFilter(value)
            workspace.setChapterFilter('all')
            workspace.setSegmentFilter('all')
            workspace.setPage(1)
          }}
          onChapterChange={(value) => {
            workspace.setChapterFilter(value)
            workspace.setSegmentFilter('all')
            workspace.setPage(1)
          }}
          onPageChange={workspace.setPage}
          onSelect={(event) => void workspace.handleSelect(event)}
          getStructureTags={workspace.getStructureTagsForEvent}
        />

        <TimelineEditorPanel
          selectedEvent={workspace.selectedEvent}
          creating={workspace.creating}
          loading={workspace.loading}
          saving={workspace.saving}
          regenerating={workspace.regenerating}
          form={workspace.form}
          modeLabel={workspace.modeLabel}
          timeModeHint={workspace.timeModeHint}
          filterOptions={workspace.filterOptions}
          arcs={workspace.arcs}
          characterOptions={workspace.characterOptions}
          locationOptions={workspace.locationOptions}
          itemOptions={workspace.itemOptions}
          formVolumeOptions={workspace.formVolumeOptions}
          formPartOptions={workspace.formPartOptions}
          formChapterOptions={workspace.formChapterOptions}
          formSegmentOptions={workspace.formSegmentOptions}
          timePrecisionOptions={workspace.timePrecisionOptions}
          worldRulesPrecisionFallback={workspace.defaultPrecision}
          searchCharacters={(value) => void workspace.searchCharacters(value)}
          searchLocations={(value) => void workspace.searchLocations(value)}
          searchItems={(value) => void workspace.searchItems(value)}
          onValuesChange={workspace.handleFormValuesChange}
          onSave={() => void handleSave()}
          onDelete={workspace.handleDelete}
          onRegenerate={() => void workspace.handleRegenerate()}
          onJumpToStructure={workspace.openSelectedEventInStructure}
        />
      </div>

      <TimelineGenerateModal
        open={workspace.generateOpen}
        loading={workspace.generating}
        form={workspace.generateForm}
        onCancel={() => workspace.setGenerateOpen(false)}
        onSubmit={() => void workspace.handleGenerate()}
      />
    </WorkspacePage>
  )
}
