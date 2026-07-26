import { Alert, Input, Modal } from 'antd'
import QualityGateReport from '../../../../../components/novel/quality/QualityGateReport'
import {
  fromFactGuard,
  fromOptimizationQualityGate,
  fromStructuralGate,
} from '../../../../../components/novel/quality/gate-adapters'
import type { ChapterOptimizeResult } from '../../../../../types'

interface OptimizeCandidateModalProps {
  open: boolean
  result: ChapterOptimizeResult | null
  requirements: string
  applying: boolean
  onRequirementsChange: (value: string) => void
  onCancel: () => void
  onApply: () => void
}

/** 整章 AI 优化候选稿 Modal：含质量门报告，应用前不覆盖正文。 */
export default function OptimizeCandidateModal({
  open,
  result,
  requirements,
  applying,
  onRequirementsChange,
  onCancel,
  onApply,
}: OptimizeCandidateModalProps) {
  return (
    <Modal
      title="整章 AI 优化候选稿"
      open={open}
      onCancel={onCancel}
      onOk={onApply}
      okButtonProps={{
        disabled: Boolean(
          applying
          || (result?.factGuard && !result.factGuard.safeToApply)
          || (result?.qualityGate && !result.qualityGate.safeToApply),
        ),
        loading: applying,
      }}
      okText="应用优化稿"
      width={920}
    >
      <div className="novel-note-list writing-layout-note-space-bottom">
        <div className="novel-note-list__item">整章优化只生成候选稿，应用前不会覆盖正文。</div>
        <div className="novel-note-list__item">重点保留剧情事实，修正 AI 味、衔接、空泛细节和读感问题。</div>
        {result?.qualityGate ? (
          <div className="novel-note-list__item">
            {`后验质量门：强 AI 味 ${result.qualityGate.originalStrongAiFlavorCount} -> ${result.qualityGate.optimizedStrongAiFlavorCount}，漂移分 ${result.qualityGate.originalDriftScore} -> ${result.qualityGate.optimizedDriftScore}。`}
          </div>
        ) : null}
        {result?.issueSummary.slice(0, 4).map((item) => (
          <div key={item} className="novel-note-list__item">{item}</div>
        ))}
      </div>
      {result?.warnings.length ? (
        <Alert
          className="writing-layout-note-space-bottom"
          type="warning"
          showIcon
          message="优化稿需要人工核验"
          description={result.warnings.slice(0, 5).join('；')}
        />
      ) : null}
      <Input.TextArea
        value={requirements}
        rows={3}
        onChange={(event) => onRequirementsChange(event.target.value)}
        placeholder="下次整章优化的补充要求，例如：更克制、减少破折号、保留结尾钩子。"
      />
      <div className="novel-grid novel-grid--2 writing-layout-note-space-top">
        <Input.TextArea
          value={result?.originalContent || ''}
          rows={14}
          readOnly
          placeholder="原正文"
        />
        <Input.TextArea
          value={result?.optimizedContent || ''}
          rows={14}
          readOnly
          placeholder="优化候选稿"
        />
      </div>
      {result ? (
        <div className="writing-layout-note-space-top">
          <QualityGateReport
            reports={[
              fromFactGuard(result.factGuard),
              fromOptimizationQualityGate(result.qualityGate),
              ...(result.structuralGate ? [fromStructuralGate(result.structuralGate)] : []),
            ]}
          />
        </div>
      ) : null}
    </Modal>
  )
}
