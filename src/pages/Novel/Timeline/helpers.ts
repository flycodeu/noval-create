import type {
  Character,
  MapNodeSummary,
  StoryArc,
  StoryItem,
  StoryStructureChapterSummary,
  StoryStructurePartSummary,
  StoryStructureSegmentSummary,
  StoryStructureVolumeSummary,
  TimelineEvent,
} from '../../../types'
import { parseOptionalNumber } from '../shared/workspace-utils'

export interface TimelinePageProps {
  novelId: number
}

export interface TimelineFormValues {
  eventTitle: string
  eventSummary?: string
  timeMode: string
  timeLabel: string
  timeSortValue: number
  timePrecision?: string
  isMajorEvent: boolean
  eventType?: string
  arcId?: number
  volumeId?: number
  partId?: number
  chapterStartId?: number
  chapterEndId?: number
  segmentId?: number
  locationMapId?: number
  presentCharacterIds: number[]
  affectedCharacterIds: number[]
  linkedItemIds: number[]
  protagonistPresent: boolean
  protagonistAction?: string
  eventCause?: string
  eventProcess?: string
  eventResult?: string
  directConsequences: string[]
  openThreads: string[]
  notes?: string
  status: TimelineEvent['status']
}

export interface TimelineGenerateValues {
  count: number
  batchSize: number
  focus?: string
}

export interface TimelineRouteState {
  eventId: number | null
  action: string | null
  volumeId: number | null
  partId: number | null
  chapterId: number | null
  segmentId: number | null
}

export type TimelineStatusFilter = 'all' | TimelineEvent['status']
export type NumericFilter = number | 'all'

