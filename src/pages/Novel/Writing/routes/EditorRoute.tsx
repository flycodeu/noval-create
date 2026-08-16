import React from 'react'
import { Alert, Button, Tag } from 'antd'
import { formatFailure } from '../../../../shared/task-labels'
import {
  AiExplainabilityCard,
  ChapterBridgeMemoryCard,
  ChapterFocusCard,
  ChapterForeshadowWritebackCard,
  ChapterRevealConstraintCard,
  ConstraintInjectionCard,
  ContextUsageImpactCard,
  InsightCard,
  PreviousChapterFeedCard,
  RecallDiagnosticsCard,
  StringList,
  WriterToolsTraceCard,
} from '../components/InsightPanel'
import type { ChapterInspectorActions, ChapterInspectorViewModel } from '../writing-inspector-view-model'

interface Props {
  model: ChapterInspectorViewModel
  actions: ChapterInspectorActions
  title?: string
  subtitle?: string
}

function ScenePlan({ model }: { model: ChapterInspectorViewModel }) {
  return (
    <InsightCard title="场景拆解" eyebrow="执行顺序">
      {model.scenes.length > 0 ? (
        <div className="novel-scene-list">
          {model.scenes.map((scene) => (
            <div key={`${scene.scene_order}-${scene.scene_title}`} className="novel-scene-card">
              <div className="novel-scene-card__header">
                <span>{`场景 ${String(scene.scene_order).padStart(2, '0')}`}</span>
                <strong>{scene.scene_title}</strong>
              </div>
              <div className="novel-scene-card__body">
                <div>{scene.purpose}</div>
                {scene.location ? <div>地点：{scene.location}</div> : null}
                {scene.time_anchor ? <div>时间：{scene.time_anchor}</div> : null}
                {scene.present_characters?.length ? <div>人物：{scene.present_characters.join('、')}</div> : null}
                {scene.key_items?.length ? <div>道具：{scene.key_items.join('、')}</div> : null}
                {scene.must_cover?.length ? <div>必须覆盖：{scene.must_cover.join('、')}</div> : null}
                {scene.climax_variant ? <div>高潮变体：{scene.climax_variant}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">先运行章节流水线，系统会按合同拆出场景计划后在这里核对。</div>
      )}
    </InsightCard>
  )
}

function PipelineSnapshot({ model }: { model: ChapterInspectorViewModel }) {
  const snapshot = model.pipelineSnapshot
  return (
    <InsightCard title="长篇写作架构" eyebrow="规划 / 写作 / 审校 / 重写 / 回写" tone="soft">
      {snapshot ? (
        <div className="writing-layout-stack">
          <div className="novel-copy-block">
            {`当前阶段：${snapshot.currentRole ? snapshot.roles[snapshot.currentRole]?.label || snapshot.currentRole : '待启动'} · AI 模式 ${model.pipelineExecutionModeLabel || '未记录'} · 合同版本 ${snapshot.contractVersion || '未记录'} · 总耗时 ${snapshot.totalDurationMs ? `${(snapshot.totalDurationMs / 1000).toFixed(1)}秒` : '-'} · 总用量 ${snapshot.totalTokensUsed || 0}${snapshot.failureCode ? ` · 退出码 ${snapshot.failureCode}` : ''}`}
          </div>
          {snapshot.stepMemory?.summary ? (
            <div className="novel-copy-block writing-layout-copy-prewrap">{snapshot.stepMemory.summary}</div>
          ) : (
            <div className="novel-copy-block">当前流水线还没有记录运行时步骤记忆。</div>
          )}
          <StringList items={(snapshot.stepMemory?.runtimeAssertions || []).map((item) => `运行时断言：${item}`)} empty="当前流水线没有额外运行时断言。" />
          <div className="writing-layout-stack writing-layout-stack--xs">
            {model.pipelineRoles.map((item) => (
              <div key={item.role} className="novel-issue-item">
                <div className="novel-issue-item__head">
                  <Tag color={item.status === 'success' ? 'success' : item.status === 'running' ? 'processing' : item.status === 'blocked' ? 'warning' : item.status === 'failed' ? 'error' : 'default'}>
                    {item.status === 'success' ? '已完成' : item.status === 'running' ? '执行中' : item.status === 'blocked' ? '已阻断' : item.status === 'failed' ? '失败' : '待执行'}
                  </Tag>
                  <strong>{item.label}</strong>
                  {item.taskId ? <Tag color="blue">{`任务 #${item.taskId}`}</Tag> : null}
                  {item.canonRunId ? <Tag color="geekblue">{`回写 #${item.canonRunId}`}</Tag> : null}
                </div>
                <div className="novel-issue-item__desc">{item.detail || item.summary}</div>
                <div className="novel-issue-item__suggestion">
                  {`预算：${item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}秒` : '-'} / 用量 ${item.tokensUsed || 0}${item.failureCode ? ` · ${formatFailure(item.failureCode).title}` : ''}${item.rewriteScope ? ` · ${item.rewriteScope}` : ''}${typeof item.targetSegmentId === 'number' ? ` · 场景#${item.targetSegmentId}` : ''}`}
                </div>
              </div>
            ))}
          </div>
          {snapshot.canonRunId ? <div className="novel-copy-block">{`已生成回写草案 #${snapshot.canonRunId}，可直接进入章后状态回写中心确认。`}</div> : null}
        </div>
      ) : (
        <div className="novel-copy-block">当前章节还没有最近一次角色化流水线快照。</div>
      )}
    </InsightCard>
  )
}

function DiagnosticCards({ model, actions }: Pick<Props, 'model' | 'actions'>) {
  return (
    <InsightCard title="更多诊断与回写" eyebrow="上下文 / 资产 / 伏笔 / 世界规则 · 按需展开" tone="soft" collapsible>
      <div className="novel-writing-shell__insight-stack novel-writing-shell__insight-stack--nested">
        {model.contextPreviewError ? <Alert type="error" showIcon message="章节上下文预览不可用" description={model.contextPreviewError} /> : null}
        {model.contextPreview?.contractReady === false ? (
          <Alert
            type="warning"
            showIcon
            message="当前章节还不能启动合同驱动写作"
            description={<div className="writing-layout-stack writing-layout-stack--xs">
              <div>{(model.contextPreview.contractBlockers || ['请先补齐章节合同和场景合同。']).join('；')}</div>
              <Button size="small" type="primary" onClick={actions.onOpenContracts}>去补齐章节合同</Button>
            </div>}
          />
        ) : null}
        <InsightCard title="关键约束注入" eyebrow="本章关键约束已注入" tone="soft">
          <ConstraintInjectionCard preview={model.contextPreview} preserveConstraintLabels={model.preserveConstraintLabels} onPreserveConstraintChange={actions.onPreserveConstraintChange} />
        </InsightCard>
        <InsightCard title="上一章关键先验" eyebrow="承接上一章的真实输入" tone="soft"><PreviousChapterFeedCard preview={model.contextPreview} /></InsightCard>
        <InsightCard title="章节衔接桥" eyebrow="时间 / 地点 / 情绪 / 视角" tone="soft"><ChapterBridgeMemoryCard preview={model.contextPreview} /></InsightCard>
        <InsightCard title="召回补充层" eyebrow="背景补充 / 非事实源" tone="soft"><RecallDiagnosticsCard preview={model.contextPreview} /></InsightCard>
        <InsightCard title="资产影响与注入" eyebrow="本次实际使用 / 待同步影响" tone="soft"><ContextUsageImpactCard preview={model.contextPreview} /></InsightCard>
        <InsightCard title="AI 生成解释" eyebrow={`当前模式 · ${model.effectiveAiModeLabel}`} tone="soft"><AiExplainabilityCard preview={model.contextPreview} /></InsightCard>
        <InsightCard title="写作工具追踪" eyebrow="按需检索 / 降级 / 覆盖" tone="soft"><WriterToolsTraceCard preview={model.contextPreview} /></InsightCard>
        <InsightCard title="生产摘要" eyebrow="AI 主写 / 人工定稿" tone="soft"><StringList items={model.productionBriefItems} empty="先完成审校或刷新摘要，再回到这里收口定稿优先级。" /></InsightCard>
        <InsightCard title="关联线索" eyebrow="时间轴 / 道具" tone="soft"><StringList items={model.relatedInsightItems} empty="当前章节暂未关联时间轴事件或关键道具。" /></InsightCard>
        <InsightCard title="本章信息揭示控制" eyebrow="允许揭示 / 已揭示" tone="soft">
          <ChapterRevealConstraintCard chapter={model.chapter} facts={model.facts} volumes={model.volumes} characters={model.characters} allowedFactIds={model.allowedRevealFactIds} revealedFactIds={model.revealedFactIds} truthStats={model.truthStats} saving={model.revealConstraintsSaving} onUpdate={actions.onUpdateRevealConstraints} onOpenBoard={actions.onOpenInfoGapBoard} />
        </InsightCard>
        <InsightCard title="本章伏笔回写" eyebrow="新增埋设 / 已回收登记" tone="soft">
          <ChapterForeshadowWritebackCard chapter={model.chapter} chapterSegments={model.chapterSegments} ledger={model.foreshadowLedger} saving={model.foreshadowWritebackSaving} onCreate={actions.onCreateForeshadow} onPatch={actions.onPatchForeshadow} onDelete={actions.onDeleteForeshadow} onOpenLedger={actions.onOpenForeshadowLedger} />
        </InsightCard>
        <InsightCard title="本章应回收伏笔" eyebrow={model.dueForeshadowEyebrow} tone="soft"><StringList items={model.dueForeshadowItems} empty="当前章节附近没有到期或超期未收的伏笔债务。" /></InsightCard>
        <InsightCard title="修订提示" eyebrow="复盘重点" tone="soft"><StringList items={model.reviewInsightItems} empty="先运行审校或刷新摘要，再集中处理需要回看的修订点。" /></InsightCard>
        <InsightCard title="世界规则" eyebrow="写作边界" tone="soft"><StringList items={model.worldRulesSummary} empty={model.hasWorldRules ? '本章暂未命中明确的世界边界。' : '先完善世界规则，再回来校对本章边界。'} /></InsightCard>
      </div>
    </InsightCard>
  )
}

export default function EditorRoute({ model, actions, title = '本章焦点', subtitle = '合同、场景、约束与承接信息' }: Props) {
  return (
    <section className="writing-route-view writing-route-view--editor" data-route="editor">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </header>
      <div className="writing-route-view__body">
        <div className="novel-writing-shell__insight-spotlight">
          <ChapterFocusCard summary={model.focus.summary} nextChapterSeed={model.focus.nextChapterSeed} continuityItems={model.focus.continuityItems} bridgeItems={model.focus.bridgeItems} qualityItems={model.focus.qualityItems} />
          <ScenePlan model={model} />
        </div>
        <div className="novel-writing-shell__insight-stack">
          <PipelineSnapshot model={model} />
          <DiagnosticCards model={model} actions={actions} />
        </div>
      </div>
    </section>
  )
}
