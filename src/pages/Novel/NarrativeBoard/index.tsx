import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Select,
  Spin,
  Tag,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BranchesOutlined,
  CompassOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  LinkOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SearchOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import type {
  Chapter,
  Character,
  CharacterGraphPayload,
  CharacterLocationBinding,
  CharacterRelation,
  CreativeStage,
  CreativeStageContext,
  Faction,
  MapRelation,
  MapBoardLayoutNode,
  MapBoardViewport,
  NarrativeBoardSnapshot,
  QualityDashboardData,
  StoryThread,
  Task,
  TimelineEvent,
  WorldMapItem,
} from '../../../types'
import CreativeStageScope from '../../../components/novel/CreativeStageScope'
import CharacterGraphCanvas from '../Characters/CharacterGraphCanvas'
import NarrativeMapCanvas from './NarrativeMapCanvas'
import { useNovelStore } from '../../../stores/novel.store'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import {
  characterTokens,
  filterWorldMapTreeByIds,
  findWorldMapNode,
  flattenWorldMapTree,
  getWorldMapDescendantIds,
  getWorldMapPath,
  isTimelineEventInChapterWindow,
  mapNodeMatchesTokens,
  parseJsonNumberIds,
  parseJsonTokens,
  parseNarrativeBoardRoute,
  setNarrativeBoardParam,
  type CharacterBoardLayout,
  type NarrativeBoardMode,
  type NarrativeScope,
} from '../../../shared/narrative-board'
import {
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceStepGuide,
} from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import '../Characters/character-workspace.css'
import './narrative-board.css'

interface ContextStatus {
  contextVersion?: number
  staleChapterCount?: number
  staleAssetCount?: number
  staleCheckpointCount?: number
  staleAssetLabels?: string[]
}

interface NovelStats {
  totalChapters: number
  completedChapters: number
  totalWords: number
  characterCount: number
}

interface BoardData {
  tree: WorldMapItem[]
  mapRelations: MapRelation[]
  characterGraph: CharacterGraphPayload
  characters: Character[]
  events: TimelineEvent[]
  chapters: Chapter[]
  tasks: Task[]
  factions: Faction[]
  threads: StoryThread[]
  stages: CreativeStage[]
  stageContext: CreativeStageContext | null
  contextStatus: ContextStatus | null
  quality: QualityDashboardData | null
  novelStats: NovelStats
  mapTotal: number
  characterTotal: number
  bindings: CharacterLocationBinding[]
  mapLayout: MapBoardLayoutNode[]
  viewport: MapBoardViewport | null
  unresolvedAnchorCount: number
}

type NarrativeBoardRoute = ReturnType<typeof parseNarrativeBoardRoute>
type AiRatePoint = { chapterNum: number; rate: number }
type MapEditValues = { name: string; description: string; atmosphere: string; plotRelevance: string; dangerLevel: string }

interface NarrativeBoardViewModel {
  route: NarrativeBoardRoute
  scopeSummary: string
  stageId?: number
  selectedMapId?: number
  selectedThreadId?: number
  stageFilteredTree: WorldMapItem[]
  mapCanvasNodes: WorldMapItem[]
  mapPath: WorldMapItem[]
  selectedMap: WorldMapItem | null
  flatMap: WorldMapItem[]
  selectedMapPeople: Character[]
  selectedCharacter: Character | null
  selectedCharacterLocations: string[]
  selectedCharacterRelations: CharacterRelation[]
  graphData: CharacterGraphPayload
  visibleCharacters: Character[]
  visibleEvents: TimelineEvent[]
  data: BoardData
  effectiveScope: NarrativeScope
  latestAiRate?: AiRatePoint
  aiRateDelta: number
  contextVersion: number
  wordProgress: number
  factionNameById: Map<number, string>
  charactersById: Map<number, Character>
}

const EMPTY_DATA: BoardData = {
  tree: [],
  mapRelations: [],
  characterGraph: { characters: [], relations: [] },
  characters: [],
  events: [],
  chapters: [],
  tasks: [],
  factions: [],
  threads: [],
  stages: [],
  stageContext: null,
  contextStatus: null,
  quality: null,
  novelStats: { totalChapters: 0, completedChapters: 0, totalWords: 0, characterCount: 0 },
  mapTotal: 0,
  characterTotal: 0,
  bindings: [],
  mapLayout: [],
  viewport: null,
  unresolvedAnchorCount: 0,
}

const ROLE_LABELS: Record<Character['roleType'], string> = {
  protagonist: '主角',
  major: '主要人物',
  antagonist: '对立角色',
  supporting: '功能角色',
  minor: '次要人物',
}

const ROLE_COLORS: Record<Character['roleType'], string> = {
  protagonist: '#1b6578',
  major: '#a26d31',
  antagonist: '#a74642',
  supporting: '#5a7d42',
  minor: '#71647d',
}

const RELATION_LABELS: Record<string, string> = {
  family: '亲属',
  lover: '恋人',
  friend: '朋友',
  ally: '同盟',
  mentor_student: '师徒',
  colleague: '同事',
  subordinate: '上下级',
  stranger: '陌生',
  acquaintance: '熟人',
  rival: '竞争',
  enemy: '敌对',
}

const TASK_LABELS: Record<string, string> = {
  character_auto_generate: '人物生成',
  map_auto_generate: '地图生成',
  timeline_auto_generate: '时间轴生成',
  chapter_write: '正文生产',
  chapter_quality_analysis: '章节质检',
  planning_draft: '规划草稿',
}

function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch((error) => {
    console.warn('[narrative-board] optional data unavailable', error)
    return fallback
  })
}

function normalizeText(value?: string | null): string {
  return value?.replace(/\s+/gu, ' ').trim() || ''
}

function truncate(value: string | undefined, max = 86): string {
  const text = normalizeText(value)
  return text.length > max ? `${text.slice(0, max).trim()}…` : text
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case 'active':
    case 'running':
      return '进行中'
    case 'success':
    case 'resolved':
      return '已完成'
    case 'failed':
      return '失败'
    case 'paused':
      return '已暂停'
    case 'cancelled':
      return '已停止'
    case 'blocked':
      return '已阻塞'
    case 'planned':
      return '待推进'
    default:
      return status || '未标记'
  }
}

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 2)
}

function parseNameOrIds(raw?: string | null): Array<number | string> {
  return parseJsonTokens(raw)
}

function relationTitle(relation: CharacterRelation, charactersById: Map<number, Character>): string {
  const left = charactersById.get(relation.charAId)?.fullName || `人物#${relation.charAId}`
  const right = charactersById.get(relation.charBId)?.fullName || `人物#${relation.charBId}`
  return `${left} × ${right}`
}

function eventCharacterIds(event: TimelineEvent): number[] {
  return parseJsonNumberIds(event.presentCharacterIdsJson, event.affectedCharacterIdsJson)
}

function eventParticipantNames(event: TimelineEvent, charactersById: Map<number, Character>): string[] {
  return eventCharacterIds(event)
    .map((id) => charactersById.get(id)?.fullName || `人物#${id}`)
    .slice(0, 4)
}

function eventThreadIds(event: TimelineEvent, threads: StoryThread[]): number[] {
  const tokens = parseJsonTokens(event.openThreadsJson)
  return threads
    .filter((thread) => tokens.some((token) => token === thread.id || (typeof token === 'string' && token === thread.title)))
    .map((thread) => thread.id)
}

function getCharacterLocationNames(
  character: Character,
  mapNodes: WorldMapItem[],
  events: TimelineEvent[],
  bindings: CharacterLocationBinding[] = [],
): string[] {
  const flat = flattenWorldMapTree(mapNodes)
  const boundIds = new Set(bindings.filter((binding) => binding.characterId === character.id).map((binding) => binding.mapNodeId))
  const boundNames = flat.filter((node) => boundIds.has(node.id)).map((node) => node.name)
  if (boundNames.length > 0) return [...new Set(boundNames)]
  const tokens = characterTokens(character)
  const names = flat.filter((node) => mapNodeMatchesTokens(node, tokens)).map((node) => node.name)
  if (names.length > 0) return [...new Set(names)]

  const latestEvent = events
    .filter((event) => eventCharacterIds(event).includes(character.id) && typeof event.locationMapId === 'number')
    .sort((left, right) => right.timeSortValue - left.timeSortValue)[0]
  const latestNode = latestEvent?.locationMapId ? flat.find((node) => node.id === latestEvent.locationMapId) : null
  return latestNode ? [latestNode.name] : []
}

function getMapNodePeople(
  node: WorldMapItem | null,
  characters: Character[],
  events: TimelineEvent[],
  bindings: CharacterLocationBinding[] = [],
): Character[] {
  if (!node) return []
  const descendants = flattenWorldMapTree([node])
  const ids = new Set(descendants.map((item) => item.id))
  const names = new Set(descendants.map((item) => item.name))
  const eventPeople = new Set(
    events.filter((event) => typeof event.locationMapId === 'number' && ids.has(event.locationMapId))
      .flatMap(eventCharacterIds),
  )
  const bindingPeople = new Set(
    bindings.filter((binding) => ids.has(binding.mapNodeId)).map((binding) => binding.characterId),
  )
  return characters.filter((character) => (
    characterTokens(character).some((token) => typeof token === 'number' ? ids.has(token) : names.has(token))
    || eventPeople.has(character.id)
    || bindingPeople.has(character.id)
  ))
}