export const TIMELINE_TEXT = {
  pageEyebrow: '\u65f6\u95f4\u8f74',
  pageTitle: '\u4e8b\u4ef6\u65f6\u95f4\u8f74',
  pageDescription: '\u7edf\u4e00\u56de\u67e5\u4e8b\u4ef6\u987a\u5e8f\u3001\u56e0\u679c\u94fe\u548c\u7ed3\u6784\u843d\u70b9\u3002',
  refresh: '\u5237\u65b0',
  create: '\u65b0\u5efa\u4e8b\u4ef6',
  generate: 'AI \u751f\u6210\u00b7\u6279\u91cf\u4e8b\u4ef6',
  clear: '\u6e05\u7a7a\u65f6\u95f4\u8f74',
  genre: '\u9898\u6750',
  timeSystem: '\u65f6\u95f4\u5236',
  timeZero: '\u65f6\u95f4\u96f6\u70b9',
  structureFilter: '\u7ed3\u6784\u8fc7\u6ee4',
  global: '\u5168\u5c40',
  filtered: '\u5df2\u6309\u7ed3\u6784\u7b5b\u9009',
  metricTotal: '\u4e8b\u4ef6\u6570\u91cf',
  metricMajor: '\u5173\u952e\u4e8b\u4ef6',
  metricResolved: '\u5df2\u56de\u6536',
  metricOpenThreads: '\u5f85\u56de\u6536\u7ebf',
  metricTotalHint: '\u5f53\u524d\u8fc7\u6ee4\u4e0b\u7684\u603b\u4e8b\u4ef6\u6570',
  metricMajorHint: '\u4f18\u5148\u68c0\u67e5\u7ed3\u6784\u843d\u70b9',
  metricResolvedHint: '\u5df2\u7ecf\u5b8c\u6210\u56de\u6536',
  metricOpenThreadsHint: '\u4ecd\u6302\u5728\u65f6\u95f4\u8f74\u4e0a\u7684\u95ee\u9898',
  boardTitle: '\u5f53\u524d\u7a97\u53e3\u6cf3\u9053',
  boardDescription: '\u5f53\u524d\u5206\u9875\u7a97\u53e3\u91cc\u7684\u4e8b\u4ef6\u6309\u72b6\u6001\u5206\u7ec4\u663e\u793a\u3002',
  boardEmpty: '\u5f53\u524d\u7b5b\u9009\u4e0b\u8fd8\u6ca1\u6709\u4e8b\u4ef6\u3002',
  boardLaneEmpty: '\u5f53\u524d\u5217\u6682\u65e0\u4e8b\u4ef6\u3002',
  listTitle: '\u4e8b\u4ef6\u5217\u8868',
  listDescription: '\u8fc7\u6ee4\u3001\u5206\u9875\u3001\u865a\u62df\u6eda\u52a8\u90fd\u8d70\u670d\u52a1\u7aef\u67e5\u8be2\u3002',
  listSummaryPrefix: '\u5f53\u524d\u7b5b\u51fa ',
  listSummaryMiddle: ' \u4e2a\u4e8b\u4ef6\uff0c\u672c\u9875\u663e\u793a ',
  listSummarySuffix: ' \u4e2a\u3002',
  listEmpty: '\u5f53\u524d\u7b5b\u9009\u4e0b\u8fd8\u6ca1\u6709\u4e8b\u4ef6\u3002',
  detailCreateTitle: '\u65b0\u5efa\u4e8b\u4ef6',
  detailEmptyTitle: '\u4e8b\u4ef6\u8be6\u60c5',
  detailDescription: '\u65f6\u95f4\u5b9a\u4e49\u3001\u7ed3\u6784\u951a\u70b9\u3001\u5267\u60c5\u6302\u70b9\u548c\u56e0\u679c\u94fe\u90fd\u53ea\u7f16\u8f91\u5f53\u524d\u4e8b\u4ef6\u3002',
  jumpToStructure: '\u8df3\u5230\u7ed3\u6784\u9875',
  delete: '\u5220\u9664',
  save: '\u4fdd\u5b58',
  selectEventHint: '\u5de6\u4fa7\u9009\u62e9\u4e00\u4e2a\u4e8b\u4ef6\u540e\uff0c\u8fd9\u91cc\u5c31\u80fd\u76f4\u63a5\u8865\u5b8c\u6574\u65f6\u95f4\u94fe\u4fe1\u606f\u3002\u4e5f\u53ef\u4ee5\u4ece\u96f6\u65b0\u5efa\u3002',
  anchorWarningTitle: '\u8fd9\u4e2a\u4e8b\u4ef6\u7684\u573a\u666f\u951a\u70b9\u5df2\u7ecf\u5931\u6548',
  anchorWarningDescription: '\u8bf7\u91cd\u65b0\u786e\u8ba4\u5377\u3001\u90e8\u3001\u7ae0\u8282\u6216\u573a\u666f\uff0c\u5426\u5219\u7ed3\u6784\u9875\u65e0\u6cd5\u7a33\u5b9a\u56de\u67e5\u5230\u5b83\u3002',
  modalTitle: 'AI \u751f\u6210\u00b7\u6279\u91cf\u65f6\u95f4\u8f74\u4e8b\u4ef6',
  modalOk: '\u751f\u6210\u4e0b\u4e00\u6279',
  generateCount: '\u672c\u8f6e\u76ee\u6807\u4e8b\u4ef6\u6570',
  generateBatchSize: '\u6bcf\u6279\u751f\u6210\u6570\u91cf',
  generateFocus: '\u989d\u5916\u805a\u7126',
  generateFocusPlaceholder: '\u4f8b\u5982\uff1a\u4e3b\u89d2\u884c\u52a8\u7ebf\u3001\u653f\u53d8\u524d\u540e\u8282\u70b9\u3001\u7269\u54c1\u56de\u6536\u6216\u611f\u60c5\u7ebf\u8f6c\u6298\u3002',
  generateHint1: '\u957f\u7bc7\u5efa\u8bae\u5148\u8865\u5173\u952e\u4e8b\u4ef6\u9aa8\u67b6\uff0c\u518d\u9010\u8f6e\u8ffd\u52a0\u4eba\u7269\u540e\u679c\u3001\u4f0f\u7b14\u548c\u56de\u6536\u8282\u70b9\u3002',
  generateHint2: '\u6bcf\u6279\u6570\u91cf\u8d8a\u5c0f\uff0c\u8d8a\u5bb9\u6613\u907f\u514d\u65f6\u95f4\u987a\u5e8f\u65ad\u88c2\u6216\u91cd\u590d\u751f\u6210\u3002',
  generateHint3: '\u5df2\u6709\u4e8b\u4ef6\u4f1a\u88ab\u5e26\u5165\u4e0a\u4e0b\u6587\uff0c\u7cfb\u7edf\u4f18\u5148\u8865\u7f3a\u53e3\uff0c\u4e0d\u6574\u6bb5\u91cd\u5199\u3002',
  generateSuccess: '\u65f6\u95f4\u8f74\u9996\u6279\u4e8b\u4ef6\u5df2\u8865\u9f50\u3002',
  saveSuccess: '\u4e8b\u4ef6\u5df2\u4fdd\u5b58\u3002',
  deleteSuccess: '\u4e8b\u4ef6\u5df2\u5220\u9664\u3002',
  clearSuccess: '\u4e8b\u4ef6\u65f6\u95f4\u8f74\u5df2\u6e05\u7a7a',
  saveFailed: '\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  generateFailed: '\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  deleteConfirmTitlePrefix: '\u5220\u9664\u300c',
  deleteConfirmTitleSuffix: '\u300d\uff1f',
  deleteConfirmContent: '\u5220\u9664\u540e\u4e0d\u4f1a\u81ea\u52a8\u6e05\u7406\u7ae0\u8282\u3001\u5927\u7eb2\u6216\u7269\u54c1\u4e2d\u7684\u5173\u8054\u6587\u5b57\uff0c\u8bf7\u786e\u8ba4\u8fd9\u4e0d\u662f\u4ecd\u5728\u4f7f\u7528\u7684\u4e8b\u4ef6\u3002',
  clearConfirmTitle: '\u6e05\u7a7a\u4e8b\u4ef6\u65f6\u95f4\u8f74\uff1f',
  clearConfirmContent: '\u4f1a\u5220\u9664\u5f53\u524d\u5c0f\u8bf4\u4e0b\u5168\u90e8\u65f6\u95f4\u8f74\u4e8b\u4ef6\uff0c\u4f46\u4e0d\u4f1a\u5220\u9664\u7ae0\u8282\u6b63\u6587\u3002',
  clearConfirmOk: '\u786e\u8ba4\u6e05\u7a7a',
  emptyType: '\u672a\u5206\u7c7b',
  majorEvent: '\u5173\u952e\u8282\u70b9',
  normalEvent: '\u666e\u901a\u8282\u70b9',
  emptyEventDescription: '\u8fd9\u6761\u4e8b\u4ef6\u8fd8\u6ca1\u6709\u8865\u51fa\u7ed3\u679c\u3002',
  emptySummary: '\u8fd9\u4e2a\u4e8b\u4ef6\u8fd8\u6ca1\u6709\u8865\u51fa\u6458\u8981\u3002',
  statusAll: '\u5168\u90e8\u72b6\u6001',
  typeAll: '\u5168\u90e8\u7c7b\u578b',
  volumeAll: '\u5168\u90e8\u5377',
  partAll: '\u5168\u90e8\u90e8',
  chapterAll: '\u5168\u90e8\u7ae0',
  notConfigured: '\u672a\u8bbe\u7f6e',
  currentThemeTimeline: '\u5f53\u524d\u9898\u6750\u65f6\u95f4\u5236',
  notDefined: '\u672a\u8bbe\u5b9a',
  defaultTimeModeHint: '\u5148\u7edf\u4e00\u53e3\u5f84\uff0c\u518d\u5199\u5177\u4f53\u4e8b\u4ef6\u3002',
  titleEvent: '\u4e8b\u4ef6\u6807\u9898',
  labelTime: '\u65f6\u95f4\u6807\u7b7e',
  labelSortValue: '\u6392\u5e8f\u503c',
  labelTimeMode: '\u65f6\u95f4\u6a21\u5f0f',
  labelTimePrecision: '\u65f6\u95f4\u7cbe\u5ea6',
  labelStatus: '\u5f53\u524d\u72b6\u6001',
  labelEventType: '\u4e8b\u4ef6\u7c7b\u578b',
  labelMajor: '\u5173\u952e\u8282\u70b9',
  labelProtagonistPresent: '\u4e3b\u89d2\u5728\u573a',
  labelSummary: '\u4e8b\u4ef6\u6458\u8981',
  labelVolume: '\u6240\u5c5e\u5377',
  labelPart: '\u6240\u5c5e\u90e8',
  labelChapterStart: '\u8d77\u59cb\u7ae0\u8282',
  labelChapterEnd: '\u7ed3\u675f\u7ae0\u8282',
  labelSegment: '\u843d\u70b9\u573a\u666f',
  labelArc: '\u5173\u8054\u6545\u4e8b\u5f27',
  labelLocation: '\u4e3b\u8981\u5730\u70b9',
  labelPresentCharacters: '\u5728\u573a\u4eba\u7269',
  labelAffectedCharacters: '\u53d7\u5f71\u54cd\u4eba\u7269',
  labelLinkedItems: '\u5173\u8054\u7269\u54c1',
  labelProtagonistAction: '\u4e3b\u89d2\u505a\u4e86\u4ec0\u4e48',
  labelEventCause: '\u4e8b\u4ef6\u8d77\u56e0',
  labelEventProcess: '\u4e8b\u4ef6\u8fc7\u7a0b',
  labelEventResult: '\u4e8b\u4ef6\u7ed3\u679c',
  labelDirectConsequences: '\u76f4\u63a5\u540e\u679c',
  labelOpenThreads: '\u5f85\u56de\u6536\u95ee\u9898',
  labelNotes: '\u8865\u5145\u5907\u6ce8',
  placeholderEventTitle: '\u4f8b\u5982\uff1a\u5357\u95e8\u8865\u7ed9\u7ebf\u65ad\u88c2',
  placeholderTimeLabel: '\u4f8b\u5982\uff1a\u707e\u53d8\u540e\u7b2c\u4e03\u5929',
  placeholderSummary: '\u7528 1-2 \u53e5\u8bdd\u8bf4\u660e\u8fd9\u4e2a\u4e8b\u4ef6\u4e3a\u4ec0\u4e48\u91cd\u8981\uff0c\u4e0d\u8981\u5199\u7a7a\u8bdd\u3002',
  placeholderProtagonistAction: '\u5199\u52a8\u4f5c\u6216\u9009\u62e9\uff0c\u4e0d\u8981\u5199\u62bd\u8c61\u8bc4\u4ef7\u3002',
  sectionTimeTitle: '\u65f6\u95f4\u5b9a\u4e49',
  sectionTimeDescription: '\u5148\u4fdd\u8bc1\u65f6\u95f4\u6807\u7b7e\u548c\u6392\u5e8f\u503c\u53ef\u8bfb\u3001\u53ef\u6392\u3001\u53ef\u56de\u67e5\u3002',
  sectionStructureTitle: '\u7ed3\u6784\u951a\u70b9',
  sectionStructureDescription: '\u5377\u3001\u90e8\u3001\u7ae0\u3001\u573a\u666f\u6309\u9700\u8054\u52a8\u52a0\u8f7d\uff0c\u4e0d\u518d\u4f9d\u8d56\u5168\u91cf\u6811\u3002',
  sectionPlotTitle: '\u5267\u60c5\u6302\u70b9',
  sectionPlotDescription: '\u628a\u65f6\u95f4\u8f74\u548c\u5927\u7eb2\u3001\u5730\u70b9\u63a5\u8d77\u6765\uff0c\u540e\u7eed\u5199\u6b63\u6587\u65f6\u80fd\u76f4\u63a5\u56de\u67e5\u3002',
  sectionCharacterTitle: '\u4eba\u7269\u4e0e\u7269\u54c1',
  sectionCharacterDescription: '\u5199\u6e05\u8c01\u5728\u573a\u3001\u8c01\u53d7\u5f71\u54cd\u3001\u4e3b\u89d2\u505a\u4e86\u4ec0\u4e48\uff0c\u4ee5\u53ca\u54ea\u4e9b\u7269\u54c1\u88ab\u7528\u5230\u3002',
  sectionCausalityTitle: '\u56e0\u679c\u94fe',
  sectionCausalityDescription: '\u5c3d\u91cf\u628a\u8d77\u56e0\u3001\u8fc7\u7a0b\u3001\u7ed3\u679c\u5199\u6210\u80fd\u76f4\u63a5\u63a5\u5230\u540e\u7eed\u7ae0\u8282\u7684\u53e5\u5b50\u3002',
  generateFocusDefault: '\u628a\u4e3b\u89d2\u3001\u5173\u952e\u5730\u70b9\u3001\u5173\u952e\u7269\u54c1\u548c\u4e3b\u7ebf\u51b2\u7a81\u4e32\u6210\u5b8c\u6574\u65f6\u95f4\u94fe\uff0c\u540c\u65f6\u8865\u4e0a\u540e\u679c\u4e0e\u672a\u56de\u6536\u7ebf\u7d22\u3002',
} as const

