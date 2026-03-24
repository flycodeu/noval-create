import React from 'react'
import { Button, Space } from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage } from '../components/WorkspaceShell'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
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
import '../components/boards.css'
import './index.css'

export default function TimelinePage({ novelId }: TimelinePageProps) {
  const workspace = useTimelineWorkspace(novelId)
  const eventDraftButton = workspace.selectedEvent || workspace.creating ? (
    <AIGenerateButton
      label="AI 起草事件"
      isJson
      buildMessages={() => {
        const values = workspace.form.getFieldsValue(true)
        return buildDraftMessages({
          task: '时间轴事件草稿',
          mode: values.eventTitle ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: workspace.currentNovel?.title || '' },
            { label: '题材', value: workspace.currentNovel?.genreName || '' },
            { label: '简介', value: workspace.currentNovel?.synopsis || '' },
            { label: '扩展背景', value: workspace.currentNovel?.expandedBackground || '' },
            { label: '时间模式', value: workspace.modeLabel },
            { label: '结构过滤', value: workspace.structureFilterSummary },
          ],
          fields: [
            { key: 'eventTitle', label: '事件标题', value: values.eventTitle, hint: '一句话点出事件。' },
            { key: 'eventSummary', label: '事件摘要', value: values.eventSummary, hint: '说明这件事为什么重要。' },
            { key: 'timeLabel', label: '时间标签', value: values.timeLabel, hint: '写成统一口径。' },
            { key: 'timeSortValue', label: '排序值', type: 'number', value: values.timeSortValue, hint: '给出合理整数。' },
            { key: 'eventType', label: '事件类型', value: values.eventType, hint: '例如冲突、转折、回收。' },
            { key: 'protagonistAction', label: '主角行动', value: values.protagonistAction, hint: '只写动作和选择。' },
            { key: 'eventCause', label: '事件起因', value: values.eventCause, hint: '写清因果起点。' },
            { key: 'eventProcess', label: '事件过程', value: values.eventProcess, hint: '写清关键推进。' },
            { key: 'eventResult', label: '事件结果', value: values.eventResult, hint: '写清直接结果。' },
            { key: 'directConsequences', label: '直接后果', type: 'string[]', value: values.directConsequences, hint: '2 到 5 条短句。' },
            { key: 'openThreads', label: '待回收问题', type: 'string[]', value: values.openThreads, hint: '没有可留空。' },
            { key: 'notes', label: '补充备注', value: values.notes, hint: '只写必要补充。' },
          ],
          requirements: [
            '不要改动已选中的卷、部、章节、场景、地点和角色关联。',
            '不要写空泛总结和宣传腔。',
          ],
        })
      }}
      onResult={(raw) => {
        const draft = parseDraftJson<Record<string, unknown>>(raw)
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
      }}
    />
  ) : null

  return (
    <WorkspacePage
      className="novel-timeline-page"
      eyebrow={TIMELINE_TEXT.pageEyebrow}
      title={TIMELINE_TEXT.pageTitle}
      description={TIMELINE_TEXT.pageDescription}
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void workspace.refreshPage()}>
            {TIMELINE_TEXT.refresh}
          </Button>
          <Button icon={<PlusOutlined />} onClick={workspace.handleNew}>
            {TIMELINE_TEXT.create}
          </Button>
          {eventDraftButton}
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={workspace.generating}
            onClick={() => workspace.setGenerateOpen(true)}
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
              value: `${workspace.modeLabel} · ${workspace.worldRules.timelineConfig.eraName || TIMELINE_TEXT.currentThemeTimeline}`,
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
          selectedTimeMode={workspace.selectedTimeMode}
          worldRulesPrecisionFallback={workspace.defaultPrecision}
          searchCharacters={(value) => void workspace.searchCharacters(value)}
          searchLocations={(value) => void workspace.searchLocations(value)}
          searchItems={(value) => void workspace.searchItems(value)}
          onValuesChange={workspace.handleFormValuesChange}
          onSave={() => void workspace.handleSave()}
          onDelete={workspace.handleDelete}
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
