import { CAST_ROLES, characterCastRole } from '../../../shared/cast-role'
import { authorText } from './author-content'
import React, { useState } from 'react'
import { Button } from 'antd'
import { ArrowRightOutlined, EditOutlined } from '@ant-design/icons'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_KIND_LABELS, CHARACTER_PROFILE_SECTIONS, atlasEntitySummary, atlasLinks, atlasRegionLinks, profileFieldGroups, type AtlasLink, type AtlasProfileSection } from './atlas-profile'
import { recordOf } from './content-document'
import { AtlasFields } from './AtlasFields'
import { AtlasPortrait } from './AtlasPortrait'

type Props = { initialSection?: AtlasProfileSection; editingDisabled?: boolean; entity: StoryAtlasEntity; snapshot: StoryAtlasSnapshot; chapters: Array<{ id: number; chapterNum: number }>; onOpen: (entity: StoryAtlasEntity) => void; onEdit: () => void; onDiscuss: () => void; onRelation: (relation: StoryAtlasRelation) => void; onDrill: (entity: StoryAtlasEntity) => void; onBack?: () => void; onShowRules?: () => void; onShowResearch?: () => void }

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
    <Connections title="计划中的人员" links={members.filter(item => item.planned)} empty="暂无计划人员" onOpen={onOpen} onRelation={onRelation} />
    <section className="atlas-profile-section"><h3>岗位与职责</h3>{positions.length ? <div className="atlas-position-list">{positions.map((position, index) => {
      const assigned = members.filter(item => item.relation?.attributes.positionId === position.id)
      const { id: _id, title: _title, status: _status, ...details } = position
      return <article key={String(position.id || index)}><header><strong>{String(position.title || '尚未命名岗位')}</strong><span>{position.status === 'planned' ? '计划设置' : '已设岗位'}</span></header><p className="atlas-position-occupants">{assigned.length ? assigned.map(item => `${item.entity.name} · ${item.relation?.label || item.label}${item.planned ? '（规划经历）' : ''}`).join('、') : position.status === 'planned' ? '人员待定' : '尚未记录任职人员'}</p><AtlasFields values={details} entities={snapshot.entities} chapters={chapters} positions={positionNames} onOpen={onOpen} /></article>
    })}</div> : <p className="atlas-empty-note">尚未设计岗位、职责与汇报关系。</p>}</section>
    <section className="atlas-profile-section"><h3>部门与分部</h3>{departments.length ? <div className="atlas-linked-list">{departments.map(item => <div key={item.id}><button type="button" onClick={() => onOpen(item)}><strong>{item.name}</strong><span>{item.status === 'planned' ? '计划' : '已确认'}</span></button></div>)}</div> : <p className="atlas-empty-note">尚未记录下属部门或分部。</p>}</section>
  </>
}

function CharacterProfileBody({
  entity,
  snapshot,
  chapters,
  section,
  summary,
  publicSummary,
  groups,
  links,
  editingDisabled,
  onOpen,
  onEdit,
  onRelation,
}: {
  entity: StoryAtlasEntity
  snapshot: StoryAtlasSnapshot
  chapters: Array<{ id: number; chapterNum: number }>
  section: AtlasProfileSection
  summary: string
  publicSummary: string
  groups: ReturnType<typeof profileFieldGroups>
  links: AtlasLink[]
  editingDisabled?: boolean
  onOpen: Props['onOpen']
  onEdit: Props['onEdit']
  onRelation: Props['onRelation']
}) {
  return (
    <div className="atlas-profile-body" aria-label={CHARACTER_PROFILE_SECTIONS.find(item => item.key === section)?.label}>
      {section === 'overview' && (
        <section className="atlas-profile-section">
          <h3>{entity.status === 'planned' ? '计划人物简介' : '正文已知'}</h3>
          {entity.status === 'planned' ? <>{summary && <p className="atlas-profile-summary">{summary}</p>}</> : publicSummary ? <p className="atlas-profile-summary">{publicSummary}</p> : <p className="atlas-empty-note">尚未补充正文简介</p>}
        </section>
      )}
      {section === 'appearance' && <AtlasPortrait entity={entity} onEdit={onEdit} disabled={editingDisabled} />}
      {groups.filter(group => group.section === section).map(group => (
        <section className="atlas-profile-section" key={group.title}>
          <h3>{group.title}</h3>
          {Object.keys(group.values).length ? <AtlasFields values={group.values} entities={snapshot.entities} chapters={chapters} onOpen={onOpen} /> : <p className="atlas-empty-note">{group.empty}</p>}
        </section>
      ))}
      {section === 'relationships' && (
        <>
          <Connections title="人物关系" links={links.filter(item => item.entity.kind === 'character')} empty="尚未记录与其他人物的关系。" onOpen={onOpen} onRelation={onRelation} />
          <Connections title="所属组织" links={links.filter(item => item.entity.kind === 'faction')} empty="尚未记录组织归属。" onOpen={onOpen} onRelation={onRelation} />
          <Connections title="居住与活动" links={links.filter(item => item.entity.kind === 'location')} empty="暂无地域关联" onOpen={onOpen} onRelation={onRelation} />
        </>
      )}
      {section === 'planning' && (
        <section className="atlas-profile-section">
          <h3>作者完整设定</h3>
          {entity.summary ? <p className="atlas-profile-summary">{authorText(entity.summary)}</p> : <p className="atlas-empty-note">尚未补充作者完整设定。</p>}
        </section>
      )}
    </div>
  )
}

