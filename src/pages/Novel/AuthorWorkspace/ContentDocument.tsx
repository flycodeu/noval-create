import React from 'react'
import { Button, Checkbox, Input, InputNumber, Select } from 'antd'
import { DOCUMENT_OPTIONS, INTERNAL_FIELDS, documentEnumLabel, documentFieldKey, documentHasContent, fieldLabel, parseDocument, recordOf } from './content-document'
import { atlasAttributeValue } from './atlas-presentation'
import { documentReferenceLabel, documentReferenceOptions, documentReferenceType } from './document-references'
import { AUTHOR_PROCESS_FIELDS, authorText } from './author-content'

export function ContentDocument({ value, names = {}, showEmpty = false, fieldKey = '' }: { value: unknown; names?: Record<string, string>; showEmpty?: boolean; fieldKey?: string }): React.ReactElement {
  const parsed = parseDocument(value)
  const processReview = recordOf(value).schemaVersion === 'generic-asset-review-v1'
  if (parsed !== value) return <ContentDocument value={parsed} names={names} showEmpty={showEmpty} fieldKey={fieldKey} />
  if (!documentHasContent(value)) return <span className="author-missing">尚未补充</span>
  if (Array.isArray(value)) return <div className="author-document-list">{value.map((item, i) => <section key={i}><ContentDocument value={item} names={names} showEmpty={showEmpty} fieldKey={fieldKey} /></section>)}</div>
  if (value && typeof value === 'object') return <dl className="author-document-fields">{Object.entries(value).filter(([key, item]) => {
    const present = documentHasContent(item)
    return !INTERNAL_FIELDS.has(documentFieldKey(key)) && !AUTHOR_PROCESS_FIELDS.has(documentFieldKey(key)) && (present || showEmpty && !documentReferenceType(key))
  }).map(([key, item]) => <div key={key}><dt>{processReview && key === 'score' ? '流程检查分' : fieldLabel(key, item)}</dt><dd><ContentDocument value={item} names={names} showEmpty={showEmpty} fieldKey={processReview && key === 'status' ? 'processReviewStatus' : key} /></dd></div>)}</dl>
  const display = documentReferenceLabel(fieldKey, value, names) ?? documentEnumLabel(fieldKey, atlasAttributeValue(documentFieldKey(fieldKey), value))
  return <div className="author-prose">{typeof display === 'boolean' ? display ? '是' : '否' : authorText(String(display))}</div>
}

function ArrayDocumentEditor({
  value,
  onChange,
  path,
  fieldKey,
  names,
}: {
  value: unknown[]
  onChange: (value: unknown) => void
  path: string
  fieldKey: string
  names: Record<string, string>
}): React.ReactElement {
  if (fieldKey === 'subPlotsList') {
    return (
      <div className="author-document-list">
        {value.map((item, i) => (
          <section key={i}>
            <DocumentEditor value={item} names={names} path={`支线 ${i + 1}`} onChange={next => onChange(value.map((old, j) => i === j ? next : old))} />
            <Button danger type="text" onClick={() => onChange(value.filter((_, j) => i !== j))}>
              移除支线 {i + 1}
            </Button>
          </section>
        ))}
        <Button onClick={() => onChange([...value, { name: '', characters: '', conflict: '', mainlineLink: '', endChapter: '' }])}>
          添加支线
        </Button>
      </div>
    )
  }
  if (fieldKey === 'writingContractTags') {
    return (
      <Select
        aria-label={path}
        mode="tags"
        value={value}
        options={['wish_fulfillment', 'realism', 'romance', 'suspense', 'growth', 'ensemble'].map(option => ({ value: option, label: String(documentEnumLabel(fieldKey, option)) }))}
        onChange={onChange}
      />
    )
  }
  if (value.every(item => typeof item === 'string')) {
    return (
      <Input.TextArea
        aria-label={path}
        value={value.join('\n')}
        onChange={event => onChange(event.target.value.split('\n'))}
        autoSize={{ minRows: 3, maxRows: 12 }}
        placeholder="每行一项"
      />
    )
  }
  return (
    <div className="author-document-list">
      {value.map((item, i) => (
        <section key={i}>
          <DocumentEditor value={item} names={names} fieldKey={fieldKey} path={`${path} ${i + 1}`} onChange={next => onChange(value.map((old, j) => i === j ? next : old))} />
        </section>
      ))}
    </div>
  )
}

function ObjectDocumentEditor({
  value,
  onChange,
  path,
  names,
}: {
  value: Record<string, unknown>
  onChange: (value: unknown) => void
  path: string
  names: Record<string, string>
}): React.ReactElement {
  return (
    <div className="author-document-editor">
      {Object.entries(value)
        .filter(([k]) => !INTERNAL_FIELDS.has(documentFieldKey(k)) && !AUTHOR_PROCESS_FIELDS.has(documentFieldKey(k)))
        .map(([k, item]) => (
          <div key={k}>
            <label>{fieldLabel(k)}</label>
            <DocumentEditor value={item} names={names} fieldKey={k} path={`${path} ${fieldLabel(k)}`} onChange={next => onChange({ ...value, [k]: next })} />
          </div>
        ))}
    </div>
  )
}

export function DocumentEditor({ value, onChange, path = '', fieldKey = '', names = {} }: { value: unknown; onChange: (value: unknown) => void; path?: string; fieldKey?: string; names?: Record<string, string> }): React.ReactElement {
  const key = documentFieldKey(fieldKey)
  if (key === 'currentTimeChapterNum') return <InputNumber aria-label={path} min={0} precision={0} value={typeof value === 'number' ? value : null} onChange={onChange} />
  if (documentReferenceType(key) && (!value || typeof value !== 'object' || Array.isArray(value))) {
    const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
    const freeText = key === 'revealPayload' || key === 'requiredAssetRefs'
    return <Select aria-label={path || fieldLabel(key)} mode={Array.isArray(value) ? (freeText ? 'tags' : 'multiple') : undefined} showSearch optionFilterProp="label" allowClear value={value == null || value === '' ? undefined : value} options={documentReferenceOptions(key, names, values)} onChange={next => onChange(next ?? (Array.isArray(value) ? [] : null))} placeholder="选择关联资料" />
  }
  if (Array.isArray(value)) {
    return <ArrayDocumentEditor value={value} onChange={onChange} path={path} fieldKey={key} names={names} />
  }
  if (value && typeof value === 'object') {
    return <ObjectDocumentEditor value={value as Record<string, unknown>} onChange={onChange} path={path} names={names} />
  }
  if (DOCUMENT_OPTIONS[key] && (!value || DOCUMENT_OPTIONS[key][String(value)])) return <Select aria-label={path} allowClear value={value || undefined} onChange={next => onChange(next || '')} options={Object.entries(DOCUMENT_OPTIONS[key]).map(([val, label]) => ({ value: val, label }))} />
  if (typeof value === 'boolean') return <Checkbox checked={value} onChange={event => onChange(event.target.checked)}>{path.split(' ').pop()}</Checkbox>
  if (typeof value === 'number') return <InputNumber aria-label={path} value={value} onChange={next => onChange(next)} />
  return <Input.TextArea aria-label={path} value={String(value ?? '')} onChange={event => onChange(event.target.value)} autoSize={{ minRows: 2, maxRows: 10 }} />
}