function filterMapTreeByKeyword(tree: WorldMapItem[], keyword: string): WorldMapItem[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return tree
  return tree
    .map((item) => ({ ...item, children: filterMapTreeByKeyword(item.children || [], keyword) }))
    .filter((item) => (
      [item.name, item.locationType, item.nodeType, item.structureRole, item.description, item.plotRelevance]
        .some((value) => normalizeText(value).toLowerCase().includes(normalized))
      || (item.children || []).length > 0
    ))
}

function getTaskProgress(task: Task): number | undefined {
  if (!task.progressJson) return undefined
  try {
    const parsed = JSON.parse(task.progressJson) as { progress?: unknown; percent?: unknown; completed?: unknown; total?: unknown }
    if (typeof parsed.percent === 'number') return Math.max(0, Math.min(100, parsed.percent))
    if (typeof parsed.progress === 'number') return Math.max(0, Math.min(100, parsed.progress))
    if (typeof parsed.completed === 'number' && typeof parsed.total === 'number' && parsed.total > 0) {
      return Math.round(parsed.completed / parsed.total * 100)
    }
  } catch {
    return undefined
  }
  return undefined
}

function chapterNumMap(chapters: Chapter[]): Map<number, number> {
  return new Map(chapters.map((chapter) => [chapter.id, chapter.chapterNum]))
}

function filterVisibleTimelineEvents(
  events: TimelineEvent[],
  stageId: number | undefined,
  stageContext: CreativeStageContext | null,
  scope: NarrativeScope,
  chapterNumbers: Map<number, number>,
  threads: StoryThread[],
  selectedThreadId?: number,
  strictAnchors = true,
): TimelineEvent[] {
  if (stageId && !stageContext) return []
  return events
    .filter((event) => isTimelineEventInChapterWindow(event, scope, chapterNumbers, strictAnchors))
    .filter((event) => !selectedThreadId || eventThreadIds(event, threads).includes(selectedThreadId))
}

function formatChapterRange(scope: NarrativeScope): string {
  if (scope.chapterStart && scope.chapterEnd) return `第 ${scope.chapterStart}–${scope.chapterEnd} 章`
  if (scope.chapterStart) return `第 ${scope.chapterStart} 章起`
  if (scope.chapterEnd) return `截至第 ${scope.chapterEnd} 章`
  return '全书范围'
}

function aiRateMetricValue(rate?: AiRatePoint): string {
  return rate ? `${rate.rate}%` : '暂无'
}

function aiRateMetricTone(rate?: AiRatePoint): 'warm' | 'cool' {
  return rate && rate.rate >= 35 ? 'warm' : 'cool'
}

function guideStepStatus(active: boolean, completed: boolean): 'todo' | 'focus' | 'done' {
  return completed ? 'done' : active ? 'focus' : 'todo'
}

