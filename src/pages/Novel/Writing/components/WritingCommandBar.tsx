import { Button, Dropdown, Popover, Select, Tag } from 'antd'
import { DownOutlined, FileProtectOutlined, LoadingOutlined, RobotOutlined } from '@ant-design/icons'
import ActionBar from '../../../../components/novel/common/ActionBar'
import CreativeStageScope from '../../../../components/novel/CreativeStageScope'
import { AI_EXECUTION_MODE_OPTIONS, type AiExecutionMode } from '../../../../shared/ai-execution'
import type { GenerationHandoffViewModel } from '../writing-generation-handoff'

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
  handoff: GenerationHandoffViewModel
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
  handoff,
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
          aria-label="全局生成模式"
          options={AI_EXECUTION_MODE_OPTIONS.map((item) => ({ value: item.value, label: `全局：${item.label}` }))}
          onChange={onDefaultAiModeChange}
        />
        {selectedSnippetLength > 0 ? <span>{`已选 ${selectedSnippetLength} 字`}</span> : null}
      </div>
      <div className="chapter-console-page__editor-actions">
        <Button onClick={onSave} disabled={!hasChapter || hasMultiSegments}>保存</Button>
        <Popover
          placement="bottomRight"
          trigger="click"
          content={(
            <div className="writing-generation-handoff" data-handoff-status={handoff.status}>
              <div className="writing-generation-handoff__head">
                <div>
                  <strong>生成前交接单</strong>
                  <span>{handoff.summary}</span>
                </div>
                <Tag color={handoff.status === 'ready' ? 'success' : handoff.status === 'blocked' ? 'error' : 'warning'}>{handoff.label}</Tag>
              </div>
              <div className="writing-generation-handoff__style">
                <span>风格依据</span>
                <strong>{handoff.styleSource}</strong>
              </div>
              <div className="writing-generation-handoff__items">
                {handoff.items.map((item) => (
                  <div key={item.key} className={`writing-generation-handoff__item${item.ready ? ' is-ready' : ' is-missing'}`}>
                    <span aria-hidden="true">{item.ready ? '✓' : '!'}</span>
                    <div><strong>{item.label}</strong><small>{item.detail}</small></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        >
          <Button
            icon={<FileProtectOutlined />}
            disabled={!hasChapter}
            className="chapter-console-page__handoff-button"
            aria-label={`查看生成前交接单，${handoff.readyCount}/${handoff.totalCount} 项就绪`}
          >
            {`交接单 ${handoff.readyCount}/${handoff.totalCount}`}
          </Button>
        </Popover>
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
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'rewrite',
                label: rewritingSelection ? '正在重写选区…' : '重写选区',
                disabled: !hasChapter || hasMultiSegments || selectedSnippetLength === 0 || rewritingSelection,
              },
              {
                key: 'optimize',
                label: optimizingChapter ? '正在优化整章…' : '整章优化',
                disabled: !hasChapter || hasMultiSegments || generating || optimizingChapter,
              },
              { key: 'review', label: '审校', disabled: !hasChapter },
              { type: 'divider' },
              { key: 'finalize', label: '定稿', disabled: !hasChapter },
            ],
            onClick: ({ key }) => {
              if (key === 'rewrite') onOpenRewrite()
              if (key === 'optimize') onOptimize()
              if (key === 'review') onAiCheck()
              if (key === 'finalize') onFinalize()
            },
          }}
        >
          <Button disabled={!hasChapter}>更多 <DownOutlined /></Button>
        </Dropdown>
      </div>
    </ActionBar>
  )
}
