import React from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
} from 'antd'
import type { FormInstance } from 'antd'
import {
  DeleteOutlined,
  LinkOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import VirtualList from 'rc-virtual-list'
import type {
  Character,
  MapNodeSummary,
  PagedResult,
  StoryArc,
  StoryItem,
  TimelineEvent,
  TimelineFilterOptions,
} from '../../../types'
import type { TimelineFormValues, TimelineGenerateValues, TimelineStatusFilter } from './helpers'
import {
  TIME_MODE_OPTIONS,
  TIMELINE_STATUS_META,
  TIMELINE_TEXT,
} from './helpers'

interface TimelineBoardPanelProps {
  pageData: PagedResult<TimelineEvent>
  laneItems: Array<{ status: TimelineEvent['status']; items: TimelineEvent[] }>
  selectedId: number | null
  onSelect: (event: TimelineEvent, nativeEvent?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void
  getStructureTags: (event: TimelineEvent) => string[]
}

export function TimelineBoardPanel({
  pageData,
  laneItems,
  selectedId,
  onSelect,
  getStructureTags,
}: TimelineBoardPanelProps) {
  return (
    <section className="novel-panel">
      <div className="novel-panel__header">
        <div>
          <h2 className="novel-panel__title">{TIMELINE_TEXT.boardTitle}</h2>
          <div className="novel-panel__desc">{TIMELINE_TEXT.boardDescription}</div>
        </div>
      </div>
      <div className="novel-panel__body">
        {pageData.total === 0 ? (
          <div className="novel-empty">{TIMELINE_TEXT.boardEmpty}</div>
        ) : (
          <div className="novel-board-lanes">
            {laneItems.map((lane) => (
              <section key={lane.status} className="novel-board-lane">
                <div className="novel-board-lane__head">
                  <strong>{TIMELINE_STATUS_META[lane.status].label}</strong>
                  <span>{lane.items.length} {'\u6761'}</span>
                </div>
                <div className="novel-board-lane__body">
                  {lane.items.length > 0 ? lane.items.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`novel-board-card ${selectedId === event.id ? 'novel-board-card--active' : ''}`}
                      onClick={(nativeEvent) => onSelect(event, nativeEvent)}
                    >
                      <div className="novel-board-card__kicker">{event.timeLabel}</div>
                      <strong>{event.eventTitle}</strong>
                      <div className="novel-board-card__meta">
                        <span>{event.eventType || TIMELINE_TEXT.emptyType}</span>
                        <span>{event.isMajorEvent ? TIMELINE_TEXT.majorEvent : TIMELINE_TEXT.normalEvent}</span>
                      </div>
                      <div className="novel-timeline-structure-tags">
                        {getStructureTags(event).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                      </div>
                      <div className="novel-board-card__desc">
                        {event.eventResult || event.eventSummary || event.eventCause || TIMELINE_TEXT.emptyEventDescription}
                      </div>
                    </button>
                  )) : (
                    <div className="novel-board-lane__empty">{TIMELINE_TEXT.boardLaneEmpty}</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface TimelineListPanelProps {
  loading: boolean
  pageData: PagedResult<TimelineEvent>
  selectedId: number | null
  selectedIds: number[]
  statusFilter: TimelineStatusFilter
  typeFilter: string
  volumeFilter: number | 'all'
  partFilter: number | 'all'
  chapterFilter: number | 'all'
  statusOptions: Array<{ value: string; label: string }>
  eventTypeOptions: Array<{ value: string; label: string }>
  volumeOptions: Array<{ value: number; label: string }>
  partOptions: Array<{ value: number; label: string }>
  chapterOptions: Array<{ value: number; label: string }>
  filterSummary: string
  onStatusChange: (value: TimelineStatusFilter) => void
  onTypeChange: (value: string) => void
  onVolumeChange: (value: number | 'all') => void
  onPartChange: (value: number | 'all') => void
  onChapterChange: (value: number | 'all') => void
  onPageChange: (page: number) => void
  onSelect: (event: TimelineEvent, nativeEvent?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void
  getStructureTags: (event: TimelineEvent) => string[]
}

export function TimelineListPanel({
  loading,
  pageData,
  selectedId,
  selectedIds,
  statusFilter,
  typeFilter,
  volumeFilter,
  partFilter,
  chapterFilter,
  statusOptions,
  eventTypeOptions,
  volumeOptions,
  partOptions,
  chapterOptions,
  filterSummary,
  onStatusChange,
  onTypeChange,
  onVolumeChange,
  onPartChange,
  onChapterChange,
  onPageChange,
  onSelect,
  getStructureTags,
}: TimelineListPanelProps) {
  return (
    <section className="novel-panel">
      <div className="novel-panel__header">
        <div>
          <h2 className="novel-panel__title">{TIMELINE_TEXT.listTitle}</h2>
          <div className="novel-panel__desc">{TIMELINE_TEXT.listDescription}</div>
        </div>
        <div className="novel-panel__extra">
          <div className="novel-filter-bar">
            <div className="novel-filter-bar__row">
              <Select value={statusFilter} options={statusOptions} onChange={onStatusChange} />
              <Select value={typeFilter} options={eventTypeOptions} onChange={onTypeChange} />
              <Select
                value={volumeFilter}
                options={[{ value: 'all', label: TIMELINE_TEXT.volumeAll }, ...volumeOptions]}
                onChange={onVolumeChange}
              />
              <Select
                value={partFilter}
                disabled={volumeFilter === 'all'}
                options={[{ value: 'all', label: TIMELINE_TEXT.partAll }, ...partOptions]}
                onChange={onPartChange}
              />
              <Select
                value={chapterFilter}
                disabled={partFilter === 'all'}
                options={[{ value: 'all', label: TIMELINE_TEXT.chapterAll }, ...chapterOptions]}
                onChange={onChapterChange}
              />
            </div>
            <div className="novel-filter-bar__summary">{filterSummary}</div>
          </div>
        </div>
      </div>
      <div className="novel-panel__body">
        {loading ? (
          <div className="novel-empty"><Spin /></div>
        ) : pageData.total === 0 ? (
          <div className="novel-empty">{TIMELINE_TEXT.listEmpty}</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <VirtualList data={pageData.items} height={560} itemHeight={126} itemKey="id">
              {(event: TimelineEvent) => (
                <button
                  key={event.id}
                  type="button"
                  className={`novel-list-card ${selectedId === event.id ? 'novel-list-card--active' : ''} ${selectedIds.includes(event.id) ? 'novel-list-card--selected' : ''}`}
                  onClick={(nativeEvent) => onSelect(event, nativeEvent)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="novel-kicker">{event.timeLabel}</div>
                  <div className="novel-list-card__title">{event.eventTitle}</div>
                  <div className="novel-list-card__meta">
                    <Tag color={TIMELINE_STATUS_META[event.status].color}>{TIMELINE_STATUS_META[event.status].label}</Tag>
                    {event.eventType ? <Tag>{event.eventType}</Tag> : null}
                    {event.isMajorEvent ? <Tag color="gold">{TIMELINE_TEXT.majorEvent}</Tag> : null}
                  </div>
                  <div className="novel-timeline-structure-tags">
                    {getStructureTags(event).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                  </div>
                  <div className="novel-list-card__desc">
                    {event.eventSummary || event.eventResult || TIMELINE_TEXT.emptySummary}
                  </div>
                </button>
              )}
            </VirtualList>
            <Pagination
              current={pageData.page}
              pageSize={pageData.pageSize}
              total={pageData.total}
              size="small"
              showSizeChanger={false}
              onChange={onPageChange}
            />
          </div>
        )}
      </div>
    </section>
  )
}

interface TimelineEditorPanelProps {
  selectedEvent: TimelineEvent | null
  creating: boolean
  loading: boolean
  saving: boolean
  regenerating: boolean
  form: FormInstance<TimelineFormValues>
  modeLabel: string
  timeModeHint: string
  filterOptions: TimelineFilterOptions
  arcs: StoryArc[]
  characterOptions: Character[]
  locationOptions: MapNodeSummary[]
  itemOptions: StoryItem[]
  formVolumeOptions: Array<{ value: number; label: string }>
  formPartOptions: Array<{ value: number; label: string }>
  formChapterOptions: Array<{ value: number; label: string }>
  formSegmentOptions: Array<{ value: number; label: string }>
  timePrecisionOptions: Array<{ value: string; label: string }>
  worldRulesPrecisionFallback: string
  searchCharacters: (keyword?: string) => void
  searchLocations: (keyword?: string) => void
  searchItems: (keyword?: string) => void
  onValuesChange: (changed: Partial<TimelineFormValues>, values: TimelineFormValues) => void
  onSave: () => void
  onDelete: () => void
  onRegenerate: () => void
  onJumpToStructure: () => void
}

export function TimelineEditorPanel({
  selectedEvent,
  creating,
  loading,
  saving,
  regenerating,
  form,
  modeLabel,
  timeModeHint,
  filterOptions,
  arcs,
  characterOptions,
  locationOptions,
  itemOptions,
  formVolumeOptions,
  formPartOptions,
  formChapterOptions,
  formSegmentOptions,
  timePrecisionOptions,
  worldRulesPrecisionFallback,
  searchCharacters,
  searchLocations,
  searchItems,
  onValuesChange,
  onSave,
  onDelete,
  onRegenerate,
  onJumpToStructure,
}: TimelineEditorPanelProps) {
  const panelTitle = selectedEvent
    ? `\u7f16\u8f91\uff1a${selectedEvent.eventTitle}`
    : creating
      ? TIMELINE_TEXT.detailCreateTitle
      : TIMELINE_TEXT.detailEmptyTitle

  return (
    <section className="novel-panel">
      <div className="novel-panel__header">
        <div>
          <h2 className="novel-panel__title">{panelTitle}</h2>
          <div className="novel-panel__desc">{TIMELINE_TEXT.detailDescription}</div>
        </div>
        <div className="novel-panel__extra">
          <Space>
            {selectedEvent ? (
              <Button icon={<ReloadOutlined />} loading={regenerating} onClick={onRegenerate}>
                AI 修复·重做事件
              </Button>
            ) : null}
            {selectedEvent ? (
              <Button icon={<LinkOutlined />} onClick={onJumpToStructure}>
                {TIMELINE_TEXT.jumpToStructure}
              </Button>
            ) : null}
            {selectedEvent ? (
              <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
                {TIMELINE_TEXT.delete}
              </Button>
            ) : null}
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
              {TIMELINE_TEXT.save}
            </Button>
          </Space>
        </div>
      </div>
      <div className="novel-panel__body">
        {!selectedEvent && !creating && !loading ? (
          <div className="novel-empty">{TIMELINE_TEXT.selectEventHint}</div>
        ) : (
          <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
            {selectedEvent?.anchorInvalid ? (
              <Alert
                style={{ marginBottom: 16 }}
                showIcon
                type="warning"
                message={TIMELINE_TEXT.anchorWarningTitle}
                description={TIMELINE_TEXT.anchorWarningDescription}
              />
            ) : null}

            <div className="novel-form-section">
              <div className="novel-form-section__header">
                <div className="novel-form-section__title">{TIMELINE_TEXT.sectionTimeTitle}</div>
                <div className="novel-form-section__desc">{TIMELINE_TEXT.sectionTimeDescription}</div>
              </div>
              <div className="novel-note-list" style={{ marginBottom: 14 }}>
                <div className="novel-note-list__item">{`${modeLabel}${'\u5199\u6cd5\u5efa\u8bae\uff1a'}${timeModeHint}`}</div>
              </div>
              <div className="novel-grid novel-grid--3">
                <Form.Item
                  name="eventTitle"
                  label={TIMELINE_TEXT.titleEvent}
                  rules={[{ required: true, message: '\u8bf7\u8f93\u5165\u4e8b\u4ef6\u6807\u9898' }]}
                >
                  <Input placeholder={TIMELINE_TEXT.placeholderEventTitle} />
                </Form.Item>
                <Form.Item
                  name="timeLabel"
                  label={TIMELINE_TEXT.labelTime}
                  rules={[{ required: true, message: '\u8bf7\u8f93\u5165\u65f6\u95f4\u6807\u7b7e' }]}
                >
                  <Input placeholder={timeModeHint || TIMELINE_TEXT.placeholderTimeLabel} />
                </Form.Item>
                <Form.Item
                  name="timeSortValue"
                  label={TIMELINE_TEXT.labelSortValue}
                  rules={[{ required: true, message: '\u8bf7\u8f93\u5165\u6392\u5e8f\u503c' }]}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </div>
              <div className="novel-grid novel-grid--3">
                <Form.Item name="timeMode" label={TIMELINE_TEXT.labelTimeMode}>
                  <Select options={TIME_MODE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
                </Form.Item>
                <Form.Item name="timePrecision" label={TIMELINE_TEXT.labelTimePrecision}>
                  <Select allowClear options={timePrecisionOptions.length > 0 ? timePrecisionOptions : [{ value: worldRulesPrecisionFallback, label: worldRulesPrecisionFallback }]} />
                </Form.Item>
                <Form.Item name="status" label={TIMELINE_TEXT.labelStatus}>
                  <Select options={Object.entries(TIMELINE_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
                </Form.Item>
              </div>
              <div className="novel-grid novel-grid--2">
                <Form.Item name="eventType" label={TIMELINE_TEXT.labelEventType}>
                  <Select allowClear showSearch options={filterOptions.eventTypes.map((item) => ({ value: item, label: item }))} />
                </Form.Item>
                <div className="novel-grid novel-grid--2" style={{ alignItems: 'start' }}>
                  <Form.Item name="isMajorEvent" label={TIMELINE_TEXT.labelMajor} valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch />
                  </Form.Item>
                  <Form.Item name="protagonistPresent" label={TIMELINE_TEXT.labelProtagonistPresent} valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch />
                  </Form.Item>
                </div>
              </div>
              <Form.Item name="eventSummary" label={TIMELINE_TEXT.labelSummary}>
                <Input.TextArea rows={3} placeholder={TIMELINE_TEXT.placeholderSummary} />
              </Form.Item>
            </div>

            <div className="novel-form-section">
              <div className="novel-form-section__header">
                <div className="novel-form-section__title">{TIMELINE_TEXT.sectionStructureTitle}</div>
                <div className="novel-form-section__desc">{TIMELINE_TEXT.sectionStructureDescription}</div>
              </div>
              <div className="novel-grid novel-grid--2">
                <Form.Item name="volumeId" label={TIMELINE_TEXT.labelVolume}>
                  <Select allowClear options={formVolumeOptions} />
                </Form.Item>
                <Form.Item name="partId" label={TIMELINE_TEXT.labelPart}>
                  <Select allowClear options={formPartOptions} />
                </Form.Item>
              </div>
              <div className="novel-grid novel-grid--2">
                <Form.Item name="chapterStartId" label={TIMELINE_TEXT.labelChapterStart}>
                  <Select allowClear options={formChapterOptions} />
                </Form.Item>
                <Form.Item name="chapterEndId" label={TIMELINE_TEXT.labelChapterEnd}>
                  <Select allowClear options={formChapterOptions} />
                </Form.Item>
              </div>
              <Form.Item name="segmentId" label={TIMELINE_TEXT.labelSegment}>
                <Select allowClear options={formSegmentOptions} />
              </Form.Item>
            </div>

            <div className="novel-form-section">
              <div className="novel-form-section__header">
                <div className="novel-form-section__title">{TIMELINE_TEXT.sectionPlotTitle}</div>
                <div className="novel-form-section__desc">{TIMELINE_TEXT.sectionPlotDescription}</div>
              </div>
              <div className="novel-grid novel-grid--2">
                <Form.Item name="arcId" label={TIMELINE_TEXT.labelArc}>
                  <Select allowClear options={arcs.map((item) => ({ value: item.id, label: item.arcName }))} />
                </Form.Item>
                <Form.Item name="locationMapId" label={TIMELINE_TEXT.labelLocation}>
                  <Select
                    allowClear
                    showSearch
                    filterOption={false}
                    options={locationOptions.map((item) => ({ value: item.id, label: item.name }))}
                    onFocus={() => searchLocations('')}
                    onSearch={searchLocations}
                  />
                </Form.Item>
              </div>
            </div>

            <div className="novel-form-section">
              <div className="novel-form-section__header">
                <div className="novel-form-section__title">{TIMELINE_TEXT.sectionCharacterTitle}</div>
                <div className="novel-form-section__desc">{TIMELINE_TEXT.sectionCharacterDescription}</div>
              </div>
              <div className="novel-grid novel-grid--2">
                <Form.Item name="presentCharacterIds" label={TIMELINE_TEXT.labelPresentCharacters}>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    filterOption={false}
                    options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))}
                    onFocus={() => searchCharacters('')}
                    onSearch={searchCharacters}
                  />
                </Form.Item>
                <Form.Item name="affectedCharacterIds" label={TIMELINE_TEXT.labelAffectedCharacters}>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    filterOption={false}
                    options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))}
                    onFocus={() => searchCharacters('')}
                    onSearch={searchCharacters}
                  />
                </Form.Item>
              </div>
              <div className="novel-grid novel-grid--2">
                <Form.Item name="linkedItemIds" label={TIMELINE_TEXT.labelLinkedItems}>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    filterOption={false}
                    options={itemOptions.map((item) => ({ value: item.id, label: item.itemName }))}
                    onFocus={() => searchItems('')}
                    onSearch={searchItems}
                  />
                </Form.Item>
                <Form.Item name="protagonistAction" label={TIMELINE_TEXT.labelProtagonistAction}>
                  <Input.TextArea rows={3} placeholder={TIMELINE_TEXT.placeholderProtagonistAction} />
                </Form.Item>
              </div>
            </div>

            <div className="novel-form-section">
              <div className="novel-form-section__header">
                <div className="novel-form-section__title">{TIMELINE_TEXT.sectionCausalityTitle}</div>
                <div className="novel-form-section__desc">{TIMELINE_TEXT.sectionCausalityDescription}</div>
              </div>
              <div className="novel-grid novel-grid--3">
                <Form.Item name="eventCause" label={TIMELINE_TEXT.labelEventCause}>
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item name="eventProcess" label={TIMELINE_TEXT.labelEventProcess}>
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item name="eventResult" label={TIMELINE_TEXT.labelEventResult}>
                  <Input.TextArea rows={4} />
                </Form.Item>
              </div>
              <Form.Item name="directConsequences" label={TIMELINE_TEXT.labelDirectConsequences}>
                <Select mode="tags" open={false} />
              </Form.Item>
              <Form.Item name="openThreads" label={TIMELINE_TEXT.labelOpenThreads}>
                <Select mode="tags" open={false} />
              </Form.Item>
              <Form.Item name="notes" label={TIMELINE_TEXT.labelNotes}>
                <Input.TextArea rows={4} />
              </Form.Item>
            </div>
          </Form>
        )}
      </div>
    </section>
  )
}

interface TimelineGenerateModalProps {
  open: boolean
  loading: boolean
  form: FormInstance<TimelineGenerateValues>
  onCancel: () => void
  onSubmit: () => void
}

export function TimelineGenerateModal({
  open,
  loading,
  form,
  onCancel,
  onSubmit,
}: TimelineGenerateModalProps) {
  return (
    <Modal
      title={TIMELINE_TEXT.modalTitle}
      open={open}
      forceRender
      onCancel={onCancel}
      onOk={onSubmit}
      confirmLoading={loading}
      okText={TIMELINE_TEXT.modalOk}
    >
      <Form form={form} layout="vertical">
        <div className="novel-note-list" style={{ marginBottom: 16 }}>
          <div className="novel-note-list__item">{TIMELINE_TEXT.generateHint1}</div>
          <div className="novel-note-list__item">{TIMELINE_TEXT.generateHint2}</div>
          <div className="novel-note-list__item">{TIMELINE_TEXT.generateHint3}</div>
        </div>
        <Form.Item name="count" label={TIMELINE_TEXT.generateCount}>
          <Select options={[8, 10, 12, 16, 20].map((item) => ({ value: item, label: `${item} \u4e2a` }))} />
        </Form.Item>
        <Form.Item name="batchSize" label={TIMELINE_TEXT.generateBatchSize}>
          <Select options={[2, 3, 4, 5, 6].map((item) => ({ value: item, label: `${item} \u4e2a/\u6279` }))} />
        </Form.Item>
        <Form.Item name="focus" label={TIMELINE_TEXT.generateFocus}>
          <Input.TextArea rows={3} placeholder={TIMELINE_TEXT.generateFocusPlaceholder} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
