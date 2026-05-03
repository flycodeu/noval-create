import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Form, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import { SaveOutlined, EditOutlined } from '@ant-design/icons'
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
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'

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
  const [searchParams] = useSearchParams()
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
  const routeChapterId = useMemo(() => {
    const parsed = Number(searchParams.get('chapterId'))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [searchParams])

  const loadBaseData = async () => {
    const [chapterRows, threadRows, characterArcRows, relationshipArcRows, commitmentRows, foreshadowRows, resistanceDashboard] = await Promise.all([
      window.electron.chapter.list(novelId),
      window.electron.thread.list(novelId),
      window.electron.characterArc.listCharacterArcs(novelId),
      window.electron.characterArc.listRelationshipArcs(novelId),
      window.electron.endgameAsset.listCommitments(novelId),
      window.electron.foreshadow.listLedger(novelId),
      window.electron.resistance.getDashboard(novelId),
    ])
    setChapters(chapterRows)
    setThreads(threadRows)
    setCharacterArcs(characterArcRows)
    setRelationshipArcs(relationshipArcRows)
    setResistanceTracks(resistanceDashboard.tracks)
    setCommitments(commitmentRows.filter((item) => item.derivedStatus !== 'waived'))
    setForeshadows(foreshadowRows)
    setActiveChapterId((current) => current ?? chapterRows.find((item) => item.id === routeChapterId)?.id ?? chapterRows[0]?.id ?? null)
  }

  const loadChapterData = async (chapterId: number) => {
    const [contract, scenes] = await Promise.all([
      window.electron.contract.getChapter(chapterId),
      window.electron.contract.listScenes(chapterId),
    ])
    setChapterContract(contract)
    setSceneContracts(scenes)
    form.setFieldsValue(buildChapterFormValues(contract))
  }

  const refreshAll = async (showLoading = false) => {
    if (showLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      await loadBaseData()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshAll(true)
  }, [novelId])

  useEffect(() => {
    if (!routeChapterId) return
    if (!chapters.some((item) => item.id === routeChapterId)) return
    if (activeChapterId === routeChapterId) return
    setActiveChapterId(routeChapterId)
  }, [activeChapterId, chapters, routeChapterId])

  useEffect(() => {
    if (!activeChapterId) return
    void loadChapterData(activeChapterId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [activeChapterId])

  const activeChapter = useMemo(
    () => chapters.find((item) => item.id === activeChapterId) || null,
    [activeChapterId, chapters],
  )

  const handleSaveChapterContract = async () => {
    if (!activeChapterId) return
    const values = await form.validateFields()
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
      {refreshing ? <div className="novel-dashboard__refresh-indicator" style={{ marginBottom: 16 }}><Spin size="small" /><span>正在同步合同面板数据</span></div> : null}
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
          onChange={(value) => setActiveChapterId(value)}
          style={{ minWidth: 320 }}
          options={chapters.map((item) => ({
            value: item.id,
            label: `第${item.chapterNum}章 ${item.title || ''}`.trim(),
          }))}
          placeholder="选择章节"
        />
      </WorkspacePanel>

      <WorkspacePanel title="章节合同" description="本章必须完成什么、不能做什么、验收时要看什么。">
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
          <div style={{ display: 'grid', gap: 12 }}>
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
          <div style={{ display: 'grid', gap: 12 }}>
            {sceneContracts.map((scene) => (
              <div
                key={scene.segmentId || scene.id || scene.segmentTitle}
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  padding: 16,
                  display: 'grid',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong>{scene.segmentTitle}</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {`章节 ${scene.chapterNum}${typeof scene.segmentOrder === 'number' ? ` · 场景 ${scene.segmentOrder}` : ''}`}
                    </span>
                  </div>
                  <Space wrap>
                    <Tag color={scene.status === 'locked' ? 'green' : scene.status === 'ready' ? 'blue' : 'default'}>
                      {scene.status || 'draft'}
                    </Tag>
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
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>POV</div>
                    <Input value={scene.pov} onChange={(event) => handleSceneChange(scene.segmentId, { pov: event.target.value })} placeholder="写当前场景视角人物" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>时间 / 地点</div>
                    <Input value={scene.timeLocation} onChange={(event) => handleSceneChange(scene.segmentId, { timeLocation: event.target.value })} placeholder="写当前场景的时间与地点" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>场景目标</div>
                    <Input.TextArea rows={6} value={scene.sceneGoal} onChange={(event) => handleSceneChange(scene.segmentId, { sceneGoal: event.target.value })} placeholder="这一场要拿到什么、推进什么。" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>障碍</div>
                    <Input.TextArea rows={6} value={scene.obstacle} onChange={(event) => handleSceneChange(scene.segmentId, { obstacle: event.target.value })} placeholder="阻碍当前场景目标实现的压力或代价。" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>冲突类型</div>
                    <Input value={scene.conflictType} onChange={(event) => handleSceneChange(scene.segmentId, { conflictType: event.target.value })} placeholder="外部对撞 / 心理冲突 / 信息博弈" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>情绪变化</div>
                    <Input value={scene.emotionShift} onChange={(event) => handleSceneChange(scene.segmentId, { emotionShift: event.target.value })} placeholder="紧绷 -> 失衡 -> 硬撑" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>信息揭示</div>
                    <Input.TextArea
                      rows={6}
                      value={scene.revealPayload.join('\n')}
                      onChange={(event) => handleSceneChange(scene.segmentId, { revealPayload: splitLines(event.target.value) })}
                      placeholder={'建议每行一条，例如：\n反派提前知道路线\n旧伤不是意外造成'}
                    />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>结果状态</div>
                    <Input.TextArea rows={6} value={scene.resultState} onChange={(event) => handleSceneChange(scene.segmentId, { resultState: event.target.value })} placeholder="这一场结束后人物和局势处于什么状态。" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>衔接方式</div>
                    <Input value={scene.linkageMode} onChange={(event) => handleSceneChange(scene.segmentId, { linkageMode: event.target.value })} placeholder="悬念续接 / 情绪余波 / 行动转场" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>终局承诺绑定</div>
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
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>伏笔账本绑定</div>
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
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>状态</div>
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
