import React, { useState } from 'react'
import { Checkbox, Input, InputNumber, Modal, message } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasFieldLabel, atlasScalarText, ATLAS_KIND_LABELS, ATLAS_INTERNAL_FIELDS, PROFILE_GROUPS, hasAtlasValue } from './atlas-profile'
import { recordOf } from './content-document'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'

function EditValue({ value, onChange, name }: { value: unknown; onChange: (value: unknown) => void; name: string }): React.ReactElement {
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'string')) return <Input.TextArea aria-label={name} value={value.join('\n')} onChange={event => onChange(event.target.value.split('\n').filter(Boolean))} autoSize={{ minRows: 2, maxRows: 8 }} placeholder="每行一项" />
    if (value.every(item => typeof item === 'number')) return <p className="atlas-empty-note">关联资料可通过“讨论与完善”调整，已保存的关联会保留。</p>
    return <div className="atlas-editor-list">{value.map((item, index) => <section key={index}><EditValue value={item} name={`${name} ${index + 1}`} onChange={next => onChange(value.map((old, i) => i === index ? next : old))} /></section>)}</div>
  }
  if (value && typeof value === 'object') return <div className="atlas-editor-fields">{Object.entries(value).filter(([key]) => !ATLAS_INTERNAL_FIELDS.has(key)).map(([key, item]) => <label key={key}>{atlasFieldLabel(key)}<EditValue value={item} name={atlasFieldLabel(key)} onChange={next => onChange({ ...value, [key]: next })} /></label>)}</div>
  if (typeof value === 'boolean') return <Checkbox checked={value} onChange={event => onChange(event.target.checked)}>{name}</Checkbox>
  if (typeof value === 'number') return <InputNumber aria-label={name} value={value} onChange={onChange} />
  return <Input.TextArea aria-label={name} value={String(value ?? '')} onChange={event => onChange(event.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} />
}
export function AtlasEntityEditor({ entity, snapshot, atChapter, onClose, onSaved }: { entity: StoryAtlasEntity; snapshot: StoryAtlasSnapshot; atChapter: number | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(entity.name)
  const [summary, setSummary] = useState(entity.summary)
  const [attributes, setAttributes] = useState(() => structuredClone(entity.attributes))
  const [baseContextVersion] = useState(snapshot.contextVersion)
  const [effectiveChapter] = useState(atChapter ?? entity.effectiveFromChapter)
  const [saving, setSaving] = useState(false)
  const dirty = name !== entity.name || summary !== entity.summary || JSON.stringify(attributes) !== JSON.stringify(entity.attributes)
  useRegisterWorkspaceLeaveGuard(dirty)
  const cancel = () => { if (!dirty) onClose(); else Modal.confirm({ title: '放弃尚未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose }) }
  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await window.electron.storyAtlas.apply({ novelId: snapshot.novelId, expectedContextVersion: baseContextVersion, idempotencyKey: `author-atlas:${crypto.randomUUID()}`, effectiveFromChapter: effectiveChapter, source: { kind: 'human', note: '作者修订' }, changes: [{ op: 'upsert_entity', id: entity.id, kind: entity.kind, name: name.trim(), summary, parentId: entity.parentId, attributes, status: entity.status }] })
      message.success('资料已保存'); onSaved(); onClose()
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败') }
    finally { setSaving(false) }
  }
  const groupedKeys = new Set([...PROFILE_GROUPS[entity.kind].flatMap(group => group.fields), ...(entity.kind === 'character' ? ['publicSummary'] : [])])
  const other = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => !groupedKeys.has(key) && !ATLAS_INTERNAL_FIELDS.has(key) && hasAtlasValue(value)))
  return <Modal title={`编辑${ATLAS_KIND_LABELS[entity.kind]} · ${entity.name}`} open onCancel={cancel} width={800} okText="保存" cancelText="取消" onOk={() => void save()} confirmLoading={saving}><div className="atlas-editor-fields"><label>名称<Input value={name} onChange={event => setName(event.target.value)} /></label>{entity.kind === 'character' && <label>人物简介<Input.TextArea value={String(attributes.publicSummary ?? '')} onChange={event => setAttributes(old => ({ ...old, publicSummary: event.target.value }))} autoSize={{ minRows: 3, maxRows: 10 }} /></label>}<label>{entity.kind === 'character' ? '作者设定' : '说明'}<Input.TextArea value={summary} onChange={event => setSummary(event.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} /></label></div>{PROFILE_GROUPS[entity.kind].map((group, index) => <details className="author-disclosure" key={group.title} open={index === 0}><summary>{group.title}</summary><div className="atlas-editor-fields">{group.fields.map(key => <label key={key}>{atlasFieldLabel(key)}<EditValue name={atlasFieldLabel(key)} value={attributes[key] ?? (['personalityTraits', 'flaws', 'habits', 'traits'].includes(key) ? [] : '')} onChange={value => setAttributes(old => ({ ...old, [key]: value }))} /></label>)}</div></details>)}{Object.keys(other).length > 0 && <details className="author-disclosure"><summary>其他已保存设定</summary><EditValue value={other} name="补充设定" onChange={value => setAttributes(old => ({ ...old, ...recordOf(value) }))} /></details>}<p className="atlas-empty-note">地域、人员与组织的关联通过讨论生成候选后调整。未修改的已有字段会保留。{entity.status === 'planned' ? `此条目仍为${atlasScalarText('status', entity.status, [], [])}。` : ''}</p></Modal>
}
