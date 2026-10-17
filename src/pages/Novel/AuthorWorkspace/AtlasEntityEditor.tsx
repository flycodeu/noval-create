import React, { useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Modal, Select, message } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasFieldLabel, atlasScalarText, ATLAS_KIND_LABELS, ATLAS_INTERNAL_FIELDS, PROFILE_GROUPS, hasAtlasValue, atlasEditedAttributes } from './atlas-profile'
import { recordOf } from './content-document'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import { AtlasFields } from './AtlasFields'
import { atlasPortraitImage, buildAtlasPortraitPrompt, importAtlasPortrait } from './atlas-portrait'

function PortraitEditor({ entity, attributes, onChange, onBusy }: { entity: StoryAtlasEntity; attributes: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; onBusy: (busy: boolean) => void }) {
  const [importing, setImporting] = useState(false)
  const portrait = atlasPortraitImage(attributes.portraitImage)
  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true); onBusy(true)
    try { onChange({ portraitImage: await importAtlasPortrait(file) }) }
    catch (error) { message.error(error instanceof Error ? error.message : '头像导入失败') }
    finally { setImporting(false); onBusy(false) }
  }
  return <details className="author-disclosure" open><summary>肖像与视觉描述（可选）</summary><div className="atlas-editor-fields">
    {portrait && <img className="atlas-portrait-image" src={portrait} alt={`${entity.name}的角色参考像预览`} />}
    <label>导入人物肖像<input type="file" aria-label="导入人物肖像" accept="image/png,image/jpeg,image/webp" disabled={importing} onChange={event => void importFile(event)} /></label>
    <p className="atlas-empty-note">PNG、JPEG 或 WebP，最大 5MB。保存为随资料备份的压缩参考像；原图请另行保留。</p>
    {portrait && <Button danger size="small" disabled={importing} onClick={() => onChange({ portraitImage: '' })}>移除肖像</Button>}
    <label>视觉描述<Input.TextArea aria-label="视觉描述" value={String(attributes.portraitPrompt ?? '')} onChange={event => onChange({ portraitPrompt: event.target.value })} autoSize={{ minRows: 3, maxRows: 10 }} placeholder="外貌、衣着、配色与构图；只填写已确认的视觉设定。" /></label>
    <Button size="small" onClick={() => onChange({ portraitPrompt: buildAtlasPortraitPrompt({ ...entity, attributes }) })}>从当前人设整理视觉描述</Button>
  </div></details>
}

const numericFields = new Set(['age', 'chapterNum', 'appearChapter', 'memberCount', 'x', 'y', 'distanceKm', 'travelHours'])
const referenceField = (key: string) => /(?:Id|Ids|Refs)(?:Json)?$/.test(key)
const fieldOptions: Record<string, Array<{ value: string; label: string }>> = {
  stateTiming: [{ value: 'chapter_start', label: '章初已生效' }, { value: 'chapter_end', label: '章内或章末生效' }],
  roleType: [{ value: 'protagonist', label: '主角' }, { value: 'major', label: '主要人物' }, { value: 'supporting', label: '配角' }, { value: 'minor', label: '次要人物' }, { value: 'antagonist', label: '对立人物' }],
  organizationLevel: [{ value: 'organization', label: '组织' }, { value: 'department', label: '部门' }, { value: 'branch', label: '分部' }],
  entityType: [{ value: 'human', label: '人类' }, { value: 'nonhuman', label: '异类' }, { value: 'undead', label: '亡灵' }, { value: 'monster', label: '妖异' }, { value: 'spirit', label: '精怪' }, { value: 'ghost', label: '鬼魂' }],
  status: ['planned', 'established', 'confirmed', 'written', 'active', 'available', 'consumed', 'destroyed', 'lost'].map(value => ({ value, label: atlasScalarText('status', value, [], []) })),
}

