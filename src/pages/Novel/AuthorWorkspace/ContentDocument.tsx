import React from 'react'
import { Checkbox, Input, InputNumber, Select } from 'antd'
import { CONTENT_LABELS, INTERNAL_FIELDS, VALUE_LABELS, fieldLabel, parseDocument } from './content-document'
import { atlasAttributeValue } from './atlas-presentation'

export function ContentDocument({ value, names = {}, showEmpty = false }: { value: unknown; names?: Record<string, string>; showEmpty?: boolean }): React.ReactElement {
  const parsed = parseDocument(value)
  if (parsed !== value) return <ContentDocument value={parsed} names={names} showEmpty={showEmpty} />
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return <span className="author-missing">尚未补充</span>
  if (Array.isArray(value)) return <div className="author-document-list">{value.map((item, i) => <section key={i}><ContentDocument value={item} names={names} showEmpty={showEmpty} /></section>)}</div>
  if (typeof value === 'object') return <dl className="author-document-fields">{Object.entries(value).filter(([key, item]) => !INTERNAL_FIELDS.has(key) && (showEmpty || item != null && item !== '' && (!Array.isArray(item) || item.length > 0))).map(([key, item]) => <div key={key}><dt>{CONTENT_LABELS[key] || fieldLabel(key)}</dt><dd><ContentDocument value={atlasAttributeValue(key, item)} names={names} showEmpty={showEmpty} /></dd></div>)}</dl>
  return <div className="author-prose">{typeof value === 'boolean' ? value ? '是' : '否' : names[String(value)] || VALUE_LABELS[String(value)] || String(value)}</div>
}

const OPTIONS: Record<string, string[]> = { pov: ['first_person', 'third_limited', 'third_omniscient', 'multi_pov'], tense: ['past', 'present', 'mixed'], protagonistCount: ['single', 'dual', 'ensemble'], viewpointMode: ['fixed', 'rotating', 'free_switch'], parallelTimelines: ['none', 'light', 'heavy'], flashbackPolicy: ['forbidden', 'limited', 'allowed'], endingType: ['HE', 'BE', 'open', 'multi', 'HE_BE'], platformMode: ['general', 'web_serial', 'publishing', 'fanqie', 'feilu'] }

export function DocumentEditor({ value, onChange, path = '', fieldKey = '' }: { value: unknown; onChange: (value: unknown) => void; path?: string; fieldKey?: string }): React.ReactElement {
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'string')) return <Input.TextArea aria-label={path} value={value.join('\n')} onChange={event => onChange(event.target.value.split('\n'))} autoSize={{ minRows: 3, maxRows: 12 }} placeholder="每行一项" />
    if (value.every(item => typeof item === 'number')) return <p className="author-muted">关联编号：{value.join('、') || '暂无'}。可由 AI 按现有资料补充关联。</p>
    return <div className="author-document-list">{value.map((item, i) => <section key={i}><DocumentEditor value={item} path={`${path} ${i + 1}`} onChange={next => onChange(value.map((old, j) => i === j ? next : old))} /></section>)}</div>
  }
  if (value && typeof value === 'object') return <div className="author-document-editor">{Object.entries(value).filter(([key]) => !INTERNAL_FIELDS.has(key)).map(([key, item]) => <div key={key}><label>{fieldLabel(key)}</label><DocumentEditor value={item} fieldKey={key} path={`${path} ${fieldLabel(key)}`} onChange={next => onChange({ ...value, [key]: next })} /></div>)}</div>
  if (OPTIONS[fieldKey]) return <Select aria-label={path} allowClear value={value || undefined} onChange={next => onChange(next || '')} options={OPTIONS[fieldKey].map(option => ({ value: option, label: VALUE_LABELS[option] || option }))} />
  if (typeof value === 'boolean') return <Checkbox checked={value} onChange={event => onChange(event.target.checked)}>{path.split(' ').pop()}</Checkbox>
  if (typeof value === 'number') return <InputNumber aria-label={path} value={value} onChange={next => onChange(next)} />
  return <Input.TextArea aria-label={path} value={String(value ?? '')} onChange={event => onChange(event.target.value)} autoSize={{ minRows: 2, maxRows: 10 }} />
}
