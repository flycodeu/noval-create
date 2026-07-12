import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Empty, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import { ApartmentOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, TeamOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type {
  ResistanceBeatInput,
  ResistanceDashboard,
  ResistanceKind,
  ResistanceTrack,
  ResistanceTrackInput,
  ResistanceTrackStatus,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceStepGuide,
} from '../components/WorkspaceShell'
import {
  buildDraftMessages,
  matchSelectionIdByLabels,
  parseDraftJson,
} from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import './index.css'

interface Props {
  novelId: number
}

type ResistanceTab = 'characters' | 'factions' | 'environment' | 'institution'

const STATUS_OPTIONS: Array<{ value: ResistanceTrackStatus; label: string }> = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '施压中' },
  { value: 'stalled', label: '停滞' },
  { value: 'contained', label: '暂时压住' },
  { value: 'resolved', label: '解决' },
]

const BEAT_OPTIONS = [
  { value: 'setup', label: '铺设' },
  { value: 'strike', label: '出手' },
  { value: 'victory', label: '阶段胜利' },
  { value: 'setback', label: '受挫' },
  { value: 'escalation', label: '升级' },
  { value: 'counter', label: '反制' },
  { value: 'status-note', label: '状态记录' },
]

function getKindByTab(tab: ResistanceTab): ResistanceKind {
  if (tab === 'factions') return 'faction'
  if (tab === 'environment') return 'environment'
  if (tab === 'institution') return 'institution'
  return 'antagonist'
}

function buildTrackDraft(track: ResistanceTrack): ResistanceTrackInput {
  return {
    id: track.id,
    novelId: track.novelId,
    sourceType: track.sourceType,
    sourceId: track.sourceId,
    resistanceKind: track.resistanceKind,
    title: track.title,
    goal: track.goal,
    intelSource: track.intelSource,
    resourcePool: track.resourcePool,
    escalationPlan: track.escalationPlan,
    heroKnowledgeShift: track.heroKnowledgeShift,
    stageVictory: track.stageVictory,
    counterMove: track.counterMove,
    currentPressureMode: track.currentPressureMode,
    currentStatus: track.currentStatus,
    lastActionChapterId: track.lastActionChapterId,
    nextEscalationChapterId: track.nextEscalationChapterId,
    linkedVolumeId: track.linkedVolumeId,
    notes: track.notes,
  }
}

function buildSourceDraft(
  novelId: number,
  tab: ResistanceTab,
  sourceId?: number,
  sourceName?: string,
): ResistanceTrackInput {
  const sourceType = tab === 'characters'
    ? 'character'
    : tab === 'factions'
      ? 'faction'
      : tab
  return {
    novelId,
    sourceType,
    sourceId,
    resistanceKind: getKindByTab(tab),
    title: sourceName ? `${sourceName}阻力线` : '',
    goal: '',
    intelSource: '',
    resourcePool: '',
    escalationPlan: '',
    heroKnowledgeShift: '',
    stageVictory: '',
    counterMove: '',
    currentPressureMode: '',
    currentStatus: 'draft',
    notes: '',
  }
}