export const TIMELINE_STATUS_META: Record<TimelineEvent['status'], { label: string; color: string }> = {
  planned: { label: '\u8ba1\u5212\u4e2d', color: 'default' },
  seeded: { label: '\u5df2\u57cb\u70b9', color: 'orange' },
  written: { label: '\u5df2\u5199\u5165\u6b63\u6587', color: 'blue' },
  resolved: { label: '\u5df2\u56de\u6536', color: 'green' },
}

export const TIMELINE_BOARD_COLUMNS: TimelineEvent['status'][] = [
  'planned',
  'seeded',
  'written',
  'resolved',
]

export const TIME_MODE_OPTIONS = [
  { value: 'gregorian', label: '\u516c\u5386\u65f6\u95f4' },
  { value: 'regnal', label: '\u5e74\u53f7 / \u738b\u671d\u7eaa\u5e74' },
  { value: 'relative-disaster', label: '\u707e\u53d8\u540e\u76f8\u5bf9\u65f6\u95f4' },
  { value: 'custom-era', label: '\u865a\u6784\u7eaa\u5143' },
  { value: 'future-date', label: '\u672a\u6765\u65f6\u95f4' },
] as const

export const TIME_MODE_EXAMPLES: Record<string, string> = {
  gregorian: '\u793a\u4f8b\uff1a2026\u5e743\u67087\u65e5 21:00',
  regnal: '\u793a\u4f8b\uff1a\u662d\u5b81\u4e09\u5e74\u79cb / \u738b\u5386\u5341\u4e8c\u5e74\u51ac',
  'relative-disaster': '\u793a\u4f8b\uff1a\u707e\u53d8\u540e\u7b2c7\u5929 / \u65ad\u7535\u540e\u7b2c3\u5468',
  'custom-era': '\u793a\u4f8b\uff1a\u7384\u66dc\u7eaa\u4e09\u767e\u4e8c\u5341\u4e03\u5e74 / \u7b2c\u516d\u6b21\u5f00\u8352\u5b63',
  'future-date': '\u793a\u4f8b\uff1a\u516c\u51432089\u5e74 \u00b7 \u8fd1\u5730\u8f68\u9053\u7ad9\u65f6 04:20',
}