export default function NarrativeBoardPage({ novelId }: { novelId: number }) {
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const route = useMemo(() => parseNarrativeBoardRoute(searchParams.toString(), novelId), [novelId, searchParams])
  const [data, setData] = useState<BoardData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [editMapOpen, setEditMapOpen] = useState(false)
  const [editMapValues, setEditMapValues] = useState<MapEditValues>({ name: '', description: '', atmosphere: '', plotRelevance: '', dangerLevel: '' })
  const requestIdRef = useRef(0)

  const stageId = route.scope.stageId
  const selectedMapId = route.scope.mapNodeId
  const selectedCharacterId = route.scope.characterIds?.[0]
  const selectedThreadId = route.scope.storyThreadIds?.[0]

  const refresh = useCallback(async (quiet = false) => {
    const requestId = ++requestIdRef.current
    if (quiet) setRefreshing(true)
    else setLoading(true)

    const snapshot = await safe(window.electron.narrativeBoard.getSnapshot({
      ...route.scope,
      novelId,
      keyword: searchParams.get('keyword') || undefined,
      strictAnchors: true,
    }), null as NarrativeBoardSnapshot | null)
    if (requestIdRef.current !== requestId) return
    if (!snapshot) {
      setData(EMPTY_DATA)
      setLoading(false)
      setRefreshing(false)
      return
    }
    setData({
      tree: snapshot.tree,
      mapRelations: snapshot.mapRelations,
      characterGraph: snapshot.characterGraph,
      characters: snapshot.characters,
      events: snapshot.events,
      chapters: snapshot.chapters,
      tasks: snapshot.tasks,
      factions: snapshot.factions,
      threads: snapshot.threads,
      stages: snapshot.stages,
      stageContext: snapshot.stageContext,
      contextStatus: snapshot.contextStatus,
      quality: snapshot.quality,
      novelStats: snapshot.novelStats,
      mapTotal: Number(snapshot.totals.map || flattenWorldMapTree(snapshot.tree).length),
      characterTotal: Number(snapshot.totals.characters || snapshot.characters.length),
      bindings: snapshot.bindings,
      mapLayout: snapshot.mapLayout,
      viewport: snapshot.viewport,
      unresolvedAnchorCount: Number(snapshot.totals.unresolvedAnchors || 0),
    })
    setLoading(false)
    setRefreshing(false)
  }, [novelId, route.scope, searchParams])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void refresh() })
    return () => window.cancelAnimationFrame(frame)
  }, [refresh])

  const updateRoute = useCallback((key: string, value: string | number | null | undefined) => {
    setSearchParams((current) => setNarrativeBoardParam(current.toString(), key, value), { replace: true })
  }, [setSearchParams])

  const setMode = useCallback((mode: NarrativeBoardMode) => updateRoute('mode', mode === 'map' ? null : mode), [updateRoute])
  const setLayout = useCallback((layout: CharacterBoardLayout) => updateRoute('layout', layout === 'relations' ? null : layout), [updateRoute])

  const stageFilteredTree = useMemo(() => {
    if (!stageId) return data.tree
    if (!data.stageContext || data.stageContext.activeMapIds.length === 0) return []
    return filterWorldMapTreeByIds(data.tree, new Set(data.stageContext.activeMapIds))
  }, [data.stageContext, data.tree, stageId])

  const mapTree = useMemo(() => filterMapTreeByKeyword(stageFilteredTree, searchParams.get('keyword') || ''), [searchParams, stageFilteredTree])
  const flatMap = useMemo(() => flattenWorldMapTree(stageFilteredTree), [stageFilteredTree])
  const selectedMap = useMemo(() => findWorldMapNode(stageFilteredTree, selectedMapId), [selectedMapId, stageFilteredTree])
  const mapPath = useMemo(() => getWorldMapPath(stageFilteredTree, selectedMapId), [selectedMapId, stageFilteredTree])
  const mapCanvasNodes = useMemo(() => {
    if (selectedMap?.children?.length) return selectedMap.children
    if (selectedMap) return [selectedMap]
    return mapTree
  }, [mapTree, selectedMap])

  const chapterNumbers = useMemo(() => chapterNumMap(data.chapters), [data.chapters])
  const effectiveScope = useMemo<NarrativeScope>(() => ({
    ...route.scope,
    chapterStart: route.scope.chapterStart ?? (stageId ? data.stageContext?.stage.chapterStart : undefined),
    chapterEnd: route.scope.chapterEnd ?? (stageId ? data.stageContext?.stage.chapterEnd : undefined),
  }), [data.stageContext, route.scope, stageId])
  const visibleEvents = useMemo(() => filterVisibleTimelineEvents(data.events, stageId, data.stageContext, effectiveScope, chapterNumbers, data.threads, selectedThreadId), [chapterNumbers, data.events, data.stageContext, data.threads, effectiveScope, selectedThreadId, stageId])

  const visibleCharacterIds = useMemo(() => {
    if (!stageId || !data.stageContext || data.stageContext.activeCharacterIds.length === 0) return null
    return new Set(data.stageContext.activeCharacterIds)
  }, [data.stageContext, stageId])

  const visibleCharacters = useMemo(() => {
    const keyword = (searchParams.get('keyword') || '').trim().toLowerCase()
    const threadCharacterIds = selectedThreadId
      ? new Set(data.threads.find((thread) => thread.id === selectedThreadId) ? parseJsonNumberIds(data.threads.find((thread) => thread.id === selectedThreadId)?.relatedCharacterIdsJson) : [])
      : null
    return data.characterGraph.characters
      .filter((character) => !visibleCharacterIds || visibleCharacterIds.has(character.id))
      .filter((character) => !threadCharacterIds || threadCharacterIds.has(character.id) || visibleEvents.some((event) => eventCharacterIds(event).includes(character.id)))
      .filter((character) => !keyword || [character.fullName, character.occupation, character.goals, character.background, character.socialIdentity].some((value) => normalizeText(value).toLowerCase().includes(keyword)))
  }, [data.characterGraph.characters, data.threads, searchParams, selectedThreadId, visibleCharacterIds, visibleEvents])

  const visibleCharacterIdSet = useMemo(() => new Set(visibleCharacters.map((character) => character.id)), [visibleCharacters])
  const visibleRelations = useMemo(() => data.characterGraph.relations.filter((relation) => visibleCharacterIdSet.has(relation.charAId) && visibleCharacterIdSet.has(relation.charBId)), [data.characterGraph.relations, visibleCharacterIdSet])
  const graphData = useMemo<CharacterGraphPayload>(() => ({
    characters: visibleCharacters,
    relations: visibleRelations,
  }), [visibleCharacters, visibleRelations])
  const selectedCharacter = useMemo(() => visibleCharacters.find((character) => character.id === selectedCharacterId)
    || visibleCharacters.find((character) => character.roleType === 'protagonist')
    || visibleCharacters[0]
    || null, [selectedCharacterId, visibleCharacters])

  const charactersById = useMemo(() => new Map(data.characters.map((character) => [character.id, character])), [data.characters])
  const selectedMapPeople = useMemo(() => getMapNodePeople(selectedMap, visibleCharacters, visibleEvents, data.bindings), [data.bindings, selectedMap, visibleCharacters, visibleEvents])
  const factionNameById = useMemo(() => new Map(data.factions.map((faction) => [faction.id, faction.name])), [data.factions])
  const selectedCharacterLocations = useMemo(() => selectedCharacter ? getCharacterLocationNames(selectedCharacter, flatMap, visibleEvents, data.bindings) : [], [data.bindings, flatMap, selectedCharacter, visibleEvents])
  const selectedCharacterRelations = useMemo(() => selectedCharacter ? visibleRelations.filter((relation) => relation.charAId === selectedCharacter.id || relation.charBId === selectedCharacter.id) : [], [selectedCharacter, visibleRelations])
  const latestAiRate = data.quality?.aiLikeRateTrend?.[data.quality.aiLikeRateTrend.length - 1]
  const previousAiRate = data.quality?.aiLikeRateTrend?.[Math.max(0, data.quality.aiLikeRateTrend.length - 2)]
  const aiRateDelta = latestAiRate && previousAiRate ? latestAiRate.rate - previousAiRate.rate : 0
  const contextVersion = data.contextStatus?.contextVersion || currentNovel?.contextVersion || 1
  const targetWords = currentNovel?.targetWords || 0
  const wordProgress = targetWords > 0 ? Math.min(100, Math.round(data.novelStats.totalWords / targetWords * 100)) : 0

  const selectMap = useCallback((node: WorldMapItem | null) => {
    updateRoute('mapNodeId', node?.id || null)
  }, [updateRoute])

  const enterMapNode = useCallback((node: WorldMapItem) => {
    selectMap(node)
    setMode('map')
  }, [selectMap, setMode])

  const selectCharacter = useCallback((characterId: number | null) => {
    updateRoute('focusCharacterId', characterId)
    if (characterId) setMode('characters')
  }, [setMode, updateRoute])

  const openMapEditor = useCallback(() => {
    if (!selectedMap) return
    setEditMapValues({
      name: selectedMap.name,
      description: selectedMap.description || '',
      atmosphere: selectedMap.atmosphere || '',
      plotRelevance: selectedMap.plotRelevance || '',
      dangerLevel: selectedMap.dangerLevel || '',
    })
    setEditMapOpen(true)
  }, [selectedMap])

  const saveMapEditor = useCallback(async () => {
    if (!selectedMap || !editMapValues.name.trim()) return
    try {
      await window.electron.map.update(selectedMap.id, {
        name: editMapValues.name.trim(),
        description: editMapValues.description,
        atmosphere: editMapValues.atmosphere,
        plotRelevance: editMapValues.plotRelevance,
        dangerLevel: editMapValues.dangerLevel,
      })
      setEditMapOpen(false)
      await refresh(true)
      notifyWorkspaceMutation()
      message.success('地区信息已保存')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '地区信息保存失败')
    }
  }, [editMapValues, notifyWorkspaceMutation, refresh, selectedMap])

  const scopeSummary = [
    data.stageContext?.stage.name || (stageId ? `阶段 #${stageId}` : '全书'),
    formatChapterRange(effectiveScope),
    selectedThreadId ? data.threads.find((thread) => thread.id === selectedThreadId)?.title || `线程 #${selectedThreadId}` : '全部线程',
  ].join(' · ')

  const clearScope = useCallback(() => {
    const cleared = new URLSearchParams()
    if (route.mode !== 'map') cleared.set('mode', route.mode)
    if (route.mode === 'characters' && route.layout !== 'relations') cleared.set('layout', route.layout)
    setSearchParams(cleared, { replace: true })
  }, [route.layout, route.mode, setSearchParams])

  const boardModel: NarrativeBoardViewModel = {
    route,
    scopeSummary,
    stageId,
    selectedMapId,
    selectedThreadId,
    stageFilteredTree,
    mapCanvasNodes,
    mapPath,
    selectedMap,
    flatMap,
    selectedMapPeople,
    selectedCharacter,
    selectedCharacterLocations,
    selectedCharacterRelations,
    graphData,
    visibleCharacters,
    visibleEvents,
    data,
    effectiveScope,
    latestAiRate,
    aiRateDelta,
    contextVersion,
    wordProgress,
    factionNameById,
    charactersById,
  }

  return (
    <WorkspacePage
      chrome="shared"
      actionContract={{
        primary: { key: 'refresh', label: '刷新看板', icon: <ReloadOutlined />, loading: refreshing, onClick: () => void refresh(true) },
        secondary: [
          { key: 'map', label: '地点结构', icon: <CompassOutlined />, onClick: () => { window.location.hash = buildWorkspaceRoute(novelId, 'map') } },
          { key: 'characters', label: '人物档案', icon: <TeamOutlined />, onClick: () => { window.location.hash = buildWorkspaceRoute(novelId, 'characters') } },
        ],
      }}
      eyebrow="叙事战略桌"
      title="叙事看板"
      layout="wide"
      scrollMode="document"
      heroVariant="compact"
      metrics={<NarrativeBoardMetrics data={data} latestAiRate={latestAiRate} />}
      guide={<NarrativeBoardGuide mode={route.mode} hasScope={Boolean(stageId || effectiveScope.chapterStart || selectedThreadId)} />}
      bodyClassName="narrative-board-page__body"
      className="narrative-board-page"
    >
      <NarrativeBoardContent
        model={boardModel}
        novelId={novelId}
        loading={loading}
        keyword={searchParams.get('keyword') || ''}
        updateRoute={updateRoute}
        clearScope={clearScope}
        setMode={setMode}
        setLayout={setLayout}
        selectMap={selectMap}
        enterMapNode={enterMapNode}
        selectCharacter={selectCharacter}
        openMapEditor={openMapEditor}
      />
      <MapEditModal open={editMapOpen} values={editMapValues} setValues={setEditMapValues} onCancel={() => setEditMapOpen(false)} onSave={saveMapEditor} confirmLoading={refreshing} />
    </WorkspacePage>
  )
}

interface NarrativeBoardContentProps {
  model: NarrativeBoardViewModel
  novelId: number
  loading: boolean
  keyword: string
  updateRoute: (key: string, value: string | number | null | undefined) => void
  clearScope: () => void
  setMode: (mode: NarrativeBoardMode) => void
  setLayout: (layout: CharacterBoardLayout) => void
  selectMap: (node: WorldMapItem | null) => void
  enterMapNode: (node: WorldMapItem) => void
  selectCharacter: (characterId: number | null) => void
  openMapEditor: () => void
}

function NarrativeBoardContent({
  model,
  novelId,
  loading,
  keyword,
  updateRoute,
  clearScope,
  setMode,
  setLayout,
  selectMap,
  enterMapNode,
  selectCharacter,
  openMapEditor,
}: NarrativeBoardContentProps) {
  if (loading) {
    return <div className="narrative-board-loading"><Spin size="large" /><span>正在整理地点、人物和剧情上下文…</span></div>
  }
  return (
    <div className="narrative-board" data-narrative-board data-board-mode={model.route.mode}>
      <NarrativeBoardScopeControls model={model} novelId={novelId} keyword={keyword} updateRoute={updateRoute} clearScope={clearScope} />
      <NarrativeBoardToolbar model={model} setMode={setMode} setLayout={setLayout} />
      <NarrativeBoardWorkbench
        model={model}
        novelId={novelId}
        selectMap={selectMap}
        enterMapNode={enterMapNode}
        selectCharacter={selectCharacter}
        openMapEditor={openMapEditor}
        updateRoute={updateRoute}
        setMode={setMode}
      />
      <NarrativeBoardFooter model={model} />
    </div>
  )
}

function NarrativeBoardMetrics({ data, latestAiRate }: { data: BoardData; latestAiRate?: AiRatePoint }) {
  return <>
    <WorkspaceMetric label="地点" value={`${data.mapTotal}`} tone="warm" />
    <WorkspaceMetric label="人物" value={`${data.characterTotal}`} tone="cool" />
    <WorkspaceMetric label="关系" value={`${data.characterGraph.relations.length}`} />
    <WorkspaceMetric label="AI 味" value={aiRateMetricValue(latestAiRate)} tone={aiRateMetricTone(latestAiRate)} />
  </>
}

