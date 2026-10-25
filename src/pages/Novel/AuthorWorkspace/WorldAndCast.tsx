import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import { useScopedState } from '@/hooks/useScopedState'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Drawer, Modal, Select, Spin } from 'antd'
import { useSearchParams } from 'react-router-dom'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import type { CreativeStage } from '../../../shared/creative-workflow'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { ATLAS_KIND_LABELS, ATLAS_TABS, WORLD_WORKSPACE_TABS, atlasTabFor, resolveWorldWorkspaceTab, type WorldWorkspaceTab } from './atlas-profile'
import { AtlasEntityLibrary } from './AtlasEntityLibrary'
import { AtlasEntityProfile } from './AtlasEntityProfile'
import { AtlasEntityEditor } from './AtlasEntityEditor'
import { AtlasRelationEditor } from './AtlasRelationEditor'
import { AtlasRelationDetails } from './AtlasRelationDetails'
import { WorldAtlasGraph } from './WorldAtlasGraph'
import { GeographicAtlas } from './GeographicAtlas'
import { atlasIncludesPlanned, atlasMapScope } from './atlas-view-options'
import WorldRules, { type WorldRulesEditState } from './WorldRules'
import ResearchLibrary from './ResearchLibrary'
import ObjectTaskPanel, { type ObjectTaskTarget } from './ObjectTaskPanel'
import { AtlasWorkbench } from './AtlasWorkbench'
import './world-workspace.css'