export function parseTimelineRoute(search: URLSearchParams): TimelineRouteState {
  return {
    eventId: parseOptionalNumber(search.get('eventId')),
    action: search.get('action'),
    volumeId: parseOptionalNumber(search.get('volumeId')),
    partId: parseOptionalNumber(search.get('partId')),
    chapterId: parseOptionalNumber(search.get('chapterId')),
    segmentId: parseOptionalNumber(search.get('segmentId')),
  }
}

export function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
      : []
  } catch {
    return []
  }
}

export function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .map((item) => {
          if (typeof item === 'number') return item
          if (typeof item === 'string') return Number(item)
          return Number.NaN
        })
        .filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

export function toTimelineFormValues(
  event: TimelineEvent,
  defaultMode: string,
  defaultPrecision: string,
  defaultType: string,
): TimelineFormValues {
  return {
    eventTitle: event.eventTitle,
    eventSummary: event.eventSummary || '',
    timeMode: event.timeMode || defaultMode,
    timeLabel: event.timeLabel,
    timeSortValue: event.timeSortValue ?? 0,
    timePrecision: event.timePrecision || defaultPrecision,
    isMajorEvent: Boolean(event.isMajorEvent),
    eventType: event.eventType || defaultType,
    arcId: event.arcId,
    volumeId: event.volumeId,
    partId: event.partId,
    chapterStartId: event.chapterStartId,
    chapterEndId: event.chapterEndId,
    segmentId: event.segmentId,
    locationMapId: event.locationMapId,
    presentCharacterIds: parseNumberArray(event.presentCharacterIdsJson),
    affectedCharacterIds: parseNumberArray(event.affectedCharacterIdsJson),
    linkedItemIds: parseNumberArray(event.linkedItemIdsJson),
    protagonistPresent: Boolean(event.protagonistPresent),
    protagonistAction: event.protagonistAction || '',
    eventCause: event.eventCause || '',
    eventProcess: event.eventProcess || '',
    eventResult: event.eventResult || '',
    directConsequences: parseStringArray(event.directConsequencesJson),
    openThreads: parseStringArray(event.openThreadsJson),
    notes: event.notes || '',
    status: event.status,
  }
}

