import { Button, Select } from 'antd'
import { CheckOutlined, FileSearchOutlined, LoadingOutlined, RobotOutlined } from '@ant-design/icons'
import ActionBar from '../../../../components/novel/common/ActionBar'
import CreativeStageScope from '../../../../components/novel/CreativeStageScope'
import { AI_EXECUTION_MODE_OPTIONS, type AiExecutionMode } from '../../../../shared/ai-execution'

export interface WritingCommandBarProps {
  novelId: number
  creativeStageId: number | null
  defaultAiExecutionMode: AiExecutionMode
  savingAiMode: boolean
  selectedSnippetLength: number
  hasChapter: boolean
  hasMultiSegments: boolean
  generating: boolean
  generationReady: boolean
  generationBlockedReason?: string
  rewritingSelection: boolean
  optimizingChapter: boolean
  onCreativeStageChange(stageId: number | null): void
  onDefaultAiModeChange(mode: AiExecutionMode): void
  onSave(): void
  onCancelGeneration(): void
  onGenerate(): void
  onOpenRewrite(): void
  onOptimize(): void
  onAiCheck(): void
  onFinalize(): void
}

export default function WritingCommandBar({
  creativeStageId,
  defaultAiExecutionMode,
  generating,
  generationBlockedReason,
  generationReady,
  hasChapter,
  hasMultiSegments,
  novelId,
  onAiCheck,
  onCancelGeneration,
  onCreativeStageChange,
  onDefaultAiModeChange,
  onFinalize,
  onGenerate,
  onOpenRewrite,
  onOptimize,
  onSave,
  optimizingChapter,
  rewritingSelection,
  savingAiMode,
  selectedSnippetLength,
}: WritingCommandBarProps) {
  return (
    <ActionBar align="between">
      <div className="chapter-console-page__editor-status">
        <CreativeStageScope novelId={novelId} value={creativeStageId} onChange={onCreativeStageChange} />
        <Select
          size="small"
          className="writing-layout-select-default"
          value={defaultAiExecutionMode}
          loading={savingAiMode}
          options={AI_EXECUTION_MODE_OPTIONS.map((item) => ({ value: item.value, label: `默认·${item.label}` }))}
          onChange={onDefaultAiModeChange}
        />
        {selectedSnippetLength > 0 ? <span>{`已选 ${selectedSnippetLength} 字`}</span> : null}
      </div>
      <div className="chapter-console-page__editor-actions">
        <Button onClick={onSave} disabled={!hasChapter || hasMultiSegments}>保存</Button>
        {generating ? (
          <Button danger icon={<LoadingOutlined />} onClick={onCancelGeneration}>停止</Button>
        ) : (
          <Button
            type="primary"
            icon={<RobotOutlined />}
            disabled={!hasChapter || !generationReady}
            title={generationReady ? '生成正文' : generationBlockedReason || '当前章节暂不适合生成'}
            onClick={onGenerate}
          >
            生成
          </Button>
        )}
        <Button
          icon={<RobotOutlined />}
          disabled={!hasChapter || hasMultiSegments || selectedSnippetLength === 0}
          loading={rewritingSelection}
          onClick={onOpenRewrite}
        >
          重写
        </Button>
        <Button
          icon={<RobotOutlined />}
          disabled={!hasChapter || hasMultiSegments || generating}
          loading={optimizingChapter}
          onClick={onOptimize}
        >
          整章优化
        </Button>
        <Button icon={<FileSearchOutlined />} disabled={!hasChapter} onClick={onAiCheck}>审校</Button>
        <Button icon={<CheckOutlined />} disabled={!hasChapter} onClick={onFinalize}>定稿</Button>
      </div>
    </ActionBar>
  )
}