function NonCharacterProfileBody({
  props,
  summary,
  groups,
  links,
  regionLinks,
}: {
  props: Props
  summary: string
  groups: ReturnType<typeof profileFieldGroups>
  links: AtlasLink[]
  regionLinks: AtlasLink[]
}) {
  const { entity, snapshot, chapters, onOpen, onRelation } = props
  return (
    <>
      {summary && <p className="atlas-profile-summary">{summary}</p>}
      {entity.kind === 'faction' && <Connections title="驻地与涉及区域" links={links.filter(item => item.entity.kind === 'location')} empty="尚未记录主要驻地或涉及区域。" onOpen={onOpen} onRelation={onRelation} />}
      {groups.map(group => (
        <section className="atlas-profile-section" key={group.title}>
          <h3>{group.title}</h3>
          {Object.keys(group.values).length ? <AtlasFields values={group.values} entities={snapshot.entities} chapters={chapters} onOpen={onOpen} /> : <p className="atlas-empty-note">{group.empty}</p>}
        </section>
      ))}
      {entity.kind === 'faction' && <OrganizationStructure {...props} />}
      {entity.kind === 'location' && (
        <>
          {(['faction', 'character', 'event'] as const).map(kind => (
            <Connections key={kind} title={{ faction: '本区域涉及的组织', character: '本区域的人物', event: '本区域的事件' }[kind]} links={regionLinks.filter(item => item.entity.kind === kind)} empty="当前章位尚无已记录的关联。" onOpen={onOpen} onRelation={onRelation} />
          ))}
        </>
      )}
      {['item', 'event'].includes(entity.kind) && <Connections title="相关人物与地点" links={links} empty="尚未记录关联资料。" onOpen={onOpen} onRelation={onRelation} />}
    </>
  )
}

export function AtlasEntityProfile(props: Props) {
  const { entity, snapshot, chapters, onOpen, onEdit, onDiscuss, onRelation, onDrill } = props
  const [section, setSection] = useState<AtlasProfileSection>(props.initialSection || 'overview')
  const character = entity.kind === 'character'
  const links = atlasLinks(snapshot, entity)
  const parent = snapshot.entities.find(item => item.id === entity.parentId)
  const groups = profileFieldGroups(entity)
  const summary = atlasEntitySummary(entity)
  const publicSummary = typeof entity.attributes.publicSummary === 'string' ? entity.attributes.publicSummary.trim() : ''
  const regionLinks = atlasRegionLinks(snapshot, entity)
  return <article className="atlas-profile" aria-label={`${entity.name}资料`}>
    <div className="atlas-profile-sticky">
    {props.onBack && <Button type="text" className="atlas-profile-back" onClick={props.onBack}>← 返回列表</Button>}
    <header className="atlas-profile-header"><div><span className="author-eyebrow">{[character ? CAST_ROLES.find(role => role.value === characterCastRole(entity.attributes))?.label : ATLAS_KIND_LABELS[entity.kind], entity.status === 'planned' ? '计划设定' : '', entity.effectiveFromChapter ? `第 ${entity.effectiveFromChapter} 章起` : ''].filter(Boolean).join(' · ')}</span><h2>{entity.name}</h2></div><Button icon={<EditOutlined />} disabled={props.editingDisabled} onClick={onEdit}>编辑</Button></header>
    {character && <nav className="atlas-profile-tabs" aria-label="人物档案分节">{CHARACTER_PROFILE_SECTIONS.map(item => <button type="button" key={item.key} aria-pressed={section === item.key} onClick={() => setSection(item.key)}>{item.label}</button>)}</nav>}
    </div>
    {parent && <button type="button" className="atlas-text-link atlas-parent-link" onClick={() => onOpen(parent)}>{entity.kind === 'faction' ? '上级组织' : '所属地点'}：{parent.name}</button>}
    {character ? (
      <CharacterProfileBody
        entity={entity}
        snapshot={snapshot}
        chapters={chapters}
        section={section}
        summary={summary}
        publicSummary={publicSummary}
        groups={groups}
        links={links}
        editingDisabled={props.editingDisabled}
        onOpen={onOpen}
        onEdit={onEdit}
        onRelation={onRelation}
      />
    ) : (
      <NonCharacterProfileBody
        props={props}
        summary={summary}
        groups={groups}
        links={links}
        regionLinks={regionLinks}
      />
    )}
    <footer className="atlas-profile-footer"><Button disabled={props.editingDisabled} onClick={onDiscuss}>讨论与完善{entity.kind === 'faction' ? '组织' : ATLAS_KIND_LABELS[entity.kind]}</Button>{entity.kind === 'location' && <Button onClick={() => onDrill(entity)}>查看下级地点 <ArrowRightOutlined /></Button>}{props.onShowRules && <Button type="text" onClick={props.onShowRules}>查世界规则</Button>}{props.onShowResearch && <Button type="text" onClick={props.onShowResearch}>查联网参考</Button>}</footer>
  </article>
}
