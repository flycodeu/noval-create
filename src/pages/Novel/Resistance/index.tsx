import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Empty, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import { ApartmentOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, TeamOutlined } from '@ant-design/icons'
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

export default function ResistancePage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentNovel } = useNovelStore()
  const [loading, setLoading] = useState(true)
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

  const refresh = async () => {
    setLoading(true)
    try {
      setDashboard(await window.electron.resistance.getDashboard(novelId))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [novelId])

  const characters = dashboard?.availableCharacters || []
  const factions = dashboard?.availableFactions || []
  const trackList = dashboard?.tracks || []
  const environmentTracks = dashboard?.environmentTracks || []
  const institutionTracks = dashboard?.institutionTracks || []
  const selectedCharacterTrack = dashboard?.characterTracks.find((item) => item.sourceId === selectedCharacterId) || null
  const selectedFactionTrack = dashboard?.factionTracks.find((item) => item.sourceId === selectedFactionId) || null
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
    } else if (!selectedCharacterId) {
      setSelectedCharacterId(characters[0]?.id || null)
    }
    const factionId = Number(searchParams.get('factionId') || '')
    if (Number.isFinite(factionId) && factions.some((item) => item.id === factionId)) {
      setSelectedFactionId(factionId)
    } else if (!selectedFactionId) {
      setSelectedFactionId(factions[0]?.id || null)
    }
    const trackId = Number(searchParams.get('trackId') || '')
    if (Number.isFinite(trackId) && trackList.some((item) => item.id === trackId)) {
      setSelectedTrackId(trackId)
    } else if (!selectedTrackId) {
      const firstTrack = nextTab === 'institution'
        ? institutionTracks[0]
        : nextTab === 'environment'
          ? environmentTracks[0]
          : nextTab === 'factions'
            ? dashboard.factionTracks.find((item) => item.sourceId === (selectedFactionId || factions[0]?.id))
            : dashboard.characterTracks.find((item) => item.sourceId === (selectedCharacterId || characters[0]?.id))
      setSelectedTrackId(firstTrack?.id || null)
    }
  }, [characters, dashboard, environmentTracks, factions, institutionTracks, searchParams, selectedCharacterId, selectedFactionId, selectedTrackId, trackList])

  useEffect(() => {
    if (!dashboard) return
    if (tab === 'characters') {
      const character = characters.find((item) => item.id === selectedCharacterId)
      const track = dashboard.characterTracks.find((item) => item.sourceId === selectedCharacterId)
      setDraft(track ? buildTrackDraft(track) : character ? buildSourceDraft(novelId, 'characters', character.id, character.fullName) : null)
      setSelectedTrackId(track?.id || null)
      return
    }
    if (tab === 'factions') {
      const faction = factions.find((item) => item.id === selectedFactionId)
      const track = dashboard.factionTracks.find((item) => item.sourceId === selectedFactionId)
      setDraft(track ? buildTrackDraft(track) : faction ? buildSourceDraft(novelId, 'factions', faction.id, faction.name) : null)
      setSelectedTrackId(track?.id || null)
      return
    }
    const scopedTracks = tab === 'environment' ? dashboard.environmentTracks : dashboard.institutionTracks
    const track = scopedTracks.find((item) => item.id === selectedTrackId) || scopedTracks[0] || null
    setDraft(track ? buildTrackDraft(track) : buildEnvironmentDraft(novelId, tab))
    setSelectedTrackId(track?.id || null)
  }, [characters, dashboard, factions, novelId, selectedCharacterId, selectedFactionId, selectedTrackId, tab])

  const chapterOptions = useMemo(
    () => (dashboard?.chapters || []).map((item) => ({ value: item.id, label: `第${item.chapterNum}章 ${item.title}`.trim() })),
    [dashboard],
  )
  const timelineOptions = useMemo(
    () => (dashboard?.timelineEvents || []).map((item) => ({ value: item.id, label: `${item.eventTitle} · ${item.timeLabel}` })),
    [dashboard],
  )
  const volumeOptions = useMemo(
    () => (dashboard?.volumes || []).map((item) => ({ value: item.id, label: item.title })),
    [dashboard],
  )

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
    <div style={{ display: 'grid', gap: 10 }}>
      {characters.map((item) => {
        const track = dashboard?.characterTracks.find((entry) => entry.sourceId === item.id)
        return (
          <button
            key={item.id}
            type="button"
            className={`novel-list-card ${selectedCharacterId === item.id ? 'novel-list-card--active' : ''}`}
            style={{ textAlign: 'left' }}
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
    <div style={{ display: 'grid', gap: 10 }}>
      {factions.map((item) => {
        const track = dashboard?.factionTracks.find((entry) => entry.sourceId === item.id)
        return (
          <button
            key={item.id}
            type="button"
            className={`novel-list-card ${selectedFactionId === item.id ? 'novel-list-card--active' : ''}`}
            style={{ textAlign: 'left' }}
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
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`novel-list-card ${selectedTrackId === item.id ? 'novel-list-card--active' : ''}`}
          style={{ textAlign: 'left' }}
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
          <Spin />
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
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
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
        {dashboard?.tracks.length ? null : (
          <Alert
            type="info"
            showIcon
            message="当前还没有建立阻力线"
            description="可以从左侧的人物反派、势力反派开始，也可以直接新建环境阻力和制度阻力。"
          />
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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

          <WorkspacePanel className="novel-character-studio__editor" title="阻力线编辑" scrollable sticky>
            {draft ? (
              <>
                <div className="guided-step__field-grid">
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>阻力标题</div>
                    <Input value={draft.title} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>当前状态</div>
                    <Select value={draft.currentStatus} onChange={(value) => setDraft((current) => current ? { ...current, currentStatus: value } : current)} options={STATUS_OPTIONS} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>阻力目标</div>
                    <Input.TextArea rows={3} value={draft.goal} onChange={(event) => setDraft((current) => current ? { ...current, goal: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>情报来源</div>
                    <Input.TextArea rows={3} value={draft.intelSource} onChange={(event) => setDraft((current) => current ? { ...current, intelSource: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>资源池</div>
                    <Input.TextArea rows={3} value={draft.resourcePool} onChange={(event) => setDraft((current) => current ? { ...current, resourcePool: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>升级策略</div>
                    <Input.TextArea rows={3} value={draft.escalationPlan} onChange={(event) => setDraft((current) => current ? { ...current, escalationPlan: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>主角认知变化</div>
                    <Input.TextArea rows={3} value={draft.heroKnowledgeShift} onChange={(event) => setDraft((current) => current ? { ...current, heroKnowledgeShift: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>阶段胜利点</div>
                    <Input.TextArea rows={3} value={draft.stageVictory} onChange={(event) => setDraft((current) => current ? { ...current, stageVictory: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>失败后反制</div>
                    <Input.TextArea rows={3} value={draft.counterMove} onChange={(event) => setDraft((current) => current ? { ...current, counterMove: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>当前出手方式</div>
                    <Input.TextArea rows={3} value={draft.currentPressureMode} onChange={(event) => setDraft((current) => current ? { ...current, currentPressureMode: event.target.value } : current)} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>最近出手章节</div>
                    <Select allowClear value={draft.lastActionChapterId} onChange={(value) => setDraft((current) => current ? { ...current, lastActionChapterId: value } : current)} options={chapterOptions} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>下一次升级章节</div>
                    <Select allowClear value={draft.nextEscalationChapterId} onChange={(value) => setDraft((current) => current ? { ...current, nextEscalationChapterId: value } : current)} options={chapterOptions} />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>挂到卷级设计</div>
                    <Select allowClear value={draft.linkedVolumeId} onChange={(value) => setDraft((current) => current ? { ...current, linkedVolumeId: value } : current)} options={volumeOptions} />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>备注</div>
                    <Input.TextArea rows={4} value={draft.notes} onChange={(event) => setDraft((current) => current ? { ...current, notes: event.target.value } : current)} />
                  </div>
                </div>

                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
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
            <div style={{ display: 'grid', gap: 12 }}>
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
          <div className="guided-step__field-card guided-step__field-card--compact">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>推进类型</div>
            <Select value={beatDraft.beatType} onChange={(value) => setBeatDraft((current) => ({ ...current, beatType: value }))} options={BEAT_OPTIONS} />
          </div>
          <div className="guided-step__field-card guided-step__field-card--compact">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>章节</div>
            <Select allowClear value={beatDraft.chapterId} onChange={(value) => setBeatDraft((current) => ({ ...current, chapterId: value }))} options={chapterOptions} />
          </div>
          <div className="guided-step__field-card guided-step__field-card--compact">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>时间轴事件</div>
            <Select allowClear value={beatDraft.timelineEventId} onChange={(value) => setBeatDraft((current) => ({ ...current, timelineEventId: value }))} options={timelineOptions} />
          </div>
          <div className="guided-step__field-card">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>标题</div>
            <Input value={beatDraft.title} onChange={(event) => setBeatDraft((current) => ({ ...current, title: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>出手说明</div>
            <Input.TextArea rows={4} value={beatDraft.summary} onChange={(event) => setBeatDraft((current) => ({ ...current, summary: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>出手方式</div>
            <Input.TextArea rows={3} value={beatDraft.actionMode} onChange={(event) => setBeatDraft((current) => ({ ...current, actionMode: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>成功程度</div>
            <Input value={beatDraft.successLevel} onChange={(event) => setBeatDraft((current) => ({ ...current, successLevel: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>后续反制</div>
            <Input.TextArea rows={3} value={beatDraft.counterResponse} onChange={(event) => setBeatDraft((current) => ({ ...current, counterResponse: event.target.value }))} />
          </div>
          <div className="guided-step__field-card">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>对主角影响</div>
            <Input.TextArea rows={3} value={beatDraft.protagonistImpact} onChange={(event) => setBeatDraft((current) => ({ ...current, protagonistImpact: event.target.value }))} />
          </div>
        </div>
      </Modal>
    </>
  )
}
