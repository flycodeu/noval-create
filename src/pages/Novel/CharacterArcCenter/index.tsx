import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Empty, Input, Modal, Select, Space, Spin, Tag, message } from 'antd'
import { ArrowRightOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, TeamOutlined } from '@ant-design/icons'
import type {
  Character,
  CharacterArcBeatInput,
  CharacterArcDashboard,
  CharacterArcInput,
  CharacterArcStatus,
  CharacterRelation,
  RelationshipArcInput,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel, WorkspaceStepGuide } from '../components/WorkspaceShell'

interface Props { novelId: number }

const STATUS_OPTIONS: Array<{ value: CharacterArcStatus; label: string }> = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '推进中' },
  { value: 'stalled', label: '停滞' },
  { value: 'completed', label: '完成' },
]

function pairKey(a: number, b: number) {
  return a <= b ? `${a}-${b}` : `${b}-${a}`
}

function buildCharacterDraft(character: Character | null, dashboard: CharacterArcDashboard | null): CharacterArcInput | null {
  if (!character || !dashboard) return null
  const arc = dashboard.characterArcs.find((item) => item.characterId === character.id)
  return {
    id: arc?.id,
    novelId: character.novelId,
    characterId: character.id,
    startState: arc?.startState || '',
    surfaceWant: arc?.surfaceWant || character.surfaceDesire || '',
    deepNeed: arc?.deepNeed || character.deepNeed || '',
    coreFear: arc?.coreFear || character.coreFear || '',
    misbelief: arc?.misbelief || character.selfDeception || '',
    firstCrackChapterId: arc?.firstCrackChapterId,
    changeEvent: arc?.changeEvent || '',
    changeTimelineEventId: arc?.changeTimelineEventId,
    endState: arc?.endState || '',
    currentStatus: arc?.currentStatus || 'draft',
    lastProgressChapterId: arc?.lastProgressChapterId,
    stalledReason: arc?.stalledReason || '',
    notes: arc?.notes || character.characterArc || '',
  }
}

function buildRelationshipDraft(novelId: number, relation: CharacterRelation | null, dashboard: CharacterArcDashboard | null): RelationshipArcInput | null {
  if (!dashboard || !relation) return null
  const arc = dashboard.relationshipArcs.find((item) => pairKey(item.charAId, item.charBId) === pairKey(relation.charAId, relation.charBId))
  return {
    id: arc?.id,
    novelId,
    charAId: relation.charAId,
    charBId: relation.charBId,
    relationLabelSnapshot: arc?.relationLabelSnapshot || relation.relationLabel || '',
    relationTypeSnapshot: arc?.relationTypeSnapshot || relation.relationType || '',
    startState: arc?.startState || '',
    crackPoint: arc?.crackPoint || '',
    changeEvent: arc?.changeEvent || '',
    changeTimelineEventId: arc?.changeTimelineEventId,
    endState: arc?.endState || '',
    currentStatus: arc?.currentStatus || 'draft',
    lastProgressChapterId: arc?.lastProgressChapterId,
    stalledReason: arc?.stalledReason || '',
    notes: arc?.notes || '',
  }
}

