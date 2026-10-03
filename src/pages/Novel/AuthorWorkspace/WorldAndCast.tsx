import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Select, Spin } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Chapter } from '../../../types'
import type { StoryAtlasEntity, StoryAtlasSnapshot, StoryAtlasRelation } from '../../../shared/story-atlas'
import type { CreativeStage } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { ATLAS_KIND_LABELS, ATLAS_TABS, atlasTabFor, resolveAtlasTab, type AtlasTab } from './atlas-profile'
import { AtlasEntityLibrary } from './AtlasEntityLibrary'
import { AtlasEntityProfile } from './AtlasEntityProfile'
import { AtlasEntityEditor } from './AtlasEntityEditor'
import { AtlasRelationDetails } from './AtlasRelationDetails'
import { WorldAtlasGraph } from './WorldAtlasGraph'
import { GeographicAtlas } from './GeographicAtlas'

const STAGES: Record<StoryAtlasEntity['kind'], CreativeStage> = { location: 'map', character: 'characters', faction: 'factions', item: 'items', event: 'events' }
export default function WorldAndCast({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = resolveAtlasTab(params)
  const parentId = params.get('location') || null
  const geographic = tab === 'map' && params.get('mapView') !== 'hierarchy'
  const atChapter = params.has('atChapter') ? Math.max(0, Number(params.get('atChapter')) || 0) : null
  const selectedId = params.get('entity')
  const [snapshot, setSnapshot] = useState<StoryAtlasSnapshot | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [includePlanned, setIncludePlanned] = useState(false)
  const [relation, setRelation] = useState<StoryAtlasRelation | null>(null)
  const [editing, setEditing] = useState<StoryAtlasEntity | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  useEffect(() => { document.querySelector('.author-shell-main')?.scrollTo({ top: 0 }) }, [tab, parentId, atChapter])
  const load = useCallback(async () => {
    const token = ++epoch.current
    setLoading(true)
    try {
      const [result, chapterRows] = await Promise.all([window.electron.storyAtlas.query({ novelId, ...(atChapter != null ? { atChapter } : {}), includePlanned }), window.electron.chapter.list(novelId)])
      if (token === epoch.current) { setSnapshot(result); setChapters(chapterRows); setError('') }
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '读取世界与人物失败') }
    finally { if (token === epoch.current) setLoading(false) }
  }, [novelId, atChapter, includePlanned])
  useEffect(() => { void load(); return () => { epoch.current += 1 } }, [load])
  useEffect(() => { const refresh = () => { void load() }; window.addEventListener('novelforge:creative-completed', refresh); window.addEventListener('focus', refresh); return () => { window.removeEventListener('novelforge:creative-completed', refresh); window.removeEventListener('focus', refresh) } }, [load])
  const activeKind = ATLAS_TABS.find(item => item.key === tab)!.kind
  const selected = snapshot?.entities.find(item => item.id === selectedId) || null
  const isGraph = tab === 'map' || tab === 'relationships'
  const updateParams = (change: (next: URLSearchParams) => void) => { const next = new URLSearchParams(params); change(next); setParams(next) }
  const select = (entity: StoryAtlasEntity) => updateParams(next => next.set('entity', entity.id))
  const openEntity = (entity: StoryAtlasEntity) => updateParams(next => { next.set('tab', atlasTabFor(entity)); next.set('entity', entity.id); if (entity.kind === 'location') { if (entity.parentId) next.set('location', entity.parentId); else next.delete('location') } })
  const switchTab = (nextTab: AtlasTab) => { setRelation(null); updateParams(next => { next.set('tab', nextTab); next.delete('kind'); next.delete('view'); next.delete('entity') }) }
  const drill = (entity: StoryAtlasEntity | null) => updateParams(next => { next.set('tab', 'map'); if (entity) { next.set('location', entity.id); next.set('entity', entity.id) } else { next.delete('location'); next.delete('entity') } })
  const generate = (stage: CreativeStage, request: string) => navigate(buildWorkspaceRoute(novelId, `guide?${new URLSearchParams({ stage, request, autoApply: 'false', ...(atChapter != null ? { atChapter: String(atChapter) } : {}) })}`))
  const generateTab = () => {
    if (tab === 'relationships') return generate('relationships', '结合现有人物与已写正文，补充有具体依据的人物关系、相处方式、关系张力及变化。现有关系按稳定 ID 更新，不虚构过去纠葛。')
    const parent = snapshot?.entities.find(item => item.id === parentId)
    generate(STAGES[activeKind], activeKind === 'location' ? `补充${parent ? `“${parent.name}”范围内` : '当前故事需要的'}地理设计：国家/区域边界、地区方位、城镇位置、地形水源、生计与通路。用 geography.boundary 和 geography.position 保存父地图内0到100的相对坐标，北方在上；先明确区域，再将城市归入区域。已有面积与尺度沿用设定；缺少时结合本轮需求设计合理的候选 geography.areaKm2 与 mapFrame 公里范围，在候选说明中交代依据，不冒充已定事实。未展开地域用 geography.development=unexplored；新的不确定地区保持计划。已有记录带稳定ID，保留已定事实、章节位置与现有关系，输出可讨论候选。` : activeKind === 'character' ? '结合现有背景与正文补充人物档案：身份、具体性格表现、目标与动机、弱点和底线、习惯与说话方式、职业日常、能力代价与边界；以 presence 关系明确已有依据的出生地、居住地和活动区域，未知保持待定。已有角色按稳定 ID 更新，不捏造创伤或关系。' : activeKind === 'faction' ? '结合已有背景和地点补充组织势力：特点、立场、目标、行事方式与资源；用 presence 关联主要驻地与涉及区域，部门分部用 parentId；设计确有必要的岗位职责，以 membership 关联已知人员。尚未确定的岗位标为计划，不为填岗位虚构人物。' : `结合现有背景、资料与正文补充${ATLAS_KIND_LABELS[activeKind]}，已有记录按稳定 ID 更新，无依据内容保持计划。`)
  }
  const discuss = (entity: StoryAtlasEntity) => generate(STAGES[entity.kind], `讨论并完善${ATLAS_KIND_LABELS[entity.kind]}“${entity.name}”（${entity.id}）。结合现有背景、当前章位与关联资料，保留已定事实。${entity.kind === 'character' ? '检查身份、性格表现、动机目标、弱点底线、习惯语言、职业日常、能力代价以及居住和活动区域，地域用 presence 关联；未知保持待定。' : entity.kind === 'faction' ? '检查组织特点、驻地与涉及区域、部门结构、岗位职责、现有成员和待定岗位；人员必须有依据，空岗位不虚构成人物。' : '补足本条资料确有依据的缺项，并检查与关联资料是否一致。'}重大改变先保留为候选。`)
  const discussRelation = (item: StoryAtlasRelation) => {
    const subjectKind = snapshot?.entities.find(entity => entity.id === item.fromId)?.kind
    const stage = item.kind === 'route' ? 'map' : item.kind === 'membership' ? 'factions' : item.kind === 'presence' && subjectKind ? STAGES[subjectKind] : 'relationships'
    generate(stage, `讨论并优化“${item.label}”关联（${item.id}），保留当前章位的已定事实，说明调整的具体依据。`)
  }
  return <AuthorPage compact eyebrow="世界与人物" title="地点、人物与他们的联系">
    <div className="atlas-workspace-toolbar"><nav className="author-tabs atlas-primary-tabs" aria-label="世界与人物分区">{ATLAS_TABS.map(item => <button type="button" key={item.key} className={tab === item.key ? 'is-selected' : ''} aria-current={tab === item.key ? 'page' : undefined} onClick={() => switchTab(item.key)}>{item.label}</button>)}</nav><Button type="link" onClick={() => navigate(buildWorkspaceRoute(novelId, 'story-design?section=world'))}>世界规则</Button></div>
    <div className="atlas-context-toolbar"><Select<number | 'all'> aria-label="故事章位" value={atChapter ?? 'all'} onChange={value => { setRelation(null); updateParams(next => { if (value === 'all') next.delete('atChapter'); else next.set('atChapter', String(value)) }) }} options={[{ value: 'all', label: '全部已知设定' }, { value: 0, label: '初始设定 · 第 0 章' }, ...chapters.map(chapter => ({ value: chapter.chapterNum, label: `第 ${chapter.chapterNum} 章 · ${chapter.title || ''}` }))]} /><Checkbox checked={includePlanned} onChange={event => { setRelation(null); setIncludePlanned(event.target.checked) }}>包含计划</Checkbox><span aria-live="polite">{loading && snapshot ? <Spin size="small" /> : null}</span>{tab === 'map' && <nav className="atlas-map-modes" aria-label="地图视图">{[{ key: 'geography', label: '区域地图' }, { key: 'hierarchy', label: '层级图' }].map(mode => <button type="button" key={mode.key} className={(geographic ? 'geography' : 'hierarchy') === mode.key ? 'is-selected' : ''} aria-pressed={(geographic ? 'geography' : 'hierarchy') === mode.key} onClick={() => updateParams(next => next.set('mapView', mode.key))}>{mode.label}</button>)}</nav>}</div>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {!snapshot ? loading ? <div className="author-loading"><Spin /></div> : <EmptyWork title="资料暂未读到">请重试读取。</EmptyWork> : <>
      <div className={`atlas-workbench ${geographic ? 'atlas-workbench--geography' : isGraph ? 'atlas-workbench--graph' : 'atlas-workbench--library'}`}>
        {geographic ? <GeographicAtlas snapshot={snapshot} parentId={parentId} selectedId={selectedId} onSelect={select} onRelation={setRelation} onDrill={drill} onGenerate={generateTab} /> : isGraph ? <WorldAtlasGraph key={tab} mode={tab} snapshot={snapshot} parentId={parentId} selectedId={selectedId} onSelect={select} onRelation={setRelation} onDrill={drill} onGenerate={generateTab} /> : <AtlasEntityLibrary key={tab} kind={activeKind} snapshot={snapshot} selectedId={selectedId} onSelect={select} onGenerate={generateTab} />}
        {(!geographic || selected) && <section id="author-entity-inspector" className="atlas-profile-panel">{selected ? <AtlasEntityProfile key={selected.id} entity={selected} snapshot={snapshot} chapters={chapters} onOpen={openEntity} onEdit={() => setEditing(selected)} onDiscuss={() => discuss(selected)} onRelation={setRelation} onDrill={drill} /> : <EmptyWork title={selectedId ? '此章位下没有这条资料' : `选择一个${isGraph ? tab === 'map' ? '地点' : '人物或关系' : ATLAS_KIND_LABELS[activeKind]}`}>{selectedId ? '资料可能尚未生效，或属于计划；可调整章位及“包含计划”后查看。' : '查看相关地点、人物与组织。'}</EmptyWork>}</section>}
      </div>
      {snapshot.diagnostics.length > 0 && <details className="author-disclosure"><summary>资料提示 · {snapshot.diagnostics.length}</summary><ul>{snapshot.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>{item.message}</li>)}</ul></details>}
      <AtlasRelationDetails relation={relation} snapshot={snapshot} chapters={chapters} onClose={() => setRelation(null)} onOpen={openEntity} onDiscuss={discussRelation} />
      {editing && <AtlasEntityEditor key={editing.id} entity={editing} snapshot={snapshot} atChapter={atChapter} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </>}
  </AuthorPage>
}