function NarrativeBoardGuide({ mode, hasScope }: { mode: NarrativeBoardMode; hasScope: boolean }) {
  return <WorkspaceStepGuide title="看板使用顺序" steps={[
    { title: '锁定范围', description: '选择当前创作阶段、章节窗口或剧情线程。', status: guideStepStatus(hasScope, false) },
    { title: '看空间', description: '点击区域查看人物、事件和任务，再进入下一级地点。', status: guideStepStatus(mode === 'map', false) },
    { title: '看人物', description: '切换关系、阵营或地区演员表，聚焦一跳关系。', status: guideStepStatus(mode === 'characters', false) },
    { title: '看进度', description: '结合事件、任务、上下文和 AI 味趋势决定下一步。', status: guideStepStatus(mode === 'progress', false) },
  ]} />
}

function MapEditModal({
  open,
  values,
  setValues,
  onCancel,
  onSave,
  confirmLoading,
}: {
  open: boolean
  values: MapEditValues
  setValues: React.Dispatch<React.SetStateAction<MapEditValues>>
  onCancel: () => void
  onSave: () => void
  confirmLoading: boolean
}) {
  return (
    <Modal title="编辑地区信息" open={open} onCancel={onCancel} onOk={onSave} okText="保存地区" cancelText="取消" confirmLoading={confirmLoading}>
      <div className="narrative-board__edit-form">
        <label>地区名称<Input value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>剧情作用<Input.TextArea rows={3} value={values.plotRelevance} onChange={(event) => setValues((current) => ({ ...current, plotRelevance: event.target.value }))} /></label>
        <label>氛围<Input.TextArea rows={2} value={values.atmosphere} onChange={(event) => setValues((current) => ({ ...current, atmosphere: event.target.value }))} /></label>
        <label>危险等级<Input value={values.dangerLevel} onChange={(event) => setValues((current) => ({ ...current, dangerLevel: event.target.value }))} /></label>
        <label>简介<Input.TextArea rows={4} value={values.description} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} /></label>
      </div>
    </Modal>
  )
}

function NarrativeBoardScopeControls({
  model,
  novelId,
  keyword,
  updateRoute,
  clearScope,
}: {
  model: NarrativeBoardViewModel
  novelId: number
  keyword: string
  updateRoute: NarrativeBoardContentProps['updateRoute']
  clearScope: () => void
}) {
  return (
    <section className="narrative-board__scope" aria-label="叙事范围">
      <div className="narrative-board__scope-main">
        <CreativeStageScope novelId={novelId} value={model.stageId || null} onChange={(value) => updateRoute('stageId', value)} />
        <div className="narrative-board__range">
          <FieldTimeOutlined />
          <InputNumber size="small" min={1} value={model.route.scope.chapterStart} placeholder="起始章" onChange={(value) => updateRoute('chapterStart', value || null)} />
          <span>—</span>
          <InputNumber size="small" min={1} value={model.route.scope.chapterEnd} placeholder="结束章" onChange={(value) => updateRoute('chapterEnd', value || null)} />
        </div>
        <Select
          size="small"
          allowClear
          value={model.selectedThreadId}
          placeholder="全部剧情线程"
          className="narrative-board__thread-select"
          options={model.data.threads.map((thread) => ({ value: thread.id, label: `${thread.title} · ${statusLabel(thread.status)}` }))}
          onChange={(value) => updateRoute('threadId', value || null)}
        />
        <Input
          size="small"
          allowClear
          value={keyword}
          prefix={<SearchOutlined />}
          placeholder="搜索地点、人物或事件"
          className="narrative-board__search"
          onChange={(event) => updateRoute('keyword', event.target.value || null)}
        />
      </div>
      <div className="narrative-board__scope-meta">
        <span>{model.scopeSummary}</span>
        <Button size="small" type="text" onClick={clearScope}>清除范围</Button>
      </div>
    </section>
  )
}

function NarrativeBoardToolbar({
  model,
  setMode,
  setLayout,
}: {
  model: NarrativeBoardViewModel
  setMode: (mode: NarrativeBoardMode) => void
  setLayout: (layout: CharacterBoardLayout) => void
}) {
  const note = model.route.mode === 'map'
    ? '区域点击查看详情，双击进入下一级'
    : model.route.mode === 'characters'
      ? '选择人物后只突出其一跳关系'
      : '事件、任务和质量信号来自同一范围'

  return (
    <section className="narrative-board__toolbar" aria-label="看板视图">
      <Radio.Group value={model.route.mode} onChange={(event) => setMode(event.target.value)} optionType="button" buttonStyle="solid" size="small">
        <Radio.Button value="map"><CompassOutlined /> 空间地图</Radio.Button>
        <Radio.Button value="characters"><TeamOutlined /> 人物关系</Radio.Button>
        <Radio.Button value="progress"><BranchesOutlined /> 剧情进度</Radio.Button>
      </Radio.Group>
      {model.route.mode === 'characters' ? (
        <Radio.Group value={model.route.layout} onChange={(event) => setLayout(event.target.value)} size="small">
          <Radio.Button value="relations">关系图</Radio.Button>
          <Radio.Button value="factions">阵营分组</Radio.Button>
          <Radio.Button value="locations">地区演员</Radio.Button>
        </Radio.Group>
      ) : null}
      <span className="narrative-board__toolbar-note"><NodeIndexOutlined /> {note}</span>
    </section>
  )
}

function NarrativeBoardWorkbench({
  model,
  novelId,
  selectMap,
  enterMapNode,
  selectCharacter,
  openMapEditor,
  updateRoute,
  setMode,
}: {
  model: NarrativeBoardViewModel
  novelId: number
  selectMap: (node: WorldMapItem | null) => void
  enterMapNode: (node: WorldMapItem) => void
  selectCharacter: (characterId: number | null) => void
  openMapEditor: () => void
  updateRoute: NarrativeBoardContentProps['updateRoute']
  setMode: (mode: NarrativeBoardMode) => void
}) {
  return (
    <div className="narrative-board__workbench">
      <main className="narrative-board__canvas" aria-label={model.route.mode === 'map' ? '空间剧情地图' : model.route.mode === 'characters' ? '人物关系图谱' : '剧情进度'}>
        <NarrativeBoardCanvas model={model} selectMap={selectMap} enterMapNode={enterMapNode} selectCharacter={selectCharacter} updateRoute={updateRoute} setMode={setMode} />
      </main>
      <aside className="narrative-board__inspector" aria-label="当前对象检查器">
        <NarrativeBoardInspector model={model} novelId={novelId} selectCharacter={selectCharacter} enterMapNode={enterMapNode} openMapEditor={openMapEditor} updateRoute={updateRoute} setMode={setMode} />
      </aside>
    </div>
  )
}

function NarrativeBoardCanvas({
  model,
  selectMap,
  enterMapNode,
  selectCharacter,
  updateRoute,
  setMode,
}: {
  model: NarrativeBoardViewModel
  selectMap: (node: WorldMapItem | null) => void
  enterMapNode: (node: WorldMapItem) => void
  selectCharacter: (characterId: number | null) => void
  updateRoute: NarrativeBoardContentProps['updateRoute']
  setMode: (mode: NarrativeBoardMode) => void
}) {
  if (model.route.mode === 'map') {
    return <MapBoard nodes={model.mapCanvasNodes} selectedId={model.selectedMapId} path={model.mapPath} mapRelations={model.data.mapRelations} allMapNodes={model.flatMap} events={model.visibleEvents} characters={model.visibleCharacters} bindings={model.data.bindings} layout={model.data.mapLayout} viewport={model.data.viewport} onSelect={selectMap} onEnter={enterMapNode} onBack={() => selectMap(model.selectedMap?.parentId ? findWorldMapNode(model.stageFilteredTree, model.selectedMap.parentId) : null)} />
  }
  if (model.route.mode === 'characters') {
    return <CharacterBoard layout={model.route.layout} data={model.graphData} characters={model.visibleCharacters} flatMap={model.flatMap} events={model.visibleEvents} bindings={model.data.bindings} selectedCharacterId={model.selectedCharacter?.id || null} onSelect={selectCharacter} factionNameById={model.factionNameById} />
  }
  return <ProgressBoard scope={model.effectiveScope} events={model.visibleEvents} tasks={model.data.tasks} threads={model.data.threads} chapters={model.data.chapters} novelStats={model.data.novelStats} quality={model.data.quality} contextStatus={model.data.contextStatus} charactersById={model.charactersById} aiRateDelta={model.aiRateDelta} wordProgress={model.wordProgress} onSelectMap={(id) => { updateRoute('mapNodeId', id); setMode('map') }} onSelectCharacter={(id) => selectCharacter(id)} />
}