export default function CharacterArcCenterPage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { currentNovel } = useNovelStore()
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<CharacterArcDashboard | null>(null)
  const [tab, setTab] = useState<'protagonist' | 'characters' | 'relationships'>('protagonist')
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null)
  const [selectedRelationKey, setSelectedRelationKey] = useState<string | null>(null)
  const [characterDraft, setCharacterDraft] = useState<CharacterArcInput | null>(null)
  const [relationshipDraft, setRelationshipDraft] = useState<RelationshipArcInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [beatSaving, setBeatSaving] = useState(false)
  const [beatOpen, setBeatOpen] = useState(false)
  const [beatDraft, setBeatDraft] = useState<CharacterArcBeatInput>({ novelId, arcId: 0, beatType: 'progress-note', title: '', summary: '', status: 'logged' })

  const refresh = async () => {
    setLoading(true)
    try {
      setDashboard(await window.electron.characterArc.getArcDashboard(novelId))
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '人物弧线数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [novelId])

  const characters = dashboard?.availableCharacters || []
  const protagonistCharacters = characters.filter((item) => item.roleType === 'protagonist')
  const keyCharacters = characters.filter((item) => item.roleType !== 'protagonist' && (item.roleType !== 'minor' || dashboard?.characterArcs.some((arc) => arc.characterId === item.id)))
  const relations = dashboard?.availableRelations || []
  const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) || null
  const selectedArc = dashboard?.characterArcs.find((item) => item.characterId === selectedCharacterId) || null
  const selectedRelation = relations.find((item) => pairKey(item.charAId, item.charBId) === selectedRelationKey) || null

  useEffect(() => {
    if (!dashboard) return
    const nextTab = searchParams.get('tab')
    if (nextTab === 'protagonist' || nextTab === 'characters' || nextTab === 'relationships') setTab(nextTab)
    const characterId = Number(searchParams.get('characterId') || '')
    if (Number.isFinite(characterId) && characters.some((item) => item.id === characterId)) {
      setSelectedCharacterId(characterId)
    } else if (!selectedCharacterId) {
      setSelectedCharacterId(dashboard.protagonistArc?.characterId || protagonistCharacters[0]?.id || dashboard.characterArcs[0]?.characterId || keyCharacters[0]?.id || null)
    }
    const relationParam = searchParams.get('pair')
    if (relationParam && relations.some((item) => pairKey(item.charAId, item.charBId) === relationParam)) {
      setSelectedRelationKey(relationParam)
    } else if (!selectedRelationKey) {
      const firstArc = dashboard.relationshipArcs[0]
      setSelectedRelationKey(firstArc ? pairKey(firstArc.charAId, firstArc.charBId) : (relations[0] ? pairKey(relations[0].charAId, relations[0].charBId) : null))
    }
  }, [characters, dashboard, keyCharacters, protagonistCharacters, relations, searchParams, selectedCharacterId, selectedRelationKey])

  useEffect(() => { setCharacterDraft(buildCharacterDraft(selectedCharacter, dashboard)) }, [dashboard, selectedCharacter])
  useEffect(() => { setRelationshipDraft(buildRelationshipDraft(novelId, selectedRelation, dashboard)) }, [dashboard, novelId, selectedRelation])

  const chapterOptions = useMemo(() => (dashboard?.chapters || []).map((item) => ({ value: item.id, label: `第${item.chapterNum}章 ${item.title}`.trim() })), [dashboard])
  const timelineOptions = useMemo(() => (dashboard?.timelineEvents || []).map((item) => ({ value: item.id, label: `${item.eventTitle} · ${item.timeLabel}` })), [dashboard])

  const saveCurrent = async () => {
    setSaving(true)
    try {
      if (tab === 'relationships') {
        if (!relationshipDraft) return
        await window.electron.characterArc.upsertRelationshipArc(relationshipDraft)
        message.success('关系弧已保存')
      } else {
        if (!characterDraft) return
        await window.electron.characterArc.upsertCharacterArc(characterDraft)
        message.success('人物弧已保存')
      }
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveBeat = async () => {
    if (!selectedArc?.id) return
    setBeatSaving(true)
    try {
      await window.electron.characterArc.upsertCharacterArcBeat({ ...beatDraft, novelId, arcId: selectedArc.id })
      message.success('推进节点已登记')
      setBeatOpen(false)
      setBeatDraft({ novelId, arcId: selectedArc.id, beatType: 'progress-note', title: '', summary: '', status: 'logged' })
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '推进登记失败')
    } finally {
      setBeatSaving(false)
    }
  }

  const renderCharacterList = (items: Character[]) => (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => {
        const arc = dashboard?.characterArcs.find((entry) => entry.characterId === item.id)
        return (
          <button key={item.id} type="button" className={`novel-list-card ${selectedCharacterId === item.id ? 'novel-list-card--active' : ''}`} style={{ textAlign: 'left' }} onClick={() => {
            setSelectedCharacterId(item.id)
            setSearchParams((current) => { const next = new URLSearchParams(current); next.set('tab', tab); next.set('characterId', String(item.id)); return next })
          }}>
            <div className="novel-list-card__title">
              <span>{item.fullName}</span>
              <Tag color={arc ? (arc.currentStatus === 'completed' ? 'success' : arc.currentStatus === 'stalled' ? 'warning' : 'processing') : 'default'}>{arc ? arc.currentStatus : '未建弧'}</Tag>
            </div>
            <div className="novel-list-card__desc">{arc?.latestBeatSummary || arc?.changeEvent || item.characterArc || item.innerConflict || '还没有建立持续变化轨迹。'}</div>
          </button>
        )
      })}
      {items.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可编辑对象。" /> : null}
    </div>
  )

  const renderRelationList = () => (
    <div style={{ display: 'grid', gap: 10 }}>
      {relations.map((item) => {
        const currentKey = pairKey(item.charAId, item.charBId)
        const arc = dashboard?.relationshipArcs.find((entry) => pairKey(entry.charAId, entry.charBId) === currentKey)
        const charA = characters.find((entry) => entry.id === item.charAId)?.fullName || '未知角色'
        const charB = characters.find((entry) => entry.id === item.charBId)?.fullName || '未知角色'
        return (
          <button key={currentKey} type="button" className={`novel-list-card ${selectedRelationKey === currentKey ? 'novel-list-card--active' : ''}`} style={{ textAlign: 'left' }} onClick={() => {
            setSelectedRelationKey(currentKey)
            setSearchParams((current) => { const next = new URLSearchParams(current); next.set('tab', 'relationships'); next.set('pair', currentKey); return next })
          }}>
            <div className="novel-list-card__title">
              <span>{`${charA} × ${charB}`}</span>
              <Tag color={arc ? (arc.currentStatus === 'completed' ? 'success' : arc.currentStatus === 'stalled' ? 'warning' : 'processing') : 'default'}>{arc ? arc.currentStatus : '未建弧'}</Tag>
            </div>
            <div className="novel-list-card__desc">{arc?.changeEvent || item.relationLabel || item.description || '还没有拆成阶段变化。'}</div>
          </button>
        )
      })}
      {relations.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先去角色系统建立人物关系。" /> : null}
    </div>
  )

  if (loading && !dashboard) {
    return <WorkspacePage title="人物弧线中心"><WorkspacePanel title="正在加载"><Spin /></WorkspacePanel></WorkspacePage>
  }

  return (
    <>
      <WorkspacePage
        eyebrow="角色变化维护"
        title="人物弧线中心"
        description="维护主角弧、关键角色弧和关系弧，并登记章节层面的实际推进。"
        actions={<Space wrap><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveCurrent()}>保存当前弧线</Button><Button icon={<PlusOutlined />} disabled={tab === 'relationships' || !selectedArc?.id} onClick={() => setBeatOpen(true)}>登记推进</Button><Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/contracts`)}>去章节合同</Button><Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button></Space>}
        contextSummary={<WorkspaceContextSummary items={[{ label: '书名', value: currentNovel?.title || '未命名小说' }, { label: '主角弧', value: dashboard?.protagonistArc ? '已建立' : '待建立' }, { label: '角色弧', value: `${dashboard?.characterArcs.length || 0} 条` }, { label: '关系弧', value: `${dashboard?.relationshipArcs.length || 0} 条` }]} />}
        metrics={<><WorkspaceMetric label="停滞弧线" value={(dashboard?.stalledCharacterCount || 0) + (dashboard?.stalledRelationshipCount || 0)} tone="warm" /><WorkspaceMetric label="关键角色候选" value={keyCharacters.length} /><WorkspaceMetric label="关系候选" value={relations.length} tone="cool" /><WorkspaceMetric label="最近推进" value={selectedArc?.lastProgressChapterLabel || '未记录'} /></>}
        guide={<WorkspaceStepGuide steps={[{ title: '先补主角弧', description: '主角必须有初始状态、误信和改变事件。', status: 'focus' }, { title: '再补关键角色弧', description: '至少补齐一名关键角色的变化轨迹。', status: 'todo' }, { title: '最后绑定关系弧', description: '把重要双人关系拆成阶段，并在章节合同里引用。', status: 'todo' }]} />}
      >
        {characters.length <= 0 ? <Alert type="warning" showIcon message="还没有角色资产" description="先去角色系统建立主角和关键人物，再回来补人物弧线。" /> : null}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            ['protagonist', '主角弧'],
            ['characters', '关键角色弧'],
            ['relationships', '关系弧'],
          ].map(([value, label]) => <Button key={value} type={tab === value ? 'primary' : 'default'} onClick={() => { const next = value as typeof tab; setTab(next); setSearchParams((current) => { const params = new URLSearchParams(current); params.set('tab', next); return params }) }}>{label}</Button>)}
        </div>
        <div className="novel-character-studio">
          <WorkspacePanel className="novel-character-studio__sidebar" title={tab === 'relationships' ? '关系对' : tab === 'protagonist' ? '主角' : '关键角色'} scrollable sticky>{tab === 'relationships' ? renderRelationList() : renderCharacterList(tab === 'protagonist' ? protagonistCharacters : keyCharacters)}</WorkspacePanel>
          <WorkspacePanel className="novel-character-studio__editor" title={tab === 'relationships' ? '关系弧编辑' : '人物弧编辑'} scrollable sticky>
            {tab === 'relationships' ? (relationshipDraft ? (
              <div className="guided-step__field-grid">
                <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>关系称呼</div><Input value={relationshipDraft.relationLabelSnapshot} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, relationLabelSnapshot: event.target.value } : current)} /></div>
                <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>关系类型</div><Input value={relationshipDraft.relationTypeSnapshot} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, relationTypeSnapshot: event.target.value } : current)} /></div>
                <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>初始状态</div><Input.TextArea rows={3} value={relationshipDraft.startState} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, startState: event.target.value } : current)} /></div>
                <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>第一次裂缝</div><Input.TextArea rows={3} value={relationshipDraft.crackPoint} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, crackPoint: event.target.value } : current)} /></div>
                <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>关键改变事件</div><Input.TextArea rows={3} value={relationshipDraft.changeEvent} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, changeEvent: event.target.value } : current)} /></div>
                <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>绑定时间轴</div><Select allowClear value={relationshipDraft.changeTimelineEventId} onChange={(value) => setRelationshipDraft((current) => current ? { ...current, changeTimelineEventId: value } : current)} options={timelineOptions} /></div>
                <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>最终状态</div><Input.TextArea rows={3} value={relationshipDraft.endState} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, endState: event.target.value } : current)} /></div>
                <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>当前状态</div><Select value={relationshipDraft.currentStatus} onChange={(value) => setRelationshipDraft((current) => current ? { ...current, currentStatus: value } : current)} options={STATUS_OPTIONS} /></div>
                <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>最近推进章节</div><Select allowClear value={relationshipDraft.lastProgressChapterId} onChange={(value) => setRelationshipDraft((current) => current ? { ...current, lastProgressChapterId: value } : current)} options={chapterOptions} /></div>
                <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>停滞原因</div><Input.TextArea rows={3} value={relationshipDraft.stalledReason} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, stalledReason: event.target.value } : current)} /></div>
                <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>备注</div><Input.TextArea rows={4} value={relationshipDraft.notes} onChange={(event) => setRelationshipDraft((current) => current ? { ...current, notes: event.target.value } : current)} /></div>
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先从左侧选择一对关系。" />) : (characterDraft ? (
              <>
                <div className="guided-step__field-grid">
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>初始状态</div><Input.TextArea rows={3} value={characterDraft.startState} onChange={(event) => setCharacterDraft((current) => current ? { ...current, startState: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>角色想要什么</div><Input.TextArea rows={3} value={characterDraft.surfaceWant} onChange={(event) => setCharacterDraft((current) => current ? { ...current, surfaceWant: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>角色真正需要什么</div><Input.TextArea rows={3} value={characterDraft.deepNeed} onChange={(event) => setCharacterDraft((current) => current ? { ...current, deepNeed: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>核心恐惧</div><Input.TextArea rows={3} value={characterDraft.coreFear} onChange={(event) => setCharacterDraft((current) => current ? { ...current, coreFear: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>误信</div><Input.TextArea rows={3} value={characterDraft.misbelief} onChange={(event) => setCharacterDraft((current) => current ? { ...current, misbelief: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>第一次裂缝章节</div><Select allowClear value={characterDraft.firstCrackChapterId} onChange={(value) => setCharacterDraft((current) => current ? { ...current, firstCrackChapterId: value } : current)} options={chapterOptions} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>关键改变事件</div><Input.TextArea rows={3} value={characterDraft.changeEvent} onChange={(event) => setCharacterDraft((current) => current ? { ...current, changeEvent: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>绑定时间轴</div><Select allowClear value={characterDraft.changeTimelineEventId} onChange={(value) => setCharacterDraft((current) => current ? { ...current, changeTimelineEventId: value } : current)} options={timelineOptions} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>最终状态</div><Input.TextArea rows={3} value={characterDraft.endState} onChange={(event) => setCharacterDraft((current) => current ? { ...current, endState: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>当前状态</div><Select value={characterDraft.currentStatus} onChange={(value) => setCharacterDraft((current) => current ? { ...current, currentStatus: value } : current)} options={STATUS_OPTIONS} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>最近推进章节</div><Select allowClear value={characterDraft.lastProgressChapterId} onChange={(value) => setCharacterDraft((current) => current ? { ...current, lastProgressChapterId: value } : current)} options={chapterOptions} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>停滞原因</div><Input.TextArea rows={3} value={characterDraft.stalledReason} onChange={(event) => setCharacterDraft((current) => current ? { ...current, stalledReason: event.target.value } : current)} /></div>
                  <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>备注</div><Input.TextArea rows={4} value={characterDraft.notes} onChange={(event) => setCharacterDraft((current) => current ? { ...current, notes: event.target.value } : current)} /></div>
                </div>
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  <strong>推进记录</strong>
                  {selectedArc?.beats.length ? selectedArc.beats.map((beat) => <div key={beat.id} className="novel-note-list__item"><strong>{beat.title || '未命名节点'}</strong><div>{`${beat.beatType}${beat.chapterLabel ? ` · ${beat.chapterLabel}` : ''}`}</div>{beat.summary ? <small>{beat.summary}</small> : null}</div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有推进记录。" />}
                </div>
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先从左侧选择人物。" />)}
          </WorkspacePanel>
          <WorkspacePanel className="novel-character-graph-panel" title="联动跳转">
            <div style={{ display: 'grid', gap: 12 }}>
              {selectedCharacter ? <Button icon={<TeamOutlined />} onClick={() => navigate(`/novels/${novelId}/characters?characterId=${selectedCharacter.id}`)}>打开当前人物档案</Button> : null}
              <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/contracts`)}>去章节合同绑定弧线目标</Button>
              <Button
                icon={<ArrowRightOutlined />}
                onClick={() => {
                  if (tab === 'relationships' && selectedRelation?.id) {
                    navigate(`/novels/${novelId}/revision?relatedPage=characters&entityType=relation&entityId=${selectedRelation.id}`)
                    return
                  }
                  if (selectedCharacter) {
                    navigate(`/novels/${novelId}/revision?relatedPage=characters&entityType=character&entityId=${selectedCharacter.id}`)
                    return
                  }
                  navigate(`/novels/${novelId}/revision?relatedPage=characters`)
                }}
              >
                打开相关修订任务
              </Button>
            </div>
          </WorkspacePanel>
        </div>
      </WorkspacePage>
      <Modal title="登记推进节点" open={beatOpen} onCancel={() => setBeatOpen(false)} onOk={() => void saveBeat()} confirmLoading={beatSaving}>
        <div className="guided-step__field-grid">
          <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>节点类型</div><Select value={beatDraft.beatType} onChange={(value) => setBeatDraft((current) => ({ ...current, beatType: value }))} options={[{ value: 'start', label: '起点' }, { value: 'crack', label: '裂缝' }, { value: 'turn', label: '转折' }, { value: 'change', label: '改变' }, { value: 'end', label: '终点' }, { value: 'progress-note', label: '推进记录' }]} /></div>
          <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>章节</div><Select allowClear value={beatDraft.chapterId} onChange={(value) => setBeatDraft((current) => ({ ...current, chapterId: value }))} options={chapterOptions} /></div>
          <div className="guided-step__field-card guided-step__field-card--compact"><div style={{ marginBottom: 8, fontWeight: 600 }}>时间轴事件</div><Select allowClear value={beatDraft.timelineEventId} onChange={(value) => setBeatDraft((current) => ({ ...current, timelineEventId: value }))} options={timelineOptions} /></div>
          <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>标题</div><Input value={beatDraft.title} onChange={(event) => setBeatDraft((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="guided-step__field-card"><div style={{ marginBottom: 8, fontWeight: 600 }}>说明</div><Input.TextArea rows={4} value={beatDraft.summary} onChange={(event) => setBeatDraft((current) => ({ ...current, summary: event.target.value }))} /></div>
        </div>
      </Modal>
    </>
  )
}
