import React, { useRef, useState } from 'react'
import { ConfigProvider, Input, Modal, message } from 'antd'
import type { StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import { AtlasEditValue } from './AtlasEntityEditor'
import { atlasEditedAttributes } from './atlas-profile'
import { getUserFacingMessage } from '../../../utils/user-facing-message'

export function AtlasRelationEditor({ relation, snapshot, atChapter, onClose, onSaved }: { relation: StoryAtlasRelation; snapshot: StoryAtlasSnapshot; atChapter: number | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(relation.label)
  const [initial] = useState<Record<string, unknown>>(() => ({ description: '', relationshipTension: '', authorPlanning: '', ...structuredClone(relation.attributes) }))
  const [attributes, setAttributes] = useState(initial)
  const [version] = useState(snapshot.contextVersion)
  const [chapter] = useState(atChapter ?? relation.effectiveFromChapter)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const dirty = label !== relation.label || JSON.stringify(attributes) !== JSON.stringify(initial)
  useRegisterWorkspaceLeaveGuard(dirty || saving)
  const cancel = () => {
    if (lock.current) return
    if (!dirty) onClose()
    else Modal.confirm({ title: '放弃尚未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
  }
  const save = async () => {
    if (lock.current || !label.trim()) return
    lock.current = true; setSaving(true)
    try {
      await window.electron.storyAtlas.apply({ novelId: snapshot.novelId, expectedContextVersion: version, idempotencyKey: `author-relation:${crypto.randomUUID()}`, effectiveFromChapter: chapter, source: { kind: 'human', note: '作者修订人物关系' }, changes: [{ op: 'upsert_relation', id: relation.id, kind: relation.kind, fromId: relation.fromId, toId: relation.toId, label: label.trim(), status: relation.status, attributes: { ...atlasEditedAttributes(relation.attributes, attributes), stateTiming: attributes.stateTiming || relation.attributes.stateTiming || 'chapter_end' }, attributeMode: 'replace' }] })
      onSaved(); onClose()
    } catch (error) { message.error(error instanceof Error ? error.message : getUserFacingMessage('common.saveFailed')) }
    finally { lock.current = false; setSaving(false) }
  }
  return <Modal title="编辑人物关系" open onCancel={cancel} onOk={() => void save()} okText="保存" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: !label.trim() }} cancelButtonProps={{ disabled: saving }} closable={!saving} width={720}>
    <p>{snapshot.entities.find(item => item.id === relation.fromId)?.name} · {snapshot.entities.find(item => item.id === relation.toId)?.name}</p>
    <ConfigProvider componentDisabled={saving}><div className="atlas-editor-fields">
      <label>关系名称<Input aria-label="关系名称" value={label} maxLength={200} onChange={event => setLabel(event.target.value)} /></label>
      <AtlasEditValue field="relationship" name="人物关系" value={attributes} originalValue={relation.attributes} snapshot={snapshot} onChange={next => setAttributes(next as typeof attributes)} />
    </div></ConfigProvider>
  </Modal>
}
