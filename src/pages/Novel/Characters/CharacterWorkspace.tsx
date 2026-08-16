import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Pagination, Progress, Select, Space, Spin, Tag, message } from 'antd'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import type { CharacterNeedsAnalysisResult } from '../../../shared/character-cast-planning'
import type { CharacterDraftReviewContent } from '../../../shared/character-draft-workflow'
import type { AgentToolCallRequest, AgentToolCallResult } from '../../../shared/tool-contracts'
import AIGenerateButton from '../../../components/AIGenerateButton'
import CreativeStageScope from '../../../components/novel/CreativeStageScope'
import DramaticEnginePanel from '../../../components/novel/characters/DramaticEnginePanel'
import {
  formatCharacterBatchProgress,
  parseCharacterBatchProgress,
  type CharacterBatchProgress,
} from '../../../components/novel/characters/character-batch-progress'
import { onTaskBridgeEvent } from '../../../services/task-events'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type {
  Character,
  CharacterBatchGenerationOptions,
  CharacterRelation,
  CharacterDetailContext,
  CharacterFilterOptions,
  CharacterGenerationOptions,
  CharacterGraphPayload,
  CreativeStageContext,
  CharacterQueryInput,
  CharacterStats,
  PagedResult,
  StoryItem,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { getCharacterBatchPreset } from '../../../shared/creation-tools'
import { getFactionNameOptions, getPowerSystemNameOptions, getSpeciesNameOptions, parseWorldRulesJson } from '../../../shared/genre-system'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { CHARACTER_RELATION_PRESETS, getCharacterRelationLabel, normalizeCharacterRelationLevel } from '../../../shared/character-relations'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel, WorkspaceTip } from '../components/WorkspaceShell'
import AiPatchEditor from '../components/AiPatchEditor'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { getWorkflowBlockers, loadWorkflowStats } from '../workflow'
import '../components/boards.css'
import './character-workspace.css'
import CharacterGraphCanvas from './CharacterGraphCanvas'

interface Props { novelId: number }

interface CharacterFormValues {
  roleType: Character['roleType']
  entityType?: string
  species?: string
  fullName: string
  gender?: string
  age?: number
  occupation?: string
  rankLevel?: string
  socialIdentity?: string
  background?: string
  campFactions: string[]
  powerSystems: string[]
  contextHooks: string[]
  goals?: string
  firstImpression?: string
  innerConflict?: string
  relationshipTension?: string
  resonancePoint?: string
  characterArc?: string
  appearance?: string
  ownedItemIds: number[]
  linkedItemIds: number[]
}

interface CharacterBatchFormValues extends CharacterBatchGenerationOptions {}

interface ProtagonistFormValues extends CharacterGenerationOptions {
  itemPreferenceText?: string[]
  forbiddenNameText?: string[]
}

interface RelationFormValues {
  charBId: number
  relationType: string
  relationLabel?: string
  bilateral?: boolean
  description?: string
  intimacyLevel?: number
  tensionLevel?: number
  interactionStyle?: string
  subtextRule?: string
}

interface CharacterWorkflowArtifactRef {
  id: string
  kind: string
  status: string
  contentHash: string
  contextVersion: number
  reviewArtifactId: string | null
}

interface CharacterWorkflowDraftResult {
  draftArtifact: CharacterWorkflowArtifactRef
  reviewArtifact: CharacterWorkflowArtifactRef
  taskId: number
  characterCount: number
  characterNames: string[]
  updatePreview: Array<{
    characterId: number
    characterName: string
    summary: string
    fields: string[]
  }>
  diffSummary: {
    createCount: number
    updateSuggestionCount: number
    mergeSuggestionCount: number
    archiveSuggestionCount: number
  }
  review: CharacterDraftReviewContent
  idempotentReplay: boolean
}

interface CharacterWorkflowCommitResult {
  createdCharacterIds: number[]
  createdCharacterNames: string[]
  updatedCharacterIds: number[]
  updatedCharacterNames: string[]
  archivedCharacterIds: number[]
  archivedCharacterNames: string[]
  mergedCharacterIds: number[]
  contextVersionBefore: number
  contextVersionAfter: number
  idempotentReplay: boolean
  warnings: string[]
}

function unwrapAgentToolResult<T>(result: AgentToolCallResult): T {
  if (result.ok) return result.data as T
  const error = new Error(result.error.message) as Error & { code?: string; detail?: string }
  error.code = result.error.code
  error.detail = result.error.detail
  throw error
}

function createWorkflowKey(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `ui-${prefix}-${suffix}`
}

const PAGE_SIZE = 24
const EMPTY_PAGE: PagedResult<Character> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: CharacterStats = { total: 0, confirmedCount: 0, draftCount: 0, protagonistCount: 0, majorCount: 0, antagonistCount: 0, relationCount: 0, speciesCount: 0 }
const EMPTY_FILTERS: CharacterFilterOptions = { species: [], entityTypes: [] }
const EMPTY_DETAIL: CharacterDetailContext = { relatedItems: [], relatedCharacters: [], relatedRelations: [] }
const EMPTY_GRAPH: CharacterGraphPayload = { characters: [], relations: [] }

const ROLE_META: Record<Character['roleType'], { label: string; color: string }> = {
  protagonist: { label: '主角', color: 'gold' },
  major: { label: '主要人物', color: 'blue' },
  antagonist: { label: '对立角色', color: 'red' },
  supporting: { label: '功能角色', color: 'green' },
  minor: { label: '次要人物', color: 'default' },
}

const ROLE_OPTIONS = [
  { value: 'protagonist', label: '主角' },
  { value: 'major', label: '主要人物' },
  { value: 'antagonist', label: '对立角色' },
  { value: 'supporting', label: '功能角色' },
  { value: 'minor', label: '次要人物' },
] as const

const RELATION_OPTIONS = [
  { value: 'all', label: '全部关系' },
  ...CHARACTER_RELATION_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
]

const ENTITY_TYPE_OPTIONS = [
  { value: 'human', label: '人类' },
  { value: 'undead', label: '亡灵 / 不死者' },
  { value: 'beast', label: '兽类 / 灵兽' },
  { value: 'immortal', label: '仙神 / 超凡存在' },
  { value: 'nonhuman', label: '非人智慧体' },
]

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((item) => typeof item === 'number' ? item : Number(item)).filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function parseAppearance(raw?: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.description === 'string' ? parsed.description : ''
  } catch {
    return ''
  }
}

function parseSourceContexts(raw?: string | null) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is { page?: string; label?: string; detectedAt?: string } => Boolean(item) && typeof item === 'object')
      : []
  } catch {
    return []
  }
}

function mergeById<T extends { id: number }>(base: T[], extras: Array<T | null | undefined>) {
  const map = new Map(base.map((item) => [item.id, item]))
  extras.forEach((item) => { if (item) map.set(item.id, item) })
  return [...map.values()]
}

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function buildFormValues(character: Character, detailContext: CharacterDetailContext): CharacterFormValues {
  return {
    roleType: character.roleType,
    entityType: character.entityType || '',
    species: character.species || '',
    fullName: character.fullName,
    gender: character.gender || '',
    age: character.age,
    occupation: character.occupation || '',
    rankLevel: character.rankLevel || '',
    socialIdentity: character.socialIdentity || '',
    background: character.background || '',
    campFactions: parseStringArray(character.campFactionIdsJson),
    powerSystems: parseStringArray(character.powerSystemRefsJson),
    contextHooks: parseStringArray(character.contextHooksJson),
    goals: character.goals || '',
    firstImpression: character.firstImpression || '',
    innerConflict: character.innerConflict || '',
    relationshipTension: character.relationshipTension || '',
    resonancePoint: character.resonancePoint || '',
    characterArc: character.characterArc || '',
    appearance: parseAppearance(character.appearanceJson),
    ownedItemIds: detailContext.relatedItems.filter((item) => item.ownerCharacterId === character.id).map((item) => item.id),
    linkedItemIds: detailContext.relatedItems.filter((item) => item.ownerCharacterId !== character.id).map((item) => item.id),
  }
}

function serialize(values: CharacterFormValues): Partial<Character> {
  return {
    roleType: values.roleType,
    recordStatus: 'confirmed',
    entityType: values.entityType?.trim() || '',
    species: values.species?.trim() || '',
    fullName: values.fullName.trim(),
    gender: values.gender?.trim() || '',
    age: values.age,
    occupation: values.occupation?.trim() || '',
    rankLevel: values.rankLevel?.trim() || '',
    socialIdentity: values.socialIdentity?.trim() || '',
    background: values.background?.trim() || '',
    campFactionIdsJson: JSON.stringify(values.campFactions || []),
    powerSystemRefsJson: JSON.stringify(values.powerSystems || []),
    contextHooksJson: JSON.stringify(values.contextHooks || []),
    goals: values.goals?.trim() || '',
    firstImpression: values.firstImpression?.trim() || '',
    innerConflict: values.innerConflict?.trim() || '',
    relationshipTension: values.relationshipTension?.trim() || '',
    resonancePoint: values.resonancePoint?.trim() || '',
    characterArc: values.characterArc?.trim() || '',
    appearanceJson: JSON.stringify({ description: values.appearance?.trim() || '' }),
  }
}