export function serializeTimelineValues(values: TimelineFormValues): Partial<TimelineEvent> {
  return {
    eventTitle: values.eventTitle.trim(),
    eventSummary: values.eventSummary?.trim() || '',
    timeMode: values.timeMode,
    timeLabel: values.timeLabel.trim(),
    timeSortValue: Number(values.timeSortValue || 0),
    timePrecision: values.timePrecision?.trim() || '',
    isMajorEvent: values.isMajorEvent ? 1 : 0,
    eventType: values.eventType?.trim() || '',
    arcId: values.arcId,
    volumeId: values.volumeId,
    partId: values.partId,
    chapterStartId: values.chapterStartId,
    chapterEndId: values.chapterEndId,
    segmentId: values.segmentId,
    locationMapId: values.locationMapId,
    presentCharacterIdsJson: JSON.stringify(values.presentCharacterIds || []),
    affectedCharacterIdsJson: JSON.stringify(values.affectedCharacterIds || []),
    linkedItemIdsJson: JSON.stringify(values.linkedItemIds || []),
    protagonistPresent: values.protagonistPresent ? 1 : 0,
    protagonistAction: values.protagonistAction?.trim() || '',
    eventCause: values.eventCause?.trim() || '',
    eventProcess: values.eventProcess?.trim() || '',
    eventResult: values.eventResult?.trim() || '',
    directConsequencesJson: JSON.stringify(
      (values.directConsequences || []).map((item) => item.trim()).filter(Boolean),
    ),
    openThreadsJson: JSON.stringify(
      (values.openThreads || []).map((item) => item.trim()).filter(Boolean),
    ),
    notes: values.notes?.trim() || '',
    status: values.status,
  }
}

