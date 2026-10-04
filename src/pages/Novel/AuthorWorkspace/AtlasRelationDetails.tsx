import React from 'react'
import { Button, Modal } from 'antd'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { AtlasFields } from './AtlasFields'
import { recordOf } from './content-document'
import { atlasRouteMissingFields } from '../../../shared/story-atlas-travel'

export function AtlasRelationDetails({ relation, snapshot, chapters, onClose, onOpen, onDiscuss }: { relation: StoryAtlasRelation | null; snapshot: StoryAtlasSnapshot; chapters: Array<{ id: number; chapterNum: number }>; onClose: () => void; onOpen: (entity: StoryAtlasEntity) => void; onDiscuss: (relation: StoryAtlasRelation) => void }) {
  const target = snapshot.entities.find(item => item.id === relation?.toId)
  const positions = (Array.isArray(target?.attributes.positions) ? target.attributes.positions : []).map(item => { const position = recordOf(item); return { id: String(position.id), title: String(position.title || '尚未命名岗位') } })
  const missing = relation?.kind === 'route' ? atlasRouteMissingFields(relation, snapshot.entities) : []
  return <Modal title={relation?.label || '关联详情'} open={Boolean(relation)} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} width={760}>{relation && <div className="atlas-relation-detail"><AtlasFields values={{ fromId: relation.fromId, toId: relation.toId, kind: relation.kind, ...relation.attributes, status: relation.status, effectiveFromChapter: relation.effectiveFromChapter }} entities={snapshot.entities} chapters={chapters} positions={positions} onOpen={entity => { onClose(); onOpen(entity) }} />{missing.length > 0 && <p>行程资料缺少：{missing.join('、')}。</p>}<div className="atlas-profile-actions"><Button onClick={() => onDiscuss(relation)}>{missing.length ? '生成行程候选' : '讨论这条关联'}</Button></div></div>}</Modal>
}
