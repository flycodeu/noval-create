import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Empty, Input, Modal, Select, Spin, Tag, message } from 'antd'
import { ArrowRightOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, TeamOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
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
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import './index.css'

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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="novel-character-arc-center__field-label">{children}</div>
}

function buildCharacterDraft(character: Character | null, dashboard: CharacterArcDashboard | null): CharacterArcInput | null {
  if (!character || !dashboard) return null
  const arc = dashboard.characterArcs.find((item) => item.characterId === character.id)
  return {
    id: arc?.id,
    novelId: character.novelId,
    characterId: character.id,
    startState: firstTruthyText(arc?.startState),
    surfaceWant: firstTruthyText(arc?.surfaceWant, character.surfaceDesire),
    deepNeed: firstTruthyText(arc?.deepNeed, character.deepNeed),
    coreFear: firstTruthyText(arc?.coreFear, character.coreFear),
    misbelief: firstTruthyText(arc?.misbelief, character.selfDeception),
    firstCrackChapterId: arc?.firstCrackChapterId,
    changeEvent: firstTruthyText(arc?.changeEvent),
    changeTimelineEventId: arc?.changeTimelineEventId,
    endState: firstTruthyText(arc?.endState),
    currentStatus: arc?.currentStatus || 'draft',
    lastProgressChapterId: arc?.lastProgressChapterId,
    stalledReason: firstTruthyText(arc?.stalledReason),
    notes: firstTruthyText(arc?.notes, character.characterArc),
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
    relationLabelSnapshot: firstTruthyText(arc?.relationLabelSnapshot, relation.relationLabel),
    relationTypeSnapshot: firstTruthyText(arc?.relationTypeSnapshot, relation.relationType),
    startState: firstTruthyText(arc?.startState),
    crackPoint: firstTruthyText(arc?.crackPoint),
    changeEvent: firstTruthyText(arc?.changeEvent),
    changeTimelineEventId: arc?.changeTimelineEventId,
    endState: firstTruthyText(arc?.endState),
    currentStatus: arc?.currentStatus || 'draft',
    lastProgressChapterId: arc?.lastProgressChapterId,
    stalledReason: firstTruthyText(arc?.stalledReason),
    notes: firstTruthyText(arc?.notes),
  }
}