function relationLabel(type?: string, fallback?: string) {
  return getCharacterRelationLabel(type, fallback)
}

function buildRelationBody(relation: CharacterRelation) {
  const parts = [
    relation.description,
    relation.interactionStyle ? '互动：' + relation.interactionStyle : '',
    relation.subtextRule ? '潜台词：' + relation.subtextRule : '',
    relation.intimacyLevel ? '亲密 ' + relation.intimacyLevel + '/5' : '',
    relation.tensionLevel ? '张力 ' + relation.tensionLevel + '/5' : '',
  ].filter(Boolean)
  return parts.join('；') || '需要补充这个关系的具体拉扯。'
}

export default function CharacterWorkspace({ novelId }: Props) {
  const navigate = useNavigate()
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentNovel, setCharacters } = useNovelStore()
  const [form] = Form.useForm<CharacterFormValues>()
  const [batchForm] = Form.useForm<CharacterBatchFormValues>()
  const [protagonistForm] = Form.useForm<ProtagonistFormValues>()
  const [relationForm] = Form.useForm<RelationFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [pageData, setPageData] = useState<PagedResult<Character>>(EMPTY_PAGE)
  const [stats, setStats] = useState<CharacterStats>(EMPTY_STATS)
  const [filterOptions, setFilterOptions] = useState<CharacterFilterOptions>(EMPTY_FILTERS)
  const [detailContext, setDetailContext] = useState<CharacterDetailContext>(EMPTY_DETAIL)
  const [graphData, setGraphData] = useState<CharacterGraphPayload>(EMPTY_GRAPH)
  const [itemOptions, setItemOptions] = useState<StoryItem[]>([])
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchProgress, setBatchProgress] = useState<CharacterBatchProgress | null>(null)
  const [agentWorkflowOpen, setAgentWorkflowOpen] = useState(false)
  const [agentWorkflowLoading, setAgentWorkflowLoading] = useState(false)
  const [agentWorkflowStage, setAgentWorkflowStage] = useState<'idle' | 'planning' | 'drafting' | 'reviewed' | 'committing' | 'committed' | 'blocked'>('idle')
  const [agentPlan, setAgentPlan] = useState<CharacterNeedsAnalysisResult | null>(null)
  const [agentDraft, setAgentDraft] = useState<CharacterWorkflowDraftResult | null>(null)
  const [agentCommit, setAgentCommit] = useState<CharacterWorkflowCommitResult | null>(null)
  const [agentCommitKey, setAgentCommitKey] = useState('')
  const [agentWorkflowError, setAgentWorkflowError] = useState('')
  const [protagonistOpen, setProtagonistOpen] = useState(false)
  const [relationModalOpen, setRelationModalOpen] = useState(false)
  const routeFocusRef = useRef<number | null>(null)
  const selectedIdRef = useRef<number | null>(null)
  const creatingRef = useRef(false)
  const pageRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const routeCharacterId = useMemo(() => parseRouteId(searchParams.get('characterId')), [searchParams])
  const creativeStageId = useMemo(() => parseRouteId(searchParams.get('stageId')), [searchParams])
  const [creativeStageContext, setCreativeStageContext] = useState<CreativeStageContext | null>(null)
  const activeStageContext = creativeStageContext?.stage.id === creativeStageId ? creativeStageContext : null
  const [editingRelation, setEditingRelation] = useState<CharacterRelation | null>(null)
  const [relationSaving, setRelationSaving] = useState(false)
  const [relationCharacterOptions, setRelationCharacterOptions] = useState<Character[]>([])
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [roleFilter, setRoleFilter] = useState<Character['roleType'] | 'all'>('all')
  const [speciesFilter, setSpeciesFilter] = useState<string>('all')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all')
  const [recordStatusFilter, setRecordStatusFilter] = useState<'confirmed' | 'draft' | 'all'>('confirmed')
  const [graphScope, setGraphScope] = useState<'all' | 'focus'>('all')
  const [graphRelationFilter, setGraphRelationFilter] = useState<string>('all')
  const [workspaceView, setWorkspaceView] = useState<'list' | 'graph'>(() => (searchParams.get('view') === 'graph' ? 'graph' : 'list'))

  const handleCreativeStageChange = useCallback((stageId: number | null) => {
    const nextParams = new URLSearchParams(searchParams)
    if (stageId) nextParams.set('stageId', String(stageId))
    else nextParams.delete('stageId')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!creativeStageId) {
      setCreativeStageContext(null)
      return
    }
    let disposed = false
    void window.electron.creativeStage.getContext(novelId, creativeStageId).then((context) => {
      if (!disposed) setCreativeStageContext(context)
    }).catch((error) => {
      if (disposed) return
      setCreativeStageContext(null)
      console.error(error)
      message.error(getErrorMessage(error, 'creativeStage.notFound'))
    })
    return () => { disposed = true }
  }, [creativeStageId, novelId])

  const worldRules = useMemo(() => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName), [currentNovel?.genreName, currentNovel?.worldRulesJson])
  const speciesOptions = useMemo(() => getSpeciesNameOptions(worldRules), [worldRules])
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const powerSystemOptions = useMemo(() => getPowerSystemNameOptions(worldRules), [worldRules])
  const batchPreset = useMemo(() => getCharacterBatchPreset(currentNovel?.genreName, speciesOptions, {
    launchMode: currentNovel?.launchMode,
    targetWords: currentNovel?.targetWords,
    settingsJson: currentNovel?.settingsJson,
    mapDepth: worldRules.mapBlueprint.levels.length,
    factionCount: worldRules.factionSystem.length,
    speciesCount: worldRules.speciesSystem.length,
    powerSystemCount: worldRules.powerSystems.length,
  }), [
    currentNovel?.genreName,
    currentNovel?.launchMode,
    currentNovel?.settingsJson,
    currentNovel?.targetWords,
    speciesOptions,
    worldRules.factionSystem.length,
    worldRules.mapBlueprint.levels.length,
    worldRules.powerSystems.length,
    worldRules.speciesSystem.length,
  ])
  const availableSpecies = useMemo(() => Array.from(new Set([...speciesOptions, ...filterOptions.species])).filter(Boolean), [filterOptions.species, speciesOptions])
  const availableEntityTypes = useMemo(() => Array.from(new Set([...ENTITY_TYPE_OPTIONS.map((item) => item.value), ...filterOptions.entityTypes])).filter(Boolean), [filterOptions.entityTypes])
  const itemLinkOptions = useMemo(() => itemOptions.map((item) => ({
    value: item.id,
    label: `${item.itemName}${item.recordStatus === 'draft' ? ' · 草稿' : ''}`,
  })), [itemOptions])
  const itemPromptOptions = useMemo(() => itemOptions.map((item) => ({
    value: item.itemName,
    label: `${item.itemName}${item.recordStatus === 'draft' ? ' · 草稿' : ''}`,
  })), [itemOptions])
  const relationCharacterSelectOptions = useMemo(() => relationCharacterOptions
    .filter((character) => character.id !== selectedCharacter?.id)
    .map((character) => ({
      value: character.id,
      label: character.fullName + (character.roleType ? ' · ' + ROLE_META[character.roleType].label : ''),
    })), [relationCharacterOptions, selectedCharacter?.id])
  const selectedLead = selectedCharacter
    ? selectedCharacter.innerConflict || selectedCharacter.goals || selectedCharacter.firstImpression || selectedCharacter.background || '先把这个角色的动机、关系和资源绑紧。'
    : creating
      ? '先定角色类型、身份位置和物品关联，再补心理和关系。'
      : '先从左侧选择一个角色，或直接新建。'

  const relationStats = useMemo(() => {
    const counts = new Map<string, number>()
    graphData.relations.forEach((relation) => {
      const key = relation.relationType || 'other'
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
  }, [graphData.relations])

  const buildQuery = useCallback((targetPage: number): CharacterQueryInput => ({
    novelId,
    page: targetPage,
    pageSize: PAGE_SIZE,
    recordStatus: recordStatusFilter,
    ...(creativeStageId && activeStageContext ? { characterIds: activeStageContext.activeCharacterIds } : {}),
    ...(roleFilter !== 'all' ? { roleType: roleFilter as Character['roleType'] } : {}),
    ...(entityTypeFilter !== 'all' ? { entityType: entityTypeFilter } : {}),
    ...(speciesFilter !== 'all' ? { species: speciesFilter } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  }), [activeStageContext, creativeStageId, entityTypeFilter, keyword, novelId, recordStatusFilter, roleFilter, speciesFilter])

  const searchItems = useCallback(async (value = '') => {
    const rows = await window.electron.item.search(novelId, value, 'instance', 24)
    setItemOptions((prev) => mergeById(rows, prev))
  }, [novelId])

  const hydrateItemOptions = useCallback(async (context?: CharacterDetailContext) => {
    const baseItems = await window.electron.item.search(novelId, '', 'instance', 24)
    setItemOptions(mergeById(baseItems, context?.relatedItems || []))
  }, [novelId])

  const searchRelationCharacters = useCallback(async (value = '') => {
    const rows = await window.electron.character.search(novelId, value, 80)
    const merged = mergeById(
      rows.filter((character) => character.id !== selectedCharacter?.id),
      [...detailContext.relatedCharacters, ...pageData.items].filter((character) => character.id !== selectedCharacter?.id),
    )
    setRelationCharacterOptions(merged.filter((character) => character.id !== selectedCharacter?.id))
  }, [detailContext.relatedCharacters, novelId, pageData.items, selectedCharacter?.id])

  const loadCharacterDetail = useCallback(async (characterId: number) => {
    const requestId = ++detailRequestRef.current
    selectedIdRef.current = characterId
    const [character, context, baseItems] = await Promise.all([
      window.electron.character.get(characterId),
      window.electron.character.getDetailContext(characterId),
      window.electron.item.search(novelId, '', 'instance', 24),
    ])
    if (detailRequestRef.current !== requestId) return
    if (!character) {
      selectedIdRef.current = null
      setSelectedId(null)
      setSelectedCharacter(null)
      setDetailContext(EMPTY_DETAIL)
      form.resetFields()
      return
    }
    creatingRef.current = false
    setSelectedId(character.id)
    setSelectedCharacter(character)
    setDetailContext(context)
    form.setFieldsValue(buildFormValues(character, context))
    setItemOptions(mergeById(baseItems, context.relatedItems))
  }, [form, novelId])

  const loadGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      if (creativeStageId && activeStageContext && activeStageContext.activeCharacterIds.length === 0) {
        setGraphData(EMPTY_GRAPH)
        return
      }
      const graph = await window.electron.character.getGraph({
        novelId,
        limit: graphScope === 'focus' ? 24 : 60,
        recordStatus: recordStatusFilter,
        ...(creativeStageId && activeStageContext ? { characterIds: activeStageContext.activeCharacterIds } : {}),
        ...(graphScope === 'focus' && selectedId ? { focusCharacterId: selectedId } : {}),
        ...(roleFilter !== 'all' ? { roleTypes: [roleFilter] } : {}),
        ...(graphRelationFilter !== 'all' ? { relationTypes: [graphRelationFilter] } : {}),
      })
      setGraphData(graph)
    } finally {
      setGraphLoading(false)
    }
  }, [activeStageContext, creativeStageId, graphRelationFilter, graphScope, novelId, recordStatusFilter, roleFilter, selectedId])

  const loadPage = useCallback(async (
    preferredId: number | null | undefined,
    targetPage: number,
    options: { preserveCreating?: boolean } = {},
  ) => {
    const requestId = ++pageRequestRef.current
    const detailRequestAtStart = detailRequestRef.current
    setLoading(true)
    try {
      const query = buildQuery(targetPage)
      const [list, summary, nextFilters] = await Promise.all([
        window.electron.character.query(query),
        window.electron.character.getStats(query),
        window.electron.character.getFilterOptions(novelId),
      ])
      if (pageRequestRef.current !== requestId) return
      setPageData(list)
      setStats(summary)
      setFilterOptions(nextFilters)
      setCharacters(list.items)

      if (typeof preferredId !== 'number' && detailRequestRef.current !== detailRequestAtStart) return
      if (typeof preferredId !== 'number' && options.preserveCreating && creatingRef.current) return

      const currentSelectedId = selectedIdRef.current
      const nextId = typeof preferredId === 'number'
        ? preferredId
        : list.items.some((item) => item.id === currentSelectedId)
          ? currentSelectedId
          : list.items[0]?.id ?? null
      if (nextId !== null) {
        creatingRef.current = false
        setCreating(false)
        await loadCharacterDetail(nextId)
      } else {
        detailRequestRef.current += 1
        selectedIdRef.current = null
        creatingRef.current = false
        setSelectedId(null)
        setSelectedCharacter(null)
        setDetailContext(EMPTY_DETAIL)
        setCreating(false)
        form.resetFields()
        await hydrateItemOptions(undefined)
      }
    } finally {
      if (pageRequestRef.current === requestId) setLoading(false)
    }
  }, [buildQuery, form, hydrateItemOptions, loadCharacterDetail, novelId, setCharacters])

  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { creatingRef.current = creating }, [creating])
  useEffect(() => {
    void loadPage(undefined, page, { preserveCreating: true }).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [loadPage, page])
  useEffect(() => { setPage(1) }, [creativeStageId, entityTypeFilter, keyword, recordStatusFilter, roleFilter, speciesFilter])
  useEffect(() => { void loadGraph() }, [loadGraph])
  useEffect(() => {
    if (!routeCharacterId || routeFocusRef.current === routeCharacterId) return
    routeFocusRef.current = routeCharacterId
    setPage(1)
    void loadPage(routeCharacterId, 1).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [loadPage, routeCharacterId])

  useEffect(() => {
    batchForm.setFieldsValue({
      majorCount: batchPreset.majorCount,
      minorCount: batchPreset.minorCount,
      antagonistCount: batchPreset.antagonistCount,
      supportingCount: batchPreset.supportingCount,
      genderRatio: batchPreset.genderRatio,
      preferredSpecies: batchPreset.preferredSpecies,
      factionBias: factionOptions.slice(0, 3),
      helperRoles: batchPreset.helperRoles,
      batchSize: batchPreset.batchSize,
      specialRequirements: '',
      relationSeedMode: 'balanced',
      requiredItemLinks: [],
      diversityConstraints: [],
    })
  }, [batchForm, batchPreset, factionOptions])

  useEffect(() => onTaskBridgeEvent('character:batch-progress', (payload) => {
    const parsed = parseCharacterBatchProgress(payload)
    if (parsed) setBatchProgress(parsed)
  }), [])

  const handleNew = () => {
    detailRequestRef.current += 1
    selectedIdRef.current = null
    creatingRef.current = true
    setCreating(true)
    setSelectedId(null)
    setSelectedCharacter(null)
    setDetailContext(EMPTY_DETAIL)
    form.setFieldsValue({
      roleType: 'major',
      entityType: '',
      species: '',
      fullName: '',
      gender: '',
      age: undefined,
      occupation: '',
      rankLevel: '',
      socialIdentity: '',
      background: '',
      campFactions: [],
      powerSystems: [],
      contextHooks: [],
      goals: '',
      firstImpression: '',
      innerConflict: '',
      relationshipTension: '',
      resonancePoint: '',
      characterArc: '',
      appearance: '',
      ownedItemIds: [],
      linkedItemIds: [],
    })
  }

  const syncCharacterItems = useCallback(async (characterId: number, values: CharacterFormValues) => {
    const previousRelatedItems = detailContext.relatedItems
    const ownedSet = new Set(values.ownedItemIds || [])
    const linkedSet = new Set([...(values.linkedItemIds || []), ...ownedSet])
    const touchedIds = [...new Set([
      ...previousRelatedItems.map((item) => item.id),
      ...ownedSet,
      ...linkedSet,
    ])]

    for (const itemId of touchedIds) {
      const item = await window.electron.item.get(itemId)
      if (!item) continue
      const currentLinkedIds = parseNumberArray(item.linkedCharacterIdsJson)
      const nextLinkedIds = linkedSet.has(itemId)
        ? Array.from(new Set([...currentLinkedIds, characterId]))
        : currentLinkedIds.filter((id) => id !== characterId)
      const nextOwnerCharacterId = ownedSet.has(itemId)
        ? characterId
        : item.ownerCharacterId === characterId
          ? undefined
          : item.ownerCharacterId

      await window.electron.item.update(itemId, {
        ownerCharacterId: nextOwnerCharacterId,
        linkedCharacterIdsJson: JSON.stringify(nextLinkedIds),
        recordStatus: 'confirmed',
      })
    }
  }, [detailContext.relatedItems])

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      if (selectedCharacter?.id) {
        await window.electron.character.update(selectedCharacter.id, serialize(values))
        await syncCharacterItems(selectedCharacter.id, values)
        await loadPage(selectedCharacter.id, page)
      } else {
        const nextId = await window.electron.character.create(novelId, serialize(values))
        await syncCharacterItems(nextId, values)
        await loadPage(nextId, page)
      }
      setCreating(false)
      await loadGraph()
      message.success(getUserFacingMessage(
        selectedCharacter?.recordStatus === 'draft' ? 'character.savedDraft' : 'character.savedProfile',
      ))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'character.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedCharacter?.id) return
    Modal.confirm({
      title: `删除「${selectedCharacter.fullName}」？`,
      content: '删除后不会自动清理其他模块中的引用，请确认这个角色已不再使用。',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.character.delete(selectedCharacter.id)
        await loadPage(null, page)
        await loadGraph()
        message.success(getUserFacingMessage('character.deleted'))
      },
    })
  }

  const ensureCharacterGenerationReady = useCallback(async () => {
    try {
      const workflowStats = await loadWorkflowStats(novelId)
      const blockers = getWorkflowBlockers('characters', currentNovel, workflowStats)

      if (blockers.length > 0) {
        message.warning(blockers.join('\n'))
        return false
      }

      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
      return false
    }
  }, [currentNovel, novelId])

  const handleGenerateProtagonist = async () => {
    const ready = await ensureCharacterGenerationReady()
    if (!ready) return

    const values = protagonistForm.getFieldsValue()
    setGenerating(true)
    try {
      const nextId = await window.electron.character.generateProtagonist(novelId, {
        ...values,
        stageId: creativeStageId || undefined,
        itemPreferences: values.itemPreferenceText,
        forbiddenNames: values.forbiddenNameText,
      })
      setProtagonistOpen(false)
      protagonistForm.resetFields()
      await loadPage(nextId, 1)
      await loadGraph()
      message.success(getUserFacingMessage('character.protagonistGenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'character.protagonistGenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleBatchGenerate = async () => {
    const ready = await ensureCharacterGenerationReady()
    if (!ready) return

    const values = batchForm.getFieldsValue()
    setGenerating(true)
    setBatchProgress(null)
    try {
      await window.electron.character.batchGenerate(novelId, {
        ...values,
        stageId: creativeStageId || undefined,
      })
      setBatchOpen(false)
      await loadPage(null, 1)
      await loadGraph()
      message.success(getUserFacingMessage('character.batchGenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'character.batchGenerateFailed'))
    } finally {
      setGenerating(false)
      setBatchProgress(null)
    }
  }

  const handleAgentWorkflowStart = async () => {
    const ready = await ensureCharacterGenerationReady()
    if (!ready) return

    setAgentWorkflowOpen(true)
    setAgentWorkflowLoading(true)
    setGenerating(true)
    setAgentWorkflowStage('planning')
    setAgentWorkflowError('')
    setAgentPlan(null)
    setAgentDraft(null)
    setAgentCommit(null)
    setAgentCommitKey('')
    try {
      const plan = unwrapAgentToolResult<CharacterNeedsAnalysisResult>(await window.electron.agentTools.call({
        toolId: 'novelforge.characters.analyze_needs',
        input: {
          novelId,
          scope: { type: 'novel', lookaheadChapters: 30 },
          goals: [
            '补足叙事功能缺口',
            '降低同质角色与认知负担',
            '让新增人物能直接进入未来章节',
            ...(activeStageContext ? [`只为当前阶段服务，不提前展开后续阶段：${activeStageContext.promptSummary}`] : []),
          ],
          constraints: {
            maxNewCharacters: 12,
            allowMergeExisting: true,
            allowArchiveExisting: false,
          },
          executionMode: 'review_first',
        },
      }))
      setAgentPlan(plan)
      if (plan.review.status === 'blocked') {
        setAgentWorkflowStage('blocked')
        setAgentWorkflowError(plan.review.hardBlockers.join('；') || '人物计划未通过审校。')
        return
      }
      if (
        plan.recommended.create === 0
        && plan.recommended.update === 0
        && plan.recommended.mergeGroups === 0
        && plan.recommended.archive === 0
      ) {
        setAgentWorkflowStage('reviewed')
        message.info(getUserFacingMessage('character.noNewCharacters'))
        return
      }

      setAgentWorkflowStage('drafting')
      const draft = unwrapAgentToolResult<CharacterWorkflowDraftResult>(await window.electron.agentTools.call({
        toolId: 'novelforge.characters.generate_draft',
        input: {
          novelId,
          planId: plan.planId,
          idempotencyKey: createWorkflowKey('character-draft'),
          maxCharacters: 12,
          specialRequirements: [
            '保持人物姓名自然可读；优先形成能被章节合同直接引用的行动、资源与关系钩子。',
            activeStageContext ? `当前阶段边界：${activeStageContext.promptSummary}` : '',
          ].filter(Boolean).join('\n'),
        },
      }))
      setAgentDraft(draft)
      setAgentCommitKey(createWorkflowKey('character-commit'))
      setAgentWorkflowStage(draft.review.status === 'blocked' ? 'blocked' : 'reviewed')
      if (draft.review.status === 'blocked') {
        setAgentWorkflowError(draft.review.hardBlockers.join('；') || draft.review.summary)
      }
    } catch (error) {
      console.error(error)
      setAgentWorkflowStage('blocked')
      setAgentWorkflowError(getErrorMessage(error, 'character.batchGenerateFailed'))
    } finally {
      setAgentWorkflowLoading(false)
      setGenerating(false)
    }
  }

  const handleAgentDraftCommit = async () => {
    if (!agentDraft || !agentDraft.review.committable) return
    const commitKey = agentCommitKey || createWorkflowKey('character-commit')
    if (!agentCommitKey) setAgentCommitKey(commitKey)
    const request: AgentToolCallRequest = {
      toolId: 'novelforge.characters.commit_draft',
      input: {
        novelId,
        draftArtifactId: agentDraft.draftArtifact.id,
        expectedContextVersion: agentDraft.draftArtifact.contextVersion,
        expectedContentHash: agentDraft.draftArtifact.contentHash,
        idempotencyKey: commitKey,
      },
    }
    setAgentWorkflowLoading(true)
    setGenerating(true)
    setAgentWorkflowStage('committing')
    setAgentWorkflowError('')
    try {
      const approval = await window.electron.agentTools.approve({ request })
      if (!approval.approved || !approval.approvalId) {
        setAgentWorkflowStage('reviewed')
        if (approval.reason && approval.reason !== '用户取消。') message.info(approval.reason)
        return
      }
      const committed = unwrapAgentToolResult<CharacterWorkflowCommitResult>(await window.electron.agentTools.call({
        ...request,
        approvalId: approval.approvalId,
      }))
      if (creativeStageId) {
        const committedIds = [...committed.createdCharacterIds, ...committed.updatedCharacterIds]
        await Promise.all(committedIds.map(async (characterId) => {
          const character = await window.electron.character.get(characterId)
          await window.electron.creativeStage.upsertAsset({
            stageId: creativeStageId,
            assetType: 'character',
            assetId: characterId,
            placeholderName: character?.fullName,
            role: character?.roleType === 'protagonist' || character?.roleType === 'major' ? 'core' : 'supporting',
            detailLevel: 'canonical',
            status: 'active',
          })
        }))
      }
      setAgentCommit(committed)
      setAgentWorkflowStage('committed')
      const refreshedCharacterId = committed.createdCharacterIds[0] || committed.updatedCharacterIds[0] || null
      await Promise.all([loadPage(refreshedCharacterId, 1), loadGraph()])
      try {
        await window.electron.character.generateRelations(novelId)
        await loadGraph()
      } catch (relationError) {
        console.warn('提交后关系网络刷新失败:', relationError)
      }
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('character.batchCommitted', {
        count: committed.createdCharacterIds.length + committed.updatedCharacterIds.length,
      }))
    } catch (error) {
      console.error(error)
      setAgentWorkflowStage('blocked')
      setAgentWorkflowError(getErrorMessage(error, 'character.batchGenerateFailed'))
    } finally {
      setAgentWorkflowLoading(false)
      setGenerating(false)
    }
  }

  const handleGenerateRelations = async () => {
    setGenerating(true)
    try {
      await window.electron.character.generateRelations(novelId)
      await Promise.all([loadPage(selectedId, page), loadGraph()])
      message.success(getUserFacingMessage('character.relationsGenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'character.relationsGenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleRegenerate = async () => {
    if (!selectedCharacter?.id) return
    setGenerating(true)
    try {
      const regenerated = await window.electron.character.regenerate(selectedCharacter.id)
      await Promise.all([loadPage(regenerated?.id || selectedCharacter.id, page), loadGraph()])
      message.success(getUserFacingMessage('character.regenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'character.regenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const openRelationModal = useCallback(async (relation?: CharacterRelation) => {
    if (!selectedCharacter?.id) return
    await searchRelationCharacters('')
    setEditingRelation(relation || null)
    relationForm.setFieldsValue({
      charBId: relation ? (relation.charAId === selectedCharacter.id ? relation.charBId : relation.charAId) : undefined,
      relationType: relation?.relationType || 'friend',
      relationLabel: relation?.relationLabel || '',
      bilateral: relation ? relation.bilateral !== 0 : true,
      description: relation?.description || '',
      intimacyLevel: relation?.intimacyLevel,
      tensionLevel: relation?.tensionLevel,
      interactionStyle: relation?.interactionStyle || '',
      subtextRule: relation?.subtextRule || '',
    })
    setRelationModalOpen(true)
  }, [relationForm, searchRelationCharacters, selectedCharacter])

  const handleSaveRelation = async () => {
    if (!selectedCharacter?.id) return
    const values = await relationForm.validateFields().catch(() => null)
    if (!values) return
    setRelationSaving(true)
    try {
      await window.electron.character.upsertRelation({
        novelId,
        charAId: selectedCharacter.id,
        charBId: values.charBId,
        relationType: values.relationType,
        relationLabel: values.relationLabel?.trim() || undefined,
        description: values.description?.trim() || undefined,
        bilateral: values.bilateral === false ? 0 : 1,
        intimacyLevel: normalizeCharacterRelationLevel(values.intimacyLevel),
        tensionLevel: normalizeCharacterRelationLevel(values.tensionLevel),
        interactionStyle: values.interactionStyle?.trim() || undefined,
        subtextRule: values.subtextRule?.trim() || undefined,
      })
      setRelationModalOpen(false)
      setEditingRelation(null)
      relationForm.resetFields()
      await loadPage(selectedCharacter.id, page)
      await loadGraph()
      message.success(getUserFacingMessage(editingRelation ? 'common.relationUpdated' : 'common.relationSaved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.relationSaveRetryLater'))
    } finally {
      setRelationSaving(false)
    }
  }

  const handleClear = useCallback(async () => {
    Modal.confirm({
      title: '清空人物系统？',
      content: '会删除当前小说下全部人物与关系数据，此操作不可撤销。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.character.clear(novelId)
        form.resetFields()
        setSelectedId(null)
        setSelectedCharacter(null)
        setDetailContext(EMPTY_DETAIL)
        setCreating(false)
        await Promise.all([loadPage(null, 1), loadGraph()])
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('character.cleared'))
      },
    })
  }, [form, loadGraph, loadPage, novelId, notifyWorkspaceMutation])

  useEffect(() => {
    registerClearHandler(() => {
      void handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  const sourceContexts = useMemo(() => parseSourceContexts(selectedCharacter?.sourceContextJson), [selectedCharacter?.sourceContextJson])
  const graphCharacterCount = graphData.characters.length
  const draftRoster = pageData.items.filter((item) => item.recordStatus === 'draft')

  return (
    <WorkspacePage
      className="novel-characters-page"
      layout="wide"
      title="角色系统"
      actions={(
        <Space wrap>
          <CreativeStageScope novelId={novelId} value={creativeStageId} onChange={handleCreativeStageChange} />
          <Button type="primary" icon={<RobotOutlined />} loading={generating} onClick={() => setProtagonistOpen(true)}>AI 生成·主角</Button>
          <Button className="character-agent-workflow-trigger" icon={<SafetyCertificateOutlined />} loading={agentWorkflowLoading} onClick={() => void handleAgentWorkflowStart()}>
            智能规划·审校后生成
          </Button>
          <Button icon={<TeamOutlined />} loading={generating} onClick={() => { void searchItems(''); setBatchOpen(true) }}>按数量生成</Button>
          <Button icon={<ApartmentOutlined />} loading={generating} onClick={() => { setWorkspaceView('graph'); void handleGenerateRelations() }}>AI 修复·关系网络</Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, selectedCharacter ? `arc-center?tab=characters&characterId=${selectedCharacter.id}` : 'arc-center'))}>
            去人物弧线
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, selectedCharacter ? `resistance?tab=characters&characterId=${selectedCharacter.id}` : 'resistance?tab=characters'))}>
            去反派与阻力
          </Button>
          <Button icon={<UserAddOutlined />} onClick={handleNew}>新建人物</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadPage(selectedId, page); void loadGraph() }}>刷新</Button>
          <Button danger icon={<DeleteOutlined />} loading={generating} onClick={() => void handleClear()}>清空人物</Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '当前窗口', value: activeStageContext?.stage.name || '全项目' },
            { label: '正式角色', value: stats.confirmedCount || 0 },
            { label: '草稿待审', value: stats.draftCount || 0 },
            { label: '图谱范围', value: graphScope === 'focus' ? '当前人物关系圈' : '全角色网络' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="筛选后角色" value={pageData.total} tone="warm" />
          <WorkspaceMetric label="关系条数" value={stats.relationCount} />
          <WorkspaceMetric label="图谱节点" value={graphCharacterCount} tone="cool" />
          <WorkspaceMetric label="草稿队列" value={stats.draftCount || 0} />
        </>
      )}
    >
      <div className="novel-character-studio-shell">
        <div className="novel-character-studio__view-switch" role="tablist" aria-label="角色工作区视图">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceView === 'list'}
            className={`novel-character-studio__view-tab${workspaceView === 'list' ? ' is-active' : ''}`}
            onClick={() => setWorkspaceView('list')}
          >
            <TeamOutlined />
            <span>人物列表</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceView === 'graph'}
            className={`novel-character-studio__view-tab${workspaceView === 'graph' ? ' is-active' : ''}`}
            onClick={() => setWorkspaceView('graph')}
          >
            <ApartmentOutlined />
            <span>关系网络</span>
          </button>
        </div>

        {workspaceView === 'list' ? (
          <div className="novel-character-studio novel-character-studio--list">
            <WorkspacePanel
              className="novel-character-studio__sidebar"
              title="人物列表"
              scrollable
              sticky
              extra={(
                <div className="novel-filter-bar">
                  <div className="novel-filter-bar__row">
                    <Input.Search allowClear placeholder="搜索姓名、目标、职业或矛盾" value={keyword} onChange={(event) => setKeyword(event.target.value)} onSearch={setKeyword} />
                  </div>
                  <div className="novel-filter-bar__row">
                    <Select value={roleFilter} options={[{ value: 'all', label: '全部角色' }, ...ROLE_OPTIONS]} onChange={setRoleFilter} />
                    <Select value={recordStatusFilter} options={[{ value: 'confirmed', label: '正式' }, { value: 'draft', label: '草稿' }, { value: 'all', label: '全部状态' }]} onChange={setRecordStatusFilter} />
                  </div>
                  <div className="novel-filter-bar__row">
                    <Select value={entityTypeFilter} options={[{ value: 'all', label: '全部实体' }, ...availableEntityTypes.map((item) => ({ value: item, label: ENTITY_TYPE_OPTIONS.find((option) => option.value === item)?.label || item }))]} onChange={setEntityTypeFilter} />
                    <Select value={speciesFilter} options={[{ value: 'all', label: '全部种类' }, ...availableSpecies.map((item) => ({ value: item, label: item }))]} onChange={setSpeciesFilter} />
                  </div>
                </div>
              )}
            >
              {stats.draftCount ? (
                <Alert
                  className="novel-character-alert"
                  type="info"
                  showIcon
                  message={`当前有 ${stats.draftCount} 个待确认角色草稿`}
                  description="保存草稿角色会自动转为正式角色；如果正文或大纲新发现了物品，请到物品页继续完善。"
                />
              ) : null}

              {loading ? <div className="novel-empty"><Spin /></div> : pageData.total === 0 ? <div className="novel-empty">当前筛选下还没有角色。</div> : (
                <div className="novel-character-list">
                  {pageData.items.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className={`novel-list-card novel-character-list-card ${selectedId === character.id ? 'novel-list-card--active' : ''}`}
                      onClick={() => void loadCharacterDetail(character.id)}
                    >
                      <div className="novel-list-card__title">
                        <span>{character.fullName}</span>
                        {character.recordStatus === 'draft' ? <Tag color="processing">草稿</Tag> : null}
                      </div>
                      <div className="novel-list-card__meta">
                        <Tag color={ROLE_META[character.roleType].color}>{ROLE_META[character.roleType].label}</Tag>
                        {character.species ? <Tag>{character.species}</Tag> : null}
                        {character.occupation ? <Tag color="blue">{character.occupation}</Tag> : null}
                      </div>
                      <div className="novel-list-card__desc">{character.innerConflict || character.goals || character.firstImpression || character.background || '这个角色还没有核心信息。'}</div>
                    </button>
                  ))}
                  <Pagination current={pageData.page} pageSize={pageData.pageSize} total={pageData.total} size="small" showSizeChanger={false} onChange={setPage} />
                </div>
              )}

              {draftRoster.length > 0 ? (
                <div className="novel-character-draft-strip">
                  <div className="novel-character-draft-strip__title">本页草稿</div>
                  <div className="novel-character-draft-strip__body">
                    {draftRoster.slice(0, 4).map((item) => (
                      <button key={item.id} type="button" className="novel-character-draft-chip" onClick={() => void loadCharacterDetail(item.id)}>
                        {item.fullName}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </WorkspacePanel>

            <WorkspacePanel
              className="novel-character-studio__editor"
              title={selectedCharacter ? `编辑：${selectedCharacter.fullName}` : creating ? '新建人物' : '人物档案'}
              scrollable
              sticky
              extra={(
                <Space wrap>
              <AIGenerateButton
                novelId={novelId}
                label={selectedCharacter ? 'AI 补全·当前人物' : 'AI 生成·人物草稿'}
                  isJson
                  disabled={!selectedCharacter && !creating}
                  buildMessages={() => {
                    const values = form.getFieldsValue(true)
                    return buildDraftMessages({
                      task: '人物档案',
                      mode: 'replace',
                      context: [
                        { label: '书名', value: currentNovel?.title || '' },
                        { label: '题材', value: currentNovel?.genreName || '' },
                        { label: '小说简介', value: currentNovel?.synopsis || '' },
                        { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
                        { label: '人物生态', value: worldRules.characterEcology.overview },
                        { label: '可用种类', value: availableSpecies.slice(0, 12).join('、') },
                        { label: '可用势力', value: factionOptions.slice(0, 12).join('、') },
                        { label: '可用体系', value: powerSystemOptions.slice(0, 12).join('、') },
                        { label: '已选物品', value: itemOptions.filter((item) => values.ownedItemIds.includes(item.id) || values.linkedItemIds.includes(item.id)).map((item) => item.itemName).join('、') },
                      ],
                      fields: [
                        { key: 'species', label: '种类', value: values.species },
                        { key: 'fullName', label: '姓名', value: values.fullName, hint: '写正常、可读的人名。' },
                        { key: 'gender', label: '性别', value: values.gender },
                        { key: 'age', label: '年龄', type: 'number', value: values.age },
                        { key: 'occupation', label: '职业', value: values.occupation },
                        { key: 'rankLevel', label: '等级 / 职级', value: values.rankLevel },
                        { key: 'socialIdentity', label: '社会位置', value: values.socialIdentity },
                        { key: 'background', label: '背景经历', value: values.background },
                        { key: 'campFactions', label: '所属势力', type: 'string[]', value: values.campFactions },
                        { key: 'powerSystems', label: '关联体系', type: 'string[]', value: values.powerSystems },
                        { key: 'contextHooks', label: '主线挂点', type: 'string[]', value: values.contextHooks },
                        { key: 'goals', label: '当前目标', value: values.goals },
                        { key: 'firstImpression', label: '第一印象', value: values.firstImpression },
                        { key: 'innerConflict', label: '内在矛盾', value: values.innerConflict },
                        { key: 'relationshipTension', label: '关系张力', value: values.relationshipTension },
                        { key: 'resonancePoint', label: '共情点', value: values.resonancePoint },
                        { key: 'characterArc', label: '后续弧光', value: values.characterArc },
                        { key: 'appearance', label: '可识别外貌', value: values.appearance },
                      ],
                      requirements: ['不要写空泛人格标签。', '人物设定要能直接进入章节使用。', '尽量让人物和已选物品发生真实关系。'],
                    })
                  }}
                  onResult={(raw) => {
                    const values = form.getFieldsValue(true)
                    const draft = parseDraftJson<Record<string, unknown>>(raw)
                    form.setFieldsValue({
                      ...values,
                      species: typeof draft.species === 'string' ? draft.species : values.species,
                      fullName: typeof draft.fullName === 'string' ? draft.fullName : values.fullName,
                      gender: typeof draft.gender === 'string' ? draft.gender : values.gender,
                      age: normalizeOptionalNumber(draft.age ?? values.age),
                      occupation: typeof draft.occupation === 'string' ? draft.occupation : values.occupation,
                      rankLevel: typeof draft.rankLevel === 'string' ? draft.rankLevel : values.rankLevel,
                      socialIdentity: typeof draft.socialIdentity === 'string' ? draft.socialIdentity : values.socialIdentity,
                      background: typeof draft.background === 'string' ? draft.background : values.background,
                      campFactions: normalizeStringArray(draft.campFactions).length > 0 ? normalizeStringArray(draft.campFactions) : values.campFactions,
                      powerSystems: normalizeStringArray(draft.powerSystems).length > 0 ? normalizeStringArray(draft.powerSystems) : values.powerSystems,
                      contextHooks: normalizeStringArray(draft.contextHooks).length > 0 ? normalizeStringArray(draft.contextHooks) : values.contextHooks,
                      goals: typeof draft.goals === 'string' ? draft.goals : values.goals,
                      firstImpression: typeof draft.firstImpression === 'string' ? draft.firstImpression : values.firstImpression,
                      innerConflict: typeof draft.innerConflict === 'string' ? draft.innerConflict : values.innerConflict,
                      relationshipTension: typeof draft.relationshipTension === 'string' ? draft.relationshipTension : values.relationshipTension,
                      resonancePoint: typeof draft.resonancePoint === 'string' ? draft.resonancePoint : values.resonancePoint,
                      characterArc: typeof draft.characterArc === 'string' ? draft.characterArc : values.characterArc,
                      appearance: typeof draft.appearance === 'string' ? draft.appearance : values.appearance,
                    })
                  }}
                />
                  {selectedCharacter ? <Button icon={<ReloadOutlined />} loading={generating} onClick={() => void handleRegenerate()}>AI 修复·重做人物</Button> : null}
                  {selectedCharacter ? <Button icon={<ApartmentOutlined />} onClick={() => { void openRelationModal() }}>编辑关系</Button> : null}
                  {selectedCharacter ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}
                  <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存并确认</Button>
                </Space>
              )}
            >
              {!selectedCharacter && !creating && !loading ? <div className="novel-empty">从左侧选中一个角色后再编辑。</div> : (
                <>
              <div className="novel-characters__editor-intro">
                <div className="novel-characters__editor-intro-copy">
                  <div className="novel-kicker">{selectedCharacter?.recordStatus === 'draft' ? '待确认草稿' : selectedCharacter ? '当前人物' : '新建档案'}</div>
                  <strong>{selectedCharacter ? selectedCharacter.fullName : '从身份、目标和资源开始'}</strong>
                  <span>{selectedLead}</span>
                </div>
                <div className="novel-characters__editor-tags">
                  {selectedCharacter ? <Tag color={ROLE_META[selectedCharacter.roleType].color}>{ROLE_META[selectedCharacter.roleType].label}</Tag> : null}
                  {selectedCharacter?.recordStatus === 'draft' ? <Tag color="processing">来自自动发现</Tag> : null}
                  {detailContext.relatedItems.length > 0 ? <Tag icon={<AppstoreOutlined />}>{detailContext.relatedItems.length} 个关联物品</Tag> : null}
                  {detailContext.relatedRelations.length > 0 ? <Tag icon={<ApartmentOutlined />}>{detailContext.relatedRelations.length} 条关系</Tag> : null}
                </div>
              </div>

              {selectedCharacter?.recordStatus === 'draft' && sourceContexts.length > 0 ? (
                <Alert
                  className="novel-character-alert"
                  type="warning"
                  showIcon
                  message="这个角色来自自动发现"
                  description={sourceContexts.map((item, index) => (
                    <div key={`${item.label || 'source'}-${index}`}>{item.label || item.page || '未知来源'}</div>
                  ))}
                />
              ) : null}

              {selectedCharacter ? (
                <div style={{ marginBottom: 12 }}>
                  <DramaticEnginePanel text={selectedCharacter.dramaticEngine} />
                </div>
              ) : null}

              {selectedCharacter ? (
                <AiPatchEditor
                  target={{ type: 'character', id: selectedCharacter.id, novelId }}
                  description="面向当前人物档案的字段级补丁，确认后才写入。"
                  placeholder="例如：把他改成更像末世里的临时医生，不要换姓名；强化他和药箱、伤员之间的责任压力。"
                  onApplied={async (applied) => {
                    const updated = applied as Character | null
                    await Promise.all([loadPage(updated?.id || selectedCharacter.id, page), loadGraph()])
                  }}
                />
              ) : null}

              <Form form={form} layout="vertical">
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="roleType" label="角色类型" rules={[{ required: true, message: '请选择角色类型' }]}><Select options={ROLE_OPTIONS as unknown as Array<{ value: Character['roleType']; label: string }>} /></Form.Item>
                  <Form.Item name="entityType" label="实体类型"><Select allowClear options={ENTITY_TYPE_OPTIONS} /></Form.Item>
                  <Form.Item name="species" label="种类 / 物种"><Select showSearch allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
                  <Form.Item name="gender" label="性别"><Input placeholder="可留空" /></Form.Item>
                  <Form.Item name="age" label="年龄"><InputNumber min={0} className="novel-character-full-width-number" /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="occupation" label="职业 / 身份"><Input /></Form.Item>
                  <Form.Item name="rankLevel" label="等级 / 职级"><Input /></Form.Item>
                  <Form.Item name="socialIdentity" label="社会位置"><Input /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="campFactions" label="所属势力"><Select mode="tags" allowClear options={factionOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
                  <Form.Item name="powerSystems" label="关联体系"><Select mode="tags" allowClear options={powerSystemOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
                </div>
                <Form.Item name="contextHooks" label="主线挂点"><Select mode="tags" allowClear placeholder="例如：掌握补给线、知道旧案真相、被关键势力追杀" /></Form.Item>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="ownedItemIds" label="当前持有物品">
                    <Select mode="multiple" allowClear showSearch filterOption={false} options={itemLinkOptions} onFocus={() => void searchItems('')} onSearch={(value) => void searchItems(value)} placeholder="绑定当前持有或长期占有的物品" />
                  </Form.Item>
                  <Form.Item name="linkedItemIds" label="剧情关联物品">
                    <Select mode="multiple" allowClear showSearch filterOption={false} options={itemLinkOptions} onFocus={() => void searchItems('')} onSearch={(value) => void searchItems(value)} placeholder="绑定争夺物、证据、信物、装备等" />
                  </Form.Item>
                </div>
                <Form.Item name="background" label="背景经历"><Input.TextArea rows={6} /></Form.Item>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="goals" label="当前目标"><Input.TextArea rows={6} /></Form.Item>
                  <Form.Item name="firstImpression" label="第一印象"><Input.TextArea rows={6} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="innerConflict" label="内在矛盾"><Input.TextArea rows={6} /></Form.Item>
                  <Form.Item name="relationshipTension" label="关系张力"><Input.TextArea rows={6} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="resonancePoint" label="读者共情点"><Input.TextArea rows={6} /></Form.Item>
                  <Form.Item name="characterArc" label="后续弧光"><Input.TextArea rows={6} /></Form.Item>
                </div>
                <Form.Item name="appearance" label="可识别外貌"><Input.TextArea rows={6} /></Form.Item>
              </Form>

              {selectedCharacter ? (
                <div className="novel-support-grid novel-character-support-grid">
                  <WorkspaceTip title="关联物品">
                    {detailContext.relatedItems.length === 0 ? <div>这个角色还没有绑定关键物品。</div> : detailContext.relatedItems.map((item) => (
                      <div key={item.id} className="novel-character-linked-row">
                        <strong>{item.itemName}</strong>
                        <span>{item.ownerCharacterId === selectedCharacter.id ? '当前持有' : item.plotFunction || item.summary || '剧情关联物品'}</span>
                      </div>
                    ))}
                  </WorkspaceTip>
                  <WorkspaceTip title="关系摘要">
                    {detailContext.relatedRelations.length === 0 ? <div>这个角色还没有关系链。</div> : detailContext.relatedRelations.map((relation) => {
                      const other = detailContext.relatedCharacters.find((item) => item.id === (relation.charAId === selectedCharacter.id ? relation.charBId : relation.charAId))
                      return (
                        <div key={relation.id} className="novel-character-linked-row novel-character-linked-row--stacked">
                          <div className="novel-character-linked-row__head">
                            <strong>{other?.fullName || '未知人物'} · {relation.relationLabel || relationLabel(relation.relationType)}</strong>
                            <Button type="link" size="small" onClick={() => { void openRelationModal(relation) }}>编辑</Button>
                          </div>
                          <span>{buildRelationBody(relation)}</span>
                        </div>
                      )
                    })}
                  </WorkspaceTip>
                </div>
              ) : null}
                </>
              )}
            </WorkspacePanel>
          </div>
        ) : (
          <div className="novel-character-studio novel-character-studio--graph">
            <WorkspacePanel
              className="novel-character-graph-panel novel-character-graph-panel--full"
              title="人物关系看板"
              extra={(
                <Space wrap className="novel-character-graph-panel__controls">
                  <Select className="novel-character-graph-panel__select" value={graphScope} options={[{ value: 'all', label: '全角色网络' }, { value: 'focus', label: '当前人物关系圈' }]} onChange={setGraphScope} />
                  <Select className="novel-character-graph-panel__select" value={graphRelationFilter} options={RELATION_OPTIONS} onChange={setGraphRelationFilter} />
                  <Button size="small" onClick={() => setWorkspaceView('list')}>返回人物档案</Button>
                </Space>
              )}
            >
              <div className="novel-character-graph-panel__stats">
                {relationStats.length === 0 ? <span className="novel-character-graph-panel__empty">还没有可视关系。</span> : relationStats.map(([type, count]) => (
                  <div key={type} className="novel-character-graph-stat">
                    <strong>{count}</strong>
                    <span>{relationLabel(type)}</span>
                  </div>
                ))}
              </div>
              <div className="novel-character-graph-panel__canvas">
                {graphLoading ? <div className="novel-empty"><Spin /></div> : (
                  <CharacterGraphCanvas
                    data={graphData}
                    selectedCharacterId={selectedId}
                    onCharacterSelect={(characterId) => {
                      setWorkspaceView('list')
                      void loadCharacterDetail(characterId)
                    }}
                    onCanvasClick={() => {
                      if (graphScope === 'focus') setGraphScope('all')
                    }}
                  />
                )}
              </div>
            </WorkspacePanel>
          </div>
        )}
      </div>

      <Modal
        title={editingRelation ? '编辑人物关系' : '新建人物关系'}
        open={relationModalOpen}
        forceRender
        onCancel={() => {
          setRelationModalOpen(false)
          setEditingRelation(null)
          relationForm.resetFields()
        }}
        onOk={() => void handleSaveRelation()}
        confirmLoading={relationSaving}
        okText={editingRelation ? '保存关系' : '创建关系'}
      >
        <Form form={relationForm} layout="vertical">
          <Form.Item name="charBId" label="关联角色" rules={[{ required: true, message: '请选择关联角色' }]}>
            <Select
              showSearch
              filterOption={false}
              options={relationCharacterSelectOptions}
              onFocus={() => { void searchRelationCharacters('') }}
              onSearch={(value) => { void searchRelationCharacters(value) }}
              placeholder="选择当前角色要建立关系的人物"
            />
          </Form.Item>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="relationType" label="关系类型" rules={[{ required: true, message: '请选择关系类型' }]}>
              <Select options={CHARACTER_RELATION_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))} />
            </Form.Item>
            <Form.Item name="bilateral" label="关系方向" initialValue={true}>
              <Select options={[{ value: true, label: '双向关系' }, { value: false, label: '单向 / 不对称' }]} />
            </Form.Item>
          </div>
          <Form.Item name="relationLabel" label="关系简称"><Input placeholder="例如：旧同桌、表面同盟、点头之交" /></Form.Item>
          <Form.Item name="description" label="当前关系状态"><Input.TextArea rows={6} placeholder="用一句话写清这两个人目前怎么拉扯。" /></Form.Item>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="intimacyLevel" label="亲密度 1-5"><InputNumber min={1} max={5} className="novel-character-full-width-number" /></Form.Item>
            <Form.Item name="tensionLevel" label="张力度 1-5"><InputNumber min={1} max={5} className="novel-character-full-width-number" /></Form.Item>
          </div>
          <Form.Item name="interactionStyle" label="互动方式"><Input.TextArea rows={6} placeholder="例如：嘴硬、互相打断、很少直视对方、称呼始终很客气。" /></Form.Item>
          <Form.Item name="subtextRule" label="潜台词规则"><Input.TextArea rows={6} placeholder="例如：明明在关心，但谁都不先承认；永远不直接提旧事。" /></Form.Item>
        </Form>
      </Modal>

      <Modal title="AI 生成主角" open={protagonistOpen} forceRender onCancel={() => setProtagonistOpen(false)} onOk={() => void handleGenerateProtagonist()} confirmLoading={generating} okText="生成主角">
        <Form form={protagonistForm} layout="vertical">
          <div className="novel-grid novel-grid--2">
            <Form.Item name="gender" label="性别"><Input placeholder="例如：女 / 男 / 不限" /></Form.Item>
            <Form.Item name="ageRange" label="年龄范围"><Input placeholder="例如：18-24 岁，可留空" /></Form.Item>
          </div>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="species" label="种类偏好"><Select allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
            <Form.Item name="occupationHint" label="职业 / 身份倾向"><Input placeholder="例如：流亡医生、基层调查员" /></Form.Item>
          </div>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="factionHint" label="势力倾向"><Input placeholder="可留空" /></Form.Item>
            <Form.Item name="surnameHint" label="姓名方向"><Input placeholder="例如：姓沈、偏北方感、避免生僻字" /></Form.Item>
          </div>
          <Form.Item name="personalitySeed" label="性格种子"><Input.TextArea rows={6} placeholder="例如：外冷内热、强控制欲、对旧债过度执着" /></Form.Item>
          <Form.Item name="itemPreferenceText" label="希望绑定的物品 / 资源">
            <Select
              mode="tags"
              allowClear
              options={itemPromptOptions}
              placeholder="可选已有物品，也可自行输入"
            />
          </Form.Item>
          <Form.Item name="forbiddenNameText" label="禁用姓名"><Select mode="tags" placeholder="输入后回车，也可留空" /></Form.Item>
          <Form.Item name="forceDifferentFromExisting" label="强制与现有人物明显区分">
            <Select options={[{ value: true, label: '是，尽量拉开差异' }, { value: false, label: '否，允许贴近现有生态' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        className="character-agent-workflow-modal"
        width={920}
        title={(
          <div className="character-agent-workflow__modal-title">
            <SafetyCertificateOutlined />
            <div>
              <strong>人物生态编排台</strong>
              <span>功能位分析 → 版本化草稿 → 独立审校 → 单次批准</span>
            </div>
          </div>
        )}
        open={agentWorkflowOpen}
        maskClosable={!agentWorkflowLoading}
        closable={!agentWorkflowLoading}
        onCancel={() => setAgentWorkflowOpen(false)}
        footer={(
          <div className="character-agent-workflow__footer">
            <Button disabled={agentWorkflowLoading} onClick={() => setAgentWorkflowOpen(false)}>
              {agentWorkflowStage === 'committed' ? '完成' : '稍后处理'}
            </Button>
            <Space wrap>
              <Button disabled={agentWorkflowLoading} icon={<ReloadOutlined />} onClick={() => void handleAgentWorkflowStart()}>
                重新分析
              </Button>
              {agentDraft && agentWorkflowStage !== 'committed' ? (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={agentWorkflowStage === 'committing'}
                  disabled={!agentDraft.review.committable || agentWorkflowLoading}
                  onClick={() => void handleAgentDraftCommit()}
                >
                  查看原生确认并提交
                </Button>
              ) : null}
            </Space>
          </div>
        )}
      >
        <div className="character-agent-workflow">
          <div className="character-agent-workflow__rail" aria-label="人物生成工作流阶段">
            {[
              { key: 'planning', label: '功能位分析', note: '不按题材常量凑人数' },
              { key: 'drafting', label: '草稿生成', note: '正式人物库零写入' },
              { key: 'reviewed', label: '独立审校', note: '规则与模型双证据' },
              { key: 'committed', label: '批准提交', note: '哈希与版本双校验' },
            ].map((step, index) => {
              const order = ['idle', 'planning', 'drafting', 'reviewed', 'committing', 'committed']
              const currentIndex = order.indexOf(agentWorkflowStage)
              const stepIndex = order.indexOf(step.key)
              const completed = agentWorkflowStage === 'committed' || currentIndex > stepIndex
              const active = agentWorkflowStage === step.key || (step.key === 'reviewed' && agentWorkflowStage === 'blocked') || (step.key === 'reviewed' && agentWorkflowStage === 'committing')
              return (
                <div key={step.key} className={`character-agent-workflow__step${completed ? ' is-complete' : ''}${active ? ' is-active' : ''}`}>
                  <span className="character-agent-workflow__step-index">{completed ? <CheckCircleOutlined /> : index + 1}</span>
                  <span><strong>{step.label}</strong><small>{step.note}</small></span>
                </div>
              )
            })}
          </div>

          {agentWorkflowError ? (
            <Alert
              className="character-agent-workflow__alert"
              type="error"
              showIcon
              message="工作流在安全门前停止"
              description={agentWorkflowError}
            />
          ) : null}

          <Spin spinning={agentWorkflowLoading} tip={agentWorkflowStage === 'planning' ? '正在分析人物功能位…' : agentWorkflowStage === 'drafting' ? '正在生成并审校人物草稿…' : agentWorkflowStage === 'committing' ? '正在提交不可变草稿…' : '处理中…'}>
            <div className="character-agent-workflow__content">
              {!agentPlan ? (
                <div className="character-agent-workflow__empty">
                  <SafetyCertificateOutlined />
                  <strong>正在读取项目上下文</strong>
                  <span>系统会综合主线、线程、终局承诺、势力、物品和现有人物，再决定是否需要新增角色。</span>
                </div>
              ) : (
                <>
                  <section className="character-agent-workflow__section">
                    <div className="character-agent-workflow__section-head">
                      <div><span>01 / CAST PLAN</span><strong>人数来自叙事缺口</strong></div>
                      <Tag color={agentPlan.review.status === 'passed' ? 'success' : agentPlan.review.status === 'blocked' ? 'error' : 'warning'}>
                        计划审校 {agentPlan.review.score} 分
                      </Tag>
                    </div>
                    <div className="character-agent-workflow__score-grid">
                      <div><span>保留</span><strong>{agentPlan.recommended.keep}</strong></div>
                      <div><span>更新</span><strong>{agentPlan.recommended.update}</strong></div>
                      <div className="is-accent"><span>新增</span><strong>{agentPlan.recommended.create}</strong></div>
                      <div><span>合并组</span><strong>{agentPlan.recommended.mergeGroups}</strong></div>
                      <div><span>提交后活跃</span><strong>{agentPlan.recommended.activeCastAfterCommit}</strong></div>
                    </div>
                    <p className="character-agent-workflow__summary">{agentPlan.review.summary}</p>
                    <div className="character-agent-workflow__slots">
                      {agentPlan.roleSlots.slice(0, 10).map((slot) => (
                        <div key={slot.slotId} className={`character-agent-workflow__slot is-${slot.coverage}`}>
                          <div><strong>{slot.function}</strong><Tag>{slot.proposedAction}</Tag></div>
                          <span>{slot.independenceReason || `由角色 #${slot.coveredByCharacterIds.join('、') || '待定'} 承担`}</span>
                          <small>{slot.evidenceRefs.slice(0, 3).join(' · ') || '暂无证据引用'}</small>
                        </div>
                      ))}
                    </div>
                  </section>

                  {agentDraft ? (
                    <section className="character-agent-workflow__section character-agent-workflow__section--review">
                      <div className="character-agent-workflow__section-head">
                        <div><span>02 / REVIEWED DRAFT</span><strong>草稿已冻结，尚未写入正式库</strong></div>
                        <Tag color={agentDraft.review.status === 'passed' ? 'success' : agentDraft.review.status === 'blocked' ? 'error' : 'warning'}>
                          {agentDraft.review.status === 'passed' ? '可提交' : agentDraft.review.status === 'blocked' ? '已阻塞' : '带警告可提交'}
                        </Tag>
                      </div>
                      <div className="character-agent-workflow__roster">
                        {agentDraft.characterNames.map((name, index) => (
                          <span key={`${name}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b>{name}</span>
                        ))}
                      </div>
                      {agentDraft.updatePreview.length > 0 ? (
                        <div className="character-agent-workflow__updates">
                          {agentDraft.updatePreview.map((update) => (
                            <div key={update.characterId}>
                              <strong>{update.characterName}</strong>
                              <span>{update.fields.join('、')}</span>
                              <small>{update.summary}</small>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="character-agent-workflow__review-copy">
                        <strong>{agentDraft.review.summary}</strong>
                        <span>草稿哈希：{agentDraft.draftArtifact.contentHash}</span>
                        <span>上下文版本：v{agentDraft.draftArtifact.contextVersion} · 任务 #{agentDraft.taskId}</span>
                      </div>
                      <div className="character-agent-workflow__checks">
                        {agentDraft.review.checks.map((check) => (
                          <div key={check.code} className={`is-${check.status}`}>
                            <span>{check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '×'}</span>
                            <p><strong>{check.message}</strong>{check.characterNames.length ? <small>{check.characterNames.join('、')}</small> : null}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {agentCommit ? (
                    <section className="character-agent-workflow__commit-card">
                      <CheckCircleOutlined />
                      <div>
                        <span>CANONICAL COMMIT</span>
                        <strong>已提交 {agentCommit.createdCharacterIds.length + agentCommit.updatedCharacterIds.length} 项人物变化</strong>
                        <p>{[...agentCommit.createdCharacterNames, ...agentCommit.updatedCharacterNames.map((name) => `${name}（更新）`)].join('、')} · 上下文 v{agentCommit.contextVersionBefore} → v{agentCommit.contextVersionAfter}</p>
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </Spin>
        </div>
      </Modal>

      <Modal title="按数量批量生成人物网络" open={batchOpen} forceRender onCancel={() => setBatchOpen(false)} onOk={() => void handleBatchGenerate()} confirmLoading={generating} okText="开始生成">
        {generating && batchProgress ? (() => {
          const { percent, text } = formatCharacterBatchProgress(batchProgress)
          return (
            <div style={{ marginBottom: 12 }}>
              <Progress percent={percent} status={percent >= 100 ? 'success' : 'active'} />
              <div style={{ fontSize: 12, opacity: 0.75 }}>{text}</div>
            </div>
          )
        })() : null}
        <Form form={batchForm} layout="vertical">
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 12 }}
            message="题材人物数量建议"
            description={`${batchPreset.rationale}：建议主要 ${batchPreset.majorCount}、次要 ${batchPreset.minorCount}、对立 ${batchPreset.antagonistCount}、功能 ${batchPreset.supportingCount} 位，共 ${batchPreset.totalCount} 位；可按剧情密度手动调整。`}
          />
          <div className="novel-grid novel-grid--2">
            <Form.Item name="majorCount" label="主要人物"><Select options={Array.from(new Set([batchPreset.majorCount, 2, 3, 4, 5, 6])).sort((left, right) => left - right).map((value) => ({ value, label: `${value} 位${value === batchPreset.majorCount ? ' · 题材推荐' : ''}` }))} /></Form.Item>
            <Form.Item name="minorCount" label="次要人物"><Select options={Array.from(new Set([batchPreset.minorCount, 3, 5, 6, 8, 10])).sort((left, right) => left - right).map((value) => ({ value, label: `${value} 位${value === batchPreset.minorCount ? ' · 题材推荐' : ''}` }))} /></Form.Item>
          </div>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="antagonistCount" label="对立角色"><Select options={Array.from(new Set([batchPreset.antagonistCount, 0, 1, 2, 3])).sort((left, right) => left - right).map((value) => ({ value, label: `${value} 位${value === batchPreset.antagonistCount ? ' · 题材推荐' : ''}` }))} /></Form.Item>
            <Form.Item name="supportingCount" label="功能角色"><Select options={Array.from(new Set([batchPreset.supportingCount, 0, 1, 2, 3, 4])).sort((left, right) => left - right).map((value) => ({ value, label: `${value} 位${value === batchPreset.supportingCount ? ' · 题材推荐' : ''}` }))} /></Form.Item>
          </div>
          <Form.Item name="genderRatio" label="性别与年龄建议"><Input.TextArea rows={6} /></Form.Item>
          <Form.Item name="preferredSpecies" label="优先种类"><Select mode="multiple" allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
          <Form.Item name="factionBias" label="优先势力来源"><Select mode="multiple" allowClear options={factionOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
          <Form.Item name="helperRoles" label="优先功能位"><Select mode="tags" allowClear placeholder="例如：队医、情报员、导师、卧底" /></Form.Item>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="relationSeedMode" label="关系网络倾向"><Select options={[{ value: 'balanced', label: '均衡' }, { value: 'conflict-heavy', label: '冲突密集' }, { value: 'ally-heavy', label: '同盟密集' }]} /></Form.Item>
            <Form.Item name="batchSize" label="每批生成数量"><Select options={Array.from(new Set([batchPreset.batchSize, 4, 6, 8, 10])).sort((left, right) => left - right).map((value) => ({ value, label: `${value} 位 / 批${value === batchPreset.batchSize ? ' · 推荐' : ''}` }))} /></Form.Item>
          </div>
          <Form.Item name="requiredItemLinks" label="优先绑定这些物品">
            <Select
              mode="multiple"
              allowClear
              options={itemPromptOptions}
              onFocus={() => void searchItems('')}
              onSearch={(value) => void searchItems(value)}
              showSearch
              filterOption={false}
            />
          </Form.Item>
          <Form.Item name="diversityConstraints" label="差异化约束"><Select mode="tags" allowClear placeholder="例如：避免同职业、避免同类成长轨迹" /></Form.Item>
          <Form.Item name="specialRequirements" label="额外要求"><Input.TextArea rows={6} /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
