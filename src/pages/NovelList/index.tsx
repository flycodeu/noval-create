import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Row,
  Select,
  Skeleton,
  Steps,
  Tag,
  message,
} from 'antd'
import {
  CheckOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage, isUserFacingMessage } from '@/utils/user-facing-message'
import type { Novel, NovelLaunchMode, Template } from '../../types'
import ProjectCard from '../../components/novel/cards/ProjectCard'
import { useNovelStore } from '../../stores/novel.store'
import { buildWorkspaceRoute, getWorkspaceSnapshot, type WorkspaceSnapshot } from '../../shared/novel-workspace'
import { getWorkspaceViewModeForNovel } from '../../shared/operating-mode'
import { buildLaunchIdeaMessages, normalizeLaunchIdeaResult, type LaunchIdeaExtractionResult } from '../../shared/launch-idea'
import { buildThemeVoicePayload } from '../../shared/theme-voice'
import { WRITING_CONTRACT_PRESETS, getWritingContractValidationError, normalizeWritingContractTags } from '../../shared/writing-contract'
import { EMPTY_WORKFLOW_STATS, loadWorkflowStats } from '../Novel/workflow'
import { parseDraftJson } from '../Novel/shared/ai-draft'
import { buildFastLaunchBootstrapPlan, NOVEL_LAUNCH_MODE_OPTIONS } from './fast-launch'
import './index.css'

interface WizardFormValues {
  genreId: number
  launchMode: NovelLaunchMode
  styleTemplateId?: number
  worldTemplateId?: number
  modelConfigId?: number
  writingContractTags?: string[]
  userBackground: string
  expandedBackground: string
  synopsis: string
  title: string
  targetWords: number
  protagonistStart: string
  coreHook: string
  coreConflict: string
  tabooRules: string
  endgameDirection: string
  launchIdea?: string
  launchIdeaTitle?: string
  launchIdeaSynopsis?: string
}

interface ExpandBackgroundResult {
  expanded_background: string
  titles: string[]
  synopsis: string
}

const GENRE_OPTIONS = [
  { value: 1, label: '现代都市', description: '都市生活、职场、生存压力与现代关系。' },
  { value: 2, label: '古代言情', description: '古典情感、宫廷关系与时代规训。' },
  { value: 3, label: '玄幻修真', description: '修炼体系、宗门势力与超凡成长。' },
  { value: 4, label: '悬疑推理', description: '谜案、线索追查与心理博弈。' },
  { value: 5, label: '科幻未来', description: '未来科技、社会变迁与宏观设定。' },
  { value: 6, label: '架空历史', description: '虚构历史路线下的家国与权力演化。' },
  { value: 7, label: '赛博朋克', description: '高科技、低生活与秩序失衡。' },
  { value: 8, label: '武侠', description: '江湖秩序、门派冲突与侠义选择。' },
  { value: 9, label: '历史正剧', description: '历史叙事、人物命运与时代结构。' },
  { value: 10, label: '末世求生', description: '灾变后的生存、重建与资源竞争。' },
  { value: 11, label: '丧尸末日', description: '感染蔓延、逃亡协作与社会崩塌。' },
  { value: 12, label: '盗墓探秘', description: '古墓机关、线索破解与冒险探索。' },
] as const

const TARGET_WORDS_OPTIONS = [
  { label: '短篇 10 万字', value: 100000 },
  { label: '轻长篇 15 万字', value: 150000 },
  { label: '中篇 30 万字', value: 300000 },
  { label: '长篇 50 万字', value: 500000 },
  { label: '超长篇 100 万字', value: 1000000 },
  { label: '百万以上 200 万字', value: 2000000 },
]

const STORY_TEXTAREA_AUTO_SIZE = { minRows: 9, maxRows: 18 }
const FAST_TEXTAREA_AUTO_SIZE = { minRows: 5, maxRows: 10 }
const EXPANDED_TEXTAREA_AUTO_SIZE = { minRows: 11, maxRows: 20 }
const SYNOPSIS_TEXTAREA_AUTO_SIZE = { minRows: 5, maxRows: 10 }

function formatWordCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万字`
  return `${value.toLocaleString()} 字`
}

function normalizeTargetWords(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function getWizardStepItems(launchMode: NovelLaunchMode) {
  if (launchMode === 'fast_launch') {
    return [
      { title: '路径与题材' },
      { title: '极速开书字段' },
    ]
  }

  return [
    { title: '题材与模板' },
    { title: '原始背景' },
    { title: 'AI 补全背景' },
    { title: '最终确认' },
  ]
}

export default function NovelList() {
  const navigate = useNavigate()
  const { novels, setNovels } = useNovelStore()
  const loadVersionRef = React.useRef(0)
  const [loading, setLoading] = useState(true)
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState<Record<number, WorkspaceSnapshot>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('updatedAt')
  const [styleTemplates, setStyleTemplates] = useState<Template[]>([])
  const [worldTemplates, setWorldTemplates] = useState<Template[]>([])
  const [modelConfigs, setModelConfigs] = useState<Array<{ id: number; name: string }>>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardLoading, setWizardLoading] = useState(false)
  const [wizardForm] = Form.useForm<WizardFormValues>()
  const [expandedData, setExpandedData] = useState<ExpandBackgroundResult | null>(null)
  const [selectedLaunchMode, setSelectedLaunchMode] = useState<NovelLaunchMode>('professional_longform')
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null)
  const [launchIdeaParsing, setLaunchIdeaParsing] = useState(false)
  const [launchIdeaNote, setLaunchIdeaNote] = useState('')

  const resetWizard = useCallback(() => {
    setWizardOpen(false)
    setWizardStep(0)
    setWizardLoading(false)
    setExpandedData(null)
    setLaunchIdeaParsing(false)
    setLaunchIdeaNote('')
    setSelectedLaunchMode('professional_longform')
    setSelectedGenreId(null)
    wizardForm.resetFields()
    wizardForm.setFieldsValue({ launchMode: 'professional_longform', targetWords: 200000 })
  }, [wizardForm])

  const loadWorkspaceSnapshots = useCallback(async (sourceNovels: Novel[]) => {
    const entries = await Promise.all(sourceNovels.map(async (novel) => {
      try {
        const stats = await loadWorkflowStats(novel.id)
        return [
          novel.id,
          getWorkspaceSnapshot(novel, stats, {
            viewMode: getWorkspaceViewModeForNovel(novel),
          }),
        ] as const
      } catch (error) {
        console.error('Failed to load novel workspace snapshot', novel.id, error)
        return [
          novel.id,
          getWorkspaceSnapshot(novel, {
            ...EMPTY_WORKFLOW_STATS,
          }),
        ] as const
      }
    }))

    return Object.fromEntries(entries)
  }, [])

  const loadNovels = useCallback(async () => {
    const requestId = ++loadVersionRef.current
    setLoading(true)
    try {
      const list = await window.electron.novel.list()
      if (requestId !== loadVersionRef.current) return
      setNovels(list)
      const snapshots = await loadWorkspaceSnapshots(list)
      if (requestId !== loadVersionRef.current) return
      setWorkspaceSnapshots(snapshots)
    } catch (error) {
      if (requestId === loadVersionRef.current) {
        message.error(getErrorMessage(error, 'novel.listLoadFailed'))
      }
    } finally {
      if (requestId === loadVersionRef.current) setLoading(false)
    }
  }, [loadWorkspaceSnapshots, setNovels])

  useEffect(() => {
    let active = true
    void loadNovels()
    void Promise.allSettled([
      window.electron.template.list('style'),
      window.electron.template.list('world'),
      window.electron.model.list(),
    ]).then(([styles, worlds, models]) => {
      if (!active) return
      if (styles.status === 'fulfilled') setStyleTemplates(styles.value)
      if (worlds.status === 'fulfilled') setWorldTemplates(worlds.value)
      if (models.status === 'fulfilled') setModelConfigs(models.value)
      if ([styles, worlds, models].some((result) => result.status === 'rejected')) {
        message.error(getUserFacingMessage('common.loadFailed'))
      }
    })
    setSelectedLaunchMode('professional_longform')
    wizardForm.setFieldsValue({ launchMode: 'professional_longform', targetWords: 200000 })
    return () => {
      active = false
      loadVersionRef.current += 1
    }
  }, [loadNovels, wizardForm])

  const filteredNovels = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return [...novels]
      .filter((novel) => {
        if (statusFilter !== 'all' && novel.status !== statusFilter) return false
        if (!keyword) return true
        return [novel.title, novel.synopsis, novel.genreName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      })
      .sort((left, right) => {
        if (sortBy === 'updatedAt') return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        if (sortBy === 'totalWords') return right.totalWords - left.totalWords
        if (sortBy === 'title') return left.title.localeCompare(right.title, 'zh')
        return 0
      })
  }, [novels, search, sortBy, statusFilter])

  const handleDelete = async (id: number, title: string) => {
    Modal.confirm({
      title: `确认删除《${title}》？`,
      content: '删除后章节、人物、地图、线程和结构数据都会一并删除，无法恢复。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.novel.delete(id)
          await loadNovels()
          message.success(getUserFacingMessage('novel.deleted'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
          throw error
        }
      },
    })
  }

  const handleExport = async (id: number, format: string) => {
    try {
      const filePath = await window.electron.novel.export(id, format)
      message.success(getUserFacingMessage('novel.exportedTo', { path: filePath }))
    } catch (error) {
      if (!isUserFacingMessage(error, 'common.userCancelled')) {
        message.error(getErrorMessage(error, 'novel.exportFailed'))
      }
    }
  }

  const handleStatusChange = async (id: number, status: Novel['status']) => {
    try {
      await window.electron.novel.update(id, { status })
      await loadNovels()
      const statusLabel = status === 'draft' ? '草稿' : status === 'writing' ? '写作中' : status === 'completed' ? '已完成' : '已归档'
      message.success(getUserFacingMessage('novel.statusUpdated', { status: statusLabel }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleFastLaunchCreate = useCallback(async () => {
    const values = await wizardForm.validateFields([
      'genreId',
      'protagonistStart',
      'coreHook',
      'coreConflict',
      'tabooRules',
      'endgameDirection',
    ]).catch(() => null)
    if (!values) return
    const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
    const writingContractTags = normalizeWritingContractTags(allValues.writingContractTags)
    const writingContractError = getWritingContractValidationError(writingContractTags)
    if (writingContractError) {
      message.error(writingContractError)
      return
    }

    const genreLabel = GENRE_OPTIONS.find((option) => option.value === values.genreId)?.label || '未分类'
    const targetWords = allValues.targetWords || 200000
    const plan = buildFastLaunchBootstrapPlan({
      genreLabel,
      protagonistStart: values.protagonistStart.trim(),
      coreHook: values.coreHook.trim(),
      coreConflict: values.coreConflict.trim(),
      tabooRules: values.tabooRules.trim(),
      endgameDirection: values.endgameDirection.trim(),
      sourceIdea: allValues.launchIdea?.trim(),
      titleHint: allValues.launchIdeaTitle?.trim(),
      synopsisHint: allValues.launchIdeaSynopsis?.trim(),
      targetWords,
      writingContractTags,
    })

    setWizardLoading(true)
    let createdNovelId: number | null = null
    let bootstrapCompleted = false
    try {
      createdNovelId = await window.electron.novel.create({
        title: plan.novel.title,
        synopsis: plan.novel.synopsis,
        genreId: values.genreId,
        launchMode: 'fast_launch',
        userBackground: plan.novel.userBackground,
        expandedBackground: plan.novel.expandedBackground,
        projectBriefJson: plan.novel.projectBriefJson,
        styleTemplateId: allValues.styleTemplateId,
        worldTemplateId: allValues.worldTemplateId,
        modelConfigId: allValues.modelConfigId,
        targetWords: plan.novel.targetWords,
      })

      await window.electron.novel.update(createdNovelId, {
        title: plan.novel.title,
        synopsis: plan.novel.synopsis,
        userBackground: plan.novel.userBackground,
        expandedBackground: plan.novel.expandedBackground,
        projectBriefJson: plan.novel.projectBriefJson,
        settingsJson: plan.novel.settingsJson,
        themeVoiceJson: plan.novel.themeVoiceJson,
        targetWords: plan.novel.targetWords,
      })

      const volumeId = await window.electron.structure.createVolume(createdNovelId, plan.volume)
      const arcId = await window.electron.outline.createArc(createdNovelId, plan.outlineArc)

      const [protagonistId, antagonistId, threadId] = await Promise.all([
        window.electron.character.create(createdNovelId, plan.protagonist),
        window.electron.character.create(createdNovelId, plan.antagonist),
        window.electron.thread.create(createdNovelId, {
          threadType: 'main',
          title: plan.thread.title,
          summary: plan.thread.summary,
          premise: plan.thread.premise,
          status: 'planned',
          priority: 'high',
          currentState: '前三章内必须完成主线起势。',
        }),
      ])

      await window.electron.character.upsertRelation({
        novelId: createdNovelId,
        charAId: protagonistId,
        charBId: antagonistId,
        relationType: plan.relationshipArc.relationTypeSnapshot,
        relationLabel: plan.relationshipArc.relationLabelSnapshot,
        description: plan.relationshipArc.startState,
        bilateral: 1,
        tensionLevel: 80,
        interactionStyle: '围绕核心冲突进行试探、施压与反制。',
        subtextRule: '双方都不直接说出真正代价，但每次交锋都提高压力。',
      })

      const chapterIds: number[] = []
      for (const chapter of plan.chapters) {
        const chapterId = await window.electron.chapter.create(createdNovelId, {
          ...chapter,
          status: 'outline',
          volumeId,
          arcId,
        })
        chapterIds.push(chapterId)
      }

      const timelineIdsByChapterNum = new Map<number, number>()
      for (const event of plan.timelineEvents) {
        const timelineId = await window.electron.timeline.create(createdNovelId, {
          ...event,
          timeMode: 'relative-disaster',
          volumeId,
          isMajorEvent: 1,
          protagonistPresent: 1,
        })
        timelineIdsByChapterNum.set(event.sortOrder, timelineId)
      }

      const chapterIdByNum = new Map(plan.chapters.map((chapter, index) => [chapter.chapterNum, chapterIds[index]] as const))
      const protagonistArcPlan = plan.characterArcs.find((arc) => arc.characterRole === 'protagonist')
      const antagonistArcPlan = plan.characterArcs.find((arc) => arc.characterRole === 'antagonist')
      if (!protagonistArcPlan || !antagonistArcPlan) throw new Error(getUserFacingMessage('novel.fastLaunchArcTemplateMissing'))

      const protagonistArc = await window.electron.characterArc.upsertCharacterArc({
        novelId: createdNovelId,
        characterId: protagonistId,
        startState: protagonistArcPlan.startState,
        surfaceWant: protagonistArcPlan.surfaceWant,
        deepNeed: protagonistArcPlan.deepNeed,
        coreFear: protagonistArcPlan.coreFear,
        misbelief: protagonistArcPlan.misbelief,
        firstCrackChapterId: chapterIdByNum.get(1),
        changeEvent: protagonistArcPlan.changeEvent,
        changeTimelineEventId: timelineIdsByChapterNum.get(1),
        endState: protagonistArcPlan.endState,
        currentStatus: 'active',
        notes: protagonistArcPlan.notes,
      })
      const antagonistArc = await window.electron.characterArc.upsertCharacterArc({
        novelId: createdNovelId,
        characterId: antagonistId,
        startState: antagonistArcPlan.startState,
        surfaceWant: antagonistArcPlan.surfaceWant,
        deepNeed: antagonistArcPlan.deepNeed,
        coreFear: antagonistArcPlan.coreFear,
        misbelief: antagonistArcPlan.misbelief,
        firstCrackChapterId: chapterIdByNum.get(1),
        changeEvent: antagonistArcPlan.changeEvent,
        changeTimelineEventId: timelineIdsByChapterNum.get(1),
        endState: antagonistArcPlan.endState,
        currentStatus: 'active',
        notes: antagonistArcPlan.notes,
      })
      const relationshipArc = await window.electron.characterArc.upsertRelationshipArc({
        novelId: createdNovelId,
        charAId: protagonistId,
        charBId: antagonistId,
        relationLabelSnapshot: plan.relationshipArc.relationLabelSnapshot,
        relationTypeSnapshot: plan.relationshipArc.relationTypeSnapshot,
        startState: plan.relationshipArc.startState,
        crackPoint: plan.relationshipArc.crackPoint,
        changeEvent: plan.relationshipArc.changeEvent,
        changeTimelineEventId: timelineIdsByChapterNum.get(1),
        endState: plan.relationshipArc.endState,
        currentStatus: 'active',
        lastProgressChapterId: chapterIdByNum.get(1),
        notes: plan.relationshipArc.notes,
      })
      const resistanceTrack = await window.electron.resistance.upsertTrack({
        novelId: createdNovelId,
        sourceType: 'character',
        sourceId: antagonistId,
        resistanceKind: 'antagonist',
        title: plan.resistanceTrack.title,
        goal: plan.resistanceTrack.goal,
        intelSource: plan.resistanceTrack.intelSource,
        resourcePool: plan.resistanceTrack.resourcePool,
        escalationPlan: plan.resistanceTrack.escalationPlan,
        heroKnowledgeShift: plan.resistanceTrack.heroKnowledgeShift,
        stageVictory: plan.resistanceTrack.stageVictory,
        counterMove: plan.resistanceTrack.counterMove,
        currentPressureMode: plan.resistanceTrack.currentPressureMode,
        currentStatus: 'active',
        lastActionChapterId: chapterIdByNum.get(1),
        nextEscalationChapterId: chapterIdByNum.get(2),
        linkedVolumeId: volumeId,
        notes: plan.resistanceTrack.notes,
      })

      if (typeof protagonistArc.id !== 'number' || typeof antagonistArc.id !== 'number' || typeof relationshipArc.id !== 'number' || typeof resistanceTrack.id !== 'number' || typeof threadId !== 'number') {
        throw new Error(getUserFacingMessage('novel.fastLaunchScaffoldReferenceFailed'))
      }

      await Promise.all([
        window.electron.characterArc.upsertCharacterArcBeat({
          novelId: createdNovelId,
          arcId: protagonistArc.id,
          beatType: 'start',
          chapterId: chapterIdByNum.get(1),
          timelineEventId: timelineIdsByChapterNum.get(1),
          title: '主角被迫进入主线',
          summary: protagonistArcPlan.changeEvent,
          status: 'planned',
          sortOrder: 1,
        }),
        window.electron.characterArc.upsertCharacterArcBeat({
          novelId: createdNovelId,
          arcId: antagonistArc.id,
          beatType: 'crack',
          chapterId: chapterIdByNum.get(1),
          timelineEventId: timelineIdsByChapterNum.get(1),
          title: '主要阻力开始升级',
          summary: antagonistArcPlan.changeEvent,
          status: 'planned',
          sortOrder: 1,
        }),
        window.electron.resistance.upsertBeat({
          novelId: createdNovelId,
          trackId: resistanceTrack.id,
          beatType: 'strike',
          chapterId: chapterIdByNum.get(1),
          timelineEventId: timelineIdsByChapterNum.get(1),
          title: '主要阻力第一次出手',
          summary: plan.resistanceTrack.counterMove,
          actionMode: plan.resistanceTrack.currentPressureMode,
          successLevel: '部分成功',
          counterResponse: '主角保住继续追查的资格，但失去一条安全退路。',
          protagonistImpact: '主角确认必须主动追查核心钩子。',
          status: 'logged',
          sortOrder: 1,
        }),
      ])

      for (const scene of plan.sceneContracts) {
        const chapterId = chapterIdByNum.get(scene.chapterNum)
        if (typeof chapterId !== 'number') throw new Error(`章节 ${scene.chapterNum} 不存在`)
        const existingSegments = await window.electron.structure.listSegments(chapterId)
        const segmentId = existingSegments[0]?.id || await window.electron.structure.createSegment(chapterId, {
          title: scene.segmentTitle,
          segmentType: 'scene',
          purpose: scene.purpose,
          timeAnchor: scene.timeLocation,
          locationName: '开篇主线现场',
          presentCharacterIdsJson: JSON.stringify([protagonistId, antagonistId]),
          inputState: scene.chapterNum === 1 ? '主角仍处在原有处境' : '承接上一章尚未解决的压力',
          outputState: scene.resultState,
          summary: scene.sceneGoal,
          status: 'planned',
        })
        if (existingSegments[0]?.id) {
          await window.electron.structure.updateSegment(segmentId, {
            title: scene.segmentTitle,
            segmentType: 'scene',
            purpose: scene.purpose,
            timeAnchor: scene.timeLocation,
            locationName: '开篇主线现场',
            presentCharacterIdsJson: JSON.stringify([protagonistId, antagonistId]),
            inputState: scene.chapterNum === 1 ? '主角仍处在原有处境' : '承接上一章尚未解决的压力',
            outputState: scene.resultState,
            summary: scene.sceneGoal,
            status: 'planned',
          })
        }
        await window.electron.contract.upsertScene(chapterId, segmentId, {
          pov: plan.protagonist.fullName,
          timeLocation: scene.timeLocation,
          sceneGoal: scene.sceneGoal,
          obstacle: scene.obstacle,
          conflictType: scene.conflictType,
          emotionShift: scene.emotionShift,
          resultState: scene.resultState,
          linkageMode: scene.linkageMode,
          status: 'ready',
        })
      }

      for (const contract of plan.chapterContracts) {
        const chapterId = chapterIdByNum.get(contract.chapterNum)
        if (typeof chapterId !== 'number') throw new Error(`章节 ${contract.chapterNum} 不存在`)
        await window.electron.contract.upsertChapter(chapterId, {
          chapterGoal: contract.chapterGoal,
          openingStyle: contract.openingStyle,
          endingStyle: contract.endingStyle,
          expositionMode: contract.expositionMode,
          emotionFocus: contract.emotionFocus,
          servedThreadIds: [threadId],
          requiredArcProgress: contract.requiredArcProgress,
          requiredCharacterArcIds: [protagonistArc.id, antagonistArc.id],
          requiredRelationshipArcIds: [relationshipArc.id],
          requiredResistanceTrackIds: [resistanceTrack.id],
          requiredResistanceActions: contract.requiredResistanceActions,
          requiredAssetRefs: [],
          requiredEndgameCommitmentIds: [],
          requiredForeshadowIds: [],
          hookType: contract.hookType,
          forbiddenActions: contract.forbiddenActions,
          acceptanceNotes: contract.acceptanceNotes,
          status: 'ready',
        })
      }

      bootstrapCompleted = true
      await loadNovels()
      resetWizard()
      navigate(buildWorkspaceRoute(createdNovelId, 'overview'))
      message.success(getUserFacingMessage('novel.fastLaunchCreated'))
    } catch (error) {
      console.error(error)
      if (createdNovelId !== null && !bootstrapCompleted) {
        try {
          await window.electron.novel.delete(createdNovelId)
        } catch (rollbackError) {
          console.error('Fast launch rollback failed', rollbackError)
          message.warning(getUserFacingMessage('novel.fastLaunchRollbackFailed'))
        }
      }
      message.error(getErrorMessage(error, 'novel.createFailed'))
    } finally {
      setWizardLoading(false)
    }
  }, [loadNovels, navigate, resetWizard, wizardForm])

  const handleExtractLaunchIdea = useCallback(async () => {
    const values = await wizardForm.validateFields(['genreId', 'launchIdea']).catch(() => null)
    if (!values) return
    const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
    const genreLabel = GENRE_OPTIONS.find((option) => option.value === values.genreId)?.label || '未分类'
    const idea = String(values.launchIdea || '').trim()
    if (!idea) return

    setLaunchIdeaParsing(true)
    setLaunchIdeaNote('')
    try {
      const outputs = await window.electron.ai.runPrompt({
        messages: buildLaunchIdeaMessages({ genre: genreLabel, idea }),
        count: 1,
        modelConfigId: allValues.modelConfigId,
      })
      const extracted = normalizeLaunchIdeaResult(parseDraftJson<LaunchIdeaExtractionResult>(outputs[0] || ''))
      const nextValues: Partial<WizardFormValues> = {
        launchIdeaTitle: extracted.title,
        launchIdeaSynopsis: extracted.synopsis,
      }
      ;(['protagonistStart', 'coreHook', 'coreConflict', 'tabooRules', 'endgameDirection'] as const).forEach((field) => {
        if (extracted[field]) nextValues[field] = extracted[field]
      })
      wizardForm.setFieldsValue(nextValues)
      setLaunchIdeaNote(extracted.missing.length > 0
        ? `已按原话提取。仍需你确认：${extracted.missing.join('、')}。`
        : '已按原话提取，请逐项复核后再创建；系统不会替你补写未知设定。')
      message.success(getUserFacingMessage('novel.launchIdeaExtracted'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'novel.launchIdeaExtractFailed'))
    } finally {
      setLaunchIdeaParsing(false)
    }
  }, [wizardForm])

  const handleWizardNext = async () => {
    if (selectedLaunchMode === 'fast_launch') {
      if (wizardStep === 0) {
        const values = await wizardForm.validateFields(['genreId', 'writingContractTags']).catch(() => null)
        if (!values) return
        setWizardStep(1)
        return
      }

      await handleFastLaunchCreate()
      return
    }

    if (wizardStep === 0) {
      const values = await wizardForm.validateFields(['genreId', 'writingContractTags']).catch(() => null)
      if (!values) return
      setWizardStep(1)
      return
    }

    if (wizardStep === 1) {
      const values = await wizardForm.validateFields(['userBackground']).catch(() => null)
      if (!values) return
      setWizardLoading(true)
      try {
        const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
        const data = await window.electron.ai.expandBackground({
          userBackground: values.userBackground,
          genreId: allValues.genreId,
          worldTemplateId: allValues.worldTemplateId,
          modelConfigId: allValues.modelConfigId,
        }) as ExpandBackgroundResult

        setExpandedData(data)
        wizardForm.setFieldsValue({
          expandedBackground: data.expanded_background,
          synopsis: data.synopsis,
          title: data.titles[0] || '',
        })
        setWizardStep(2)
      } catch (error) {
        console.error(error)
        message.error(getErrorMessage(error, 'novel.expandFailed'))
      } finally {
        setWizardLoading(false)
      }
      return
    }

    if (wizardStep === 2) {
      setWizardStep(3)
      return
    }

    const values = await wizardForm.validateFields(['title', 'synopsis', 'targetWords']).catch(() => null)
    if (!values) return
    const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
    const writingContractTags = normalizeWritingContractTags(allValues.writingContractTags)
    const writingContractError = getWritingContractValidationError(writingContractTags)
    if (writingContractError) {
      message.error(writingContractError)
      return
    }
    if (wizardLoading) return
    setWizardLoading(true)
    try {
      const novelId = await window.electron.novel.create({
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        genreId: allValues.genreId,
        launchMode: 'professional_longform',
        userBackground: allValues.userBackground?.trim(),
        expandedBackground: allValues.expandedBackground?.trim(),
        styleTemplateId: allValues.styleTemplateId,
        worldTemplateId: allValues.worldTemplateId,
        modelConfigId: allValues.modelConfigId,
        targetWords: values.targetWords,
      })
      if (writingContractTags.length > 0) {
        await window.electron.novel.update(novelId, {
          themeVoiceJson: buildThemeVoicePayload({ writingContractTags }),
        })
      }
      await loadNovels()
      resetWizard()
      navigate(buildWorkspaceRoute(novelId, 'overview'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'novel.createFailed'))
    } finally {
      setWizardLoading(false)
    }
  }

  const wizardSteps = useMemo(
    () => getWizardStepItems(selectedLaunchMode),
    [selectedLaunchMode],
  )
  const totalWordCount = useMemo(
    () => novels.reduce((sum, novel) => sum + normalizeTargetWords(novel.totalWords), 0),
    [novels],
  )
  const writingCount = useMemo(
    () => novels.filter((novel) => novel.status === 'writing').length,
    [novels],
  )
  const completedCount = useMemo(
    () => novels.filter((novel) => novel.status === 'completed').length,
    [novels],
  )
  return (
    <>
      <div className="novel-list-page">
        <div className="novel-list-page__shell">
          <div className="novel-list-page__header">
            <div className="novel-list-page__copy">
              <h1 className="novel-list-page__title">我的小说</h1>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>
              新建小说
            </Button>
          </div>

          <div className="novel-list-page__stats">
            {[
              { label: '项目总数', value: `${novels.length} 部` },
              { label: '写作中', value: `${writingCount} 部` },
              { label: '已完结', value: `${completedCount} 部` },
              { label: '累计字数', value: formatWordCount(totalWordCount) },
            ].map((item) => (
              <div key={item.label} className="novel-list-page__stat-card">
                <span className="novel-list-page__stat-label">{item.label}</span>
                <strong className="novel-list-page__stat-value">{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="novel-list-page__toolbar">
            <div className="novel-list-page__toolbar-field novel-list-page__toolbar-field--search">
              <Input
                prefix={<SearchOutlined />}
                placeholder="搜索小说、简介或题材"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                allowClear
              />
            </div>
            <div className="novel-list-page__toolbar-field novel-list-page__toolbar-field--status">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'draft', label: '草稿' },
                  { value: 'writing', label: '写作中' },
                  { value: 'completed', label: '已完成' },
                  { value: 'archived', label: '已归档' },
                ]}
              />
            </div>
            <div className="novel-list-page__toolbar-field novel-list-page__toolbar-field--sort">
              <Select
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: 'updatedAt', label: '最近修改' },
                  { value: 'totalWords', label: '按字数排序' },
                  { value: 'title', label: '按标题排序' },
                ]}
              />
            </div>
          </div>

          {loading ? (
            <Skeleton active paragraph={{ rows: 10 }} />
          ) : filteredNovels.length === 0 ? (
            <Empty
              className="novel-list-page__empty"
              description={search ? '没有找到匹配的小说。' : '还没有小说，点击“新建小说”开始创作。'}
            />
          ) : (
            <div className="novel-list-page__grid">
              {filteredNovels.map((novel) => {
                const snapshot = workspaceSnapshots[novel.id] || getWorkspaceSnapshot(novel, EMPTY_WORKFLOW_STATS, {
                  viewMode: novel.launchMode === 'fast_launch' ? 'quick' : 'professional',
                })
                return (
                  <ProjectCard
                    key={novel.id}
                    novel={novel}
                    snapshot={snapshot}
                    onOpen={() => navigate(buildWorkspaceRoute(novel.id, snapshot.nextStep.targetPage))}
                    onDelete={() => void handleDelete(novel.id, novel.title)}
                    onExport={(format) => void handleExport(novel.id, format)}
                    onStatusChange={(status) => void handleStatusChange(novel.id, status)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        title="新建小说"
        open={wizardOpen}
        onCancel={resetWizard}
        footer={null}
        width={940}
        className="novel-list-page__wizard-modal"
        forceRender
        destroyOnHidden
      >
        <div className="novel-list-page__wizard-layout">
          <Steps
            current={wizardStep}
            items={wizardSteps}
            className="novel-list-page__wizard-steps"
          />

          <div className="novel-list-page__wizard-scroll">
            <Form form={wizardForm} layout="vertical">
          {wizardStep === 0 && (
            <>
              <Form.Item
                name="launchMode"
                hidden
                rules={[{ required: true, message: '请选择开书路径' }]}
              >
                <Input type="hidden" />
              </Form.Item>

              <Form.Item label="开书路径">
                <div className="novel-list-page__launch-grid">
                  {NOVEL_LAUNCH_MODE_OPTIONS.map((option) => {
                    const active = selectedLaunchMode === option.value
                    return (
                      <button
                        type="button"
                        key={option.value}
                        onClick={() => {
                          setSelectedLaunchMode(option.value)
                          wizardForm.setFieldValue('launchMode', option.value)
                        }}
                        aria-pressed={active}
                        className={`novel-list-page__launch-card${active ? ' is-active' : ''}`}
                      >
                        <div className="novel-list-page__launch-card-head">
                            <strong className="novel-list-page__launch-card-title">{option.label}</strong>
                            <Tag color={active ? 'processing' : 'default'}>{option.badge}</Tag>
                        </div>
                        <span className="novel-list-page__launch-card-copy">{option.description}</span>
                      </button>
                    )
                  })}
                </div>
              </Form.Item>

              <Form.Item
                name="genreId"
                hidden
                rules={[{ required: true, message: '请选择题材' }]}
              >
                <Input type="hidden" />
              </Form.Item>
              <Form.Item name="launchIdeaTitle" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="launchIdeaSynopsis" hidden>
                <Input />
              </Form.Item>

              <Form.Item label="选择题材">
                <div>
                  <div className="novel-list-page__genre-grid">
                    {GENRE_OPTIONS.map((genre) => {
                      const isSelected = selectedGenreId === genre.value

                      return (
                        <button
                          type="button"
                          key={genre.value}
                          onClick={() => {
                            setSelectedGenreId(genre.value)
                            wizardForm.setFieldValue('genreId', genre.value)
                          }}
                          aria-pressed={isSelected}
                          className={`novel-list-page__genre-card${isSelected ? ' is-selected' : ''}`}
                          data-genre={genre.label}
                        >
                          {isSelected ? <CheckOutlined className="novel-list-page__genre-check" /> : null}
                          <div className="novel-list-page__genre-title">{genre.label}</div>
                          <div className="novel-list-page__genre-copy">{genre.description}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </Form.Item>

              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item name="styleTemplateId" label="文风模板">
                    <Select
                      options={styleTemplates.map((template) => ({ value: template.id, label: template.name }))}
                      placeholder="可选"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="worldTemplateId" label="世界模板">
                    <Select
                      options={worldTemplates.map((template) => ({ value: template.id, label: template.name }))}
                      placeholder="可选"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="modelConfigId" label="使用模型">
                    <Select
                      options={modelConfigs.map((model) => ({ value: model.id, label: model.name }))}
                      placeholder="默认模型"
                      allowClear
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="writingContractTags"
                label="写作类型"
                rules={[{
                  validator: async (_, value?: string[]) => {
                    const error = getWritingContractValidationError(normalizeWritingContractTags(value))
                    if (error) throw new Error(error)
                  },
                }]}
              >
                <Select
                  mode="tags"
                  allowClear
                  options={WRITING_CONTRACT_PRESETS.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                  }))}
                  placeholder="例如：爽文、言情，或补充自定义短标签"
                  tokenSeparators={[',', '，', '、']}
                />
              </Form.Item>
            </>
          )}

          {selectedLaunchMode === 'professional_longform' && wizardStep === 1 && (
            <Form.Item
              name="userBackground"
              label="故事背景"
              rules={[
                { required: true, message: '请输入故事背景' },
                { min: 20, message: '至少写 20 个字' },
              ]}
            >
              <Input.TextArea
                autoSize={STORY_TEXTAREA_AUTO_SIZE}
                className="novel-list-page__textarea novel-list-page__textarea--story"
                placeholder="例如：一座沿海城市的冷案记者，意外卷入二十年前的沉船旧案，发现幸存者名单里藏着她父亲失踪的线索。"
                showCount
              />
            </Form.Item>
          )}

          {selectedLaunchMode === 'fast_launch' && wizardStep === 1 && (
            <>
              <Form.Item
                name="launchIdea"
                label="灵感描述（可选）"
                rules={[{ min: 20, message: '灵感描述至少写 20 个字，或直接填写下方字段。' }]}
              >
                <Input.TextArea
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  className="novel-list-page__textarea novel-list-page__textarea--idea"
                  placeholder="例如：我想写一个在县城殡仪馆值夜班的女孩。她发现每天凌晨送来的遗体都少一根手指，直到有一天送来的是她还活着的弟弟……"
                  showCount
                />
              </Form.Item>
              <div className="novel-list-page__idea-actions">
                <Button
                  type="default"
                  loading={launchIdeaParsing}
                  onClick={handleExtractLaunchIdea}
                >
                  AI 整理成开书卡
                </Button>
                {launchIdeaNote ? <span>{launchIdeaNote}</span> : null}
              </div>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="protagonistStart"
                    label="主角起点"
                    rules={[{ required: true, message: '请填写主角起点' }]}
                  >
                    <Input.TextArea
                      autoSize={FAST_TEXTAREA_AUTO_SIZE}
                      className="novel-list-page__textarea novel-list-page__textarea--fast"
                      placeholder="例如：被逐出主城的维修员，只能靠黑市零工维生。"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="coreHook"
                    label="核心钩子"
                    rules={[{ required: true, message: '请填写核心钩子' }]}
                  >
                    <Input.TextArea
                      autoSize={FAST_TEXTAREA_AUTO_SIZE}
                      className="novel-list-page__textarea novel-list-page__textarea--fast"
                      placeholder="例如：他修复的一枚芯片里，藏着主城即将熄火的真相。"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="coreConflict"
                    label="核心冲突"
                    rules={[{ required: true, message: '请填写核心冲突' }]}
                  >
                    <Input.TextArea
                      autoSize={FAST_TEXTAREA_AUTO_SIZE}
                      className="novel-list-page__textarea novel-list-page__textarea--fast"
                      placeholder="例如：想救城就必须和曾经出卖他的旧同伴合作。 "
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="tabooRules"
                    label="禁区"
                    rules={[{ required: true, message: '请填写禁区' }]}
                  >
                    <Input.TextArea
                      autoSize={FAST_TEXTAREA_AUTO_SIZE}
                      className="novel-list-page__textarea novel-list-page__textarea--fast"
                      placeholder="例如：禁止全知旁白解释；禁止一章解决主线；禁止爽点无代价。"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="endgameDirection"
                label="终局方向"
                rules={[{ required: true, message: '请填写终局方向' }]}
              >
                <Input.TextArea
                  autoSize={FAST_TEXTAREA_AUTO_SIZE}
                  className="novel-list-page__textarea novel-list-page__textarea--fast"
                  placeholder="例如：主角救下主城，但必须放弃原本想夺回的身份和归属。"
                />
              </Form.Item>
            </>
          )}

          {selectedLaunchMode === 'professional_longform' && wizardStep === 2 && (
            <div className="novel-list-page__expanded-layout">
              <div className="novel-list-page__expanded-main">
                <Form.Item name="expandedBackground" label="AI 补全背景（可编辑）">
                  <Input.TextArea
                    autoSize={EXPANDED_TEXTAREA_AUTO_SIZE}
                    className="novel-list-page__textarea novel-list-page__textarea--expanded"
                    placeholder="这里会生成扩写后的背景。重点检查世界规则、冲突主线、人物动机和不该出现的泛化陈词。"
                  />
                </Form.Item>
              </div>
              <div className="novel-list-page__expanded-side">
                <div className="novel-list-page__side-caption">标题建议</div>
                <Form.Item name="title">
                  <Radio.Group className="novel-list-page__title-radio-group">
                    {expandedData?.titles.map((title) => (
                      <Radio key={title} value={title} className="novel-list-page__title-radio">
                        {title}
                      </Radio>
                    ))}
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="synopsis" label="AI 生成·简介（可编辑）">
                  <Input.TextArea
                    autoSize={SYNOPSIS_TEXTAREA_AUTO_SIZE}
                    className="novel-list-page__textarea novel-list-page__textarea--synopsis"
                    placeholder="把简介改成一句话就能讲清主角、核心冲突和读者追更点。"
                  />
                </Form.Item>
                <Button
                  icon={<ReloadOutlined />}
                  loading={wizardLoading}
                  onClick={() => {
                    setWizardStep(1)
                    setExpandedData(null)
                  }}
                >
                  重新生成
                </Button>
              </div>
            </div>
          )}

          {selectedLaunchMode === 'professional_longform' && wizardStep === 3 && (
            <>
              <Form.Item name="title" label="最终标题" rules={[{ required: true, message: '请填写标题' }]}>
                <Input placeholder="例如：潮汐名单 / 灰港旧案 / 深海回声" />
              </Form.Item>
              <Form.Item name="synopsis" label="最终简介" rules={[{ required: true, message: '请填写简介' }]}>
                <Input.TextArea
                  autoSize={SYNOPSIS_TEXTAREA_AUTO_SIZE}
                  className="novel-list-page__textarea novel-list-page__textarea--synopsis"
                  placeholder="用 1-3 句话讲清主角是谁、现在被什么压住、故事真正的卖点是什么。"
                />
              </Form.Item>
              <Form.Item name="targetWords" label="目标字数" initialValue={200000}>
                <Select options={TARGET_WORDS_OPTIONS} />
              </Form.Item>
            </>
          )}
            </Form>
          </div>

          <div className="novel-list-page__wizard-footer">
            {wizardStep > 0 ? (
              <Button onClick={() => setWizardStep((step) => step - 1)}>上一步</Button>
            ) : null}
            <Button
              type="primary"
              onClick={() => void handleWizardNext()}
              loading={wizardLoading}
              icon={wizardLoading ? <LoadingOutlined /> : undefined}
            >
              {selectedLaunchMode === 'fast_launch'
                ? (wizardStep === wizardSteps.length - 1 ? '创建并生成骨架' : '下一步')
                : (wizardStep === 3 ? '创建小说' : wizardStep === 1 ? 'AI 补全背景' : '下一步')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