function firstTruthyText(...values: Array<string | null | undefined>): string {
  return values.find((value) => Boolean(value)) || ''
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function CharacterArcCenterPage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dashboard, setDashboard] = useState<CharacterArcDashboard | null>(null)
  const [tab, setTab] = useState<'protagonist' | 'characters' | 'relationships'>('protagonist')
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null)
  const [selectedRelationKey, setSelectedRelationKey] = useState<string | null>(null)
  const [characterDraft, setCharacterDraft] = useState<CharacterArcInput | null>(null)
  const [relationshipDraft, setRelationshipDraft] = useState<RelationshipArcInput | null>(null)
  const [keywordInput, setKeywordInput] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)
  const [saving, setSaving] = useState(false)
  const [beatSaving, setBeatSaving] = useState(false)
  const [beatOpen, setBeatOpen] = useState(false)
  const [beatDraft, setBeatDraft] = useState<CharacterArcBeatInput>({ novelId, arcId: 0, beatType: 'progress-note', title: '', summary: '', status: 'logged' })
  const refreshRequestRef = useRef(0)
  const draftDirtyRef = useRef(false)

  const setDraftDirty = useCallback((value: boolean) => {
    draftDirtyRef.current = value
    setHasUnsavedChanges(value)
  }, [])

  const markDraftDirty = useCallback(() => setDraftDirty(true), [setDraftDirty])

  const updateCharacterDraft = useCallback((patch: Partial<CharacterArcInput>) => {
    markDraftDirty()
    setCharacterDraft((current) => current ? { ...current, ...patch } : current)
  }, [markDraftDirty])

  const updateRelationshipDraft = useCallback((patch: Partial<RelationshipArcInput>) => {
    markDraftDirty()
    setRelationshipDraft((current) => current ? { ...current, ...patch } : current)
  }, [markDraftDirty])

  const refresh = useCallback(async (showLoading = false) => {
    const requestId = ++refreshRequestRef.current
    if (showLoading) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const nextDashboard = await window.electron.characterArc.getArcDashboard(novelId)
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

  useEffect(() => { void refresh(true) }, [refresh])

  const characters = useMemo(() => dashboard?.availableCharacters || [], [dashboard?.availableCharacters])
  const protagonistCharacters = useMemo(() => characters.filter((item) => item.roleType === 'protagonist'), [characters])
  const keyCharacters = useMemo(() => (
    characters.filter((item) => item.roleType !== 'protagonist' && (item.roleType !== 'minor' || dashboard?.characterArcs.some((arc) => arc.characterId === item.id)))
  ), [characters, dashboard?.characterArcs])
  const relations = useMemo(() => dashboard?.availableRelations || [], [dashboard?.availableRelations])
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
    } else if (!selectedCharacterId || !characters.some((item) => item.id === selectedCharacterId)) {
      setSelectedCharacterId(dashboard.protagonistArc?.characterId || protagonistCharacters[0]?.id || dashboard.characterArcs[0]?.characterId || keyCharacters[0]?.id || null)
    }
    const relationParam = searchParams.get('pair')
    if (relationParam && relations.some((item) => pairKey(item.charAId, item.charBId) === relationParam)) {
      setSelectedRelationKey(relationParam)
    } else if (!selectedRelationKey || !relations.some((item) => pairKey(item.charAId, item.charBId) === selectedRelationKey)) {
      const firstArc = dashboard.relationshipArcs[0]
      setSelectedRelationKey(firstArc ? pairKey(firstArc.charAId, firstArc.charBId) : (relations[0] ? pairKey(relations[0].charAId, relations[0].charBId) : null))
    }
  }, [characters, dashboard, keyCharacters, protagonistCharacters, relations, searchParams, selectedCharacterId, selectedRelationKey])

  useEffect(() => {
    if (draftDirtyRef.current) return
    setCharacterDraft(buildCharacterDraft(selectedCharacter, dashboard))
    setDraftDirty(false)
  }, [dashboard, selectedCharacter, setDraftDirty])
  useEffect(() => {
    if (draftDirtyRef.current) return
    setRelationshipDraft(buildRelationshipDraft(novelId, selectedRelation, dashboard))
    setDraftDirty(false)
  }, [dashboard, novelId, selectedRelation, setDraftDirty])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  const filteredCharacters = useMemo(() => {
    const needle = keywordInput.trim().toLowerCase()
    const source = tab === 'protagonist' ? protagonistCharacters : keyCharacters
    if (!needle) return source
    return source.filter((item) => [
      item.fullName,
      item.occupation,
      item.goals,
      item.innerConflict,
      item.characterArc,
    ].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [keyCharacters, keywordInput, protagonistCharacters, tab])

  const filteredRelations = useMemo(() => {
    const needle = keywordInput.trim().toLowerCase()
    if (!needle) return relations
    return relations.filter((item) => {
      const charA = characters.find((entry) => entry.id === item.charAId)?.fullName || ''
      const charB = characters.find((entry) => entry.id === item.charBId)?.fullName || ''
      return [charA, charB, item.relationLabel, item.relationType, item.description].filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [characters, keywordInput, relations])

  const chapterOptions = useMemo(() => (dashboard?.chapters || []).map((item) => ({ value: item.id, label: `第${item.chapterNum}章 ${item.title}`.trim() })), [dashboard])
  const timelineOptions = useMemo(() => (dashboard?.timelineEvents || []).map((item) => ({ value: item.id, label: `${item.eventTitle} · ${item.timeLabel}` })), [dashboard])

  const saveCurrent = async () => {
    setSaving(true)
    try {
      if (tab === 'relationships') {
        if (!relationshipDraft) return
        await window.electron.characterArc.upsertRelationshipArc(relationshipDraft)
        message.success(getUserFacingMessage('characterArc.relationshipSaved'))
      } else {
        if (!characterDraft) return
        await window.electron.characterArc.upsertCharacterArc(characterDraft)
        message.success(getUserFacingMessage('characterArc.characterSaved'))
      }
      setDraftDirty(false)
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const saveBeat = async () => {
    if (!selectedArc?.id) return
    setBeatSaving(true)
    try {
      await window.electron.characterArc.upsertCharacterArcBeat({ ...beatDraft, novelId, arcId: selectedArc.id })
      message.success(getUserFacingMessage('characterArc.progressSaved'))
      setBeatOpen(false)
      setBeatDraft({ novelId, arcId: selectedArc.id, beatType: 'progress-note', title: '', summary: '', status: 'logged' })
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'characterArc.beatSaveFailed'))
    } finally {
      setBeatSaving(false)
    }
  }

  const confirmDraftNavigation = useCallback((action: () => void) => {
    if (!draftDirtyRef.current) {
      action()
      return
    }
    Modal.confirm({
      title: '当前弧线还有未保存修改',
      content: '切换人物、关系或弧线类型会放弃当前编辑内容。要先保存，还是放弃修改继续？',
      okText: '放弃并切换',
      cancelText: '留下继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        setDraftDirty(false)
        action()
      },
    })
  }, [setDraftDirty])

  const selectCharacter = useCallback((id: number) => {
    confirmDraftNavigation(() => {
      setSelectedCharacterId(id)
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('tab', tab)
        next.set('characterId', String(id))
        next.delete('pair')
        return next
      })
    })
  }, [confirmDraftNavigation, setSearchParams, tab])

  const selectRelation = useCallback((key: string) => {
    confirmDraftNavigation(() => {
      setSelectedRelationKey(key)
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('tab', 'relationships')
        next.set('pair', key)
        next.delete('characterId')
        return next
      })
    })
  }, [confirmDraftNavigation, setSearchParams])

  const switchTab = useCallback((next: typeof tab) => {
    confirmDraftNavigation(() => {
      setTab(next)
      setKeywordInput('')
      setSearchParams((current) => {
        const params = new URLSearchParams(current)
        params.set('tab', next)
        return params
      })
    })
  }, [confirmDraftNavigation, setSearchParams])

  const renderCharacterList = (items: Character[]) => (
    <div className="novel-character-arc-center__list">
      {items.map((item) => {
        const arc = dashboard?.characterArcs.find((entry) => entry.characterId === item.id)
        return (
          <button key={item.id} type="button" data-character-arc-list-row className={`novel-list-card novel-character-arc-center__list-card ${selectedCharacterId === item.id ? 'novel-list-card--active' : ''}`} onClick={() => selectCharacter(item.id)}>
            <div className="novel-character-arc-center__row-main">
              <strong>{item.fullName}</strong>
              <Tag color={arc ? (arc.currentStatus === 'completed' ? 'success' : arc.currentStatus === 'stalled' ? 'warning' : 'processing') : 'default'}>{arc ? STATUS_OPTIONS.find((option) => option.value === arc.currentStatus)?.label || arc.currentStatus : '未建弧'}</Tag>
            </div>
            <span className="novel-character-arc-center__row-meta">{[item.roleType === 'protagonist' ? '主角' : item.roleType === 'major' ? '主要人物' : '关键角色', arc?.lastProgressChapterLabel || '尚无推进章', arc ? `${arc.beatCount} 条记录` : '待建立'].join(' · ')}</span>
            <span className="novel-character-arc-center__row-desc">{arc?.latestBeatSummary || arc?.changeEvent || item.characterArc || item.innerConflict || '还没有建立持续变化轨迹。'}</span>
          </button>
        )
      })}
      {items.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可编辑对象。" /> : null}
    </div>
  )

  const renderRelationList = () => (
    <div className="novel-character-arc-center__list">
      {filteredRelations.map((item) => {
        const currentKey = pairKey(item.charAId, item.charBId)
        const arc = dashboard?.relationshipArcs.find((entry) => pairKey(entry.charAId, entry.charBId) === currentKey)
        const charA = characters.find((entry) => entry.id === item.charAId)?.fullName || '未知角色'
        const charB = characters.find((entry) => entry.id === item.charBId)?.fullName || '未知角色'
        return (
          <button key={currentKey} type="button" data-character-arc-list-row className={`novel-list-card novel-character-arc-center__list-card ${selectedRelationKey === currentKey ? 'novel-list-card--active' : ''}`} onClick={() => selectRelation(currentKey)}>
            <div className="novel-character-arc-center__row-main">
              <strong>{`${charA} × ${charB}`}</strong>
              <Tag color={arc ? (arc.currentStatus === 'completed' ? 'success' : arc.currentStatus === 'stalled' ? 'warning' : 'processing') : 'default'}>{arc ? STATUS_OPTIONS.find((option) => option.value === arc.currentStatus)?.label || arc.currentStatus : '未建弧'}</Tag>
            </div>
            <span className="novel-character-arc-center__row-meta">{[item.relationLabel || item.relationType || '未命名关系', arc?.lastProgressChapterLabel || '尚无推进章', arc?.id ? '已建立弧线' : '待建立'].join(' · ')}</span>
            <span className="novel-character-arc-center__row-desc">{arc?.changeEvent || item.relationLabel || item.description || '还没有拆成阶段变化。'}</span>
          </button>
        )
      })}
      {filteredRelations.length <= 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={relations.length > 0 ? '当前搜索没有关系' : '先去角色系统建立人物关系。'} /> : null}
    </div>
  )

  if (loading && !dashboard) {
    return <WorkspacePage title="人物弧线中心"><WorkspacePanel title="正在加载"><Spin /></WorkspacePanel></WorkspacePage>
  }

  return (
    <>
      <WorkspacePage
        chrome="shared"
        className="novel-character-arc-center"
        title="人物弧线中心"
        actionContract={{
          primary: { key: 'save', label: '保存当前弧线', icon: <SaveOutlined />, loading: saving, disabled: !characterDraft && !relationshipDraft, onClick: () => void saveCurrent() },
          secondary: [
            { key: 'beat', label: '登记推进', icon: <PlusOutlined />, disabled: tab === 'relationships' || !selectedArc?.id, onClick: () => setBeatOpen(true) },
            { key: 'contracts', label: '去章节合同', icon: <EditOutlined />, onClick: () => navigate(buildWorkspaceRoute(novelId, 'contracts')) },
          ],
          more: { items: [{ key: 'refresh', label: '刷新弧线数据', icon: <ReloadOutlined />, onClick: () => void refresh() }] },
        }}
        contextSummary={<WorkspaceContextSummary items={[{ label: '书名', value: currentNovel?.title || '未命名小说' }, { label: '主角弧', value: dashboard?.protagonistArc ? '已建立' : '待建立' }, { label: '角色弧', value: `${dashboard?.characterArcs.length || 0} 条` }, { label: '关系弧', value: `${dashboard?.relationshipArcs.length || 0} 条` }]} />}
        metrics={<><WorkspaceMetric label="停滞弧线" value={(dashboard?.stalledCharacterCount || 0) + (dashboard?.stalledRelationshipCount || 0)} tone="warm" /><WorkspaceMetric label="关键角色候选" value={keyCharacters.length} /><WorkspaceMetric label="最近推进" value={selectedArc?.lastProgressChapterLabel || '未记录'} tone="cool" /></>}
      >
        <div className="novel-character-arc-center__status-rail" data-character-arc-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
          <span className={`novel-character-arc-center__status-dot${hasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
          <strong>{hasUnsavedChanges ? '有未保存修改' : '已与当前弧线同步'}</strong>
          <span>{tab === 'relationships' ? (selectedRelation ? `${selectedRelation.relationLabel || '当前关系'} · 关系弧` : '从左侧选择关系对') : (selectedCharacter ? `${selectedCharacter.fullName} · 人物弧` : '从左侧选择人物')}</span>
        </div>
        {refreshing ? <div className="novel-dashboard__refresh-indicator novel-workspace__refresh"><Spin size="small" /><span>正在同步人物弧线数据</span></div> : null}
        {characters.length <= 0 ? <Alert type="warning" showIcon message="还没有角色资产" description="先去角色系统建立主角和关键人物，再回来补人物弧线。" /> : null}
        <div className="novel-character-arc-center__tabs">
          {[
            ['protagonist', '主角弧'],
            ['characters', '关键角色弧'],
            ['relationships', '关系弧'],
          ].map(([value, label]) => <Button key={value} type={tab === value ? 'primary' : 'default'} onClick={() => switchTab(value as typeof tab)}>{label}</Button>)}
        </div>
        <div className="novel-character-studio">
          <WorkspacePanel
            className="novel-character-studio__sidebar novel-character-arc-center__sidebar"
            title={tab === 'relationships' ? '关系对' : tab === 'protagonist' ? '主角' : '关键角色'}
            scrollable
            sticky
            extra={(
              <div className="novel-character-arc-center__list-tools">
                <Input.Search value={keywordInput} allowClear placeholder={tab === 'relationships' ? '搜索人物、关系或描述' : '搜索姓名、目标或矛盾'} onChange={(event) => setKeywordInput(event.target.value)} />
                <span>{tab === 'relationships' ? `${filteredRelations.length} / ${relations.length} 对` : `${filteredCharacters.length} / ${(tab === 'protagonist' ? protagonistCharacters : keyCharacters).length} 人`}</span>
              </div>
            )}
          >
            <div data-character-arc-list>{tab === 'relationships' ? renderRelationList() : renderCharacterList(filteredCharacters)}</div>
          </WorkspacePanel>
          <WorkspacePanel
            className="novel-character-studio__editor"
            title={tab === 'relationships' ? '关系弧编辑' : '人物弧编辑'}
            scrollable
            sticky
            extra={tab === 'relationships'
              ? (relationshipDraft ? (
                <AIGenerateButton
                  novelId={novelId}
                  label="AI 补全·当前关系弧"
                  intent={hasFilledValues([
                    relationshipDraft.startState,
                    relationshipDraft.crackPoint,
                    relationshipDraft.changeEvent,
                    relationshipDraft.endState,
                  ]) ? 'complete' : 'generate'}
                  isJson
                  buildMessages={() => buildDraftMessages({
                    task: `关系弧${selectedRelation ? ` · ${characters.find((item) => item.id === selectedRelation.charAId)?.fullName || '角色A'} × ${characters.find((item) => item.id === selectedRelation.charBId)?.fullName || '角色B'}` : ''}`,
                    mode: hasFilledValues([
                      relationshipDraft.startState,
                      relationshipDraft.crackPoint,
                      relationshipDraft.changeEvent,
                      relationshipDraft.endState,
                    ]) ? 'optimize' : 'replace',
                    context: buildPlanningContextSections(currentNovel, {
                      includeSubplots: true,
                      extraSections: [
                        { label: '当前关系对象', value: selectedRelation ? `${characters.find((item) => item.id === selectedRelation.charAId)?.fullName || '角色A'} × ${characters.find((item) => item.id === selectedRelation.charBId)?.fullName || '角色B'}` : '' },
                        { label: '已有关系描述', value: selectedRelation?.description || selectedRelation?.relationLabel || '' },
                      ],
                    }),
                    fields: [
                      { key: 'relationLabelSnapshot', label: '关系称呼', value: relationshipDraft.relationLabelSnapshot, hint: '写当前关系最准确的称呼。' },
                      { key: 'relationTypeSnapshot', label: '关系类型', value: relationshipDraft.relationTypeSnapshot, hint: '写关系属性，例如盟友、对手、亲属。' },
                      { key: 'startState', label: '初始状态', value: relationshipDraft.startState, hint: '写故事开始时两人的状态。' },
                      { key: 'crackPoint', label: '第一次裂缝', value: relationshipDraft.crackPoint, hint: '写关系第一次明显失衡的节点。' },
                      { key: 'changeEvent', label: '关键改变事件', value: relationshipDraft.changeEvent, hint: '写迫使关系改写的关键事件。' },
                      { key: 'endState', label: '最终状态', value: relationshipDraft.endState, hint: '写关系最终落点。' },
                      { key: 'stalledReason', label: '停滞原因', value: relationshipDraft.stalledReason, hint: '若停滞，写卡住原因。' },
                      { key: 'notes', label: '备注', value: relationshipDraft.notes, hint: '补充误判、回收点和隐藏张力。' },
                    ],
                    requirements: [
                      '必须与人物设定、章节推进和世界规则一致。',
                      '只生成关系弧，不代替人物弧或章节剧情。'
                    ],
                  })}
                  onResult={(raw) => {
                    const draft = parseDraftJson<Partial<RelationshipArcInput>>(raw)
                    markDraftDirty()
                    setRelationshipDraft((current) => current ? {
                      ...current,
                      relationLabelSnapshot: typeof draft.relationLabelSnapshot === 'string' ? draft.relationLabelSnapshot : current.relationLabelSnapshot,
                      relationTypeSnapshot: typeof draft.relationTypeSnapshot === 'string' ? draft.relationTypeSnapshot : current.relationTypeSnapshot,
                      startState: typeof draft.startState === 'string' ? draft.startState : current.startState,
                      crackPoint: typeof draft.crackPoint === 'string' ? draft.crackPoint : current.crackPoint,
                      changeEvent: typeof draft.changeEvent === 'string' ? draft.changeEvent : current.changeEvent,
                      endState: typeof draft.endState === 'string' ? draft.endState : current.endState,
                      stalledReason: typeof draft.stalledReason === 'string' ? draft.stalledReason : current.stalledReason,
                      notes: typeof draft.notes === 'string' ? draft.notes : current.notes,
                    } : current)
                  }}
                />
              ) : undefined)
              : (characterDraft ? (
                <AIGenerateButton
                  novelId={novelId}
                  label="AI 补全·当前人物弧"
                  intent={hasFilledValues([
                    characterDraft.startState,
                    characterDraft.surfaceWant,
                    characterDraft.deepNeed,
                    characterDraft.coreFear,
                    characterDraft.misbelief,
                    characterDraft.changeEvent,
                    characterDraft.endState,
                  ]) ? 'complete' : 'generate'}
                  isJson
                  buildMessages={() => buildDraftMessages({
                    task: `人物弧${selectedCharacter ? ` · ${selectedCharacter.fullName}` : ''}`,
                    mode: hasFilledValues([
                      characterDraft.startState,
                      characterDraft.surfaceWant,
                      characterDraft.deepNeed,
                      characterDraft.coreFear,
                      characterDraft.misbelief,
                      characterDraft.changeEvent,
                      characterDraft.endState,
                    ]) ? 'optimize' : 'replace',
                    context: buildPlanningContextSections(currentNovel, {
                      includeSubplots: true,
                      extraSections: [
                        { label: '当前人物', value: selectedCharacter ? [
                          selectedCharacter.fullName,
                          selectedCharacter.roleType ? `角色定位：${selectedCharacter.roleType}` : '',
                          selectedCharacter.innerConflict ? `内在冲突：${selectedCharacter.innerConflict}` : '',
                          selectedCharacter.characterArc ? `现有人物弧：${selectedCharacter.characterArc}` : '',
                        ].filter(Boolean).join('\n') : '' },
                      ],
                    }),
                    fields: [
                      { key: 'startState', label: '初始状态', value: characterDraft.startState, hint: '写开局心理、关系或能力状态。' },
                      { key: 'surfaceWant', label: '角色想要什么', value: characterDraft.surfaceWant, hint: '写表层目标。' },
                      { key: 'deepNeed', label: '角色真正需要什么', value: characterDraft.deepNeed, hint: '写深层缺口。' },
                      { key: 'coreFear', label: '核心恐惧', value: characterDraft.coreFear, hint: '写最不愿面对的失去。' },
                      { key: 'misbelief', label: '误信', value: characterDraft.misbelief, hint: '写错误信念。' },
                      { key: 'changeEvent', label: '关键改变事件', value: characterDraft.changeEvent, hint: '写迫使人物真正变化的事件。' },
                      { key: 'endState', label: '最终状态', value: characterDraft.endState, hint: '写人物最终落点。' },
                      { key: 'stalledReason', label: '停滞原因', value: characterDraft.stalledReason, hint: '若停滞，写卡住原因。' },
                      { key: 'notes', label: '备注', value: characterDraft.notes, hint: '补充隐藏动机、代价或回收点。' },
                    ],
                    requirements: [
                      '必须和角色档案、故事设计、终局方向一致。',
                      '不要把人物弧写成章节摘要。'
                    ],
                  })}
                  onResult={(raw) => {
                    const draft = parseDraftJson<Partial<CharacterArcInput>>(raw)
                    markDraftDirty()
                    setCharacterDraft((current) => current ? {
                      ...current,
                      startState: typeof draft.startState === 'string' ? draft.startState : current.startState,
                      surfaceWant: typeof draft.surfaceWant === 'string' ? draft.surfaceWant : current.surfaceWant,
                      deepNeed: typeof draft.deepNeed === 'string' ? draft.deepNeed : current.deepNeed,
                      coreFear: typeof draft.coreFear === 'string' ? draft.coreFear : current.coreFear,
                      misbelief: typeof draft.misbelief === 'string' ? draft.misbelief : current.misbelief,
                      changeEvent: typeof draft.changeEvent === 'string' ? draft.changeEvent : current.changeEvent,
                      endState: typeof draft.endState === 'string' ? draft.endState : current.endState,
                      stalledReason: typeof draft.stalledReason === 'string' ? draft.stalledReason : current.stalledReason,
                      notes: typeof draft.notes === 'string' ? draft.notes : current.notes,
                    } : current)
                  }}
                />
              ) : undefined)}
          >
            {tab === 'relationships' ? (relationshipDraft ? (
              <>
                <div className="novel-character-arc-center__selection-summary">
                  <span>当前关系</span>
                  <strong>{selectedRelation ? `${selectedRelation.relationLabel || '未命名关系'} · ${characters.find((item) => item.id === selectedRelation.charAId)?.fullName || '角色A'} × ${characters.find((item) => item.id === selectedRelation.charBId)?.fullName || '角色B'}` : '关系弧编辑'}</strong>
                </div>
                <div className="guided-step__field-grid novel-character-arc-center__field-grid--core">
                  <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>关系称呼</FieldLabel><Input value={relationshipDraft.relationLabelSnapshot} onChange={(event) => updateRelationshipDraft({ relationLabelSnapshot: event.target.value })} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>关系类型</FieldLabel><Input value={relationshipDraft.relationTypeSnapshot} onChange={(event) => updateRelationshipDraft({ relationTypeSnapshot: event.target.value })} /></div>
                  <div className="guided-step__field-card"><FieldLabel>初始状态</FieldLabel><Input.TextArea rows={4} value={relationshipDraft.startState} onChange={(event) => updateRelationshipDraft({ startState: event.target.value })} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>当前状态</FieldLabel><Select value={relationshipDraft.currentStatus} onChange={(value) => updateRelationshipDraft({ currentStatus: value })} options={STATUS_OPTIONS} /></div>
                </div>
                <details className="novel-character-arc-center__advanced" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
                  <summary><span>展开关系弧细节</span><small>裂缝、改变事件、终局与章节绑定按需维护</small></summary>
                  <div className="guided-step__field-grid">
                    <div className="guided-step__field-card"><FieldLabel>第一次裂缝</FieldLabel><Input.TextArea rows={4} value={relationshipDraft.crackPoint} onChange={(event) => updateRelationshipDraft({ crackPoint: event.target.value })} /></div>
                    <div className="guided-step__field-card"><FieldLabel>关键改变事件</FieldLabel><Input.TextArea rows={4} value={relationshipDraft.changeEvent} onChange={(event) => updateRelationshipDraft({ changeEvent: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>绑定时间轴</FieldLabel><Select allowClear value={relationshipDraft.changeTimelineEventId} onChange={(value) => updateRelationshipDraft({ changeTimelineEventId: value })} options={timelineOptions} /></div>
                    <div className="guided-step__field-card"><FieldLabel>最终状态</FieldLabel><Input.TextArea rows={4} value={relationshipDraft.endState} onChange={(event) => updateRelationshipDraft({ endState: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>最近推进章节</FieldLabel><Select allowClear value={relationshipDraft.lastProgressChapterId} onChange={(value) => updateRelationshipDraft({ lastProgressChapterId: value })} options={chapterOptions} /></div>
                    <div className="guided-step__field-card"><FieldLabel>停滞原因</FieldLabel><Input.TextArea rows={4} value={relationshipDraft.stalledReason} onChange={(event) => updateRelationshipDraft({ stalledReason: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--full"><FieldLabel>备注</FieldLabel><Input.TextArea rows={4} value={relationshipDraft.notes} onChange={(event) => updateRelationshipDraft({ notes: event.target.value })} /></div>
                  </div>
                </details>
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先从左侧选择一对关系。" />) : (characterDraft ? (
              <>
                <div className="novel-character-arc-center__selection-summary">
                  <span>当前人物</span>
                  <strong>{selectedCharacter?.fullName || '人物弧编辑'}</strong>
                  <small>{selectedCharacter?.characterArc || selectedCharacter?.innerConflict || '先建立一个能被章节看见的变化方向。'}</small>
                </div>
                <div className="guided-step__field-grid novel-character-arc-center__field-grid--core">
                  <div className="guided-step__field-card"><FieldLabel>初始状态</FieldLabel><Input.TextArea rows={4} value={characterDraft.startState} onChange={(event) => updateCharacterDraft({ startState: event.target.value })} /></div>
                  <div className="guided-step__field-card"><FieldLabel>角色想要什么</FieldLabel><Input.TextArea rows={4} value={characterDraft.surfaceWant} onChange={(event) => updateCharacterDraft({ surfaceWant: event.target.value })} /></div>
                  <div className="guided-step__field-card"><FieldLabel>真正需要什么</FieldLabel><Input.TextArea rows={4} value={characterDraft.deepNeed} onChange={(event) => updateCharacterDraft({ deepNeed: event.target.value })} /></div>
                  <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>当前状态</FieldLabel><Select value={characterDraft.currentStatus} onChange={(value) => updateCharacterDraft({ currentStatus: value })} options={STATUS_OPTIONS} /></div>
                </div>
                <details className="novel-character-arc-center__advanced" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
                  <summary><span>展开人物弧细节</span><small>恐惧、裂缝、改变事件、终局与停滞原因按需维护</small></summary>
                  <div className="guided-step__field-grid">
                    <div className="guided-step__field-card"><FieldLabel>核心恐惧</FieldLabel><Input.TextArea rows={4} value={characterDraft.coreFear} onChange={(event) => updateCharacterDraft({ coreFear: event.target.value })} /></div>
                    <div className="guided-step__field-card"><FieldLabel>误信</FieldLabel><Input.TextArea rows={4} value={characterDraft.misbelief} onChange={(event) => updateCharacterDraft({ misbelief: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>第一次裂缝章节</FieldLabel><Select allowClear value={characterDraft.firstCrackChapterId} onChange={(value) => updateCharacterDraft({ firstCrackChapterId: value })} options={chapterOptions} /></div>
                    <div className="guided-step__field-card"><FieldLabel>关键改变事件</FieldLabel><Input.TextArea rows={4} value={characterDraft.changeEvent} onChange={(event) => updateCharacterDraft({ changeEvent: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>绑定时间轴</FieldLabel><Select allowClear value={characterDraft.changeTimelineEventId} onChange={(value) => updateCharacterDraft({ changeTimelineEventId: value })} options={timelineOptions} /></div>
                    <div className="guided-step__field-card"><FieldLabel>最终状态</FieldLabel><Input.TextArea rows={4} value={characterDraft.endState} onChange={(event) => updateCharacterDraft({ endState: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--compact"><FieldLabel>最近推进章节</FieldLabel><Select allowClear value={characterDraft.lastProgressChapterId} onChange={(value) => updateCharacterDraft({ lastProgressChapterId: value })} options={chapterOptions} /></div>
                    <div className="guided-step__field-card"><FieldLabel>停滞原因</FieldLabel><Input.TextArea rows={4} value={characterDraft.stalledReason} onChange={(event) => updateCharacterDraft({ stalledReason: event.target.value })} /></div>
                    <div className="guided-step__field-card guided-step__field-card--full"><FieldLabel>备注</FieldLabel><Input.TextArea rows={4} value={characterDraft.notes} onChange={(event) => updateCharacterDraft({ notes: event.target.value })} /></div>
                  </div>
                </details>
                <div className="novel-character-arc-center__beats">
                  <strong>推进记录</strong>
                  {selectedArc?.beats.length ? selectedArc.beats.map((beat) => <div key={beat.id} className="novel-note-list__item"><strong>{beat.title || '未命名节点'}</strong><div>{`${beat.beatType}${beat.chapterLabel ? ` · ${beat.chapterLabel}` : ''}`}</div>{beat.summary ? <small>{beat.summary}</small> : null}</div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有推进记录。" />}
                </div>
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先从左侧选择人物。" />)}
          </WorkspacePanel>
          <WorkspacePanel className="novel-character-graph-panel" title="联动跳转">
            <div className="novel-ui-stack-md">
              {selectedCharacter ? <Button icon={<TeamOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, `characters?characterId=${selectedCharacter.id}`))}>打开当前人物档案</Button> : null}
              <Button icon={<EditOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'contracts'))}>去章节合同绑定弧线目标</Button>
              <Button
                icon={<ArrowRightOutlined />}
                onClick={() => {
                  if (tab === 'relationships' && selectedRelation?.id) {
                    navigate(buildWorkspaceRoute(novelId, `revision?relatedPage=characters&entityType=relation&entityId=${selectedRelation.id}`))
                    return
                  }
                  if (selectedCharacter) {
                    navigate(buildWorkspaceRoute(novelId, `revision?relatedPage=characters&entityType=character&entityId=${selectedCharacter.id}`))
                    return
                  }
                  navigate(buildWorkspaceRoute(novelId, 'revision?relatedPage=characters'))
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
          <div className="guided-step__field-card guided-step__field-card--full">
            <AIGenerateButton
              novelId={novelId}
              label="AI 生成·推进节点"
              intent={hasFilledValues([beatDraft.title, beatDraft.summary]) ? 'complete' : 'generate'}
              isJson
              disabled={!selectedArc}
              buildMessages={() => buildDraftMessages({
                task: selectedArc ? `人物弧推进节点 · ${selectedArc.characterName}` : '人物弧推进节点',
                mode: hasFilledValues([beatDraft.title, beatDraft.summary]) ? 'optimize' : 'replace',
                context: buildPlanningContextSections(currentNovel, {
                  includeSubplots: true,
                  extraSections: [
                    { label: '当前人物弧', value: selectedArc ? [
                      `人物：${selectedArc.characterName}`,
                      selectedArc.startState ? `初始状态：${selectedArc.startState}` : '',
                      selectedArc.changeEvent ? `关键改变事件：${selectedArc.changeEvent}` : '',
                      selectedArc.endState ? `最终状态：${selectedArc.endState}` : '',
                    ].filter(Boolean).join('\n') : '' },
                  ],
                }),
                fields: [
                  { key: 'title', label: '标题', value: beatDraft.title, hint: '写当前推进节点名称。' },
                  { key: 'summary', label: '说明', value: beatDraft.summary, hint: '写这一节点让人物发生了什么实质变化。' },
                ],
                requirements: [
                  '只写当前推进节点，不要重写整条人物弧。',
                ],
              })}
              onResult={(raw) => {
                const draft = parseDraftJson<Partial<CharacterArcBeatInput>>(raw)
                setBeatDraft((current) => ({
                  ...current,
                  title: typeof draft.title === 'string' ? draft.title : current.title,
                  summary: typeof draft.summary === 'string' ? draft.summary : current.summary,
                }))
              }}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--compact"><div className="novel-character-arc-center__field-label">节点类型</div><Select value={beatDraft.beatType} onChange={(value) => setBeatDraft((current) => ({ ...current, beatType: value }))} options={[{ value: 'start', label: '起点' }, { value: 'crack', label: '裂缝' }, { value: 'turn', label: '转折' }, { value: 'change', label: '改变' }, { value: 'end', label: '终点' }, { value: 'progress-note', label: '推进记录' }]} /></div>
          <div className="guided-step__field-card guided-step__field-card--compact"><div className="novel-character-arc-center__field-label">章节</div><Select allowClear value={beatDraft.chapterId} onChange={(value) => setBeatDraft((current) => ({ ...current, chapterId: value }))} options={chapterOptions} /></div>
          <div className="guided-step__field-card guided-step__field-card--compact"><div className="novel-character-arc-center__field-label">时间轴事件</div><Select allowClear value={beatDraft.timelineEventId} onChange={(value) => setBeatDraft((current) => ({ ...current, timelineEventId: value }))} options={timelineOptions} /></div>
          <div className="guided-step__field-card"><div className="novel-character-arc-center__field-label">标题</div><Input value={beatDraft.title} onChange={(event) => setBeatDraft((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="guided-step__field-card"><div className="novel-character-arc-center__field-label">说明</div><Input.TextArea rows={6} value={beatDraft.summary} onChange={(event) => setBeatDraft((current) => ({ ...current, summary: event.target.value }))} /></div>
        </div>
      </Modal>
    </>
  )
}
