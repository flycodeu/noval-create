import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Form, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import { SaveOutlined, EditOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { useNovelStore } from '../../../stores/novel.store'
import type {
  Chapter,
  CharacterArc,
  ChapterContractAsset,
  EndgameCommitment,
  ForeshadowLedgerEntry,
  ResistanceTrack,
  RelationshipArc,
  SceneContractAsset,
  StoryThread,
} from '../../../types'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceStepGuide,
} from '../components/WorkspaceShell'
import {
  buildDraftMessages,
  matchSelectionIdsByLabels,
  normalizeStringArray,
  parseDraftJson,
} from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import './index.css'

interface Props {
  novelId: number
}

interface ChapterContractFormValues {
  chapterGoal: string
  openingStyle: string
  endingStyle: string
  expositionMode: string
  emotionFocus: string
  servedThreadIds: number[]
  requiredArcProgressText: string
  requiredCharacterArcIds: number[]
  requiredRelationshipArcIds: number[]
  requiredResistanceTrackIds: number[]
  requiredResistanceActionsText: string
  requiredAssetRefsText: string
  requiredEndgameCommitmentIds: number[]
  requiredForeshadowIds: number[]
  hookType: string
  forbiddenActionsText: string
  acceptanceNotesText: string
  status: string
}

const OPENING_STYLE_OPTIONS = [
  { value: 'hook', label: '钩子直入' },
  { value: 'daily', label: '日常切入' },
  { value: 'incident', label: '事件起手' },
  { value: 'flashback', label: '倒叙开场' },
]

const ENDING_STYLE_OPTIONS = [
  { value: 'hook', label: '留钩未完' },
  { value: 'reversal', label: '反转截断' },
  { value: 'aftershock', label: '余波未平' },
  { value: 'stillness', label: '静止定格' },
  { value: 'arrival', label: '第三人入场' },
]

const EXPOSITION_MODE_OPTIONS = [
  { value: 'embedded_action', label: '动作带出' },
  { value: 'dialogue_reveal', label: '对白带出' },
  { value: 'experience_filter', label: '角色经历过滤' },
  { value: 'minimal', label: '只给必要说明' },
  { value: 'brief_direct', label: '允许短直述' },
]