export function buildDefaultTimelineValues(
  defaultMode: string,
  defaultPrecision: string,
  defaultType: string,
  anchor: Partial<TimelineFormValues> = {},
  count = 1,
): TimelineFormValues {
  return {
    eventTitle: '',
    eventSummary: '',
    timeMode: defaultMode,
    timeLabel: '',
    timeSortValue: count,
    timePrecision: defaultPrecision,
    isMajorEvent: true,
    eventType: defaultType,
    arcId: undefined,
    volumeId: anchor.volumeId,
    partId: anchor.partId,
    chapterStartId: anchor.chapterStartId,
    chapterEndId: anchor.chapterEndId,
    segmentId: anchor.segmentId,
    locationMapId: undefined,
    presentCharacterIds: [],
    affectedCharacterIds: [],
    linkedItemIds: [],
    protagonistPresent: true,
    protagonistAction: '',
    eventCause: '',
    eventProcess: '',
    eventResult: '',
    directConsequences: [],
    openThreads: [],
    notes: '',
    status: 'planned',
  }
}

export function mergeEntitiesById<T extends { id: number }>(
  base: T[],
  extras: Array<T | null | undefined>,
): T[] {
  const map = new Map(base.map((item) => [item.id, item]))
  extras.forEach((item) => {
    if (item) map.set(item.id, item)
  })
  return [...map.values()]
}

