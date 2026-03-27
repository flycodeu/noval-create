import React from 'react'
import { Alert, Button, Space } from 'antd'
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
      label="AI Draft Event"
      isJson
      buildMessages={() => {
        const values = workspace.form.getFieldsValue(true)
        return buildDraftMessages({
          task: 'timeline event draft',
          mode: values.eventTitle ? 'optimize' : 'replace',
          context: [
            { label: 'Novel', value: workspace.currentNovel?.title || '' },
            { label: 'Genre', value: workspace.currentNovel?.genreName || '' },
            { label: 'Synopsis', value: workspace.currentNovel?.synopsis || '' },
            { label: 'Background', value: workspace.currentNovel?.expandedBackground || '' },
            { label: 'Time mode', value: workspace.modeLabel },
            { label: 'Structure filter', value: workspace.structureFilterSummary },
          ],
          fields: [
            { key: 'eventTitle', label: 'Event title', value: values.eventTitle, hint: 'One line that names the event.' },
            { key: 'eventSummary', label: 'Event summary', value: values.eventSummary, hint: 'Explain why this event matters.' },
            { key: 'timeLabel', label: 'Time label', value: values.timeLabel, hint: 'Keep it in the project time format.' },
            { key: 'timeSortValue', label: 'Sort value', type: 'number', value: values.timeSortValue, hint: 'Use a reasonable integer.' },
            { key: 'eventType', label: 'Event type', value: values.eventType, hint: 'Examples: conflict, reversal, payoff.' },
            { key: 'protagonistAction', label: 'Protagonist action', value: values.protagonistAction, hint: 'Describe the action or decision.' },
            { key: 'eventCause', label: 'Cause', value: values.eventCause, hint: 'State the trigger clearly.' },
            { key: 'eventProcess', label: 'Process', value: values.eventProcess, hint: 'State the key progression.' },
            { key: 'eventResult', label: 'Result', value: values.eventResult, hint: 'State the direct outcome.' },
            { key: 'directConsequences', label: 'Direct consequences', type: 'string[]', value: values.directConsequences, hint: 'Use 2 to 5 short lines.' },
            { key: 'openThreads', label: 'Open threads', type: 'string[]', value: values.openThreads, hint: 'Leave empty when none.' },
            { key: 'notes', label: 'Notes', value: values.notes, hint: 'Only add necessary context.' },
          ],
          requirements: [
            'Do not change already selected structure, location, character, or item links.',
            'Avoid slogans, generic summaries, and empty marketing language.',
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
      {workspace.generationBlockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Current prerequisites are not ready for timeline generation"
          description={(
            <div>
              {workspace.generationBlockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
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