function splitLines(value?: string): string[] {
  return (value || '')
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

function buildChapterFormValues(contract?: ChapterContractAsset | null): ChapterContractFormValues {
  return {
    chapterGoal: contract?.chapterGoal || '',
    openingStyle: contract?.openingStyle || '',
    endingStyle: contract?.endingStyle || '',
    expositionMode: contract?.expositionMode || '',
    emotionFocus: contract?.emotionFocus || '',
    servedThreadIds: contract?.servedThreadIds || [],
    requiredArcProgressText: (contract?.requiredArcProgress || []).join('\n'),
    requiredCharacterArcIds: contract?.requiredCharacterArcIds || [],
    requiredRelationshipArcIds: contract?.requiredRelationshipArcIds || [],
    requiredResistanceTrackIds: contract?.requiredResistanceTrackIds || [],
    requiredResistanceActionsText: (contract?.requiredResistanceActions || []).join('\n'),
    requiredAssetRefsText: (contract?.requiredAssetRefs || []).join('\n'),
    requiredEndgameCommitmentIds: contract?.requiredEndgameCommitmentIds || [],
    requiredForeshadowIds: contract?.requiredForeshadowIds || [],
    hookType: contract?.hookType || '',
    forbiddenActionsText: (contract?.forbiddenActions || []).join('\n'),
    acceptanceNotesText: (contract?.acceptanceNotes || []).join('\n'),
    status: contract?.status || 'draft',
  }
}

export default function ContractsPage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<ChapterContractFormValues>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingChapter, setSavingChapter] = useState(false)
  const [sceneSavingId, setSceneSavingId] = useState<number | 'chapterless' | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [threads, setThreads] = useState<StoryThread[]>([])
  const [characterArcs, setCharacterArcs] = useState<CharacterArc[]>([])
  const [relationshipArcs, setRelationshipArcs] = useState<RelationshipArc[]>([])
  const [resistanceTracks, setResistanceTracks] = useState<ResistanceTrack[]>([])
  const [commitments, setCommitments] = useState<EndgameCommitment[]>([])
  const [foreshadows, setForeshadows] = useState<ForeshadowLedgerEntry[]>([])
  const [chapterContract, setChapterContract] = useState<ChapterContractAsset | null>(null)
  const [sceneContracts, setSceneContracts] = useState<SceneContractAsset[]>([])
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null)
  const [progressModalOpen, setProgressModalOpen] = useState(false)
  const [progressMode, setProgressMode] = useState<'character' | 'relationship' | 'resistance'>('character')
  const [progressTargetId, setProgressTargetId] = useState<number | null>(null)
  const [progressNote, setProgressNote] = useState('')
  const [progressSaving, setProgressSaving] = useState(false)
  const baseRequestRef = useRef(0)
  const chapterRequestRef = useRef(0)
  const routeChapterId = useMemo(() => {
    const parsed = Number(searchParams.get('chapterId'))
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }, [searchParams])

  const loadBaseData = useCallback(async () => {
    const requestId = ++baseRequestRef.current
    const [chapterRows, threadRows, characterArcRows, relationshipArcRows, commitmentRows, foreshadowRows, resistanceDashboard] = await Promise.all([
      window.electron.chapter.list(novelId),
      window.electron.thread.list(novelId),
      window.electron.characterArc.listCharacterArcs(novelId),
      window.electron.characterArc.listRelationshipArcs(novelId),
      window.electron.endgameAsset.listCommitments(novelId),
      window.electron.foreshadow.listLedger(novelId),
      window.electron.resistance.getDashboard(novelId),
    ])
    if (baseRequestRef.current !== requestId) return
    setChapters(chapterRows)
    setThreads(threadRows)
    setCharacterArcs(characterArcRows)
    setRelationshipArcs(relationshipArcRows)
    setResistanceTracks(resistanceDashboard.tracks)
    setCommitments(commitmentRows.filter((item) => item.derivedStatus !== 'waived'))
    setForeshadows(foreshadowRows)
    setActiveChapterId((current) => {
      const routeTarget = chapterRows.find((item) => item.id === routeChapterId)?.id
      if (routeTarget) return routeTarget
      if (current && chapterRows.some((item) => item.id === current)) return current
      return chapterRows[0]?.id ?? null
    })
  }, [novelId, routeChapterId])

  const loadChapterData = useCallback(async (chapterId: number) => {
    const requestId = ++chapterRequestRef.current
    const [contract, scenes] = await Promise.all([
      window.electron.contract.getChapter(chapterId),
      window.electron.contract.listScenes(chapterId),
    ])
    if (chapterRequestRef.current !== requestId) return
    setChapterContract(contract)
    setSceneContracts(scenes)
    form.setFieldsValue(buildChapterFormValues(contract))
  }, [form])

  const refreshAll = useCallback(async (showLoading = false) => {
    const requestId = baseRequestRef.current + 1
    if (showLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      await loadBaseData()
    } catch (error) {
      if (baseRequestRef.current === requestId) {
        console.error(error)
        message.error(getErrorMessage(error, 'common.loadFailed'))
      }
    } finally {
      if (baseRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [loadBaseData])

  useEffect(() => {
    void refreshAll(true)
  }, [refreshAll])

  useEffect(() => {
    if (!routeChapterId) return
    if (!chapters.some((item) => item.id === routeChapterId)) return
    if (activeChapterId === routeChapterId) return
    setActiveChapterId(routeChapterId)
  }, [activeChapterId, chapters, routeChapterId])

  useEffect(() => {
    if (!activeChapterId) {
      chapterRequestRef.current += 1
      setChapterContract(null)
      setSceneContracts([])
      form.resetFields()
      return
    }
    void loadChapterData(activeChapterId).catch((error: unknown) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [activeChapterId, form, loadChapterData])

  const activeChapter = useMemo(
    () => chapters.find((item) => item.id === activeChapterId) || null,
    [activeChapterId, chapters],
  )
  const handleChapterChange = useCallback((chapterId: number) => {
    setActiveChapterId(chapterId)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('chapterId', String(chapterId))
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])
  const watchedContractValues = Form.useWatch([], form) as Partial<ChapterContractFormValues> | undefined
  const contractValues = useMemo<Partial<ChapterContractFormValues>>(
    () => watchedContractValues ?? {},
    [watchedContractValues],
  )
  const currentContractValues = useMemo<ChapterContractFormValues>(() => ({
    ...buildChapterFormValues(chapterContract),
    ...contractValues,
    servedThreadIds: contractValues.servedThreadIds ?? chapterContract?.servedThreadIds ?? [],
    requiredCharacterArcIds: contractValues.requiredCharacterArcIds ?? chapterContract?.requiredCharacterArcIds ?? [],
    requiredRelationshipArcIds: contractValues.requiredRelationshipArcIds ?? chapterContract?.requiredRelationshipArcIds ?? [],
    requiredResistanceTrackIds: contractValues.requiredResistanceTrackIds ?? chapterContract?.requiredResistanceTrackIds ?? [],
    requiredEndgameCommitmentIds: contractValues.requiredEndgameCommitmentIds ?? chapterContract?.requiredEndgameCommitmentIds ?? [],
    requiredForeshadowIds: contractValues.requiredForeshadowIds ?? chapterContract?.requiredForeshadowIds ?? [],
    requiredArcProgressText: contractValues.requiredArcProgressText ?? (chapterContract?.requiredArcProgress || []).join('\n'),
    requiredResistanceActionsText: contractValues.requiredResistanceActionsText ?? (chapterContract?.requiredResistanceActions || []).join('\n'),
    requiredAssetRefsText: contractValues.requiredAssetRefsText ?? (chapterContract?.requiredAssetRefs || []).join('\n'),
    forbiddenActionsText: contractValues.forbiddenActionsText ?? (chapterContract?.forbiddenActions || []).join('\n'),
    acceptanceNotesText: contractValues.acceptanceNotesText ?? (chapterContract?.acceptanceNotes || []).join('\n'),
    status: contractValues.status ?? chapterContract?.status ?? 'draft',
  }), [chapterContract, contractValues])
  const threadOptions = useMemo(() => threads.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, item.summary || '', item.premise || ''],
  })), [threads])
  const characterArcOptions = useMemo(() => characterArcs.map((item) => ({
    id: item.id,
    label: `${item.characterName} · ${item.changeEvent || item.surfaceWant || item.deepNeed || '人物弧'}`,
    aliases: [item.characterName, item.changeEvent || '', item.surfaceWant || '', item.deepNeed || ''],
  })), [characterArcs])
  const relationshipArcOptions = useMemo(() => relationshipArcs.map((item) => ({
    id: item.id,
    label: `${item.charAName} × ${item.charBName}`,
    aliases: [
      `${item.charAName}×${item.charBName}`,
      `${item.charAName} ${item.charBName}`,
      item.changeEvent || '',
      item.relationLabelSnapshot || '',
    ],
  })), [relationshipArcs])
  const resistanceTrackOptions = useMemo(() => resistanceTracks.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, item.sourceName, item.currentPressureMode || ''],
  })), [resistanceTracks])
  const commitmentOptions = useMemo(() => commitments.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, `${item.commitmentKind === 'payoff' ? '回收' : '承诺'}${item.title}`],
  })), [commitments])
  const foreshadowOptions = useMemo(() => foreshadows.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, item.payoffSceneAction || '', item.requiredEvidence || ''],
  })), [foreshadows])

  const handleSaveChapterContract = async () => {
    if (!activeChapterId) return
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSavingChapter(true)
    try {
      const result = await window.electron.contract.upsertChapter(activeChapterId, {
        chapterGoal: values.chapterGoal,
        openingStyle: values.openingStyle,
        endingStyle: values.endingStyle,
        expositionMode: values.expositionMode,
        emotionFocus: values.emotionFocus,
        servedThreadIds: values.servedThreadIds,
        requiredArcProgress: splitLines(values.requiredArcProgressText),
        requiredCharacterArcIds: values.requiredCharacterArcIds,
        requiredRelationshipArcIds: values.requiredRelationshipArcIds,
        requiredResistanceTrackIds: values.requiredResistanceTrackIds,
        requiredResistanceActions: splitLines(values.requiredResistanceActionsText),
        requiredAssetRefs: splitLines(values.requiredAssetRefsText),
        requiredEndgameCommitmentIds: values.requiredEndgameCommitmentIds,
        requiredForeshadowIds: values.requiredForeshadowIds,
        hookType: values.hookType,
        forbiddenActions: splitLines(values.forbiddenActionsText),
        acceptanceNotes: splitLines(values.acceptanceNotesText),
        status: values.status,
      })
      setChapterContract(result)
      message.success(getUserFacingMessage('contracts.chapterSaved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSavingChapter(false)
    }
  }

  const openProgressModal = (mode: 'character' | 'relationship' | 'resistance', targetId: number, defaultNote: string) => {
    setProgressMode(mode)
    setProgressTargetId(targetId)
    setProgressNote(defaultNote)
    setProgressModalOpen(true)
  }

  const handleRecordProgress = async () => {
    if (!activeChapter || !progressTargetId) return
    setProgressSaving(true)
    try {
      if (progressMode === 'character') {
        await window.electron.characterArc.upsertCharacterArcBeat({
          novelId,
          arcId: progressTargetId,
          chapterId: activeChapter.id,
          beatType: 'progress-note',
          title: `第${activeChapter.chapterNum}章推进`,
          summary: progressNote,
          status: 'logged',
        })
      } else if (progressMode === 'resistance') {
        await window.electron.resistance.upsertBeat({
          novelId,
          trackId: progressTargetId,
          chapterId: activeChapter.id,
          beatType: 'status-note',
          title: `第${activeChapter.chapterNum}章阻力推进`,
          summary: progressNote,
          actionMode: progressNote,
          status: 'logged',
        })
      } else {
        const current = relationshipArcs.find((item) => item.id === progressTargetId)
        if (!current) throw new Error(getUserFacingMessage('contracts.relationshipArcNotFound'))
        await window.electron.characterArc.upsertRelationshipArc({
          id: current.id,
          novelId,
          charAId: current.charAId,
          charBId: current.charBId,
          relationLabelSnapshot: current.relationLabelSnapshot,
          relationTypeSnapshot: current.relationTypeSnapshot,
          startState: current.startState,
          crackPoint: current.crackPoint,
          changeEvent: progressNote || current.changeEvent,
          changeTimelineEventId: current.changeTimelineEventId,
          endState: current.endState,
          currentStatus: current.currentStatus === 'completed' ? 'completed' : 'active',
          lastProgressChapterId: activeChapter.id,
          stalledReason: current.stalledReason,
          notes: current.notes,
        })
      }
      message.success(getUserFacingMessage('contracts.progressSaved'))
      setProgressModalOpen(false)
      setProgressTargetId(null)
      setProgressNote('')
      await refreshAll()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setProgressSaving(false)
    }
  }

  const handleSceneChange = (
    sceneId: number | undefined,
    patch: Partial<SceneContractAsset>,
  ) => {
    setSceneContracts((current) => current.map((item) => (
      item.segmentId === sceneId
        ? { ...item, ...patch }
        : item
    )))
  }

  const handleSaveScene = async (scene: SceneContractAsset) => {
    if (!activeChapterId) return
    setSceneSavingId(scene.segmentId ?? 'chapterless')
    try {
      const result = await window.electron.contract.upsertScene(activeChapterId, scene.segmentId ?? null, {
        pov: scene.pov,
        timeLocation: scene.timeLocation,
        sceneGoal: scene.sceneGoal,
        obstacle: scene.obstacle,
        conflictType: scene.conflictType,
        emotionShift: scene.emotionShift,
        revealPayload: scene.revealPayload,
        resultState: scene.resultState,
        linkageMode: scene.linkageMode,
        requiredEndgameCommitmentIds: scene.requiredEndgameCommitmentIds,
        requiredForeshadowIds: scene.requiredForeshadowIds,
        status: scene.status,
      })
      setSceneContracts(result)
      message.success(getUserFacingMessage('contracts.sceneSaved', {
        segmentLabel: scene.segmentOrder ? ` · 场景 ${scene.segmentOrder}` : '',
      }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSceneSavingId(null)
    }
  }

  if (loading && chapters.length === 0) {
    return (
      <WorkspacePage title="章节合同与场景合同">
        <WorkspacePanel title="正在加载合同数据">
          <Spin />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      eyebrow="章节合同 / 场景合同"
      title="章节合同与场景合同"
      description="把大纲前的约束变成显式合同，让写作链路优先遵守本章目标、终局承诺和场景限制。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={savingChapter} onClick={() => void handleSaveChapterContract()}>
            保存章节合同
          </Button>
          <Button loading={refreshing} onClick={() => void refreshAll()}>
            刷新合同
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/writing`)}>
            去正文写作
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '章节数', value: chapters.length > 0 ? `${chapters.length} 章` : '未建章' },
            { label: '终局承诺', value: commitments.length > 0 ? `${commitments.length} 条` : '未同步' },
            { label: '伏笔账本', value: foreshadows.length > 0 ? `${foreshadows.length} 条` : '未建立' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="当前章节" value={activeChapter ? `第${activeChapter.chapterNum}章` : '未选择'} tone="warm" />
          <WorkspaceMetric label="场景合同数" value={sceneContracts.length} />
          <WorkspaceMetric label="章节绑定终局项" value={chapterContract?.requiredEndgameCommitmentIds.length || 0} tone="cool" />
          <WorkspaceMetric label="章节绑定推进线" value={(chapterContract?.requiredCharacterArcIds.length || 0) + (chapterContract?.requiredRelationshipArcIds.length || 0) + (chapterContract?.requiredResistanceTrackIds.length || 0)} />
        </>
      )}
      guide={(
        <WorkspaceStepGuide
          steps={[
            { title: '先定本章目标', description: '先把本章目标、禁止事项和验收要求写清。', status: 'focus' },
            { title: '绑定终局与伏笔', description: '直接选择本章必须服务的终局承诺和伏笔账本条目。', status: 'todo' },
            { title: '逐场景拆合同', description: '每个场景至少锁 POV、目标、障碍和结果状态。', status: 'todo' },
          ]}
        />
      )}
    >
      {refreshing ? <div className="novel-dashboard__refresh-indicator novel-workspace__refresh"><Spin size="small" /><span>正在同步合同面板数据</span></div> : null}
      {commitments.length <= 0 ? (
        <Alert
          type="warning"
          showIcon
          message="终局承诺还没同步"
          description="先去终局设计保存并同步承诺，否则章节合同无法直接绑定终局约束。"
        />
      ) : null}

      <WorkspacePanel title="章节选择" description="合同按章维护。写作前先把当前章的显式约束补齐。">
        <Select
          value={activeChapterId ?? undefined}
          onChange={handleChapterChange}
          className="novel-contracts-page__chapter-select"
          options={chapters.map((item) => ({
            value: item.id,
            label: `第${item.chapterNum}章 ${item.title || ''}`.trim(),
          }))}
          placeholder="选择章节"
        />
      </WorkspacePanel>

      <WorkspacePanel
        title="章节合同"
        description="本章必须完成什么、不能做什么、验收时要看什么。"
        extra={(
          <AIGenerateButton
            novelId={novelId}
            label="AI 生成·章节合同"
            intent={hasFilledValues([
              currentContractValues.chapterGoal,
              currentContractValues.emotionFocus,
              currentContractValues.requiredArcProgressText,
              currentContractValues.requiredResistanceActionsText,
              currentContractValues.requiredAssetRefsText,
              currentContractValues.forbiddenActionsText,
              currentContractValues.acceptanceNotesText,
            ]) ? 'complete' : 'generate'}
            isJson
            disabled={!activeChapter}
            buildMessages={() => buildDraftMessages({
              task: activeChapter ? `章节合同 · 第${activeChapter.chapterNum}章 ${activeChapter.title || ''}`.trim() : '章节合同',
              mode: hasFilledValues([
                currentContractValues.chapterGoal,
                currentContractValues.emotionFocus,
                currentContractValues.requiredArcProgressText,
                currentContractValues.requiredResistanceActionsText,
                currentContractValues.requiredAssetRefsText,
                currentContractValues.forbiddenActionsText,
                currentContractValues.acceptanceNotesText,
              ]) ? 'optimize' : 'replace',
              context: buildPlanningContextSections(currentNovel, {
                includeSubplots: true,
                extraSections: [
                  { label: '当前章节', value: activeChapter ? `第${activeChapter.chapterNum}章 ${activeChapter.title || ''}`.trim() : '' },
                  { label: '本章场景', value: sceneContracts.map((item) => item.segmentTitle) },
                  { label: '可选故事线程', value: threads.map((item) => item.title) },
                  { label: '可选终局承诺', value: commitments.map((item) => `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`) },
                  { label: '可选伏笔账本', value: foreshadows.map((item) => item.title) },
                ],
              }),
              fields: [
                { key: 'chapterGoal', label: '本章目标', value: currentContractValues.chapterGoal, hint: '写这一章必须拿到的推进结果。' },
                { key: 'openingStyle', label: '开场方式', value: currentContractValues.openingStyle, hint: '只用已有枚举语义，例如 hook、daily、incident、flashback。' },
                { key: 'endingStyle', label: '收尾方式', value: currentContractValues.endingStyle, hint: '只用已有枚举语义，例如 hook、reversal、aftershock、stillness、arrival。' },
                { key: 'expositionMode', label: '说明方式', value: currentContractValues.expositionMode, hint: '只用已有枚举语义，例如 embedded_action、dialogue_reveal、experience_filter、minimal、brief_direct。' },
                { key: 'emotionFocus', label: '情绪主基调', value: currentContractValues.emotionFocus, hint: '写清本章读感主基调。' },
                { key: 'hookType', label: '结尾钩子类型', value: currentContractValues.hookType, hint: '写结尾留钩的类型，不展开成整段剧情。' },
                { key: 'servedThreadTitles', label: '服务的故事线程标题', type: 'string[]', value: threads.filter((item) => currentContractValues.servedThreadIds.includes(item.id)).map((item) => item.title), hint: '只能从可选故事线程中选标题。' },
                { key: 'requiredArcProgress', label: '必须推进的弧线', type: 'string[]', value: splitLines(currentContractValues.requiredArcProgressText), hint: '每条都要能在正文里显式落地。' },
                { key: 'requiredCharacterArcTitles', label: '必须推进的人物弧标题', type: 'string[]', value: characterArcs.filter((item) => typeof item.id === 'number' && currentContractValues.requiredCharacterArcIds.includes(item.id)).map((item) => `${item.characterName} · ${item.changeEvent || item.surfaceWant || item.deepNeed || '人物弧'}`), hint: '只能从可选人物弧中选标题。' },
                { key: 'requiredRelationshipArcTitles', label: '必须推进的关系弧标题', type: 'string[]', value: relationshipArcs.filter((item) => typeof item.id === 'number' && currentContractValues.requiredRelationshipArcIds.includes(item.id)).map((item) => `${item.charAName} × ${item.charBName}`), hint: '只能从可选关系弧中选标题。' },
                { key: 'requiredResistanceTrackTitles', label: '必须出手的阻力线标题', type: 'string[]', value: resistanceTracks.filter((item) => typeof item.id === 'number' && currentContractValues.requiredResistanceTrackIds.includes(item.id)).map((item) => item.title), hint: '只能从可选阻力线中选标题。' },
                { key: 'requiredResistanceActions', label: '本章阻力应如何出手', type: 'string[]', value: splitLines(currentContractValues.requiredResistanceActionsText), hint: '每条都要写到行动层。' },
                { key: 'requiredAssetRefs', label: '必须出现的资产/线索', type: 'string[]', value: splitLines(currentContractValues.requiredAssetRefsText), hint: '建议每条都是正文里可见的资产、物件、证据或旧线索。' },
                { key: 'requiredEndgameCommitmentTitles', label: '必须服务的终局承诺标题', type: 'string[]', value: commitments.filter((item) => currentContractValues.requiredEndgameCommitmentIds.includes(item.id)).map((item) => item.title), hint: '只能从可选终局承诺中选标题。' },
                { key: 'requiredForeshadowTitles', label: '必须处理的伏笔标题', type: 'string[]', value: foreshadows.filter((item) => currentContractValues.requiredForeshadowIds.includes(item.id)).map((item) => item.title), hint: '只能从可选伏笔账本中选标题。' },
                { key: 'forbiddenActions', label: '本章禁止做什么', type: 'string[]', value: splitLines(currentContractValues.forbiddenActionsText), hint: '写禁止提前揭露、无代价脱困等违规动作。' },
                { key: 'acceptanceNotes', label: '章节验收要求', type: 'string[]', value: splitLines(currentContractValues.acceptanceNotesText), hint: '写清交付完成时必须被核对的条件。' },
              ],
              requirements: [
                '所有引用型字段必须引用当前已有线程、弧线、阻力、终局承诺或伏笔标题，不要虚构新资产。',
                '只生成当前章节合同，不替代场景合同详细拆解。',
              ],
            })}
            onResult={(raw) => {
              const draft = parseDraftJson<Record<string, unknown>>(raw)
              const nextValues: Partial<ChapterContractFormValues> = {}

              if (typeof draft.chapterGoal === 'string') nextValues.chapterGoal = draft.chapterGoal
              if (typeof draft.openingStyle === 'string') nextValues.openingStyle = draft.openingStyle
              if (typeof draft.endingStyle === 'string') nextValues.endingStyle = draft.endingStyle
              if (typeof draft.expositionMode === 'string') nextValues.expositionMode = draft.expositionMode
              if (typeof draft.emotionFocus === 'string') nextValues.emotionFocus = draft.emotionFocus
              if (typeof draft.hookType === 'string') nextValues.hookType = draft.hookType
              if (Object.prototype.hasOwnProperty.call(draft, 'servedThreadTitles')) {
                nextValues.servedThreadIds = matchSelectionIdsByLabels(draft.servedThreadTitles, threadOptions)
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredArcProgress')) {
                nextValues.requiredArcProgressText = normalizeStringArray(draft.requiredArcProgress).join('\n')
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredCharacterArcTitles')) {
                nextValues.requiredCharacterArcIds = matchSelectionIdsByLabels(draft.requiredCharacterArcTitles, characterArcOptions)
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredRelationshipArcTitles')) {
                nextValues.requiredRelationshipArcIds = matchSelectionIdsByLabels(draft.requiredRelationshipArcTitles, relationshipArcOptions)
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredResistanceTrackTitles')) {
                nextValues.requiredResistanceTrackIds = matchSelectionIdsByLabels(draft.requiredResistanceTrackTitles, resistanceTrackOptions)
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredResistanceActions')) {
                nextValues.requiredResistanceActionsText = normalizeStringArray(draft.requiredResistanceActions).join('\n')
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredAssetRefs')) {
                nextValues.requiredAssetRefsText = normalizeStringArray(draft.requiredAssetRefs).join('\n')
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredEndgameCommitmentTitles')) {
                nextValues.requiredEndgameCommitmentIds = matchSelectionIdsByLabels(draft.requiredEndgameCommitmentTitles, commitmentOptions)
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'requiredForeshadowTitles')) {
                nextValues.requiredForeshadowIds = matchSelectionIdsByLabels(draft.requiredForeshadowTitles, foreshadowOptions)
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'forbiddenActions')) {
                nextValues.forbiddenActionsText = normalizeStringArray(draft.forbiddenActions).join('\n')
              }
              if (Object.prototype.hasOwnProperty.call(draft, 'acceptanceNotes')) {
                nextValues.acceptanceNotesText = normalizeStringArray(draft.acceptanceNotes).join('\n')
              }

              form.setFieldsValue(nextValues)
            }}
          />
        )}
      >
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="chapterGoal" label="本章目标">
                <Input.TextArea rows={6} placeholder="写这一章写完后，主线、人物或局势必须发生什么变化。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="openingStyle" label="开场方式">
                <Select
                  allowClear
                  placeholder="选择本章起手方式"
                  options={OPENING_STYLE_OPTIONS}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="endingStyle" label="收尾方式">
                <Select
                  allowClear
                  placeholder="选择本章收尾形态"
                  options={ENDING_STYLE_OPTIONS}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="expositionMode" label="说明方式">
                <Select
                  allowClear
                  placeholder="选择设定/说明如何带出"
                  options={EXPOSITION_MODE_OPTIONS}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="emotionFocus" label="情绪主基调">
                <Input placeholder="例如：压抑警觉 / 克制悲伤 / 疲惫喘息 / 愤怒反打" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="servedThreadIds" label="服务的故事线程">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章直接推进的线程"
                  options={threads.map((item) => ({
                    value: item.id,
                    label: item.title,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="hookType" label="结尾钩子类型">
                <Input placeholder="例如：信息反转 / 危机升级 / 情绪留钩" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredArcProgressText" label="必须推进的弧线">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n主角第一次承认自身代价\n反派开始反向布局'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredCharacterArcIds" label="必须推进的人物弧">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须推进的角色弧"
                  options={characterArcs.map((item) => ({
                    value: item.id,
                    label: `${item.characterName} · ${item.currentStatus}${item.lastProgressChapterLabel ? ` · 最近 ${item.lastProgressChapterLabel}` : ''}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredRelationshipArcIds" label="必须推进的关系弧">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须推进的关系弧"
                  options={relationshipArcs.map((item) => ({
                    value: item.id,
                    label: `${item.charAName} × ${item.charBName}${item.lastProgressChapterLabel ? ` · 最近 ${item.lastProgressChapterLabel}` : ''}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredResistanceTrackIds" label="必须出手的阻力线">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须发生动作的阻力来源"
                  options={resistanceTracks.map((item) => ({
                    value: item.id,
                    label: `${item.title} · ${item.sourceName}${item.lastActionChapterLabel ? ` · 最近 ${item.lastActionChapterLabel}` : ''}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredResistanceActionsText" label="本章阻力应如何出手">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n人物反派先试探再加码\n环境阻力逼主角付出时间成本'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredAssetRefsText" label="必须出现的资产 / 线索">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n旧城通行证\n失灵通讯器\n第八章留下的血迹'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredEndgameCommitmentIds" label="必须服务的终局承诺">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须服务的终局承诺"
                  options={commitments.map((item) => ({
                    value: item.id,
                    label: `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredForeshadowIds" label="必须处理的伏笔账本">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须埋设或回收的伏笔"
                  options={foreshadows.map((item) => ({
                    value: item.id,
                    label: [
                      item.title,
                      item.payoffSceneAction ? `动作:${item.payoffSceneAction}` : '',
                      item.requiredEvidence ? `证据:${item.requiredEvidence}` : '',
                    ].filter(Boolean).join(' · '),
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="forbiddenActionsText" label="本章禁止做什么">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n不能提前揭穿幕后真相\n不能让主角无代价脱困'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="acceptanceNotesText" label="章节验收要求">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n结尾必须留下下一章的紧迫问题\n本章冲突必须真实付出代价'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="合同状态">
                <Select
                  options={[
                    { value: 'draft', label: '草稿' },
                    { value: 'ready', label: '可执行' },
                    { value: 'locked', label: '锁定' },
                  ]}
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      {activeChapter ? (
        <WorkspacePanel title="本章推进回写" description="写完一章后，在这里把实际推进回写到人物弧线、关系弧和阻力线。">
          <div className="novel-contracts-page__section-stack">
            {(chapterContract?.requiredCharacterArcIds || []).map((arcId) => {
              const arc = characterArcs.find((item) => item.id === arcId)
              if (!arc) return null
              return (
                <div key={`character-${arcId}`} className="novel-note-list__item">
                  <strong>{arc.characterName}</strong>
                  <div>{arc.lastProgressChapterLabel || '还没有推进记录'}</div>
                  <Button size="small" onClick={() => openProgressModal('character', arcId, arc.changeEvent || '')}>
                    登记本章推进
                  </Button>
                </div>
              )
            })}
            {(chapterContract?.requiredRelationshipArcIds || []).map((arcId) => {
              const arc = relationshipArcs.find((item) => item.id === arcId)
              if (!arc) return null
              return (
                <div key={`relationship-${arcId}`} className="novel-note-list__item">
                  <strong>{`${arc.charAName} × ${arc.charBName}`}</strong>
                  <div>{arc.lastProgressChapterLabel || '还没有推进记录'}</div>
                  <Button size="small" onClick={() => openProgressModal('relationship', arcId, arc.changeEvent || '')}>
                    登记本章推进
                  </Button>
                </div>
              )
            })}
            {(chapterContract?.requiredResistanceTrackIds || []).map((trackId) => {
              const track = resistanceTracks.find((item) => item.id === trackId)
              if (!track) return null
              return (
                <div key={`resistance-${trackId}`} className="novel-note-list__item">
                  <strong>{track.title}</strong>
                  <div>{track.lastActionChapterLabel || '还没有出手记录'}</div>
                  <Button size="small" onClick={() => openProgressModal('resistance', trackId, (chapterContract?.requiredResistanceActions || []).join('；') || track.currentPressureMode || '')}>
                    登记本章出手
                  </Button>
                </div>
              )
            })}
            {(
              (chapterContract?.requiredCharacterArcIds.length || 0)
              + (chapterContract?.requiredRelationshipArcIds.length || 0)
              + (chapterContract?.requiredResistanceTrackIds.length || 0)
            ) <= 0 ? (
              <Alert type="info" showIcon message="当前章节还没绑定推进目标" description="先在上面的章节合同里选择本章必须推进的人物弧、关系弧或阻力线。" />
            ) : null}
          </div>
        </WorkspacePanel>
      ) : null}

      <WorkspacePanel title="场景合同" description="按场景锁 POV、目标、障碍、揭示和结果状态。">
        {sceneContracts.length <= 0 ? (
          <Alert type="info" showIcon message="当前章节还没有场景" description="先在结构规划里拆好场景，再回来逐场景补合同。" />
        ) : (
          <div className="novel-contracts-page__section-stack">
            {sceneContracts.map((scene) => (
              <div
                key={scene.segmentId || scene.id || scene.segmentTitle}
                className="novel-contracts-page__scene-card"
              >
                <div className="novel-contracts-page__scene-head">
                  <div className="novel-contracts-page__scene-copy">
                    <strong>{scene.segmentTitle}</strong>
                    <span className="novel-contracts-page__scene-meta">
                      {`章节 ${scene.chapterNum}${typeof scene.segmentOrder === 'number' ? ` · 场景 ${scene.segmentOrder}` : ''}`}
                    </span>
                  </div>
                  <Space wrap>
                    <Tag color={scene.status === 'locked' ? 'green' : scene.status === 'ready' ? 'blue' : 'default'}>
                      {scene.status || 'draft'}
                    </Tag>
                    <AIGenerateButton
                      novelId={novelId}
                      label="AI 补全·当前场景"
                      intent={hasFilledValues([
                        scene.sceneGoal,
                        scene.obstacle,
                        scene.revealPayload.join('\n'),
                        scene.resultState,
                      ]) ? 'complete' : 'generate'}
                      isJson
                      buildMessages={() => buildDraftMessages({
                        task: `场景合同 · ${scene.segmentTitle}`,
                        mode: hasFilledValues([
                          scene.sceneGoal,
                          scene.obstacle,
                          scene.revealPayload.join('\n'),
                          scene.resultState,
                        ]) ? 'optimize' : 'replace',
                        context: buildPlanningContextSections(currentNovel, {
                          includeSubplots: true,
                          extraSections: [
                            { label: '当前章节合同', value: [
                              currentContractValues.chapterGoal ? `本章目标：${currentContractValues.chapterGoal}` : '',
                              currentContractValues.emotionFocus ? `情绪基调：${currentContractValues.emotionFocus}` : '',
                              currentContractValues.hookType ? `结尾钩子：${currentContractValues.hookType}` : '',
                              currentContractValues.requiredResistanceActionsText ? `阻力动作：${currentContractValues.requiredResistanceActionsText}` : '',
                              currentContractValues.requiredAssetRefsText ? `必出资产：${currentContractValues.requiredAssetRefsText}` : '',
                            ].filter(Boolean).join('\n') },
                            { label: '当前场景', value: `${scene.segmentTitle} · 章节 ${scene.chapterNum}${typeof scene.segmentOrder === 'number' ? ` · 场景 ${scene.segmentOrder}` : ''}` },
                            { label: '可选终局承诺', value: commitments.map((item) => `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`) },
                            { label: '可选伏笔账本', value: foreshadows.map((item) => item.title) },
                          ],
                        }),
                        fields: [
                          { key: 'pov', label: 'POV', value: scene.pov, hint: '写当前场景视角人物。' },
                          { key: 'timeLocation', label: '时间/地点', value: scene.timeLocation, hint: '写当前场景发生的时间与地点。' },
                          { key: 'sceneGoal', label: '场景目标', value: scene.sceneGoal, hint: '写这一场想拿到什么推进。' },
                          { key: 'obstacle', label: '障碍', value: scene.obstacle, hint: '写阻碍目标实现的具体压力。' },
                          { key: 'conflictType', label: '冲突类型', value: scene.conflictType, hint: '例如外部对撞、心理冲突、信息博弈。' },
                          { key: 'emotionShift', label: '情绪变化', value: scene.emotionShift, hint: '写清这一场的情绪路径。' },
                          { key: 'revealPayload', label: '信息揭示', type: 'string[]', value: scene.revealPayload, hint: '每行一条可见揭示。' },
                          { key: 'resultState', label: '结果状态', value: scene.resultState, hint: '写这一场结束后的局势状态。' },
                          { key: 'linkageMode', label: '衔接方式', value: scene.linkageMode, hint: '写与前后场的衔接模式。' },
                          { key: 'requiredEndgameCommitmentTitles', label: '终局承诺标题', type: 'string[]', value: commitments.filter((item) => scene.requiredEndgameCommitmentIds.includes(item.id)).map((item) => item.title), hint: '只能从可选终局承诺里选标题。' },
                          { key: 'requiredForeshadowTitles', label: '伏笔标题', type: 'string[]', value: foreshadows.filter((item) => scene.requiredForeshadowIds.includes(item.id)).map((item) => item.title), hint: '只能从可选伏笔账本里选标题。' },
                        ],
                        requirements: [
                          '只生成当前场景合同，不要把整章目标复制成多场景流水账。',
                          '所有引用型字段必须使用已有终局承诺和伏笔标题。',
                        ],
                      })}
                      onResult={(raw) => {
                        const draft = parseDraftJson<Record<string, unknown>>(raw)
                        handleSceneChange(scene.segmentId, {
                          pov: typeof draft.pov === 'string' ? draft.pov : scene.pov,
                          timeLocation: typeof draft.timeLocation === 'string' ? draft.timeLocation : scene.timeLocation,
                          sceneGoal: typeof draft.sceneGoal === 'string' ? draft.sceneGoal : scene.sceneGoal,
                          obstacle: typeof draft.obstacle === 'string' ? draft.obstacle : scene.obstacle,
                          conflictType: typeof draft.conflictType === 'string' ? draft.conflictType : scene.conflictType,
                          emotionShift: typeof draft.emotionShift === 'string' ? draft.emotionShift : scene.emotionShift,
                          revealPayload: Object.prototype.hasOwnProperty.call(draft, 'revealPayload') ? normalizeStringArray(draft.revealPayload) : scene.revealPayload,
                          resultState: typeof draft.resultState === 'string' ? draft.resultState : scene.resultState,
                          linkageMode: typeof draft.linkageMode === 'string' ? draft.linkageMode : scene.linkageMode,
                          requiredEndgameCommitmentIds: Object.prototype.hasOwnProperty.call(draft, 'requiredEndgameCommitmentTitles')
                            ? matchSelectionIdsByLabels(draft.requiredEndgameCommitmentTitles, commitmentOptions)
                            : scene.requiredEndgameCommitmentIds,
                          requiredForeshadowIds: Object.prototype.hasOwnProperty.call(draft, 'requiredForeshadowTitles')
                            ? matchSelectionIdsByLabels(draft.requiredForeshadowTitles, foreshadowOptions)
                            : scene.requiredForeshadowIds,
                        })
                      }}
                    />
                    <Button
                      type="primary"
                      size="small"
                      loading={sceneSavingId === (scene.segmentId ?? 'chapterless')}
                      onClick={() => void handleSaveScene(scene)}
                    >
                      保存场景合同
                    </Button>
                  </Space>
                </div>

                <div className="guided-step__field-grid">
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-contracts-page__field-label">POV</div>
                    <Input value={scene.pov} onChange={(event) => handleSceneChange(scene.segmentId, { pov: event.target.value })} placeholder="写当前场景视角人物" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-contracts-page__field-label">时间 / 地点</div>
                    <Input value={scene.timeLocation} onChange={(event) => handleSceneChange(scene.segmentId, { timeLocation: event.target.value })} placeholder="写当前场景的时间与地点" />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">场景目标</div>
                    <Input.TextArea rows={6} value={scene.sceneGoal} onChange={(event) => handleSceneChange(scene.segmentId, { sceneGoal: event.target.value })} placeholder="这一场要拿到什么、推进什么。" />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">障碍</div>
                    <Input.TextArea rows={6} value={scene.obstacle} onChange={(event) => handleSceneChange(scene.segmentId, { obstacle: event.target.value })} placeholder="阻碍当前场景目标实现的压力或代价。" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-contracts-page__field-label">冲突类型</div>
                    <Input value={scene.conflictType} onChange={(event) => handleSceneChange(scene.segmentId, { conflictType: event.target.value })} placeholder="外部对撞 / 心理冲突 / 信息博弈" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-contracts-page__field-label">情绪变化</div>
                    <Input value={scene.emotionShift} onChange={(event) => handleSceneChange(scene.segmentId, { emotionShift: event.target.value })} placeholder="紧绷 -> 失衡 -> 硬撑" />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">信息揭示</div>
                    <Input.TextArea
                      rows={6}
                      value={scene.revealPayload.join('\n')}
                      onChange={(event) => handleSceneChange(scene.segmentId, { revealPayload: splitLines(event.target.value) })}
                      placeholder={'建议每行一条，例如：\n反派提前知道路线\n旧伤不是意外造成'}
                    />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">结果状态</div>
                    <Input.TextArea rows={6} value={scene.resultState} onChange={(event) => handleSceneChange(scene.segmentId, { resultState: event.target.value })} placeholder="这一场结束后人物和局势处于什么状态。" />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">衔接方式</div>
                    <Input value={scene.linkageMode} onChange={(event) => handleSceneChange(scene.segmentId, { linkageMode: event.target.value })} placeholder="悬念续接 / 情绪余波 / 行动转场" />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">终局承诺绑定</div>
                    <Select
                      mode="multiple"
                      allowClear
                      value={scene.requiredEndgameCommitmentIds}
                      onChange={(value) => handleSceneChange(scene.segmentId, { requiredEndgameCommitmentIds: value })}
                      options={commitments.map((item) => ({
                        value: item.id,
                        label: `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`,
                      }))}
                    />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-contracts-page__field-label">伏笔账本绑定</div>
                    <Select
                      mode="multiple"
                      allowClear
                      value={scene.requiredForeshadowIds}
                      onChange={(value) => handleSceneChange(scene.segmentId, { requiredForeshadowIds: value })}
                      options={foreshadows.map((item) => ({
                        value: item.id,
                        label: [
                          item.title,
                          item.payoffSceneAction ? `动作:${item.payoffSceneAction}` : '',
                          item.requiredEvidence ? `证据:${item.requiredEvidence}` : '',
                        ].filter(Boolean).join(' · '),
                      }))}
                    />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-contracts-page__field-label">状态</div>
                    <Select
                      value={scene.status}
                      onChange={(value) => handleSceneChange(scene.segmentId, { status: value })}
                      options={[
                        { value: 'draft', label: '草稿' },
                        { value: 'ready', label: '可执行' },
                        { value: 'locked', label: '锁定' },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </WorkspacePanel>

      <Modal
        title={progressMode === 'resistance' ? '登记本章阻力出手' : '登记本章弧线推进'}
        open={progressModalOpen}
        onCancel={() => setProgressModalOpen(false)}
        onOk={() => void handleRecordProgress()}
        confirmLoading={progressSaving}
      >
        <Input.TextArea
          rows={5}
          value={progressNote}
          onChange={(event) => setProgressNote(event.target.value)}
          placeholder={progressMode === 'resistance' ? '写清这一章阻力是如何出手、是否得手、给主角造成了什么压力。' : '写清这一章实际让角色或关系发生了什么变化。'}
        />
      </Modal>
    </WorkspacePage>
  )
}