function NarrativeBoardInspector({
  model,
  novelId,
  selectCharacter,
  enterMapNode,
  openMapEditor,
  updateRoute,
  setMode,
}: {
  model: NarrativeBoardViewModel
  novelId: number
  selectCharacter: (characterId: number | null) => void
  enterMapNode: (node: WorldMapItem) => void
  openMapEditor: () => void
  updateRoute: NarrativeBoardContentProps['updateRoute']
  setMode: (mode: NarrativeBoardMode) => void
}) {
  if (model.route.mode === 'map') {
    const mapEvents = model.selectedMap
      ? model.visibleEvents.filter((event) => event.locationMapId && getWorldMapDescendantIds(model.selectedMap).includes(event.locationMapId))
      : []
    const mapIds = model.selectedMap ? new Set(getWorldMapDescendantIds(model.selectedMap)) : new Set<number>()
    const mapTasks = model.data.tasks.filter((task) => task.relatedEntityType === 'map' && typeof task.relatedEntityId === 'number' && mapIds.has(task.relatedEntityId))
    return <MapInspector node={model.selectedMap} people={model.selectedMapPeople} events={mapEvents} tasks={mapTasks} charactersById={model.charactersById} factionNameById={model.factionNameById} onEdit={openMapEditor} onSelectCharacter={selectCharacter} onEnter={model.selectedMap ? () => enterMapNode(model.selectedMap as WorldMapItem) : undefined} onOpenMapPage={() => { const params = new URLSearchParams(); if (model.selectedMap) params.set('nodeId', String(model.selectedMap.id)); if (model.stageId) params.set('stageId', String(model.stageId)); window.location.hash = buildWorkspaceRoute(novelId, `map${params.toString() ? `?${params.toString()}` : ''}`) }} />
  }
  if (model.route.mode === 'characters') {
    const characterEvents = model.selectedCharacter
      ? model.visibleEvents.filter((event) => eventCharacterIds(event).includes(model.selectedCharacter?.id || 0))
      : []
    return <CharacterInspector character={model.selectedCharacter} relations={model.selectedCharacterRelations} charactersById={model.charactersById} locations={model.selectedCharacterLocations} events={characterEvents} factionNameById={model.factionNameById} onSelectCharacter={selectCharacter} onLocateMap={(name) => { const node = model.flatMap.find((item) => item.name === name); if (node) { updateRoute('mapNodeId', node.id); setMode('map') } }} onOpenCharacterPage={() => { const params = new URLSearchParams({ view: 'graph' }); if (model.selectedCharacter) params.set('characterId', String(model.selectedCharacter.id)); if (model.stageId) params.set('stageId', String(model.stageId)); window.location.hash = buildWorkspaceRoute(novelId, `characters?${params.toString()}`) }} />
  }
  return <ContextInspector contextStatus={model.data.contextStatus} quality={model.data.quality} contextVersion={model.contextVersion} />
}

function NarrativeBoardFooter({ model }: { model: NarrativeBoardViewModel }) {
  const selectedMapEventCount = model.selectedMap
    ? model.visibleEvents.filter((event) => event.locationMapId && getWorldMapDescendantIds(model.selectedMap as WorldMapItem).includes(event.locationMapId)).length
    : 0
  const copy = model.selectedMap
    ? `当前地区「${model.selectedMap.name}」关联 ${model.selectedMapPeople.length} 人、${selectedMapEventCount} 个时间轴事件。`
    : model.selectedCharacter
      ? `当前人物「${model.selectedCharacter.fullName}」位于 ${model.selectedCharacterLocations.join('、') || '未绑定地区'}，关系网中有 ${model.selectedCharacterRelations.length} 条直接关系。`
      : '点击地图区域或人物节点，右侧会显示可追溯的地点、事件、关系和任务。'

  return (
    <section className="narrative-board__footer-rail" aria-label="联动信息">
      <div className="narrative-board__footer-title"><LinkOutlined /> 联动提示</div>
      <div className="narrative-board__footer-copy">{copy}</div>
      {model.data.stageContext?.health.hardBlockers.length ? <Tag color="error">阶段有 {model.data.stageContext.health.hardBlockers.length} 个阻塞</Tag> : null}
      {model.data.contextStatus?.staleAssetCount ? <Tag color="warning">{model.data.contextStatus.staleAssetCount} 个资产待同步</Tag> : null}
      {model.data.unresolvedAnchorCount > 0 ? <Tag color="warning">{model.data.unresolvedAnchorCount} 个事件锚点未解析，已从章节范围排除</Tag> : null}
      {model.latestAiRate ? <Tag color={model.latestAiRate.rate >= 35 ? 'warning' : 'success'}>AI 味 {model.latestAiRate.rate}%{model.aiRateDelta ? ` · ${model.aiRateDelta > 0 ? '+' : ''}${model.aiRateDelta}pt` : ''}</Tag> : null}
    </section>
  )
}

