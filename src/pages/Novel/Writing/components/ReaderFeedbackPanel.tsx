import { useEffect, useState } from 'react'
import { Button, Input, InputNumber, Select, message } from 'antd'
import type { ReaderFeedbackSettings, SaveReaderFeedbackInput } from '../../../../shared/reader-feedback'

export type PassageFeedbackInput = Pick<SaveReaderFeedbackInput, 'note' | 'topic' | 'sentiment' | 'scope' | 'expectedRevision'>

export default function ReaderFeedbackPanel({ novelId, onSave }: { novelId: number; onSave(input: PassageFeedbackInput): Promise<void> }) {
  const [feedback, setFeedback] = useState<ReaderFeedbackSettings | null>(null)
  const [note, setNote] = useState('')
  const [sentiment, setSentiment] = useState<'keep' | 'reduce'>('keep')
  const [scope, setScope] = useState<'passage' | 'scene' | 'character' | 'book'>('passage')
  const [sceneOrder, setSceneOrder] = useState(1)
  const [characterName, setCharacterName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void window.electron.novel.getReaderFeedback(novelId).then((value) => { if (active) setFeedback(value) }).catch((error) => message.error(String(error)))
    return () => { active = false }
  }, [novelId])
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
      setFeedback(await window.electron.novel.getReaderFeedback(novelId))
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <details className="writing-contract-disclosure">
    <summary>记录选区阅读偏好</summary>
    <p>默认只对本段生效；不同意见会并列保留，可随时撤销。原文改变后旧意见不再注入。</p>
    <div className="writing-feedback-controls">
      <Select aria-label="反馈倾向" value={sentiment} onChange={setSentiment} options={[{ value: 'keep', label: '保留' }, { value: 'reduce', label: '减少' }]} />
      <Select aria-label="反馈范围" value={scope} onChange={setScope} options={[{ value: 'passage', label: '本段' }, { value: 'scene', label: '本场景' }, { value: 'character', label: '指定角色' }, { value: 'book', label: '本书' }]} />
      {scope === 'scene' ? <InputNumber aria-label="场景序号" min={1} value={sceneOrder} onChange={(value) => setSceneOrder(value || 1)} /> : null}
      {scope === 'character' ? <Input aria-label="角色姓名" placeholder="填写当前作品的角色姓名" value={characterName} onChange={(event) => setCharacterName(event.target.value)} /> : null}
    </div>
    <Input.TextArea aria-label="阅读偏好说明" maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder="具体说明想保留或减少的表达" />
    <Button loading={busy} disabled={!feedback || !note.trim()} onClick={() => void mutate(async () => {
      await onSave({ note, topic: '阅读表达', sentiment, expectedRevision: feedback!.revision,
        scope: scope === 'scene' ? { type: scope, sceneOrder } : scope === 'character' ? { type: scope, characterName } : { type: scope } })
      setNote('')
    })}>保存阅读偏好</Button>
    <ul>{feedback?.items.filter((item) => item.status === 'approved').map((item) => <li key={item.id}>
      {item.sentiment === 'keep' ? '保留' : '减少'} · {{ passage: '本段', scene: '本场景', character: '角色', book: '本书' }[item.scope.type]} · {item.note}
      <Button type="link" size="small" disabled={busy} onClick={() => void mutate(() => window.electron.novel.revokeReaderFeedback(novelId, { id: item.id, expectedRevision: feedback.revision }))}>撤销</Button>
    </li>)}</ul>
  </details>
}