export function buildStructureTags(
  event: TimelineEvent,
  lookups: {
    volumeById: Map<number, StoryStructureVolumeSummary>
    partById: Map<number, StoryStructurePartSummary>
    chapterById: Map<number, StoryStructureChapterSummary>
    segmentById: Map<number, StoryStructureSegmentSummary>
  },
): string[] {
  const tags: string[] = []

  if (event.volumeId && lookups.volumeById.get(event.volumeId)) {
    const volume = lookups.volumeById.get(event.volumeId)!
    tags.push(volume.title || `\u7b2c ${volume.volumeNumber} \u5377`)
  }

  if (event.partId && lookups.partById.get(event.partId)) {
    const part = lookups.partById.get(event.partId)!
    tags.push(part.title || `\u7b2c ${part.partNumber} \u90e8`)
  }

  if (event.chapterStartId && lookups.chapterById.get(event.chapterStartId)) {
    const chapter = lookups.chapterById.get(event.chapterStartId)!
    tags.push(`\u7b2c ${chapter.chapterNum} \u7ae0`)
  }

  if (event.segmentId && lookups.segmentById.get(event.segmentId)) {
    const segment = lookups.segmentById.get(event.segmentId)!
    tags.push(segment.title || '\u573a\u666f')
  }

  return tags
}

export function buildStructureJumpParams(event: TimelineEvent): URLSearchParams {
  const params = new URLSearchParams()

  if (event.volumeId) params.set('volumeId', String(event.volumeId))
  if (event.partId) params.set('partId', String(event.partId))
  if (event.chapterStartId) params.set('chapterId', String(event.chapterStartId))
  if (event.segmentId) params.set('segmentId', String(event.segmentId))

  return params
}

export function getInitialGenerateValues(): TimelineGenerateValues {
  return {
    count: 12,
    batchSize: 4,
    focus: '',
  }
}

export interface TimelineSearchHelpers {
  searchCharacters: (keyword?: string) => Promise<void>
  searchLocations: (keyword?: string) => Promise<void>
  searchItems: (keyword?: string) => Promise<void>
}

export interface TimelineEntityOptions {
  arcs: StoryArc[]
  characterOptions: Character[]
  formChapters: StoryStructureChapterSummary[]
  formParts: StoryStructurePartSummary[]
  formSegments: StoryStructureSegmentSummary[]
  itemOptions: StoryItem[]
  locationOptions: MapNodeSummary[]
  volumes: StoryStructureVolumeSummary[]
}