const STAGES: Record<StoryAtlasEntity['kind'], CreativeStage> = { location: 'map', character: 'characters', faction: 'factions', item: 'items', event: 'events' }
export default function WorldAndCast({ novelId }: { novelId: number }) {
  const [params, setParams] = useSearchParams()
  const tab = resolveWorldWorkspaceTab(params)
  const geographic = tab === 'map' && params.get('mapView') !== 'hierarchy'
  const atChapter = params.has('atChapter') ? Math.max(0, Number(params.get('atChapter')) || 0) : null
  const selectedId = params.get('entity')
  const includePlanned = atlasIncludesPlanned(params)
  const queryScope = JSON.stringify([novelId, atChapter, includePlanned])
  const [relation, setRelation] = useScopedState<StoryAtlasRelation | null>(queryScope, null)
  const [editing, setEditing] = useScopedState<{ entity: StoryAtlasEntity; snapshot: StoryAtlasSnapshot; atChapter: number | null } | null>(novelId, null)
  const [editingRelation, setEditingRelation] = useScopedState<{ relation: StoryAtlasRelation; snapshot: StoryAtlasSnapshot; atChapter: number | null } | null>(novelId, null)
  const [task, setTask] = useState<ObjectTaskTarget | null>(null)
  const [reference, setReference] = useState<'rules' | 'research' | null>(null)
  const [rulesEdit, setRulesEdit] = useState<WorldRulesEditState>({ dirty: false, saving: false })
  const selectedByKind = useRef<Partial<Record<StoryAtlasEntity['kind'], string>>>({})
  const read = useCallback(async () => {
    const [snapshot, chapters] = await Promise.all([
      window.electron.storyAtlas.query({ novelId, ...(atChapter != null ? { atChapter } : {}), includePlanned }),
      window.electron.chapter.list(novelId),
    ])
    return { snapshot, chapters }
  }, [novelId, atChapter, includePlanned])
  const { data, loading, error: loadError, reload: load } = useAsyncSnapshot(read)
  const snapshot = data?.snapshot ?? null
  const parentId = atlasMapScope(params, snapshot, geographic)
  const chapters = data?.chapters ?? []
  useEffect(() => { document.querySelector('.author-shell-main')?.scrollTo({ top: 0 }) }, [tab, parentId, atChapter])
  const error = loadError ? (loadError instanceof Error ? loadError.message : '读取世界与人物失败') : ''
  useEffect(() => { const refresh = () => { void load() }; window.addEventListener('novelforge:creative-completed', refresh); window.addEventListener('focus', refresh); return () => { window.removeEventListener('novelforge:creative-completed', refresh); window.removeEventListener('focus', refresh) } }, [load])
  const activeKind = ATLAS_TABS.find(item => item.key === tab)?.kind || 'location'
  const selected = snapshot?.entities.find(item => item.id === selectedId) || null
  useEffect(() => { if (selected) selectedByKind.current[selected.kind] = selected.id }, [selected])
  const isGraph = tab === 'map' || tab === 'relationships'
  const updateParams = (change: (next: URLSearchParams) => void) => { const next = new URLSearchParams(params); change(next); setParams(next) }
  const select = (entity: StoryAtlasEntity) => { updateParams(next => next.set('entity', entity.id)); requestAnimationFrame(() => document.getElementById('author-entity-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) }
  const openEntity = (entity: StoryAtlasEntity) => updateParams(next => { next.set('tab', atlasTabFor(entity)); next.set('entity', entity.id); if (entity.kind === 'location') { if (entity.parentId) next.set('location', entity.parentId); else next.delete('location') } })
  const changeView = (change: () => void) => {
    if (rulesEdit.saving) return
    if (!rulesEdit.dirty) { change(); return }
    Modal.confirm({ title: '当前规则还有未保存的修改', okText: '放弃并切换', cancelText: '继续编辑', onOk: change })
  }
  const switchTab = (nextTab: WorldWorkspaceTab) => changeView(() => { setRelation(null); setReference(null); updateParams(next => {
    next.set('tab', nextTab); next.delete('kind'); next.delete('view')
    const nextKind = ATLAS_TABS.find(item => item.key === nextTab)?.kind
    if (nextKind) { const id = selectedByKind.current[nextKind]; if (id) next.set('entity', id); else next.delete('entity') }
  }) })
  const drill = (entity: StoryAtlasEntity | null) => updateParams(next => { next.set('tab', 'map'); if (entity) { next.set('location', entity.id); next.set('entity', entity.id); next.delete('mapScope') } else { next.delete('location'); next.delete('entity'); next.set('mapScope', 'world') } })
  const generate = (stage: CreativeStage, request: string, title = selected?.name || WORLD_WORKSPACE_TABS.find(item => item.key === tab)?.label || '世界与人物') => setTask({ title, stage, request, ...(atChapter != null ? { atChapter } : {}) })
  const discussRules = (title: string) => generate('world_rules', `结合现有作品，检查并完善“${title}”。保留已确定内容与当前章位，指出依据不足与冲突，输出可讨论候选。`, title)
  const generateTab = () => {
    if (tab === 'relationships') return generate('relationships', '结合现有人物与已写正文，补充有具体依据的人物关系、相处方式、关系张力及变化。现有关系按稳定 ID 更新，不虚构过去纠葛。')
    const parent = snapshot?.entities.find(item => item.id === parentId)
    generate(STAGES[activeKind], activeKind === 'location' ? `补充${parent ? `“${parent.name}”范围内` : '当前故事需要的'}地理设计：明确区域层级、相对方位与边界、城镇分布、地形水系、风貌生计及交通通路。保留已有地点与设定，尚未展开或待确认的地域标为计划候选。` : activeKind === 'character' ? '结合现有背景与正文补充人物档案：身份定位、性格表现、目标动机、弱点底线、说话与行为习惯、日常轨迹、能力边界，以及有叙事作用的外貌衣着与关联地域；无依据之处保持待定，保留已有设定。' : activeKind === 'faction' ? '结合已有背景和地点补充组织势力：组织特点、立场目标、行事方式、驻地及涉及区域、下属部门与核心岗位职责，关联已知成员；未定岗位标为计划，不凭空虚构人物。' : `结合现有背景、资料与正文补充${ATLAS_KIND_LABELS[activeKind]}，保留已有记录，待确认内容标为计划。`)
  }
  const discuss = (entity: StoryAtlasEntity) => generate(STAGES[entity.kind], `讨论并完善${ATLAS_KIND_LABELS[entity.kind]}“${entity.name}”。结合现有背景、当前章位与关联资料，保留已定事实。${entity.kind === 'character' ? '核对身份、性格表现、动机目标、弱点底线、语言动作习惯、能力代价、外貌衣着及活动区域，未知保持待定。' : entity.kind === 'faction' ? '核对组织特点、驻地与涉及区域、部门结构、岗位职责与现有成员；空缺岗位保持待定，不凭空虚构人物。' : '补足本条资料确有依据的缺项，并检查与关联资料是否一致。'}重大调整请先输出为候选方案。`)
  const discussRelation = (item: StoryAtlasRelation) => {
    const subjectKind = snapshot?.entities.find(entity => entity.id === item.fromId)?.kind
    const stage = item.kind === 'route' ? 'map' : item.kind === 'membership' ? 'factions' : item.kind === 'presence' && subjectKind ? STAGES[subjectKind] : 'relationships'
    generate(stage, `讨论并优化“${item.label}”关联，保留当前章位的已定事实，说明调整依据。${item.kind === 'route' ? '结合地图尺度、地形与交通方式，补充或核对该通路的道路里程、行程耗时与通行方式；无可靠依据处保持待定。' : ''}`)
  }
  return <AuthorPage title="地点、人物与他们的联系"><div className="world-and-cast">
    <div className="atlas-workspace-toolbar"><nav className="author-tabs atlas-primary-tabs" aria-label="世界与人物分区">{WORLD_WORKSPACE_TABS.map(item => <button type="button" key={item.key} disabled={rulesEdit.saving} className={tab === item.key ? 'is-selected' : ''} aria-current={tab === item.key ? 'page' : undefined} onClick={() => { if (tab !== item.key) switchTab(item.key) }}>{item.label}</button>)}</nav></div>
    {tab !== 'rules' && tab !== 'research' && <div className="atlas-context-toolbar"><Select<number | 'all'> aria-label="故事章位" value={atChapter ?? 'all'} onChange={value => { setRelation(null); updateParams(next => { if (value === 'all') next.delete('atChapter'); else next.set('atChapter', String(value)) }) }} options={[{ value: 'all', label: '全部已知设定' }, { value: 0, label: '初始设定 · 第 0 章' }, ...chapters.map(chapter => ({ value: chapter.chapterNum, label: `第 ${chapter.chapterNum} 章 · ${chapter.title || ''}` }))]} /><Checkbox checked={includePlanned} onChange={event => { setRelation(null); updateParams(next => { next.set('includePlanned', String(event.target.checked)) }) }}>{tab === 'map' ? '显示规划地域' : '包含计划'}</Checkbox><span aria-live="polite">{loading && snapshot ? <Spin size="small" /> : null}</span>{tab === 'map' && <nav className="atlas-map-modes" aria-label="地图视图">{[{ key: 'geography', label: '区域地图' }, { key: 'hierarchy', label: '层级图' }].map(mode => <button type="button" key={mode.key} className={(geographic ? 'geography' : 'hierarchy') === mode.key ? 'is-selected' : ''} aria-pressed={(geographic ? 'geography' : 'hierarchy') === mode.key} onClick={() => updateParams(next => next.set('mapView', mode.key))}>{mode.label}</button>)}</nav>}</div>}
    {tab === 'rules' ? <WorldRules novelId={novelId} onDiscuss={discussRules} onEditStateChange={setRulesEdit} /> : tab === 'research' ? <ResearchLibrary novelId={novelId} /> : <>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {!snapshot ? loading ? <div className="author-loading"><Spin /></div> : <EmptyWork title="资料暂未读到" /> : <>
      <AtlasWorkbench resizable={isGraph && !geographic} className={`atlas-workbench ${selected ? 'has-selection' : ''} ${geographic ? 'atlas-workbench--geography' : isGraph ? 'atlas-workbench--graph' : 'atlas-workbench--library'}`}>
        {geographic ? <GeographicAtlas snapshot={snapshot} parentId={parentId} selectedId={selectedId} onSelect={select} onRelation={setRelation} onDrill={drill} onGenerate={generateTab} /> : isGraph ? <WorldAtlasGraph key={tab} mode={tab} snapshot={snapshot} parentId={parentId} selectedId={selectedId} onSelect={select} onRelation={setRelation} onDrill={drill} onGenerate={generateTab} /> : <AtlasEntityLibrary key={tab} kind={activeKind} snapshot={snapshot} selectedId={selectedId} viewScope={queryScope} onSelect={select} onGenerate={generateTab} />}
        {(!geographic || selected) && <section id="author-entity-inspector" className="atlas-profile-panel">{selected ? <AtlasEntityProfile key={selected.id} entity={selected} snapshot={snapshot} chapters={chapters} editingDisabled={loading || Boolean(error)} onOpen={openEntity} onBack={() => updateParams(next => next.delete('entity'))} onShowRules={() => setReference('rules')} onShowResearch={() => setReference('research')} onEdit={() => { if (!loading && !error && snapshot != null) setEditing({ entity: selected, snapshot, atChapter }) }} onDiscuss={() => { if (!loading && !error) discuss(selected) }} onRelation={setRelation} onDrill={drill} /> : <EmptyWork title={selectedId ? '此章位下没有这条资料' : `选择一个${isGraph ? tab === 'map' ? '地点' : '人物或关系' : ATLAS_KIND_LABELS[activeKind]}`} />}</section>}
      </AtlasWorkbench>
      {snapshot.diagnostics.length > 0 && <details className="author-disclosure"><summary>资料提示 · {snapshot.diagnostics.length}</summary><ul>{snapshot.diagnostics.map((item, index) => {
        const edge = snapshot.relations.find(relation => item.entityIds.includes(relation.id))
        const entity = snapshot.entities.find(entity => item.entityIds.includes(entity.id))
        return <li key={`${item.code}:${index}`}>{item.message}{(edge || entity) && <Button type="link" size="small" onClick={() => edge ? setRelation(edge) : openEntity(entity!)}>查看资料</Button>}</li>
      })}</ul></details>}
      <AtlasRelationDetails onEdit={!loading && !error ? item => { setEditingRelation({ relation: item, snapshot, atChapter }); setRelation(null) } : undefined} relation={relation} snapshot={snapshot} chapters={chapters} onClose={() => setRelation(null)} onOpen={openEntity} onDiscuss={discussRelation} onRelation={setRelation} />
    </>}
    {editingRelation && <AtlasRelationEditor key={editingRelation.relation.id} {...editingRelation} onClose={() => setEditingRelation(null)} onSaved={() => void load()} />}
    {editing && <AtlasEntityEditor key={editing.entity.id} entity={editing.entity} snapshot={editing.snapshot} atChapter={editing.atChapter} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </>}
    <Drawer className="world-reference-drawer" title={`${selected?.name ? `${selected.name} · ` : ''}${reference === 'rules' ? '世界规则' : '联网参考'}`} open={Boolean(reference)} width={720} destroyOnClose onClose={() => changeView(() => setReference(null))}>{reference === 'rules' ? <WorldRules novelId={novelId} embedded onDiscuss={discussRules} onEditStateChange={setRulesEdit} /> : reference === 'research' ? <ResearchLibrary novelId={novelId} /> : null}</Drawer>
    <ObjectTaskPanel novelId={novelId} target={task} onClose={() => setTask(null)} onApplied={() => void load()} />
  </div></AuthorPage>
}