function MapBoard({
  nodes,
  selectedId,
  path,
  mapRelations,
  allMapNodes,
  events,
  characters,
  bindings,
  layout,
  viewport,
  onSelect,
  onEnter,
  onBack,
}: {
  nodes: WorldMapItem[]
  selectedId?: number
  path: WorldMapItem[]
  mapRelations: MapRelation[]
  allMapNodes: WorldMapItem[]
  events: TimelineEvent[]
  characters: Character[]
  bindings: CharacterLocationBinding[]
  layout: MapBoardLayoutNode[]
  viewport: MapBoardViewport | null
  onSelect: (node: WorldMapItem | null) => void
  onEnter: (node: WorldMapItem) => void
  onBack: () => void
}) {
  const nodeById = useMemo(() => new Map(allMapNodes.map((node) => [node.id, node])), [allMapNodes])
  const visibleNodeIds = useMemo(() => new Set(allMapNodes.map((node) => node.id)), [allMapNodes])
  const relationRows = useMemo(() => mapRelations
    .filter((relation) => visibleNodeIds.has(relation.mapAId) && visibleNodeIds.has(relation.mapBId))
    .filter((relation) => !selectedId || relation.mapAId === selectedId || relation.mapBId === selectedId)
    .slice(0, 8), [mapRelations, selectedId, visibleNodeIds])

  return (
    <div className="narrative-map-board">
      <div className="narrative-map-board__head">
        <div>
          <div className="narrative-board__eyebrow"><EnvironmentOutlined /> 语义地图</div>
          <div className="narrative-map-board__path" aria-label="地图路径">
            {path.length > 0 ? path.map((item, index) => (
              <React.Fragment key={item.id}>
                {index > 0 ? <span>/</span> : null}
                <button type="button" onClick={() => onSelect(item)}>{item.name}</button>
              </React.Fragment>
            )) : <span>世界总览</span>}
          </div>
        </div>
        {selectedId ? <Button size="small" icon={<ArrowLeftOutlined />} onClick={onBack}>返回上层</Button> : null}
      </div>
      <div className="narrative-map-board__legend">
        <span><i className="narrative-map-board__legend-dot narrative-map-board__legend-dot--region" />区域</span>
        <span><i className="narrative-map-board__legend-dot narrative-map-board__legend-dot--event" />事件</span>
        <span><i className="narrative-map-board__legend-dot narrative-map-board__legend-dot--people" />人物聚合</span>
        <span className="narrative-map-board__legend-note">自动语义布局 · 点击查看检查器 · 双击进入区域</span>
      </div>
      <NarrativeMapCanvas
        key={`${viewport?.layoutKey || 'default'}:${viewport?.updatedAt || ''}:${allMapNodes.map((item) => item.id).join(',')}`}
        nodes={nodes}
        allNodes={allMapNodes}
        mapRelations={mapRelations}
        layout={layout}
        viewport={viewport}
        events={events}
        characters={characters}
        bindings={bindings}
        selectedId={selectedId}
        onSelect={onSelect}
        onEnter={onEnter}
      />
      {nodes.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有可展示的地点" />
      ) : (
        <div className="narrative-map-board__canvas" role="list" aria-label="地点区域">
          {nodes.map((node, index) => {
            const descendantIds = new Set(getWorldMapDescendantIds(node))
            const nodeEvents = events.filter((event) => event.locationMapId && descendantIds.has(event.locationMapId))
            const nodePeople = getMapNodePeople(node, characters, events, bindings)
            const relationCount = mapRelations.filter((relation) => visibleNodeIds.has(relation.mapAId) && visibleNodeIds.has(relation.mapBId) && (descendantIds.has(relation.mapAId) || descendantIds.has(relation.mapBId))).length
            const tone = index % 4
            return (
              <button
                key={node.id}
                type="button"
                role="listitem"
                className={`narrative-map-region narrative-map-region--tone-${tone}${selectedId === node.id ? ' is-selected' : ''}`}
                onClick={() => onSelect(node)}
                onDoubleClick={() => onEnter(node)}
                aria-label={`${node.name}，${node.children?.length || 0} 个下级地点`}
              >
                <span className="narrative-map-region__contour" aria-hidden="true" />
                <span className="narrative-map-region__header">
                  <span className="narrative-map-region__level">{node.locationType || node.nodeType || `L${node.level}`}</span>
                  {node.dangerLevel ? <span className="narrative-map-region__danger">{node.dangerLevel}</span> : null}
                </span>
                <strong>{node.name}</strong>
                <span className="narrative-map-region__summary">{truncate(node.plotRelevance || node.description || '尚未补充区域剧情作用。', 88)}</span>
                <span className="narrative-map-region__stats">
                  <span><ApartmentOutlined /> {node.children?.length || 0} 下级</span>
                  <span><TeamOutlined /> {nodePeople.length} 人</span>
                  <span><FieldTimeOutlined /> {nodeEvents.length} 事</span>
                  <span><BranchesOutlined /> {relationCount} 线</span>
                </span>
                {node.children?.length ? (
                  <span className="narrative-map-region__children">
                    {node.children.slice(0, 4).map((child) => <span key={child.id}>{child.name}</span>)}
                    {node.children.length > 4 ? <span>+{node.children.length - 4}</span> : null}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
      <div className="narrative-map-board__routes">
        <div className="narrative-map-board__routes-head"><span><BranchesOutlined /> 当前范围的路线与边界</span><small>{relationRows.length} 条显示</small></div>
        {relationRows.length === 0 ? <span className="narrative-board__muted">还没有地点关系，或当前区域没有直接连接。</span> : relationRows.map((relation) => (
          <div key={relation.id} className="narrative-map-route">
            <span>{nodeById.get(relation.mapAId)?.name || `地点#${relation.mapAId}`}</span>
            <ArrowRightOutlined />
            <span>{nodeById.get(relation.mapBId)?.name || `地点#${relation.mapBId}`}</span>
            <Tag>{relation.relationLabel || relation.relationType || '关系'}</Tag>
            {relation.travelHours ? <small>{relation.travelHours}h{relation.travelMode ? ` · ${relation.travelMode}` : ''}</small> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function CharacterBoard({
  layout,
  data,
  characters,
  flatMap,
  events,
  bindings,
  selectedCharacterId,
  onSelect,
  factionNameById,
}: {
  layout: CharacterBoardLayout
  data: CharacterGraphPayload
  characters: Character[]
  flatMap: WorldMapItem[]
  events: TimelineEvent[]
  bindings: CharacterLocationBinding[]
  selectedCharacterId: number | null
  onSelect: (characterId: number | null) => void
  factionNameById: Map<number, string>
}) {
  const groups = useMemo(() => {
    if (layout === 'factions') {
      const map = new Map<string, Character[]>()
      characters.forEach((character) => {
        const tokens = parseNameOrIds(character.campFactionIdsJson)
        const names = tokens.map((token) => typeof token === 'number' ? factionNameById.get(token) : token).filter((item): item is string => Boolean(item))
        const keys = names.length > 0 ? names : ['未站队']
        keys.forEach((name) => map.set(name, [...(map.get(name) || []), character]))
      })
      return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'))
    }
    const map = new Map<string, Character[]>()
    characters.forEach((character) => {
      const names = getCharacterLocationNames(character, flatMap, events, bindings)
      const keys = names.length > 0 ? names : ['未绑定地区']
      keys.forEach((name) => map.set(name, [...(map.get(name) || []), character]))
    })
    return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'))
  }, [bindings, characters, events, factionNameById, flatMap, layout])

  if (layout === 'relations') {
    return (
      <div className="narrative-character-board">
        <div className="narrative-character-board__head">
          <div><div className="narrative-board__eyebrow"><NodeIndexOutlined /> 人物网络</div><h2>谁在推动当前范围</h2></div>
          <span className="narrative-board__count">显示 {data.characters.length} / {characters.length} 人 · {data.relations.length} 条关系</span>
        </div>
        {data.characters.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有可展示的人物" /> : <div className="narrative-character-board__graph"><CharacterGraphCanvas data={data} selectedCharacterId={selectedCharacterId} onCharacterSelect={(id) => onSelect(id)} /></div>}
      </div>
    )
  }

  return (
    <div className="narrative-character-board">
      <div className="narrative-character-board__head">
        <div><div className="narrative-board__eyebrow"><UnorderedListOutlined /> {layout === 'factions' ? '阵营演员表' : '地区演员表'}</div><h2>{layout === 'factions' ? '按势力看谁站在一起' : '按地点看谁正在场'}</h2></div>
        <span className="narrative-board__count">显示 {characters.length} 人</span>
      </div>
      {groups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有可展示的人物" /> : <div className="narrative-character-groups">
        {groups.map(([groupName, groupCharacters]) => (
          <section key={groupName} className="narrative-character-group">
            <div className="narrative-character-group__head"><strong>{groupName}</strong><span>{groupCharacters.length} 人</span></div>
            <div className="narrative-character-group__grid">
              {groupCharacters.map((character) => <button key={character.id} type="button" className={`narrative-character-card${selectedCharacterId === character.id ? ' is-selected' : ''}`} onClick={() => onSelect(character.id)}>
                <CharacterAvatar character={character} />
                <span className="narrative-character-card__copy"><strong>{character.fullName}</strong><small>{ROLE_LABELS[character.roleType]} · {truncate(character.occupation || character.socialIdentity || '身份待补', 28)}</small></span>
              </button>)}
            </div>
          </section>
        ))}
      </div>}
    </div>
  )
}

function CharacterAvatar({ character, size = 'medium' }: { character: Character; size?: 'small' | 'medium' }) {
  return <span className={`narrative-character-avatar narrative-character-avatar--${size}`} style={{ '--avatar-accent': ROLE_COLORS[character.roleType] } as React.CSSProperties}>{initials(character.fullName)}</span>
}

function ProgressBoard({
  scope,
  events,
  tasks,
  threads,
  chapters,
  novelStats,
  quality,
  contextStatus,
  charactersById,
  aiRateDelta,
  wordProgress,
  onSelectMap,
  onSelectCharacter,
}: {
  scope: NarrativeScope
  events: TimelineEvent[]
  tasks: Task[]
  threads: StoryThread[]
  chapters: Chapter[]
  novelStats: NovelStats
  quality: QualityDashboardData | null
  contextStatus: ContextStatus | null
  charactersById: Map<number, Character>
  aiRateDelta: number
  wordProgress: number
  onSelectMap: (id: number) => void
  onSelectCharacter: (id: number) => void
}) {
  const recentEvents = events.slice().sort((left, right) => right.timeSortValue - left.timeSortValue).slice(0, 10)
  const recentTasks = tasks.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8)
  const latestAiRate = quality?.aiLikeRateTrend?.[quality.aiLikeRateTrend.length - 1]?.rate
  const aiAdvice = getAiAdvice(latestAiRate)

  return (
    <div className="narrative-progress-board">
      <div className="narrative-progress-board__hero">
        <div><div className="narrative-board__eyebrow"><BranchesOutlined /> 故事推进</div><h2>当前范围的生产脉搏</h2><p>{formatChapterRange(scope)} · 事件、任务和质量信号来自同一项目上下文。</p></div>
        <div className="narrative-progress-board__score"><strong>{wordProgress}%</strong><span>目标字数完成度</span></div>
      </div>
      <div className="narrative-progress-board__metrics">
        <ProgressMetric label="章节" value={`${novelStats.completedChapters}/${novelStats.totalChapters}`} note="已完成 / 总章节" />
        <ProgressMetric label="正文" value={`${novelStats.totalWords.toLocaleString()} 字`} note="当前正文累计" />
        <ProgressMetric label="AI 味" value={latestAiRate === undefined ? '暂无' : `${latestAiRate}%`} note={aiRateDelta ? `${aiRateDelta > 0 ? '+' : ''}${aiRateDelta}pt 较上一章` : '独立质量趋势'} tone={latestAiRate !== undefined && latestAiRate >= 35 ? 'warn' : 'normal'} />
        <ProgressMetric label="上下文" value={`v${contextStatus?.contextVersion || 1}`} note={contextStatus?.staleChapterCount ? `${contextStatus.staleChapterCount} 章待同步` : '当前版本一致'} tone={contextStatus?.staleChapterCount || contextStatus?.staleAssetCount ? 'warn' : 'normal'} />
      </div>
      <div className="narrative-progress-board__columns">
        <ProgressEventPanel events={recentEvents} charactersById={charactersById} onSelectMap={onSelectMap} onSelectCharacter={onSelectCharacter} />
        <ProgressTaskPanel tasks={recentTasks} />
      </div>
      <div className="narrative-progress-board__columns">
        <ProgressAiPanel rate={latestAiRate} advice={aiAdvice} />
        <ProgressThreadPanel threads={threads} />
      </div>
      {chapters.length === 0 ? <Alert type="info" showIcon message="还没有章节数据" description="当正文和章节产生后，这里会自动串起事件、任务、上下文和质量趋势。" /> : null}
    </div>
  )
}

function ProgressMetric({ label, value, note, tone = 'normal' }: { label: string; value: string; note: string; tone?: 'normal' | 'warn' }) {
  return <div className={`narrative-progress-metric narrative-progress-metric--${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function getAiAdvice(rate?: number): string {
  if (rate === undefined) return '暂无独立 AI 味评测，先完成章节质检再判断。'
  if (rate >= 35) return '风险偏高：减少模板化动作和总结句，优先改最近高风险章节。'
  if (rate >= 20) return '中等风险：保留人物办事动作与具体代价，避免连续面板式结算。'
  return '当前风险较低：继续用事件证据和人物选择承接上下文。'
}

function getAiSignalLabel(rate?: number): string {
  if (rate === undefined) return '尚无观测值'
  if (rate >= 35) return '需要优先处理'
  if (rate >= 20) return '保持警惕'
  return '目前稳定'
}

function ProgressEventPanel({ events, charactersById, onSelectMap, onSelectCharacter }: { events: TimelineEvent[]; charactersById: Map<number, Character>; onSelectMap: (id: number) => void; onSelectCharacter: (id: number) => void }) {
  return <WorkspacePanel title="最近发生了什么" extra={<span className="narrative-board__count">{events.length} 条</span>}>
    {events.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无时间轴事件" /> : <div className="narrative-event-list">
      {events.map((event) => <button key={event.id} type="button" className="narrative-event-row" onClick={() => selectTimelineTarget(event, onSelectMap, onSelectCharacter)}>
        <span className={`narrative-event-row__dot${event.isMajorEvent ? ' is-major' : ''}`} />
        <span className="narrative-event-row__time">{event.timeLabel}</span>
        <span className="narrative-event-row__body"><strong>{event.eventTitle}</strong><small>{truncate(event.eventSummary || event.eventResult || '尚未补充事件结果。', 100)}{eventParticipantNames(event, charactersById).length > 0 ? ` · 参与：${eventParticipantNames(event, charactersById).join('、')}` : ''}</small></span>
        {event.locationMapId ? <EnvironmentOutlined /> : null}
      </button>)}
    </div>}
  </WorkspacePanel>
}

function selectTimelineTarget(event: TimelineEvent, onSelectMap: (id: number) => void, onSelectCharacter: (id: number) => void) {
  if (event.locationMapId) {
    onSelectMap(event.locationMapId)
    return
  }
  const characterId = eventCharacterIds(event)[0]
  if (characterId) onSelectCharacter(characterId)
}

function ProgressTaskPanel({ tasks }: { tasks: Task[] }) {
  return <WorkspacePanel title="后台任务" extra={<span className="narrative-board__count">{tasks.length} 条</span>}>
    {tasks.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务记录" /> : <div className="narrative-task-list">
      {tasks.map((task) => <ProgressTaskRow key={task.id} task={task} />)}
    </div>}
  </WorkspacePanel>
}

function ProgressTaskRow({ task }: { task: Task }) {
  const progress = getTaskProgress(task)
  return <div className="narrative-task-row"><span className={`narrative-task-row__status narrative-task-row__status--${task.status}`} /><span className="narrative-task-row__body"><strong>{TASK_LABELS[task.type] || task.type}</strong><small>{statusLabel(task.status)} · {task.relatedEntityType || '项目级任务'}</small></span>{progress !== undefined ? <Progress percent={progress} size="small" showInfo={false} /> : null}</div>
}

function ProgressAiPanel({ rate, advice }: { rate?: number; advice: string }) {
  return <WorkspacePanel title="AI 味如何降低" extra={<RobotOutlined />}>
    <div className="narrative-ai-advice"><div className={`narrative-ai-advice__signal${rate !== undefined && rate >= 35 ? ' is-warn' : ''}`}><RobotOutlined /><strong>{getAiSignalLabel(rate)}</strong></div><p>{advice}</p><ul><li>让人物用证据、证件、伤口和选择推进情节，不用抽象形容词代替行动。</li><li>把能力结果落到具体感官与代价，减少连续「获得 / 击杀 / 警告」面板。</li><li>每次修订后回看趋势，不把一次启发式分数当成人类作者概率。</li></ul></div>
  </WorkspacePanel>
}

function ProgressThreadPanel({ threads }: { threads: StoryThread[] }) {
  return <WorkspacePanel title="线程状态" extra={<span className="narrative-board__count">{threads.length} 条</span>}>
    {threads.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无剧情线程" /> : <div className="narrative-thread-list">{threads.slice(0, 8).map((thread) => <div key={thread.id} className="narrative-thread-row"><span className={`narrative-thread-row__priority narrative-thread-row__priority--${thread.priority}`} /><span><strong>{thread.title}</strong><small>{statusLabel(thread.status)} · {thread.currentState || thread.summary || '尚未补充当前状态'}</small></span></div>)}</div>}
  </WorkspacePanel>
}

function MapInspector({
  node,
  people,
  events,
  tasks,
  charactersById,
  factionNameById,
  onEdit,
  onSelectCharacter,
  onEnter,
  onOpenMapPage,
}: {
  node: WorldMapItem | null
  people: Character[]
  events: TimelineEvent[]
  tasks: Task[]
  charactersById: Map<number, Character>
  factionNameById: Map<number, string>
  onEdit: () => void
  onSelectCharacter: (characterId: number | null) => void
  onEnter?: () => void
  onOpenMapPage: () => void
}) {
  if (!node) {
    return (
      <div className="narrative-inspector narrative-inspector--empty">
        <div className="narrative-inspector__empty-mark"><CompassOutlined /></div>
        <h2>选择一个地区</h2>
        <p>地图卡片会把地点、在场人物、时间轴事件和待办任务串在一起。双击区域可以继续向下钻取。</p>
        <Button type="link" icon={<LinkOutlined />} onClick={onOpenMapPage}>打开地点结构页</Button>
      </div>
    )
  }

  const factionNames = parseNameOrIds(node.affiliatedFactionIdsJson)
    .map((token) => typeof token === 'number' ? factionNameById.get(token) : token)
    .filter((name): name is string => Boolean(name))

  return (
    <div className="narrative-inspector">
      <div className="narrative-inspector__head">
        <div>
          <div className="narrative-board__eyebrow"><EnvironmentOutlined /> 地区检查器</div>
          <h2>{node.name}</h2>
          <span className="narrative-inspector__subline">{node.locationType || node.nodeType || `层级 L${node.level}`}{node.dangerLevel ? ` · 危险 ${node.dangerLevel}` : ''}</span>
        </div>
        <span className="narrative-inspector__level">L{node.level}</span>
      </div>
      <div className="narrative-inspector__actions">
        <Button size="small" icon={<SaveOutlined />} onClick={onEdit}>编辑地区</Button>
        {onEnter ? <Button size="small" type="primary" icon={<ArrowRightOutlined />} onClick={onEnter}>进入区域</Button> : null}
        <Button size="small" type="text" icon={<LinkOutlined />} onClick={onOpenMapPage}>完整地点页</Button>
      </div>
      <div className="narrative-inspector__summary">{node.description || '这个地区还没有简介。先补充它的边界、氛围和剧情作用，后续生成才能稳定引用。'}</div>
      <div className="narrative-inspector__facts">
        <InfoRow label="剧情作用" value={node.plotRelevance || '未补充'} />
        <InfoRow label="氛围" value={node.atmosphere || '未补充'} />
        <InfoRow label="下级地点" value={`${node.children?.length || 0} 个`} />
        {factionNames.length > 0 ? <InfoRow label="关联势力" value={factionNames.join('、')} /> : null}
      </div>
      <InspectorSection title={`在场人物 · ${people.length}`} icon={<TeamOutlined />}>
        {people.length === 0 ? <InspectorEmpty text="当前范围没有可追溯的人物。" /> : <div className="narrative-inspector__people">
          {people.slice(0, 12).map((person) => (
            <button key={person.id} type="button" className="narrative-inspector__person" onClick={() => onSelectCharacter(person.id)}>
              <CharacterAvatar character={person} size="small" />
              <span><strong>{person.fullName}</strong><small>{ROLE_LABELS[person.roleType]} · {person.occupation || person.socialIdentity || '身份待补'}</small></span>
              <ArrowRightOutlined />
            </button>
          ))}
          {people.length > 12 ? <span className="narrative-board__muted">还有 {people.length - 12} 人，切换人物关系视图查看。</span> : null}
        </div>}
      </InspectorSection>
      <InspectorSection title={`时间轴 · ${events.length}`} icon={<FieldTimeOutlined />}>
        {events.length === 0 ? <InspectorEmpty text="当前范围没有落在此地的事件。" /> : <div className="narrative-inspector__event-list">
          {events.slice().sort((left, right) => right.timeSortValue - left.timeSortValue).slice(0, 8).map((event) => (
            <div key={event.id} className="narrative-inspector__event">
              <span>{event.timeLabel}</span>
              <strong>{event.eventTitle}</strong>
              <small>{truncate(event.eventSummary || event.eventResult || '尚未补充事件结果。', 120)}{eventParticipantNames(event, charactersById).length > 0 ? ` · 参与：${eventParticipantNames(event, charactersById).join('、')}` : ''}</small>
            </div>
          ))}
        </div>}
      </InspectorSection>
      <InspectorSection title={`关联任务 · ${tasks.length}`} icon={<UnorderedListOutlined />}>
        {tasks.length === 0 ? <InspectorEmpty text="没有绑定到该地区的后台任务。" /> : <div className="narrative-inspector__task-list">
          {tasks.slice(0, 6).map((task) => <div key={task.id} className="narrative-inspector__task"><span className={`narrative-task-row__status narrative-task-row__status--${task.status}`} /><span><strong>{TASK_LABELS[task.type] || task.type}</strong><small>{statusLabel(task.status)}{task.errorMessage ? ` · ${truncate(task.errorMessage, 64)}` : ''}</small></span></div>)}
        </div>}
      </InspectorSection>
    </div>
  )
}

function CharacterInspector({
  character,
  relations,
  charactersById,
  locations,
  events,
  factionNameById,
  onSelectCharacter,
  onLocateMap,
  onOpenCharacterPage,
}: {
  character: Character | null
  relations: CharacterRelation[]
  charactersById: Map<number, Character>
  locations: string[]
  events: TimelineEvent[]
  factionNameById: Map<number, string>
  onSelectCharacter: (characterId: number | null) => void
  onLocateMap: (name: string) => void
  onOpenCharacterPage: () => void
}) {
  if (!character) {
    return (
      <div className="narrative-inspector narrative-inspector--empty">
        <div className="narrative-inspector__empty-mark"><TeamOutlined /></div>
        <h2>选择一个人物</h2>
        <p>关系图会突出人物的一跳关系；阵营和地区演员表则帮助你快速定位当前场景的参与者。</p>
        <Button type="link" icon={<LinkOutlined />} onClick={onOpenCharacterPage}>打开人物档案页</Button>
      </div>
    )
  }

  const factionNames = parseNameOrIds(character.campFactionIdsJson)
    .map((token) => typeof token === 'number' ? factionNameById.get(token) : token)
    .filter((name): name is string => Boolean(name))
  const primaryRelation = relations.slice().sort((left, right) => (
    (right.intimacyLevel || 0) + (right.tensionLevel || 0) - ((left.intimacyLevel || 0) + (left.tensionLevel || 0))
  ))

  return (
    <div className="narrative-inspector">
      <div className="narrative-character-inspector__identity">
        <CharacterAvatar character={character} />
        <div><div className="narrative-board__eyebrow">{ROLE_LABELS[character.roleType]}</div><h2>{character.fullName}</h2><span>{character.occupation || character.socialIdentity || '身份待补'} · {character.recordStatus === 'draft' ? '草稿' : '正式'}</span></div>
      </div>
      <div className="narrative-inspector__actions">
        <Button size="small" icon={<LinkOutlined />} onClick={onOpenCharacterPage}>关系与 AI 生成</Button>
        {locations[0] ? <Button size="small" type="primary" icon={<EnvironmentOutlined />} onClick={() => onLocateMap(locations[0])}>定位首个地区</Button> : null}
      </div>
      <div className="narrative-inspector__summary">{character.innerConflict || character.goals || character.relationshipTension || character.background || '还没有人物驱动力摘要。补充欲望、恐惧和关系张力后，AI 才能在新关系生成时复用。'}</div>
      <div className="narrative-inspector__facts">
        <InfoRow label="剧情目标" value={character.goals || '未补充'} />
        <InfoRow label="活动地区" value={locations.length > 0 ? locations.join('、') : '未绑定地区'} />
        {factionNames.length > 0 ? <InfoRow label="所属势力" value={factionNames.join('、')} /> : null}
      </div>
      <InspectorSection title={`直接关系 · ${relations.length}`} icon={<NodeIndexOutlined />}>
        {relations.length === 0 ? <InspectorEmpty text="当前范围没有直接关系记录。" /> : <div className="narrative-inspector__relation-list">
          {primaryRelation.slice(0, 12).map((relation) => {
            const counterpartId = relation.charAId === character.id ? relation.charBId : relation.charAId
            const counterpart = charactersById.get(counterpartId)
            return <button key={relation.id} type="button" title={relationTitle(relation, charactersById)} className="narrative-inspector__relation" onClick={() => onSelectCharacter(counterpartId)}>
              <span className="narrative-inspector__relation-main"><strong>{counterpart?.fullName || `人物#${counterpartId}`}</strong><small>{RELATION_LABELS[relation.relationType || ''] || relation.relationLabel || '关系待补'} · {truncate(relation.description || relation.interactionStyle || '关系细节待补', 68)}</small></span>
              <span className="narrative-inspector__relation-score">{relation.tensionLevel ? `张力 ${relation.tensionLevel}/5` : relation.intimacyLevel ? `亲密 ${relation.intimacyLevel}/5` : '查看'} <ArrowRightOutlined /></span>
            </button>
          })}
        </div>}
      </InspectorSection>
      <InspectorSection title={`相关事件 · ${events.length}`} icon={<FieldTimeOutlined />}>
        {events.length === 0 ? <InspectorEmpty text="当前范围没有提及此人物的事件。" /> : <div className="narrative-inspector__event-list">
          {events.slice().sort((left, right) => right.timeSortValue - left.timeSortValue).slice(0, 8).map((event) => <div key={event.id} className="narrative-inspector__event"><span>{event.timeLabel}</span><strong>{event.eventTitle}</strong><small>{truncate(event.eventSummary || event.eventResult || '尚未补充事件结果。', 120)}</small></div>)}
        </div>}
      </InspectorSection>
    </div>
  )
}

function ContextInspector({ contextStatus, quality, contextVersion }: { contextStatus: ContextStatus | null; quality: QualityDashboardData | null; contextVersion: number }) {
  const latestRate = quality?.aiLikeRateTrend?.[quality.aiLikeRateTrend.length - 1]
  const topRules = quality?.antiAiRecurrence?.topRepeatedRules?.slice(0, 4) || []
  const driftAlerts = quality?.recentLanguageDriftAlerts?.slice(0, 3) || []
  const staleCount = (contextStatus?.staleChapterCount || 0) + (contextStatus?.staleAssetCount || 0) + (contextStatus?.staleCheckpointCount || 0)

  return (
    <div className="narrative-inspector">
      <ContextInspectorHeader staleCount={staleCount} contextVersion={contextVersion} />
      <ContextSyncSection contextStatus={contextStatus} quality={quality} />
      <ContextAiSection latestRate={latestRate} topRules={topRules} driftAlerts={driftAlerts} />
      <ContextNotes notes={quality?.dashboardNotes || []} />
    </div>
  )
}

function ContextInspectorHeader({ staleCount, contextVersion }: { staleCount: number; contextVersion: number }) {
  const healthLabel = staleCount > 0 ? '需同步' : '已对齐'
  return <>
    <div className="narrative-inspector__head"><div><div className="narrative-board__eyebrow"><LinkOutlined /> 上下文检查器</div><h2>让下一次生成有依据</h2></div><span className={`narrative-inspector__health${staleCount > 0 ? ' is-warn' : ''}`}>{healthLabel}</span></div>
    <div className="narrative-context-card"><span>当前上下文版本</span><strong>v{contextVersion}</strong><small>{staleCount > 0 ? `发现 ${staleCount} 项待同步信号` : '章节、资产和检查点没有明显落后项'}</small></div>
  </>
}

function ContextSyncSection({ contextStatus, quality }: { contextStatus: ContextStatus | null; quality: QualityDashboardData | null }) {
  const latestScore = quality?.overallScoreTrend?.at(-1)?.score
  return <InspectorSection title="同步信号" icon={<ReloadOutlined />}>
    <div className="narrative-inspector__facts narrative-inspector__facts--grid">
      <InfoRow label="待同步章节" value={`${contextStatus?.staleChapterCount || 0}`} />
      <InfoRow label="待同步资产" value={`${contextStatus?.staleAssetCount || 0}`} />
      <InfoRow label="检查点缺口" value={`${contextStatus?.staleCheckpointCount || 0}`} />
      <InfoRow label="最近质量" value={latestScore === undefined ? '暂无' : `${latestScore} 分`} />
    </div>
    {contextStatus?.staleAssetLabels?.length ? <div className="narrative-inspector__chips">{contextStatus.staleAssetLabels.slice(0, 8).map((label) => <Tag key={label} color="warning">{label}</Tag>)}</div> : null}
  </InspectorSection>
}

function ContextAiSection({ latestRate, topRules, driftAlerts }: { latestRate?: AiRatePoint; topRules: QualityDashboardData['antiAiRecurrence']['topRepeatedRules']; driftAlerts: QualityDashboardData['recentLanguageDriftAlerts'] }) {
  const driftStatus = (status: 'worsening' | 'stable' | 'improving') => status === 'worsening' ? '正在恶化' : status === 'improving' ? '正在改善' : '保持稳定'
  return <InspectorSection title="AI 味信号" icon={<RobotOutlined />}>
    <div className={`narrative-context-rate${latestRate && latestRate.rate >= 35 ? ' is-warn' : ''}`}><strong>{latestRate ? `${latestRate.rate}%` : '暂无'}</strong><span>{latestRate ? `最近第 ${latestRate.chapterNum} 章 · 分数越高越像模板` : '完成章节质检后显示趋势'}</span></div>
    <p className="narrative-board__muted">这是启发式风格风险指标，不是“人类作者概率”。降低它要回到具体人物行动、感官证据和可验证代价。</p>
    {topRules.length > 0 ? <div className="narrative-inspector__rule-list">{topRules.map((rule) => <div key={rule.ruleCode}><strong>{rule.ruleTitle}</strong><span>{rule.hitCount} 次 · 最近第 {rule.lastChapterNum} 章</span></div>)}</div> : null}
    {driftAlerts.length > 0 ? <div className="narrative-inspector__alert-list">{driftAlerts.map((alert) => <div key={alert.metric}><Tag color="warning">语言漂移</Tag><span>{alert.label} · {driftStatus(alert.status)}（{alert.latestValue}）</span></div>)}</div> : null}
  </InspectorSection>
}

function ContextNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return <InspectorSection title="质检备注" icon={<EyeOutlined />}><ul className="narrative-inspector__notes">{notes.slice(0, 6).map((note) => <li key={note}>{note}</li>)}</ul></InspectorSection>
}

function InspectorSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="narrative-inspector__section"><div className="narrative-inspector__section-head"><span>{icon} {title}</span></div>{children}</section>
}

function InspectorEmpty({ text }: { text: string }) {
  return <span className="narrative-board__muted narrative-inspector__empty-copy">{text}</span>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="narrative-inspector__fact"><dt>{label}</dt><dd>{value}</dd></div>
}
