import { Input, Modal } from 'antd'

interface RewriteSelectionModalProps {
  open: boolean
  selectedText: string
  requirements: string
  confirmLoading: boolean
  onRequirementsChange: (value: string) => void
  onCancel: () => void
  onOk: () => void
}

/** 选区重写 Modal：只重写当前选中的文段，开关 state 由 Writing 页持有。 */
export default function RewriteSelectionModal({
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
      onOk={onOk}
      confirmLoading={confirmLoading}
      okText="应用重写"
    >
      <div className="novel-note-list writing-layout-note-space-bottom">
        <div className="novel-note-list__item">AI 只会重写当前选中的文段，不会改动其他正文。</div>
        <div className="novel-note-list__item">默认保留事件与设定，优先修正语言、逻辑和衔接。</div>
      </div>
      <Input.TextArea value={selectedText} rows={6} readOnly />
      <Input.TextArea
        className="writing-layout-note-space-top"
        value={requirements}
        rows={6}
        onChange={(event) => onRequirementsChange(event.target.value)}
        placeholder="补充要求，例如：更克制、减少说明句、强化动作细节。"
      />
    </Modal>
  )
}
