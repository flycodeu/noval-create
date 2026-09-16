import ReaderFeedbackPanel, { type PassageFeedbackInput } from '../ReaderFeedbackPanel'
import { Input, Modal } from 'antd'

interface RewriteSelectionModalProps {
  novelId?: number
  onFeedback?(input: PassageFeedbackInput): Promise<void>
  candidate?: { original: string; replacement: string; stale?: boolean } | null
  onApply?(): void
  open: boolean
  selectedText: string
  requirements: string
  confirmLoading: boolean
  onRequirementsChange: (value: string) => void
  onCancel: () => void
  onOk: () => void
}

export default function RewriteSelectionModal({
  novelId,
  onFeedback,
  candidate,
  onApply,
  open,
  selectedText,
  requirements,
  confirmLoading,
  onRequirementsChange,
  onCancel,
  onOk,
}: RewriteSelectionModalProps) {
  return (
    <Modal
      title="重写选中文段"
      open={open}
      onCancel={onCancel}
      onOk={candidate ? onApply : onOk}
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: candidate?.stale }}
      okText={candidate ? '采纳候选' : '生成候选'}
      cancelText="保留原稿"
      width={760}
      zIndex={1100}
    >
      {candidate?.stale ? <p role="alert">原稿已变化，候选已失效，请关闭后重新选择。</p> : null}
      <p>仅修订选中文段，保留事件、人物和叙事视角；采纳前请对照原稿。</p>
      <div className="writing-passage-comparison">
        <label>原稿<Input.TextArea aria-label="选区原稿" value={candidate?.original ?? selectedText} rows={6} readOnly /></label>
        {candidate ? <label>候选<Input.TextArea aria-label="选区候选" value={candidate.replacement} rows={6} readOnly /></label> : null}
      </div>
      <Input.TextArea
        className="writing-layout-note-space-top"
        disabled={Boolean(candidate) || confirmLoading}
        value={requirements}
        rows={3}
        onChange={(event) => onRequirementsChange(event.target.value)}
        placeholder="补充要求，例如：更克制、减少说明句、强化动作细节。"
      />
      {open && novelId && onFeedback ? <ReaderFeedbackPanel novelId={novelId} onSave={onFeedback} /> : null}
    </Modal>
  )
}