type EditValueProps = { value: unknown; originalValue?: unknown; onChange: (value: unknown) => void; name: string; field: string; snapshot: StoryAtlasSnapshot; positions?: Array<{ id: string; title: string }>; positionId?: string }
export function AtlasEditValue({ value, originalValue, onChange, name, field, snapshot, positions = [], positionId }: EditValueProps): React.ReactElement {
  if (field === 'geography') {
    const geography = recordOf(value)
    return <div className="atlas-editor-fields"><label>面积（平方公里）<InputNumber aria-label="面积（平方公里）" min={0.000001} value={typeof geography.areaKm2 === 'number' ? geography.areaKm2 : null} onChange={next => onChange({ ...geography, areaKm2: next })} /></label><label>资料展开<Select aria-label="资料展开" allowClear value={geography.development || undefined} options={[{ value: 'detailed', label: '已展开' }, { value: 'outlined', label: '已有轮廓' }, { value: 'unexplored', label: '待拓展' }]} onChange={next => onChange({ ...geography, development: next || '' })} /></label></div>
  }
  if (field === 'reportsToPositionId') return <Select aria-label={name} value={value == null ? undefined : String(value)} allowClear placeholder="无上级岗位" options={positions.filter(position => position.id !== positionId).map(position => ({ value: position.id, label: position.title }))} onChange={next => onChange(next ?? null)} />
  if (referenceField(field)) return <div><AtlasFields values={{ [field]: value }} entities={snapshot.entities} chapters={[]} /></div>
  if (numericFields.has(field)) return <InputNumber aria-label={name} value={typeof value === 'number' ? value : null} min={['x', 'y'].includes(field) ? undefined : 0} precision={['x', 'y', 'distanceKm', 'travelHours'].includes(field) ? undefined : 0} onChange={onChange} />
  if (fieldOptions[field]) {
    const isPositionStatus = field === 'status' && positionId !== undefined
    const options = isPositionStatus ? fieldOptions.status.filter(option => ['planned', 'established'].includes(option.value)) : fieldOptions[field]
    const saved = typeof value === 'string' && value && !options.some(option => option.value === value) ? [{ value, label: atlasScalarText(field, value, [], []) }] : []
    return <Select aria-label={name} value={value || undefined} allowClear={!isPositionStatus} options={[...options, ...saved]} onChange={next => onChange(next ?? '')} />
  }
  if (['protagonistPresent', 'isMajorEvent'].includes(field)) return <Checkbox checked={value === 1 || value === true} onChange={event => onChange(event.target.checked ? 1 : 0)}>{name}</Checkbox>
  if (Array.isArray(value)) {
    if (field !== 'positions' && !(Array.isArray(originalValue) && originalValue.some(item => item && typeof item === 'object')) && value.every(item => typeof item === 'string')) return <Input.TextArea aria-label={name} value={value.join('\n')} onChange={event => onChange(event.target.value.split('\n'))} autoSize={{ minRows: 2, maxRows: 8 }} placeholder="每行一项" />
    return <div className="atlas-editor-list">{value.map((item, index) => <section key={index}><AtlasEditValue field={`${field}Item`} snapshot={snapshot} positions={positions} value={item} originalValue={Array.isArray(originalValue) ? originalValue.find(old => recordOf(old).id && recordOf(old).id === recordOf(item).id) ?? originalValue[index] : undefined} name={`${name} ${index + 1}`} onChange={next => onChange(value.map((old, i) => i === index ? next : old))} /><Button type="text" danger onClick={() => onChange(value.filter((_, i) => i !== index))}>移除{name} {index + 1}</Button></section>)}</div>
  }
  if (value && typeof value === 'object') return <div className="atlas-editor-fields">{Object.entries(value).filter(([key]) => !ATLAS_INTERNAL_FIELDS.has(key)).map(([key, item]) => <label key={key}>{atlasFieldLabel(key)}<AtlasEditValue field={key} snapshot={snapshot} positions={positions} positionId={field === 'positionsItem' ? String(recordOf(value).id) : positionId} value={item} originalValue={recordOf(originalValue)[key]} name={atlasFieldLabel(key)} onChange={next => onChange({ ...value, [key]: next })} /></label>)}</div>
  if (typeof value === 'boolean') return <Checkbox checked={value} onChange={event => onChange(event.target.checked)}>{name}</Checkbox>
  if (typeof value === 'number' || typeof originalValue === 'number') return <InputNumber aria-label={name} value={typeof value === 'number' ? value : null} onChange={onChange} />
  return <Input.TextArea aria-label={name} value={String(value ?? '')} onChange={event => onChange(event.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} />
}
export function AtlasEntityEditor({ entity, snapshot, atChapter, onClose, onSaved }: { entity: StoryAtlasEntity; snapshot: StoryAtlasSnapshot; atChapter: number | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(entity.name)
  const [summary, setSummary] = useState(entity.summary)
  const [attributes, setAttributes] = useState(() => structuredClone(entity.attributes))
  const [baseContextVersion] = useState(snapshot.contextVersion)
  const [effectiveChapter] = useState(atChapter ?? entity.effectiveFromChapter)
  const [saving, setSaving] = useState(false)
  const [importingPortrait, setImportingPortrait] = useState(false)
  const dirty = name !== entity.name || summary !== entity.summary || JSON.stringify(attributes) !== JSON.stringify(entity.attributes)
  useRegisterWorkspaceLeaveGuard(dirty)
  const cancel = () => { if (!dirty) onClose(); else Modal.confirm({ title: '放弃尚未保存的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose }) }
  const save = async () => {
    if (!name.trim() || importingPortrait) return
    if (JSON.stringify(attributes).length > 32000) { message.error('人物资料超过 32KB，请精简补充设定或移除肖像后重试。'); return }
    setSaving(true)
    try {
      await window.electron.storyAtlas.apply({ novelId: snapshot.novelId, expectedContextVersion: baseContextVersion, idempotencyKey: `author-atlas:${crypto.randomUUID()}`, effectiveFromChapter: effectiveChapter, source: { kind: 'human', note: '作者修订' }, changes: [{ op: 'upsert_entity', id: entity.id, kind: entity.kind, name: name.trim(), summary, parentId: entity.parentId, attributes: { ...atlasEditedAttributes(entity.attributes, attributes), stateTiming: attributes.stateTiming || entity.attributes.stateTiming || 'chapter_end' }, attributeMode: 'replace', status: entity.status }] })
      message.success('资料已保存'); onSaved(); onClose()
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败') }
    finally { setSaving(false) }
  }
  const groupedKeys = new Set([...PROFILE_GROUPS[entity.kind].flatMap(group => group.fields), ...(entity.kind === 'character' ? ['publicSummary', 'portraitImage', 'portraitPrompt'] : [])])
  const other = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => !groupedKeys.has(key) && !ATLAS_INTERNAL_FIELDS.has(key) && (hasAtlasValue(value) || hasAtlasValue(entity.attributes[key]))))
  const positions = (Array.isArray(attributes.positions) ? attributes.positions : []).map(recordOf).map(position => ({ id: String(position.id), title: String(position.title || '尚未命名岗位') }))
  return <Modal title={`编辑${ATLAS_KIND_LABELS[entity.kind]} · ${entity.name}`} open onCancel={cancel} width={800} okText="保存" cancelText="取消" onOk={() => void save()} confirmLoading={saving} okButtonProps={{ disabled: importingPortrait }}><div className="atlas-editor-fields"><label>名称<Input aria-label="名称" value={name} onChange={event => setName(event.target.value)} /></label>{entity.kind === 'character' && <label>人物简介<Input.TextArea aria-label="人物简介" value={String(attributes.publicSummary ?? '')} onChange={event => setAttributes(old => ({ ...old, publicSummary: event.target.value }))} autoSize={{ minRows: 3, maxRows: 10 }} /></label>}<label>{entity.kind === 'character' ? '作者设定' : '说明'}<Input.TextArea aria-label={entity.kind === 'character' ? '作者设定' : '说明'} value={summary} onChange={event => setSummary(event.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} /></label></div>{entity.kind === 'character' && <PortraitEditor entity={{ ...entity, name }} attributes={attributes} onChange={patch => setAttributes(old => ({ ...old, ...patch }))} onBusy={setImportingPortrait} />}{PROFILE_GROUPS[entity.kind].map((group, index) => <details className="author-disclosure" key={group.title} open={index === 0}><summary>{group.title}</summary><div className="atlas-editor-fields">{group.fields.map(key => <label key={key}>{atlasFieldLabel(key)}<AtlasEditValue field={key} snapshot={snapshot} positions={positions} name={atlasFieldLabel(key)} originalValue={entity.attributes[key]} value={attributes[key] ?? (['personalityTraits', 'flaws', 'habits', 'traits'].includes(key) ? [] : '')} onChange={value => setAttributes(old => ({ ...old, [key]: value }))} /></label>)}</div></details>)}{Object.keys(other).length > 0 && <details className="author-disclosure"><summary>其他已保存设定</summary><AtlasEditValue field="other" snapshot={snapshot} positions={positions} value={other} originalValue={entity.attributes} name="补充设定" onChange={value => setAttributes(old => ({ ...old, ...recordOf(value) }))} /></details>}</Modal>
}
