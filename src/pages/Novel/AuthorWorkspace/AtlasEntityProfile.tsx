import React from 'react'
import { Button } from 'antd'
import { ArrowRightOutlined, EditOutlined } from '@ant-design/icons'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_KIND_LABELS, atlasEntitySummary, atlasLinks, atlasRegionLinks, profileFieldGroups, type AtlasLink } from './atlas-profile'
import { recordOf } from './content-document'
import { AtlasFields } from './AtlasFields'

type Props = { entity: StoryAtlasEntity; snapshot: StoryAtlasSnapshot; chapters: Array<{ id: number; chapterNum: number }>; onOpen: (entity: StoryAtlasEntity) => void; onEdit: () => void; onDiscuss: () => void; onRelation: (relation: StoryAtlasRelation) => void; onDrill: (entity: StoryAtlasEntity) => void }
function Connections({ title, links, empty, onOpen, onRelation }: { title: string; links: AtlasLink[]; empty: string; onOpen: Props['onOpen']; onRelation: Props['onRelation'] }) {
  return <section className="atlas-profile-section"><h3>{title}</h3>{links.length ? <div className="atlas-linked-list">{links.map((link, index) => <div key={`${link.entity.id}:${link.relation?.id || index}`}><button type="button" onClick={() => onOpen(link.entity)}><strong>{link.entity.name}</strong><span>{link.label}{link.planned ? ' · 计划' : ''}</span></button>{link.relation && <button type="button" className="atlas-text-link" onClick={() => onRelation(link.relation!)}>关联详情</button>}</div>)}</div> : <p className="atlas-empty-note">{empty}</p>}</section>
}
function OrganizationStructure({ entity, snapshot, chapters, onOpen, onRelation }: Pick<Props, 'entity' | 'snapshot' | 'chapters' | 'onOpen' | 'onRelation'>) {
  const members = atlasLinks(snapshot, entity, 'character').filter(link => link.relation?.kind === 'membership')
  const positions = (Array.isArray(entity.attributes.positions) ? entity.attributes.positions : []).map(recordOf)
  const positionNames = positions.map(item => ({ id: String(item.id), title: String(item.title || '尚未命名岗位') }))
  const departments = snapshot.entities.filter(item => item.kind === 'faction' && item.parentId === entity.id)
  return <>
    <Connections title="现有人员" links={members.filter(item => !item.planned).map(item => ({ ...item, label: positionNames.find(position => position.id === item.relation?.attributes.positionId)?.title || item.label }))} empty="尚未记录已确认的组织成员。" onOpen={onOpen} onRelation={onRelation} />
    <Connections title="计划中的人员" links={members.filter(item => item.planned)} empty="没有已记录的计划人员；未确定的岗位不会虚构成人物。" onOpen={onOpen} onRelation={onRelation} />
    <section className="atlas-profile-section"><h3>岗位与职责</h3>{positions.length ? <div className="atlas-position-list">{positions.map((position, index) => {
      const assigned = members.filter(item => item.relation?.attributes.positionId === position.id)
      const { id: _id, title: _title, status: _status, ...details } = position
      return <article key={String(position.id || index)}><header><strong>{String(position.title || '尚未命名岗位')}</strong><span>{position.status === 'planned' ? '计划设置' : '已设岗位'}</span></header><p className="atlas-position-occupants">{assigned.length ? assigned.map(item => `${item.entity.name}${item.planned ? '（计划任职）' : ''}`).join('、') : position.status === 'planned' ? '人员待定' : '尚未记录任职人员'}</p><AtlasFields values={details} entities={snapshot.entities} chapters={chapters} positions={positionNames} onOpen={onOpen} /></article>
    })}</div> : <p className="atlas-empty-note">尚未设计岗位、职责与汇报关系。</p>}</section>
    <section className="atlas-profile-section"><h3>部门与分部</h3>{departments.length ? <div className="atlas-linked-list">{departments.map(item => <div key={item.id}><button type="button" onClick={() => onOpen(item)}><strong>{item.name}</strong><span>{item.status === 'planned' ? '计划' : '已确认'}</span></button></div>)}</div> : <p className="atlas-empty-note">尚未记录下属部门或分部。</p>}</section>
  </>
}
export function AtlasEntityProfile(props: Props) {
  const { entity, snapshot, chapters, onOpen, onEdit, onDiscuss, onRelation, onDrill } = props
  const links = atlasLinks(snapshot, entity)
  const parent = snapshot.entities.find(item => item.id === entity.parentId)
  const groups = profileFieldGroups(entity)
  const summary = atlasEntitySummary(entity)
  const regionLinks = atlasRegionLinks(snapshot, entity)
  return <article className="atlas-profile" aria-label={`${entity.name}资料`}>
    <header className="atlas-profile-header"><div><span className="author-eyebrow">{ATLAS_KIND_LABELS[entity.kind]} · {entity.status === 'planned' ? '计划设定' : '已记录'}</span><h2>{entity.name}</h2></div><Button icon={<EditOutlined />} onClick={onEdit}>编辑</Button></header>
    {parent && <button type="button" className="atlas-text-link atlas-parent-link" onClick={() => onOpen(parent)}>{entity.kind === 'faction' ? '上级组织' : '所属地点'}：{parent.name}</button>}
    {summary && <p className="atlas-profile-summary">{summary}</p>}
    {entity.summary && entity.summary.trim() !== summary.trim() && <details className="author-disclosure"><summary>作者设定</summary><p>{entity.summary}</p></details>}
    <div className="atlas-profile-actions"><Button onClick={onDiscuss}>讨论与完善{entity.kind === 'faction' ? '组织' : ATLAS_KIND_LABELS[entity.kind]}</Button>{entity.kind === 'location' && <Button onClick={() => onDrill(entity)}>查看下级地点 <ArrowRightOutlined /></Button>}</div>
    {entity.kind === 'character' && <Connections title="居住与活动" links={links.filter(item => item.entity.kind === 'location')} empty="尚未记录出生地、居住地或活动区域。可结合已写正文补充；未知地点应保持待定。" onOpen={onOpen} onRelation={onRelation} />}
    {entity.kind === 'faction' && <Connections title="驻地与涉及区域" links={links.filter(item => item.entity.kind === 'location')} empty="尚未记录主要驻地、分驻点或涉及区域。一个组织可以关联多个地区。" onOpen={onOpen} onRelation={onRelation} />}
    {groups.map(group => <section className="atlas-profile-section" key={group.title}><h3>{group.title}</h3>{Object.keys(group.values).length ? <AtlasFields values={group.values} entities={snapshot.entities} chapters={chapters} onOpen={onOpen} /> : <p className="atlas-empty-note">{group.empty}</p>}</section>)}
    {entity.kind === 'character' && <><Connections title="所属组织" links={links.filter(item => item.entity.kind === 'faction')} empty="尚未记录组织归属。" onOpen={onOpen} onRelation={onRelation} /><Connections title="人物关系" links={links.filter(item => item.entity.kind === 'character')} empty="尚未记录与其他人物的关系。" onOpen={onOpen} onRelation={onRelation} /></>}
    {entity.kind === 'faction' && <OrganizationStructure {...props} />}
    {entity.kind === 'location' && <>{(['faction', 'character', 'event'] as const).map(kind => <Connections key={kind} title={{ faction: '本区域涉及的组织', character: '本区域的人物', event: '本区域的事件' }[kind]} links={regionLinks.filter(item => item.entity.kind === kind)} empty="当前章位尚无已记录的关联。" onOpen={onOpen} onRelation={onRelation} />)}</>}
    {['item', 'event'].includes(entity.kind) && <Connections title="相关人物与地点" links={links} empty="尚未记录关联资料。" onOpen={onOpen} onRelation={onRelation} />}
    <details className="author-disclosure"><summary>记录依据</summary><p>从第 {entity.effectiveFromChapter} 章起生效</p><p>{entity.source.note || '来自已有资料记录'}</p></details>
  </article>
}