function buildEnvironmentDraft(novelId: number, tab: 'environment' | 'institution'): ResistanceTrackInput {
  return buildSourceDraft(novelId, tab)
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function ResistancePage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentNovel } = useNovelStore()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dashboard, setDashboard] = useState<ResistanceDashboard | null>(null)
  const [tab, setTab] = useState<ResistanceTab>('characters')
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null)
  const [selectedFactionId, setSelectedFactionId] = useState<number | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [draft, setDraft] = useState<ResistanceTrackInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [beatSaving, setBeatSaving] = useState(false)
  const [beatOpen, setBeatOpen] = useState(false)
  const [beatDraft, setBeatDraft] = useState<ResistanceBeatInput>({
    novelId,
    trackId: 0,
    beatType: 'status-note',
    title: '',
    summary: '',
    actionMode: '',
    successLevel: '',
    counterResponse: '',
    protagonistImpact: '',
    status: 'logged',
  })
  const refreshRequestRef = useRef(0)

  const refresh = useCallback(async (showLoading = false) => {
    const requestId = ++refreshRequestRef.current
    if (showLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const nextDashboard = await window.electron.resistance.getDashboard(novelId)
      if (refreshRequestRef.current === requestId) setDashboard(nextDashboard)
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [novelId])

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  const characters = useMemo(() => dashboard?.availableCharacters || [], [dashboard?.availableCharacters])
  const factions = useMemo(() => dashboard?.availableFactions || [], [dashboard?.availableFactions])
  const trackList = useMemo(() => dashboard?.tracks || [], [dashboard?.tracks])
  const characterTracks = useMemo(() => dashboard?.characterTracks || [], [dashboard?.characterTracks])
  const factionTracks = useMemo(() => dashboard?.factionTracks || [], [dashboard?.factionTracks])
  const environmentTracks = useMemo(() => dashboard?.environmentTracks || [], [dashboard?.environmentTracks])
  const institutionTracks = useMemo(() => dashboard?.institutionTracks || [], [dashboard?.institutionTracks])
  const volumes = useMemo(() => dashboard?.volumes || [], [dashboard?.volumes])
  const selectedCharacterTrack = characterTracks.find((item) => item.sourceId === selectedCharacterId) || null
  const selectedFactionTrack = factionTracks.find((item) => item.sourceId === selectedFactionId) || null
  const selectedTrack = trackList.find((item) => item.id === selectedTrackId)
    || selectedCharacterTrack
    || selectedFactionTrack
    || environmentTracks.find((item) => item.id === selectedTrackId)
    || institutionTracks.find((item) => item.id === selectedTrackId)
    || null

  useEffect(() => {
    if (!dashboard) return
    const nextTab = searchParams.get('tab')
    if (nextTab === 'characters' || nextTab === 'factions' || nextTab === 'environment' || nextTab === 'institution') {
      setTab(nextTab)
    }
    const characterId = Number(searchParams.get('characterId') || '')
    if (Number.isFinite(characterId) && characters.some((item) => item.id === characterId)) {
      setSelectedCharacterId(characterId)
    } else if (!selectedCharacterId || !characters.some((item) => item.id === selectedCharacterId)) {
      setSelectedCharacterId(characters[0]?.id || null)
    }
    const factionId = Number(searchParams.get('factionId') || '')
    if (Number.isFinite(factionId) && factions.some((item) => item.id === factionId)) {
      setSelectedFactionId(factionId)
    } else if (!selectedFactionId || !factions.some((item) => item.id === selectedFactionId)) {
      setSelectedFactionId(factions[0]?.id || null)
    }
    const trackId = Number(searchParams.get('trackId') || '')
    if (Number.isFinite(trackId) && trackList.some((item) => item.id === trackId)) {
      setSelectedTrackId(trackId)
    } else if (!selectedTrackId || !trackList.some((item) => item.id === selectedTrackId)) {
      const firstTrack = nextTab === 'institution'
        ? institutionTracks[0]
        : nextTab === 'environment'
          ? environmentTracks[0]
          : nextTab === 'factions'
            ? factionTracks.find((item) => item.sourceId === (selectedFactionId || factions[0]?.id))
            : characterTracks.find((item) => item.sourceId === (selectedCharacterId || characters[0]?.id))
      setSelectedTrackId(firstTrack?.id || null)
    }
  }, [characterTracks, characters, dashboard, environmentTracks, factionTracks, factions, institutionTracks, searchParams, selectedCharacterId, selectedFactionId, selectedTrackId, trackList])

  useEffect(() => {
    if (!dashboard) return
    if (tab === 'characters') {
      const character = characters.find((item) => item.id === selectedCharacterId)
      const track = characterTracks.find((item) => item.sourceId === selectedCharacterId)
      setDraft(track ? buildTrackDraft(track) : character ? buildSourceDraft(novelId, 'characters', character.id, character.fullName) : null)
      setSelectedTrackId(track?.id || null)
      return
    }
    if (tab === 'factions') {
      const faction = factions.find((item) => item.id === selectedFactionId)
      const track = factionTracks.find((item) => item.sourceId === selectedFactionId)
      setDraft(track ? buildTrackDraft(track) : faction ? buildSourceDraft(novelId, 'factions', faction.id, faction.name) : null)
      setSelectedTrackId(track?.id || null)
      return
    }
    const scopedTracks = tab === 'environment' ? dashboard.environmentTracks : dashboard.institutionTracks
    const track = scopedTracks.find((item) => item.id === selectedTrackId) || scopedTracks[0] || null
    setDraft(track ? buildTrackDraft(track) : buildEnvironmentDraft(novelId, tab))
    setSelectedTrackId(track?.id || null)
  }, [characterTracks, characters, dashboard, environmentTracks, factionTracks, factions, institutionTracks, novelId, selectedCharacterId, selectedFactionId, selectedTrackId, tab])

  const chapterOptions = useMemo(
    () => (dashboard?.chapters || []).map((item) => ({ value: item.id, label: `第${item.chapterNum}章 ${item.title}`.trim() })),
    [dashboard],
  )
  const timelineOptions = useMemo(
    () => (dashboard?.timelineEvents || []).map((item) => ({ value: item.id, label: `${item.eventTitle} · ${item.timeLabel}` })),
    [dashboard],
  )
  const volumeOptions = useMemo(
    () => volumes.map((item) => ({ value: item.id, label: item.title })),
    [volumes],
  )
  const volumeDraftOptions = useMemo(() => volumes.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, `第${item.volumeNumber}卷`],
  })), [volumes])

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await window.electron.resistance.upsertTrack(draft)
      message.success(getUserFacingMessage('resistance.saved'))
      if (saved.id) setSelectedTrackId(saved.id)
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveBeat = async () => {
    if (!selectedTrack?.id) return
    setBeatSaving(true)
    try {
      await window.electron.resistance.upsertBeat({ ...beatDraft, novelId, trackId: selectedTrack.id })
      message.success(getUserFacingMessage('resistance.progressSaved'))
      setBeatOpen(false)
      setBeatDraft({
        novelId,
        trackId: selectedTrack.id,
        beatType: 'status-note',
        title: '',
        summary: '',
        actionMode: '',
        successLevel: '',
        counterResponse: '',
        protagonistImpact: '',
        status: 'logged',
      })
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setBeatSaving(false)
    }
  }

  const renderCharacterList = () => (
    <div className="workspace-stack-10">
      {characters.map((item) => {
        const track = characterTracks.find((entry) => entry.sourceId === item.id)
        return (
          <button
            key={item.id}
            type="button"
            className={`novel-list-card workspace-button-card ${selectedCharacterId === item.id ? 'novel-list-card--active' : ''}`}
            onClick={() => {
              setSelectedCharacterId(item.id)
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.set('tab', 'characters')
                next.set('characterId', String(item.id))
                return next
              })
            }}
          >
            <div className="novel-list-card__title">
              <span>{item.fullName}</span>
              <Tag color={track ? (track.currentStatus === 'resolved' ? 'success' : track.currentStatus === 'stalled' ? 'warning' : 'processing') : 'default'}>
                {track ? track.currentStatus : '未建'}
              </Tag>
            </div>
            <div className="novel-list-card__desc">{track?.latestBeatSummary || track?.currentPressureMode || item.goals || '还没有拆成可持续升级的对抗轨迹。'}</div>
          </button>
        )
      })}
      {characters.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先去角色系统建立反派角色。" /> : null}
    </div>
  )

  const renderFactionList = () => (
    <div className="workspace-stack-10">
      {factions.map((item) => {
        const track = factionTracks.find((entry) => entry.sourceId === item.id)
        return (
          <button
            key={item.id}
            type="button"
            className={`novel-list-card workspace-button-card ${selectedFactionId === item.id ? 'novel-list-card--active' : ''}`}
            onClick={() => {
              setSelectedFactionId(item.id)
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.set('tab', 'factions')
                next.set('factionId', String(item.id))
                return next
              })
            }}
          >
            <div className="novel-list-card__title">
              <span>{item.name}</span>
              <Tag color={track ? (track.currentStatus === 'resolved' ? 'success' : track.currentStatus === 'stalled' ? 'warning' : 'processing') : 'default'}>
                {track ? track.currentStatus : '未建'}
              </Tag>
            </div>
            <div className="novel-list-card__desc">{track?.latestBeatSummary || track?.currentPressureMode || item.goal || '还没有拆成阶段性施压路径。'}</div>
          </button>
        )
      })}
      {factions.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先去势力系统建立对立势力。" /> : null}
    </div>
  )

  const renderStandaloneList = (items: ResistanceTrack[]) => (
    <div className="workspace-stack-10">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`novel-list-card workspace-button-card ${selectedTrackId === item.id ? 'novel-list-card--active' : ''}`}
          onClick={() => {
            if (!item.id) return
            setSelectedTrackId(item.id)
            setSearchParams((current) => {
              const next = new URLSearchParams(current)
              next.set('tab', item.sourceType)
              next.set('trackId', String(item.id))
              return next
            })
          }}
        >
          <div className="novel-list-card__title">
            <span>{item.title}</span>
            <Tag color={item.currentStatus === 'resolved' ? 'success' : item.currentStatus === 'stalled' ? 'warning' : 'processing'}>
              {item.currentStatus}
            </Tag>
          </div>
          <div className="novel-list-card__desc">{item.latestBeatSummary || item.currentPressureMode || item.goal || '等待补齐这一条阻力线。'}</div>
        </button>
      ))}
      {items.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有这类阻力线。" /> : null}
    </div>
  )

  const selectedFaction = factions.find((item) => item.id === selectedFactionId) || null
  const selectedSourceLabel = selectedTrack?.sourceName
    || (tab === 'characters' ? characters.find((item) => item.id === selectedCharacterId)?.fullName : undefined)
    || (tab === 'factions' ? selectedFaction?.name : undefined)
    || undefined

  if (loading && !dashboard) {
    return (
      <WorkspacePage title="反派与阻力系统">
        <WorkspacePanel title="正在加载">
          <div className="novel-workspace__loading-card">
            <Spin />
          </div>
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <>
      <WorkspacePage
        eyebrow="冲突压力维护"
        title="反派与阻力系统"
        description="把人物反派、势力反派、环境阻力和制度阻力统一放进同一个阻力工作台，并登记章节层面的真实出手。"
        actions={(
          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存当前阻力线
            </Button>
            <Button icon={<PlusOutlined />} disabled={tab === 'characters' || tab === 'factions'} onClick={() => setDraft(buildEnvironmentDraft(novelId, tab as 'environment' | 'institution'))}>
              新建本类阻力
            </Button>
            <Button icon={<PlusOutlined />} disabled={!selectedTrack?.id} onClick={() => setBeatOpen(true)}>
              登记阻力推进
            </Button>
            <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/contracts`)}>
              去章节合同
            </Button>
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refresh()}>
              刷新
            </Button>
          </Space>
        )}
        contextSummary={(
          <WorkspaceContextSummary
            items={[
              { label: '书名', value: currentNovel?.title || '未命名小说' },
              { label: '阻力线总数', value: `${dashboard?.tracks.length || 0} 条` },
              { label: '正在施压', value: `${dashboard?.activeTrackCount || 0} 条` },
              { label: '当前对象', value: selectedSourceLabel || '未选择' },
            ]}
          />
        )}
        metrics={(
          <>
            <WorkspaceMetric label="停滞阻力" value={dashboard?.stalledTrackCount || 0} tone="warm" />
            <WorkspaceMetric label="已解决阻力" value={dashboard?.resolvedTrackCount || 0} />
            <WorkspaceMetric label="推进记录" value={selectedTrack?.beatCount || 0} tone="cool" />
            <WorkspaceMetric label="下次升级" value={selectedTrack?.nextEscalationChapterLabel || '未设'} />
          </>
        )}
        guide={(
          <WorkspaceStepGuide
            steps={[
              { title: '先补主要阻力来源', description: '至少建立一条人物反派或势力反派线。', status: 'focus' },
              { title: '再写升级与反制', description: '把情报、资源、升级策略和失败后反制写成结构字段。', status: 'todo' },
              { title: '最后绑到卷与章', description: '把阻力线挂到卷级设计和章节合同，写完章后回写本章是否出手。', status: 'todo' },
            ]}
          />
        )}
      >
        {refreshing ? <div className="novel-dashboard__refresh-indicator novel-resistance-page__refresh"><Spin size="small" /><span>正在同步阻力系统数据</span></div> : null}
        {dashboard?.tracks.length ? null : (
          <Alert
            type="info"
            showIcon
            message="当前还没有建立阻力线"
            description="可以从左侧的人物反派、势力反派开始，也可以直接新建环境阻力和制度阻力。"
          />
        )}

        <div className="novel-resistance-page__tabs">
          {[
            ['characters', '人物反派'],
            ['factions', '势力反派'],
            ['environment', '环境阻力'],
            ['institution', '制度阻力'],
          ].map(([value, label]) => (
            <Button
              key={value}
              type={tab === value ? 'primary' : 'default'}
              onClick={() => {
                const next = value as ResistanceTab
                setTab(next)
                setSearchParams((current) => {
                  const nextParams = new URLSearchParams(current)
                  nextParams.set('tab', next)
                  return nextParams
                })
              }}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="novel-character-studio">
          <WorkspacePanel
            className="novel-character-studio__sidebar"
            title={tab === 'characters' ? '反派人物' : tab === 'factions' ? '阻力势力' : tab === 'environment' ? '环境阻力' : '制度阻力'}
            scrollable
            sticky
          >
            {tab === 'characters'
              ? renderCharacterList()
              : tab === 'factions'
                ? renderFactionList()
                : renderStandaloneList(tab === 'environment' ? environmentTracks : institutionTracks)}
          </WorkspacePanel>

          <WorkspacePanel
            className="novel-character-studio__editor"
            title="阻力线编辑"
            scrollable
            sticky
            extra={draft ? (
              <AIGenerateButton
                novelId={novelId}
                label="AI 补全·当前阻力线"
                intent={hasFilledValues([
                  draft.goal,
                  draft.intelSource,
                  draft.resourcePool,
                  draft.escalationPlan,
                  draft.currentPressureMode,
                ]) ? 'complete' : 'generate'}
                isJson
                buildMessages={() => buildDraftMessages({
                  task: `${tab === 'characters' ? '人物反派阻力线' : tab === 'factions' ? '势力阻力线' : tab === 'environment' ? '环境阻力线' : '制度阻力线'}${selectedSourceLabel ? ` · ${selectedSourceLabel}` : ''}`,
                  mode: hasFilledValues([
                    draft.goal,
                    draft.intelSource,
                    draft.resourcePool,
                    draft.escalationPlan,
                    draft.currentPressureMode,
                  ]) ? 'optimize' : 'replace',
                  context: buildPlanningContextSections(currentNovel, {
                    includeSubplots: true,
                    extraSections: [
                      { label: '阻力类别', value: tab },
                      { label: '当前对象', value: selectedSourceLabel || '' },
                      { label: '可绑定卷', value: volumes.map((item) => item.title) },
                    ],
                  }),
                  fields: [
                    { key: 'title', label: '阻力标题', value: draft.title, hint: '写成可长期复用的阻力线名称。' },
                    { key: 'goal', label: '阻力目标', value: draft.goal, hint: '写阻力方真正要拿到什么。' },
                    { key: 'intelSource', label: '情报来源', value: draft.intelSource, hint: '写它掌握信息的来源和偏差。' },
                    { key: 'resourcePool', label: '资源池', value: draft.resourcePool, hint: '写它能调动的人手、物资、权力或环境优势。' },
                    { key: 'escalationPlan', label: '升级策略', value: draft.escalationPlan, hint: '写它在失手后如何继续加压。' },
                    { key: 'heroKnowledgeShift', label: '主角认知变化', value: draft.heroKnowledgeShift, hint: '写主角在这条阻力线上会被迫知道什么。' },
                    { key: 'stageVictory', label: '阶段胜利点', value: draft.stageVictory, hint: '写阻力方阶段性得手的节点。' },
                    { key: 'counterMove', label: '失败后反制', value: draft.counterMove, hint: '写被破局后的二次反扑方式。' },
                    { key: 'currentPressureMode', label: '当前出手方式', value: draft.currentPressureMode, hint: '写这一阶段实际压迫主角的方式。' },
                    { key: 'notes', label: '备注', value: draft.notes, hint: '补充限制、误判、隐藏成本或跨页联动。' },
                    { key: 'linkedVolumeTitle', label: '关联卷标题', value: volumes.find((item) => item.id === draft.linkedVolumeId)?.title || '', hint: '只能从可绑定卷里选一个卷标题。' },
                  ],
                  requirements: [
                    '必须与人物、势力、世界规则和终局压力一致。',
                    '不要把阻力线写成主角计划或章节流水账。',
                  ],
                })}
                onResult={(raw) => {
                  const result = parseDraftJson<Record<string, unknown>>(raw)
                  setDraft((current) => {
                    if (!current) return current
                    return {
                      ...current,
                      title: typeof result.title === 'string' ? result.title : current.title,
                      goal: typeof result.goal === 'string' ? result.goal : current.goal,
                      intelSource: typeof result.intelSource === 'string' ? result.intelSource : current.intelSource,
                      resourcePool: typeof result.resourcePool === 'string' ? result.resourcePool : current.resourcePool,
                      escalationPlan: typeof result.escalationPlan === 'string' ? result.escalationPlan : current.escalationPlan,
                      heroKnowledgeShift: typeof result.heroKnowledgeShift === 'string' ? result.heroKnowledgeShift : current.heroKnowledgeShift,
                      stageVictory: typeof result.stageVictory === 'string' ? result.stageVictory : current.stageVictory,
                      counterMove: typeof result.counterMove === 'string' ? result.counterMove : current.counterMove,
                      currentPressureMode: typeof result.currentPressureMode === 'string' ? result.currentPressureMode : current.currentPressureMode,
                      notes: typeof result.notes === 'string' ? result.notes : current.notes,
                      linkedVolumeId: Object.prototype.hasOwnProperty.call(result, 'linkedVolumeTitle')
                        ? matchSelectionIdByLabels(result.linkedVolumeTitle, volumeDraftOptions)
                        : current.linkedVolumeId,
                    }
                  })
                }}
              />
            ) : undefined}
          >
            {draft ? (
              <>
                <div className="guided-step__field-grid">
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-resistance-page__field-label">阻力标题</div>
                    <Input value={draft.title} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-resistance-page__field-label">当前状态</div>
                    <Select value={draft.currentStatus} onChange={(value) => setDraft((current) => current ? { ...current, currentStatus: value } : current)} options={STATUS_OPTIONS} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">阻力目标</div>
                    <Input.TextArea rows={6} value={draft.goal} onChange={(event) => setDraft((current) => current ? { ...current, goal: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">情报来源</div>
                    <Input.TextArea rows={6} value={draft.intelSource} onChange={(event) => setDraft((current) => current ? { ...current, intelSource: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">资源池</div>
                    <Input.TextArea rows={6} value={draft.resourcePool} onChange={(event) => setDraft((current) => current ? { ...current, resourcePool: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">升级策略</div>
                    <Input.TextArea rows={6} value={draft.escalationPlan} onChange={(event) => setDraft((current) => current ? { ...current, escalationPlan: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">主角认知变化</div>
                    <Input.TextArea rows={6} value={draft.heroKnowledgeShift} onChange={(event) => setDraft((current) => current ? { ...current, heroKnowledgeShift: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">阶段胜利点</div>
                    <Input.TextArea rows={6} value={draft.stageVictory} onChange={(event) => setDraft((current) => current ? { ...current, stageVictory: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">失败后反制</div>
                    <Input.TextArea rows={6} value={draft.counterMove} onChange={(event) => setDraft((current) => current ? { ...current, counterMove: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">当前出手方式</div>
                    <Input.TextArea rows={6} value={draft.currentPressureMode} onChange={(event) => setDraft((current) => current ? { ...current, currentPressureMode: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-resistance-page__field-label">最近出手章节</div>
                    <Select allowClear value={draft.lastActionChapterId} onChange={(value) => setDraft((current) => current ? { ...current, lastActionChapterId: value } : current)} options={chapterOptions} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-resistance-page__field-label">下一次升级章节</div>
                    <Select allowClear value={draft.nextEscalationChapterId} onChange={(value) => setDraft((current) => current ? { ...current, nextEscalationChapterId: value } : current)} options={chapterOptions} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div className="novel-resistance-page__field-label">挂到卷级设计</div>
                    <Select allowClear value={draft.linkedVolumeId} onChange={(value) => setDraft((current) => current ? { ...current, linkedVolumeId: value } : current)} options={volumeOptions} />
                  </div>
                  <div className="guided-step__field-card">
                    <div className="novel-resistance-page__field-label">备注</div>
                    <Input.TextArea rows={6} value={draft.notes} onChange={(event) => setDraft((current) => current ? { ...current, notes: event.target.value } : current)} />
                  </div>
                </div>

                <div className="novel-resistance-page__beats">
                  <strong>推进记录</strong>
                  {selectedTrack?.beats.length
                    ? selectedTrack.beats.map((beat) => (
                      <div key={beat.id} className="novel-note-list__item">
                        <strong>{beat.title || '未命名推进'}</strong>
                        <div>{[beat.beatType, beat.chapterLabel, beat.timelineEventLabel].filter(Boolean).join(' · ')}</div>
                        {beat.summary ? <small>{beat.summary}</small> : null}
                      </div>
                    ))
                    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有登记阻力推进。" />}
                </div>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先从左侧选择对象或新建阻力线。" />
            )}
          </WorkspacePanel>

          <WorkspacePanel className="novel-character-graph-panel" title="联动跳转">
            <div className="novel-resistance-page__links">
              {tab === 'characters' && selectedCharacterId ? (
                <Button icon={<TeamOutlined />} onClick={() => navigate(`/novels/${novelId}/characters?characterId=${selectedCharacterId}`)}>
                  打开当前人物
                </Button>
              ) : null}
              {tab === 'factions' && selectedFaction ? (
                <Button icon={<ApartmentOutlined />} onClick={() => navigate(`/novels/${novelId}/factions`)}>
                  打开当前势力
                </Button>
              ) : null}
              <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/volume-design`)}>
                去卷级设计绑定主阻力
              </Button>
              <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/contracts`)}>
                去章节合同登记本章出手
              </Button>
            </div>
          </WorkspacePanel>
        </div>
      </WorkspacePage>

      <Modal
        title="登记阻力推进"
        open={beatOpen}
        onCancel={() => setBeatOpen(false)}
        onOk={() => void handleSaveBeat()}
        confirmLoading={beatSaving}
      >
        <div className="guided-step__field-grid">
          <div className="guided-step__field-card guided-step__field-card--full">
            <AIGenerateButton
              novelId={novelId}
              label="AI 生成·阻力推进"
              intent={hasFilledValues([
                beatDraft.title,
                beatDraft.summary,
                beatDraft.actionMode,
                beatDraft.counterResponse,
                beatDraft.protagonistImpact,
              ]) ? 'complete' : 'generate'}
              isJson
              disabled={!selectedTrack}
              buildMessages={() => buildDraftMessages({
                task: selectedTrack ? `阻力推进记录 · ${selectedTrack.title}` : '阻力推进记录',
                mode: hasFilledValues([
                  beatDraft.title,
                  beatDraft.summary,
                  beatDraft.actionMode,
                  beatDraft.counterResponse,
                  beatDraft.protagonistImpact,
                ]) ? 'optimize' : 'replace',
                context: buildPlanningContextSections(currentNovel, {
                  includeSubplots: true,
                  extraSections: [
                    { label: '当前阻力线', value: selectedTrack ? [
                      `标题：${selectedTrack.title}`,
                      selectedTrack.goal ? `目标：${selectedTrack.goal}` : '',
                      selectedTrack.currentPressureMode ? `当前出手方式：${selectedTrack.currentPressureMode}` : '',
                      selectedTrack.escalationPlan ? `升级策略：${selectedTrack.escalationPlan}` : '',
                    ].filter(Boolean).join('\n') : '' },
                  ],
                }),
                fields: [
                  { key: 'title', label: '标题', value: beatDraft.title, hint: '写这一章或这一事件里的阻力动作名称。' },
                  { key: 'summary', label: '出手说明', value: beatDraft.summary, hint: '写阻力如何出手、命中了什么。' },
                  { key: 'actionMode', label: '出手方式', value: beatDraft.actionMode, hint: '写动作层面的实施方式。' },
                  { key: 'successLevel', label: '成功程度', value: beatDraft.successLevel, hint: '写得手程度或反噬程度。' },
                  { key: 'counterResponse', label: '后续反制', value: beatDraft.counterResponse, hint: '写主角或系统会如何回应。' },
                  { key: 'protagonistImpact', label: '对主角影响', value: beatDraft.protagonistImpact, hint: '写主角付出的成本、认知变化或局势损失。' },
                ],
                requirements: [
                  '必须和当前阻力线的目标、资源和升级策略一致。',
                  '只写这一次推进，不要混入整条阻力线总纲。',
                ],
              })}
              onResult={(raw) => {
                const draftResult = parseDraftJson<Record<string, unknown>>(raw)
                setBeatDraft((current) => ({
                  ...current,
                  title: typeof draftResult.title === 'string' ? draftResult.title : current.title,
                  summary: typeof draftResult.summary === 'string' ? draftResult.summary : current.summary,
                  actionMode: typeof draftResult.actionMode === 'string' ? draftResult.actionMode : current.actionMode,
                  successLevel: typeof draftResult.successLevel === 'string' ? draftResult.successLevel : current.successLevel,
                  counterResponse: typeof draftResult.counterResponse === 'string' ? draftResult.counterResponse : current.counterResponse,
                  protagonistImpact: typeof draftResult.protagonistImpact === 'string' ? draftResult.protagonistImpact : current.protagonistImpact,
                }))
              }}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--compact">
            <div className="novel-resistance-page__field-label">推进类型</div>
            <Select value={beatDraft.beatType} onChange={(value) => setBeatDraft((current) => ({ ...current, beatType: value }))} options={BEAT_OPTIONS} />
          </div>
          <div className="guided-step__field-card guided-step__field-card--compact">
            <div className="novel-resistance-page__field-label">章节</div>
            <Select allowClear value={beatDraft.chapterId} onChange={(value) => setBeatDraft((current) => ({ ...current, chapterId: value }))} options={chapterOptions} />
          </div>
          <div className="guided-step__field-card guided-step__field-card--compact">
            <div className="novel-resistance-page__field-label">时间轴事件</div>
            <Select allowClear value={beatDraft.timelineEventId} onChange={(value) => setBeatDraft((current) => ({ ...current, timelineEventId: value }))} options={timelineOptions} />
          </div>
          <div className="guided-step__field-card">
            <div className="novel-resistance-page__field-label">标题</div>
            <Input value={beatDraft.title} onChange={(event) => setBeatDraft((current) => ({ ...current, title: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div className="novel-resistance-page__field-label">出手说明</div>
            <Input.TextArea rows={6} value={beatDraft.summary} onChange={(event) => setBeatDraft((current) => ({ ...current, summary: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div className="novel-resistance-page__field-label">出手方式</div>
            <Input.TextArea rows={6} value={beatDraft.actionMode} onChange={(event) => setBeatDraft((current) => ({ ...current, actionMode: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div className="novel-resistance-page__field-label">成功程度</div>
            <Input value={beatDraft.successLevel} onChange={(event) => setBeatDraft((current) => ({ ...current, successLevel: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div className="novel-resistance-page__field-label">后续反制</div>
            <Input.TextArea rows={6} value={beatDraft.counterResponse} onChange={(event) => setBeatDraft((current) => ({ ...current, counterResponse: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div className="novel-resistance-page__field-label">对主角影响</div>
            <Input.TextArea rows={6} value={beatDraft.protagonistImpact} onChange={(event) => setBeatDraft((current) => ({ ...current, protagonistImpact: event.target.value }))} />
          </div>
        </div>
      </Modal>
    </>
  )
}
