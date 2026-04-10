import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Pagination, Select, Space, Spin, Tag, message } from 'antd'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  DeleteOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { useSearchParams } from 'react-router-dom'
import type {
  Character,
  CharacterBatchGenerationOptions,
  CharacterRelation,
  CharacterDetailContext,
  CharacterFilterOptions,
  CharacterGenerationOptions,
  CharacterGraphPayload,
  CharacterQueryInput,
  CharacterStats,
  PagedResult,
  StoryItem,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { getCharacterBatchPreset } from '../../../shared/creation-tools'
import { getFactionNameOptions, getPowerSystemNameOptions, getSpeciesNameOptions, parseWorldRulesJson } from '../../../shared/genre-system'
import { CHARACTER_RELATION_PRESETS, getCharacterRelationLabel, normalizeCharacterRelationLevel } from '../../../shared/character-relations'
import { buildDraftMessages, normalizeOptionalNumber, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel, WorkspaceStepGuide, WorkspaceTip } from '../components/WorkspaceShell'
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
  const [searchParams] = useSearchParams()
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
  const [protagonistOpen, setProtagonistOpen] = useState(false)
  const [relationModalOpen, setRelationModalOpen] = useState(false)
  const routeFocusRef = useRef<number | null>(null)
  const routeCharacterId = useMemo(() => parseRouteId(searchParams.get('characterId')), [searchParams])
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

  const worldRules = useMemo(() => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName), [currentNovel?.genreName, currentNovel?.worldRulesJson])
  const speciesOptions = useMemo(() => getSpeciesNameOptions(worldRules), [worldRules])
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const powerSystemOptions = useMemo(() => getPowerSystemNameOptions(worldRules), [worldRules])
  const batchPreset = useMemo(() => getCharacterBatchPreset(currentNovel?.genreName, speciesOptions), [currentNovel?.genreName, speciesOptions])
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

  const buildQuery = useCallback((targetPage = page): CharacterQueryInput => ({
    novelId,
    page: targetPage,
    pageSize: PAGE_SIZE,
    recordStatus: recordStatusFilter,
    ...(roleFilter !== 'all' ? { roleType: roleFilter as Character['roleType'] } : {}),
    ...(entityTypeFilter !== 'all' ? { entityType: entityTypeFilter } : {}),
    ...(speciesFilter !== 'all' ? { species: speciesFilter } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  }), [entityTypeFilter, keyword, novelId, page, recordStatusFilter, roleFilter, speciesFilter])

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
    const [character, context] = await Promise.all([
      window.electron.character.get(characterId),
      window.electron.character.getDetailContext(characterId),
    ])
    if (!character) {
      setSelectedId(null)
      setSelectedCharacter(null)
      setDetailContext(EMPTY_DETAIL)
      form.resetFields()
      return
    }
    setSelectedId(character.id)
    setSelectedCharacter(character)
    setDetailContext(context)
    form.setFieldsValue(buildFormValues(character, context))
    await hydrateItemOptions(context)
  }, [form, hydrateItemOptions])

  const loadGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      const graph = await window.electron.character.getGraph({
        novelId,
        limit: graphScope === 'focus' ? 24 : 60,
        recordStatus: recordStatusFilter,
        ...(graphScope === 'focus' && selectedId ? { focusCharacterId: selectedId } : {}),
        ...(roleFilter !== 'all' ? { roleTypes: [roleFilter] } : {}),
        ...(graphRelationFilter !== 'all' ? { relationTypes: [graphRelationFilter] } : {}),
      })
      setGraphData(graph)
    } finally {
      setGraphLoading(false)
    }
  }, [graphRelationFilter, graphScope, novelId, recordStatusFilter, roleFilter, selectedId])

  const loadPage = useCallback(async (preferredId?: number | null, targetPage = page) => {
    setLoading(true)
    try {
      const query = buildQuery(targetPage)
      const [list, summary, nextFilters] = await Promise.all([
        window.electron.character.query(query),
        window.electron.character.getStats(query),
        window.electron.character.getFilterOptions(novelId),
      ])
      setPageData(list)
      setStats(summary)
      setFilterOptions(nextFilters)
      setCharacters(list.items)

      const nextId = preferredId ?? (list.items.some((item) => item.id === selectedId) ? selectedId : list.items[0]?.id ?? null)
      if (nextId) {
        setCreating(false)
        await loadCharacterDetail(nextId)
      } else {
        setSelectedId(null)
        setSelectedCharacter(null)
        setDetailContext(EMPTY_DETAIL)
        setCreating(false)
        form.resetFields()
        await hydrateItemOptions(undefined)
      }
    } finally {
      setLoading(false)
    }
  }, [buildQuery, form, hydrateItemOptions, loadCharacterDetail, novelId, page, selectedId, setCharacters])

  useEffect(() => { void loadPage(selectedId, page) }, [loadPage, page, selectedId])
  useEffect(() => { setPage(1) }, [entityTypeFilter, keyword, recordStatusFilter, roleFilter, speciesFilter])
  useEffect(() => { void loadGraph() }, [loadGraph])
  useEffect(() => {
    if (!routeCharacterId || routeFocusRef.current === routeCharacterId) return
    routeFocusRef.current = routeCharacterId
    setPage(1)
    void loadPage(routeCharacterId, 1)
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
      batchSize: 6,
      specialRequirements: '',
      relationSeedMode: 'balanced',
      requiredItemLinks: [],
      diversityConstraints: [],
    })
  }, [batchForm, batchPreset, factionOptions])

  const handleNew = () => {
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
    const values = await form.validateFields()
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

  const handleGenerateProtagonist = async () => {
    const values = protagonistForm.getFieldsValue()
    setGenerating(true)
    try {
      const nextId = await window.electron.character.generateProtagonist(novelId, {
        ...values,
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
    const values = batchForm.getFieldsValue()
    setGenerating(true)
    try {
      await window.electron.character.batchGenerate(novelId, values)
      setBatchOpen(false)
      await loadPage(null, 1)
      await loadGraph()
      message.success(getUserFacingMessage('character.batchGenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'character.batchGenerateFailed'))
    } finally {
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
    const values = await relationForm.validateFields()
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

  const handleClear = async () => {
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
        message.success(getUserFacingMessage('character.cleared'))
      },
    })
  }

  const sourceContexts = useMemo(() => parseSourceContexts(selectedCharacter?.sourceContextJson), [selectedCharacter?.sourceContextJson])
  const graphCharacterCount = graphData.characters.length
  const draftRoster = pageData.items.filter((item) => item.recordStatus === 'draft')

  return (
    <WorkspacePage
      className="novel-characters-page"
      layout="wide"
      eyebrow="角色系统"
      title="角色系统"
      description="关系看板、角色档案和物品关联统一在一个工作区里处理。"
      guide={(
        <WorkspaceStepGuide
          steps={[
            { title: '先筛到当前要处理的人物', description: '先在左侧缩小到目标角色，再进入关系图和档案编辑，避免在大表单里来回找。', status: 'focus' },
            { title: '再确认关系和资源绑定', description: '优先检查关系图谱、关联物品和草稿来源，先补当前人物真正会影响正文的冲突与资源。', status: 'todo' },
            { title: '最后再做 AI 补全或保存转正', description: 'AI 入口只负责生成、补全、修复当前人物，不再要求你先通读整页再决定怎么改。', status: 'todo' },
          ]}
        />
      )}
      actions={(
        <Space wrap>
          <Button type="primary" icon={<RobotOutlined />} loading={generating} onClick={() => setProtagonistOpen(true)}>AI 生成·主角</Button>
          <Button icon={<TeamOutlined />} loading={generating} onClick={() => { void searchItems(''); setBatchOpen(true) }}>AI 生成·人物网络</Button>
          <Button icon={<ApartmentOutlined />} loading={generating} onClick={handleGenerateRelations}>AI 修复·关系网络</Button>
          <Button icon={<UserAddOutlined />} onClick={handleNew}>新建人物</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadPage(selectedId, page); void loadGraph() }}>刷新</Button>
          <Button danger icon={<DeleteOutlined />} loading={generating} onClick={() => void handleClear()}>清空人物</Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '正式角色', value: stats.confirmedCount || 0 },
            { label: '草稿待审', value: stats.draftCount || 0 },
            { label: '图谱范围', value: graphScope === 'focus' ? '当前人物关系圈' : '全角色网络' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="筛选后角色" value={pageData.total} tone="warm" hint={`第 ${pageData.page} 页`} />
          <WorkspaceMetric label="关系条数" value={stats.relationCount} hint="人物网络中的有效关系。" />
          <WorkspaceMetric label="图谱节点" value={graphCharacterCount} tone="cool" hint="当前关系看板中的可视角色。" />
          <WorkspaceMetric label="草稿队列" value={stats.draftCount || 0} hint="来自大纲或正文的新实体候选。" />
        </>
      )}
    >
      <div className="novel-character-studio">
        <WorkspacePanel
          className="novel-character-studio__sidebar"
          title="人物列表"
          description="先筛人，再看关系，再补档案和物品。"
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
            <div style={{ display: 'grid', gap: 12 }}>
              {pageData.items.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  className={`novel-list-card ${selectedId === character.id ? 'novel-list-card--active' : ''}`}
                  onClick={() => void loadCharacterDetail(character.id)}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
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
          className="novel-character-graph-panel"
          title="人物关系看板"
          description="中间只保留关系网络和关系统计，方便你在筛选列表与档案编辑之间保持上下文。"
          extra={(
            <Space wrap>
              <Select value={graphScope} options={[{ value: 'all', label: '全角色网络' }, { value: 'focus', label: '当前人物关系圈' }]} onChange={setGraphScope} style={{ minWidth: 148 }} />
              <Select value={graphRelationFilter} options={RELATION_OPTIONS} onChange={setGraphRelationFilter} style={{ minWidth: 148 }} />
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
                onCharacterSelect={(characterId) => { void loadCharacterDetail(characterId) }}
                onCanvasClick={() => {
                  if (graphScope === 'focus') setGraphScope('all')
                }}
              />
            )}
          </div>
        </WorkspacePanel>

        <WorkspacePanel
          className="novel-character-studio__editor"
          title={selectedCharacter ? `编辑：${selectedCharacter.fullName}` : creating ? '新建人物' : '人物档案'}
          description="右侧固定为当前人物档案。这里优先处理身份、目标、关系、物品和 AI 修补，不再把关系图和长表单堆在同一列。"
          scrollable
          sticky
          extra={(
            <Space wrap>
              <AIGenerateButton
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

              <Form form={form} layout="vertical">
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="roleType" label="角色类型" rules={[{ required: true, message: '请选择角色类型' }]}><Select options={ROLE_OPTIONS as unknown as Array<{ value: Character['roleType']; label: string }>} /></Form.Item>
                  <Form.Item name="entityType" label="实体类型"><Select allowClear options={ENTITY_TYPE_OPTIONS} /></Form.Item>
                  <Form.Item name="species" label="种类 / 物种"><Select showSearch allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--3">
                  <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
                  <Form.Item name="gender" label="性别"><Input placeholder="可留空" /></Form.Item>
                  <Form.Item name="age" label="年龄"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
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
                <Form.Item name="background" label="背景经历"><Input.TextArea rows={4} /></Form.Item>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="goals" label="当前目标"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="firstImpression" label="第一印象"><Input.TextArea rows={3} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="innerConflict" label="内在矛盾"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="relationshipTension" label="关系张力"><Input.TextArea rows={3} /></Form.Item>
                </div>
                <div className="novel-grid novel-grid--2">
                  <Form.Item name="resonancePoint" label="读者共情点"><Input.TextArea rows={3} /></Form.Item>
                  <Form.Item name="characterArc" label="后续弧光"><Input.TextArea rows={3} /></Form.Item>
                </div>
                <Form.Item name="appearance" label="可识别外貌"><Input.TextArea rows={3} /></Form.Item>
              </Form>

              {selectedCharacter ? (
                <div className="novel-support-grid" style={{ marginTop: 20 }}>
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
                        <div key={relation.id} className="novel-character-linked-row" style={{ display: 'grid', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
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
          <Form.Item name="description" label="当前关系状态"><Input.TextArea rows={3} placeholder="用一句话写清这两个人目前怎么拉扯。" /></Form.Item>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="intimacyLevel" label="亲密度 1-5"><InputNumber min={1} max={5} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="tensionLevel" label="张力度 1-5"><InputNumber min={1} max={5} style={{ width: "100%" }} /></Form.Item>
          </div>
          <Form.Item name="interactionStyle" label="互动方式"><Input.TextArea rows={2} placeholder="例如：嘴硬、互相打断、很少直视对方、称呼始终很客气。" /></Form.Item>
          <Form.Item name="subtextRule" label="潜台词规则"><Input.TextArea rows={2} placeholder="例如：明明在关心，但谁都不先承认；永远不直接提旧事。" /></Form.Item>
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
          <Form.Item name="personalitySeed" label="性格种子"><Input.TextArea rows={3} placeholder="例如：外冷内热、强控制欲、对旧债过度执着" /></Form.Item>
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

      <Modal title="批量生成人物网络" open={batchOpen} onCancel={() => setBatchOpen(false)} onOk={() => void handleBatchGenerate()} confirmLoading={generating} okText="开始生成">
        <Form form={batchForm} layout="vertical">
          <div className="novel-grid novel-grid--2">
            <Form.Item name="majorCount" label="主要人物"><Select options={[2, 3, 4, 5, 6].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
            <Form.Item name="minorCount" label="次要人物"><Select options={[3, 5, 6, 8, 10].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
          </div>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="antagonistCount" label="对立角色"><Select options={[0, 1, 2, 3].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
            <Form.Item name="supportingCount" label="功能角色"><Select options={[0, 1, 2, 3, 4].map((value) => ({ value, label: `${value} 位` }))} /></Form.Item>
          </div>
          <Form.Item name="genderRatio" label="性别与年龄建议"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="preferredSpecies" label="优先种类"><Select mode="multiple" allowClear options={availableSpecies.map((item) => ({ value: item, label: item }))} /></Form.Item>
          <Form.Item name="factionBias" label="优先势力来源"><Select mode="multiple" allowClear options={factionOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
          <Form.Item name="helperRoles" label="优先功能位"><Select mode="tags" allowClear placeholder="例如：队医、情报员、导师、卧底" /></Form.Item>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="relationSeedMode" label="关系网络倾向"><Select options={[{ value: 'balanced', label: '均衡' }, { value: 'conflict-heavy', label: '冲突密集' }, { value: 'ally-heavy', label: '同盟密集' }]} /></Form.Item>
            <Form.Item name="batchSize" label="每批生成数量"><Select options={[4, 6, 8].map((value) => ({ value, label: `${value} 位 / 批` }))} /></Form.Item>
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
          <Form.Item name="specialRequirements" label="额外要求"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
